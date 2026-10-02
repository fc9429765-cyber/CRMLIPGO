"use server"

// Permisos de los usuarios del CRM (crm_usuarios.permisos, scripts/209).
// Ya no se leen ni se escriben las tablas de usuarios de LIPgo.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { leerSesion } from "@/lib/crm-sesion"
import { getCurrentEmpresaId } from "@/lib/company-filter"
// La interfaz `UserPermissions` y el mapa `MODULE_PERMISSION_MAP` viven
// en `permissions-map.ts` (sin "use server"). Next.js prohibe exportar
// valores no async desde archivos con "use server".
import { MODULE_PERMISSION_MAP, PERMISOS_CRM, puedeVerModulo, type UserPermissions } from "@/lib/permissions-map"

/** Permisos completos (todas las claves, false si no esta) a partir del jsonb. */
function expandir(usuarioId: string, permisos: Record<string, unknown> | null | undefined): UserPermissions {
  const out: Record<string, unknown> = { usuario_id: usuarioId }
  for (const k of PERMISOS_CRM) out[k] = permisos?.[k] === true
  return out as unknown as UserPermissions
}

/** Solo las claves conocidas y en true: lo que se guarda en la base. */
function compactar(p: Partial<Record<string, unknown>>): Record<string, true> {
  const out: Record<string, true> = {}
  for (const k of PERMISOS_CRM) if (p[k] === true) out[k] = true
  return out
}

/**
 * Permisos del usuario de la SESION. El `userId` se conserva por la firma de
 * siempre, pero si es de otro usuario devuelve null: es una accion de servidor
 * y con el id libre cualquiera leia los permisos de otro.
 */
export async function getUserPermissions(userId?: string): Promise<UserPermissions | null> {
  try {
    const s = await leerSesion()
    if (!s) return null
    if (userId && userId !== s.usuario.id) return null
    return expandir(s.usuario.id, s.usuario.permisos)
  } catch (error) {
    console.error("Error in getUserPermissions:", error)
    return null
  }
}

export async function checkModulePermission(moduleName: string): Promise<boolean> {
  try {
    // Un modulo que no esta en el mapa no lo ve nadie: fallar cerrado.
    if (!MODULE_PERMISSION_MAP[moduleName]) return false
    const permissions = await getUserPermissions()
    if (!permissions) return false
    // Incluye los permisos alternativos del modulo (MODULE_PERMISOS_ALTERNOS).
    return puedeVerModulo(permissions as unknown as Record<string, unknown>, moduleName)
  } catch (error) {
    console.error("checkModulePermission:", error)
    return false
  }
}

const MODULO_ADMIN = "Gestión de Usuarios"

/**
 * Usuarios del CRM de la empresa, con sus permisos. Misma forma que antes
 * (`permisos_usuarios` anidado) para no reescribir la pantalla, mas los datos
 * de acceso que antes salian de Supabase Auth.
 */
export async function getAllUsersWithPermissions(selectedEmpresaId?: number | null) {
  try {
    if (!(await checkModulePermission(MODULO_ADMIN))) return { success: false, error: "No autorizado" }
    const supabase = await getSupabaseAdmin()

    const empresaId = selectedEmpresaId || (await getCurrentEmpresaId())
    if (!empresaId) return { success: false, error: "No empresa found" }

    const { data, error } = await supabase
      .from("crm_usuarios")
      .select("id, usuario, email, nombre, empresa_id, empresas_acceso, permisos, activo, debe_cambiar_clave, ultimo_ingreso, creado_en, bloqueado_hasta")
      .or(`empresa_id.eq.${Number(empresaId)},empresas_acceso.cs.{${Number(empresaId)}}`)
      .order("usuario", { ascending: true })

    if (error) {
      console.error("Error fetching users with permissions:", error)
      return { success: false, error: error.message }
    }

    const filas = (data ?? []).map((u: Record<string, any>) => ({
      ...u,
      permisos_usuarios: expandir(u.id, u.permisos),
    }))
    return { success: true, data: filas }
  } catch (error) {
    console.error("Error in getAllUsersWithPermissions:", error)
    return { success: false, error: String(error) }
  }
}

/**
 * Reemplaza los permisos de un usuario del CRM. SOLO un administrador
 * (permiso crm_usuarios): antes esta accion no validaba nada y cualquiera con
 * sesion podia darse todos los permisos.
 */
export async function updateUserPermissions(userId: string, permissions: Partial<UserPermissions>) {
  try {
    if (!(await checkModulePermission(MODULO_ADMIN))) return { success: false, error: "No autorizado" }
    const s = await leerSesion()
    const supabase = await getSupabaseAdmin()

    // Se FUSIONA con lo que ya tiene: la pantalla solo manda las claves que
    // muestra, y una clave que no viene no debe apagarse por omision.
    const { data: actual } = await supabase.from("crm_usuarios").select("permisos").eq("id", userId).maybeSingle()
    if (!actual) return { success: false, error: "Usuario no encontrado" }
    const entrada = permissions as Record<string, unknown>
    const fusion: Record<string, unknown> = { ...(actual.permisos ?? {}) }
    for (const k of PERMISOS_CRM) if (k in entrada) fusion[k] = entrada[k] === true
    const nuevos = compactar(fusion)

    // Un administrador no puede quitarse a si mismo el permiso de administrar:
    // se quedaria fuera y nadie mas podria devolverselo.
    if (s && userId === s.usuario.id && !nuevos.crm_usuarios) {
      return { success: false, error: "No puedes quitarte el permiso de Gestión de Usuarios." }
    }

    const { error } = await supabase
      .from("crm_usuarios")
      .update({ permisos: nuevos, actualizado_en: new Date().toISOString() })
      .eq("id", userId)
    if (error) {
      console.error("Error updating user permissions:", error)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (error) {
    console.error("Error in updateUserPermissions:", error)
    return { success: false, error: String(error) }
  }
}
