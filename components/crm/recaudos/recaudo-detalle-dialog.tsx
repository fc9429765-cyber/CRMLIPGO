"use client"

// Detalle de un recaudo. Lo abren el vendedor (para ver en qué va y corregir
// si lo rechazaron) y Cartera (para decidir).
//
// Cartera decide con todo en una pantalla, en el orden en que lo revisa:
// las alertas de la lectura del comprobante, el comprobante mismo, los datos
// digitados junto a los leídos, y el reparto. El reparto es editable (REC-18):
// Cartera puede mover valores entre facturas y, si administra descuentos,
// registrar un descuento (REC-19). El vendedor solo lo ve.

import { useEffect, useMemo, useState } from "react"
import { Ban, CheckCircle, Loader2, Pencil, Receipt, RotateCcw, XCircle } from "lucide-react"
import {
  aprobarRecaudo, anularRecaudo, getRecaudo, proponerAplicacion, rechazarRecaudo,
  type CarteraParaRecaudo, type PermisosRecaudo,
} from "@/lib/crm-recaudos-actions"
import { validarAplicacionManual } from "@/lib/crm-cartera-aplicacion"
import type { RecaudoConDetalle } from "@/lib/crm-recaudos"
import {
  AlertasRecaudo, BotonComprobante, BotonPdfRecaudo, EstadoRecaudoBadge, EstadoSapBadge, HistorialRecaudo,
  TablaAplicaciones, cop, fechaHora, type MaestrosRecaudo,
} from "@/components/crm/recaudos/comun"
import { DetalleDialog, FuenteDato } from "@/components/crm/ui/detalle-dialog"
import { Dato, ResumenDatos } from "@/components/crm/ui/modulo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type Decision = null | "rechazar" | "anular"

export function RecaudoDetalleDialog({
  recaudoId, empresaId, permisos, maestros, onCerrar, onCambio, onCorregir,
}: {
  recaudoId: number
  empresaId: number
  permisos: PermisosRecaudo
  maestros: MaestrosRecaudo | null
  onCerrar: () => void
  /** Tras aprobar, rechazar o anular: la lista de atrás debe recargar. */
  onCambio: () => void
  /** Solo en la pantalla del vendedor: abre el formulario de corrección. */
  onCorregir?: (r: RecaudoConDetalle) => void
}) {
  const [r, setR] = useState<RecaudoConDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cartera, setCartera] = useState<CarteraParaRecaudo | null>(null)
  const [editando, setEditando] = useState(false)
  const [reparto, setReparto] = useState<Record<number, { aplicado: string; descuento: string }>>({})
  const [nota, setNota] = useState("")
  const [decision, setDecision] = useState<Decision>(null)
  const [motivoId, setMotivoId] = useState("")
  const [trabajando, setTrabajando] = useState(false)

  const cargar = async () => {
    const res = await getRecaudo(recaudoId, empresaId)
    if (!res.success || !res.data) { setError(res.error ?? "No encontrado"); return }
    setR(res.data)
  }
  useEffect(() => { cargar() }, [recaudoId, empresaId]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = permisos.aprobar && r?.estado === "pendiente_aprobacion"

  // Las facturas abiertas HOY, para que Cartera reparta contra saldos reales.
  useEffect(() => {
    if (!r || !decide) return
    proponerAplicacion(r.cliente_id, r.owner_id, 0, empresaId).then((x) => x.success && x.data && setCartera(x.data))
  }, [r, decide, empresaId])

  const empezarEdicion = () => {
    if (!r || !cartera) return
    const propuesto = new Map((r.aplicaciones ?? []).map((a) => [a.cuenta_cobrar_id, a]))
    setReparto(Object.fromEntries(cartera.facturas.map((f) => [f.id, {
      aplicado: String(Math.round(Number(propuesto.get(f.id)?.valor_aplicado ?? 0))),
      descuento: "0",
    }])))
    setEditando(true)
  }

  const listaManual = useMemo(
    () => Object.entries(reparto).map(([id, v]) => ({
      cuenta_cobrar_id: Number(id), valor_aplicado: Number(v.aplicado) || 0, valor_descuento: Number(v.descuento) || 0,
    })),
    [reparto],
  )
  const erroresManual = useMemo(
    () => (editando && r && cartera
      ? validarAplicacionManual(r.valor, cartera.facturas, listaManual, { permiteDescuento: permisos.descuentos })
      : []),
    [editando, r, cartera, listaManual, permisos.descuentos],
  )
  const totalManual = listaManual.reduce((s, a) => s + a.valor_aplicado, 0)

  const aprobar = async () => {
    if (!r) return
    setTrabajando(true)
    const res = await aprobarRecaudo(
      r.id,
      editando ? listaManual.filter((a) => a.valor_aplicado > 0 || a.valor_descuento > 0) : null,
      nota.trim() || null,
      empresaId,
    )
    setTrabajando(false)
    if (!res.success) {
      toast({ title: "No se aprobó", description: res.error, variant: "destructive" })
      return
    }
    toast({
      title: `Recaudo ${r.numero} aprobado`,
      description: `${cop(res.data?.totalAplicado)} aplicados${res.data?.saldoFavor ? ` · ${cop(res.data.saldoFavor)} a favor` : ""}`,
    })
    onCambio()
    await cargar()
    setEditando(false)
  }

  const motivo = maestros?.motivos.find((m) => String(m.id) === motivoId) ?? null
  const puedeRechazar = !!(motivo ? !motivo.exige_nota || nota.trim() : nota.trim())

  const rechazar = async () => {
    if (!r) return
    setTrabajando(true)
    const res = await rechazarRecaudo(r.id, motivo ? motivo.id : null, nota, empresaId)
    setTrabajando(false)
    if (!res.success) { toast({ title: "No se rechazó", description: res.error, variant: "destructive" }); return }
    toast({ title: `Recaudo ${r.numero} rechazado`, description: "El vendedor puede corregirlo y reenviarlo." })
    onCambio()
    onCerrar()
  }

  const anular = async () => {
    if (!r || !nota.trim()) return
    setTrabajando(true)
    const res = await anularRecaudo(r.id, nota.trim(), empresaId)
    setTrabajando(false)
    if (!res.success) { toast({ title: "No se anuló", description: res.error, variant: "destructive" }); return }
    toast({ title: `Recaudo ${r.numero} anulado`, description: r.estado === "aprobado" ? "Los saldos se devolvieron." : undefined })
    onCambio()
    onCerrar()
  }

  const pie = !r ? null : (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        <BotonComprobante recaudoId={r.id} empresaId={empresaId} disabled={!r.comprobante_id} />
        <BotonPdfRecaudo recaudoId={r.id} empresaId={empresaId} estado={r.estado} />
      </div>
      <div className="flex flex-wrap gap-2">
        {onCorregir && r.estado === "rechazado" && (
          <Button size="sm" className="h-8" onClick={() => onCorregir(r)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Corregir y reenviar
          </Button>
        )}
        {permisos.aprobar && (r.estado === "pendiente_aprobacion" || r.estado === "aprobado") && decision === null && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => { setDecision("anular"); setNota("") }}>
            <Ban className="mr-1.5 h-3.5 w-3.5" /> Anular
          </Button>
        )}
        {decide && decision === null && (
          <>
            <Button variant="outline" size="sm" className="h-8 border-red-200 text-red-700 hover:bg-red-50" onClick={() => { setDecision("rechazar"); setNota("") }}>
              <XCircle className="mr-1.5 h-3.5 w-3.5" /> Rechazar
            </Button>
            <Button size="sm" className="h-8" onClick={aprobar} disabled={trabajando || erroresManual.length > 0}>
              {trabajando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-1.5 h-3.5 w-3.5" />}
              Aprobar {editando ? "con este reparto" : ""}
            </Button>
          </>
        )}
      </div>
    </div>
  )

  return (
    <DetalleDialog
      abierto
      onCerrar={onCerrar}
      icono={Receipt}
      ancho="tabla"
      titulo={r ? `Recaudo ${r.numero ?? `#${r.id}`}` : "Recaudo"}
      subtitulo={r ? `${r.cliente_nombre ?? "—"}${r.owner_nombre ? ` · ${r.owner_nombre}` : ""}` : undefined}
      pie={pie}
    >
      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : !r ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <EstadoRecaudoBadge estado={r.estado} />
            <EstadoSapBadge estado={r.sap_estado} />
            {(r.version ?? 1) > 1 && <span className="text-[11px] text-muted-foreground">Reenvío v{r.version}</span>}
          </div>

          {r.estado === "rechazado" && r.motivo_rechazo && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
              <span className="font-semibold">Rechazado por {r.rechazado_nombre ?? "Cartera"}:</span> {r.motivo_rechazo}
            </div>
          )}
          {r.estado === "anulado" && (
            <div className="rounded-md border bg-muted/40 p-2.5 text-xs">
              <span className="font-semibold">Anulado por {r.anulado_nombre ?? "—"}</span> · {fechaHora(r.anulado_en)}: {r.motivo_anulacion}
            </div>
          )}

          <AlertasRecaudo alertas={r.ocr_alertas} />

          <ResumenDatos className="md:grid-cols-3 lg:grid-cols-3">
            <Dato etiqueta="Valor" num><span className="text-base font-semibold">{cop(r.valor)}</span></Dato>
            <Dato etiqueta="Fecha del pago" num>{r.fecha_documento}</Dato>
            <Dato etiqueta="Medio">{r.medio_pago_nombre}</Dato>
            <Dato etiqueta="Banco">{r.banco_nombre}</Dato>
            <Dato etiqueta="Cuenta destino">{r.cuenta_destino_alias}</Dato>
            <Dato etiqueta="Referencia">{r.referencia}</Dato>
            <Dato etiqueta="Vendedor">{r.vendedor_nombre}</Dato>
            <Dato etiqueta="Registrado">{`${r.registrado_nombre ?? "—"} · ${fechaHora(r.registrado_en)}`}</Dato>
            {r.aprobado_en && <Dato etiqueta="Aprobado">{`${r.aprobado_nombre ?? "—"} · ${fechaHora(r.aprobado_en)}`}</Dato>}
          </ResumenDatos>
          {r.observaciones && <p className="text-xs text-muted-foreground">“{r.observaciones}”</p>}

          {/* Lo que leyó la IA, al lado de lo digitado: Cartera compara sin abrir nada más. */}
          {r.ocr && (
            <div className="rounded-md border p-2.5 text-xs">
              <p className="mb-1 font-semibold text-muted-foreground">Leído del comprobante{r.ocr.modelo ? ` (${r.ocr.modelo})` : ""}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                <span>Valor: <b className="tabular-nums">{r.ocr.valor != null ? cop(r.ocr.valor) : "—"}</b></span>
                <span>Fecha: <b>{r.ocr.fecha ?? "—"}</b></span>
                <span>Banco: <b>{r.ocr.banco ?? "—"}</b></span>
                <span>Ref.: <b>{r.ocr.referencia ?? "—"}</b></span>
              </div>
              <p className="mt-1 text-muted-foreground">Confianza {Math.round((r.ocr.confianza ?? 0) * 100)} %</p>
            </div>
          )}

          {/* --------------------------------------------------------- Reparto */}
          {!editando ? (
            <div className="space-y-2">
              <TablaAplicaciones
                titulo={r.estado === "aprobado" ? "Aplicado a" : "Reparto propuesto (la más vencida primero)"}
                aplicaciones={(r.aplicaciones ?? []).filter((a) => Number(a.valor_aplicado) > 0 || Number(a.valor_descuento) > 0)}
                saldoFavor={r.estado === "aprobado"
                  ? Number(r.saldo_favor_valor)
                  : Math.max(0, Number(r.valor) - (r.aplicaciones ?? []).reduce((s, a) => s + Number(a.valor_aplicado), 0))}
              />
              {decide && cartera && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={empezarEdicion}>
                  <Pencil className="mr-1.5 h-3 w-3" /> Ajustar reparto
                </Button>
              )}
            </div>
          ) : cartera && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Reparto manual (REC-18)</p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Factura</th>
                      <th className="px-2 py-1.5 text-left font-medium">Vence</th>
                      <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
                      <th className="px-2 py-1.5 text-right font-medium">Aplicar</th>
                      {permisos.descuentos && <th className="px-2 py-1.5 text-right font-medium">Descuento</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {cartera.facturas.map((f) => (
                      <tr key={f.id} className="border-t">
                        <td className="px-2 py-1">{f.numero ?? `CxC ${f.id}`}</td>
                        <td className={cn("px-2 py-1 tabular-nums", f.dias_vencido > 0 && "text-red-600")}>
                          {f.fecha_vencimiento}{f.dias_vencido > 0 ? ` (${f.dias_vencido} d)` : ""}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{cop(f.saldo)}</td>
                        <td className="px-2 py-1 text-right">
                          <Input
                            inputMode="numeric" className="ml-auto h-7 w-32 text-right text-xs tabular-nums"
                            value={Number(reparto[f.id]?.aplicado || 0).toLocaleString("es-CO")}
                            onChange={(e) => setReparto((p) => ({ ...p, [f.id]: { ...p[f.id], aplicado: e.target.value.replace(/\D/g, "") } }))}
                          />
                        </td>
                        {permisos.descuentos && (
                          <td className="px-2 py-1 text-right">
                            <Input
                              inputMode="numeric" className="ml-auto h-7 w-28 text-right text-xs tabular-nums"
                              value={Number(reparto[f.id]?.descuento || 0).toLocaleString("es-CO")}
                              onChange={(e) => setReparto((p) => ({ ...p, [f.id]: { ...p[f.id], descuento: e.target.value.replace(/\D/g, "") } }))}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs">
                Aplicado {cop(totalManual)} de {cop(r.valor)}
                {r.valor - totalManual > 0 && <span className="text-emerald-700"> · {cop(r.valor - totalManual)} quedan a favor</span>}
              </p>
              {erroresManual.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-red-700">{erroresManual.map((e, i) => <li key={i}>{e}</li>)}</ul>
              )}
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditando(false)}>
                Volver al reparto propuesto
              </Button>
            </div>
          )}

          {decide && decision === null && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nota de la aprobación (opcional)</Label>
              <Input className="h-8 text-xs" value={nota} onChange={(e) => setNota(e.target.value)} />
            </div>
          )}

          {/* ------------------------------------------------ Rechazo / anulación */}
          {decision && (
            <div className={cn("space-y-2 rounded-md border p-3", decision === "rechazar" ? "border-red-200 bg-red-50/50" : "bg-muted/30")}>
              <p className="text-sm font-semibold">{decision === "rechazar" ? "Rechazar recaudo" : "Anular recaudo"}</p>
              {decision === "rechazar" && maestros?.motivos.length ? (
                <Select value={motivoId} onValueChange={setMotivoId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Motivo" /></SelectTrigger>
                  <SelectContent>
                    {maestros.motivos.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : null}
              {decision === "anular" && r.estado === "aprobado" && (
                <p className="text-xs text-amber-800">
                  Ya está aprobado: al anularlo se devuelven los saldos de las facturas y se retira el saldo a favor.
                </p>
              )}
              <Textarea
                rows={2} className="text-xs" value={nota} onChange={(e) => setNota(e.target.value)}
                placeholder={decision === "rechazar" ? "Qué debe corregir el vendedor" : "Motivo de la anulación"}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setDecision(null)} disabled={trabajando}>Cancelar</Button>
                <Button
                  size="sm" variant="destructive" className="h-8" disabled={trabajando || (decision === "rechazar" ? !puedeRechazar : !nota.trim())}
                  onClick={decision === "rechazar" ? rechazar : anular}
                >
                  {trabajando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {decision === "rechazar" ? "Rechazar" : "Anular"}
                </Button>
              </div>
            </div>
          )}

          <HistorialRecaudo key={`${r.estado}-${r.version}`} recaudoId={r.id} empresaId={empresaId} />
          <FuenteDato>
            Los saldos de las facturas solo cambian al aprobar. El comprobante se abre con un enlace temporal.
          </FuenteDato>
        </>
      )}
    </DetalleDialog>
  )
}

export default RecaudoDetalleDialog
