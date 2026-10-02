import { NextResponse } from "next/server"
import { salir } from "@/lib/crm-sesion"

export const dynamic = "force-dynamic"

export async function POST() {
  try {
    await salir()
  } catch (e) {
    console.error("[crm-auth] logout:", e)
  }
  return NextResponse.json({ ok: true })
}
