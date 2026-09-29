"use server"

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"
import { getCurrentEmpresaId } from "@/lib/company-filter"
// La interfaz `UserPermissions` y el mapa `MODULE_PERMISSION_MAP` viven
// en `permissions-map.ts` (sin "use server"). Next.js prohibe exportar
// valores no async desde archivos con "use server", asi que el mapa no
// puede vivir aqui. Importamos desde el modulo compartido.
import { MODULE_PERMISSION_MAP, puedeVerModulo, type UserPermissions } from "@/lib/permissions-map"

export async function getUserPermissions(userId?: string): Promise<UserPermissions | null> {
  try {
    const supabase = await getSupabaseAdmin()

    // Siempre los del usuario de la sesion. Es una accion de servidor: con el
    // `userId` libre, cualquiera con sesion leia los permisos de otro usuario.
    // Todos los llamadores pasan su propio id, asi que se conserva la firma.
    const currentUser = await getCurrentUser()
    if (!currentUser) return null
    if (userId && userId !== currentUser.id) return null
    userId = currentUser.id

    const { data, error } = await supabase.from("permisos_usuarios").select("*").eq("usuario_id", userId).single()

    if (error) {
      console.error("Error fetching user permissions:", error)
      return null
    }

    return data as UserPermissions
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

export async function getAllUsersWithPermissions(selectedEmpresaId?: number | null) {
  try {
    const supabase = await getSupabaseAdmin()

    // Use selectedEmpresaId if provided, otherwise fall back to current user's empresa_id
    let empresaId = selectedEmpresaId
    if (!empresaId) {
      empresaId = await getCurrentEmpresaId()
    }

    if (!empresaId) {
      console.error("Error: No empresa_id found for current user")
      return { success: false, error: "No empresa found" }
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(
        `
        id,
        usuario,
        empresa_id,
        permisos_usuarios!inner (*)
      `,
      )
      .eq("empresa_id", empresaId) // Filter by empresa_id
      .order("usuario", { ascending: true })

    if (error) {
      console.error("Error fetching users with permissions:", error)
      return { success: false, error: error.message }
    }

    console.log("[v0] Fetched users with permissions:", JSON.stringify(data, null, 2))

    return { success: true, data: data || [] }
  } catch (error) {
    console.error("Error in getAllUsersWithPermissions:", error)
    return { success: false, error: String(error) }
  }
}

export async function updateUserPermissions(userId: string, permissions: Partial<UserPermissions>) {
  try {
    const supabase = await getSupabaseAdmin()

    // Verificar si ya existen permisos para este usuario
    const { data: existing } = await supabase.from("permisos_usuarios").select("id").eq("usuario_id", userId).single()

    if (existing) {
      // Actualizar permisos existentes
      const { error } = await supabase.from("permisos_usuarios").update(permissions).eq("usuario_id", userId)

      if (error) {
        console.error("Error updating user permissions:", error)
        return { success: false, error: error.message }
      }
    } else {
      // Crear nuevos permisos.
      //
      // INSERT ROBUSTO: la secuencia SERIAL de `permisos_usuarios.id` está
      // desincronizada en esta BD (max(id) por delante del nextval, por filas
      // insertadas con id explícito en el pasado). Un insert SIN id choca con la
      // PK (`permisos_usuarios_pkey`, 23505) y rompía la creación de usuarios.
      // Insertamos con id EXPLÍCITO = max(id)+1 y reintentamos ante colisión, así
      // no dependemos del estado de la secuencia.
      let creado = false
      let lastErr: any = null
      for (let intento = 0; intento < 8 && !creado; intento++) {
        const { data: maxRow } = await supabase
          .from("permisos_usuarios")
          .select("id")
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
        const nextId = (maxRow?.id || 0) + 1
        const { error } = await supabase.from("permisos_usuarios").insert({
          id: nextId,
          usuario_id: userId,
          ...permissions,
        })
        if (!error) {
          creado = true
          break
        }
        lastErr = error
        // 23505 = choque de PK por secuencia atrasada / carrera: reintentar con id fresco.
        if ((error as any).code === "23505") continue
        // Otro error: no insistir.
        break
      }
      if (!creado) {
        console.error("Error creating user permissions:", lastErr)
        return { success: false, error: lastErr?.message || "No se pudieron crear los permisos" }
      }
    }

    return { success: true }
  } catch (error) {
    console.error("Error in updateUserPermissions:", error)
    return { success: false, error: String(error) }
  }
}
