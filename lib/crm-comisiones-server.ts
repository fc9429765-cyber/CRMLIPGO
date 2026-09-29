// Liquidacion de comisiones, solo para codigo del servidor.
//
// SIN "use server": si fuera una accion, cualquiera con sesion podria liquidar
// comisiones desde el navegador saltandose el permiso. Aqui la usan:
//   - la accion `liquidarComision` (que exige crm_comisiones);
//   - la aprobacion de recaudos, que liquida al saldar una factura cuando el
//     momento de causacion es "recaudo". Ahi el permiso que cuenta es el de
//     aprobar el recaudo, no el de comisiones: la regla la fija el negocio.
//
// Se movio aqui desde crm-cartera-actions.ts sin cambiar la logica.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { leerParam, leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { hoyISO } from "@/lib/crm-fechas"
import type { Comision, ReglaComision } from "@/lib/crm-cartera"

interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** Sin validacion de permisos: la usa la liquidacion, que puede dispararse al
 *  registrar un pago alguien sin permiso de comisiones. */
export async function getReglasComisionInterna(empresaId: number): Promise<ActionResult<ReglaComision[]>> {
  const supabase = await getSupabaseAdmin()
  const { data, error } = await supabase
    .from("crm_reglas_comision")
    .select("*")
    .eq("idempresa", empresaId)
    .eq("activo", true)
    .order("prioridad", { ascending: false })

  if (error) return { success: false, error: error.message }
  return { success: true, data: (data ?? []) as ReglaComision[] }
}

/**
 * Regla aplicable a una venta, de la más específica a la más general.
 *
 * Entre varias vigentes gana la de mayor prioridad; a igual prioridad, la más
 * específica. Así se puede tener una regla general y excepciones puntuales sin
 * borrar la general.
 */
async function resolverRegla(
  empresaId: number,
  contexto: { vendedorId?: number | null; clienteId?: number | null; categoria?: string | null },
): Promise<ReglaComision | null> {
  const res = await getReglasComisionInterna(empresaId)
  if (!res.success || !res.data?.length) return null

  const hoy = hoyISO()
  const vigentes = res.data.filter(
    (r) => r.vigente_desde <= hoy && (!r.vigente_hasta || r.vigente_hasta >= hoy),
  )

  const aplica = (r: ReglaComision) => {
    switch (r.ambito) {
      case "global": return true
      case "vendedor": return String(contexto.vendedorId ?? "") === r.ambito_valor
      case "cliente": return String(contexto.clienteId ?? "") === r.ambito_valor
      case "categoria": return (contexto.categoria ?? "") === r.ambito_valor
      default: return false
    }
  }

  const especificidad: Record<string, number> = {
    producto: 4, cliente: 3, vendedor: 2, categoria: 1, global: 0,
  }

  return (
    vigentes
      .filter(aplica)
      .sort((a, b) =>
        b.prioridad - a.prioridad ||
        (especificidad[b.ambito] ?? 0) - (especificidad[a.ambito] ?? 0),
      )[0] ?? null
  )
}

/**
 * Cuerpo de la liquidacion, sin validacion de permisos. Lo usan la accion
 * exportada (que valida) y registrarPago, que liquida al saldar la cuenta: ahi
 * el permiso que cuenta es el de registrar el pago, no el de comisiones.
 *
 * @param usuario nombre tomado de la sesion por quien llama, nunca del navegador.
 */
export async function liquidarComisionInterna(
  cuentaId: number,
  usuario: string,
  empresaId: number,
): Promise<ActionResult<Comision>> {
  try {
    const supabase = await getSupabaseAdmin()

    const { data: cuenta } = await supabase
      .from("crm_cuentas_cobrar")
      .select("*")
      .eq("id", cuentaId)
      .eq("idempresa", empresaId)
      .maybeSingle()

    if (!cuenta) return { success: false, error: "La cuenta no existe" }
    if (!cuenta.vendedor_id) return { success: false, error: "La cuenta no tiene vendedor asignado" }

    // El índice único (vendedor_id, cuenta_cobrar_id) lo impediría igualmente,
    // pero avisar es mejor que dejar que la base devuelva un 23505.
    const { data: existente } = await supabase
      .from("crm_comisiones")
      .select("id")
      .eq("cuenta_cobrar_id", cuentaId)
      .eq("vendedor_id", cuenta.vendedor_id)
      .maybeSingle()

    if (existente) return { success: false, error: "Esta cuenta ya tiene comisión liquidada" }

    const regla = await resolverRegla(empresaId, {
      vendedorId: cuenta.vendedor_id,
      clienteId: cuenta.cliente_id,
    })

    const porcentaje = regla?.porcentaje ?? (await leerParamNumber(PARAM.COMISION_PORCENTAJE, empresaId))

    // La base puede ser el subtotal o el total con IVA. Lo habitual es el
    // subtotal: comisionar sobre el IVA sería comisionar sobre un impuesto
    // que la empresa solo recauda para el Estado.
    const baseConfigurada = regla?.base ?? (await leerParam(PARAM.COMISION_BASE, empresaId))
    let base = Number(cuenta.valor_original) || 0

    if (baseConfigurada === "subtotal" && cuenta.pedido_id) {
      const { data: pedido } = await supabase
        .from("crm_pedidos").select("subtotal").eq("id", cuenta.pedido_id).maybeSingle()
      if (pedido?.subtotal) base = Number(pedido.subtotal)
    }

    if (regla?.monto_minimo && base < regla.monto_minimo) {
      return { success: false, error: `La venta no alcanza el mínimo para comisionar (${regla.monto_minimo})` }
    }

    const valor = Math.round(base * (porcentaje / 100))
    const periodo = hoyISO().slice(0, 7) // '2026-09'

    const { data, error } = await supabase
      .from("crm_comisiones")
      .insert({
        idempresa: empresaId,
        vendedor_id: cuenta.vendedor_id,
        pedido_id: cuenta.pedido_id,
        cuenta_cobrar_id: cuentaId,
        regla_id: regla?.id ?? null,
        periodo,
        base_calculo: base,
        porcentaje,
        valor,
        liquidado_por: usuario,
        liquidado_en: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as Comision }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error al liquidar la comisión" }
  }
}
