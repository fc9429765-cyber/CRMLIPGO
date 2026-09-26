"use server"

// Cotizaciones: emision, vigencia y conversion en pedido.

import { prepararDocumento, filasDetalle, evaluarCreditoCliente } from "@/lib/crm-venta-server"
import { solicitarAprobacion } from "@/lib/crm-pedidos-actions"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getParamNumber, getParamBool } from "@/lib/crm-parametros-actions"
import { PARAM } from "@/lib/crm-parametros"
import { hoyISO, sumarDias } from "@/lib/crm-fechas"
import {
  exigirPermiso, exigirSesion, filtrarPorVendedor, asegurarClienteVisible, mensajeError,
} from "@/lib/crm-auth"
import { registrarEvento } from "@/lib/crm-eventos"
import type {
  Cotizacion, CotizacionConDetalle, LineaCotizacion, NuevaCotizacion, EstadoCotizacion,
} from "@/lib/crm-cotizaciones"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

function fallo(err: unknown): ActionResult<never> {
  const msg = mensajeError(err)
  console.error("[crm-cotizaciones]", msg)
  return { success: false, error: msg }
}

// ------------------------------------------------------------- Consultas

export async function getCotizaciones(
  empresaId = 1,
  filtros?: { estado?: EstadoCotizacion; clienteId?: number; vendedorId?: number },
): Promise<ActionResult<CotizacionConDetalle[]>> {
  try {
    const ctx = await exigirPermiso("getCotizaciones", "crm_cotizaciones", "crm_pedidos")
    const supabase = await getSupabaseAdmin()
    let q = supabase.from("crm_cotizaciones").select("*").eq("idempresa", empresaId)
    // Un vendedor ve solo sus cotizaciones, aunque pida las de otro en el filtro.
    q = filtrarPorVendedor(q, ctx, "vendedor_id")

    if (filtros?.estado) q = q.eq("estado", filtros.estado)
    if (filtros?.clienteId) q = q.eq("cliente_id", filtros.clienteId)
    if (filtros?.vendedorId) q = q.eq("vendedor_id", filtros.vendedorId)

    const { data, error } = await q.order("creado_en", { ascending: false }).limit(300)
    if (error) return { success: false, error: error.message }

    const cotizaciones = (data ?? []) as Cotizacion[]
    if (!cotizaciones.length) return { success: true, data: [] }

    // Los nombres se resuelven en UNA consulta por tabla, no una por fila.
    const idsCliente = [...new Set(cotizaciones.map((c) => c.cliente_id).filter(Boolean))] as number[]
    const idsProspecto = [...new Set(cotizaciones.map((c) => c.prospecto_id).filter(Boolean))] as number[]

    const [clientesRes, prospectosRes] = await Promise.all([
      idsCliente.length
        ? supabase.from("clientes").select("id, nombre").in("id", idsCliente)
        : Promise.resolve({ data: [] as any[] }),
      idsProspecto.length
        ? supabase.from("crm_prospectos").select("id, razon_social").in("id", idsProspecto)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const nombreCliente = new Map((clientesRes.data ?? []).map((c: any) => [c.id, c.nombre]))
    const nombreProspecto = new Map((prospectosRes.data ?? []).map((p: any) => [p.id, p.razon_social]))

    return {
      success: true,
      data: cotizaciones.map((c) => ({
        ...c,
        cliente_nombre: c.cliente_id ? nombreCliente.get(c.cliente_id) ?? null : null,
        prospecto_nombre: c.prospecto_id ? nombreProspecto.get(c.prospecto_id) ?? null : null,
      })),
    }
  } catch (err) {
    return fallo(err)
  }
}

export async function getCotizacion(id: number, empresaId = 1): Promise<ActionResult<CotizacionConDetalle>> {
  try {
    const ctx = await exigirPermiso("getCotizacion", "crm_cotizaciones", "crm_pedidos")
    const res = await getCotizacionInterna(id, empresaId)
    // La de otro vendedor se trata como inexistente: decir "no tienes
    // permiso" confirmaria que ese id existe.
    if (res.success && res.data && ctx.alcance === "propios" && res.data.vendedor_id !== ctx.vendedorId) {
      return { success: false, error: "No encontrado" }
    }
    return res
  } catch (err) {
    return fallo(err)
  }
}

/** Lectura sin validacion de permisos, para quien ya valido el suyo. */
async function getCotizacionInterna(id: number, empresaId: number): Promise<ActionResult<CotizacionConDetalle>> {
  try {
    const supabase = await getSupabaseAdmin()

    const [cabRes, detRes] = await Promise.all([
      supabase.from("crm_cotizaciones").select("*").eq("id", id).eq("idempresa", empresaId).maybeSingle(),
      supabase.from("crm_cotizacion_detalle").select("*").eq("cotizacion_id", id).order("linea"),
    ])

    if (cabRes.error) return { success: false, error: cabRes.error.message }
    if (!cabRes.data) return { success: false, error: "La cotización no existe" }

    return {
      success: true,
      data: { ...(cabRes.data as Cotizacion), lineas: (detRes.data ?? []) as LineaCotizacion[] },
    }
  } catch (err) {
    return fallo(err)
  }
}

// --------------------------------------------------------------- Emision

export async function crearCotizacion(
  entrada: NuevaCotizacion,
  _usuario: string,
  empresaId = 1,
): Promise<ActionResult<Cotizacion>> {
  try {
    // Quien crea sale de la sesion; el argumento se conserva por
    // compatibilidad y se ignora.
    const ctx = await exigirPermiso("crearCotizacion", "crm_cotizaciones", "crm_pedidos")
    if (!entrada.cliente_id && !entrada.prospecto_id) {
      return { success: false, error: "La cotización debe ir dirigida a un cliente o a un prospecto" }
    }
    const supabase = await getSupabaseAdmin()

    let listaId = entrada.lista_precio_id ?? null
    if (entrada.cliente_id) {
      // Un vendedor no cotiza a un cliente ajeno adivinando el id.
      await asegurarClienteVisible(ctx, entrada.cliente_id)
      const { data: cli } = await supabase.from("clientes").select("lista_precio_id").eq("id", entrada.cliente_id).maybeSingle()
      listaId = listaId ?? ((cli?.lista_precio_id as number | null) ?? null)
      if (entrada.bodega_id) {
        const { data: b } = await supabase.from("bodegas").select("clienteid").eq("idbodega", entrada.bodega_id).maybeSingle()
        if (!b || b.clienteid !== entrada.cliente_id) return { success: false, error: "Esa sucursal no es del cliente" }
      }
    }

    // Todo lo que vale se calcula aqui: owner unico, centro de despacho,
    // catalogo del cliente, precio de lista e impuesto de cada producto.
    const prep = await prepararDocumento(empresaId, {
      cliente_id: entrada.cliente_id ?? null,
      prospecto_id: entrada.prospecto_id ?? null,
      idempresa_despacho: entrada.idempresa_despacho ?? null,
      lista_precio_id: listaId,
      lineas: entrada.lineas ?? [],
    })
    if (!prep.ok) return { success: false, error: prep.error }
    const d = prep.data

    const vigenciaDias = await getParamNumber(PARAM.COTIZACION_VIGENCIA, empresaId)
    const emision = hoyISO()

    const { data: cabecera, error: errCab } = await supabase
      .from("crm_cotizaciones")
      .insert({
        idempresa: empresaId,
        prospecto_id: entrada.prospecto_id ?? null,
        cliente_id: entrada.cliente_id ?? null,
        bodega_id: entrada.bodega_id ?? null,
        // Un vendedor solo cotiza a su nombre. Solo quien ve todo (cartera,
        // gerencia) puede registrar una cotizacion por otro vendedor.
        vendedor_id:
          ctx.alcance === "propios" ? ctx.vendedorId : (entrada.vendedor_id ?? ctx.vendedorId ?? null),
        owner_id: d.ownerId,
        idempresa_despacho: d.idempresaDespacho,
        tipo_venta: entrada.tipo_venta ?? "cotizacion",
        forma_pago: entrada.forma_pago ?? "contado",
        dias_credito: entrada.dias_credito ?? 0,
        condicion_pago_id: entrada.condicion_pago_id ?? null,
        fecha_emision: emision,
        // Vigencia e impuestos se CONGELAN: el cliente acepta unos terminos
        // concretos y cambiarlos despues seria cambiarle la oferta.
        vigencia_dias: vigenciaDias,
        fecha_vencimiento: sumarDias(emision, vigenciaDias),
        iva_pct: d.ivaPct,
        subtotal: d.totales.subtotal,
        descuento_valor: d.totales.descuento,
        iva_valor: d.totales.impuesto,
        total: d.totales.total,
        peso_total: d.totales.peso,
        lista_precio_id: listaId,
        // No bloquea: el vendedor puede necesitarlo, pero alguien debe enterarse.
        requiere_autorizacion_descuento: d.excedeTopeDescuento,
        observaciones: entrada.observaciones ?? null,
        creado_por: ctx.nombre,
      })
      .select()
      .single()
    if (errCab) return { success: false, error: errCab.message }

    const { error: errDet } = await supabase
      .from("crm_cotizacion_detalle")
      .insert(filasDetalle(empresaId, "cotizacion_id", cabecera.id, d.lineas))
    if (errDet) {
      // Sin lineas la cotizacion no sirve: se borra la cabecera para no dejar
      // un documento vacio que alguien intente enviar.
      await supabase.from("crm_cotizaciones").delete().eq("id", cabecera.id)
      return { success: false, error: `No se guardaron las líneas: ${errDet.message}` }
    }

    await registrarEvento({
      empresaId, entidad: "cotizacion", entidadId: cabecera.id, tipo: "creado",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      datos: { total: d.totales.total, owner: d.owner.codigo, despacho: d.idempresaDespacho },
    })
    return { success: true, data: cabecera as Cotizacion }
  } catch (err) {
    return fallo(err)
  }
}

export async function cambiarEstadoCotizacion(
  id: number,
  estado: EstadoCotizacion,
  empresaId = 1,
  motivo?: string,
): Promise<ActionResult<Cotizacion>> {
  try {
    const ctx = await exigirPermiso("cambiarEstadoCotizacion", "crm_cotizaciones", "crm_pedidos")
    const supabase = await getSupabaseAdmin()

    // Un vendedor no cambia el estado de la cotizacion de otro.
    if (ctx.alcance === "propios") {
      const { data: actual } = await supabase
        .from("crm_cotizaciones").select("vendedor_id").eq("id", id).eq("idempresa", empresaId).maybeSingle()
      if (!actual || actual.vendedor_id !== ctx.vendedorId) return { success: false, error: "No encontrado" }
    }

    const cambios: Record<string, unknown> = { estado }
    if (estado === "rechazada" && motivo) cambios.motivo_rechazo = motivo

    const { data, error } = await supabase
      .from("crm_cotizaciones")
      .update(cambios)
      .eq("id", id)
      .eq("idempresa", empresaId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as Cotizacion }
  } catch (err) {
    return fallo(err)
  }
}

// ------------------------------------------------------ Conversion a pedido

/**
 * Convierte una cotizacion en pedido, en BORRADOR (PED-18).
 *
 * COPIA LOS PRECIOS, no los vuelve a resolver: el cliente acepto unos numeros
 * concretos. El credito ya no se valida aqui sino al solicitar aprobacion, que
 * es cuando cuenta y donde el sobrecupo se marca en vez de bloquear (PED-04).
 *
 * `solicitar: true` (venta directa) lo envia a aprobacion en el mismo paso.
 */
export async function convertirEnPedido(
  cotizacionId: number,
  _usuario: string,
  empresaId = 1,
  opciones?: { solicitar?: boolean },
): Promise<ActionResult<{ pedidoId: number; numero: string; solicitud?: { ok: boolean; mensaje: string } }>> {
  try {
    const ctx = await exigirPermiso("convertirEnPedido", "crm_pedidos", "crm_cotizaciones")
    const supabase = await getSupabaseAdmin()

    const cotRes = await getCotizacionInterna(cotizacionId, empresaId)
    if (!cotRes.success || !cotRes.data) return { success: false, error: cotRes.error ?? "La cotización no existe" }
    const cot = cotRes.data
    if (ctx.alcance === "propios" && cot.vendedor_id !== ctx.vendedorId) return { success: false, error: "No encontrado" }
    if (cot.crm_pedido_id) return { success: false, error: `Esta cotización ya generó el pedido ${cot.crm_pedido_id}` }
    if (cot.estado === "rechazada") return { success: false, error: "La cotización está rechazada" }
    if (!cot.cliente_id) {
      return { success: false, error: "La cotización es de un prospecto. Conviértelo en cliente antes de generar el pedido." }
    }
    await asegurarClienteVisible(ctx, cot.cliente_id)

    // Una cotizacion vencida ya no obliga a nadie a ese precio.
    if (cot.fecha_vencimiento < hoyISO()) {
      await supabase.from("crm_cotizaciones").update({ estado: "vencida" }).eq("id", cotizacionId)
      return { success: false, error: `La cotización venció el ${cot.fecha_vencimiento}. Genera una nueva con precios actuales.` }
    }

    const c = cot as typeof cot & { owner_id?: number | null; idempresa_despacho?: number | null }
    const { data: pedido, error: errPed } = await supabase
      .from("crm_pedidos")
      .insert({
        idempresa: empresaId,
        cotizacion_id: cot.id,
        cliente_id: cot.cliente_id,
        bodega_id: cot.bodega_id,
        vendedor_id: cot.vendedor_id ?? ctx.vendedorId ?? null,
        owner_id: c.owner_id ?? null,
        idempresa_despacho: c.idempresa_despacho ?? null,
        fecha: hoyISO(),
        forma_pago: cot.forma_pago,
        dias_credito: cot.dias_credito,
        condicion_pago_id: cot.condicion_pago_id,
        subtotal: cot.subtotal,
        descuento_valor: cot.descuento_valor,
        iva_pct: cot.iva_pct,
        iva_valor: cot.iva_valor,
        total: cot.total,
        peso_total: cot.peso_total,
        estado: "borrador",
        observaciones: cot.observaciones,
        creado_por: ctx.nombre,
      })
      .select()
      .single()
    if (errPed) return { success: false, error: errPed.message }

    const lineas = (cot.lineas ?? []).map((l) => ({
      idempresa: empresaId, pedido_id: pedido.id, linea: l.linea, producto_id: l.producto_id,
      producto_nombre: l.producto_nombre, categoria: l.categoria, unidad: l.unidad, cantidad: l.cantidad,
      precio_lista: l.precio_lista, precio_unitario: l.precio_unitario, descuento_pct: l.descuento_pct,
      descuento_valor: l.descuento_valor, subtotal: l.subtotal, total_linea: l.total_linea, peso: l.peso,
      impuesto_id: l.impuesto_id ?? null, impuesto_pct: l.impuesto_pct ?? cot.iva_pct,
      base_impuesto: l.base_impuesto ?? l.subtotal,
      impuesto_valor: l.impuesto_valor ?? Math.round(l.subtotal * cot.iva_pct) / 100,
    }))
    const { error: errDet } = await supabase.from("crm_pedido_detalle").insert(lineas)
    if (errDet) {
      await supabase.from("crm_pedidos").delete().eq("id", pedido.id)
      return { success: false, error: `No se copiaron las líneas: ${errDet.message}` }
    }

    await supabase.from("crm_cotizaciones").update({ estado: "convertida", crm_pedido_id: pedido.id }).eq("id", cotizacionId)
    await registrarEvento({
      empresaId, entidad: "pedido", entidadId: pedido.id, tipo: "creado",
      estadoDesde: null, estadoHasta: "borrador", usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      datos: { cotizacion_id: cot.id, cotizacion_numero: cot.numero, tipo_venta: cot.tipo_venta },
    })

    let solicitud: { ok: boolean; mensaje: string } | undefined
    if (opciones?.solicitar) {
      const r = await solicitarAprobacion(pedido.id, empresaId)
      solicitud = r.success
        ? {
            ok: true,
            mensaje: r.data?.credito.requiereSobrecupo
              ? `Enviado a aprobación con sobrecupo de ${r.data.credito.sobrecupoValor.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}`
              : "Enviado a aprobación",
          }
        : { ok: false, mensaje: r.error ?? "No se pudo enviar a aprobación; quedó en borrador" }
    }
    return { success: true, data: { pedidoId: pedido.id, numero: pedido.numero, solicitud } }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Evaluacion de credito de un pedido hipotetico. Misma logica que usa
 * solicitarAprobacion: con sobrecupo responde ok con el motivo, salvo que la
 * configuracion pida bloquear.
 */
export async function verificarCupo(
  clienteId: number,
  montoNuevo: number,
  empresaId = 1,
): Promise<ResultadoCupo> {
  try {
    const ctx = await exigirSesion()
    await asegurarClienteVisible(ctx, clienteId)
    const { cuenta, evaluacion } = await evaluarCreditoCliente(empresaId, clienteId, "credito", montoNuevo)
    return {
      ok: evaluacion.permitido,
      motivo: evaluacion.motivos.join(". ") || undefined,
      cupo: cuenta.cupo,
      usado: cuenta.saldo,
      disponible: cuenta.disponible,
      sobrecupo: evaluacion.sobrecupoValor,
    }
  } catch (err) {
    return { ok: false, motivo: mensajeError(err, "Error al verificar el cupo") }
  }
}

type ResultadoCupo = { ok: boolean; motivo?: string; cupo?: number; usado?: number; disponible?: number; sobrecupo?: number }

/**
 * Marca como vencidas las cotizaciones que pasaron de fecha.
 *
 * La llama el cron diario, y tambien la pantalla al abrirse: asi el estado es
 * correcto aunque el cron no haya corrido.
 */
export async function vencerCotizaciones(empresaId = 1): Promise<ActionResult<number>> {
  try {
    // Mantenimiento que dispara el panel al abrirse: basta con tener sesion.
    await exigirSesion()
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("crm_cotizaciones")
      .update({ estado: "vencida" })
      .eq("idempresa", empresaId)
      .in("estado", ["borrador", "enviada"])
      .lt("fecha_vencimiento", hoyISO())
      .select("id")

    if (error) return { success: false, error: error.message }
    return { success: true, data: data?.length ?? 0 }
  } catch (err) {
    return fallo(err)
  }
}
