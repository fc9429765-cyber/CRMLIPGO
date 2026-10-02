"use server"

// Identidad del usuario actual para el resto del servidor.
//
// El CRM tiene usuarios propios (lib/crm-sesion.ts, scripts/209): ya no se
// consulta Supabase Auth ni las tablas de usuarios de LIPgo (profiles).

import { leerSesion, nombreEmpresa } from "@/lib/crm-sesion"

export interface UserProfile {
  id: string
  usuario: string
  empresa_id: number
  empresa_nombre: string
  // Nombre del usuario (opcional): varios componentes lo leen (saludo, firmas).
  nombre?: string | null
}

/** Usuario minimo de la sesion. Misma forma que usaban los llamadores. */
export interface UsuarioSesion {
  id: string
  email: string
}

/**
 * Perfil del usuario de la sesion. Es una accion de servidor: con un `userId`
 * libre, cualquiera leia el perfil de otro. Si se pide uno distinto al propio,
 * devuelve null.
 */
export async function getUserProfile(userId?: string): Promise<UserProfile | null> {
  const s = await leerSesion()
  if (!s) return null
  if (userId && userId !== s.usuario.id) return null
  const u = s.usuario
  return {
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    empresa_id: u.empresa_id,
    empresa_nombre: await nombreEmpresa(u.empresa_id),
  }
}

export async function getCurrentUser(): Promise<UsuarioSesion | null> {
  const s = await leerSesion()
  return s ? { id: s.usuario.id, email: s.usuario.email } : null
}
