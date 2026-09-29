// Expediente del prospecto: lecturas y reglas del servidor (PRO-01, PRO-05).
//
// SIN "use server": no valida permisos. Lo usan las acciones del CRM (que si
// validan sesion, permiso y alcance) y la ruta publica del enlace de carga
// (que valida el token). Ninguna de estas funciones debe ser invocable desde
// el navegador por si sola.

import { createHash, randomBytes } from "node:crypto"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { leerParamBool } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import {
  evaluarExpediente, puedeEditarExpediente,
  type DocumentoExpediente, type EstadoAprobacionProspecto, type EvaluacionExpediente, type TipoDocumento,
} from "@/lib/crm-prospectos-aprobacion"

/** Tope de archivos por prospecto: el enlace publico no puede llenar el bucket. */
export const MAX_DOCUMENTOS_PROSPECTO = 40

export async function tiposDocumentoProspecto(empresaId: number): Promise<TipoDocumento[]> {
  const db = await getSupabaseAdminAsSystem()
  const { data } = await db.from("crm_tipos_documento")
    .select("id, codigo, nombre, obligatorio, ayuda, orden")
    .eq("idempresa", empresaId).eq("entidad", "prospecto").eq("activo", true).order("orden")
  return (data ?? []) as TipoDocumento[]
}

export async function documentosDe(empresaId: number, entidad: "prospecto" | "cliente", id: number): Promise<DocumentoExpediente[]> {
  const db = await getSupabaseAdminAsSystem()
  const { data } = await db.from("crm_documentos")
    .select("id, tipo_documento_id, nombre_archivo, mime, tamano, estado, subido_nombre, subido_en, nota")
    .eq("idempresa", empresaId).eq("entidad", entidad).eq("entidad_id", id).order("subido_en")
  return (data ?? []) as DocumentoExpediente[]
}

export interface ProspectoExpediente {
  id: number
  idempresa: number
  codigo: string | null
  razon_social: string
  nombre_comercial: string | null
  documento: string | null
  direccion: string | null
  ciudad: string | null
  departamento: string | null
  contacto_nombre: string | null
  contacto_celular: string | null
  contacto_telefono: string | null
  contacto_email: string | null
  vendedor_id: number | null
  estado_aprobacion: EstadoAprobacionProspecto
  version: number
  cupo_solicitado: number | null
  dias_credito_solicitado: number | null
  solicitado_nombre: string | null
  solicitado_en: string | null
  solicitado_por: string | null
  solicitud_nota: string | null
  aprobado_nombre: string | null
  aprobado_en: string | null
  rechazado_nombre: string | null
  rechazado_en: string | null
  motivo_rechazo: string | null
  cliente_id: number | null
  sucursal_id: number | null
  sap_estado: string
  enlace_vence: string | null
  enlace_hash: string | null
}

export const COLUMNAS_EXPEDIENTE =
  "id, idempresa, codigo, razon_social, nombre_comercial, documento, direccion, ciudad, departamento, " +
  "contacto_nombre, contacto_celular, contacto_telefono, contacto_email, vendedor_id, estado_aprobacion, version, " +
  "cupo_solicitado, dias_credito_solicitado, solicitado_nombre, solicitado_en, solicitado_por, solicitud_nota, " +
  "aprobado_nombre, aprobado_en, rechazado_nombre, rechazado_en, motivo_rechazo, cliente_id, sucursal_id, sap_estado, " +
  "enlace_vence, enlace_hash"

export async function leerProspecto(id: number, empresaId: number): Promise<ProspectoExpediente | null> {
  const db = await getSupabaseAdminAsSystem()
  const { data } = await db.from("crm_prospectos").select(COLUMNAS_EXPEDIENTE).eq("id", id).eq("idempresa", empresaId).maybeSingle()
  return (data as unknown as ProspectoExpediente) ?? null
}

export async function evaluar(p: ProspectoExpediente): Promise<EvaluacionExpediente> {
  const [tipos, docs, exigir] = await Promise.all([
    tiposDocumentoProspecto(p.idempresa),
    documentosDe(p.idempresa, "prospecto", p.id),
    leerParamBool(PARAM.PROSPECTO_EXIGIR_DOCUMENTOS, p.idempresa),
  ])
  return evaluarExpediente(tipos, docs, p, exigir)
}

// ------------------------------------------------------------ enlace publico

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

/** Token nuevo: 32 bytes aleatorios en base64url. Solo se guarda su hash. */
export function nuevoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, hash: hashToken(token) }
}

/**
 * El prospecto de un enlace, si el enlace sirve: existe, no vencio y el
 * expediente todavia se puede editar. Cualquier otro caso devuelve null, sin
 * decir por que: a quien prueba tokens no se le da pista alguna.
 */
export async function prospectoPorToken(token: string): Promise<ProspectoExpediente | null> {
  if (!token || token.length < 30 || token.length > 100) return null
  const db = await getSupabaseAdminAsSystem()
  const { data } = await db.from("crm_prospectos").select(COLUMNAS_EXPEDIENTE).eq("enlace_hash", hashToken(token)).maybeSingle()
  const p = data as unknown as ProspectoExpediente | null
  if (!p || !p.enlace_vence || Date.parse(p.enlace_vence) < Date.now()) return null
  if (!puedeEditarExpediente(p.estado_aprobacion)) return null
  return p
}

export async function contarDocumentos(empresaId: number, prospectoId: number): Promise<number> {
  const db = await getSupabaseAdminAsSystem()
  const { count } = await db.from("crm_documentos").select("id", { count: "exact", head: true })
    .eq("idempresa", empresaId).eq("entidad", "prospecto").eq("entidad_id", prospectoId)
  return count ?? 0
}
