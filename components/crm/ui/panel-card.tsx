"use client"

// Panel con cabecera, copiado del dashboard ejecutivo de LIPgo.
//
// Es el contenedor de todo lo que no es un KPI suelto: una gráfica, una lista,
// un ranking. La cabecera lleva icono en recuadro de color, título y subtítulo,
// y admite algo a la derecha (un filtro, un enlace).

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type PanelAccent = "primary" | "success" | "warning" | "danger" | "info" | "neutral"

interface PanelCardProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  accent?: PanelAccent
  /** Filtro, contador o enlace alineado a la derecha de la cabecera. */
  headerRight?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}

/** Mismos tintes que el KPI card, para que un panel y una tarjeta del mismo
 *  color se lean como parte de lo mismo. */
const ICONO: Record<PanelAccent, string> = {
  primary: "bg-[#0f7b6f]/15 text-[#0c6b61] border-[#0f7b6f]/40",
  success: "bg-emerald-100 text-emerald-700 border-emerald-300",
  warning: "bg-amber-100 text-amber-700 border-amber-300",
  danger: "bg-rose-100 text-rose-700 border-rose-300",
  info: "bg-violet-100 text-violet-700 border-violet-300",
  neutral: "bg-slate-100 text-slate-600 border-slate-300",
}

export function PanelCard({
  title,
  subtitle,
  icon,
  accent = "primary",
  headerRight,
  className,
  bodyClassName,
  children,
}: PanelCardProps) {
  return (
    <div
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
        // Sombra tenue al pasar por encima, sin mover la tarjeta: en un
        // tablero con varios paneles, que todos salten marea.
        "transition-shadow duration-300 hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                ICONO[accent],
              )}
            >
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
            {subtitle && (
              <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
            )}
          </div>
        </div>

        {headerRight && <div className="flex shrink-0 items-center gap-2">{headerRight}</div>}
      </div>

      <div className={cn("flex-1 p-4", bodyClassName)}>{children}</div>
    </div>
  )
}

export default PanelCard
