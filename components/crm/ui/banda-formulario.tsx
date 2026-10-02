"use client"

// Banda de encabezado de un formulario de captura, calcada de LIPgo
// ("Registro de Nuevos Pedidos") con la piel del manual Indupan: negro
// elevado, filete dorado abajo, título en blanco harina y una línea que dice qué se espera de la pantalla. Marca que aquí
// se ESCRIBE, a diferencia de los listados, que llevan el título con icono.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function BandaFormulario({
  titulo, subtitulo, derecha, className, enDialogo = false,
}: {
  titulo: ReactNode
  subtitulo?: ReactNode
  /** Botones a la derecha (volver, ayuda…). */
  derecha?: ReactNode
  className?: string
  /** Dentro de un DialogContent (padding 24px): la banda se pega a los bordes. */
  enDialogo?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b-2 border-[#D4A95E] bg-[#1A1715] p-4 text-[#F7F3EC]",
        enDialogo ? "-mx-6 -mt-6 mb-4 rounded-t-lg" : "rounded-t-lg",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-lg font-bold leading-tight">{titulo}</h1>
        {subtitulo && <p className="mt-0.5 text-xs text-[#D4A95E]">{subtitulo}</p>}
      </div>
      {derecha && <div className="flex shrink-0 items-center gap-2 [&_button]:border-white/30 [&_button]:bg-white/10 [&_button]:text-white [&_button:hover]:bg-white/20">{derecha}</div>}
    </div>
  )
}

export default BandaFormulario
