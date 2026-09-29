"use server"

// Cartera: cuentas por cobrar, pagos, antigüedad y comisiones.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getReglasComisionInterna, liquidarComisionInterna } from "@/lib/crm-comisiones-server"
import { getParam, getParamNumber } from "@/lib/crm-parametros-actions"
import { PARAM } from "@/lib/crm-parametros"
import { hoyISO } from "@/lib/crm-fechas"
import {
  exigirPermiso, tienePermiso, filtrarPorVendedor, asegurarClienteVisible, mensajeError,
} from "@/lib/crm-auth"
import type {
  CuentaPorCobrar, CuentaConAging, Pago, ResumenAging,
  Comision, ReglaComision, MomentoComision, EstadoCuenta,
} from "@/lib/crm-cartera"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

function fallo(err: unknown): ActionResult<never> {
  const msg = mensajeError(err)
  console.error("[crm-cartera]", msg)
  return { success: false, error: msg }
}

// -------------------------------------------------------- Cuentas por cobrar

export async function getCuentasPorCobrar(
  empresaId = 1,
  filtros?: { clienteId?: number; estado?: EstadoCuenta; soloVencidas?: boolean },
): Promise<ActionResult<CuentaPorCobrar[]>> {
  try {
    const ctx = await exigirPermiso(
      "getCuentasPorCobrar",
      "crm_cartera", "crm_pagos", "crm_recaudos_registrar", "crm_recaudos_aprobar",
    )
    const supabase = await getSupabaseAdmin()
    let q = supabase.from("crm_cuentas_cobrar").select("*").eq("idempresa", empresaId)
    // Un vendedor ve solo la cartera de sus ventas.
    q = filtrarPorVendedor(q, ctx, "vendedor_id")

    if (filtros?.clienteId) q = q.eq("cliente_id", filtros.clienteId)
    if (filtros?.estado) q = q.eq("estado", filtros.estado)
    else q = q.in("estado", ["pendiente", "parcial"]) // por defecto, lo que se cobra
    if (filtros?.soloVencidas) q = q.lt("fecha_vencimiento", hoyISO())

    const { data, error } = await q.order("fecha_vencimiento").limit(500)
    if (error) return { success: false, error: error.message }

    const cuentas = (data ?? []) as CuentaPorCobrar[]
    if (!cuentas.length) return { success: true, data: [] }

    return { success: true, data: await resolverNombres(cuentas, empresaId) }
  } catch (err) {
    return fallo(err)
  }
}

/** Cartera clasificada por antigüedad. Lee la vista, cuyos tramos salen de los
 *  parámetros: cambiarlos reclasifica todo sin tocar código. */
export async function getAging(
  empresaId = 1,
  clienteId?: number,
): Promise<ActionResult<{ cuentas: CuentaConAging[]; resumen: ResumenAging }>> {
  try {
    const ctx = await exigirPermiso("getAging", "crm_cartera", "crm_recaudos_aprobar")
    const supabase = await getSupabaseAdmin()
    let q = supabase.from("crm_cartera_aging").select("*").eq("idempresa", empresaId)
    q = filtrarPorVendedor(q, ctx, "vendedor_id")
    if (clienteId) q = q.eq("cliente_id", clienteId)

    const { data, error } = await q.order("tramo_orden", { ascending: false }).order("dias_vencido", { ascending: false })
    if (error) return { success: false, error: error.message }

    const cuentas = (data ?? []) as CuentaConAging[]

    // El resumen se arma agrupando por tramo, conservando el orden numérico
    // para que "Más de 90" no quede antes que "1-30" por orden alfabético.
    const porTramo = new Map<string, { orden: number; cantidad: number; valor: number }>()
    let totalPendiente = 0
    let totalVencido = 0

    for (const c of cuentas) {
      const saldo = Number(c.saldo) || 0
      totalPendiente += saldo
      if (c.tramo_orden > 0) totalVencido += saldo

      const actual = porTramo.get(c.tramo_aging) ?? { orden: c.tramo_orden, cantidad: 0, valor: 0 }
      actual.cantidad += 1
      actual.valor += saldo
      porTramo.set(c.tramo_aging, actual)
    }

    const tramos = [...porTramo.entries()]
      .map(([etiqueta, v]) => ({ etiqueta, ...v }))
      .sort((a, b) => a.orden - b.orden)

    return {
      success: true,
      data: {
        cuentas,
        resumen: {
          tramos,
          totalPendiente: Math.round(totalPendiente),
          totalVencido: Math.round(totalVencido),
          cuentas: cuentas.length,
          porcentajeVencido: totalPendiente > 0
            ? Math.round((totalVencido / totalPendiente) * 1000) / 10
            : 0,
        },
      },
    }
  } catch (err) {
    return fallo(err)
  }
}

/** Guarda el número de factura de Siigo cuando contabilidad lo emite. */
export async function asignarNumeroFactura(
  cuentaId: number,
  numeroFactura: string,
  empresaId = 1,
): Promise<ActionResult<CuentaPorCobrar>> {
  try {
    // Un vendedor NO edita facturas (CAR-01): el numero lo pone contabilidad.
    await exigirPermiso("asignarNumeroFactura", "crm_recaudos_aprobar", "crm_maestros_admin")
    if (!numeroFactura.trim()) return { success: false, error: "Escribe el número de factura" }

    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("crm_cuentas_cobrar")
      .update({ numero_factura: numeroFactura.trim() })
      .eq("id", cuentaId)
      .eq("idempresa", empresaId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as CuentaPorCobrar }
  } catch (err) {
    return fallo(err)
  }
}

// ------------------------------------------------------------------ Pagos

export async function getPagos(cuentaId: number): Promise<ActionResult<Pago[]>> {
  try {
    const ctx = await exigirPermiso(
      "getPagos",
      "crm_cartera", "crm_pagos", "crm_recaudos_registrar", "crm_recaudos_aprobar",
    )
    const supabase = await getSupabaseAdmin()
    // El vendedor solo ve los pagos de SUS facturas (CAR-01).
    if (ctx.alcance === "propios") {
      const { data: cta } = await supabase.from("crm_cuentas_cobrar").select("vendedor_id").eq("id", cuentaId).maybeSingle()
      if (!cta || cta.vendedor_id !== ctx.vendedorId) return { success: false, error: "No encontrado" }
    }
    const { data, error } = await supabase
      .from("crm_pagos")
      .select("*")
      .eq("cuenta_cobrar_id", cuentaId)
      .order("fecha_pago", { ascending: false })

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as Pago[] }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Registra un abono.
 *
 * NO actualiza el saldo: lo hace un trigger de la base a partir de la suma de
 * pagos. Asi el saldo no puede quedar diciendo una cosa y los pagos otra.
 */
export async function registrarPago(
  pago: {
    cuenta_cobrar_id: number
    valor: number
    fecha_pago?: string
    medio_pago?: string
    referencia?: string
    soporte_url?: string
    observacion?: string
  },
  _usuario: string,
  empresaId = 1,
): Promise<ActionResult<{ pago: Pago; saldoNuevo: number; liquidoComision: boolean }>> {
  try {
    // DESDE LA FASE 3 ESTO ES UN AJUSTE DE CARTERA, no la forma de registrar
    // un pago de cliente: los pagos se reportan como RECAUDOS, con comprobante
    // y aprobacion (crm-recaudos-actions.ts). Aplicar un pago al instante y sin
    // revision es justo lo que el requerimiento pide dejar de hacer, asi que
    // solo lo puede usar Cartera, y queda marcado como ajuste.
    const ctx = await exigirPermiso("registrarPago", "crm_recaudos_aprobar")
    if (!tienePermiso(ctx, "crm_recaudos_aprobar")) {
      return { success: false, error: "Los pagos se reportan como recaudo, con su comprobante. Usa Registrar Pago." }
    }
    const usuario = ctx.nombre
    if (!pago.valor || pago.valor <= 0) {
      return { success: false, error: "El valor del abono debe ser mayor que cero" }
    }

    const supabase = await getSupabaseAdmin()

    const { data: cuenta } = await supabase
      .from("crm_cuentas_cobrar")
      .select("*")
      .eq("id", pago.cuenta_cobrar_id)
      .eq("idempresa", empresaId)
      .maybeSingle()

    if (!cuenta) return { success: false, error: "La cuenta no existe" }
    // Un vendedor no abona a la cuenta de un cliente ajeno adivinando el id.
    await asegurarClienteVisible(ctx, cuenta.cliente_id)
    if (cuenta.estado === "anulada") return { success: false, error: "La cuenta está anulada" }

    const saldoActual = Number(cuenta.saldo) || 0
    if (pago.valor > saldoActual) {
      // Se rechaza en vez de aceptar y dejar saldo negativo: un abono mayor al
      // saldo casi siempre es un error de digitación, y dejarlo pasar obliga
      // después a una nota crédito para cuadrar.
      return {
        success: false,
        error: `El abono (${pago.valor.toLocaleString("es-CO")}) supera el saldo (${saldoActual.toLocaleString("es-CO")})`,
      }
    }

    const { data, error } = await supabase
      .from("crm_pagos")
      .insert({
        idempresa: empresaId,
        cuenta_cobrar_id: pago.cuenta_cobrar_id,
        fecha_pago: pago.fecha_pago ?? hoyISO(),
        valor: pago.valor,
        medio_pago: pago.medio_pago ?? null,
        referencia: pago.referencia ?? null,
        soporte_url: pago.soporte_url ?? null,
        observacion: pago.observacion ?? null,
        registrado_por: usuario,
        tipo: "ajuste",
      })
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    const saldoNuevo = saldoActual - pago.valor
    let liquidoComision = false

    // Si la comisión se causa por recaudo y la cuenta quedó saldada, se
    // liquida ahora: es el momento en que el vendedor se la ganó.
    if (saldoNuevo <= 0) {
      const momento = (await getParam(PARAM.COMISION_MOMENTO, empresaId)) as MomentoComision
      if (momento === "recaudo") {
        // Version interna: quien registra el pago no necesita permiso de
        // comisiones para que la comision se cause; eso lo decide el negocio.
        const res = await liquidarComisionInterna(pago.cuenta_cobrar_id, usuario, empresaId)
        liquidoComision = res.success
      }
    }

    return { success: true, data: { pago: data as Pago, saldoNuevo, liquidoComision } }
  } catch (err) {
    return fallo(err)
  }
}

export async function anularPago(pagoId: number, empresaId = 1, motivo = "Anulado por Cartera"): Promise<ActionResult<null>> {
  try {
    const ctx = await exigirPermiso("anularPago", "crm_recaudos_aprobar")
    if (!tienePermiso(ctx, "crm_recaudos_aprobar")) return { success: false, error: "No tienes permiso para anular pagos" }
    const supabase = await getSupabaseAdmin()
    const { data: pago } = await supabase.from("crm_pagos").select("recaudo_id").eq("id", pagoId).maybeSingle()
    // Un pago que viene de un recaudo se anula anulando el recaudo entero: si
    // no, el recaudo quedaria "aprobado" con parte de su dinero sin aplicar.
    if (pago?.recaudo_id) return { success: false, error: "Este pago viene de un recaudo: anula el recaudo" }
    // Ya no se borra: se marca, y el trigger deja de sumarlo (script 202).
    const { error } = await supabase
      .from("crm_pagos")
      .update({ anulado_en: new Date().toISOString(), anulado_por: ctx.nombre, motivo_anulacion: motivo })
      .eq("id", pagoId)
      .eq("idempresa", empresaId)
      .is("anulado_en", null)

    if (error) return { success: false, error: error.message }
    return { success: true, data: null }
  } catch (err) {
    return fallo(err)
  }
}

// ------------------------------------------------------------- Comisiones

export async function getComisiones(
  empresaId = 1,
  filtros?: { vendedorId?: number; periodo?: string; estado?: string },
): Promise<ActionResult<Comision[]>> {
  try {
    const ctx = await exigirPermiso("getComisiones", "crm_comisiones")
    const supabase = await getSupabaseAdmin()
    let q = supabase.from("crm_comisiones").select("*").eq("idempresa", empresaId)
    // Un vendedor ve solo sus comisiones, aunque pida las de otro en el filtro.
    q = filtrarPorVendedor(q, ctx, "vendedor_id")

    if (filtros?.vendedorId) q = q.eq("vendedor_id", filtros.vendedorId)
    if (filtros?.periodo) q = q.eq("periodo", filtros.periodo)
    if (filtros?.estado) q = q.eq("estado", filtros.estado)

    const { data, error } = await q.order("periodo", { ascending: false }).limit(500)
    if (error) return { success: false, error: error.message }

    const comisiones = (data ?? []) as Comision[]
    if (!comisiones.length) return { success: true, data: [] }

    const ids = [...new Set(comisiones.map((c) => c.vendedor_id))]
    const { data: vendedores } = await supabase
      .from("vendedores").select("idvendedor, nombre").in("idvendedor", ids)
    const nombre = new Map((vendedores ?? []).map((v: any) => [v.idvendedor, v.nombre]))

    return {
      success: true,
      data: comisiones.map((c) => ({ ...c, vendedor_nombre: nombre.get(c.vendedor_id) ?? null })),
    }
  } catch (err) {
    return fallo(err)
  }
}

export async function getReglasComision(empresaId = 1): Promise<ActionResult<ReglaComision[]>> {
  try {
    await exigirPermiso("getReglasComision", "crm_comisiones")
    return await getReglasComisionInterna(empresaId)
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Liquida la comisión de una cuenta cobrada.
 *
 * El porcentaje se COPIA en la fila. Si se leyera de la regla vigente al
 * consultar, cambiar la tasa reescribiría lo ya liquidado y el vendedor vería
 * una cifra distinta de la que se le pagó.
 */
export async function liquidarComision(
  cuentaId: number,
  _usuario: string,
  empresaId = 1,
): Promise<ActionResult<Comision>> {
  try {
    // Quien liquida sale de la sesion, no del argumento.
    const ctx = await exigirPermiso("liquidarComision", "crm_comisiones")
    return await liquidarComisionInterna(cuentaId, ctx.nombre, empresaId)
  } catch (err) {
    return fallo(err)
  }
}


export async function cambiarEstadoComision(
  id: number,
  estado: "aprobada" | "pagada" | "anulada",
  empresaId = 1,
): Promise<ActionResult<Comision>> {
  try {
    await exigirPermiso("cambiarEstadoComision", "crm_comisiones")
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("crm_comisiones")
      .update({ estado })
      .eq("id", id)
      .eq("idempresa", empresaId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as Comision }
  } catch (err) {
    return fallo(err)
  }
}

// -------------------------------------------------------------- Auxiliar

async function resolverNombres(
  cuentas: CuentaPorCobrar[],
  empresaId: number,
): Promise<CuentaPorCobrar[]> {
  const supabase = await getSupabaseAdmin()

  const idsCliente = [...new Set(cuentas.map((c) => c.cliente_id))]
  const idsPedido = [...new Set(cuentas.map((c) => c.pedido_id).filter(Boolean))] as number[]

  const [clientesRes, pedidosRes] = await Promise.all([
    supabase.from("clientes").select("id, nombre").in("id", idsCliente),
    idsPedido.length
      ? supabase.from("crm_pedidos").select("id, numero").in("id", idsPedido)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const nombreCliente = new Map((clientesRes.data ?? []).map((c: any) => [c.id, c.nombre]))
  const numeroPedido = new Map((pedidosRes.data ?? []).map((p: any) => [p.id, p.numero]))

  return cuentas.map((c) => ({
    ...c,
    cliente_nombre: nombreCliente.get(c.cliente_id) ?? null,
    pedido_numero: c.pedido_id ? numeroPedido.get(c.pedido_id) ?? null : null,
  }))
}
