"use server"

// Anticipación logística y radar de atención (Inicio).
//
// EL CRM TERMINA EN "PROGRAMADO EN LIPGO", PERO EL CLIENTE NO: le importa si
// su pedido ya salió. LIPgo registra eso en pedidoscabecera (orden de cargue,
// vehículo, transporte, fecha de entrega). Aquí se lee para que el vendedor y
// Cartera vean el estado real sin abrir LIPgo, y para avisar ANTES de que
// alguien llame: pedidos programados que no han salido, entregas atrasadas,
// productos sin stock en pedidos por despachar.
//
// Ciclo en LIPgo (verificado con datos reales): estado 'aprobado' = programado
// esperando orden de cargue · 'entregado' = salió (ocargue, vehiculo,
// fechadeentrega) · 'parcial' · 'anulado'.
//
// Alcance: un vendedor ve solo lo de sus clientes; las aprobaciones solo las
// ve quien aprueba. Todo es lectura.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirPermiso, exigirSesion, filtrarPorVendedor, mensajeError, tienePermiso } from "@/lib/crm-auth"
import { leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { hoyISO, sumarDias, diasEntre } from "@/lib/crm-fechas"
import { getBandejaAprobaciones } from "@/lib/crm-aprobaciones-actions"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ======================================================== estado en LIPgo

export type FaseLogistica = "sin_lipgo" | "programado" | "en_despacho" | "entregado" | "parcial" | "anulado" | "desconocido"

export interface EstadoLogistico {
  idpedido: number
  fase: FaseLogistica
  etiqueta: string
  fecha_programada: string | null
  fechaordencargue: string | null
  ocargue: string | null
  vehiculo: string | null
  transporte: string | null
  fechadeentrega: string | null
  factura: string | null
  /** Días desde la fecha programada sin salir (solo en 'programado'). */
  diasAtraso: number
}

function faseDe(r: { estado: string | null; fechaordencargue: string | null; fechadeentrega: string | null }): FaseLogistica {
  const e = String(r.estado ?? "").toLowerCase()
  if (e === "anulado") return "anulado"
  if (e === "parcial") return "parcial"
  if (e === "entregado") return r.fechadeentrega ? "entregado" : "en_despacho"
  if (e === "aprobado") return r.fechaordencargue ? "en_despacho" : "programado"
  return "desconocido"
}

const ETIQUETA_FASE: Record<FaseLogistica, string> = {
  sin_lipgo: "Sin pasar a LIPgo",
  programado: "Programado, esperando orden de cargue",
  en_despacho: "En orden de cargue",
  entregado: "Entregado",
  parcial: "Entrega parcial",
  anulado: "Anulado en LIPgo",
  desconocido: "Estado no reconocido",
}

async function leerLipgo(idsLipgo: number[], hoy: string): Promise<Map<number, EstadoLogistico>> {
  const out = new Map<number, EstadoLogistico>()
  if (!idsLipgo.length) return out
  const db = await getSupabaseAdmin()
  for (let i = 0; i < idsLipgo.length; i += 300) {
    const { data } = await db.from("pedidoscabecera")
      .select("idpedido, estado, fecha_programada, fechaordencargue, ocargue, vehiculo, transporte, fechadeentrega, factura")
      .in("idpedido", idsLipgo.slice(i, i + 300))
    for (const r of data ?? []) {
      const fase = faseDe(r)
      const prog = r.fecha_programada ? String(r.fecha_programada).slice(0, 10) : null
      out.set(r.idpedido as number, {
        idpedido: r.idpedido as number, fase, etiqueta: ETIQUETA_FASE[fase],
        fecha_programada: prog, fechaordencargue: r.fechaordencargue ? String(r.fechaordencargue).slice(0, 10) : null,
        ocargue: (r.ocargue as string) ?? null, vehiculo: (r.vehiculo as string) ?? null, transporte: (r.transporte as string) ?? null,
        fechadeentrega: r.fechadeentrega ? String(r.fechadeentrega).slice(0, 10) : null, factura: (r.factura as string) ?? null,
        diasAtraso: fase === "programado" && prog ? Math.max(0, diasEntre(prog, hoy)) : 0,
      })
    }
  }
  return out
}

/** Estado logístico en LIPgo de uno o varios pedidos del CRM (por su id de LIPgo). */
export async function getEstadoLogistico(idsLipgo: number[], empresaId = 1): Promise<ActionResult<Record<number, EstadoLogistico>>> {
  try {
    const ctx = await exigirPermiso("getEstadoLogistico", "crm_pedidos", "crm_cartera", "crm_cotizaciones", "crm_autorizar_contabilidad", "crm_autorizar_gerencia", "crm_recaudos_aprobar", "crm_dashboard")
    const ids = [...new Set(idsLipgo.filter((n) => Number.isFinite(n) && n > 0))].slice(0, 500)
    if (!ids.length) return { success: true, data: {} }
    // Solo pedidos del CRM visibles para este usuario: no se consulta LIPgo a ciegas.
    const db = await getSupabaseAdmin()
    let q = db.from("crm_pedidos").select("idpedido_lipgo").eq("idempresa", empresaId).in("idpedido_lipgo", ids)
    q = filtrarPorVendedor(q, ctx, "vendedor_id")
    const { data } = await q
    const permitidos = (data ?? []).map((p) => p.idpedido_lipgo as number)
    const mapa = await leerLipgo(permitidos, hoyISO())
    return { success: true, data: Object.fromEntries(mapa) }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

// ================================================================= radar

export type TonoRadar = "peligro" | "advertencia" | "info" | "exito"

export interface RadarItem {
  id: string
  texto: string
  detalle?: string
  tono: TonoRadar
  /** Intención serializable para lib/crm-navegacion (irA). */
  intencion?: Record<string, unknown> & { accion: string }
  /** O un módulo a abrir sin datos. */
  modulo?: string
}

export interface RadarGrupo {
  clave: string
  titulo: string
  descripcion: string
  /** Nombre del ícono (se resuelve en el cliente). */
  icono: "truck" | "clock" | "ban" | "stamp" | "rotate" | "wallet" | "file" | "boxes" | "cable" | "calendar"
  tono: TonoRadar
  cantidad: number
  valor?: number
  items: RadarItem[]
  modulo: string
}

export interface Radar {
  grupos: RadarGrupo[]
  total: number
  urgentes: number
  consultadoEl: string
}

const pesos = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO")
const TOPE_ITEMS = 8

export async function getRadar(empresaId = 1): Promise<ActionResult<Radar>> {
  try {
    const ctx = await exigirSesion()
    const db = await getSupabaseAdmin()
    const hoy = hoyISO()
    const [diasCartera, diasCotiz] = await Promise.all([
      leerParamNumber(PARAM.CARTERA_ALERTA_VENCIMIENTO, empresaId, 5),
      leerParamNumber(PARAM.COTIZACION_ALERTA_VENCIMIENTO, empresaId, 3),
    ])
    const vePedidos = tienePermiso(ctx, "crm_pedidos", "crm_cotizaciones", "crm_dashboard", "crm_cartera", "crm_autorizar_contabilidad", "crm_autorizar_gerencia")
    const veCartera = tienePermiso(ctx, "crm_cartera", "crm_pagos", "crm_recaudos_registrar", "crm_recaudos_aprobar", "crm_dashboard")
    const grupos: RadarGrupo[] = []

    // ------------------------------------------------ pedidos y despacho
    if (vePedidos) {
      let q = db.from("crm_pedidos")
        .select("id, numero, cliente_id, estado, idpedido_lipgo, error_lipgo, fecha_programada, total, idempresa_despacho, solicitado_en, actualizado_en")
        .eq("idempresa", empresaId).in("estado", ["aprobado", "programado_lipgo", "rechazado", "pendiente_cartera", "pendiente_gerencia"])
        .order("actualizado_en", { ascending: false }).limit(300)
      q = filtrarPorVendedor(q, ctx, "vendedor_id")
      const { data: peds } = await q
      const pedidos = (peds ?? []) as Record<string, any>[]
      const idsCli = [...new Set(pedidos.map((p) => p.cliente_id as number))]
      const { data: cli } = idsCli.length ? await db.from("clientes").select("id, nombre").in("id", idsCli) : { data: [] }
      const nombre = new Map((cli ?? []).map((c) => [c.id as number, String(c.nombre)]))
      const lipgo = await leerLipgo(pedidos.map((p) => p.idpedido_lipgo).filter((x): x is number => !!x), hoy)

      // Programados en LIPgo que no han salido
      const sinSalir = pedidos
        .filter((p) => p.estado === "programado_lipgo" && p.idpedido_lipgo && lipgo.get(p.idpedido_lipgo)?.fase === "programado")
        .map((p) => ({ p, l: lipgo.get(p.idpedido_lipgo)! }))
        .sort((a, b) => b.l.diasAtraso - a.l.diasAtraso)
      const atrasados = sinSalir.filter((x) => x.l.diasAtraso > 0)
      if (sinSalir.length) {
        grupos.push({
          clave: "despacho", titulo: "Pedidos sin despachar", icono: "truck",
          descripcion: atrasados.length ? `${atrasados.length} ya pasaron su fecha programada` : "Programados en LIPgo, esperando orden de cargue",
          tono: atrasados.length ? "peligro" : "info", cantidad: sinSalir.length, modulo: "Pedidos CRM",
          valor: sinSalir.reduce((s, x) => s + (Number(x.p.total) || 0), 0),
          items: sinSalir.slice(0, TOPE_ITEMS).map(({ p, l }) => ({
            id: `ped-${p.id}`, tono: l.diasAtraso > 0 ? "peligro" : "info",
            texto: `${p.numero ?? `#${p.id}`} · ${nombre.get(p.cliente_id) ?? "—"}`,
            detalle: l.diasAtraso > 0 ? `Programado para ${l.fecha_programada}: lleva ${l.diasAtraso} día${l.diasAtraso === 1 ? "" : "s"} de atraso` : `Programado para ${l.fecha_programada ?? "sin fecha"} · LIPgo #${p.idpedido_lipgo}`,
            intencion: { accion: "ver_pedido", pedidoId: p.id },
          })),
        })
      }

      // En despacho hoy
      const hoyDespacho = pedidos.filter((p) => {
        const l = p.idpedido_lipgo ? lipgo.get(p.idpedido_lipgo) : null
        return l && (l.fase === "en_despacho" || (l.fase === "entregado" && l.fechadeentrega === hoy))
      })
      if (hoyDespacho.length) {
        grupos.push({
          clave: "despacho_hoy", titulo: "En ruta o entregados hoy", icono: "clock", descripcion: "Con orden de cargue en LIPgo",
          tono: "exito", cantidad: hoyDespacho.length, modulo: "Pedidos CRM",
          items: hoyDespacho.slice(0, TOPE_ITEMS).map((p) => {
            const l = lipgo.get(p.idpedido_lipgo)!
            return {
              id: `desp-${p.id}`, tono: "exito" as const, texto: `${p.numero ?? `#${p.id}`} · ${nombre.get(p.cliente_id) ?? "—"}`,
              detalle: [l.ocargue ? `Orden ${l.ocargue}` : null, l.vehiculo, l.transporte, l.fechadeentrega ? `entregado ${l.fechadeentrega}` : null].filter(Boolean).join(" · "),
              intencion: { accion: "ver_pedido", pedidoId: p.id },
            }
          }),
        })
      }

      // Aprobados que no llegaron a LIPgo
      const sinLipgo = pedidos.filter((p) => p.estado === "aprobado" || (p.estado === "programado_lipgo" && !p.idpedido_lipgo) || !!p.error_lipgo)
      if (sinLipgo.length) {
        grupos.push({
          clave: "sin_lipgo", titulo: "Aprobados sin pasar a LIPgo", icono: "ban", descripcion: "No se van a despachar hasta que entren a LIPgo",
          tono: "peligro", cantidad: sinLipgo.length, modulo: "Pedidos CRM",
          items: sinLipgo.slice(0, TOPE_ITEMS).map((p) => ({
            id: `nolip-${p.id}`, tono: "peligro" as const, texto: `${p.numero ?? `#${p.id}`} · ${nombre.get(p.cliente_id) ?? "—"}`,
            detalle: p.error_lipgo ? `Error: ${String(p.error_lipgo).slice(0, 90)}` : "Aprobado; pendiente de programar en LIPgo",
            intencion: { accion: "ver_pedido", pedidoId: p.id },
          })),
        })
      }

      // Rechazados sin reenviar (del vendedor)
      const rechazados = pedidos.filter((p) => p.estado === "rechazado")
      if (rechazados.length) {
        grupos.push({
          clave: "rechazados", titulo: "Pedidos rechazados por corregir", icono: "rotate", descripcion: "Se corrigen y se reenvían a aprobación",
          tono: "advertencia", cantidad: rechazados.length, modulo: "Pedidos CRM",
          items: rechazados.slice(0, TOPE_ITEMS).map((p) => ({
            id: `rech-${p.id}`, tono: "advertencia" as const, texto: `${p.numero ?? `#${p.id}`} · ${nombre.get(p.cliente_id) ?? "—"}`,
            intencion: { accion: "ver_pedido", pedidoId: p.id },
          })),
        })
      }

      // Stock insuficiente en pedidos por despachar
      const porDespachar = pedidos.filter((p) => ["pendiente_cartera", "pendiente_gerencia", "aprobado"].includes(p.estado) || (p.estado === "programado_lipgo" && lipgo.get(p.idpedido_lipgo)?.fase === "programado"))
      if (porDespachar.length) {
        const { data: lineas } = await db.from("crm_pedido_detalle").select("pedido_id, producto_id, producto_nombre, cantidad")
          .in("pedido_id", porDespachar.map((p) => p.id))
        const idsProd = [...new Set((lineas ?? []).map((l) => l.producto_id).filter((x): x is number => x != null))]
        const { data: inv } = idsProd.length ? await db.from("crm_inventario_producto").select("producto_id, stock_disponible, por_sede").in("producto_id", idsProd) : { data: [] }
        const stockDe = new Map((inv ?? []).map((i) => [Number(i.producto_id), i]))
        const faltas: RadarItem[] = []
        for (const p of porDespachar) {
          const porCentro = (l: Record<string, any>) => {
            const inv = stockDe.get(Number(l.producto_id))
            if (!inv) return null
            const sede = (inv.por_sede as { idempresa: number; disponible: number }[] | null)?.find((s) => s.idempresa === p.idempresa_despacho)
            return sede ? Number(sede.disponible) : Number(inv.stock_disponible)
          }
          const sinStock = (lineas ?? []).filter((l) => l.pedido_id === p.id).map((l) => ({ l, disp: porCentro(l) }))
            .filter((x) => x.disp != null && x.disp < Number(x.l.cantidad))
          if (sinStock.length) {
            faltas.push({
              id: `stock-${p.id}`, tono: "peligro", texto: `${p.numero ?? `#${p.id}`} · ${nombre.get(p.cliente_id) ?? "—"}`,
              detalle: sinStock.slice(0, 2).map((x) => `${x.l.producto_nombre}: pide ${Number(x.l.cantidad).toLocaleString("es-CO")}, hay ${Number(x.disp).toLocaleString("es-CO")}`).join(" · ") + (sinStock.length > 2 ? ` · +${sinStock.length - 2}` : ""),
              intencion: { accion: "ver_pedido", pedidoId: p.id },
            })
          }
        }
        if (faltas.length) {
          grupos.push({
            clave: "stock", titulo: "Pedidos con stock insuficiente", icono: "boxes", descripcion: "El centro de despacho no tiene todo lo que piden",
            tono: "peligro", cantidad: faltas.length, modulo: "Pedidos CRM", items: faltas.slice(0, TOPE_ITEMS),
          })
        }
      }
    }

    // ------------------------------------------------------ aprobaciones
    const bandeja = await getBandejaAprobaciones(empresaId)
    if (bandeja.success && bandeja.data?.items.length) {
      const b = bandeja.data
      const tarde = b.items.filter((i) => i.solicitadoEn && (Date.now() - Date.parse(i.solicitadoEn)) / 3_600_000 > b.horasAlerta).length
      grupos.push({
        clave: "aprobaciones", titulo: "Esperando tu aprobación", icono: "stamp",
        descripcion: tarde ? `${tarde} llevan más de ${b.horasAlerta} h` : "Pedidos, recaudos y clientes nuevos",
        tono: tarde ? "peligro" : "advertencia", cantidad: b.items.length, modulo: "Aprobaciones",
        valor: b.items.reduce((s, i) => s + (i.valor ?? 0), 0),
        items: b.items.slice(0, TOPE_ITEMS).map((i) => ({
          id: i.clave, tono: "advertencia" as const,
          texto: `${i.tipo === "pedido" ? "Pedido" : i.tipo === "recaudo" ? "Recaudo" : "Cliente nuevo"} ${i.referencia} · ${i.titulo}`,
          detalle: i.senales.map((s) => s.texto).join(" · ") || undefined,
          modulo: "Aprobaciones",
        })),
      })
    }

    // ------------------------------------------------------------ cartera
    if (veCartera) {
      let q = db.from("crm_cuentas_cobrar").select("id, cliente_id, numero_factura, fecha_vencimiento, saldo")
        .eq("idempresa", empresaId).in("estado", ["pendiente", "parcial"]).gt("saldo", 0).lte("fecha_vencimiento", sumarDias(hoy, diasCartera))
        .order("fecha_vencimiento").limit(500)
      q = filtrarPorVendedor(q, ctx, "vendedor_id")
      const { data: cxc } = await q
      const filas = (cxc ?? []) as Record<string, any>[]
      const vencidas = filas.filter((f) => f.fecha_vencimiento < hoy)
      const porVencer = filas.filter((f) => f.fecha_vencimiento >= hoy)
      const idsCli = [...new Set(filas.map((f) => f.cliente_id as number))]
      const { data: cli } = idsCli.length ? await db.from("clientes").select("id, nombre").in("id", idsCli) : { data: [] }
      const nombre = new Map((cli ?? []).map((c) => [c.id as number, String(c.nombre)]))
      const agrupar = (lista: Record<string, any>[]) => {
        const m = new Map<number, { saldo: number; n: number; max: number }>()
        for (const f of lista) {
          const g = m.get(f.cliente_id) ?? { saldo: 0, n: 0, max: 0 }
          g.saldo += Number(f.saldo); g.n++; g.max = Math.max(g.max, Math.abs(diasEntre(f.fecha_vencimiento, hoy)))
          m.set(f.cliente_id, g)
        }
        return [...m.entries()].sort((a, b) => b[1].saldo - a[1].saldo)
      }
      if (vencidas.length) {
        const g = agrupar(vencidas)
        grupos.push({
          clave: "vencidas", titulo: "Cartera vencida", icono: "wallet", descripcion: `${g.length} cliente${g.length === 1 ? "" : "s"} con facturas vencidas`,
          tono: "peligro", cantidad: vencidas.length, modulo: "Cuentas por Cobrar", valor: vencidas.reduce((s, f) => s + Number(f.saldo), 0),
          items: g.slice(0, TOPE_ITEMS).map(([cid, x]) => ({
            id: `venc-${cid}`, tono: "peligro" as const, texto: nombre.get(cid) ?? `Cliente ${cid}`,
            detalle: `${pesos(x.saldo)} en ${x.n} factura${x.n === 1 ? "" : "s"} · hasta ${x.max} días de mora`,
            intencion: { accion: "ver_cartera_cliente", clienteId: cid, nombre: nombre.get(cid) },
          })),
        })
      }
      if (porVencer.length) {
        const g = agrupar(porVencer)
        grupos.push({
          clave: "por_vencer", titulo: `Vencen en ${diasCartera} días`, icono: "calendar", descripcion: "Recordar el pago antes de que venzan",
          tono: "advertencia", cantidad: porVencer.length, modulo: "Cuentas por Cobrar", valor: porVencer.reduce((s, f) => s + Number(f.saldo), 0),
          items: g.slice(0, TOPE_ITEMS).map(([cid, x]) => ({
            id: `pv-${cid}`, tono: "advertencia" as const, texto: nombre.get(cid) ?? `Cliente ${cid}`,
            detalle: `${pesos(x.saldo)} en ${x.n} factura${x.n === 1 ? "" : "s"}`,
            intencion: { accion: "registrar_pago", clienteId: cid },
          })),
        })
      }

      // Recaudos rechazados sin corregir
      if (tienePermiso(ctx, "crm_recaudos_registrar", "crm_pagos", "crm_recaudos_aprobar")) {
        let qr = db.from("crm_recaudos").select("id, numero, cliente_id, valor, motivo_rechazo").eq("idempresa", empresaId).eq("estado", "rechazado").limit(50)
        qr = filtrarPorVendedor(qr, ctx, "vendedor_id")
        const { data: rec } = await qr
        if (rec?.length) {
          const ids = [...new Set(rec.map((r) => r.cliente_id as number))].filter((id) => !nombre.has(id))
          const { data: cli2 } = ids.length ? await db.from("clientes").select("id, nombre").in("id", ids) : { data: [] }
          for (const c of cli2 ?? []) nombre.set(c.id as number, String(c.nombre))
          grupos.push({
            clave: "recaudos_rechazados", titulo: "Recaudos rechazados por corregir", icono: "rotate", descripcion: "Cartera pidió corregirlos",
            tono: "advertencia", cantidad: rec.length, modulo: "Registrar Pago",
            items: rec.slice(0, TOPE_ITEMS).map((r) => ({
              id: `rr-${r.id}`, tono: "advertencia" as const, texto: `${r.numero} · ${nombre.get(r.cliente_id as number) ?? "—"} · ${pesos(Number(r.valor))}`,
              detalle: (r.motivo_rechazo as string) ?? undefined, modulo: "Registrar Pago",
            })),
          })
        }
      }
    }

    // ------------------------------------------------------- cotizaciones
    if (tienePermiso(ctx, "crm_cotizaciones", "crm_pedidos")) {
      let q = db.from("crm_cotizaciones").select("id, numero, cliente_id, prospecto_id, total, fecha_vencimiento")
        .eq("idempresa", empresaId).in("estado", ["borrador", "enviada"]).gte("fecha_vencimiento", hoy).lte("fecha_vencimiento", sumarDias(hoy, diasCotiz))
        .order("fecha_vencimiento").limit(100)
      q = filtrarPorVendedor(q, ctx, "vendedor_id")
      const { data: cots } = await q
      if (cots?.length) {
        const ids = [...new Set(cots.map((c) => c.cliente_id).filter((x): x is number => !!x))]
        const { data: cli } = ids.length ? await db.from("clientes").select("id, nombre").in("id", ids) : { data: [] }
        const nombre = new Map((cli ?? []).map((c) => [c.id as number, String(c.nombre)]))
        grupos.push({
          clave: "cotizaciones", titulo: "Cotizaciones por vencer", icono: "file", descripcion: `Vencen en ${diasCotiz} días o menos: cerrar o renovar`,
          tono: "info", cantidad: cots.length, modulo: "Cotizaciones", valor: cots.reduce((s, c) => s + (Number(c.total) || 0), 0),
          items: cots.slice(0, TOPE_ITEMS).map((c) => ({
            id: `cot-${c.id}`, tono: "info" as const, texto: `${c.numero} · ${c.cliente_id ? nombre.get(c.cliente_id) ?? "—" : "prospecto"} · ${pesos(Number(c.total))}`,
            detalle: `Vence ${c.fecha_vencimiento}`,
            intencion: c.cliente_id ? { accion: "ver_cotizaciones_cliente", clienteId: c.cliente_id, texto: c.numero } : { accion: "ver_cotizaciones_cliente", texto: c.numero },
          })),
        })
      }
    }

    // ------------------------------------------------------------- agenda
    if (tienePermiso(ctx, "crm_agenda")) {
      let q = db.from("crm_agenda").select("id, titulo, fecha, hora_inicio").eq("idempresa", empresaId).eq("estado", "pendiente").lt("fecha", hoy).limit(50)
      q = ctx.alcance === "propios" ? filtrarPorVendedor(q, ctx, "vendedor_id") : q.eq("usuario_asignado", ctx.userId)
      const { data: citas } = await q
      if (citas?.length) {
        grupos.push({
          clave: "agenda", titulo: "Visitas atrasadas", icono: "calendar", descripcion: "Compromisos pendientes de días anteriores",
          tono: "advertencia", cantidad: citas.length, modulo: "Mi Agenda",
          items: citas.slice(0, TOPE_ITEMS).map((c) => ({ id: `ag-${c.id}`, tono: "advertencia" as const, texto: String(c.titulo), detalle: `${c.fecha}${c.hora_inicio ? ` · ${String(c.hora_inicio).slice(0, 5)}` : ""}`, modulo: "Mi Agenda" })),
        })
      }
    }

    // ------------------------------------------------------ integraciones
    if (tienePermiso(ctx, "crm_integraciones_admin")) {
      const { data: err } = await db.from("crm_integracion_outbox").select("id, sistema, entidad, entidad_id, ultimo_error").eq("idempresa", empresaId).eq("estado", "error").limit(20)
      if (err?.length) {
        grupos.push({
          clave: "integraciones", titulo: "Envíos con error", icono: "cable", descripcion: "SAP, WhatsApp o LIPgo rechazaron el envío",
          tono: "advertencia", cantidad: err.length, modulo: "Integraciones",
          items: err.slice(0, TOPE_ITEMS).map((e) => ({ id: `ob-${e.id}`, tono: "advertencia" as const, texto: `${String(e.sistema).toUpperCase()} · ${e.entidad} ${e.entidad_id ?? ""}`, detalle: (e.ultimo_error as string)?.slice(0, 100), modulo: "Integraciones" })),
        })
      }
    }

    const orden: Record<TonoRadar, number> = { peligro: 0, advertencia: 1, info: 2, exito: 3 }
    grupos.sort((a, b) => orden[a.tono] - orden[b.tono] || b.cantidad - a.cantidad)
    return {
      success: true,
      data: { grupos, total: grupos.reduce((s, g) => s + g.cantidad, 0), urgentes: grupos.filter((g) => g.tono === "peligro").reduce((s, g) => s + g.cantidad, 0), consultadoEl: new Date().toISOString() },
    }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

