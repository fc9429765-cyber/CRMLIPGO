// Preparacion y validacion de documentos de venta (cotizaciones y pedidos).
//
// SIN "use server": solo lo usan acciones del servidor. Es el UNICO lugar
// donde se arman las lineas de un documento, para que crear una cotizacion,
// crear un pedido y editar un pedido rechazado apliquen exactamente las mismas
// reglas (RNF-05: todo se calcula en el servidor; lo que manda el navegador
// son solo intenciones: producto, cantidad, precio).
//
// REGLAS:
//   - PED-17: un documento pertenece a UN owner.
//   - Centro de despacho: debe ser uno de los del owner, y cada producto debe
//     existir POR NOMBRE en ese centro, que es como LIPgo lo busca al armar la
//     orden de cargue.
//   - PED-08: si el cliente tiene catalogo, solo se venden esos productos; si
//     no tiene y `catalogo.modo = restringido`, no se le puede vender.
//   - PED-11: impuesto con la tarifa de cada producto.
//   - PED-10 / PED-14: el precio lo pone el vendedor (precio personalizado); el
//     precio de lista lo resuelve el servidor, y el descuento frente a la
//     lista es solo informativo.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { leerParam, leerParamBool, leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { resolverOwner, ownerDelPedido, type CrmOwner } from "@/lib/crm-owners"
import { calcularDocumento, calcularLineaDocumento, tarifaEfectiva, type TotalesDocumento } from "@/lib/crm-calculos"
import { calcularCuenta, type CuentaCliente } from "@/lib/crm-cuenta"
import { evaluarCredito, type ModoCupo, type ResultadoCredito } from "@/lib/crm-credito"
import { hoyISO } from "@/lib/crm-fechas"

type DB = Awaited<ReturnType<typeof getSupabaseAdminAsSystem>>

/** Lo que manda el formulario por cada linea. Nada de totales: esos se calculan. */
export interface LineaEntrada {
  producto_id: number
  cantidad: number
  precio_unitario: number
}

export interface EntradaDocumento {
  cliente_id: number | null
  /** Solo cotizaciones a prospectos: sin cliente no hay catalogo ni sucursal. */
  prospecto_id?: number | null
  idempresa_despacho?: number | null
  lista_precio_id?: number | null
  lineas: LineaEntrada[]
}

export interface LineaPreparada {
  linea: number
  producto_id: number
  producto_nombre: string
  categoria: string | null
  unidad: string | null
  cantidad: number
  precio_lista: number | null
  precio_unitario: number
  descuento_pct: number
  descuento_valor: number
  subtotal: number
  total_linea: number
  peso: number
  impuesto_id: number | null
  impuesto_pct: number
  base_impuesto: number
  impuesto_valor: number
}

export interface DocumentoPreparado {
  ownerId: number
  owner: Pick<CrmOwner, "id" | "codigo" | "nombre" | "envia_sap">
  idempresaDespacho: number
  lineas: LineaPreparada[]
  totales: TotalesDocumento
  /** Columnas heredadas del encabezado (iva_pct / iva_valor). */
  ivaPct: number
  /** Alguna linea cede frente a la lista mas que el tope del vendedor. */
  excedeTopeDescuento: boolean
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

const norm = (t: unknown) => String(t ?? "").trim().toUpperCase()

export async function prepararDocumento(
  empresaId: number,
  entrada: EntradaDocumento,
): Promise<Resultado<DocumentoPreparado>> {
  const db = await getSupabaseAdminAsSystem()

  const lineas = (entrada.lineas ?? []).filter((l) => l && Number(l.cantidad) > 0)
  if (!lineas.length) return { ok: false, error: "Agrega al menos un producto con cantidad" }
  const sinPrecio = lineas.find((l) => !(Number(l.precio_unitario) > 0))
  if (sinPrecio) return { ok: false, error: "Hay líneas sin precio" }

  const ids = [...new Set(lineas.map((l) => Number(l.producto_id)))]
  const [prods, owners, impuestos, tope] = await Promise.all([
    db.from("productos").select("id, id_empresa, nombre, owner, categoria, und, peso_unitkg, precio_base, crm_impuesto_id").in("id", ids),
    db.from("crm_owners").select("*").eq("idempresa", empresaId),
    db.from("crm_impuestos").select("id, tarifa, es_default").eq("idempresa", empresaId),
    leerParamNumber(PARAM.DESCUENTO_MAXIMO_VENDEDOR, empresaId, 10),
  ])
  if (prods.error) return { ok: false, error: prods.error.message }
  const porId = new Map((prods.data ?? []).map((p) => [p.id as number, p]))
  const faltan = ids.filter((id) => !porId.has(id))
  if (faltan.length) return { ok: false, error: `Productos inexistentes: ${faltan.join(", ")}` }

  const listaOwners = (owners.data ?? []) as CrmOwner[]

  // --- Owner unico (PED-17) ------------------------------------------------
  const ownerIds = ids.map((id) => {
    const p = porId.get(id)!
    return resolverOwner({ owner: p.owner as string | null, id_empresa: p.id_empresa as number }, listaOwners)
  })
  const unico = ownerDelPedido(ownerIds)
  if (!unico.ok) return { ok: false, error: unico.error }
  const owner = listaOwners.find((o) => o.id === unico.ownerId)!
  if (!owner.activo) return { ok: false, error: `El owner ${owner.nombre} está inactivo` }

  // --- Centro de despacho ---------------------------------------------------
  const despachos = owner.idempresas_despacho?.length ? owner.idempresas_despacho : [owner.idempresa_lipgo]
  const despacho = entrada.idempresa_despacho ?? despachos[0]
  if (!despachos.includes(despacho)) {
    return { ok: false, error: `${owner.nombre} no despacha desde el centro ${despacho}. Centros válidos: ${despachos.join(", ")}` }
  }

  // Cada producto debe existir POR NOMBRE en el centro de despacho.
  const { data: enCentro } = await db.from("productos").select("nombre").eq("id_empresa", despacho)
  const nombresCentro = new Set((enCentro ?? []).map((p) => norm(p.nombre)))
  const noEstan = ids.map((id) => porId.get(id)!).filter((p) => !nombresCentro.has(norm(p.nombre)))
  if (noEstan.length) {
    return {
      ok: false,
      error: `No existen en el centro de despacho elegido: ${noEstan.map((p) => p.nombre).join(", ")}. Elige otro centro o quítalos.`,
    }
  }

  // --- Catalogo del cliente (PED-08) ---------------------------------------
  if (entrada.cliente_id) {
    const [{ data: cat }, modo] = await Promise.all([
      db.from("crm_catalogo_cliente").select("producto_id")
        .eq("idempresa", empresaId).eq("cliente_id", entrada.cliente_id).eq("activo", true),
      leerParam(PARAM.CATALOGO_MODO, empresaId),
    ])
    const permitidos = new Set((cat ?? []).map((c) => Number(c.producto_id)))
    if (permitidos.size) {
      const fuera = ids.filter((id) => !permitidos.has(id))
      if (fuera.length) {
        return { ok: false, error: `No están en el catálogo del cliente: ${fuera.map((id) => porId.get(id)!.nombre).join(", ")}` }
      }
    } else if (modo === "restringido") {
      return { ok: false, error: "El cliente no tiene catálogo asignado y la configuración no permite venderle sin él" }
    }
  }

  // --- Impuestos y precio de lista -------------------------------------------
  const tarifas = new Map((impuestos.data ?? []).map((i) => [i.id as number, Number(i.tarifa)]))
  const porDefecto = (impuestos.data ?? []).find((i) => i.es_default)
  const tarifaDefecto = porDefecto ? Number(porDefecto.tarifa) : await leerParamNumber(PARAM.IVA, empresaId, 5)

  const preciosLista = new Map<number, number | null>()
  await Promise.all(
    ids.map(async (id) => {
      const { data } = await db.rpc("crm_resolver_precio", {
        p_idempresa: empresaId, p_producto_id: id, p_lista_id: entrada.lista_precio_id ?? null,
      })
      const v = Number(data)
      preciosLista.set(id, Number.isFinite(v) && v > 0 ? v : (Number(porId.get(id)!.precio_base) || null))
    }),
  )

  const preparadas: LineaPreparada[] = lineas.map((l, i) => {
    const p = porId.get(Number(l.producto_id))!
    const impuestoId = (p.crm_impuesto_id as number | null) ?? null
    const tarifa = impuestoId != null ? tarifas.get(impuestoId) ?? tarifaDefecto : tarifaDefecto
    const cantidad = Number(l.cantidad)
    const precio = Number(l.precio_unitario)
    const lista = preciosLista.get(p.id as number) ?? null
    const c = calcularLineaDocumento({ cantidad, precio_unitario: precio, precio_lista: lista, impuesto_pct: tarifa })
    return {
      linea: i + 1,
      producto_id: p.id as number,
      producto_nombre: String(p.nombre),
      categoria: (p.categoria as string) ?? null,
      unidad: p.und != null ? String(p.und) : null,
      cantidad,
      precio_lista: lista,
      precio_unitario: precio,
      descuento_pct: c.descuento_pct,
      descuento_valor: c.descuento_valor,
      subtotal: c.subtotal,
      total_linea: c.total_linea,
      peso: Math.round(cantidad * (Number(p.peso_unitkg) || 0) * 1000) / 1000,
      impuesto_id: impuestoId,
      impuesto_pct: c.impuesto_pct,
      base_impuesto: c.base_impuesto,
      impuesto_valor: c.impuesto_valor,
    }
  })

  const totales = calcularDocumento(
    preparadas.map((l) => ({
      cantidad: l.cantidad, precio_unitario: l.precio_unitario, precio_lista: l.precio_lista,
      impuesto_pct: l.impuesto_pct, peso: l.peso,
    })),
  )

  return {
    ok: true,
    data: {
      ownerId: owner.id,
      owner: { id: owner.id, codigo: owner.codigo, nombre: owner.nombre, envia_sap: owner.envia_sap },
      idempresaDespacho: despacho,
      lineas: preparadas,
      totales,
      ivaPct: tarifaEfectiva(totales),
      excedeTopeDescuento: preparadas.some((l) => l.descuento_pct > tope),
    },
  }
}

/** Filas de detalle para insertar en crm_cotizacion_detalle o crm_pedido_detalle. */
export function filasDetalle(
  empresaId: number,
  columnaPadre: "cotizacion_id" | "pedido_id",
  padreId: number,
  lineas: LineaPreparada[],
) {
  return lineas.map((l) => ({ idempresa: empresaId, [columnaPadre]: padreId, ...l }))
}

// --------------------------------------------------------------- credito

export interface CreditoPedido {
  cuenta: CuentaCliente
  evaluacion: ResultadoCredito
}

/** Cartera del cliente + evaluacion del pedido contra su cupo (PED-03/04). */
export async function evaluarCreditoCliente(
  empresaId: number,
  clienteId: number,
  formaPago: "contado" | "credito",
  totalPedido: number,
): Promise<CreditoPedido> {
  const db = await getSupabaseAdminAsSystem()
  const [cli, cuentas, modo, bloquearMora, diasMora] = await Promise.all([
    db.from("clientes").select("cupo_credito, bloqueado_cartera").eq("id", clienteId).maybeSingle(),
    db.from("crm_cuentas_cobrar").select("saldo, fecha_vencimiento, estado").eq("idempresa", empresaId).eq("cliente_id", clienteId),
    leerParam(PARAM.CREDITO_MODO_CUPO, empresaId),
    leerParamBool(PARAM.CARTERA_BLOQUEAR_MORA, empresaId),
    leerParamNumber(PARAM.CARTERA_DIAS_MORA_BLOQUEO, empresaId, 15),
  ])
  const cupo = Number(cli.data?.cupo_credito) || 0
  const cuenta = calcularCuenta(
    (cuentas.data ?? []).map((c) => ({ saldo: Number(c.saldo), fecha_vencimiento: c.fecha_vencimiento, estado: c.estado })),
    cupo,
    hoyISO(),
  )
  const evaluacion = evaluarCredito({
    formaPago,
    cupo,
    saldo: cuenta.saldo,
    vencido: cuenta.vencido,
    diasMora: cuenta.diasMora,
    bloqueado: cli.data?.bloqueado_cartera === true,
    totalPedido,
    modo: (modo === "bloquear" ? "bloquear" : "sobrecupo") as ModoCupo,
    bloquearPorMora: bloquearMora,
    diasMoraBloqueo: diasMora,
  })
  return { cuenta, evaluacion }
}

export type { DB }
