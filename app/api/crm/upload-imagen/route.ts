// Subida de imágenes del CRM (fotos de producto, foto de vendedor).
//
// Replica el patrón canónico del proyecto: formData → Buffer → Storage →
// URL pública guardada en la fila que la originó.
//
// EL LÍMITE QUE IMPORTA: el cuerpo de una petición serverless en Vercel ronda
// los 4.5 MB, y una foto de celular moderno pesa entre 5 y 12 MB. Por eso el
// cliente comprime ANTES de enviar (lib/image-compress.ts). Aquí se valida el
// tamaño igualmente: confiar en que el cliente comprimió es confiar en que
// nadie llamará a este endpoint desde otro sitio.

import { NextResponse, type NextRequest } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUser } from "@/lib/auth-actions"
import { getUserPermissions } from "@/lib/permissions-actions"

export const runtime = "nodejs"
export const maxDuration = 60

const MAX_BYTES = 8 * 1024 * 1024
const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp", "image/gif"]

/** Carpeta → permiso que habilita subir ahí. Sin entrada, no se puede subir:
 *  una carpeta nueva exige decidir explícitamente quién puede escribir en ella. */
const PERMISO_POR_CARPETA: Record<string, "crm_productos" | "crm_vendedores" | "crm_actividades" | "crm_pagos" | "crm_maestros_admin"> = {
  productos: "crm_productos",
  vendedores: "crm_vendedores",
  actividades: "crm_actividades",
  soportes: "crm_pagos",
  // Logos del membrete de cada owner (Maestros → Owners).
  logos: "crm_maestros_admin",
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ success: false, error: "Sesión no válida" }, { status: 401 })
    }

    // El formData lanza si el cuerpo no es multipart; se captura aparte para
    // devolver un error claro en vez de un 500.
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json(
        { success: false, error: "La petición no trae un archivo" },
        { status: 400 },
      )
    }

    const file = form.get("file") as File | null
    const carpeta = String(form.get("carpeta") ?? "")
    const referencia = String(form.get("referencia") ?? "")

    if (!file) {
      return NextResponse.json({ success: false, error: "Falta el archivo" }, { status: 400 })
    }

    const permiso = PERMISO_POR_CARPETA[carpeta]
    if (!permiso) {
      return NextResponse.json({ success: false, error: "Destino no válido" }, { status: 400 })
    }

    const permisos = await getUserPermissions(user.id)
    if (!permisos || permisos[permiso] !== true) {
      return NextResponse.json(
        { success: false, error: "No tienes permiso para subir aquí" },
        { status: 403 },
      )
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo es ${MAX_BYTES / 1024 / 1024} MB.`,
        },
        { status: 413 },
      )
    }

    if (file.type && !TIPOS_PERMITIDOS.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "Solo se aceptan imágenes JPG, PNG, WebP o GIF" },
        { status: 415 },
      )
    }

    // Nombre saneado: un nombre de archivo con caracteres raros rompe la URL
    // pública y deja la imagen inaccesible sin error visible.
    const ext = (file.name?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "")
    const ref = referencia.replace(/[^a-zA-Z0-9_-]/g, "") || "sin-ref"
    const aleatorio = Math.random().toString(36).slice(2, 8)
    const ruta = `crm/${carpeta}/${ref}/${Date.now()}_${aleatorio}.${ext}`

    const supabase = await getSupabaseAdmin()
    const { error } = await supabase.storage
      .from("archivos")
      .upload(ruta, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || "image/jpeg",
        upsert: false,
      })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    const { data } = supabase.storage.from("archivos").getPublicUrl(ruta)
    return NextResponse.json({ success: true, url: data.publicUrl, ruta })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al subir"
    console.error("[crm-upload]", msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
