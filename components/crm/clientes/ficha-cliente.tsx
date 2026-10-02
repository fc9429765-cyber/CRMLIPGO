"use client"

// Ficha del cliente: todo lo que hay que saber de él en una sola tarjeta.
//
// Es la misma tarjeta en la venta, en el recaudo y en la Cuenta 360, para que
// el vendedor reconozca al cliente de un vistazo esté donde esté: quién es,
// cuánto cupo le queda (la barra), cuánto debe y cuánto está vencido, y las
// señales de lo que conviene hacer antes de venderle o cobrarle.
//
// Las cifras vienen de getCuenta360 —las mismas que ve Cartera al aprobar—
// y las señales de lib/crm-senales-cliente.ts. Aquí no se calcula nada.

import { useMemo, type ReactNode } from "react"
import { AlertTriangle, Ban, CheckCircle2, FileText, Info, type LucideIcon } from "lucide-react"
import type { Cuenta360 } from "@/lib/crm-cuenta-actions"
import { semaforoCliente, senalesCliente, type TonoSenal } from "@/lib/crm-senales-cliente"
import { hoyISO } from "@/lib/crm-fechas"
import { AccesosRapidos, accesosCliente } from "@/components/crm/ui/accesos-rapidos"
import { BadgeEstado } from "@/components/crm/ui/modulo"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const pesos = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO")

const SENAL: Record<TonoSenal, { icono: LucideIcon; clase: string }> = {
  peligro: { icono: Ban, clase: "border-red-200 bg-red-50 text-red-800" },
  advertencia: { icono: AlertTriangle, clase: "border-amber-200 bg-amber-50 text-amber-900" },
  info: { icono: Info, clase: "border-blue-200 bg-blue-50 text-blue-900" },
  exito: { icono: CheckCircle2, clase: "border-emerald-200 bg-emerald-50 text-emerald-800" },
}

const SEMAFORO = {
  rojo: "bg-red-500", ambar: "bg-amber-500", verde: "bg-emerald-500",
}

function iniciales(nombre: string) {
  const p = nombre.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?"
}

export function FichaCliente({
  cuenta: datos, compacta = false, diasAviso = 5, onVerFacturas, accesos = false, className, children,
}: {
  cuenta: Cuenta360
  /** Sin métricas secundarias ni desglose por owner: para formularios en el teléfono. */
  compacta?: boolean
  diasAviso?: number
  onVerFacturas?: () => void
  /** Botones para ir a venderle, cobrarle… (no en la propia Cuenta 360). */
  accesos?: boolean
  className?: string
  /** Contenido extra al pie (p. ej. el análisis con IA). */
  children?: ReactNode
}) {
  const { cliente, cuenta: c, porOwner, facturas } = datos
  const hoy = hoyISO()
  const senales = useMemo(
    () => senalesCliente({ cliente, cuenta: c, facturas }, hoy, diasAviso, compacta ? 3 : 5),
    [cliente, c, facturas, hoy, diasAviso, compacta],
  )
  const semaforo = semaforoCliente({ cliente, cuenta: c })
  const cupo = c.cupo
  const usoPct = cupo > 0 ? Math.min(150, (c.saldo / cupo) * 100) : 0
  const sobrecupo = cupo > 0 && c.disponible < 0
  const abiertas = facturas.filter((f) => f.saldo > 0).length

  return (
    <div className={cn("rounded-lg border bg-card p-3 shadow-sm sm:p-4", className)}>
      {/* ----------------------------------------------------- identidad */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--chart-1)]/15 text-sm font-bold text-[var(--chart-1)]">
            {iniciales(cliente.nombre)}
          </div>
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card", SEMAFORO[semaforo.nivel])} title={semaforo.etiqueta} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-sm font-semibold leading-tight">{cliente.nombre}</p>
            <BadgeEstado tono={semaforo.nivel === "rojo" ? "peligro" : semaforo.nivel === "ambar" ? "advertencia" : "exito"} className="text-[10px]">
              {semaforo.etiqueta}
            </BadgeEstado>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {[cliente.documento ? `NIT ${cliente.documento}` : null, cliente.vendedor_nombre ?? "Sin vendedor",
              cliente.dias_credito > 0 ? `crédito ${cliente.dias_credito} días` : "contado"].filter(Boolean).join(" · ")}
          </p>
        </div>
        {onVerFacturas && abiertas > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={onVerFacturas}>
            <FileText className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {abiertas} factura{abiertas === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      {/* --------------------------------------------------------- cupo */}
      {cupo > 0 ? (
        <div className="mt-3 space-y-1">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-muted-foreground">Cupo {pesos(cupo)} · usado {Math.round((c.saldo / cupo) * 100)} %</span>
            <span className={cn("font-semibold tabular-nums", sobrecupo ? "text-red-700" : "text-emerald-700")}>
              {sobrecupo ? `Sobrecupo ${pesos(-c.disponible)}` : `Disponible ${pesos(c.disponible)}`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all duration-500", usoPct >= 100 ? "bg-red-500" : usoPct >= 70 ? "bg-amber-500" : "bg-emerald-500")}
              style={{ width: `${Math.min(100, usoPct)}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">Sin cupo de crédito: ventas de contado.</p>
      )}

      {/* ----------------------------------------------------- métricas */}
      <div className={cn("mt-3 grid gap-2", compacta ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-6")}>
        <Metrica etiqueta="Saldo" valor={pesos(c.saldo)} />
        <Metrica etiqueta="Vencido" valor={pesos(c.vencido)} tono={c.vencido > 0 ? "rojo" : undefined} detalle={c.diasMora > 0 ? `${c.diasMora} d mora` : undefined} />
        <Metrica etiqueta="Por vencer" valor={pesos(c.alDia)} />
        {!compacta && (
          <>
            <Metrica etiqueta="A favor" valor={pesos(c.saldoFavor)} tono={c.saldoFavor > 0 ? "verde" : undefined} />
            <Metrica etiqueta="Facturas" valor={String(c.facturasAbiertas)} detalle={c.facturasVencidas ? `${c.facturasVencidas} vencidas` : "abiertas"} />
            <Metrica etiqueta="% vencido" valor={`${c.pctVencido.toLocaleString("es-CO")} %`} tono={c.pctVencido > 0 ? "rojo" : undefined} />
          </>
        )}
      </div>

      {/* --------------------------------------------- por owner (si aplica) */}
      {!compacta && porOwner.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {porOwner.map((o) => (
            <span key={o.ownerId ?? "sin"} className="rounded-md border bg-muted/40 px-2 py-0.5 text-[11px] tabular-nums">
              <span className="font-medium">{o.ownerNombre}:</span> {pesos(o.cuenta.saldo)}
              {o.cuenta.vencido > 0 && <span className="text-red-700"> · {pesos(o.cuenta.vencido)} vencido</span>}
            </span>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------ señales */}
      {senales.length > 0 && (
        <ul className="mt-3 space-y-1">
          {senales.map((s) => {
            const S = SENAL[s.tono]
            return (
              <li key={s.texto} className={cn("flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs", S.clase)}>
                <S.icono className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{s.texto}</span>
                  {s.detalle && !compacta && <span className="opacity-90"> · {s.detalle}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {accesos && (
        <div className="mt-3 border-t pt-3">
          <AccesosRapidos accesos={accesosCliente(cliente.id)} />
        </div>
      )}
      {children}
    </div>
  )
}

function Metrica({ etiqueta, valor, detalle, tono }: { etiqueta: string; valor: string; detalle?: string; tono?: "rojo" | "verde" }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-2 py-1.5">
      <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
      <p className={cn("truncate text-sm font-semibold tabular-nums", tono === "rojo" && "text-red-700", tono === "verde" && "text-emerald-700")}>{valor}</p>
      {detalle && <p className="truncate text-[10px] text-muted-foreground">{detalle}</p>}
    </div>
  )
}

/** Esqueleto mientras llega la cuenta: mantiene el alto para que nada salte. */
export function FichaClienteCargando({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className={cn("animate-pulse rounded-lg border bg-card p-3 sm:p-4", compacta ? "h-36" : "h-52")}>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-full bg-muted" />
        <div className="flex-1 space-y-2"><div className="h-3 w-1/2 rounded bg-muted" /><div className="h-2.5 w-1/3 rounded bg-muted" /></div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-muted" />
      <div className="mt-3 grid grid-cols-3 gap-2"><div className="h-10 rounded bg-muted" /><div className="h-10 rounded bg-muted" /><div className="h-10 rounded bg-muted" /></div>
    </div>
  )
}

export default FichaCliente
