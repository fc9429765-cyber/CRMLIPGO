"use client"

// KPI compacto: el que LIPgo pone dentro de los módulos, no en el tablero.
//
// Son dos familias distintas a propósito y conviene no mezclarlas:
//   - `KpiCard` (kpi-card.tsx) es la tarjeta del tablero ejecutivo: grande,
//     con glow, tendencia y valor animado. Va en Inicio.
//   - Ésta es la tira de indicadores de un módulo: plana, sin sombra, `p-3`.
//     Acompaña a una tabla y no debe robarle protagonismo.
//
// Si se usara la premium dentro de cada módulo, cada pantalla parecería un
// tablero y el dato importante —la tabla— quedaría relegado abajo.

import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type TonoKpi = "primary" | "success" | "warning" | "danger" | "neutral"

const TONO: Record<TonoKpi, { iconoBg: string; iconoFg: string; valor: string }> = {
  primary: { iconoBg: "bg-[#0f7b6f]/15", iconoFg: "text-[#0c6b61]", valor: "text-foreground" },
  success: { iconoBg: "bg-emerald-100", iconoFg: "text-emerald-700", valor: "text-emerald-700" },
  warning: { iconoBg: "bg-amber-100", iconoFg: "text-amber-700", valor: "text-foreground" },
  danger: { iconoBg: "bg-rose-100", iconoFg: "text-rose-700", valor: "text-rose-700" },
  neutral: { iconoBg: "bg-muted", iconoFg: "text-muted-foreground", valor: "text-foreground" },
}

export function KpiCompacto({
  etiqueta,
  valor,
  detalle,
  icono: Icono,
  tono = "primary",
  onClick,
  className,
}: {
  etiqueta: string
  valor: string | number
  /** Segunda línea: el contexto que hace interpretable la cifra. */
  detalle?: string
  icono: LucideIcon
  tono?: TonoKpi
  /** Si se pasa, la tarjeta filtra la tabla de abajo al pulsarla. */
  onClick?: () => void
  className?: string
}) {
  const t = TONO[tono]

  return (
    <Card
      onClick={onClick}
      className={cn(
        "border-border/60 shadow-none transition-colors hover:border-border",
        onClick && "cursor-pointer hover:ring-1 hover:ring-ring/40",
        className,
      )}
    >
      <CardContent className="flex flex-col p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            {etiqueta}
          </p>
          <span className={cn("flex h-6 w-6 flex-none items-center justify-center rounded-md", t.iconoBg)}>
            <Icono className={cn("h-3.5 w-3.5", t.iconoFg)} aria-hidden="true" />
          </span>
        </div>

        <p
          className={cn(
            "mt-1.5 min-w-0 break-words text-lg font-bold leading-none tabular-nums sm:text-xl xl:text-[1.6rem]",
            t.valor,
          )}
        >
          {typeof valor === "number" ? valor.toLocaleString("es-CO") : valor}
        </p>

        {detalle && (
          <p className="mt-1 truncate text-[11px] leading-tight text-muted-foreground">{detalle}</p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Tira de KPIs de un módulo.
 *
 * `auto-fit` en vez de puntos de corte fijos: con tres indicadores se reparten
 * el ancho y con seis se acomodan solos, sin tener que declarar una rejilla
 * distinta en cada módulo.
 */
export function TiraKpi({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn("grid gap-3", className)}
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
    >
      {children}
    </div>
  )
}

/** Hueco de carga con la misma altura que la tarjeta, para que la tira no
 *  cambie de tamaño cuando llegan las cifras. */
export function KpiEsqueleto() {
  return <div className="h-[74px] animate-pulse rounded-xl border border-border/60 bg-muted/40" />
}

export default KpiCompacto
