"use server"

// Accesos de los usuarios del CRM a empresas y owners.
//
// Se guardan en crm_usuarios (empresas_acceso, owners_acceso; scripts/209).
// Antes este archivo escribia DESDE EL NAVEGADOR, con la clave anonima, en las
// tablas de LIPgo perfil_acceso_empresas y perfil_acceso_owners: dar acceso en
// el CRM cambiaba lo que el usuario veia en LIPgo. Ahora es una accion de
// servidor, solo para administradores, y LIPgo no se toca. Los catalogos
// (empresas, owners) se siguen leyendo de LIPgo, que es donde existen.

import { getSupabaseAdmin, getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { checkModulePermission } from "@/lib/permissions-actions"
import { getCurrentEmpresaId } from "@/lib/company-filter"

export interface UserProfile {
  id: string
  usuario: string
}

export interface Empresa {
  id: number
  nombre: string
}

export interface Owner {
  id: number
  nombre: string
}

const MODULO_ADMIN = "Gestión de Usuarios"
const esAdmin = () => checkModulePermission(MODULO_ADMIN)

export async function getAllUsers(selectedEmpresaId?: number | null): Promise<UserProfile[]> {
  if (!(await esAdmin())) return []
  const empresaId = Number(selectedEmpresaId ?? (await getCurrentEmpresaId()) ?? 1)
  const db = await getSupabaseAdminAsSystem()
  const { data } = await db
    .from("crm_usuarios")
    .select("id, usuario")
    .or(`empresa_id.eq.${empresaId},empresas_acceso.cs.{${empresaId}}`)
    .order("usuario", { ascending: true })
  return (data ?? []) as UserProfile[]
}

export async function getAllEmpresas(): Promise<Empresa[]> {
  if (!(await esAdmin())) return []
  const db = await getSupabaseAdminAsSystem()
  const { data } = await db.from("empresas_permisos").select("id, nombre").order("nombre", { ascending: true })
  return (data ?? []) as Empresa[]
}

export async function getAllOwners(): Promise<Owner[]> {
  if (!(await esAdmin())) return []
  const db = await getSupabaseAdminAsSystem()
  const { data } = await db.from("owners").select("id, nombre").order("nombre", { ascending: true })
  return (data ?? []) as Owner[]
}

async function leerAccesos(userId: string): Promise<{ empresas: number[]; owners: string[] } | null> {
  const db = await getSupabaseAdminAsSystem()
  const { data } = await db.from("crm_usuarios").select("empresas_acceso, owners_acceso").eq("id", userId).maybeSingle()
  if (!data) return null
  return { empresas: (data.empresas_acceso ?? []) as number[], owners: (data.owners_acceso ?? []) as string[] }
}

async function guardarAccesos(userId: string, cambios: { empresas_acceso?: number[]; owners_acceso?: string[] }) {
  const db = await getSupabaseAdmin()
  const { error } = await db
    .from("crm_usuarios")
    .update({ ...cambios, actualizado_en: new Date().toISOString() })
    .eq("id", userId)
  return error ? { success: false, error: error.message } : { success: true }
}

export async function getUserAccess(profileId: string): Promise<number[]> {
  if (!(await esAdmin())) return []
  return (await leerAccesos(profileId))?.empresas ?? []
}

export async function grantUserAccess(profileId: string, empresaId: number): Promise<{ success: boolean; error?: string }> {
  if (!(await esAdmin())) return { success: false, error: "No autorizado" }
  const a = await leerAccesos(profileId)
  if (!a) return { success: false, error: "Usuario no encontrado" }
  if (a.empresas.includes(empresaId)) return { success: true }
  return guardarAccesos(profileId, { empresas_acceso: [...a.empresas, empresaId] })
}

export async function revokeUserAccess(profileId: string, empresaId: number): Promise<{ success: boolean; error?: string }> {
  if (!(await esAdmin())) return { success: false, error: "No autorizado" }
  const a = await leerAccesos(profileId)
  if (!a) return { success: false, error: "Usuario no encontrado" }
  return guardarAccesos(profileId, { empresas_acceso: a.empresas.filter((e) => e !== empresaId) })
}

export async function getUserOwnerAccess(profileId: string): Promise<string[]> {
  if (!(await esAdmin())) return []
  return (await leerAccesos(profileId))?.owners ?? []
}

export async function grantUserOwnerAccess(profileId: string, ownerName: string): Promise<{ success: boolean; error?: string }> {
  if (!(await esAdmin())) return { success: false, error: "No autorizado" }
  const a = await leerAccesos(profileId)
  if (!a) return { success: false, error: "Usuario no encontrado" }
  if (a.owners.includes(ownerName)) return { success: true }
  return guardarAccesos(profileId, { owners_acceso: [...a.owners, ownerName] })
}

export async function revokeUserOwnerAccess(profileId: string, ownerName: string): Promise<{ success: boolean; error?: string }> {
  if (!(await esAdmin())) return { success: false, error: "No autorizado" }
  const a = await leerAccesos(profileId)
  if (!a) return { success: false, error: "Usuario no encontrado" }
  return guardarAccesos(profileId, { owners_acceso: a.owners.filter((o) => o !== ownerName) })
}
