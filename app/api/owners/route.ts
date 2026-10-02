import { NextResponse } from "next/server"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { leerSesion } from "@/lib/crm-sesion"

export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await leerSesion())) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  try {
    const db = await getSupabaseAdminAsSystem()
    const { data, error } = await db.from("owners").select("id, nombre").order("nombre", { ascending: true })
    if (error) {
      console.error("Error fetching owners:", error)
      return NextResponse.json({ error: "Failed to fetch owners" }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error in owners API:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
