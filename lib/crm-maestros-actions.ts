"use server"

// Lectura y escritura de los maestros (ADM-01).
//
// Una sola accion para los siete maestros, gobernada por lib/crm-maestros.ts:
// el servidor solo escribe las columnas declaradas alli, valida obligatorios y
// tipos, y nunca borra (se desactiva). Borrar un banco con recaudos que lo
// referencian romperia el historial.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirPermiso, exigirSesion, mensajeError } from "@/lib/crm-auth"
import { registrarEvento } from "@/lib/crm-eventos"
import { MAESTROS, type CampoMaestro, type MaestroId } from "@/lib/crm-maestros"
import { normalizarCelularCO } from "@/lib/integraciones/whatsapp"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export type FilaMaestro = Record<string, unknown> & { id: number }

function definicion(id: MaestroId) {
  const def = MAESTROS[id]
  if (!def) throw new Error(`Maestro desconocido: ${id}`)
  return def
}

export async function listarMaestro(id: MaestroId, empresaId = 1): Promise<ActionResult<FilaMaestro[]>> {
  try {
    const ctx = await exigirSesion()
    const def = definicion(id)
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from(def.tabla)
      .select("*")
      .eq("idempresa", empresaId || ctx.empresaId)
      .order(def.orden)
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as FilaMaestro[] }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

/** Opciones (id, nombre) de un maestro, para los selectores de otros. */
export async function opcionesMaestro(
  id: MaestroId,
  empresaId = 1,
): Promise<ActionResult<{ valor: string; etiqueta: string }[]>> {
  try {
    await exigirSesion()
    const def = definicion(id)
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from(def.tabla)
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order(def.columnaNombre)
    if (error) return { success: false, error: error.message }
    return {
      success: true,
      data: (data ?? []).map((f: Record<string, unknown>) => ({
        valor: String(f.id),
        etiqueta: String(f[def.columnaNombre] ?? f.id),
      })),
    }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

/** Convierte y valida un valor segun su campo. Devuelve [valor, error]. */
function convertir(c: CampoMaestro, v: unknown): [unknown, string | null] {
  const vacio = v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0)
  if (vacio) {
    if (c.obligatorio) return [null, `${c.etiqueta} es obligatorio`]
    if (c.tipo === "booleano") return [false, null]
    if (c.tipo === "lista_texto" || c.tipo === "lista_numero") return [[], null]
    return [null, null]
  }
  switch (c.tipo) {
    case "numero": {
      const n = Number(v)
      return Number.isFinite(n) ? [n, null] : [null, `${c.etiqueta} debe ser un número`]
    }
    case "booleano":
      return [v === true || v === "true", null]
    case "select":
      // Los selects referenciados guardan un id numerico; los de opciones fijas, texto.
      if (c.referencia) {
        const n = Number(v)
        return Number.isFinite(n) ? [n, null] : [null, `${c.etiqueta} no es válido`]
      }
      if (c.opciones && !c.opciones.some((o) => o.valor === String(v))) return [null, `${c.etiqueta} no es válido`]
      return [String(v), null]
    case "lista_texto": {
      const lista = (Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean)
      return [lista, null]
    }
    case "lista_numero": {
      const lista = (Array.isArray(v) ? v : String(v).split(",")).map((x) => Number(String(x).trim())).filter(Number.isFinite)
      return [lista, null]
    }
    default:
      return [String(v).trim(), null]
  }
}

/**
 * Crea (sin `filaId`) o actualiza un registro de un maestro.
 * Solo escribe los campos declarados; `soloAlCrear` se ignora al actualizar.
 */
export async function guardarMaestro(
  id: MaestroId,
  valores: Record<string, unknown>,
  filaId?: number,
  empresaId = 1,
): Promise<ActionResult<FilaMaestro>> {
  try {
    const ctx = await exigirPermiso("guardarMaestro", "crm_maestros_admin")
    const def = definicion(id)
    const supabase = await getSupabaseAdmin()

    const fila: Record<string, unknown> = {}
    const errores: string[] = []
    for (const c of def.campos) {
      if (filaId && c.soloAlCrear) continue
      if (!(c.clave in valores) && filaId) continue // actualizacion parcial
      const [v, e] = convertir(c, valores[c.clave])
      if (e) errores.push(e)
      else fila[c.clave] = v
    }

    if (id === "destinatarios" && fila.celular) {
      const cel = normalizarCelularCO(String(fila.celular))
      if (!cel) errores.push("El celular no parece un móvil colombiano")
      else fila.celular = cel
    }
    if (errores.length) return { success: false, error: errores.join(". ") }

    // Solo un impuesto puede ser el de por defecto: se desmarca el anterior
    // antes, o el indice unico rechaza el cambio.
    if (id === "impuestos" && fila.es_default === true) {
      await supabase.from(def.tabla).update({ es_default: false }).eq("idempresa", empresaId).neq("id", filaId ?? -1)
    }

    const q = filaId
      ? supabase.from(def.tabla).update(fila).eq("id", filaId).eq("idempresa", empresaId)
      : supabase.from(def.tabla).insert({ ...fila, idempresa: empresaId })
    const { data, error } = await q.select().single()

    if (error) {
      const msg = error.code === "23505" ? `Ya existe un ${def.singular} con ese código o nombre` : error.message
      return { success: false, error: msg }
    }

    await registrarEvento({
      empresaId,
      entidad: "maestro",
      tipo: filaId ? "editado" : "creado",
      entidadId: (data as FilaMaestro).id,
      usuarioId: ctx.userId,
      usuarioNombre: ctx.nombre,
      datos: { maestro: id, valores: fila },
    })
    return { success: true, data: data as FilaMaestro }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}
