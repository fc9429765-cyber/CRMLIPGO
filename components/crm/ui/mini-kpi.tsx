"use client"

// Baldosa de métrica: el KPI pequeño que LIPgo mete dentro de sus diálogos de
// detalle y encima de sus tablas.
//
// No es la tarjeta grande del tablero. Es el dato de apoyo: cabe media docena
// en una fila y no compite con el contenido que acompaña.

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type TonoMini = "neutral" | "exito" | "advertencia" | "peligro" | "info"

const TONO: Record<TonoMini, { caja: string; valor: string }> = {
  neutral: { caja: "border-border bg-muted/30", valor: "text-foreground" },
  exito: { caja: "border-emerald-300 bg-emerald-50", valor: "text-emerald-700" },
  advertencia: { caja: "border-amber-300 bg-amber-50", valor: "text-amber-700" },
  peligro: { caja: "border-red-300 bg-red-50", valor: "text-red-700" },
  info: { caja: "border-blue-300 bg-blue-50", valor: "text-blue-700" },
}

export function MiniKpi({
  etiqueta,
  valor,
  tono = "neutral",
  icono: Icono,
  className,
}: {
  etiqueta: string
  valor: string | number
  tono?: TonoMini
  icono?: LucideIcon
  className?: string
}) {
  const t = TONO[tono]
  return (
    <div className={cn("rounded-lg border p-3", t.caja, className)}>
      <div className="flex items-center justify-between gap-2">
        <div className={cn("text-lg font-bold tabular-nums", t.valor)}>{valor}</div>
        {Icono && <Icono className={cn("h-4 w-4 shrink-0 opacity-70", t.valor)} aria-hidden="true" />}
      </div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {etiqueta}
      </div>
    </div>
  )
}

/** Rejilla estándar para un grupo de baldosas. */
export function MiniKpiGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-4", className)}>{children}</div>
  )
}

/**
 * Barra de avance contra una meta.
 *
 * Hecha a mano y no con la primitiva `Progress` porque LIPgo la construye así
 * donde acompaña a un KPI: dos divs permiten poner el rótulo y el porcentaje
 * en la misma línea, que es como se lee de un vistazo.
 */
export function BarraMeta({
  etiqueta,
  porcentaje,
  className,
}: {
  etiqueta: string
  porcentaje: number
  className?: string
}) {
  // Se recorta a 0-100 para dibujar, pero el rótulo muestra el valor real:
  // pasarse de la meta es una buena noticia y el usuario debe verla.
  const ancho = Math.max(0, Math.min(100, porcentaje))
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{etiqueta}</span>
        <span className="tabular-nums">{Math.round(porcentaje)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            porcentaje >= 100 ? "bg-emerald-500" : "bg-[#D4A95E]",
          )}
          style={{ width: `${ancho}%` }}
        />
      </div>
    </div>
  )
}

export default MiniKpi
