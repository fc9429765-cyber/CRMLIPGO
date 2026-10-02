"use client"

// Tarjeta de KPI ejecutiva. SIN USO ACTUAL.
//
// Mide unos 145px de alto. Es la del tablero de gerencia de LIPgo, pensada
// para una pantalla colgada en la pared. En el CRM se probo en los dos
// tableros y ocupaba demasiado: el usuario quiere leer las cifras de un
// vistazo y bajar a lo que pide accion, y el doble de alto empuja el resto
// fuera de la pantalla. Los dos tableros usan ahora `KpiCompacto`.
//
// Se conserva por si alguna vez hay una pantalla de direccion a la que le
// convenga. Si al cabo de unos meses sigue sin usarse, borrala.
//
// Copia el patrón del dashboard ejecutivo de LIPgo: card blanca con borde
// sutil, glow de color difuminado en la esquina, icono en recuadro con su
// tinte pastel, valor grande con count-up y tendencia con flecha.
//
// Se conservan sus dos decisiones buenas:
//   - `invertTrend`, para los KPI donde SUBIR ES MALO (cartera vencida,
//     prospectos estancados). Sin eso un aumento de mora se pinta en verde.
//   - El valor numérico se anima; el de texto se muestra literal.

import type { LucideIcon } from "lucide-react"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCountUp, formatAnimatedNumber } from "./use-count-up"

export type KpiAccent =
  | "primary" | "success" | "warning" | "danger" | "info" | "neutral"

export interface KpiCardProps {
  icon: LucideIcon
  label: string
  /** Número → se anima. String → se pinta tal cual (ya formateado). */
  value: string | number
  unit?: string
  decimals?: number
  trend?: number
  trendHint?: string
  /** true cuando subir es mala noticia. */
  invertTrend?: boolean
  accent?: KpiAccent
  onClick?: () => void
  className?: string
}

/** Tintes pastel sobre card blanca, con texto oscuro para contraste. Son los
 *  mismos tonos del dashboard de LIPgo, renombrados a la semántica del CRM. */
const ACENTO: Record<
  KpiAccent,
  { iconoBg: string; iconoFg: string; iconoBorde: string; anillo: string; glow: string }
> = {
  primary: {
    iconoBg: "bg-[#0f7b6f]/15", iconoFg: "text-[#0c6b61]", iconoBorde: "border-[#0f7b6f]/40",
    anillo: "hover:ring-[#0f7b6f]/30", glow: "before:bg-[#0f7b6f]/20",
  },
  success: {
    iconoBg: "bg-emerald-100", iconoFg: "text-emerald-700", iconoBorde: "border-emerald-300",
    anillo: "hover:ring-emerald-300/60", glow: "before:bg-emerald-200/40",
  },
  warning: {
    iconoBg: "bg-amber-100", iconoFg: "text-amber-700", iconoBorde: "border-amber-300",
    anillo: "hover:ring-amber-300/60", glow: "before:bg-amber-200/40",
  },
  danger: {
    iconoBg: "bg-rose-100", iconoFg: "text-rose-700", iconoBorde: "border-rose-300",
    anillo: "hover:ring-rose-300/60", glow: "before:bg-rose-200/40",
  },
  info: {
    iconoBg: "bg-violet-100", iconoFg: "text-violet-700", iconoBorde: "border-violet-300",
    anillo: "hover:ring-violet-300/60", glow: "before:bg-violet-200/40",
  },
  neutral: {
    iconoBg: "bg-slate-100", iconoFg: "text-slate-600", iconoBorde: "border-slate-300",
    anillo: "hover:ring-slate-300/60", glow: "before:bg-slate-200/40",
  },
}

function formatearTendencia(trend: number): string {
  const signo = trend > 0 ? "+" : ""
  // Se redondea a un decimal para no mostrar "12.0000000001".
  const n = Number.isInteger(trend) ? trend : Math.round(trend * 10) / 10
  return `${signo}${n}%`
}

export function KpiCard({
  icon: Icono,
  label,
  value,
  unit,
  decimals = 0,
  trend,
  trendHint,
  invertTrend = false,
  accent = "primary",
  onClick,
  className,
}: KpiCardProps) {
  const a = ACENTO[accent]

  const esNumero = typeof value === "number" && Number.isFinite(value)
  const animado = useCountUp(esNumero ? (value as number) : 0)
  const mostrado = esNumero ? formatAnimatedNumber(animado, decimals) : String(value)

  // El signo decide el color; invertTrend lo da vuelta.
  const hayTrend = typeof trend === "number" && Number.isFinite(trend)
  let tono: "bueno" | "malo" | "neutro" = "neutro"
  if (hayTrend && trend !== 0) {
    const positivo = trend > 0
    tono = (invertTrend ? !positivo : positivo) ? "bueno" : "malo"
  }

  const IconoTrend =
    !hayTrend || trend === 0
      ? Minus
      : (trend > 0 && !invertTrend) || (trend < 0 && invertTrend)
        ? TrendingUp
        : TrendingDown

  const colorTrend =
    tono === "bueno" ? "text-emerald-600"
      : tono === "malo" ? "text-rose-600"
        : "text-muted-foreground"

  const clickeable = typeof onClick === "function"

  return (
    <div
      onClick={onClick}
      role={clickeable ? "button" : undefined}
      tabIndex={clickeable ? 0 : undefined}
      onKeyDown={
        clickeable
          ? (e) => {
              // Lo que se pulsa con el ratón debe poder pulsarse con teclado.
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick!()
              }
            }
          : undefined
      }
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
        // Glow difuminado en la esquina: es lo que le quita la planitud a la
        // tarjeta sin recargarla.
        "before:pointer-events-none before:absolute before:-right-10 before:-top-10",
        "before:h-32 before:w-32 before:rounded-full before:opacity-70 before:blur-2xl",
        a.glow,
        "transition-all duration-300 hover:shadow-md hover:ring-1",
        a.anillo,
        clickeable && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="relative p-4 md:p-5">
        <div className="flex items-start justify-between gap-2">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl border",
              a.iconoBg, a.iconoBorde,
            )}
          >
            <Icono className={cn("h-5 w-5", a.iconoFg)} aria-hidden="true" />
          </div>

          {hayTrend && (
            <div className={cn("flex items-center gap-1 text-xs font-semibold", colorTrend)}>
              <IconoTrend className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{formatearTendencia(trend)}</span>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tracking-tight tabular-nums text-foreground md:text-3xl">
            {mostrado}
          </span>
          {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
        </div>

        {/* Etiqueta y pie, con las medidas de LIPgo. Estaban en `text-sm`, que
            en una tarjeta estrecha empuja el texto a dos lineas y descuadra la
            fila entera cuando solo una de las tarjetas se parte. */}
        <div className="mt-1">
          <p className="text-[11px] font-semibold leading-tight text-foreground/80 md:text-xs">
            {label}
          </p>
          {trendHint && (
            <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
              {trendHint}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default KpiCard
