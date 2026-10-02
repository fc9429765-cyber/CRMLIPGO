"use server"

// ---------------------------------------------------------------------------
// ADMINISTRACION de usuarios del CRM (crear / restablecer contraseña /
// activar / eliminar / leer ultima conexion).
//
// USUARIOS PROPIOS (scripts/209): todo se hace sobre crm_usuarios. Antes se
// creaban en el Supabase Auth y en las tablas de LIPgo, con dos efectos
// graves: el usuario nuevo entraba tambien a LIPgo (con los permisos de LIPgo
// que nacen en true) y eliminarlo aqui lo borraba alla. Ahora LIPgo no se toca.
//
// SEGURIDAD: cada accion exige el permiso de "Gestión de Usuarios". La UI solo
// esconde la pantalla; estas acciones corren con service-role y deben
// verificar por si mismas que el llamante es administrador.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import { hashClave, leerSesion, revocarSesiones } from "@/lib/crm-sesion"
import { validarClaveNueva } from "@/lib/crm-token"
import type { CrearUsuarioInput, AuthMetaUsuario } from "@/lib/user-admin-types"

const MODULO_ADMIN = "Gestión de Usuarios"

async function assertAdmin(): Promise<boolean> {
  return await checkModulePermission(MODULO_ADMIN)
}

/**
 * Crea un usuario del CRM SIN permisos y con la clave que puso el
 * administrador como TEMPORAL: al entrar por primera vez debe cambiarla, asi
 * el administrador no conoce la clave definitiva de nadie.
 */
export async function crearUsuario(input: CrearUsuarioInput): Promise<{ success: boolean; error?: string; userId?: string }> {
  try {
    if (!(await assertAdmin())) return { success: false, error: "No autorizado" }

    const email = input.email?.trim().toLowerCase()
    const usuario = input.usuario?.trim()
    const password = input.password ?? ""

    if (!email || !password || !usuario || !input.empresaId) {
      return { success: false, error: "Datos incompletos: correo, contraseña, usuario y empresa son obligatorios." }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, error: "El correo no es válido." }
    const invalida = validarClaveNueva(password)
    if (invalida) return { success: false, error: invalida }

    const supabase = await getSupabaseAdmin()
    const yo = await leerSesion()

    const empresas = Array.from(new Set((input.empresasAdicionales ?? []).filter((e) => e !== input.empresaId)))
    const owners = Array.from(new Set((input.owners ?? []).map((o) => o.trim()).filter(Boolean)))

    // Los indices unicos (lower(email), lower(usuario)) deciden si ya existe.
    const { data, error } = await supabase
      .from("crm_usuarios")
      .insert({
        usuario,
        email,
        password_hash: await hashClave(password),
        empresa_id: input.empresaId,
        empresas_acceso: empresas,
        owners_acceso: owners,
        permisos: {},
        activo: true,
        debe_cambiar_clave: true,
        origen: "crm",
        creado_por: yo?.usuario.id ?? null,
      })
      .select("id")
      .single()

    if (error || !data) {
      if (error?.code === "23505") {
        return {
          success: false,
          error: /email/i.test(error.message)
            ? "Ya existe un usuario del CRM con ese correo."
            : "Ya existe un usuario del CRM con ese nombre de usuario.",
        }
      }
      return { success: false, error: error?.message || "No se pudo crear el usuario" }
    }
    return { success: true, userId: data.id }
  } catch (error) {
    console.error("[user-admin] Error en crearUsuario:", error)
    return { success: false, error: String(error) }
  }
}

/** Pone una clave TEMPORAL nueva: desbloquea la cuenta, cierra sus sesiones y
 *  le exige cambiarla al entrar. */
export async function resetearPassword(userId: string, nuevaPassword: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(await assertAdmin())) return { success: false, error: "No autorizado" }
    if (!userId) return { success: false, error: "Usuario no especificado" }
    const invalida = validarClaveNueva(nuevaPassword ?? "")
    if (invalida) return { success: false, error: invalida }

    const supabase = await getSupabaseAdmin()
    const { error } = await supabase
      .from("crm_usuarios")
      .update({
        password_hash: await hashClave(nuevaPassword),
        debe_cambiar_clave: true,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", userId)
    if (error) return { success: false, error: error.message }
    await revocarSesiones(userId)
    return { success: true }
  } catch (error) {
    console.error("[user-admin] Error en resetearPassword:", error)
    return { success: false, error: String(error) }
  }
}

/** Activa o desactiva un usuario. Desactivarlo cierra sus sesiones al instante. */
export async function cambiarEstadoUsuario(userId: string, activo: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(await assertAdmin())) return { success: false, error: "No autorizado" }
    const yo = await leerSesion()
    if (!activo && yo?.usuario.id === userId) return { success: false, error: "No puedes desactivar tu propio usuario." }
    const supabase = await getSupabaseAdmin()
    const { error } = await supabase
      .from("crm_usuarios")
      .update({ activo, actualizado_en: new Date().toISOString() })
      .eq("id", userId)
    if (error) return { success: false, error: error.message }
    if (!activo) await revocarSesiones(userId)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/** Elimina el usuario del CRM. A LIPgo no le pasa nada. Los registros que
 *  firmo (pedidos, recaudos, bitacora) conservan su nombre guardado. */
export async function eliminarUsuario(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(await assertAdmin())) return { success: false, error: "No autorizado" }
    if (!userId) return { success: false, error: "Usuario no especificado" }

    const yo = await leerSesion()
    if (yo?.usuario.id === userId) return { success: false, error: "No puedes eliminar tu propio usuario." }

    const supabase = await getSupabaseAdmin()
    // El vinculo con un vendedor apuntaria a un usuario que ya no existe.
    await supabase.from("crm_vendedores_detalle").update({ usuario_id: null }).eq("usuario_id", userId)
    // Las sesiones caen en cascada.
    const { error } = await supabase.from("crm_usuarios").delete().eq("id", userId)
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (error) {
    console.error("[user-admin] Error en eliminarUsuario:", error)
    return { success: false, error: String(error) }
  }
}

/** userId -> correo, ultimo ingreso, creacion y estado, para la lista. */
export async function getAuthMetaUsuarios(): Promise<{ success: boolean; data?: Record<string, AuthMetaUsuario>; error?: string }> {
  try {
    if (!(await assertAdmin())) return { success: false, error: "No autorizado" }
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("crm_usuarios")
      .select("id, email, ultimo_ingreso, creado_en, activo, debe_cambiar_clave")
    if (error) return { success: false, error: error.message }
    const out: Record<string, AuthMetaUsuario> = {}
    for (const u of data ?? []) {
      out[u.id] = {
        email: u.email ?? null,
        last_sign_in_at: u.ultimo_ingreso ?? null,
        created_at: u.creado_en ?? null,
        activo: u.activo !== false,
        debe_cambiar_clave: u.debe_cambiar_clave === true,
      }
    }
    return { success: true, data: out }
  } catch (error) {
    console.error("[user-admin] Error en getAuthMetaUsuarios:", error)
    return { success: false, error: String(error) }
  }
}
