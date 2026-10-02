"use client"

// "Analizar con IA" en la Cuenta 360: una lectura del cliente en tres frases,
// el riesgo y hasta tres acciones. Se pide a propósito, no se carga sola:
// cuesta unos segundos y dinero, y no siempre hace falta.

import { useState } from "react"
import { Loader2, Sparkles, TrendingUp } from "lucide-react"
import { analizarClienteIA, type AnalisisCliente } from "@/lib/crm-ia-cliente-actions"
import { BadgeEstado } from "@/components/crm/ui/modulo"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const RIESGO = {
  bajo: { tono: "exito" as const, etiqueta: "Riesgo bajo" },
  medio: { tono: "advertencia" as const, etiqueta: "Riesgo medio" },
  alto: { tono: "peligro" as const, etiqueta: "Riesgo alto" },
}

export function AnalisisIACliente({ clienteId, empresaId, className }: { clienteId: number; empresaId: number; className?: string }) {
  const [analisis, setAnalisis] = useState<AnalisisCliente | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const analizar = async () => {
    setCargando(true)
    setError(null)
    const r = await analizarClienteIA(clienteId, empresaId)
    setCargando(false)
    if (r.success && r.data) setAnalisis(r.data)
    else setError(r.error ?? "No se pudo analizar")
  }

  return (
    <div className={cn("rounded-lg border border-[var(--chart-1)]/30 bg-[var(--chart-1)]/5 p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5 text-[var(--chart-1)]" aria-hidden="true" /> Análisis con IA
        </p>
        <Button size="sm" variant={analisis ? "ghost" : "default"} className="h-7 text-xs" onClick={analizar} disabled={cargando}>
          {cargando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          {cargando ? "Leyendo la cuenta…" : analisis ? "Volver a analizar" : "Analizar este cliente"}
        </Button>
      </div>
      {!analisis && !error && !cargando && (
        <p className="mt-1 text-[11px] text-muted-foreground">Lee la cartera, los pedidos y los recaudos y propone qué hacer. Solo usa cifras del CRM.</p>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {analisis && (
        <div className="mt-2 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <BadgeEstado tono={RIESGO[analisis.riesgo].tono}>{RIESGO[analisis.riesgo].etiqueta}</BadgeEstado>
            <span className="text-[11px] text-muted-foreground">{analisis.modelo}</span>
          </div>
          <p className="leading-relaxed">{analisis.resumen}</p>
          <ol className="space-y-1.5">
            {analisis.acciones.map((a, i) => (
              <li key={i} className="flex gap-2 rounded-md bg-card px-2.5 py-1.5 shadow-sm">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--chart-1)]/15 text-[11px] font-bold text-[var(--chart-1)]">{i + 1}</span>
                <span><span className="font-semibold">{a.titulo}</span> <span className="text-muted-foreground">· {a.porque}</span></span>
              </li>
            ))}
          </ol>
          {analisis.oportunidad && (
            <p className="flex items-start gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-emerald-800">
              <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {analisis.oportunidad}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default AnalisisIACliente
