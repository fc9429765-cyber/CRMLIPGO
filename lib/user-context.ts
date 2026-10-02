"use server"

import { getUserProfile, getCurrentUser } from "./auth-actions"
import { getSupabaseAdminAsSystem } from "./supabase-admin"

/**
 * Gets the current authenticated user's empresa_id
 * Returns the empresa_id from the user's profile, or 1 as fallback
 */
export async function getCurrentEmpresaIdForInsert(): Promise<number> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      console.warn("[v0] No authenticated user found, using default empresa_id: 1")
      return 1
    }

    const profile = await getUserProfile(user.id)
    if (!profile || !profile.empresa_id) {
      console.warn("[v0] No profile or empresa_id found for user, using default: 1")
      return 1
    }

    return profile.empresa_id
  } catch (error) {
    console.error("[v0] Error getting empresa_id:", error)
    return 1 // Fallback
  }
}

/**
 * Alias for getCurrentEmpresaIdForInsert - Gets the current authenticated user's empresa_id
 * Returns the empresa_id from the user's profile, or 1 as fallback
 */
export async function getCurrentEmpresaId(): Promise<number> {
  return getCurrentEmpresaIdForInsert()
}

/**
 * Gets the current authenticated user's username (usuario field)
 * Returns the usuario from the user's profile, or "admin" as fallback
 */
export async function getCurrentUsuarioForInsert(): Promise<string> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      console.warn("[v0] No authenticated user found, using default usuario: admin")
      return "admin"
    }

    const profile = await getUserProfile(user.id)
    if (!profile || !profile.usuario) {
      console.warn("[v0] No profile or usuario found for user, using default: admin")
      return "admin"
    }

    return profile.usuario
  } catch (error) {
    console.error("[v0] Error getting usuario:", error)
    return "admin" // Fallback
  }
}

/**
 * Gets the current authenticated user's context (empresaId and usuario)
 * Returns an object with empresaId and usuario from the user's profile
 */
export async function getCurrentUserContext(): Promise<{ empresaId: number; usuario: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) {
      console.warn("[v0] No authenticated user found, using defaults")
      return { empresaId: 1, usuario: "admin" }
    }

    const profile = await getUserProfile(user.id)
    if (!profile) {
      console.warn("[v0] No profile found for user, using defaults")
      return { empresaId: 1, usuario: "admin" }
    }

    return {
      empresaId: profile.empresa_id || 1,
      usuario: profile.usuario || "admin",
    }
  } catch (error) {
    console.error("[v0] Error getting user context:", error)
    return { empresaId: 1, usuario: "admin" }
  }
}

/**
 * Gets the current authenticated user's empresa data (NIT and direccion)
 * Returns the empresa data from the empresas table, or default values as fallback
 */
export async function getCurrentEmpresaData(): Promise<{ nit: string; direccion: string; nombre: string }> {
  try {
    const empresaId = await getCurrentEmpresaIdForInsert()
    const supabase = await getSupabaseAdminAsSystem()

    const { data: empresaData, error } = await supabase
      .from("empresas")
      .select("nit, direccion, nombre")
      .eq("id", empresaId)
      .maybeSingle()

    if (error || !empresaData) {
      console.warn("[v0] No empresa data found, using defaults")
      return {
        nit: "890.204.199",
        direccion: "Dirección vía 40 # 67B-63",
        nombre: "LA INSUPERABLE",
      }
    }

    return {
      nit: empresaData.nit || "890.204.199",
      direccion: empresaData.direccion || "Dirección vía 40 # 67B-63",
      nombre: empresaData.nombre || "LA INSUPERABLE",
    }
  } catch (error) {
    console.error("[v0] Error getting empresa data:", error)
    return {
      nit: "890.204.199",
      direccion: "Dirección vía 40 # 67B-63",
      nombre: "LA INSUPERABLE",
    }
  }
}
