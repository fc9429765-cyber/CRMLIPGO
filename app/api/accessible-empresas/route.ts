import { NextResponse } from "next/server"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { leerSesion } from "@/lib/crm-sesion"

// Empresas que el usuario del CRM puede operar: la suya y las de
// crm_usuarios.empresas_acceso. Ya no se leen los accesos de LIPgo.
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const s = await leerSesion()
    if (!s) return NextResponse.json({ success: false, data: [], error: "No autenticado" }, { status: 401 })

    const ids = Array.from(new Set([s.usuario.empresa_id, ...s.usuario.empresas_acceso].filter((n) => Number.isFinite(n))))
    const db = await getSupabaseAdminAsSystem()
    const { data, error } = await db.from("empresas").select("id, nombre").in("id", ids).order("nombre", { ascending: true })
    if (error) return NextResponse.json({ success: false, data: [], error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data: data ?? [] })
  } catch (error) {
    console.error("[crm] accessible-empresas:", error)
    return NextResponse.json({ success: false, data: [], error: "Error interno" }, { status: 500 })
  }
}
