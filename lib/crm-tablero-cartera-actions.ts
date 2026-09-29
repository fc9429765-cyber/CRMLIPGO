"use server"

// Tablero de cartera consolidado (DSH-02) y recaudo historico de un cliente
// (DSH-01).
//
// Las cifras salen de lib/crm-cartera-resumen.ts, que a su vez usa
// calcularCuenta: el tablero no puede decir de un cliente algo distinto de lo
// que dice su Cuenta 360.
//
// ALCANCE: un vendedor ve solo su cartera, igual que en Cuentas por Cobrar.
// Los filtros de la pantalla se aplican DESPUES del alcance: un vendedor que
// pide la cartera de otro vendedor recibe vacio, no la ajena.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { hoyISO } from "@/lib/crm-fechas"
import { asegurarClienteVisible, exigirPermiso, filtrarPorVendedor, mensajeError, type ContextoCrm } from "@/lib/crm-auth"
import {
  agruparCartera, filtrarPorRango, inicioSerie, recaudoPorMes, resumirCartera, TIPOS_RECAUDO,
  type Cortes, type FacturaTablero, type RecaudoMes, type ResumenCartera,
} from "@/lib/crm-cartera-resumen"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

const VER = [
  "crm_cartera", "crm_pagos", "crm_recaudos_registrar", "crm_recaudos_aprobar",
  "crm_autorizar_contabilidad", "crm_autorizar_gerencia", "crm_dashboard",
] as const

export interface FiltrosTablero {
  vendedorId?: number | null
  ownerId?: number | null
  clienteId?: number | null
  /** Etiqueta del rango: "Al día", "1–30"… */
  rango?: string | null
}

export interface FilaClienteTablero {
  clienteId: number
  nombre: string
  vendedorNombre: string | null
  cupo: number
  saldoFavor: number
  resumen: ResumenCartera
}

export interface FilaGrupoTablero {
  id: number | null
  nombre: string
  clientes: number
  resumen: ResumenCartera
}

export interface TableroCartera {
  total: ResumenCartera
  saldoFavor: number
  recaudoMensual: RecaudoMes[]
  porCliente: FilaClienteTablero[]
  porVendedor: FilaGrupoTablero[]
  porOwner: FilaGrupoTablero[]
  cortes: Cortes
  opciones: { vendedores: { id: number; nombre: string }[]; owners: { id: number; nombre: string }[] }
  /** true si hay mas facturas que el tope de lectura: los totales serian parciales. */
  truncado: boolean
  calculadoEl: string
}

const TOPE = 20_000
const LOTE = 1_000

async function leerCortes(empresaId: number): Promise<Cortes> {
  const [a, b, c] = await Promise.all([
    leerParamNumber(PARAM.CARTERA_RANGO_1, empresaId, 30),
    leerParamNumber(PARAM.CARTERA_RANGO_2, empresaId, 60),
    leerParamNumber(PARAM.CARTERA_RANGO_3, empresaId, 90),
  ])
  return [a, b, c]
}

/** Recaudo (plata recibida) por mes de los ultimos 12 meses, con el mismo alcance. */
async function recaudoMensual(ctx: ContextoCrm, empresaId: number, f: FiltrosTablero, hoy: string) {
  const db = await getSupabaseAdmin()
  const construir = () => {
    let q = db.from("crm_pagos")
      .select("id, fecha_pago, valor, crm_cuentas_cobrar!inner(idempresa, cliente_id, vendedor_id, owner_id)")
      .eq("crm_cuentas_cobrar.idempresa", empresaId)
      .gte("fecha_pago", inicioSerie(hoy))
      .is("anulado_en", null)
      .in("tipo", [...TIPOS_RECAUDO])
    if (ctx.alcance === "propios" && ctx.vendedorId != null) q = q.eq("crm_cuentas_cobrar.vendedor_id", ctx.vendedorId)
    if (f.vendedorId) q = q.eq("crm_cuentas_cobrar.vendedor_id", f.vendedorId)
    if (f.ownerId) q = q.eq("crm_cuentas_cobrar.owner_id", f.ownerId)
    if (f.clienteId) q = q.eq("crm_cuentas_cobrar.cliente_id", f.clienteId)
    return q.order("id")
  }
  const movimientos: { fecha: string; valor: number }[] = []
  for (let desde = 0; desde < TOPE; desde += LOTE) {
    const { data, error } = await construir().range(desde, desde + LOTE - 1)
    if (error) throw new Error(error.message)
    for (const p of data ?? []) movimientos.push({ fecha: p.fecha_pago as string, valor: Number(p.valor) })
    if ((data ?? []).length < LOTE) break
  }
  return recaudoPorMes(movimientos, hoy)
}

export async function getTableroCartera(empresaId = 1, filtros: FiltrosTablero = {}): Promise<ActionResult<TableroCartera>> {
  try {
    const ctx = await exigirPermiso("getTableroCartera", ...VER)
    if (filtros.clienteId) await asegurarClienteVisible(ctx, filtros.clienteId)
    const db = await getSupabaseAdmin()
    const hoy = hoyISO()
    const cortes = await leerCortes(empresaId)

    // Facturas abiertas, por lotes: PostgREST corta en 1.000 filas por consulta.
    const base = () => {
      let q = db.from("crm_cuentas_cobrar")
        .select("id, cliente_id, vendedor_id, owner_id, saldo, fecha_vencimiento, estado")
        .eq("idempresa", empresaId).in("estado", ["pendiente", "parcial"]).gt("saldo", 0)
      q = filtrarPorVendedor(q, ctx, "vendedor_id")
      if (filtros.vendedorId) q = q.eq("vendedor_id", filtros.vendedorId)
      if (filtros.ownerId) q = q.eq("owner_id", filtros.ownerId)
      if (filtros.clienteId) q = q.eq("cliente_id", filtros.clienteId)
      return q.order("id")
    }
    let facturas: FacturaTablero[] = []
    let truncado = false
    for (let desde = 0; ; desde += LOTE) {
      const { data, error } = await base().range(desde, desde + LOTE - 1)
      if (error) return { success: false, error: error.message }
      facturas.push(...((data ?? []) as FacturaTablero[]).map((r) => ({ ...r, saldo: Number(r.saldo) })))
      if ((data ?? []).length < LOTE) break
      if (desde + LOTE >= TOPE) { truncado = true; break }
    }
    facturas = filtrarPorRango(facturas, filtros.rango, hoy, cortes)

    const idsCliente = [...new Set(facturas.map((f) => f.cliente_id))]
    const idsVendedor = [...new Set(facturas.map((f) => f.vendedor_id).filter((v): v is number => v != null))]

    const [clientes, vendedores, owners, favor, serie, todosVendedores] = await Promise.all([
      (async () => {
        const out: { id: number; nombre: string; cupo_credito: number | null; vendedor_asignado: number | null }[] = []
        for (let i = 0; i < idsCliente.length; i += 500) {
          const { data } = await db.from("clientes").select("id, nombre, cupo_credito, vendedor_asignado").in("id", idsCliente.slice(i, i + 500))
          out.push(...((data ?? []) as typeof out))
        }
        return out
      })(),
      idsVendedor.length
        ? db.from("vendedores").select("idvendedor, nombre").in("idvendedor", idsVendedor)
        : Promise.resolve({ data: [] as { idvendedor: number; nombre: string }[] }),
      db.from("crm_owners").select("id, nombre").eq("idempresa", empresaId).order("id"),
      (async () => {
        let q = db.from("crm_saldos_favor").select("cliente_id, owner_id, saldo").eq("idempresa", empresaId).is("anulado_en", null).gt("saldo", 0)
        if (filtros.ownerId) q = q.eq("owner_id", filtros.ownerId)
        if (filtros.clienteId) q = q.eq("cliente_id", filtros.clienteId)
        const { data } = await q
        return data ?? []
      })(),
      recaudoMensual(ctx, empresaId, filtros, hoy),
      // Opciones del filtro de vendedor: todos los que tienen cartera visible
      // para este usuario, no solo los del filtro actual.
      (async () => {
        let q = db.from("crm_cuentas_cobrar").select("vendedor_id").eq("idempresa", empresaId)
          .in("estado", ["pendiente", "parcial"]).not("vendedor_id", "is", null)
        q = filtrarPorVendedor(q, ctx, "vendedor_id")
        const { data } = await q.limit(5000)
        const ids = [...new Set((data ?? []).map((r) => r.vendedor_id as number))]
        if (!ids.length) return []
        const { data: v } = await db.from("vendedores").select("idvendedor, nombre").in("idvendedor", ids).order("nombre")
        return (v ?? []).map((x) => ({ id: x.idvendedor as number, nombre: String(x.nombre) }))
      })(),
    ])

    const cli = new Map(clientes.map((c) => [c.id, c]))
    const nVen = new Map(((vendedores.data ?? []) as { idvendedor: number; nombre: string }[]).map((v) => [v.idvendedor, v.nombre]))
    const nOwn = new Map((owners.data ?? []).map((o) => [o.id as number, String(o.nombre)]))
    // El saldo a favor solo cuenta para los clientes que este usuario puede ver.
    const visibles = new Set(idsCliente)
    const favorPorCliente = new Map<number, number>()
    for (const s of favor) {
      const id = s.cliente_id as number
      if (!visibles.has(id)) continue
      favorPorCliente.set(id, (favorPorCliente.get(id) ?? 0) + Number(s.saldo))
    }
    const saldoFavor = [...favorPorCliente.values()].reduce((a, b) => a + b, 0)

    const porCliente: FilaClienteTablero[] = agruparCartera(facturas, (f) => f.cliente_id, hoy, cortes).map((g) => {
      const c = cli.get(g.id as number)
      const cupo = Number(c?.cupo_credito) || 0
      const favorCli = favorPorCliente.get(g.id as number) ?? 0
      return {
        clienteId: g.id as number,
        nombre: c?.nombre ?? `Cliente ${g.id}`,
        vendedorNombre: c?.vendedor_asignado ? nVen.get(c.vendedor_asignado) ?? null : null,
        cupo,
        saldoFavor: favorCli,
        resumen: resumirCartera(facturas.filter((f) => f.cliente_id === g.id), hoy, cortes, cupo, favorCli),
      }
    })

    const contarClientes = (fs: FacturaTablero[]) => new Set(fs.map((f) => f.cliente_id)).size
    const porVendedor = agruparCartera(facturas, (f) => f.vendedor_id, hoy, cortes).map((g) => ({
      id: g.id,
      nombre: g.id == null ? "Sin vendedor" : nVen.get(g.id) ?? `Vendedor ${g.id}`,
      clientes: contarClientes(facturas.filter((f) => f.vendedor_id === g.id)),
      resumen: g.resumen,
    }))
    const porOwner = agruparCartera(facturas, (f) => f.owner_id, hoy, cortes).map((g) => ({
      id: g.id,
      nombre: g.id == null ? "Sin owner" : nOwn.get(g.id) ?? `Owner ${g.id}`,
      clientes: contarClientes(facturas.filter((f) => f.owner_id === g.id)),
      resumen: g.resumen,
    }))

    return {
      success: true,
      data: {
        total: resumirCartera(facturas, hoy, cortes, 0, saldoFavor),
        saldoFavor,
        recaudoMensual: serie,
        porCliente,
        porVendedor,
        porOwner,
        cortes,
        opciones: {
          vendedores: todosVendedores,
          owners: (owners.data ?? []).map((o) => ({ id: o.id as number, nombre: String(o.nombre) })),
        },
        truncado,
        calculadoEl: new Date().toISOString(),
      },
    }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

export interface TableroCliente {
  rangos: ResumenCartera["rangos"]
  recaudoMensual: RecaudoMes[]
  cortes: Cortes
}

/** Lo que la Cuenta 360 necesita para ser el tablero del cliente (DSH-01). */
export async function getTableroCliente(clienteId: number, empresaId = 1): Promise<ActionResult<TableroCliente>> {
  try {
    const ctx = await exigirPermiso("getTableroCliente", ...VER, "crm_clientes", "crm_pedidos", "crm_cotizaciones")
    await asegurarClienteVisible(ctx, clienteId)
    const db = await getSupabaseAdmin()
    const hoy = hoyISO()
    const cortes = await leerCortes(empresaId)
    const [{ data }, serie] = await Promise.all([
      db.from("crm_cuentas_cobrar").select("saldo, fecha_vencimiento, estado")
        .eq("idempresa", empresaId).eq("cliente_id", clienteId).in("estado", ["pendiente", "parcial"]),
      recaudoMensual({ ...ctx, alcance: "todos" }, empresaId, { clienteId }, hoy),
    ])
    const r = resumirCartera((data ?? []).map((d) => ({ ...d, saldo: Number(d.saldo) })) as FacturaTablero[], hoy, cortes)
    return { success: true, data: { rangos: r.rangos, recaudoMensual: serie, cortes } }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}
