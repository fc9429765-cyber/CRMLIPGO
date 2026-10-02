import { EMPRESA_ID_FIELDS, EXCLUDED_TABLES } from "@/lib/company-constants"
import { leerSesion } from "@/lib/crm-sesion"

// Empresa y nombre del usuario de la sesion del CRM (crm_usuarios, scripts/209).
// Antes se leian de profiles de LIPgo con la sesion de Supabase Auth.

/**
 * Obtiene el empresa_id del usuario autenticado
 * @returns El ID de la empresa o null si no hay usuario autenticado
 */
export async function getCurrentEmpresaId(): Promise<number | null> {
  const s = await leerSesion()
  return s ? s.usuario.empresa_id : null
}

/**
 * Verifica si una tabla debe ser filtrada por empresa_id
 * @param tableName El nombre de la tabla
 * @returns true si la tabla debe ser filtrada, false si está excluida
 */
export async function shouldFilterByEmpresa(tableName: string): Promise<boolean> {
  return !EXCLUDED_TABLES.includes(tableName.toLowerCase())
}

/**
 * Obtiene el nombre del campo de empresa_id para una tabla específica
 * @param tableName El nombre de la tabla
 * @returns El nombre del campo de empresa_id o "idempresa" por defecto
 */
export async function getEmpresaIdFieldName(tableName: string): Promise<string> {
  return EMPRESA_ID_FIELDS[tableName] || "idempresa"
}

/**
 * Obtiene el nombre de usuario del usuario autenticado
 * @returns El nombre del usuario o "admin" por defecto
 */
export async function getCurrentUsuario(): Promise<string> {
  const s = await leerSesion()
  return s?.usuario.usuario || "admin"
}

/**
 * Obtiene tanto el empresa_id como el usuario en una sola llamada
 * @returns Objeto con empresaId y usuario
 */
export async function getCurrentUserContext(): Promise<{ empresaId: number | null; usuario: string }> {
  const s = await leerSesion()
  if (!s) return { empresaId: null, usuario: "admin" }
  return { empresaId: s.usuario.empresa_id, usuario: s.usuario.usuario || "admin" }
}

/**
 * Alias de getCurrentUsuario para consistencia en nombres
 */
export async function getCurrentUsuarioForInsert(): Promise<string> {
  return getCurrentUsuario()
}

/**
 * Alias de getCurrentEmpresaId para consistencia en nombres
 * Retorna el ID de empresa con fallback a 1 si es null
 */
export async function getCurrentEmpresaIdForInsert(): Promise<number> {
  const empresaId = await getCurrentEmpresaId()
  return empresaId || 1
}
