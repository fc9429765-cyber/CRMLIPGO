"use server"

// Importacion por archivo: simular, revisar, aplicar (ADM-01, INT-05, CAR-06).
//
// DOS PASOS, SIEMPRE:
//   1. simularImportacion: lee las filas, las cruza con la base y guarda que
//      haria con cada una (crear, actualizar, omitir, error) y lo que habia
//      antes. NO escribe en ninguna tabla de negocio.
//   2. aplicarImportacion: ejecuta lo simulado. Revalida cada fila, porque
//      entre la simulacion y el clic en "Aplicar" la base pudo cambiar.
//
// REGLAS QUE PROTEGEN A LIPgo (clientes y bodegas son tablas compartidas):
//   - No se cambia el NOMBRE de un cliente existente: LIPgo guarda el nombre
//     como texto en cada pedido, y renombrarlo desconecta su historial.
//   - Un NIT que coincide con varios clientes es ambiguo y se reporta como
//     error: hay 46 NIT repetidos en la base (verificado el 2026-09-26).
//   - No se crean productos: son de LIPgo. Solo se actualiza lo comercial.
//   - Ids nuevos con crm_siguiente_id (sincroniza con el MAX de LIPgo).
//   - `activo` se escribe como texto 'true', que es como lo guarda LIPgo.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirPermiso, mensajeError, type ContextoCrm } from "@/lib/crm-auth"
import { registrarEvento } from "@/lib/crm-eventos"
import {
  IMPORTACIONES, candidatosDocumento, leerFila, mapearEncabezados, normalizarEncabezado,
  type TipoImportacion,
} from "@/lib/crm-importacion"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

type Accion = "crear" | "actualizar" | "omitir" | "error"
type DB = Awaited<ReturnType<typeof getSupabaseAdmin>>

export interface FilaSimulada {
  fila: number
  accion: Accion
  errores: string[]
  /** Valores leidos + ids resueltos (cliente_id, producto_id…). */
  datos: Record<string, unknown>
  /** Lo que hay hoy en la base, para comparar antes de aplicar. */
  antes: Record<string, unknown> | null
  /** Texto corto para la tabla: que se va a hacer. */
  resumen: string
}

export interface ResultadoSimulacion {
  importacionId: number
  tipo: TipoImportacion
  columnasReconocidas: string[]
  columnasIgnoradas: string[]
  totales: Record<Accion, number>
  filas: FilaSimulada[]
}

const MAX_FILAS = 5000

// --------------------------------------------------------- indices de apoyo

/** Todo lo que hace falta para resolver filas, cargado una sola vez. */
interface Indices {
  clientesPorDoc: Map<string, { id: number; nombre: string }[]>
  clientesPorId: Map<number, Record<string, unknown>>
  vendedores: Map<string, number>
  listas: Map<string, number>
  productosPorCodigo: Map<string, { id: number; id_empresa: number }[]>
  impuestos: Map<string, number>
  owners: Map<string, number>
}

const clave = (t: unknown) => normalizarEncabezado(String(t ?? ""))

async function cargarIndices(db: DB, empresaId: number, tipo: TipoImportacion): Promise<Indices> {
  const idx: Indices = {
    clientesPorDoc: new Map(), clientesPorId: new Map(), vendedores: new Map(), listas: new Map(),
    productosPorCodigo: new Map(), impuestos: new Map(), owners: new Map(),
  }
  const necesitaClientes = ["clientes", "catalogo", "sucursales", "saldos_iniciales", "notas_credito"].includes(tipo)

  const [cli, ven, lis, own, imp] = await Promise.all([
    necesitaClientes
      ? db.from("clientes").select("id, documento, nombre, correo, celular, cupo_credito, dias_credito, vendedor_asignado, lista_precio_id, segmento, bloqueado_cartera").eq("id_empresa", empresaId)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    db.from("vendedores").select("idvendedor, nombre"),
    db.from("crm_listas_precios").select("id, nombre").eq("idempresa", empresaId),
    db.from("crm_owners").select("id, codigo, idempresas_origen").eq("idempresa", empresaId),
    db.from("crm_impuestos").select("id, codigo").eq("idempresa", empresaId),
  ])

  for (const c of cli.data ?? []) {
    idx.clientesPorId.set(c.id as number, c)
    const doc = String(c.documento ?? "").replace(/\D/g, "").replace(/^0+/, "")
    if (!doc) continue
    const lista = idx.clientesPorDoc.get(doc) ?? []
    lista.push({ id: c.id as number, nombre: String(c.nombre ?? "") })
    idx.clientesPorDoc.set(doc, lista)
  }
  for (const v of ven.data ?? []) {
    idx.vendedores.set(clave(v.nombre), v.idvendedor as number)
    idx.vendedores.set(String(v.idvendedor), v.idvendedor as number)
  }
  for (const l of lis.data ?? []) idx.listas.set(clave(l.nombre), l.id as number)
  for (const o of own.data ?? []) idx.owners.set(clave(o.codigo), o.id as number)
  for (const i of imp.data ?? []) idx.impuestos.set(clave(i.codigo), i.id as number)

  if (tipo === "productos" || tipo === "catalogo") {
    const empresas = [...new Set([empresaId, ...(own.data ?? []).flatMap((o) => o.idempresas_origen as number[])])]
    const { data: prods } = await db.from("productos").select("id, id_empresa, codigo").in("id_empresa", empresas)
    for (const p of prods ?? []) {
      const k = clave(p.codigo)
      if (!k) continue
      const lista = idx.productosPorCodigo.get(k) ?? []
      lista.push({ id: p.id as number, id_empresa: p.id_empresa as number })
      idx.productosPorCodigo.set(k, lista)
    }
  }
  return idx
}

/** Cliente de una fila: por id si viene, si no por NIT (con y sin DV). */
function resolverCliente(v: Record<string, unknown>, idx: Indices): { id?: number; error?: string; nuevo?: boolean } {
  if (typeof v.id_cliente === "number") {
    return idx.clientesPorId.has(v.id_cliente) ? { id: v.id_cliente } : { error: `No existe el cliente con id ${v.id_cliente}` }
  }
  const encontrados = new Map<number, string>()
  for (const cand of candidatosDocumento(v.documento as string)) {
    for (const c of idx.clientesPorDoc.get(cand) ?? []) encontrados.set(c.id, c.nombre)
  }
  if (encontrados.size === 1) return { id: [...encontrados.keys()][0] }
  if (encontrados.size > 1) {
    const lista = [...encontrados].map(([id, n]) => `${id} (${n})`).join(", ")
    return { error: `El NIT ${v.documento} corresponde a varios clientes: ${lista}. Agrega la columna Id cliente.` }
  }
  return { nuevo: true }
}

function resolverVendedor(t: unknown, idx: Indices): number | null | undefined {
  if (t == null || t === "") return undefined
  return idx.vendedores.get(clave(t)) ?? idx.vendedores.get(String(t).trim()) ?? null
}

// ------------------------------------------------------------ simulacion

async function simularFila(
  tipo: TipoImportacion,
  v: Record<string, unknown>,
  idx: Indices,
  db: DB,
  empresaId: number,
): Promise<Omit<FilaSimulada, "fila">> {
  const err = (e: string): Omit<FilaSimulada, "fila"> => ({ accion: "error", errores: [e], datos: v, antes: null, resumen: e })

  switch (tipo) {
    case "clientes": {
      const r = resolverCliente(v, idx)
      if (r.error) return err(r.error)
      const cambios: Record<string, unknown> = {}
      for (const k of ["correo", "celular", "cupo_credito", "dias_credito", "segmento", "bloqueado_cartera"]) {
        if (k in v) cambios[k] = v[k]
      }
      if ("vendedor" in v) {
        const vid = resolverVendedor(v.vendedor, idx)
        if (vid === null) return err(`No existe el vendedor "${v.vendedor}"`)
        cambios.vendedor_asignado = vid
      }
      if ("lista_precio" in v) {
        const lid = idx.listas.get(clave(v.lista_precio))
        if (!lid) return err(`No existe la lista de precios "${v.lista_precio}"`)
        cambios.lista_precio_id = lid
      }
      if (r.nuevo) {
        if (!v.nombre) return err("El NIT no existe: para crear el cliente hace falta el Nombre")
        return { accion: "crear", errores: [], datos: { ...cambios, documento: v.documento, nombre: v.nombre }, antes: null,
          resumen: `Crear cliente ${v.nombre}` }
      }
      const actual = idx.clientesPorId.get(r.id!)!
      const distintos = Object.fromEntries(Object.entries(cambios).filter(([k, val]) => String(actual[k] ?? "") !== String(val ?? "")))
      if (!Object.keys(distintos).length) {
        return { accion: "omitir", errores: [], datos: { cliente_id: r.id }, antes: null, resumen: "Sin cambios" }
      }
      const antes = Object.fromEntries(Object.keys(distintos).map((k) => [k, actual[k] ?? null]))
      return { accion: "actualizar", errores: [], datos: { cliente_id: r.id, ...distintos }, antes,
        resumen: `Actualizar ${actual.nombre}: ${Object.keys(distintos).join(", ")}` }
    }

    case "productos": {
      const cands = idx.productosPorCodigo.get(clave(v.codigo)) ?? []
      if (!cands.length) return err(`No existe un producto con código ${v.codigo}. Los productos se crean en LIPgo.`)
      if (cands.length > 1) return err(`El código ${v.codigo} está en varias empresas (${cands.map((c) => c.id_empresa).join(", ")})`)
      const cambios: Record<string, unknown> = {}
      if ("precio_base" in v) {
        if ((v.precio_base as number) < 0) return err("El precio base no puede ser negativo")
        cambios.precio_base = v.precio_base
      }
      if ("descripcion_comercial" in v) cambios.descripcion_comercial = v.descripcion_comercial
      if ("impuesto" in v) {
        const iid = idx.impuestos.get(clave(v.impuesto))
        if (!iid) return err(`No existe el impuesto "${v.impuesto}"`)
        cambios.crm_impuesto_id = iid
      }
      if (!Object.keys(cambios).length) return { accion: "omitir", errores: [], datos: v, antes: null, resumen: "Sin columnas para actualizar" }
      const { data: filaActual } = await db.from("productos").select("nombre, precio_base, descripcion_comercial, crm_impuesto_id").eq("id", cands[0].id).maybeSingle()
      const actual = filaActual as Record<string, unknown> | null
      const distintos = Object.fromEntries(Object.entries(cambios).filter(([k, val]) => String(actual?.[k] ?? "") !== String(val ?? "")))
      if (!Object.keys(distintos).length) return { accion: "omitir", errores: [], datos: { producto_id: cands[0].id }, antes: null, resumen: "Sin cambios" }
      return { accion: "actualizar", errores: [], datos: { producto_id: cands[0].id, ...distintos },
        antes: Object.fromEntries(Object.keys(distintos).map((k) => [k, actual?.[k] ?? null])),
        resumen: `Actualizar ${actual?.nombre ?? v.codigo}: ${Object.keys(distintos).join(", ")}` }
    }

    case "catalogo": {
      const r = resolverCliente(v, idx)
      if (r.error) return err(r.error)
      if (r.nuevo) return err(`No existe un cliente con NIT ${v.documento}`)
      const cands = idx.productosPorCodigo.get(clave(v.codigo)) ?? []
      if (cands.length !== 1) return err(cands.length ? `El código ${v.codigo} es ambiguo` : `No existe el producto ${v.codigo}`)
      const { data: actual } = await db.from("crm_catalogo_cliente").select("activo")
        .eq("idempresa", empresaId).eq("cliente_id", r.id!).eq("producto_id", cands[0].id).maybeSingle()
      const quitar = v.quitar === true
      const esta = actual?.activo === true
      if (quitar === !esta) return { accion: "omitir", errores: [], datos: v, antes: null, resumen: quitar ? "No estaba en el catálogo" : "Ya estaba en el catálogo" }
      return { accion: quitar ? "actualizar" : "crear", errores: [],
        datos: { cliente_id: r.id, producto_id: cands[0].id, quitar }, antes: actual ? { activo: actual.activo } : null,
        resumen: quitar ? `Quitar ${v.codigo} del catálogo` : `Agregar ${v.codigo} al catálogo` }
    }

    case "sucursales": {
      const r = resolverCliente(v, idx)
      if (r.error) return err(r.error)
      if (r.nuevo) return err(`No existe un cliente con NIT ${v.documento}`)
      const { data: bods } = await db.from("bodegas").select("idbodega, nombrebodega, direccion, ciudad, departamento").eq("clienteid", r.id!)
      const actual = (bods ?? []).find((b) => clave(b.nombrebodega) === clave(v.nombre))
      const campos = Object.fromEntries(["direccion", "ciudad", "departamento"].filter((k) => k in v).map((k) => [k, v[k]]))
      if (!actual) {
        return { accion: "crear", errores: [], datos: { cliente_id: r.id, nombre: v.nombre, ...campos }, antes: null,
          resumen: `Crear sucursal ${v.nombre}` }
      }
      const distintos = Object.fromEntries(Object.entries(campos).filter(([k, val]) => String(actual[k as keyof typeof actual] ?? "") !== String(val)))
      if (!Object.keys(distintos).length) return { accion: "omitir", errores: [], datos: v, antes: null, resumen: "Sin cambios" }
      return { accion: "actualizar", errores: [], datos: { idbodega: actual.idbodega, ...distintos },
        antes: Object.fromEntries(Object.keys(distintos).map((k) => [k, actual[k as keyof typeof actual] ?? null])),
        resumen: `Actualizar sucursal ${actual.nombrebodega}` }
    }

    case "vendedores_usuarios": {
      const vid = resolverVendedor(v.vendedor, idx)
      if (!vid) return err(`No existe el vendedor "${v.vendedor}"`)
      const u = String(v.usuario).trim().toLowerCase()
      const { data: perfil } = await db.from("profiles").select("id, usuario").ilike("usuario", u).maybeSingle()
      let userId = perfil?.id as string | undefined
      if (!userId) {
        const { data } = await db.auth.admin.listUsers({ perPage: 1000 })
        userId = data?.users.find((x) => x.email?.toLowerCase() === u)?.id
      }
      if (!userId) return err(`No existe el usuario "${v.usuario}"`)
      const { data: otro } = await db.from("crm_vendedores_detalle").select("vendedor_id").eq("usuario_id", userId).neq("vendedor_id", vid).maybeSingle()
      if (otro) return err(`Ese usuario ya está vinculado al vendedor ${otro.vendedor_id}`)
      const { data: actual } = await db.from("crm_vendedores_detalle").select("usuario_id").eq("vendedor_id", vid).maybeSingle()
      if (actual?.usuario_id === userId) return { accion: "omitir", errores: [], datos: v, antes: null, resumen: "Ya estaba vinculado" }
      return { accion: actual ? "actualizar" : "crear", errores: [], datos: { vendedor_id: vid, usuario_id: userId },
        antes: actual ? { usuario_id: actual.usuario_id } : null, resumen: `Vincular ${v.vendedor} con ${v.usuario}` }
    }

    case "facturas": {
      const ref = String(v.pedido).trim()
      let pedidoId: number | null = null
      if (/^\d+$/.test(ref)) {
        const { data } = await db.from("crm_pedidos").select("id").eq("idempresa", empresaId).eq("idpedido_lipgo", Number(ref)).maybeSingle()
        pedidoId = (data?.id as number) ?? null
      }
      if (!pedidoId) {
        const { data } = await db.from("crm_pedidos").select("id").eq("idempresa", empresaId).ilike("numero", ref).maybeSingle()
        pedidoId = (data?.id as number) ?? null
      }
      if (!pedidoId) return err(`No existe el pedido ${ref} en el CRM`)
      const { data: cuenta } = await db.from("crm_cuentas_cobrar")
        .select("id, owner_id, numero_factura, fecha_factura, fecha_vencimiento")
        .eq("idempresa", empresaId).eq("pedido_id", pedidoId).eq("tipo_documento", "factura").maybeSingle()
      if (!cuenta) return err(`El pedido ${ref} no tiene cuenta por cobrar (¿es de contado o aún no se aprueba?)`)
      const { data: dup } = await db.from("crm_cuentas_cobrar").select("id")
        .eq("idempresa", empresaId).eq("numero_factura", v.numero_factura as string).neq("id", cuenta.id).limit(1)
      if (dup?.length) return err(`La factura ${v.numero_factura} ya está asignada a otra cuenta`)
      const cambios: Record<string, unknown> = { numero_factura: v.numero_factura }
      if (v.fecha_factura) cambios.fecha_factura = v.fecha_factura
      if (v.fecha_vencimiento) cambios.fecha_vencimiento = v.fecha_vencimiento
      const distintos = Object.fromEntries(Object.entries(cambios).filter(([k, val]) => String(cuenta[k as keyof typeof cuenta] ?? "") !== String(val)))
      if (!Object.keys(distintos).length) return { accion: "omitir", errores: [], datos: v, antes: null, resumen: "Ya tenía esos datos" }
      return { accion: "actualizar", errores: [], datos: { cuenta_id: cuenta.id, ...distintos },
        antes: Object.fromEntries(Object.keys(distintos).map((k) => [k, cuenta[k as keyof typeof cuenta] ?? null])),
        resumen: `Factura ${v.numero_factura} → pedido ${ref}` }
    }

    case "saldos_iniciales": {
      const r = resolverCliente(v, idx)
      if (r.error) return err(r.error)
      if (r.nuevo) return err(`No existe un cliente con NIT ${v.documento}. Impórtalo primero en Clientes.`)
      const ownerId = idx.owners.get(clave(v.owner))
      if (!ownerId) return err(`No existe el owner "${v.owner}". Usa el código: INDUPAN o MOLINOS.`)
      const { data: existe } = await db.from("crm_cuentas_cobrar").select("id")
        .eq("idempresa", empresaId).eq("owner_id", ownerId).eq("numero_factura", v.numero_factura as string).limit(1)
      // Omitir y no actualizar: una factura que ya esta en el CRM tiene su
      // propio saldo y sus abonos. Pisarla con un archivo la contaria mal.
      if (existe?.length) return { accion: "omitir", errores: [], datos: v, antes: null, resumen: `La factura ${v.numero_factura} ya existe` }
      let vendedorId = idx.clientesPorId.get(r.id!)?.vendedor_asignado ?? null
      if ("vendedor" in v) {
        const vid = resolverVendedor(v.vendedor, idx)
        if (vid === null) return err(`No existe el vendedor "${v.vendedor}"`)
        vendedorId = vid ?? vendedorId
      }
      return { accion: "crear", errores: [], datos: {
          cliente_id: r.id, owner_id: ownerId, numero_factura: v.numero_factura, fecha_factura: v.fecha_factura,
          fecha_vencimiento: v.fecha_vencimiento, saldo: v.saldo, vendedor_id: vendedorId,
        }, antes: null,
        resumen: `Saldo ${Number(v.saldo).toLocaleString("es-CO")} · factura ${v.numero_factura}` }
    }

    case "notas_credito": {
      const r = resolverCliente(v, idx)
      if (r.error) return err(r.error)
      if (r.nuevo) return err(`No existe un cliente con NIT ${v.documento}`)
      const ownerId = idx.owners.get(clave(v.owner))
      if (!ownerId) return err(`No existe el owner "${v.owner}". Usa el código: INDUPAN o MOLINOS.`)
      const valor = Number(v.valor)
      if (!(valor > 0)) return err("El valor de la nota debe ser mayor que cero")
      const { data: cuenta } = await db.from("crm_cuentas_cobrar").select("id, saldo, estado")
        .eq("idempresa", empresaId).eq("cliente_id", r.id!).eq("owner_id", ownerId)
        .eq("numero_factura", v.numero_factura as string).maybeSingle()
      if (!cuenta) return err(`El cliente no tiene la factura ${v.numero_factura} de ese owner`)
      const nota = String(v.numero_nota).trim()
      const { data: ya } = await db.from("crm_pagos").select("id").eq("cuenta_cobrar_id", cuenta.id)
        .eq("tipo", "nota_credito").eq("referencia", nota).is("anulado_en", null).limit(1)
      if (ya?.length) return { accion: "omitir", errores: [], datos: v, antes: null, resumen: `La nota ${nota} ya estaba aplicada` }
      if (!["pendiente", "parcial"].includes(cuenta.estado as string)) return err(`La factura ${v.numero_factura} está ${cuenta.estado}`)
      if (valor > Number(cuenta.saldo)) {
        return err(`La nota (${valor.toLocaleString("es-CO")}) supera el saldo de la factura (${Number(cuenta.saldo).toLocaleString("es-CO")})`)
      }
      return { accion: "crear", errores: [], datos: {
          cuenta_id: cuenta.id, cliente_id: r.id, numero_factura: v.numero_factura, referencia: nota,
          fecha: v.fecha, valor, motivo: v.motivo ?? null,
        }, antes: { saldo: Number(cuenta.saldo) },
        resumen: `Nota ${nota} por ${valor.toLocaleString("es-CO")} → factura ${v.numero_factura} (saldo queda en ${(Number(cuenta.saldo) - valor).toLocaleString("es-CO")})` }
    }
  }
}

/**
 * Simula una importacion. Recibe las filas ya leidas del archivo por el
 * navegador (encabezado → valor). No escribe en tablas de negocio.
 */
export async function simularImportacion(
  tipo: TipoImportacion,
  filas: Record<string, unknown>[],
  archivoNombre: string,
  empresaId = 1,
): Promise<ActionResult<ResultadoSimulacion>> {
  try {
    const def = IMPORTACIONES[tipo]
    if (!def) return { success: false, error: "Tipo de importación desconocido" }
    const ctx = await exigirPermiso("simularImportacion", "crm_importar")
    await exigirPermiso(`importar:${tipo}`, def.permiso)

    if (!filas.length) return { success: false, error: "El archivo no tiene filas" }
    if (filas.length > MAX_FILAS) return { success: false, error: `Máximo ${MAX_FILAS} filas por archivo. Divídelo en partes.` }

    const encabezados = Object.keys(filas[0])
    const mapa = mapearEncabezados(encabezados, def)
    const obligatorios = def.campos.filter((c) => c.obligatorio && c.clave !== "documento")
    const faltan = obligatorios.filter((c) => !Object.values(mapa).includes(c.clave))
    if (!Object.values(mapa).includes("documento") && def.campos.some((c) => c.clave === "documento" && c.obligatorio)) {
      faltan.unshift(def.campos.find((c) => c.clave === "documento")!)
    }
    if (faltan.length) {
      return { success: false, error: `Faltan columnas obligatorias: ${faltan.map((c) => c.etiqueta).join(", ")}. Descarga la plantilla.` }
    }

    const db = await getSupabaseAdmin()
    const idx = await cargarIndices(db, empresaId, tipo)

    const resultado: FilaSimulada[] = []
    for (let i = 0; i < filas.length; i++) {
      const { valores, errores } = leerFila(filas[i], mapa, def)
      if (errores.length) {
        resultado.push({ fila: i + 2, accion: "error", errores, datos: valores, antes: null, resumen: errores.join("; ") })
        continue
      }
      resultado.push({ fila: i + 2, ...(await simularFila(tipo, valores, idx, db, empresaId)) })
    }

    // Dos filas del archivo para lo mismo: la segunda pisaria a la primera
    // sin que nadie lo note. Se marcan las repetidas como error.
    const llaveFila = (f: FilaSimulada) =>
      JSON.stringify([f.datos.cliente_id ?? f.datos.documento, f.datos.producto_id, f.datos.numero_factura, f.datos.nombre, f.datos.vendedor_id, f.datos.cuenta_id, f.datos.referencia])
    const vistas = new Map<string, number>()
    for (const f of resultado) {
      if (f.accion === "error" || f.accion === "omitir") continue
      const k = llaveFila(f)
      if (vistas.has(k)) {
        f.accion = "error"
        f.errores = [`Repite lo de la fila ${vistas.get(k)}`]
        f.resumen = f.errores[0]
      } else vistas.set(k, f.fila)
    }

    const totales = { crear: 0, actualizar: 0, omitir: 0, error: 0 } as Record<Accion, number>
    for (const f of resultado) totales[f.accion]++

    const { data: imp, error: e1 } = await db.from("crm_importaciones").insert({
      idempresa: empresaId, tipo, archivo_nombre: archivoNombre, estado: "simulada", total_filas: resultado.length,
      filas_crear: totales.crear, filas_actualizar: totales.actualizar, filas_omitir: totales.omitir, filas_error: totales.error,
      creado_por: ctx.nombre,
    }).select("id").single()
    if (e1) return { success: false, error: e1.message }

    for (let i = 0; i < resultado.length; i += 500) {
      const { error } = await db.from("crm_importacion_filas").insert(
        resultado.slice(i, i + 500).map((f) => ({
          idempresa: empresaId, importacion_id: imp.id, fila: f.fila, datos: f.datos, accion: f.accion,
          errores: f.errores, antes: f.antes,
        })),
      )
      if (error) return { success: false, error: error.message }
    }

    return {
      success: true,
      data: {
        importacionId: imp.id as number,
        tipo,
        columnasReconocidas: Object.keys(mapa),
        columnasIgnoradas: encabezados.filter((h) => !mapa[h]),
        totales,
        filas: resultado,
      },
    }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

// ------------------------------------------------------------- aplicacion

async function aplicarFila(
  tipo: TipoImportacion,
  accion: Accion,
  d: Record<string, unknown>,
  db: DB,
  empresaId: number,
  ctx: ContextoCrm,
  importacionId: number,
): Promise<{ entidadId?: number; error?: string }> {
  const fallo = (e: { message: string } | null) => (e ? { error: e.message } : null)

  switch (tipo) {
    case "clientes": {
      if (accion === "crear") {
        for (let intento = 0; intento < 2; intento++) {
          const { data: id } = await db.rpc("crm_siguiente_id", { p_tabla: "clientes", p_columna: "id" })
          const doc = String(d.documento ?? "").replace(/\D/g, "")
          const { error } = await db.from("clientes").insert({
            id, id_empresa: empresaId, nombre: d.nombre, documento: doc ? Number(doc) : null, activo: "true",
            correo: d.correo ?? null, celular: d.celular ?? null, cupo_credito: d.cupo_credito ?? 0,
            dias_credito: d.dias_credito ?? 0, vendedor_asignado: d.vendedor_asignado ?? null,
            lista_precio_id: d.lista_precio_id ?? null, segmento: d.segmento ?? null,
            bloqueado_cartera: d.bloqueado_cartera ?? false,
          })
          // 23505: LIPgo inserto el mismo id entre la lectura y la escritura.
          if (error?.code === "23505" && intento === 0) continue
          return error ? { error: error.message } : { entidadId: id as number }
        }
        return { error: "No se pudo asignar un id" }
      }
      const { cliente_id, ...cambios } = d
      const e = fallo((await db.from("clientes").update(cambios).eq("id", cliente_id as number)).error)
      return e ?? { entidadId: cliente_id as number }
    }
    case "productos": {
      const { producto_id, ...cambios } = d
      const e = fallo((await db.from("productos").update(cambios).eq("id", producto_id as number)).error)
      return e ?? { entidadId: producto_id as number }
    }
    case "catalogo": {
      const e = fallo((await db.from("crm_catalogo_cliente").upsert(
        { idempresa: empresaId, cliente_id: d.cliente_id, producto_id: d.producto_id, activo: !d.quitar, creado_por: ctx.nombre },
        { onConflict: "idempresa,cliente_id,producto_id" })).error)
      return e ?? { entidadId: d.cliente_id as number }
    }
    case "sucursales": {
      if (accion === "crear") {
        for (let intento = 0; intento < 2; intento++) {
          const { data: id } = await db.rpc("crm_siguiente_id", { p_tabla: "bodegas", p_columna: "idbodega" })
          const { error } = await db.from("bodegas").insert({
            idbodega: id, idempresa: empresaId, clienteid: d.cliente_id, nombrebodega: d.nombre,
            direccion: d.direccion ?? null, ciudad: d.ciudad ?? null, departamento: d.departamento ?? null, activo: "true",
          })
          if (error?.code === "23505" && intento === 0) continue
          return error ? { error: error.message } : { entidadId: id as number }
        }
        return { error: "No se pudo asignar un id" }
      }
      const { idbodega, ...cambios } = d
      const e = fallo((await db.from("bodegas").update(cambios).eq("idbodega", idbodega as number)).error)
      return e ?? { entidadId: idbodega as number }
    }
    case "vendedores_usuarios": {
      const e = fallo((await db.from("crm_vendedores_detalle").upsert(
        { vendedor_id: d.vendedor_id, idempresa: empresaId, usuario_id: d.usuario_id },
        { onConflict: "vendedor_id" })).error)
      return e ?? { entidadId: d.vendedor_id as number }
    }
    case "facturas": {
      const { cuenta_id, ...cambios } = d
      const e = fallo((await db.from("crm_cuentas_cobrar").update(cambios).eq("id", cuenta_id as number)).error)
      return e ?? { entidadId: cuenta_id as number }
    }
    case "notas_credito": {
      // Se vuelve a mirar el saldo al aplicar: entre la simulacion y este
      // momento pudo entrar un recaudo, u otra nota del mismo archivo.
      const { data: cta } = await db.from("crm_cuentas_cobrar").select("saldo, estado").eq("id", d.cuenta_id as number).maybeSingle()
      if (!cta || !["pendiente", "parcial"].includes(cta.estado as string)) return { error: `La factura ${d.numero_factura} ya no tiene saldo` }
      if (Number(d.valor) > Number(cta.saldo)) {
        return { error: `La nota supera el saldo actual de la factura (${Number(cta.saldo).toLocaleString("es-CO")})` }
      }
      const { data, error } = await db.from("crm_pagos").insert({
        idempresa: empresaId, cuenta_cobrar_id: d.cuenta_id, fecha_pago: d.fecha, valor: d.valor, medio_pago: "nota_credito",
        referencia: d.referencia, tipo: "nota_credito", registrado_por: ctx.nombre,
        observacion: `Nota crédito ${d.referencia}${d.motivo ? ` · ${d.motivo}` : ""} (importación ${importacionId})`,
      }).select("id").single()
      if (error) return { error: error.message }
      return { entidadId: data.id as number }
    }
    case "saldos_iniciales": {
      const { data, error } = await db.from("crm_cuentas_cobrar").insert({
        idempresa: empresaId, cliente_id: d.cliente_id, owner_id: d.owner_id, numero_factura: d.numero_factura,
        fecha_factura: d.fecha_factura, fecha_vencimiento: d.fecha_vencimiento, valor_original: d.saldo,
        vendedor_id: d.vendedor_id ?? null, tipo_documento: "saldo_inicial", origen: "importacion",
        importacion_id: importacionId, estado: "pendiente", creado_por: ctx.nombre,
        observaciones: "Saldo inicial cargado por importación",
      }).select("id").single()
      if (error) return { error: error.code === "23505" ? `La factura ${d.numero_factura} ya existe` : error.message }
      return { entidadId: data.id as number }
    }
  }
}

/** Aplica una importacion simulada. Solo filas crear/actualizar. */
export async function aplicarImportacion(
  importacionId: number,
  empresaId = 1,
): Promise<ActionResult<{ aplicadas: number; fallidas: { fila: number; error: string }[] }>> {
  try {
    const ctx = await exigirPermiso("aplicarImportacion", "crm_importar")
    const db = await getSupabaseAdmin()

    const { data: imp } = await db.from("crm_importaciones").select("*").eq("id", importacionId).eq("idempresa", empresaId).maybeSingle()
    if (!imp) return { success: false, error: "La importación no existe" }
    if (imp.estado !== "simulada") return { success: false, error: `La importación ya está ${imp.estado}` }
    const def = IMPORTACIONES[imp.tipo as TipoImportacion]
    await exigirPermiso(`importar:${imp.tipo}`, def.permiso)

    // Se marca como aplicada ANTES de escribir, con condicion: dos clics en
    // "Aplicar" no pueden cargar el archivo dos veces.
    const { data: tomada } = await db.from("crm_importaciones")
      .update({ estado: "aplicada", aplicado_por: ctx.nombre, aplicado_en: new Date().toISOString() })
      .eq("id", importacionId).eq("estado", "simulada").select("id")
    if (!tomada?.length) return { success: false, error: "Otra persona ya está aplicando esta importación" }

    const { data: filas } = await db.from("crm_importacion_filas").select("*")
      .eq("importacion_id", importacionId).in("accion", ["crear", "actualizar"]).order("fila")

    let aplicadas = 0
    const fallidas: { fila: number; error: string }[] = []
    for (const f of filas ?? []) {
      const r = await aplicarFila(imp.tipo, f.accion, f.datos as Record<string, unknown>, db, empresaId, ctx, importacionId)
      if (r.error) {
        fallidas.push({ fila: f.fila, error: r.error })
        await db.from("crm_importacion_filas").update({ errores: [r.error] }).eq("id", f.id)
      } else {
        aplicadas++
        await db.from("crm_importacion_filas").update({ aplicada: true, entidad_id: r.entidadId ?? null }).eq("id", f.id)
      }
    }

    if (fallidas.length && !aplicadas) {
      await db.from("crm_importaciones").update({ estado: "fallida" }).eq("id", importacionId)
    }

    await registrarEvento({
      empresaId, entidad: "importacion", entidadId: importacionId, tipo: "aplicada",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      datos: { tipo: imp.tipo, archivo: imp.archivo_nombre, aplicadas, fallidas: fallidas.length },
    })
    return { success: true, data: { aplicadas, fallidas } }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

export interface ImportacionResumen {
  id: number
  tipo: TipoImportacion
  archivo_nombre: string | null
  estado: string
  total_filas: number
  filas_crear: number
  filas_actualizar: number
  filas_omitir: number
  filas_error: number
  creado_por: string | null
  creado_en: string
  aplicado_por: string | null
  aplicado_en: string | null
}

export async function listarImportaciones(empresaId = 1): Promise<ActionResult<ImportacionResumen[]>> {
  try {
    await exigirPermiso("listarImportaciones", "crm_importar")
    const db = await getSupabaseAdmin()
    const { data, error } = await db.from("crm_importaciones").select("*")
      .eq("idempresa", empresaId).order("creado_en", { ascending: false }).limit(100)
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as ImportacionResumen[] }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

/** Descarta una simulacion que no se va a aplicar. */
export async function descartarImportacion(importacionId: number, empresaId = 1): Promise<ActionResult> {
  try {
    await exigirPermiso("descartarImportacion", "crm_importar")
    const db = await getSupabaseAdmin()
    const { data } = await db.from("crm_importaciones").update({ estado: "descartada" })
      .eq("id", importacionId).eq("idempresa", empresaId).eq("estado", "simulada").select("id")
    if (!data?.length) return { success: false, error: "Solo se puede descartar una importación sin aplicar" }
    return { success: true }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}
