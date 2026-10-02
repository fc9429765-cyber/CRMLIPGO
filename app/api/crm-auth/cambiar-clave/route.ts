import { NextResponse, type NextRequest } from "next/server"
import { cambiarClave } from "@/lib/crm-sesion"
import { validarClaveNueva } from "@/lib/crm-token"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { actual?: string; nueva?: string }
    const actual = String(body.actual ?? "")
    const nueva = String(body.nueva ?? "")
    const invalida = validarClaveNueva(nueva, actual)
    if (invalida) return NextResponse.json({ ok: false, error: invalida }, { status: 400 })
    const r = await cambiarClave(actual, nueva, {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    })
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[crm-auth] cambiar-clave:", e)
    return NextResponse.json({ ok: false, error: "No se pudo cambiar la contraseña." }, { status: 500 })
  }
}
