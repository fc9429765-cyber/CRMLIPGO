"use server"

// Pedidos: ciclo de vida, doble aprobacion y programacion en LIPgo (PED-18..29).
//
// ESTE ARCHIVO GOBIERNA EL PUNTO MAS DELICADO DEL CRM: un pedido aprobado se
// escribe en pedidoscabecera, que es produccion de LIPgo.
//
// CICLO (reglas en lib/crm-pedidos-estado.ts):
//   borrador → [solicitar] → pendiente_cartera → [Cartera] → pendiente_gerencia
//   → [Gerencia] → aprobado → [LIPgo] → programado_lipgo
//   rechazado → [editar y solicitar de nuevo] → pendiente_cartera
//
// Al aprobarse (PED-23), en este orden y sin que uno bloquee al otro:
//   1. se programa en LIPgo (si `pedido.proyectar_al_aprobar`);
//   2. si el owner factura por SAP, queda en la bandeja de SAP;
//   3. se avisa por WhatsApp a los destinatarios configurados (PED-25).
// Un fallo de LIPgo deja el pedido aprobado con el error a la vista y un
// boton para reintentar; nunca deshace la aprobacion.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { leerParam, leerParamBool } from "@/lib/crm-parametros-server"
import { PARAM, VALOR_SECRETO_DE_FABRICA } from "@/lib/crm-parametros"
import {
  exigirPermiso, tienePermiso, filtrarPorVendedor, asegurarClienteVisible, mensajeError,
  type ContextoCrm,
} from "@/lib/crm-auth"
import { registrarEvento } from "@/lib/crm-eventos"
import { encolarAviso, encolarSap } from "@/lib/integraciones/outbox"
import { evaluarCreditoCliente, filasDetalle, prepararDocumento, type LineaEntrada } from "@/lib/crm-venta-server"
import {
  estadoTrasFirma, puedeAnular, puedeEditar, puedeFirmar, puedeRechazar, puedeSolicitar, rolesQueFaltan,
  ESTADO_LABEL, ROL_ETIQUETA, type ModoAprobacion,
} from "@/lib/crm-pedidos-estado"
import {
  PERMISO_POR_ROL,
  type Pedido, type PedidoConDetalle, type LineaPedido, type EstadoPedido, type RolAutorizacion,
  type EventoAutorizacion,
} from "@/lib/crm-pedidos"
import type { ResultadoCredito } from "@/lib/crm-credito"
import type { CuentaCliente } from "@/lib/crm-cuenta"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

function fallo(err: unknown): ActionResult<never> {
  const msg = mensajeError(err)
  console.error("[crm-pedidos]", msg)
  return { success: false, error: msg }
}

const VER = ["crm_pedidos", "crm_autorizar_contabilidad", "crm_autorizar_gerencia"] as const

async function modoAprobacion(empresaId: number): Promise<ModoAprobacion> {
  return (await leerParam(PARAM.PEDIDO_APROBACION_MODO, empresaId)) === "paralelo" ? "paralelo" : "secuencial"
}

const cop = (n: number) =>
  (Number(n) || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

// ================================================================ CONSULTAS

export interface FiltrosPedidos {
  estado?: EstadoPedido | EstadoPedido[]
  clienteId?: number
  vendedorId?: number
  ownerId?: number
  bodegaId?: number
  /** Fecha de creacion, AAAA-MM-DD, inclusive. */
  desde?: string
  hasta?: string
  /** Atajos: mes (1-12) y año. Se convierten en desde/hasta. */
  mes?: number
  anio?: number
  soloSobrecupo?: boolean
  soloPendientes?: boolean
  /** Numero del pedido o del pedido en LIPgo. */
  texto?: string
}

/** Resuelve nombres (cliente, sucursal, vendedor, owner) para una lista. */
async function conNombres(pedidos: Pedido[]): Promise<PedidoConDetalle[]> {
  if (!pedidos.length) return []
  const db = await getSupabaseAdmin()
  const ids = (k: keyof Pedido) => [...new Set(pedidos.map((p) => p[k]).filter((v) => v != null))] as number[]
  const [cli, bod, ven, own] = await Promise.all([
    db.from("clientes").select("id, nombre").in("id", ids("cliente_id")),
    ids("bodega_id").length ? db.from("bodegas").select("idbodega, nombrebodega").in("idbodega", ids("bodega_id")) : Promise.resolve({ data: [] }),
    ids("vendedor_id").length ? db.from("vendedores").select("idvendedor, nombre").in("idvendedor", ids("vendedor_id")) : Promise.resolve({ data: [] }),
    db.from("crm_owners").select("id, nombre"),
  ])
  const m = <T extends Record<string, unknown>>(rows: T[] | null | undefined, k: string, v: string) =>
    new Map((rows ?? []).map((r) => [r[k] as number, r[v] as string]))
  const nCli = m(cli.data as Record<string, unknown>[], "id", "nombre")
  const nBod = m(bod.data as Record<string, unknown>[], "idbodega", "nombrebodega")
  const nVen = m(ven.data as Record<string, unknown>[], "idvendedor", "nombre")
  const nOwn = m(own.data as Record<string, unknown>[], "id", "nombre")
  return pedidos.map((p) => ({
    ...p,
    cliente_nombre: nCli.get(p.cliente_id) ?? null,
    sucursal_nombre: p.bodega_id ? nBod.get(p.bodega_id) ?? null : null,
    vendedor_nombre: p.vendedor_id ? nVen.get(p.vendedor_id) ?? null : null,
    owner_nombre: p.owner_id ? nOwn.get(p.owner_id) ?? null : null,
  }))
}

/**
 * Listado con filtros y paginacion EN EL SERVIDOR (PED-27..29). Antes se
 * traian 300 pedidos y se filtraba en el navegador: el pedido 301 no existia.
 */
export async function buscarPedidos(
  empresaId = 1,
  filtros: FiltrosPedidos = {},
  pagina = 1,
  tamano = 50,
): Promise<ActionResult<{ filas: PedidoConDetalle[]; total: number }>> {
  try {
    const ctx = await exigirPermiso("buscarPedidos", ...VER)
    const db = await getSupabaseAdmin()
    let q = db.from("crm_pedidos").select("*", { count: "exact" }).eq("idempresa", empresaId)
    q = filtrarPorVendedor(q, ctx, "vendedor_id")

    let desde = filtros.desde
    let hasta = filtros.hasta
    if (filtros.anio) {
      const a = filtros.anio
      if (filtros.mes) {
        const ult = new Date(Date.UTC(a, filtros.mes, 0)).getUTCDate()
        desde = `${a}-${String(filtros.mes).padStart(2, "0")}-01`
        hasta = `${a}-${String(filtros.mes).padStart(2, "0")}-${ult}`
      } else {
        desde = `${a}-01-01`
        hasta = `${a}-12-31`
      }
    }
    if (desde) q = q.gte("fecha", desde)
    if (hasta) q = q.lte("fecha", hasta)
    if (filtros.estado) q = Array.isArray(filtros.estado) ? q.in("estado", filtros.estado) : q.eq("estado", filtros.estado)
    if (filtros.soloPendientes) q = q.in("estado", ["pendiente_cartera", "pendiente_gerencia"])
    if (filtros.clienteId) q = q.eq("cliente_id", filtros.clienteId)
    if (filtros.vendedorId) q = q.eq("vendedor_id", filtros.vendedorId)
    if (filtros.ownerId) q = q.eq("owner_id", filtros.ownerId)
    if (filtros.bodegaId) q = q.eq("bodega_id", filtros.bodegaId)
    if (filtros.soloSobrecupo) q = q.eq("requiere_sobrecupo", true)
    if (filtros.texto?.trim()) {
      const t = filtros.texto.trim()
      q = /^\d+$/.test(t) ? q.or(`numero.ilike.%${t}%,idpedido_lipgo.eq.${t}`) : q.ilike("numero", `%${t}%`)
    }

    const tam = Math.min(Math.max(tamano, 1), 200)
    const ini = (Math.max(pagina, 1) - 1) * tam
    const { data, error, count } = await q.order("creado_en", { ascending: false }).range(ini, ini + tam - 1)
    if (error) return { success: false, error: error.message }
    return { success: true, data: { filas: await conNombres((data ?? []) as Pedido[]), total: count ?? 0 } }
  } catch (err) {
    return fallo(err)
  }
}

/** Compatibilidad: lo usa Reportes. Devuelve hasta 1000 pedidos. */
export async function getPedidos(
  empresaId = 1,
  filtros?: FiltrosPedidos,
): Promise<ActionResult<PedidoConDetalle[]>> {
  const r = await buscarPedidos(empresaId, filtros ?? {}, 1, 200)
  if (!r.success) return { success: false, error: r.error }
  const filas = [...(r.data?.filas ?? [])]
  for (let pagina = 2; filas.length < Math.min(r.data?.total ?? 0, 1000); pagina++) {
    const mas = await buscarPedidos(empresaId, filtros ?? {}, pagina, 200)
    if (!mas.success || !mas.data?.filas.length) break
    filas.push(...mas.data.filas)
  }
  return { success: true, data: filas }
}

/** Lectura sin validacion: la usan las acciones que ya validaron el permiso. */
async function getPedidoInterno(id: number, empresaId: number): Promise<PedidoConDetalle | null> {
  const db = await getSupabaseAdmin()
  const [cab, det] = await Promise.all([
    db.from("crm_pedidos").select("*").eq("id", id).eq("idempresa", empresaId).maybeSingle(),
    db.from("crm_pedido_detalle").select("*").eq("pedido_id", id).order("linea"),
  ])
  if (!cab.data) return null
  const [conN] = await conNombres([cab.data as Pedido])
  return { ...conN, lineas: (det.data ?? []) as LineaPedido[] }
}

export async function getPedido(id: number, empresaId = 1): Promise<ActionResult<PedidoConDetalle>> {
  try {
    const ctx = await exigirPermiso("getPedido", ...VER)
    const p = await getPedidoInterno(id, empresaId)
    // El pedido de otro vendedor se trata como inexistente: decir "no tienes
    // permiso" confirmaria que ese id existe.
    if (!p || (ctx.alcance === "propios" && p.vendedor_id !== ctx.vendedorId)) {
      return { success: false, error: "No encontrado" }
    }
    return { success: true, data: p }
  } catch (err) {
    return fallo(err)
  }
}

export interface EventoPedido {
  id: number
  tipo: string
  estado_desde: string | null
  estado_hasta: string | null
  usuario_nombre: string | null
  nota: string | null
  datos: Record<string, unknown>
  creado_en: string
}

/**
 * Historial del pedido, el "ojito" (PED-24): creacion, ediciones, envio a
 * aprobacion, cada firma, rechazos con motivo, reenvios, programacion en
 * LIPgo y errores de integracion. Todo con usuario y hora.
 */
export async function getHistorialPedido(pedidoId: number, empresaId = 1): Promise<ActionResult<EventoPedido[]>> {
  try {
    const ctx = await exigirPermiso("getHistorialPedido", ...VER)
    const db = await getSupabaseAdmin()
    if (ctx.alcance === "propios") {
      const { data: p } = await db.from("crm_pedidos").select("vendedor_id").eq("id", pedidoId).maybeSingle()
      if (!p || p.vendedor_id !== ctx.vendedorId) return { success: false, error: "No encontrado" }
    }
    const { data, error } = await db
      .from("crm_eventos")
      .select("id, tipo, estado_desde, estado_hasta, usuario_nombre, nota, datos, creado_en")
      .eq("idempresa", empresaId)
      .eq("entidad", "pedido")
      .eq("entidad_id", pedidoId)
      .order("creado_en")
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as EventoPedido[] }
  } catch (err) {
    return fallo(err)
  }
}

/** Compatibilidad con la pantalla anterior de firmas. */
export async function getHistorialAutorizaciones(pedidoId: number): Promise<ActionResult<EventoAutorizacion[]>> {
  try {
    const ctx = await exigirPermiso("getHistorialAutorizaciones", ...VER)
    const db = await getSupabaseAdmin()
    if (ctx.alcance === "propios") {
      const { data: p } = await db.from("crm_pedidos").select("vendedor_id").eq("id", pedidoId).maybeSingle()
      if (!p || p.vendedor_id !== ctx.vendedorId) return { success: false, error: "No encontrado" }
    }
    const { data, error } = await db.from("crm_autorizaciones_log").select("*").eq("pedido_id", pedidoId).order("creado_en", { ascending: false })
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as EventoAutorizacion[] }
  } catch (err) {
    return fallo(err)
  }
}

// ============================================================ EDICION

export interface CambiosPedido {
  bodega_id?: number | null
  idempresa_despacho?: number | null
  forma_pago?: "contado" | "credito"
  dias_credito?: number
  fecha_programada?: string | null
  orden_compra?: string | null
  observaciones?: string | null
  /** Si viene, reemplaza TODAS las lineas. */
  lineas?: LineaEntrada[]
}

/**
 * Edita un pedido en borrador o rechazado (PED-21). Las lineas se recalculan
 * en el servidor con las mismas reglas que al crearlo.
 */
export async function editarPedido(pedidoId: number, cambios: CambiosPedido, empresaId = 1): Promise<ActionResult<PedidoConDetalle>> {
  try {
    const ctx = await exigirPermiso("editarPedido", "crm_pedidos")
    const db = await getSupabaseAdmin()
    const p = await getPedidoInterno(pedidoId, empresaId)
    if (!p || (ctx.alcance === "propios" && p.vendedor_id !== ctx.vendedorId)) return { success: false, error: "No encontrado" }
    await asegurarClienteVisible(ctx, p.cliente_id)
    const v = puedeEditar(p)
    if (!v.ok) return { success: false, error: v.motivo }

    const cab: Record<string, unknown> = {}
    for (const k of ["bodega_id", "forma_pago", "dias_credito", "fecha_programada", "orden_compra", "observaciones"] as const) {
      if (k in cambios) cab[k] = cambios[k]
    }
    if (cab.bodega_id) {
      const { data: b } = await db.from("bodegas").select("clienteid").eq("idbodega", cab.bodega_id as number).maybeSingle()
      if (!b || b.clienteid !== p.cliente_id) return { success: false, error: "Esa sucursal no es del cliente" }
    }

    if (cambios.lineas || "idempresa_despacho" in cambios) {
      const { data: cli } = await db.from("clientes").select("lista_precio_id").eq("id", p.cliente_id).maybeSingle()
      const lineas = cambios.lineas ?? (p.lineas ?? []).map((l) => ({
        producto_id: l.producto_id as number, cantidad: l.cantidad, precio_unitario: l.precio_unitario,
      }))
      const prep = await prepararDocumento(empresaId, {
        cliente_id: p.cliente_id,
        idempresa_despacho: cambios.idempresa_despacho ?? p.idempresa_despacho ?? null,
        lista_precio_id: (cli?.lista_precio_id as number | null) ?? null,
        lineas,
      })
      if (!prep.ok) return { success: false, error: prep.error }
      const d = prep.data
      Object.assign(cab, {
        owner_id: d.ownerId, idempresa_despacho: d.idempresaDespacho,
        subtotal: d.totales.subtotal, descuento_valor: d.totales.descuento, iva_pct: d.ivaPct,
        iva_valor: d.totales.impuesto, total: d.totales.total, peso_total: d.totales.peso,
      })
      const { error: eDel } = await db.from("crm_pedido_detalle").delete().eq("pedido_id", pedidoId)
      if (eDel) return { success: false, error: eDel.message }
      const { error: eIns } = await db.from("crm_pedido_detalle").insert(filasDetalle(empresaId, "pedido_id", pedidoId, d.lineas))
      if (eIns) return { success: false, error: `No se guardaron las líneas: ${eIns.message}. Vuelve a guardar el pedido.` }
    }

    if (Object.keys(cab).length) {
      const { error } = await db.from("crm_pedidos").update(cab).eq("id", pedidoId).in("estado", ["borrador", "rechazado"])
      if (error) return { success: false, error: error.message }
    }
    await registrarEvento({
      empresaId, entidad: "pedido", entidadId: pedidoId, tipo: "editado",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      datos: { campos: Object.keys(cab), lineas: cambios.lineas?.length ?? null },
    })
    const act = await getPedidoInterno(pedidoId, empresaId)
    return { success: true, data: act! }
  } catch (err) {
    return fallo(err)
  }
}

// ================================================= SOLICITAR APROBACION

export interface ResultadoSolicitud {
  pedido: Pedido
  credito: ResultadoCredito
  cuenta: CuentaCliente
}

/**
 * Envia un borrador (o un rechazado ya corregido) a aprobacion (PED-18, PED-21).
 *
 * Aqui se evalua el credito DE VERDAD, en el servidor y con la cartera de este
 * momento. Si hay sobrecupo, el pedido sale igual, marcado con el valor exacto
 * (PED-04); solo se detiene si el cliente esta bloqueado o si la configuracion
 * pide bloquear por cupo.
 */
export async function solicitarAprobacion(pedidoId: number, empresaId = 1): Promise<ActionResult<ResultadoSolicitud>> {
  try {
    const ctx = await exigirPermiso("solicitarAprobacion", "crm_pedidos")
    const db = await getSupabaseAdmin()
    const p = await getPedidoInterno(pedidoId, empresaId)
    if (!p || (ctx.alcance === "propios" && p.vendedor_id !== ctx.vendedorId)) return { success: false, error: "No encontrado" }
    await asegurarClienteVisible(ctx, p.cliente_id)

    const v = puedeSolicitar(p)
    if (!v.ok) return { success: false, error: v.motivo }
    if (!p.lineas?.length) return { success: false, error: "El pedido no tiene productos" }
    if (!p.bodega_id) return { success: false, error: "Elige la sucursal de entrega (PED-05)" }
    if (!p.owner_id) return { success: false, error: "El pedido no tiene owner: vuelve a guardar sus productos" }

    const { cuenta, evaluacion } = await evaluarCreditoCliente(empresaId, p.cliente_id, p.forma_pago, Number(p.total))
    if (!evaluacion.permitido) {
      return { success: false, error: `No se puede enviar: ${evaluacion.motivos.join(". ")}` }
    }

    const reenvio = p.estado === "rechazado"
    const ahora = new Date().toISOString()
    const { data, error } = await db
      .from("crm_pedidos")
      .update({
        estado: "pendiente_cartera",
        solicitado_por: ctx.userId,
        solicitado_nombre: ctx.nombre,
        solicitado_en: ahora,
        requiere_sobrecupo: evaluacion.requiereSobrecupo,
        sobrecupo_valor: evaluacion.sobrecupoValor,
        cupo_snapshot: cuenta.cupo,
        saldo_snapshot: cuenta.saldo,
        vencido_snapshot: cuenta.vencido,
        dias_mora_snapshot: cuenta.diasMora,
        version: reenvio ? (p.version ?? 1) + 1 : p.version ?? 1,
        // Un reenvio empieza de cero: las firmas anteriores aprobaron OTRO
        // pedido, el que se rechazo.
        auth_contabilidad_por: null, auth_contabilidad_nombre: null, auth_contabilidad_en: null, auth_contabilidad_nota: null,
        auth_gerencia_por: null, auth_gerencia_nombre: null, auth_gerencia_en: null, auth_gerencia_nota: null,
        error_lipgo: null,
      })
      .eq("id", pedidoId)
      .in("estado", ["borrador", "rechazado"])
      .select()
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "El pedido cambió mientras lo enviabas. Recarga la pantalla." }

    await registrarEvento({
      empresaId, entidad: "pedido", entidadId: pedidoId, tipo: reenvio ? "reenviado" : "solicitado",
      estadoDesde: p.estado, estadoHasta: "pendiente_cartera",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      nota: evaluacion.motivos.length ? evaluacion.motivos.join(". ") : null,
      datos: {
        total: p.total, sobrecupo: evaluacion.sobrecupoValor, version: data.version,
        cupo: cuenta.cupo, saldo: cuenta.saldo, vencido: cuenta.vencido, dias_mora: cuenta.diasMora,
      },
    })
    return { success: true, data: { pedido: data as Pedido, credito: evaluacion, cuenta } }
  } catch (err) {
    return fallo(err)
  }
}

export async function anularPedido(pedidoId: number, motivo: string, empresaId = 1): Promise<ActionResult> {
  try {
    const ctx = await exigirPermiso("anularPedido", "crm_pedidos", "crm_autorizar_contabilidad", "crm_autorizar_gerencia")
    if (!motivo?.trim()) return { success: false, error: "Indica por qué se anula" }
    const db = await getSupabaseAdmin()
    const p = await getPedidoInterno(pedidoId, empresaId)
    if (!p || (ctx.alcance === "propios" && p.vendedor_id !== ctx.vendedorId)) return { success: false, error: "No encontrado" }
    const v = puedeAnular(p)
    if (!v.ok) return { success: false, error: v.motivo }
    const { data } = await db.from("crm_pedidos").update({ estado: "anulado", observaciones: `${p.observaciones ?? ""} [Anulado: ${motivo.trim()}]`.trim() })
      .eq("id", pedidoId).is("idpedido_lipgo", null).not("estado", "in", "(aprobado,programado_lipgo,anulado)").select("id")
    if (!data?.length) return { success: false, error: "El pedido cambió de estado. Recarga la pantalla." }
    await registrarEvento({
      empresaId, entidad: "pedido", entidadId: pedidoId, tipo: "anulado",
      estadoDesde: p.estado, estadoHasta: "anulado", usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: motivo.trim(),
    })
    return { success: true }
  } catch (err) {
    return fallo(err)
  }
}

// ============================================================= APROBACIONES

/**
 * Da una de las dos aprobaciones.
 *
 * CONTROLES, en orden:
 *   1. PERMISO del rol, leido de la sesion. Se exige aunque seguridad.modo
 *      este en "log": aprobar sin permiso nunca estuvo permitido.
 *   2. REGLAS del ciclo: estado pendiente, orden Cartera → Gerencia (si el
 *      modo es secuencial), la misma persona no da las dos, quien creo o envio
 *      el pedido no lo aprueba.
 *   3. CLAVE del rol (compartida por el area, en un parametro secreto).
 * El UPDATE es condicional: dos aprobaciones simultaneas no producen dos firmas.
 */
export async function autorizarPedido(
  pedidoId: number,
  rol: RolAutorizacion,
  clave: string,
  nota?: string,
  empresaId = 1,
): Promise<ActionResult<Pedido & { lipgo?: { ok: boolean; mensaje: string } }>> {
  try {
    const ctx = await exigirPermiso("autorizarPedido", PERMISO_POR_ROL[rol])
    if (!tienePermiso(ctx, PERMISO_POR_ROL[rol])) {
      return { success: false, error: `No tienes permiso para aprobar como ${ROL_ETIQUETA[rol]}` }
    }
    const db = await getSupabaseAdmin()
    const p = await getPedidoInterno(pedidoId, empresaId)
    if (!p) return { success: false, error: "El pedido no existe" }

    const modo = await modoAprobacion(empresaId)
    const v = puedeFirmar(p, rol, ctx.userId, ctx.nombre, modo)
    if (!v.ok) return { success: false, error: v.motivo }

    const claveEsperada = await leerParam(rol === "contabilidad" ? PARAM.CLAVE_CONTABILIDAD : PARAM.CLAVE_GERENCIA, empresaId)
    if (!claveEsperada || claveEsperada === VALOR_SECRETO_DE_FABRICA) {
      return { success: false, error: `La clave de ${ROL_ETIQUETA[rol]} no está configurada. Cámbiala en Parametrización.` }
    }
    if (clave !== claveEsperada) {
      // El intento fallido queda registrado: si alguien prueba claves, se ve.
      await db.from("crm_autorizaciones_log").insert({
        idempresa: empresaId, pedido_id: pedidoId, rol, accion: "intento_fallido",
        usuario_id: ctx.userId, usuario_nombre: ctx.nombre, total_al_momento: p.total,
      })
      await registrarEvento({
        empresaId, entidad: "pedido", entidadId: pedidoId, tipo: "clave_incorrecta",
        usuarioId: ctx.userId, usuarioNombre: ctx.nombre, datos: { rol },
      })
      return { success: false, error: "Clave incorrecta" }
    }

    const ahora = new Date().toISOString()
    const nuevoEstado = estadoTrasFirma(p, rol)
    const campos = rol === "contabilidad"
      ? { auth_contabilidad_por: ctx.userId, auth_contabilidad_nombre: ctx.nombre, auth_contabilidad_en: ahora, auth_contabilidad_nota: nota ?? null }
      : { auth_gerencia_por: ctx.userId, auth_gerencia_nombre: ctx.nombre, auth_gerencia_en: ahora, auth_gerencia_nota: nota ?? null }

    const { data, error } = await db
      .from("crm_pedidos")
      .update({ ...campos, estado: nuevoEstado })
      .eq("id", pedidoId)
      .eq("estado", p.estado)
      .is(rol === "contabilidad" ? "auth_contabilidad_en" : "auth_gerencia_en", null)
      .select()
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "Otra persona aprobó o cambió este pedido al mismo tiempo. Recarga la pantalla." }

    await db.from("crm_autorizaciones_log").insert({
      idempresa: empresaId, pedido_id: pedidoId, rol, accion: "autorizar",
      usuario_id: ctx.userId, usuario_nombre: ctx.nombre, nota: nota ?? null, total_al_momento: p.total,
    })
    await registrarEvento({
      empresaId, entidad: "pedido", entidadId: pedidoId, tipo: "firmado",
      estadoDesde: p.estado, estadoHasta: nuevoEstado, usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      nota: nota ?? null, datos: { rol, rol_etiqueta: ROL_ETIQUETA[rol] },
    })

    let lipgo: { ok: boolean; mensaje: string } | undefined
    if (nuevoEstado === "aprobado") lipgo = await trasAprobacion(pedidoId, empresaId, ctx)

    return { success: true, data: { ...(data as Pedido), lipgo } }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Lo que pasa al completarse las dos aprobaciones (PED-23, PED-25). Cada paso
 * es independiente: si LIPgo falla, SAP y el aviso igual quedan en la bandeja.
 */
async function trasAprobacion(pedidoId: number, empresaId: number, ctx: ContextoCrm): Promise<{ ok: boolean; mensaje: string }> {
  const db = await getSupabaseAdmin()
  let resultado = { ok: true, mensaje: "Aprobado. Quedó pendiente de programar en LIPgo." }

  if (await leerParamBool(PARAM.PEDIDO_PROYECTAR_AL_APROBAR, empresaId)) {
    resultado = await proyectar(pedidoId, empresaId, ctx)
  }

  const p = await getPedidoInterno(pedidoId, empresaId)
  if (!p) return resultado
  const { data: owner } = p.owner_id
    ? await db.from("crm_owners").select("codigo, nombre, envia_sap").eq("id", p.owner_id).maybeSingle()
    : { data: null }

  // SAP: solo owners que facturan por SAP. Molinos no se encola nunca.
  if (owner?.envia_sap) {
    const r = await encolarSap({
      empresaId, flujo: "pedidos", entidad: "pedido", entidadId: pedidoId, operacion: "crear_pedido",
      version: p.version ?? 1, ownerEnviaSap: true, creadoPor: ctx.nombre,
      // PED-13: el precio que viaja es el aprobado de cada linea, no el de lista.
      payload: {
        pedido: {
          numero: p.numero, cliente_id: p.cliente_id, cliente: p.cliente_nombre, fecha: p.fecha,
          fecha_programada: p.fecha_programada, forma_pago: p.forma_pago, dias_credito: p.dias_credito,
          total: p.total, idpedido_lipgo: p.idpedido_lipgo, owner: owner.codigo,
          // Ids que el traductor convierte a codigos SAP al enviar (Mapeos SAP).
          sucursal_id: p.bodega_id, vendedor_id: p.vendedor_id, centro_id: p.idempresa_despacho ?? null,
        },
        lineas: (p.lineas ?? []).map((l) => ({
          producto_id: l.producto_id, producto: l.producto_nombre, cantidad: l.cantidad,
          precio_unitario: l.precio_unitario, impuesto_id: l.impuesto_id ?? null, impuesto_pct: l.impuesto_pct,
          impuesto_valor: l.impuesto_valor,
        })),
      },
    })
    if (r.ok) await db.from("crm_pedidos").update({ sap_estado: "pendiente" }).eq("id", pedidoId)
  }

  // Avisos por WhatsApp a los destinatarios del evento (Jefferson y otros).
  const { data: dest } = await db.from("crm_notificacion_destinatarios")
    .select("nombre, celular, owner_id").eq("idempresa", empresaId).eq("evento", "pedido_aprobado").eq("activo", true)
  for (const d of dest ?? []) {
    if (d.owner_id && d.owner_id !== p.owner_id) continue
    await encolarAviso({
      empresaId, evento: "pedido_aprobado", entidad: "pedido", entidadId: pedidoId, creadoPor: ctx.nombre,
      aviso: {
        celular: d.celular,
        titulo: `Pedido aprobado ${p.numero ?? ""}`.trim(),
        destinatario: String(d.nombre).split(" ")[0],
        contenido: [
          `Cliente: ${p.cliente_nombre ?? p.cliente_id}`,
          p.sucursal_nombre ? `Sucursal: ${p.sucursal_nombre}` : null,
          `Total: ${cop(p.total)}`,
          owner ? `Owner: ${owner.nombre}` : null,
          p.idpedido_lipgo ? `LIPgo #${p.idpedido_lipgo}, listo para orden de cargue` : "Pendiente de programar en LIPgo",
        ].filter(Boolean).join(" · "),
      },
    })
  }
  return resultado
}

/** Llama al RPC de proyeccion y deja constancia del resultado. */
async function proyectar(pedidoId: number, empresaId: number, ctx: ContextoCrm): Promise<{ ok: boolean; mensaje: string }> {
  const db = await getSupabaseAdmin()
  const { data, error } = await db.rpc("crm_proyectar_pedido_lipgo", { p_pedido_id: pedidoId, p_usuario_id: ctx.userId })
  const r = data as { ok: boolean; error?: string; idpedido?: number; mensaje?: string; productos_faltantes?: string[] } | null
  if (error || !r?.ok) {
    const msg = error?.message ?? `${r?.error ?? "No se pudo programar en LIPgo"}${r?.productos_faltantes?.length ? ` (${r.productos_faltantes.join(", ")})` : ""}`
    await db.from("crm_pedidos").update({ error_lipgo: msg }).eq("id", pedidoId)
    await registrarEvento({
      empresaId, entidad: "pedido", entidadId: pedidoId, tipo: "error_lipgo",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: msg,
    })
    return { ok: false, mensaje: msg }
  }
  await registrarEvento({
    empresaId, entidad: "pedido", entidadId: pedidoId, tipo: "programado_lipgo",
    estadoDesde: "aprobado", estadoHasta: "programado_lipgo", usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
    nota: r.mensaje ?? null, datos: { idpedido_lipgo: r.idpedido },
  })
  return { ok: true, mensaje: r.mensaje ?? `Programado en LIPgo como ${r.idpedido}` }
}

/**
 * Rechaza el pedido con motivo del maestro (PED-20). Rechazar NO pide clave:
 * frenar algo dudoso debe ser mas facil que aprobarlo.
 */
export async function rechazarPedido(
  pedidoId: number,
  rol: RolAutorizacion,
  motivo: string,
  empresaId = 1,
  motivoId?: number | null,
): Promise<ActionResult<Pedido>> {
  try {
    const ctx = await exigirPermiso("rechazarPedido", PERMISO_POR_ROL[rol])
    if (!tienePermiso(ctx, PERMISO_POR_ROL[rol])) {
      return { success: false, error: `No tienes permiso para rechazar como ${ROL_ETIQUETA[rol]}` }
    }
    const db = await getSupabaseAdmin()
    const p = await getPedidoInterno(pedidoId, empresaId)
    if (!p) return { success: false, error: "El pedido no existe" }
    const v = puedeRechazar(p)
    if (!v.ok) return { success: false, error: v.motivo }

    let textoMotivo = motivo?.trim() ?? ""
    if (motivoId) {
      const { data: m } = await db.from("crm_motivos").select("nombre, exige_nota, tipo").eq("id", motivoId).maybeSingle()
      if (!m || m.tipo !== "rechazo_pedido") return { success: false, error: "Motivo no válido" }
      if (m.exige_nota && !textoMotivo) return { success: false, error: `"${m.nombre}" exige una explicación` }
      textoMotivo = textoMotivo ? `${m.nombre}: ${textoMotivo}` : m.nombre
    }
    if (!textoMotivo) return { success: false, error: "Indica el motivo del rechazo" }

    const { data, error } = await db
      .from("crm_pedidos")
      .update({
        estado: "rechazado", rechazado_por: ctx.userId, rechazado_nombre: ctx.nombre,
        rechazado_en: new Date().toISOString(), motivo_rechazo: textoMotivo, motivo_rechazo_id: motivoId ?? null,
      })
      .eq("id", pedidoId)
      .eq("estado", p.estado)
      .is("idpedido_lipgo", null)
      .select()
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "El pedido cambió mientras lo rechazabas. Recarga la pantalla." }

    await db.from("crm_autorizaciones_log").insert({
      idempresa: empresaId, pedido_id: pedidoId, rol, accion: "rechazar",
      usuario_id: ctx.userId, usuario_nombre: ctx.nombre, nota: textoMotivo, total_al_momento: p.total,
    })
    await registrarEvento({
      empresaId, entidad: "pedido", entidadId: pedidoId, tipo: "rechazado",
      estadoDesde: p.estado, estadoHasta: "rechazado", usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      nota: textoMotivo, datos: { rol, rol_etiqueta: ROL_ETIQUETA[rol], motivo_id: motivoId ?? null },
    })
    return { success: true, data: data as Pedido }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Programa en LIPgo un pedido aprobado que no pudo programarse solo (por
 * ejemplo, un producto que no existia en el centro). Reintento manual.
 */
export async function enviarPedidoALipgo(
  pedidoId: number,
  empresaId = 1,
): Promise<ActionResult<{ idpedido: number; lineas: number; mensaje: string }>> {
  try {
    const ctx = await exigirPermiso("enviarPedidoALipgo", ...VER)
    const p = await getPedidoInterno(pedidoId, empresaId)
    if (!p) return { success: false, error: "El pedido no existe" }
    await asegurarClienteVisible(ctx, p.cliente_id)
    if (p.idpedido_lipgo) return { success: false, error: `Ya está en LIPgo como pedido ${p.idpedido_lipgo}` }
    if (p.estado !== "aprobado" && p.estado !== "autorizado") {
      return { success: false, error: `Solo se programa un pedido aprobado (este está ${ESTADO_LABEL[p.estado].toLowerCase()})` }
    }
    const r = await proyectar(pedidoId, empresaId, ctx)
    if (!r.ok) return { success: false, error: r.mensaje }
    const act = await getPedidoInterno(pedidoId, empresaId)
    return { success: true, data: { idpedido: act?.idpedido_lipgo ?? 0, lineas: act?.lineas?.length ?? 0, mensaje: r.mensaje } }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Bandeja de aprobacion: pedidos que ESTE usuario puede aprobar ahora. En
 * modo secuencial, Gerencia solo ve lo que Cartera ya aprobo.
 */
export async function getPedidosPendientesDeMiFirma(
  empresaId = 1,
): Promise<ActionResult<{ pedidos: PedidoConDetalle[]; roles: RolAutorizacion[]; modo: ModoAprobacion }>> {
  try {
    const ctx = await exigirPermiso("getPedidosPendientesDeMiFirma", "crm_autorizar_contabilidad", "crm_autorizar_gerencia")
    const roles: RolAutorizacion[] = []
    if (tienePermiso(ctx, "crm_autorizar_contabilidad")) roles.push("contabilidad")
    if (tienePermiso(ctx, "crm_autorizar_gerencia")) roles.push("gerencia")
    const modo = await modoAprobacion(empresaId)
    if (!roles.length) return { success: true, data: { pedidos: [], roles, modo } }

    // Sin filtro de vendedor: quien aprueba, aprueba pedidos de todos.
    const db = await getSupabaseAdmin()
    const { data } = await db.from("crm_pedidos").select("*").eq("idempresa", empresaId)
      .in("estado", ["pendiente_cartera", "pendiente_gerencia"]).order("solicitado_en", { ascending: true }).limit(200)
    const pendientes = ((data ?? []) as Pedido[]).filter((p) =>
      rolesQueFaltan(p, modo).some((r) => roles.includes(r) && puedeFirmar(p, r, ctx.userId, ctx.nombre, modo).ok),
    )
    const conN = await conNombres(pendientes)
    const { data: det } = pendientes.length
      ? await db.from("crm_pedido_detalle").select("*").in("pedido_id", pendientes.map((p) => p.id)).order("linea")
      : { data: [] }
    const porPedido = new Map<number, LineaPedido[]>()
    for (const l of (det ?? []) as LineaPedido[]) {
      const k = l.pedido_id as number
      porPedido.set(k, [...(porPedido.get(k) ?? []), l])
    }
    return {
      success: true,
      data: { pedidos: conN.map((p) => ({ ...p, lineas: porPedido.get(p.id) ?? [] })), roles, modo },
    }
  } catch (err) {
    return fallo(err)
  }
}

