"use client"

// Radar del Inicio: qué necesita atención hoy, antes de que alguien llame.
//
// Agrupa en tarjetas lo que ya está pasando o va a pasar: pedidos que no han
// salido de LIPgo (y cuántos días llevan de atraso), stock insuficiente en
// pedidos por despachar, aprobaciones esperando, cartera vencida y por vencer,
// cotizaciones que vencen, visitas atrasadas, envíos con error. Cada tarjeta
// se abre y cada fila lleva al sitio exacto con los datos puestos.
//
// Lo rojo va primero. Se refresca sola cada dos minutos.

import { useCallback, useEffect, useState } from "react"
import {
  Ban, Boxes, Cable, CalendarClock, CheckCircle2, ChevronDown, Clock, FileText, Loader2, Radar, RefreshCw, RotateCcw,
  Stamp, Truck, Wallet, type LucideIcon,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import type { RadarGrupo, RadarItem, TonoRadar } from "@/lib/crm-logistica-actions"
import { useRadar } from "@/lib/radar-cliente"
import { irA, irAModulo, type Intencion } from "@/lib/crm-navegacion"
import { ListaEscalonada, ElementoLista } from "@/components/crm/ui/movimiento"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const ICONO: Record<RadarGrupo["icono"], LucideIcon> = {
  truck: Truck, clock: Clock, ban: Ban, stamp: Stamp, rotate: RotateCcw, wallet: Wallet, file: FileText, boxes: Boxes, cable: Cable, calendar: CalendarClock,
}
const TONO: Record<TonoRadar, { borde: string; fondo: string; texto: string; punto: string }> = {
  peligro: { borde: "border-red-200", fondo: "bg-red-50/70", texto: "text-red-700", punto: "bg-red-500" },
  advertencia: { borde: "border-amber-200", fondo: "bg-amber-50/70", texto: "text-amber-800", punto: "bg-amber-500" },
  info: { borde: "border-blue-200", fondo: "bg-blue-50/60", texto: "text-blue-800", punto: "bg-blue-500" },
  exito: { borde: "border-emerald-200", fondo: "bg-emerald-50/60", texto: "text-emerald-800", punto: "bg-emerald-500" },
}
const pesos = (n: number) => "$ " + Math.round(n).toLocaleString("es-CO")

function abrir(i: RadarItem, g: RadarGrupo) {
  if (i.intencion) irA(i.intencion as unknown as Intencion)
  else irAModulo(i.modulo ?? g.modulo)
}

export function RadarPanel({ className }: { className?: string }) {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1
  const [abierto, setAbierto] = useState<string | null>(null)
  // Una sola consulta compartida con las tarjetas de áreas y el portal (lib/radar-cliente).
  const { datos, cargando, recargar } = useRadar(empresaId)
  const cargar = useCallback(() => recargar(true), [recargar])

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") cargar() }, 120_000)
    return () => clearInterval(t)
  }, [cargar])

  const grupos = datos?.grupos ?? []

  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--chart-1)]/10 text-[var(--chart-1)]">
            <Radar className="h-4 w-4" aria-hidden="true" />
            {(datos?.urgentes ?? 0) > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />}
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-tight">Radar · qué necesita atención hoy</h2>
            <p className="text-xs text-muted-foreground">
              {cargando && !datos ? "Revisando pedidos, despachos, cartera y aprobaciones…"
                : !grupos.length ? "Todo en orden: nada atrasado ni pendiente de ti."
                : `${datos!.total} asunto${datos!.total === 1 ? "" : "s"}${datos!.urgentes ? ` · ${datos!.urgentes} urgente${datos!.urgentes === 1 ? "" : "s"}` : ""}`}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cargar} disabled={cargando}>
          {cargando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} Actualizar
        </Button>
      </div>

      {cargando && !datos ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg border bg-muted/40" />)}
        </div>
      ) : !grupos.length ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Sin pendientes ni atrasos a la vista.
        </div>
      ) : (
        <ListaEscalonada className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
          {grupos.map((g) => {
            const t = TONO[g.tono]
            const Icono = ICONO[g.icono]
            const expandido = abierto === g.clave
            return (
              <ElementoLista key={g.clave} className={cn("rounded-lg border transition-shadow hover:shadow-sm", t.borde, t.fondo, expandido && "sm:col-span-2")}>
                <button type="button" className="flex w-full items-start gap-2.5 p-3 text-left" onClick={() => setAbierto(expandido ? null : g.clave)} aria-expanded={expandido}>
                  <span className={cn("mt-0.5 rounded-md bg-card p-1.5 shadow-sm", t.texto)}><Icono className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{g.titulo}</span>
                      <span className={cn("shrink-0 text-lg font-bold tabular-nums leading-none", t.texto)}>{g.cantidad}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">{g.descripcion}{g.valor ? ` · ${pesos(g.valor)}` : ""}</span>
                  </span>
                  <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", expandido && "rotate-180")} aria-hidden="true" />
                </button>
                {expandido && (
                  <ul className="divide-y border-t bg-card/70">
                    {g.items.map((i) => (
                      <li key={i.id}>
                        <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40" onClick={() => abrir(i, g)}>
                          <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", TONO[i.tono].punto)} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{i.texto}</span>
                            {i.detalle && <span className="block truncate text-muted-foreground">{i.detalle}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                    {g.cantidad > g.items.length && (
                      <li>
                        <button type="button" className="w-full px-3 py-2 text-left text-[11px] font-medium text-[var(--chart-1)] hover:underline" onClick={() => irAModulo(g.modulo)}>
                          Ver los {g.cantidad} en {g.modulo} →
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </ElementoLista>
            )
          })}
        </ListaEscalonada>
      )}
    </section>
  )
}

export default RadarPanel
