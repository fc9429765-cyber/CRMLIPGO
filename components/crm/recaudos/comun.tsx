"use client"

// Piezas compartidas por la pantalla del vendedor y la bandeja de Cartera.
// Lo que se ve igual en las dos (el estado, el comprobante, el reparto, el
// historial) se dibuja aqui una sola vez, para que un recaudo no se lea
// distinto segun quien lo mire.

import { useEffect, useState } from "react"
import {
  AlertTriangle, CheckCircle, Clock, FileDown, FileImage, History, Loader2, XCircle,
} from "lucide-react"
import { getHistorialRecaudo, getUrlComprobante, type EventoRecaudo } from "@/lib/crm-recaudos-actions"
import { generarPdfRecaudo } from "@/lib/crm-recaudo-pdf"
import { listarMaestro } from "@/lib/crm-maestros-actions"
import { ESTADO_RECAUDO_LABEL, type AplicacionRecaudo, type EstadoRecaudo } from "@/lib/crm-recaudos"
import { BadgeEstado, type TonoEstado } from "@/components/crm/ui/modulo"
import { Button } from "@/components/ui/button"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export const cop = (n: number | null | undefined) =>
  "$ " + (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })

export const fechaHora = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("es-CO", {
        timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : "—"

const TONO: Record<EstadoRecaudo, { tono: TonoEstado; icono: typeof Clock }> = {
  pendiente_aprobacion: { tono: "advertencia", icono: Clock },
  aprobado: { tono: "exito", icono: CheckCircle },
  rechazado: { tono: "peligro", icono: XCircle },
  anulado: { tono: "neutral", icono: XCircle },
}

export function EstadoRecaudoBadge({ estado, className }: { estado: EstadoRecaudo; className?: string }) {
  const t = TONO[estado] ?? TONO.anulado
  return (
    <BadgeEstado tono={t.tono} icono={t.icono} className={cn("text-[11px]", className)}>
      {ESTADO_RECAUDO_LABEL[estado] ?? estado}
    </BadgeEstado>
  )
}

/** SAP solo se muestra si aplica: para Molinos siempre es "no_aplica". */
export function EstadoSapBadge({ estado }: { estado: string }) {
  if (!estado || estado === "no_aplica") return null
  const mapa: Record<string, [TonoEstado, string]> = {
    pendiente: ["proceso", "SAP pendiente"],
    enviado: ["exito", "En SAP"],
    error: ["peligro", "Error SAP"],
  }
  const [tono, texto] = mapa[estado] ?? ["neutral", estado]
  return <BadgeEstado tono={tono} className="text-[10px]">{texto}</BadgeEstado>
}

/** Alertas de la lectura del comprobante (REC-22): en ambar y a la vista. */
export function AlertasRecaudo({ alertas, className }: { alertas: string[] | null | undefined; className?: string }) {
  if (!alertas?.length) return null
  return (
    <div className={cn("rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900", className)}>
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Revisar antes de aprobar
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {alertas.map((a, i) => <li key={i}>{a}</li>)}
      </ul>
    </div>
  )
}

/** Abre el comprobante con una URL firmada que caduca (REC-23). */
export function BotonComprobante({ recaudoId, empresaId, disabled }: { recaudoId: number; empresaId: number; disabled?: boolean }) {
  const [abriendo, setAbriendo] = useState(false)
  const abrir = async () => {
    // La pestaña se abre ANTES de la llamada: si se abre despues, el navegador
    // la trata como ventana emergente no solicitada y la bloquea.
    const ventana = window.open("", "_blank")
    setAbriendo(true)
    const r = await getUrlComprobante(recaudoId, empresaId)
    setAbriendo(false)
    if (!r.success || !r.data) {
      ventana?.close()
      toast({ title: "No se pudo abrir el comprobante", description: r.error, variant: "destructive" })
      return
    }
    if (ventana) ventana.location.href = r.data.url
    else window.location.href = r.data.url
  }
  return (
    <Button variant="outline" size="sm" className="h-8" onClick={abrir} disabled={disabled || abriendo}>
      {abriendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileImage className="mr-1.5 h-3.5 w-3.5" />}
      Ver comprobante
    </Button>
  )
}

/** Descarga el documento de pago o el recibo de caja, segun el estado. */
export function BotonPdfRecaudo({
  recaudoId, empresaId, estado, variante = "outline",
}: {
  recaudoId: number
  empresaId: number
  estado: EstadoRecaudo
  variante?: "outline" | "default"
}) {
  const [generando, setGenerando] = useState(false)
  const descargar = async () => {
    setGenerando(true)
    const r = await generarPdfRecaudo(recaudoId, empresaId)
    setGenerando(false)
    if (!r.success || !r.base64) {
      toast({ title: "No se pudo generar el PDF", description: r.error, variant: "destructive" })
      return
    }
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
    const a = document.createElement("a")
    a.href = url
    a.download = r.nombreArchivo ?? "recaudo.pdf"
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return (
    <Button variant={variante} size="sm" className="h-8" onClick={descargar} disabled={generando}>
      {generando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
      {estado === "aprobado" ? "Recibo de caja" : "Documento de pago"}
    </Button>
  )
}

/** Tabla del reparto: factura por factura, con el saldo antes y despues. */
export function TablaAplicaciones({
  aplicaciones, saldoFavor, titulo,
}: {
  aplicaciones: Pick<AplicacionRecaudo, "cuenta_cobrar_id" | "numero_factura" | "fecha_vencimiento" | "valor_aplicado" | "valor_descuento" | "saldo_anterior" | "saldo_posterior">[]
  saldoFavor?: number
  titulo?: string
}) {
  return (
    <div className="space-y-1.5">
      {titulo && <p className="text-xs font-semibold text-muted-foreground">{titulo}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Factura</th>
              <th className="px-2 py-1.5 text-left font-medium">Vence</th>
              <th className="px-2 py-1.5 text-right font-medium">Saldo antes</th>
              <th className="px-2 py-1.5 text-right font-medium">Aplicado</th>
              <th className="px-2 py-1.5 text-right font-medium">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {aplicaciones.length === 0 ? (
              <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">Sin facturas abiertas</td></tr>
            ) : aplicaciones.map((a) => (
              <tr key={a.cuenta_cobrar_id} className="border-t">
                <td className="px-2 py-1.5 font-medium">{a.numero_factura ?? `CxC ${a.cuenta_cobrar_id}`}</td>
                <td className="px-2 py-1.5 tabular-nums">{a.fecha_vencimiento ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{cop(a.saldo_anterior)}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                  {cop(a.valor_aplicado)}
                  {Number(a.valor_descuento) > 0 && (
                    <span className="block text-[10px] font-normal text-muted-foreground">+ dto {cop(a.valor_descuento)}</span>
                  )}
                </td>
                <td className={cn("px-2 py-1.5 text-right tabular-nums", Number(a.saldo_posterior) === 0 && "text-emerald-700")}>
                  {Number(a.saldo_posterior) === 0 ? "Pagada" : cop(a.saldo_posterior)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!saldoFavor && saldoFavor > 0 && (
        <p className="text-xs text-emerald-700">Sobran {cop(saldoFavor)}: quedan como saldo a favor del cliente.</p>
      )}
    </div>
  )
}

const ETIQUETA_EVENTO: Record<string, string> = {
  registrado: "Registrado",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  reenviado: "Corregido y reenviado",
  anulado: "Anulado",
}

/** Historial de aprobacion (REC-06): quien, cuando y por que. */
export function HistorialRecaudo({ recaudoId, empresaId }: { recaudoId: number; empresaId: number }) {
  const [eventos, setEventos] = useState<EventoRecaudo[] | null>(null)
  useEffect(() => {
    let vivo = true
    getHistorialRecaudo(recaudoId, empresaId).then((r) => vivo && setEventos(r.success ? r.data ?? [] : []))
    return () => { vivo = false }
  }, [recaudoId, empresaId])

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <History className="h-3.5 w-3.5" aria-hidden="true" /> Historial
      </p>
      {eventos === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : eventos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin eventos.</p>
      ) : (
        <ol className="space-y-2 border-l pl-3">
          {eventos.map((e) => (
            <li key={e.id} className="relative text-xs">
              <span
                className={cn(
                  "absolute -left-[17px] top-1 h-2 w-2 rounded-full",
                  e.tipo === "aprobado" ? "bg-emerald-500" : e.tipo === "rechazado" || e.tipo === "anulado" ? "bg-red-500" : "bg-[var(--chart-1)]",
                )}
              />
              <p>
                <span className="font-medium">{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}</span>
                <span className="text-muted-foreground"> · {e.usuario_nombre ?? "—"} · {fechaHora(e.creado_en)}</span>
              </p>
              {e.nota && <p className="text-muted-foreground">{e.nota}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Maestros

export interface Opcion { id: number; nombre: string }
export interface MedioPago extends Opcion { requiere_banco: boolean; requiere_comprobante: boolean }
export interface CuentaDestino extends Opcion { banco_id: number | null; owner_id: number | null }
export interface MotivoRechazo extends Opcion { exige_nota: boolean }

export interface MaestrosRecaudo {
  medios: MedioPago[]
  bancos: Opcion[]
  cuentas: CuentaDestino[]
  owners: Opcion[]
  motivos: MotivoRechazo[]
}

const activo = (f: Record<string, unknown>) => f.activo !== false

/** Los maestros que usa un recaudo, leidos una vez por pantalla. */
export function useMaestrosRecaudo(empresaId: number): MaestrosRecaudo | null {
  const [m, setM] = useState<MaestrosRecaudo | null>(null)
  useEffect(() => {
    let vivo = true
    Promise.all([
      listarMaestro("medios_pago", empresaId),
      listarMaestro("bancos", empresaId),
      listarMaestro("cuentas_destino", empresaId),
      listarMaestro("owners", empresaId),
      listarMaestro("motivos", empresaId),
    ]).then(([me, ba, cu, ow, mo]) => {
      if (!vivo) return
      const filas = (r: typeof me) => (r.success ? (r.data ?? []).filter(activo) : [])
      setM({
        medios: filas(me).map((f) => ({
          id: f.id, nombre: String(f.nombre ?? ""),
          requiere_banco: f.requiere_banco === true, requiere_comprobante: f.requiere_comprobante === true,
        })),
        bancos: filas(ba).map((f) => ({ id: f.id, nombre: String(f.nombre ?? "") })),
        cuentas: filas(cu).map((f) => ({
          id: f.id, nombre: String(f.alias ?? ""),
          banco_id: (f.banco_id as number) ?? null, owner_id: (f.owner_id as number) ?? null,
        })),
        owners: filas(ow).map((f) => ({ id: f.id, nombre: String(f.nombre ?? "") })),
        motivos: filas(mo).filter((f) => f.tipo === "rechazo_recaudo")
          .map((f) => ({ id: f.id, nombre: String(f.nombre ?? ""), exige_nota: f.exige_nota === true })),
      })
    })
    return () => { vivo = false }
  }, [empresaId])
  return m
}

