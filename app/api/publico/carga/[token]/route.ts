// Enlace publico para que el prospecto suba sus documentos (PRO-05).
//
// SIN SESION: la autorizacion es el token del enlace, que solo existe en el
// mensaje que el vendedor envio. En la base esta su hash; el enlace caduca,
// se reemplaza al generar otro y se cierra al enviar el prospecto a Cartera.
//
// LO QUE EXPONE: el nombre del prospecto y la lista de documentos pedidos con
// cuantos archivos lleva cada uno. NO devuelve archivos, ni datos de contacto,
// ni nada del CRM: quien tenga el enlace puede aportar, no consultar.

import { NextResponse, type NextRequest } from "next/server"
import {
  MAX_DOCUMENTOS_PROSPECTO, contarDocumentos, documentosDe, prospectoPorToken, tiposDocumentoProspecto,
} from "@/lib/crm-expediente-server"
import { guardarDocumento, validarArchivo } from "@/lib/crm-documentos-server"
import { registrarEvento } from "@/lib/crm-eventos"

export const runtime = "nodejs"

const NO = () => NextResponse.json({ error: "El enlace no es válido o ya venció. Pide uno nuevo a tu asesor." }, { status: 404 })

async function estado(token: string) {
  const p = await prospectoPorToken(token)
  if (!p) return null
  const [tipos, docs] = await Promise.all([tiposDocumentoProspecto(p.idempresa), documentosDe(p.idempresa, "prospecto", p.id)])
  return {
    p,
    cuerpo: {
      nombre: p.nombre_comercial || p.razon_social,
      vence: p.enlace_vence,
      documentos: tipos.map((t) => {
        const suyos = docs.filter((d) => d.tipo_documento_id === t.id)
        const rechazado = suyos.filter((d) => d.estado === "rechazado").at(-1)
        return {
          codigo: t.codigo, nombre: t.nombre, obligatorio: t.obligatorio, ayuda: t.ayuda,
          subidos: suyos.filter((d) => d.estado !== "rechazado").length,
          // Lo que Cartera le pidio corregir, para que sepa que subir.
          observacion: rechazado?.nota ?? null,
        }
      }),
    },
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const e = await estado(token)
  return e ? NextResponse.json(e.cuerpo) : NO()
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const p = await prospectoPorToken(token)
  if (!p) return NO()

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "No llegó el archivo" }, { status: 400 })
  }
  const tipoCodigo = String(form.get("tipo_codigo") ?? "")
  const archivo = form.get("archivo")
  if (!(archivo instanceof File)) return NextResponse.json({ error: "No llegó el archivo" }, { status: 400 })
  const invalido = validarArchivo(archivo.type, archivo.size)
  if (invalido) return NextResponse.json({ error: invalido }, { status: 400 })
  if (!(await tiposDocumentoProspecto(p.idempresa)).some((t) => t.codigo === tipoCodigo)) {
    return NextResponse.json({ error: "Documento no válido" }, { status: 400 })
  }
  if ((await contarDocumentos(p.idempresa, p.id)) >= MAX_DOCUMENTOS_PROSPECTO) {
    return NextResponse.json({ error: "Ya se subieron demasiados archivos. Comunícate con tu asesor." }, { status: 429 })
  }

  const r = await guardarDocumento({
    empresaId: p.idempresa, entidad: "prospecto", entidadId: p.id, tipoCodigo,
    bytes: new Uint8Array(await archivo.arrayBuffer()), mime: archivo.type, nombre: archivo.name,
    ctx: { userId: null, nombre: "Prospecto (enlace)" },
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  await registrarEvento({
    empresaId: p.idempresa, entidad: "prospecto", entidadId: p.id, tipo: "documento_subido",
    usuarioNombre: "Prospecto (enlace)", datos: { documento_id: r.id, tipo: tipoCodigo, via: "enlace" },
  })
  const e = await estado(token)
  return NextResponse.json(e?.cuerpo ?? { ok: true })
}
