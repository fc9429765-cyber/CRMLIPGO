"use client"

// Dónde va el pedido en LIPgo, dentro del detalle del CRM: programado, en
// orden de cargue (con vehículo y transporte) o entregado. Antes el CRM se
// detenía en "programado" y había que abrir LIPgo para saber si salió.

import { useEffect, useState } from "react"
import { CheckCircle2, Clock, Loader2, PackageCheck, Truck, XCircle, type LucideIcon } from "lucide-react"
import { getEstadoLogistico, type EstadoLogistico, type FaseLogistica } from "@/lib/crm-logistica-actions"
import { cn } from "@/lib/utils"

const FASE: Record<FaseLogistica, { icono: LucideIcon; clase: string; paso: number }> = {
  sin_lipgo: { icono: XCircle, clase: "border-red-200 bg-red-50 text-red-800", paso: 0 },
  programado: { icono: Clock, clase: "border-amber-200 bg-amber-50 text-amber-900", paso: 1 },
  en_despacho: { icono: Truck, clase: "border-blue-200 bg-blue-50 text-blue-900", paso: 2 },
  entregado: { icono: PackageCheck, clase: "border-emerald-200 bg-emerald-50 text-emerald-800", paso: 3 },
  parcial: { icono: PackageCheck, clase: "border-amber-200 bg-amber-50 text-amber-900", paso: 3 },
  anulado: { icono: XCircle, clase: "border-red-200 bg-red-50 text-red-800", paso: 0 },
  desconocido: { icono: Clock, clase: "border bg-muted/40 text-muted-foreground", paso: 0 },
}
const PASOS = ["Programado", "Orden de cargue", "Entregado"]

export function EstadoLogisticoPedido({ idpedidoLipgo, empresaId }: { idpedidoLipgo: number | null; empresaId: number }) {
  const [e, setE] = useState<EstadoLogistico | null | undefined>(undefined)
  useEffect(() => {
    if (!idpedidoLipgo) { setE(null); return }
    let vivo = true
    getEstadoLogistico([idpedidoLipgo], empresaId).then((r) => vivo && setE(r.success && r.data ? r.data[idpedidoLipgo] ?? null : null))
    return () => { vivo = false }
  }, [idpedidoLipgo, empresaId])

  if (!idpedidoLipgo) return null
  if (e === undefined) return <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando LIPgo…</div>
  if (e === null) return <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">LIPgo #{idpedidoLipgo}: sin información de despacho.</p>

  const f = FASE[e.fase]
  const Icono = f.icono
  return (
    <div className={cn("rounded-md border px-3 py-2 text-xs", f.clase)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold">
          <Icono className="h-4 w-4" aria-hidden="true" /> LIPgo #{e.idpedido} · {e.etiqueta}
          {e.diasAtraso > 0 && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] text-white">{e.diasAtraso} d de atraso</span>}
        </p>
        {/* Los tres pasos del despacho, con el actual marcado. */}
        <ol className="flex items-center gap-1 text-[10px]">
          {PASOS.map((p, i) => {
            const n = i + 1
            const hecho = f.paso >= n
            return (
              <li key={p} className="flex items-center gap-1">
                <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold", hecho ? "border-current bg-current text-white" : "border-current/40 opacity-60")}>
                  {hecho ? <CheckCircle2 className="h-3 w-3 text-white" /> : n}
                </span>
                <span className={cn(!hecho && "opacity-60")}>{p}</span>
                {i < PASOS.length - 1 && <span className="mx-0.5 h-px w-3 bg-current opacity-40" />}
              </li>
            )
          })}
        </ol>
      </div>
      <p className="mt-1 opacity-90">
        {[e.fecha_programada ? `Programado para ${e.fecha_programada}` : null, e.ocargue ? `Orden ${e.ocargue}${e.fechaordencargue ? ` del ${e.fechaordencargue}` : ""}` : null,
          e.vehiculo ? `Vehículo ${e.vehiculo}` : null, e.transporte ? `Transporte ${e.transporte}` : null,
          e.fechadeentrega ? `Entregado el ${e.fechadeentrega}` : null, e.factura ? `Factura ${e.factura}` : null].filter(Boolean).join(" · ")}
      </p>
    </div>
  )
}

export default EstadoLogisticoPedido
