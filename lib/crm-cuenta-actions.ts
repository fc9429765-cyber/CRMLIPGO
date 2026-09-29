"use server"

// Cuenta 360 del cliente (CTA-01..04) y su catalogo personalizado (PED-07).

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { asegurarClienteVisible, exigirPermiso, mensajeError } from "@/lib/crm-auth"
import { registrarEvento } from "@/lib/crm-eventos"
import { calcularCuenta, type CuentaCliente } from "@/lib/crm-cuenta"
import { hoyISO } from "@/lib/crm-fechas"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface FacturaCuenta {
  id: number
  numero_factura: string | null
  pedido_numero: string | null
  tipo_documento: string
  origen: string
  owner_id: number | null
  fecha_factura: string
  fecha_vencimiento: string
  valor_original: number
  valor_abonado: number
  saldo: number
  estado: string
}

export interface PagoCuenta {
  id: number
  cuenta_cobrar_id: number
  numero_factura: string | null
  fecha_pago: string
  valor: number
  medio_pago: string | null
  referencia: string | null
  /** recaudo, descuento, ajuste, legacy (script 202). */
  tipo: string
  recaudo_id: number | null
  anulado: boolean
}

export interface Cuenta360 {
  cliente: {
    id: number
    nombre: string
    documento: string | null
    cupo_credito: number
    dias_credito: number
    bloqueado_cartera: boolean
    vendedor_asignado: number | null
    vendedor_nombre: string | null
  }
  /** Total del cliente. */
  cuenta: CuentaCliente
  /** La misma cuenta separada por owner: INDUPAN y Molinos cobran por separado. */
  porOwner: { ownerId: number | null; ownerNombre: string; cuenta: CuentaCliente }[]
  facturas: FacturaCuenta[]
  pagos: PagoCuenta[]
  sucursales: number
  calculadoEl: string
}

/** Permisos de quien puede mirar la cartera de un cliente. */
const VER_CUENTA = [
  "crm_clientes", "crm_cartera", "crm_pedidos", "crm_cotizaciones",
  "crm_recaudos_registrar", "crm_recaudos_aprobar",
  // Quien aprueba pedidos necesita la cartera actual del cliente: es el dato
  // con el que decide si acepta un sobrecupo.
  "crm_autorizar_contabilidad", "crm_autorizar_gerencia",
] as const

export async function getCuenta360(clienteId: number, empresaId = 1): Promise<ActionResult<Cuenta360>> {
  try {
    const ctx = await exigirPermiso("getCuenta360", ...VER_CUENTA)
    await asegurarClienteVisible(ctx, clienteId)
    const supabase = await getSupabaseAdmin()

    const [cli, cuentas, owners, sucursales] = await Promise.all([
      supabase
        .from("clientes")
        .select("id, nombre, documento, cupo_credito, dias_credito, bloqueado_cartera, vendedor_asignado")
        .eq("id", clienteId)
        .maybeSingle(),
      supabase
        .from("crm_cuentas_cobrar")
        .select("*")
        .eq("idempresa", empresaId)
        .eq("cliente_id", clienteId)
        .order("fecha_vencimiento"),
      supabase.from("crm_owners").select("id, nombre").eq("idempresa", empresaId),
      supabase.from("bodegas").select("idbodega", { count: "exact", head: true }).eq("clienteid", clienteId),
    ])

    if (!cli.data) return { success: false, error: "El cliente no existe" }
    if (cuentas.error) return { success: false, error: cuentas.error.message }

    const filas = cuentas.data ?? []
    const idsCuentas = filas.map((c) => c.id as number)
    const idsPedidos = [...new Set(filas.map((c) => c.pedido_id).filter(Boolean))] as number[]

    const [pagos, pedidos, vendedor, favor] = await Promise.all([
      idsCuentas.length
        ? supabase
            .from("crm_pagos")
            .select("id, cuenta_cobrar_id, fecha_pago, valor, medio_pago, referencia, tipo, recaudo_id, anulado_en")
            .in("cuenta_cobrar_id", idsCuentas)
            .order("fecha_pago", { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      idsPedidos.length
        ? supabase.from("crm_pedidos").select("id, numero").in("id", idsPedidos)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      cli.data.vendedor_asignado
        ? supabase.from("vendedores").select("nombre").eq("idvendedor", cli.data.vendedor_asignado).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("crm_saldos_favor").select("saldo").eq("idempresa", empresaId).eq("cliente_id", clienteId).is("anulado_en", null),
    ])
    const saldoFavor = (favor.data ?? []).reduce((s, f) => s + Number(f.saldo), 0)

    const numeroPedido = new Map((pedidos.data ?? []).map((p) => [p.id as number, p.numero as string]))
    const numeroFactura = new Map(filas.map((c) => [c.id as number, (c.numero_factura as string) ?? null]))
    const hoy = hoyISO()
    const cupo = Number(cli.data.cupo_credito) || 0

    const facturas: FacturaCuenta[] = filas.map((c) => ({
      id: c.id,
      numero_factura: c.numero_factura ?? null,
      pedido_numero: c.pedido_id ? numeroPedido.get(c.pedido_id) ?? null : null,
      tipo_documento: c.tipo_documento ?? "factura",
      origen: c.origen ?? "pedido",
      owner_id: c.owner_id ?? null,
      fecha_factura: c.fecha_factura,
      fecha_vencimiento: c.fecha_vencimiento,
      valor_original: Number(c.valor_original) || 0,
      valor_abonado: Number(c.valor_abonado) || 0,
      saldo: Number(c.saldo) || 0,
      estado: c.estado,
    }))

    // El cupo es del cliente, no del owner: el desglose por owner muestra
    // saldo y vencido de cada uno, y el disponible se lee en el total.
    const nombresOwner = new Map((owners.data ?? []).map((o) => [o.id as number, o.nombre as string]))
    const idsOwner = [...new Set(facturas.map((f) => f.owner_id))]
    const porOwner = idsOwner.map((ownerId) => ({
      ownerId,
      ownerNombre: ownerId == null ? "Sin owner" : nombresOwner.get(ownerId) ?? `Owner ${ownerId}`,
      cuenta: calcularCuenta(facturas.filter((f) => f.owner_id === ownerId), 0, hoy),
    }))

    return {
      success: true,
      data: {
        cliente: {
          id: cli.data.id,
          nombre: cli.data.nombre,
          documento: cli.data.documento != null ? String(cli.data.documento) : null,
          cupo_credito: cupo,
          dias_credito: Number(cli.data.dias_credito) || 0,
          bloqueado_cartera: cli.data.bloqueado_cartera === true,
          vendedor_asignado: cli.data.vendedor_asignado ?? null,
          vendedor_nombre: (vendedor.data as { nombre?: string } | null)?.nombre ?? null,
        },
        cuenta: calcularCuenta(facturas, cupo, hoy, saldoFavor),
        porOwner,
        facturas,
        pagos: (pagos.data ?? []).map((p) => ({
          id: p.id as number,
          cuenta_cobrar_id: p.cuenta_cobrar_id as number,
          numero_factura: numeroFactura.get(p.cuenta_cobrar_id as number) ?? null,
          fecha_pago: p.fecha_pago as string,
          valor: Number(p.valor) || 0,
          medio_pago: (p.medio_pago as string) ?? null,
          referencia: (p.referencia as string) ?? null,
          tipo: (p.tipo as string) ?? "legacy",
          recaudo_id: (p.recaudo_id as number) ?? null,
          anulado: p.anulado_en != null,
        })),
        sucursales: sucursales.count ?? 0,
        calculadoEl: new Date().toISOString(),
      },
    }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

// ------------------------------------------------------------------ catalogo

/** Ids de los productos del catalogo de un cliente. Vacio = sin catalogo. */
export async function getCatalogoCliente(clienteId: number, empresaId = 1): Promise<ActionResult<number[]>> {
  try {
    const ctx = await exigirPermiso("getCatalogoCliente", "crm_clientes", "crm_pedidos", "crm_cotizaciones")
    await asegurarClienteVisible(ctx, clienteId)
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("crm_catalogo_cliente")
      .select("producto_id")
      .eq("idempresa", empresaId)
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .order("orden")
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []).map((f) => f.producto_id as number) }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

/**
 * Reemplaza el catalogo del cliente por esta lista de productos.
 *
 * Lo administra quien gestiona listas de precios o maestros, no el vendedor
 * (PED-07): el catalogo limita lo que se le puede vender al cliente, y un
 * vendedor que se amplia su propio catalogo anula el control.
 */
export async function guardarCatalogoCliente(
  clienteId: number,
  productoIds: number[],
  empresaId = 1,
): Promise<ActionResult<{ agregados: number; retirados: number }>> {
  try {
    const ctx = await exigirPermiso("guardarCatalogoCliente", "crm_listas_precios", "crm_maestros_admin")
    const supabase = await getSupabaseAdmin()

    const { data: actuales } = await supabase
      .from("crm_catalogo_cliente")
      .select("producto_id, activo")
      .eq("idempresa", empresaId)
      .eq("cliente_id", clienteId)

    const nuevos = new Set(productoIds)
    const activosAntes = new Set((actuales ?? []).filter((f) => f.activo).map((f) => f.producto_id as number))

    // Se desactiva en vez de borrar: queda constancia de que el producto
    // estuvo en el catalogo y de quien lo retiro.
    const retirar = [...activosAntes].filter((id) => !nuevos.has(id))
    if (retirar.length) {
      const { error } = await supabase
        .from("crm_catalogo_cliente")
        .update({ activo: false })
        .eq("idempresa", empresaId)
        .eq("cliente_id", clienteId)
        .in("producto_id", retirar)
      if (error) return { success: false, error: error.message }
    }

    if (productoIds.length) {
      const { error } = await supabase.from("crm_catalogo_cliente").upsert(
        productoIds.map((producto_id, orden) => ({
          idempresa: empresaId, cliente_id: clienteId, producto_id, orden, activo: true, creado_por: ctx.nombre,
        })),
        { onConflict: "idempresa,cliente_id,producto_id" },
      )
      if (error) return { success: false, error: error.message }
    }

    const agregados = productoIds.filter((id) => !activosAntes.has(id)).length
    await registrarEvento({
      empresaId, entidad: "catalogo", entidadId: clienteId, tipo: "editado",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      datos: { agregados, retirados: retirar.length, total: productoIds.length },
    })
    return { success: true, data: { agregados, retirados: retirar.length } }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}
