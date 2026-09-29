"use server"

// Mapeos SAP y prueba de conexion (INT-03, INT-06). Todo exige
// crm_integraciones_admin: un codigo mal puesto manda un pedido al cliente
// equivocado en contabilidad.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirPermiso, mensajeError, tienePermiso } from "@/lib/crm-auth"
import { registrarEvento } from "@/lib/crm-eventos"
import { leerParam } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { modoSapActual } from "@/lib/integraciones/outbox"
import { probarServiceLayer } from "@/lib/integraciones/sap/gateways"
import { traducirEvento } from "@/lib/integraciones/sap/contexto"
import type { EntidadMapeo } from "@/lib/integraciones/sap/traductor"
import type { ModoSap } from "@/lib/integraciones/tipos"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

const PERMISO = "crm_integraciones_admin"
const ENTIDADES: EntidadMapeo[] = ["cliente", "sucursal", "producto", "vendedor", "centro", "factura", "condicion_pago"]

async function exigirAdmin(accion: string) {
  const ctx = await exigirPermiso(accion, PERMISO)
  // Escribe codigos que deciden a donde va la plata en SAP: se exige aunque
  // la seguridad este en modo registro.
  if (!tienePermiso(ctx, PERMISO)) throw new Error("No tienes permiso para administrar integraciones")
  return ctx
}

export interface FilaMapeo {
  entidadId: number
  nombre: string
  detalle: string | null
  /** Codigo propuesto desde LIPgo (codigo del producto, prefijo + NIT). */
  sugerido: string | null
  codigoSap: string | null
}

/** Las filas del CRM de una entidad, con su codigo SAP si lo tienen. */
export async function listarMapeos(
  entidad: EntidadMapeo, texto = "", soloSinCodigo = false, empresaId = 1,
): Promise<ActionResult<{ filas: FilaMapeo[]; total: number; mapeados: number }>> {
  try {
    await exigirAdmin("listarMapeos")
    if (!ENTIDADES.includes(entidad)) return { success: false, error: "Entidad no válida" }
    const db = await getSupabaseAdmin()
    const t = texto.trim()
    const prefijo = (await leerParam(PARAM.SAP_PREFIJO_CLIENTE, empresaId)) || "C"
    let base: FilaMapeo[] = []

    switch (entidad) {
      case "cliente": {
        let q = db.from("clientes").select("id, nombre, documento").eq("id_empresa", empresaId).order("nombre").limit(2000)
        if (t) q = /^\d+$/.test(t) ? q.eq("documento", Number(t)) : q.ilike("nombre", `%${t}%`)
        const { data } = await q
        base = (data ?? []).map((c) => ({ entidadId: c.id as number, nombre: String(c.nombre), detalle: c.documento ? `NIT ${c.documento}` : null, sugerido: c.documento ? `${prefijo}${c.documento}` : null, codigoSap: null }))
        break
      }
      case "producto": {
        let q = db.from("productos").select("id, nombre, codigo, owner").order("nombre").limit(2000)
        if (t) q = q.or(`nombre.ilike.%${t}%,codigo.ilike.%${t}%`)
        const { data } = await q
        base = (data ?? []).map((p) => ({ entidadId: Number(p.id), nombre: String(p.nombre), detalle: [p.codigo ? `Código LIPgo ${p.codigo}` : null, p.owner].filter(Boolean).join(" · ") || null, sugerido: p.codigo ? String(p.codigo) : null, codigoSap: null }))
        break
      }
      case "vendedor": {
        const { data } = await db.from("vendedores").select("idvendedor, nombre, cedula").eq("id_empresa", empresaId).order("nombre")
        base = (data ?? []).filter((v) => !t || String(v.nombre).toLowerCase().includes(t.toLowerCase()))
          .map((v) => ({ entidadId: v.idvendedor as number, nombre: String(v.nombre), detalle: v.cedula ? `CC ${v.cedula}` : null, sugerido: null, codigoSap: null }))
        break
      }
      case "sucursal": {
        let q = db.from("bodegas").select("idbodega, nombrebodega, ciudad, clienteid").eq("idempresa", empresaId).not("clienteid", "is", null).order("nombrebodega").limit(2000)
        if (t) q = q.ilike("nombrebodega", `%${t}%`)
        const { data } = await q
        base = (data ?? []).map((b) => ({ entidadId: b.idbodega as number, nombre: String(b.nombrebodega), detalle: [b.ciudad, `cliente #${b.clienteid}`].filter(Boolean).join(" · "), sugerido: null, codigoSap: null }))
        break
      }
      case "centro": {
        const { data } = await db.from("empresas").select("id, nombre, ciudad").order("id")
        base = (data ?? []).map((e) => ({ entidadId: e.id as number, nombre: String(e.nombre), detalle: e.ciudad ? String(e.ciudad) : null, sugerido: null, codigoSap: null }))
        break
      }
      case "factura": {
        let q = db.from("crm_cuentas_cobrar").select("id, numero_factura, fecha_factura, saldo, cliente_id").eq("idempresa", empresaId)
          .in("estado", ["pendiente", "parcial"]).order("fecha_factura", { ascending: false }).limit(2000)
        if (t) q = q.ilike("numero_factura", `%${t}%`)
        const { data } = await q
        base = (data ?? []).map((f) => ({ entidadId: f.id as number, nombre: f.numero_factura ? String(f.numero_factura) : `CxC ${f.id} (sin número)`, detalle: `${f.fecha_factura} · cliente #${f.cliente_id} · saldo $ ${Math.round(Number(f.saldo)).toLocaleString("es-CO")}`, sugerido: null, codigoSap: null }))
        break
      }
      case "condicion_pago": {
        const { data } = await db.from("clientes").select("dias_credito").eq("id_empresa", empresaId).limit(5000)
        const dias = [...new Set([0, ...(data ?? []).map((c) => Number(c.dias_credito) || 0)])].sort((a, b) => a - b)
        base = dias.map((d) => ({ entidadId: d, nombre: d === 0 ? "Contado" : `${d} días`, detalle: null, sugerido: null, codigoSap: null }))
        break
      }
    }

    const ids = base.map((b) => b.entidadId)
    const codigos = new Map<number, string>()
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await db.from("crm_sap_mapeo").select("entidad_id, codigo_sap").eq("idempresa", empresaId).eq("entidad", entidad).in("entidad_id", ids.slice(i, i + 500))
      for (const m of data ?? []) codigos.set(Number(m.entidad_id), String(m.codigo_sap))
    }
    const filas = base.map((b) => ({ ...b, codigoSap: codigos.get(b.entidadId) ?? null }))
    const mapeados = filas.filter((f) => f.codigoSap).length
    return {
      success: true,
      data: { filas: soloSinCodigo ? filas.filter((f) => !f.codigoSap) : filas, total: filas.length, mapeados },
    }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

/** Guarda (o borra, con codigo vacio) el codigo SAP de una fila. */
export async function guardarMapeo(entidad: EntidadMapeo, entidadId: number, codigo: string | null, empresaId = 1): Promise<ActionResult> {
  try {
    const ctx = await exigirAdmin("guardarMapeo")
    if (!ENTIDADES.includes(entidad)) return { success: false, error: "Entidad no válida" }
    const db = await getSupabaseAdmin()
    const c = (codigo ?? "").trim()
    if (c.length > 50) return { success: false, error: "El código es demasiado largo" }
    const { error } = c
      ? await db.from("crm_sap_mapeo").upsert(
          { idempresa: empresaId, entidad, entidad_id: entidadId, codigo_sap: c, actualizado_por: ctx.nombre, actualizado_en: new Date().toISOString() },
          { onConflict: "idempresa,entidad,entidad_id" })
      : await db.from("crm_sap_mapeo").delete().eq("idempresa", empresaId).eq("entidad", entidad).eq("entidad_id", entidadId)
    if (error) return { success: false, error: error.message }
    await registrarEvento({
      empresaId, entidad: "integracion", tipo: "mapeo_sap", usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      datos: { entidad, entidad_id: entidadId, codigo_sap: c || null },
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

/**
 * Llena con lo sugerido desde LIPgo (codigo del producto, prefijo + NIT) las
 * filas que aun no tienen codigo. Nunca pisa uno puesto a mano.
 */
export async function aplicarSugeridos(entidad: "producto" | "cliente", empresaId = 1): Promise<ActionResult<{ aplicados: number }>> {
  try {
    const ctx = await exigirAdmin("aplicarSugeridos")
    const r = await listarMapeos(entidad, "", true, empresaId)
    if (!r.success || !r.data) return { success: false, error: r.error }
    const filas = r.data.filas.filter((f) => f.sugerido)
    const db = await getSupabaseAdmin()
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await db.from("crm_sap_mapeo").upsert(
        filas.slice(i, i + 500).map((f) => ({
          idempresa: empresaId, entidad, entidad_id: f.entidadId, codigo_sap: f.sugerido, actualizado_por: `${ctx.nombre} (sugerido)`,
          actualizado_en: new Date().toISOString(),
        })),
        { onConflict: "idempresa,entidad,entidad_id", ignoreDuplicates: true },
      )
      if (error) return { success: false, error: error.message }
    }
    await registrarEvento({ empresaId, entidad: "integracion", tipo: "mapeo_sap_sugerido", usuarioId: ctx.userId, usuarioNombre: ctx.nombre, datos: { entidad, aplicados: filas.length } })
    return { success: true, data: { aplicados: filas.length } }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

export interface PendienteMapeo {
  faltante: string
  eventos: number
}

/**
 * Lo que impide enviar a SAP lo que hoy esta en la bandeja: se traduce cada
 * evento pendiente con los codigos actuales y se agrupa lo que falta. Es la
 * lista de tareas antes de pasar a SAP_MODE=live.
 */
export async function getPendientesMapeo(empresaId = 1): Promise<ActionResult<{ eventos: number; listos: number; pendientes: PendienteMapeo[] }>> {
  try {
    await exigirAdmin("getPendientesMapeo")
    const db = await getSupabaseAdmin()
    const { data } = await db.from("crm_integracion_outbox").select("operacion, payload")
      .eq("idempresa", empresaId).eq("sistema", "sap").in("estado", ["pendiente", "error"]).limit(300)
    const cuenta = new Map<string, number>()
    let listos = 0
    for (const e of data ?? []) {
      const t = await traducirEvento(empresaId, e.operacion as string, e.payload as Record<string, unknown>)
      if (t.ok) { listos++; continue }
      for (const f of t.faltantes) cuenta.set(f, (cuenta.get(f) ?? 0) + 1)
    }
    return {
      success: true,
      data: {
        eventos: (data ?? []).length,
        listos,
        pendientes: [...cuenta.entries()].map(([faltante, eventos]) => ({ faltante, eventos })).sort((a, b) => b.eventos - a.eventos),
      },
    }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

export async function probarConexionSap(): Promise<ActionResult<{ modo: ModoSap; ok: boolean; ms: number; detalle: string }>> {
  try {
    const ctx = await exigirAdmin("probarConexionSap")
    const modo = modoSapActual()
    // Se prueba la conexion real aunque el modo no sea live: es justo lo que
    // hay que saber ANTES de cambiarlo.
    const r = await probarServiceLayer()
    await registrarEvento({
      empresaId: ctx.empresaId, entidad: "integracion", tipo: "prueba_conexion_sap", usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      datos: { modo, ok: r.ok, ms: r.ms, detalle: r.detalle },
    })
    return { success: true, data: { modo, ...r } }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}
