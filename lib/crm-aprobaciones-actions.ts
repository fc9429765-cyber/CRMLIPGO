"use server"

// Torre de control de aprobaciones (Cartera → Aprobaciones).
//
// Junta en una sola bandeja todo lo que el personal administrativo tiene que
// aprobar: pedidos esperando su firma, recaudos por aprobar y prospectos por
// volver clientes (con sus documentos por revisar). Ordena por antigüedad
// para que lo que más lleva esperando suba primero.
//
// NO DECIDE NADA. Cada pendiente se abre con el mismo diálogo y se aprueba con
// la misma acción de siempre, con sus permisos y reglas (la clave del rol en
// pedidos, el que registró no aprueba, el NIT repetido…). Esta acción solo
// reúne y ordena, y cada sección aparece solo si el usuario tiene el permiso
// de aprobarla: un vendedor que entre aquí no ve sus propios pendientes como
// si fueran tareas suyas.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirSesion, mensajeError, tienePermiso } from "@/lib/crm-auth"
import { leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { getPedidosPendientesDeMiFirma } from "@/lib/crm-pedidos-actions"
import { buscarRecaudos } from "@/lib/crm-recaudos-actions"
import { buscarProspectosAprobacion } from "@/lib/crm-prospectos-aprobacion-actions"
import { puedeFirmar, rolesQueFaltan, ROL_ETIQUETA, type ModoAprobacion, type Rol } from "@/lib/crm-pedidos-estado"
import type { PedidoConDetalle } from "@/lib/crm-pedidos"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export type TipoAprobacion = "pedido" | "recaudo" | "prospecto"

export interface SenalAprobacion {
  texto: string
  tono: "peligro" | "advertencia" | "info"
}

export interface ItemAprobacion {
  /** Unica en la bandeja: tipo + id (+ rol en pedidos). */
  clave: string
  tipo: TipoAprobacion
  id: number
  /** Solo pedidos: con que rol se aprueba. */
  rol: Rol | null
  referencia: string
  /** Cliente o prospecto. */
  titulo: string
  subtitulo: string | null
  clienteId: number | null
  valor: number | null
  solicitadoPor: string | null
  solicitadoEn: string | null
  /** Lo que obliga a mirar con lupa: sobrecupo, alertas del comprobante, NIT repetido… */
  senales: SenalAprobacion[]
}

export interface BandejaAprobaciones {
  items: ItemAprobacion[]
  /** Que puede aprobar este usuario. */
  puede: { pedidos: Rol[]; recaudos: boolean; prospectos: boolean }
  modo: ModoAprobacion
  horasAlerta: number
  /** Los pedidos completos, para abrir su diálogo de aprobación sin otra consulta. */
  pedidos: PedidoConDetalle[]
  consultadoEn: string
}

const pesos = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO")

export async function getBandejaAprobaciones(empresaId = 1): Promise<ActionResult<BandejaAprobaciones>> {
  try {
    const ctx = await exigirSesion()
    const puede = {
      pedidos: [
        ...(tienePermiso(ctx, "crm_autorizar_contabilidad") ? (["contabilidad"] as Rol[]) : []),
        ...(tienePermiso(ctx, "crm_autorizar_gerencia") ? (["gerencia"] as Rol[]) : []),
      ],
      recaudos: tienePermiso(ctx, "crm_recaudos_aprobar"),
      prospectos: tienePermiso(ctx, "crm_prospectos_aprobar"),
    }
    const horasAlerta = Math.max(1, await leerParamNumber(PARAM.APROBACIONES_HORAS_ALERTA, empresaId, 24))

    const [rPed, rRec, rPro] = await Promise.all([
      puede.pedidos.length ? getPedidosPendientesDeMiFirma(empresaId) : Promise.resolve(null),
      puede.recaudos ? buscarRecaudos(empresaId, { estado: "pendiente_aprobacion" }, 1, 200) : Promise.resolve(null),
      puede.prospectos ? buscarProspectosAprobacion("pendiente_aprobacion", empresaId) : Promise.resolve(null),
    ])

    const items: ItemAprobacion[] = []
    const modo: ModoAprobacion = rPed?.success && rPed.data ? rPed.data.modo : "secuencial"
    const pedidos = rPed?.success && rPed.data ? rPed.data.pedidos : []

    // ------------------------------------------------------------- pedidos
    for (const p of pedidos) {
      const rol = rolesQueFaltan(p, modo).find((r) => puede.pedidos.includes(r) && puedeFirmar(p, r, ctx.userId, ctx.nombre, modo).ok)
      if (!rol) continue
      const senales: SenalAprobacion[] = []
      if (p.requiere_sobrecupo) senales.push({ texto: `Sobrecupo ${pesos(Number(p.sobrecupo_valor) || 0)}`, tono: "peligro" })
      if ((p.version ?? 1) > 1) senales.push({ texto: `Reenvío v${p.version}`, tono: "info" })
      if (rol === "gerencia" && p.auth_contabilidad_en) senales.push({ texto: `Cartera aprobó: ${p.auth_contabilidad_nombre ?? "—"}`, tono: "info" })
      items.push({
        clave: `pedido-${p.id}-${rol}`, tipo: "pedido", id: p.id, rol,
        referencia: p.numero ?? `Pedido ${p.id}`,
        titulo: p.cliente_nombre ?? "—",
        subtitulo: [`Firma de ${ROL_ETIQUETA[rol]}`, p.sucursal_nombre, p.owner_nombre].filter(Boolean).join(" · "),
        clienteId: p.cliente_id, valor: Number(p.total) || 0,
        solicitadoPor: p.solicitado_nombre ?? p.creado_por ?? null,
        solicitadoEn: p.solicitado_en ?? p.creado_en ?? null,
        senales,
      })
    }

    // ------------------------------------------------------------ recaudos
    if (rRec?.success && rRec.data) {
      for (const r of rRec.data.filas) {
        const senales: SenalAprobacion[] = []
        if (r.ocr_alertas?.length) senales.push({ texto: `${r.ocr_alertas.length} alerta${r.ocr_alertas.length === 1 ? "" : "s"} del comprobante`, tono: "advertencia" })
        if ((r.version ?? 1) > 1) senales.push({ texto: `Reenvío v${r.version}`, tono: "info" })
        if (!r.comprobante_id) senales.push({ texto: "Sin comprobante", tono: "advertencia" })
        items.push({
          clave: `recaudo-${r.id}`, tipo: "recaudo", id: r.id, rol: null,
          referencia: r.numero ?? `Recaudo ${r.id}`,
          titulo: r.cliente_nombre ?? "—",
          subtitulo: [r.medio_pago_nombre, r.banco_nombre, r.owner_nombre].filter(Boolean).join(" · ") || null,
          clienteId: r.cliente_id, valor: Number(r.valor) || 0,
          solicitadoPor: r.vendedor_nombre ?? r.registrado_nombre ?? null,
          solicitadoEn: r.registrado_en ?? null,
          senales,
        })
      }
    }

    // ---------------------------------------------------------- prospectos
    if (rPro?.success && rPro.data?.length) {
      // Documentos que aún nadie revisó: es la parte "documentación" de la
      // aprobación, y lo que más demora decidir.
      const db = await getSupabaseAdmin()
      const { data: docs } = await db.from("crm_documentos").select("entidad_id")
        .eq("idempresa", empresaId).eq("entidad", "prospecto").eq("estado", "pendiente")
        .in("entidad_id", rPro.data.map((p) => p.id))
      const porRevisar = new Map<number, number>()
      for (const d of docs ?? []) porRevisar.set(d.entidad_id as number, (porRevisar.get(d.entidad_id as number) ?? 0) + 1)

      for (const p of rPro.data) {
        const senales: SenalAprobacion[] = []
        if (p.nitRepetido) senales.push({ texto: "NIT ya existe en LIPgo", tono: "peligro" })
        const n = porRevisar.get(p.id) ?? 0
        if (n) senales.push({ texto: `${n} documento${n === 1 ? "" : "s"} por revisar`, tono: "advertencia" })
        if (p.version > 1) senales.push({ texto: `Reenvío v${p.version}`, tono: "info" })
        items.push({
          clave: `prospecto-${p.id}`, tipo: "prospecto", id: p.id, rol: null,
          referencia: p.codigo ?? `Prospecto ${p.id}`,
          titulo: p.razon_social,
          subtitulo: [p.documento ? `NIT ${p.documento}` : null, p.ciudad, `cupo solicitado ${pesos(Number(p.cupo_solicitado) || 0)}`].filter(Boolean).join(" · "),
          clienteId: null, valor: p.cupo_solicitado != null ? Number(p.cupo_solicitado) : null,
          solicitadoPor: p.vendedor_nombre ?? p.solicitado_nombre ?? null,
          solicitadoEn: p.solicitado_en ?? null,
          senales,
        })
      }
    }

    // Lo más antiguo primero: es lo que más se le debe a quien espera.
    items.sort((a, b) => (Date.parse(a.solicitadoEn ?? "") || 0) - (Date.parse(b.solicitadoEn ?? "") || 0))

    return { success: true, data: { items, puede, modo, horasAlerta, pedidos, consultadoEn: new Date().toISOString() } }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}
