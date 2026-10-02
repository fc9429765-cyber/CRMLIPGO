"use client"

// Sub-navegación en píldoras, copiada del dashboard ejecutivo de LIPgo.
//
// Se usa cuando un módulo tiene varias vistas del mismo asunto (cartera:
// pendientes / vencidas / pagos / comisiones). Frente a `Tabs`, esto desplaza
// en horizontal sin romperse en el móvil, que es donde el vendedor lo abre.
//
// La sombra de color bajo la píldora activa es un detalle de LIPgo: marca la
// selección sin depender solo del relleno, que se pierde en pantallas con poco
// contraste y a plena luz.

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface VistaSubNav<T extends string = string> {
  valor: T
  etiqueta: string
  icono?: LucideIcon
  /** Contador a la derecha (pendientes, vencidos…). */
  contador?: number
}

export function SubNav<T extends string>({
  vistas,
  activa,
  onCambiar,
  derecha,
  className,
}: {
  vistas: VistaSubNav<T>[]
  activa: T
  onCambiar: (v: T) => void
  /** Filtro o acción alineada a la derecha. */
  derecha?: React.ReactNode
  className?: string
}) {
  return (
    <nav className={cn("flex flex-col gap-2 md:flex-row md:items-center md:justify-between", className)}>
      <div
        role="tablist"
        aria-label="Vistas del módulo"
        className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin]"
      >
        {vistas.map((v) => {
          const Icono = v.icono
          const activo = v.valor === activa
          return (
            <button
              key={v.valor}
              type="button"
              role="tab"
              aria-selected={activo}
              onClick={() => onCambiar(v.valor)}
              className={cn(
                "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2",
                "text-xs font-medium transition-all duration-200 md:text-sm",
                activo
                  ? "border-[#1A1715] bg-[#1A1715] text-[#F7F3EC] shadow-[0_8px_24px_-8px_rgba(26,23,21,0.45)] dark:border-[#D4A95E] dark:bg-[#D4A95E] dark:text-[#0B0B0C]"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {Icono && <Icono className="h-4 w-4" aria-hidden="true" />}
              <span>{v.etiqueta}</span>
              {v.contador !== undefined && v.contador > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
                    activo ? "bg-white/25 text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  {v.contador}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {derecha && <div className="flex shrink-0 items-center gap-2">{derecha}</div>}
    </nav>
  )
}

export default SubNav
