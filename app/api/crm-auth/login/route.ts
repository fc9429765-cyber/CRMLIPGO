import { NextResponse, type NextRequest } from "next/server"
import { ingresar } from "@/lib/crm-sesion"

// Ingreso con usuario propio del CRM (scripts/209). No usa Supabase Auth:
// un usuario de LIPgo no existe aqui.
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string }
    const r = await ingresar(String(body.email ?? ""), String(body.password ?? ""), {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    })
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, debeCambiarClave: r.debeCambiarClave })
  } catch (e) {
    console.error("[crm-auth] login:", e)
    return NextResponse.json({ ok: false, error: "No se pudo iniciar sesión. Intenta de nuevo." }, { status: 500 })
  }
}
