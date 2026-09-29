// Documentos en almacenamiento PRIVADO (script 201). Solo servidor.
//
// SIN "use server": subir y firmar son operaciones del servidor. El navegador
// nunca recibe una ruta del bucket, solo URLs firmadas que caducan
// (`documentos.url_minutos`), y solo despues de que la accion que la entrega
// valido que el usuario puede ver ese documento.

import { createHash, randomUUID } from "node:crypto"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import type { ContextoCrm } from "@/lib/crm-auth"

export const BUCKET_PRIVADO = "crm-privado"
const MAX_BYTES = 10 * 1024 * 1024
const MIMES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
}

export type EntidadDocumento = "recaudo" | "prospecto" | "cliente"

export function huella(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** Valida tipo y tamaño. Devuelve el error o null. */
export function validarArchivo(mime: string, tamano: number): string | null {
  if (!MIMES[mime]) return "Solo se aceptan fotos (JPG, PNG, WebP) o PDF"
  if (tamano > MAX_BYTES) return "El archivo supera 10 MB"
  if (tamano === 0) return "El archivo está vacío"
  return null
}

/**
 * Busca si esta misma huella ya sustenta otro recaudo. Es la forma mas
 * sencilla de cobrar dos veces el mismo pago: reportar la misma foto dos veces.
 */
export async function recaudoConMismoComprobante(empresaId: number, sha: string, excluirRecaudoId?: number) {
  const db = await getSupabaseAdminAsSystem()
  let q = db.from("crm_documentos").select("entidad_id").eq("idempresa", empresaId).eq("entidad", "recaudo").eq("sha256", sha)
  if (excluirRecaudoId) q = q.neq("entidad_id", excluirRecaudoId)
  const { data } = await q.limit(1)
  if (!data?.length) return null
  const { data: r } = await db.from("crm_recaudos").select("id, numero, estado").eq("id", data[0].entidad_id).maybeSingle()
  return r as { id: number; numero: string; estado: string } | null
}

export async function guardarDocumento(p: {
  empresaId: number
  entidad: EntidadDocumento
  entidadId: number
  tipoCodigo: string
  bytes: Uint8Array
  mime: string
  nombre: string
  /** Quien sube. `userId` null = el propio prospecto por el enlace publico. */
  ctx: Pick<ContextoCrm, "nombre"> & { userId: string | null }
  ocr?: unknown
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const invalido = validarArchivo(p.mime, p.bytes.byteLength)
  if (invalido) return { ok: false, error: invalido }

  const db = await getSupabaseAdminAsSystem()
  const sha = huella(p.bytes)
  const anio = new Date().getFullYear()
  const ruta = `${p.empresaId}/${p.entidad}/${anio}/${p.entidadId}/${randomUUID()}.${MIMES[p.mime]}`

  const { error: eSub } = await db.storage.from(BUCKET_PRIVADO).upload(ruta, p.bytes, { contentType: p.mime, upsert: false })
  if (eSub) return { ok: false, error: `No se pudo guardar el archivo: ${eSub.message}` }

  const { data: tipo } = await db.from("crm_tipos_documento").select("id")
    .eq("idempresa", p.empresaId).eq("entidad", p.entidad).eq("codigo", p.tipoCodigo).maybeSingle()

  const { data, error } = await db.from("crm_documentos").insert({
    idempresa: p.empresaId, entidad: p.entidad, entidad_id: p.entidadId, tipo_documento_id: tipo?.id ?? null,
    bucket: BUCKET_PRIVADO, storage_path: ruta, nombre_archivo: p.nombre, mime: p.mime, tamano: p.bytes.byteLength,
    sha256: sha, ocr_resultado: p.ocr ?? null, subido_por: p.ctx.userId, subido_nombre: p.ctx.nombre,
  }).select("id").single()

  if (error) {
    // Si la fila no se pudo crear, el archivo no debe quedar huerfano.
    await db.storage.from(BUCKET_PRIVADO).remove([ruta])
    return { ok: false, error: error.code === "23505" ? "Ese comprobante ya fue reportado en otro recaudo" : error.message }
  }
  return { ok: true, id: data.id as number }
}

/**
 * URL temporal para ver un documento. Quien la pide ya fue autorizado.
 * `segundos` reemplaza la validez por defecto (`documentos.url_minutos`):
 * un estado de cuenta que se le envia al cliente tiene que abrir dias
 * despues, un comprobante que mira Cartera no.
 */
export async function urlFirmada(
  documentoId: number,
  empresaId: number,
  segundos?: number,
): Promise<{ url: string; mime: string; nombre: string | null } | null> {
  const db = await getSupabaseAdminAsSystem()
  const { data: doc } = await db.from("crm_documentos").select("bucket, storage_path, mime, nombre_archivo")
    .eq("id", documentoId).eq("idempresa", empresaId).maybeSingle()
  if (!doc) return null
  const validez = segundos ?? Math.max(1, await leerParamNumber(PARAM.DOCUMENTOS_URL_MINUTOS, empresaId, 10)) * 60
  const { data } = await db.storage.from(doc.bucket).createSignedUrl(doc.storage_path, Math.max(60, Math.round(validez)))
  return data?.signedUrl ? { url: data.signedUrl, mime: doc.mime, nombre: doc.nombre_archivo } : null
}
