// Alertas de la campana: /api/crm/<dominio>-alerts.
//
// La campana (hooks/useCrmAlerts.ts) consultaba cinco rutas que nunca se
// crearon, asi que no mostraba nada. Aqui estan las cinco en una sola ruta:
// son la misma mecanica con distinta consulta.
//
// CONTRATO: responde SIEMPRE { alerts, count } con 200, aunque falle. Una
// alerta rota no puede tumbar la barra superior.
//
// Cada consulta respeta el alcance del usuario: un vendedor ve las alertas de
// lo suyo, no las de todo el equipo. Las rutas estaticas (upload-imagen)
// tienen prioridad sobre esta, asi que no se pisan.

import { NextResponse, type NextRequest } from "next/server"
import { empresaPermitida, filtrarPorVendedor, getContexto, tienePermiso, type ContextoCrm } from "@/lib/crm-auth"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { hoyISO, sumarDias } from "@/lib/crm-fechas"
import { leerParam } from "@/lib/crm-parametros-server"
import { puedeFirmar, rolesQueFaltan, type ModoAprobacion } from "@/lib/crm-pedidos-estado"

export const dynamic = "force-dynamic"

interface Alerta {
  tipo: string
  mensaje: string
  id?: number | string
  fecha?: string | null
}

const vacio = () => NextResponse.json({ alerts: [], count: 0 })

const money = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

type Generador = (ctx: ContextoCrm, empresaId: number) => Promise<Alerta[]>

const DOMINIOS: Record<string, { permisos: string[]; generar: Generador }> = {
  // Visitas y compromisos de hoy, pendientes.
  agenda: {
    permisos: ["crm_agenda"],
    generar: async (ctx, empresaId) => {
      const sb = await getSupabaseAdminAsSystem()
      let q = sb
        .from("crm_agenda")
        .select("id, titulo, fecha, hora_inicio")
        .eq("idempresa", empresaId)
        .eq("estado", "pendiente")
        .lte("fecha", hoyISO())
      // Un vendedor ve lo suyo; quien no es vendedor, lo que tiene asignado.
      q = ctx.alcance === "propios" ? filtrarPorVendedor(q, ctx, "vendedor_id") : q.eq("usuario_asignado", ctx.userId)
      const { data } = await q.order("fecha").order("hora_inicio").limit(20)
      const hoy = hoyISO()
      return (data ?? []).map((c) => ({
        tipo: c.fecha < hoy ? "atrasada" : "hoy",
        id: c.id,
        fecha: c.fecha,
        mensaje: `${c.fecha < hoy ? "Atrasada: " : ""}${c.titulo}${c.hora_inicio ? ` · ${String(c.hora_inicio).slice(0, 5)}` : ""}`,
      }))
    },
  },

  // Prospectos con el seguimiento vencido, en etapas abiertas.
  prospectos: {
    permisos: ["crm_prospectos", "crm_embudo"],
    generar: async (ctx, empresaId) => {
      const sb = await getSupabaseAdminAsSystem()
      const { data: cerradas } = await sb
        .from("crm_etapas")
        .select("id")
        .eq("idempresa", empresaId)
        .or("es_ganada.eq.true,es_perdida.eq.true")
      const idsCerradas = (cerradas ?? []).map((e) => e.id)

      let q = sb
        .from("crm_prospectos")
        .select("id, razon_social, proxima_fecha")
        .eq("idempresa", empresaId)
        .eq("activo", true)
        .lt("proxima_fecha", hoyISO())
      if (idsCerradas.length) q = q.not("etapa_id", "in", `(${idsCerradas.join(",")})`)
      q = filtrarPorVendedor(q, ctx, "vendedor_id")
      const { data } = await q.order("proxima_fecha").limit(20)
      return (data ?? []).map((p) => ({
        tipo: "seguimiento_vencido",
        id: p.id,
        fecha: p.proxima_fecha,
        mensaje: `${p.razon_social}: seguimiento pendiente desde ${p.proxima_fecha}`,
      }))
    },
  },

  // Cotizaciones abiertas que vencen dentro del margen parametrizado.
  cotizaciones: {
    permisos: ["crm_cotizaciones"],
    generar: async (ctx, empresaId) => {
      const sb = await getSupabaseAdminAsSystem()
      const dias = await leerParamNumber(PARAM.COTIZACION_ALERTA_VENCIMIENTO, empresaId, 3)
      const hoy = hoyISO()
      let q = sb
        .from("crm_cotizaciones")
        .select("id, numero, fecha_vencimiento, total")
        .eq("idempresa", empresaId)
        .in("estado", ["borrador", "enviada"])
        .gte("fecha_vencimiento", hoy)
        .lte("fecha_vencimiento", sumarDias(hoy, dias))
      q = filtrarPorVendedor(q, ctx, "vendedor_id")
      const { data } = await q.order("fecha_vencimiento").limit(20)
      return (data ?? []).map((c) => ({
        tipo: "por_vencer",
        id: c.id,
        fecha: c.fecha_vencimiento,
        mensaje: `${c.numero} vence el ${c.fecha_vencimiento} · ${money(Number(c.total) || 0)}`,
      }))
    },
  },

  // Facturas vencidas con saldo.
  cartera: {
    permisos: ["crm_cartera", "crm_recaudos_aprobar"],
    generar: async (ctx, empresaId) => {
      const sb = await getSupabaseAdminAsSystem()
      let q = sb
        .from("crm_cartera_aging")
        .select("id, cliente_nombre, numero_factura, dias_vencido, saldo")
        .eq("idempresa", empresaId)
        .gt("dias_vencido", 0)
      q = filtrarPorVendedor(q, ctx, "vendedor_id")
      const { data } = await q.order("dias_vencido", { ascending: false }).limit(20)
      return (data ?? []).map((c) => ({
        tipo: "vencida",
        id: c.id,
        mensaje: `${c.cliente_nombre ?? "Cliente"}${c.numero_factura ? ` · ${c.numero_factura}` : ""}: ${c.dias_vencido} días · ${money(Number(c.saldo) || 0)}`,
      }))
    },
  },

  // Pedidos que esperan la aprobacion que este usuario puede dar. Respeta el
  // orden: en modo secuencial, a Gerencia no le suena lo que Cartera no ha
  // aprobado todavia.
  autorizaciones: {
    permisos: ["crm_autorizar_contabilidad", "crm_autorizar_gerencia"],
    generar: async (ctx, empresaId) => {
      const sb = await getSupabaseAdminAsSystem()
      const modo: ModoAprobacion = (await leerParam(PARAM.PEDIDO_APROBACION_MODO, empresaId)) === "paralelo" ? "paralelo" : "secuencial"
      const roles = (["contabilidad", "gerencia"] as const).filter((r) =>
        tienePermiso(ctx, r === "contabilidad" ? "crm_autorizar_contabilidad" : "crm_autorizar_gerencia"),
      )
      const { data } = await sb
        .from("crm_pedidos")
        .select("id, numero, total, estado, requiere_sobrecupo, sobrecupo_valor, creado_por, solicitado_por, idpedido_lipgo, auth_contabilidad_en, auth_contabilidad_por, auth_gerencia_en, auth_gerencia_por")
        .eq("idempresa", empresaId)
        .in("estado", ["pendiente_cartera", "pendiente_gerencia"])
        .order("solicitado_en")
        .limit(100)
      return (data ?? [])
        .filter((p) => rolesQueFaltan(p, modo).some((r) => roles.includes(r) && puedeFirmar(p, r, ctx.userId, ctx.nombre, modo).ok))
        .slice(0, 20)
        .map((p) => ({
          tipo: p.requiere_sobrecupo ? "firma_sobrecupo" : "firma",
          id: p.id,
          mensaje: `${p.numero} · ${money(Number(p.total) || 0)} espera tu aprobación${p.requiere_sobrecupo ? ` (sobrecupo ${money(Number(p.sobrecupo_valor) || 0)})` : ""}`,
        }))
    },
  },

  // PED-26: al vendedor, lo que paso con SUS pedidos en los ultimos dias.
  pedidos: {
    permisos: ["crm_pedidos"],
    generar: async (ctx, empresaId) => {
      const sb = await getSupabaseAdminAsSystem()
      const desde = new Date(Date.now() - 3 * 86_400_000).toISOString()
      let q = sb
        .from("crm_pedidos")
        .select("id, numero, estado, motivo_rechazo, rechazado_en, idpedido_lipgo, actualizado_en")
        .eq("idempresa", empresaId)
        .in("estado", ["rechazado", "programado_lipgo", "aprobado"])
        .gte("actualizado_en", desde)
      // Un vendedor ve lo suyo; quien no es vendedor, lo que el mismo creo.
      q = ctx.alcance === "propios" ? filtrarPorVendedor(q, ctx, "vendedor_id") : q.eq("creado_por", ctx.nombre)
      const { data } = await q.order("actualizado_en", { ascending: false }).limit(20)
      return (data ?? []).map((p) => ({
        tipo: p.estado === "rechazado" ? "rechazado" : "aprobado",
        id: p.id,
        fecha: p.actualizado_en,
        mensaje:
          p.estado === "rechazado"
            ? `${p.numero} rechazado: ${p.motivo_rechazo ?? "sin motivo"}. Corrígelo y reenvíalo.`
            : `${p.numero} aprobado${p.idpedido_lipgo ? ` · en LIPgo #${p.idpedido_lipgo}` : ""}`,
      }))
    },
  },

  // Recaudos: a Cartera, los que esperan aprobacion (primero los que tienen
  // diferencias con el comprobante); al vendedor, sus rechazados recientes.
  recaudos: {
    permisos: ["crm_recaudos_aprobar", "crm_recaudos_registrar", "crm_pagos"],
    generar: async (ctx, empresaId) => {
      const sb = await getSupabaseAdminAsSystem()
      if (tienePermiso(ctx, "crm_recaudos_aprobar")) {
        const { data } = await sb.from("crm_recaudos")
          .select("id, numero, valor, ocr_alertas, registrado_nombre, registrado_por")
          .eq("idempresa", empresaId).eq("estado", "pendiente_aprobacion")
          .neq("registrado_por", ctx.userId)
          .order("registrado_en").limit(30)
        return (data ?? [])
          .sort((a, b) => (b.ocr_alertas?.length ?? 0) - (a.ocr_alertas?.length ?? 0))
          .slice(0, 20)
          .map((r) => ({
            tipo: r.ocr_alertas?.length ? "recaudo_con_alertas" : "recaudo_pendiente",
            id: r.id,
            mensaje: `${r.numero} · ${money(Number(r.valor) || 0)} de ${r.registrado_nombre ?? "vendedor"}${r.ocr_alertas?.length ? " · revisar diferencias" : ""}`,
          }))
      }
      const desde = new Date(Date.now() - 5 * 86_400_000).toISOString()
      let q = sb.from("crm_recaudos").select("id, numero, valor, motivo_rechazo")
        .eq("idempresa", empresaId).eq("estado", "rechazado").gte("rechazado_en", desde)
      q = ctx.alcance === "propios" ? filtrarPorVendedor(q, ctx, "vendedor_id") : q.eq("registrado_por", ctx.userId)
      const { data } = await q.order("rechazado_en", { ascending: false }).limit(20)
      return (data ?? []).map((r) => ({
        tipo: "recaudo_rechazado",
        id: r.id,
        mensaje: `${r.numero} rechazado: ${r.motivo_rechazo ?? "sin motivo"}. Corrígelo y reenvíalo.`,
      }))
    },
  },
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ alerta: string }> }) {
  try {
    const { alerta } = await params
    const m = /^([a-z]+)-alerts$/.exec(alerta)
    const dominio = m ? DOMINIOS[m[1]] : undefined
    if (!dominio) return NextResponse.json({ error: "No existe" }, { status: 404 })

    const ctx = await getContexto()
    if (!ctx || !tienePermiso(ctx, ...dominio.permisos)) return vacio()

    const pedida = Number(request.nextUrl.searchParams.get("empresaId"))
    const empresaId = await empresaPermitida(ctx, Number.isFinite(pedida) && pedida > 0 ? pedida : null)

    const alerts = await dominio.generar(ctx, empresaId)
    return NextResponse.json({ alerts, count: alerts.length })
  } catch (err) {
    console.error("[crm-alerts]", err)
    return vacio()
  }
}
