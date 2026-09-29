"use client"

// Página pública donde el prospecto sube sus documentos (PRO-05).
//
// La abre alguien sin usuario, casi siempre desde el celular, con el enlace
// que le mandó el vendedor. Una sola columna, un botón por documento, y a la
// vista qué falta. No muestra nada del CRM: solo su propio expediente.

import { use, useCallback, useEffect, useState } from "react"
import { AlertTriangle, Camera, CheckCircle2, FileUp, Loader2, ShieldCheck } from "lucide-react"
import { prepararArchivo, TIPOS_ACEPTADOS } from "@/lib/archivo-cliente"

interface DocPedido {
  codigo: string
  nombre: string
  obligatorio: boolean
  ayuda: string | null
  subidos: number
  observacion: string | null
}
interface Estado {
  nombre: string
  vence: string
  documentos: DocPedido[]
}

export default function CargaDocumentosPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [estado, setEstado] = useState<Estado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ codigo: string; texto: string; ok: boolean } | null>(null)

  const cargar = useCallback(async () => {
    const r = await fetch(`/api/publico/carga/${encodeURIComponent(token)}`, { cache: "no-store" })
    const j = await r.json()
    if (!r.ok) setError(j.error ?? "El enlace no es válido")
    else setEstado(j)
  }, [token])

  useEffect(() => { cargar() }, [cargar])

  const subir = async (codigo: string, original: File | null) => {
    if (!original) return
    setAviso(null)
    const prep = await prepararArchivo(original)
    if ("error" in prep) {
      setAviso({ codigo, texto: prep.error, ok: false })
      return
    }
    setSubiendo(codigo)
    const fd = new FormData()
    fd.append("tipo_codigo", codigo)
    fd.append("archivo", prep.archivo)
    try {
      const r = await fetch(`/api/publico/carga/${encodeURIComponent(token)}`, { method: "POST", body: fd })
      const j = await r.json()
      if (!r.ok) {
        if (r.status === 404) setError(j.error)
        setAviso({ codigo, texto: j.error ?? "No se pudo subir", ok: false })
      } else {
        setEstado(j)
        setAviso({ codigo, texto: "Recibido", ok: true })
      }
    } catch {
      setAviso({ codigo, texto: "Se perdió la conexión. Inténtalo de nuevo.", ok: false })
    } finally {
      setSubiendo(null)
    }
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Enlace no disponible</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </main>
    )
  }
  if (!estado) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </main>
    )
  }

  const faltan = estado.documentos.filter((d) => d.obligatorio && d.subidos === 0)
  const vence = new Date(estado.vence).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long" })

  return (
    <main className="mx-auto min-h-screen max-w-md space-y-5 p-4 pb-10">
      <header className="space-y-1 pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Documentos para crear su cuenta</p>
        <h1 className="text-xl font-semibold leading-tight">{estado.nombre}</h1>
        <p className="text-sm text-muted-foreground">
          Toma una foto clara o sube el PDF de cada documento. Este enlace funciona hasta el {vence}.
        </p>
      </header>

      <div className={`rounded-lg border p-3 text-sm ${faltan.length ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
        {faltan.length
          ? <>Faltan {faltan.length} documento{faltan.length === 1 ? "" : "s"} obligatorio{faltan.length === 1 ? "" : "s"}.</>
          : <>Ya están todos los documentos obligatorios. Tu asesor los enviará a revisión.</>}
      </div>

      <ul className="space-y-3">
        {estado.documentos.map((d) => {
          const listo = d.subidos > 0
          const ocupado = subiendo === d.codigo
          return (
            <li key={d.codigo} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {d.nombre}
                    {d.obligatorio ? <span className="ml-1 text-red-600">*</span> : <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>}
                  </p>
                  {d.ayuda && <p className="text-xs text-muted-foreground">{d.ayuda}</p>}
                  {d.observacion && !listo && <p className="mt-1 text-xs text-red-700">Hay que enviarlo de nuevo: {d.observacion}</p>}
                </div>
                {listo && (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {d.subidos > 1 ? `${d.subidos} archivos` : "Recibido"}
                  </span>
                )}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <label className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm ${ocupado ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}>
                  <Camera className="h-4 w-4" aria-hidden="true" /> Tomar foto
                  <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!!subiendo}
                    onChange={(e) => { subir(d.codigo, e.target.files?.[0] ?? null); e.target.value = "" }} />
                </label>
                <label className={`flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm ${ocupado ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}>
                  {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
                  {listo ? "Agregar otro" : "Subir archivo"}
                  <input type="file" accept={TIPOS_ACEPTADOS} className="hidden" disabled={!!subiendo}
                    onChange={(e) => { subir(d.codigo, e.target.files?.[0] ?? null); e.target.value = "" }} />
                </label>
              </div>
              {aviso?.codigo === d.codigo && (
                <p className={`mt-1.5 text-xs ${aviso.ok ? "text-emerald-700" : "text-red-700"}`}>{aviso.texto}</p>
              )}
            </li>
          )
        })}
      </ul>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Tus documentos se guardan de forma privada y solo los revisa el área de Cartera para crear tu cuenta.
      </p>
    </main>
  )
}
