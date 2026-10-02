import { NextResponse } from "next/server"
import { leerSesion, nombreEmpresa } from "@/lib/crm-sesion"

// Quien soy: lo consulta el AuthProvider al cargar la app.
export const dynamic = "force-dynamic"

export async function GET() {
  const s = await leerSesion()
  if (!s) return NextResponse.json({ user: null, profile: null }, { status: 401 })
  const u = s.usuario
  return NextResponse.json({
    user: { id: u.id, email: u.email },
    profile: {
      id: u.id,
      usuario: u.usuario,
      nombre: u.nombre,
      empresa_id: u.empresa_id,
      empresa_nombre: await nombreEmpresa(u.empresa_id),
    },
  })
}
