import { NextResponse } from "next/server"
import { leerSesion, nombreEmpresa } from "@/lib/crm-sesion"

// Perfil del usuario de la SESION. Antes recibia `?userId=` y devolvia el
// perfil de cualquiera; el parametro se ignora. Se conserva la ruta por
// compatibilidad: el AuthProvider ahora usa /api/crm-auth/sesion.
export const dynamic = "force-dynamic"

export async function GET() {
  const s = await leerSesion()
  if (!s) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  const u = s.usuario
  return NextResponse.json({
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    empresa_id: u.empresa_id,
    empresa_nombre: await nombreEmpresa(u.empresa_id),
  })
}
