"use client"

// Detalle de una factura: sus abonos y de dónde salió cada uno (CAR-04, CAR-05).
//
// Cada abono muestra el saldo que dejó, calculado en orden de fecha: es la
// columna "saldo final después del pago" del requerimiento, y la que responde
// "¿por qué me dice que debo esto?". Si el abono vino de un recaudo, se abre
// desde aquí con su comprobante y su historial de aprobación.

import { useEffect, useMemo, useState } from "react"
import { ExternalLink, Loader2, Receipt } from "lucide-react"
import { getPagos } from "@/lib/crm-cartera-actions"
import { diasVencido, money, rangoVencimiento, type CuentaPorCobrar, type Pago } from "@/lib/crm-cartera"
import { hoyISO } from "@/lib/crm-fechas"
import type { PermisosRecaudo } from "@/lib/crm-recaudos-actions"
import { RecaudoDetalleDialog } from "@/components/crm/recaudos/recaudo-detalle-dialog"
import { useMaestrosRecaudo } from "@/components/crm/recaudos/comun"
import { DetalleDialog, FuenteDato } from "@/components/crm/ui/detalle-dialog"
import { Dato, ResumenDatos } from "@/components/crm/ui/modulo"
import { cn } from "@/lib/utils"
import { AccesosRapidos } from "@/components/crm/ui/accesos-rapidos"

const TIPO: Record<string, string> = {
  recaudo: "Recaudo", descuento: "Descuento", nota_credito: "Nota crédito", ajuste: "Ajuste", legacy: "Abono",
}

export function FacturaDetalleDialog({
  cuenta, empresaId, permisos, cortes, onCerrar,
}: {
  cuenta: CuentaPorCobrar
  empresaId: number
  permisos: PermisosRecaudo | null
  cortes: [number, number, number]
  onCerrar: () => void
}) {
  const [pagos, setPagos] = useState<Pago[] | null>(null)
  const [recaudo, setRecaudo] = useState<number | null>(null)
  const maestros = useMaestrosRecaudo(empresaId)

  useEffect(() => {
    getPagos(cuenta.id).then((r) => setPagos(r.success ? r.data ?? [] : []))
  }, [cuenta.id])

  // Saldo después de cada abono, del más antiguo al más reciente. Los anulados
  // se muestran tachados y no restan.
  const filas = useMemo(() => {
    if (!pagos) return []
    const orden = [...pagos].sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago) || a.id - b.id)
    let saldo = Number(cuenta.valor_original) || 0
    return orden.map((p) => {
      if (!p.anulado_en) saldo -= Number(p.valor) || 0
      return { ...p, saldoFinal: Math.max(0, saldo) }
    }).reverse()
  }, [pagos, cuenta.valor_original])

  const dias = diasVencido(cuenta.fecha_vencimiento, hoyISO())

  return (
    <>
      <DetalleDialog
        abierto
        onCerrar={onCerrar}
        icono={Receipt}
        ancho="tabla"
        titulo={`Factura ${cuenta.numero_factura ?? "sin número"}`}
        subtitulo={`${cuenta.cliente_nombre ?? "—"}${cuenta.pedido_numero ? ` · pedido ${cuenta.pedido_numero}` : ""}`}
      >
        <AccesosRapidos
          accesos={[
            { cuenta360: cuenta.cliente_id, etiqueta: "Cuenta del cliente" },
            { intencion: { accion: "registrar_pago", clienteId: cuenta.cliente_id } },
            !!cuenta.pedido_id && { intencion: { accion: "ver_pedido", pedidoId: cuenta.pedido_id }, etiqueta: "Ver el pedido" },
          ]}
        />
        <ResumenDatos className="md:grid-cols-4 lg:grid-cols-4">
          <Dato etiqueta="Contabilización" num>{cuenta.fecha_factura}</Dato>
          <Dato etiqueta="Vencimiento" num>{cuenta.fecha_vencimiento}</Dato>
          <Dato etiqueta="Días" num>{dias > 0 ? `${dias} vencida` : `${-dias} por vencer`}</Dato>
          <Dato etiqueta="Rango">{rangoVencimiento(dias, cortes)}</Dato>
          <Dato etiqueta="Valor original" num>{money(cuenta.valor_original)}</Dato>
          <Dato etiqueta="Abonado" num>{money(cuenta.valor_abonado)}</Dato>
          <Dato etiqueta="Saldo" num><span className="font-semibold">{money(cuenta.saldo)}</span></Dato>
          <Dato etiqueta="Saldo vencido" num>{dias > 0 ? money(cuenta.saldo) : money(0)}</Dato>
        </ResumenDatos>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Abonos</p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Abono</th>
                  <th className="px-2 py-1.5 text-left font-medium">Fecha doc.</th>
                  <th className="px-2 py-1.5 text-left font-medium">Referencia</th>
                  <th className="px-2 py-1.5 text-right font-medium">Valor pago</th>
                  <th className="px-2 py-1.5 text-right font-medium">Descuento</th>
                  <th className="px-2 py-1.5 text-right font-medium">Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {pagos === null ? (
                  <tr><td colSpan={6} className="px-2 py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></td></tr>
                ) : filas.length === 0 ? (
                  <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">Sin abonos.</td></tr>
                ) : filas.map((p) => {
                  const esDescuento = p.tipo === "descuento"
                  return (
                    <tr key={p.id} className={cn("border-t", p.anulado_en && "text-muted-foreground line-through")}>
                      <td className="px-2 py-1.5">
                        {p.recaudo_id ? (
                          <button type="button" className="inline-flex items-center gap-1 font-medium text-[var(--chart-1)] hover:underline" onClick={() => setRecaudo(p.recaudo_id!)}>
                            {p.observacion?.replace(/^(Descuento sobre )?[Rr]ecaudo /, "") ?? "Recaudo"} <ExternalLink className="h-3 w-3" />
                          </button>
                        ) : (
                          <span>{TIPO[p.tipo ?? "legacy"] ?? p.tipo}</span>
                        )}
                        {p.anulado_en && <span className="ml-1 text-[10px] no-underline">(anulado)</span>}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{p.fecha_pago}</td>
                      <td className="px-2 py-1.5">{p.referencia ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{esDescuento ? "—" : money(p.valor)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{esDescuento ? money(p.valor) : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{p.anulado_en ? "—" : money(p.saldoFinal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        <FuenteDato>
          El saldo lo recalcula la base con la suma de abonos no anulados. Los abonos de un recaudo se abren con su comprobante e historial.
        </FuenteDato>
      </DetalleDialog>

      {recaudo !== null && permisos && (
        <RecaudoDetalleDialog
          key={recaudo}
          recaudoId={recaudo}
          empresaId={empresaId}
          // Desde la factura solo se consulta: las decisiones van en la bandeja.
          permisos={{ ...permisos, aprobar: false }}
          maestros={maestros}
          onCerrar={() => setRecaudo(null)}
          onCambio={() => {}}
        />
      )}
    </>
  )
}

export default FacturaDetalleDialog
