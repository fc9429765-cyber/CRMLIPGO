"use client"

// Encabezado ejecutivo del tablero, al estilo del que LIPgo usa en su
// Dashboard Gerencia: título, fecha en español, badge de tiempo real, selector
// de empresa y reloj de Bogotá en vivo.
//
// El reloj no es adorno. En un tablero que se deja abierto todo el día, ver la
// hora avanzando es lo que distingue "esto está vivo" de "esto se quedó
// congelado hace dos horas y no me enteré".

import { useEffect, useState } from "react"
import { Radio, MapPin, ChevronDown, Clock, RefreshCw } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

interface Props {
  titulo: string
  subtitulo?: string
  /** Se muestra girando mientras refresca, para que el usuario sepa que el
   *  tablero se está actualizando solo. */
  refrescando?: boolean
  onRefrescar?: () => void
}

export function EncabezadoEjecutivo({ titulo, subtitulo, refrescando, onRefrescar }: Props) {
  const {
    accessibleEmpresas, selectedEmpresaId, selectedEmpresaNombre,
    setSelectedEmpresaId, profile,
  } = useAuth()

  const [ahora, setAhora] = useState<Date>(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const fecha = new Intl.DateTimeFormat("es-CO", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
    timeZone: "America/Bogota",
  })
    .format(ahora)
    // Cada palabra en mayúscula inicial: "Lunes, 22 De Septiembre" se lee
    // mejor que todo en minúscula.
    .replace(/\b\p{L}/gu, (m) => m.toUpperCase())

  const hora = new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true, timeZone: "America/Bogota",
  }).format(ahora)

  const empresa = selectedEmpresaNombre || profile?.empresa_nombre || "Harinera Indupan"

  return (
    <header className="flex flex-col gap-3 duration-500 animate-in fade-in slide-in-from-top-2 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-balance text-xl font-bold tracking-tight text-foreground md:text-2xl">
          {titulo}
        </h1>
        <p className="mt-0.5 text-xs capitalize text-muted-foreground">
          {subtitulo ?? fecha}
        </p>
      </div>

      {/* En móvil el grupo desplaza en horizontal en vez de apilarse: ocupa
          una línea y no empuja el contenido del tablero hacia abajo. */}
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin] md:flex-wrap">
        <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#D4A95E]/60 bg-[#D4A95E]/15 px-2.5 py-1.5">
          <Radio className="h-3.5 w-3.5 text-[#7A5A24]" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#7A5A24]">
            Tiempo real
          </span>
        </div>

        {/* El selector solo aparece con más de una empresa: con una sola es un
            desplegable que no despliega nada. */}
        {accessibleEmpresas.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm transition-colors hover:bg-muted"
              >
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="max-w-[140px] truncate text-xs font-medium text-foreground">
                  {empresa}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[200px]">
              {accessibleEmpresas.map((e) => (
                <DropdownMenuItem
                  key={e.id}
                  onClick={() => setSelectedEmpresaId(e.id)}
                  className={e.id === selectedEmpresaId ? "bg-accent text-accent-foreground" : undefined}
                >
                  {e.nombre}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 shadow-sm">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="max-w-[160px] truncate text-xs font-medium text-foreground">
              {empresa}
            </span>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <Clock className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
          <span className="text-xs font-semibold tabular-nums text-emerald-800">{hora}</span>
        </div>

        {onRefrescar && (
          <Button
            variant="ghost" size="sm"
            onClick={onRefrescar}
            disabled={refrescando}
            className="shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refrescando ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>
    </header>
  )
}

export default EncabezadoEjecutivo
