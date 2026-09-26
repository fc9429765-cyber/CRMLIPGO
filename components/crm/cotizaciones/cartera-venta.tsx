"use client"

// Cartera del cliente dentro del formulario de venta (PED-03, PED-04).
//
// Va ARRIBA, antes que los productos: el vendedor tiene que saber si el cliente
// debe plata antes de armarle un pedido, no descubrirlo al final cuando ya
// prometió la entrega. Son cifras de getCuenta360, las mismas que ve Cartera;
// si aquí se calcularan aparte, el vendedor y Cartera discutirían con números
// distintos.

import { useState } from "react"
import { AlertTriangle, Ban, FileText, Loader2, Wallet } from "lucide-react"
import type { Cuenta360 } from "@/lib/crm-cuenta-actions"
import type { ResultadoCredito } from "@/lib/crm-credito"
import { money } from "@/lib/crm-cotizaciones"
import { MiniKpi, MiniKpiGrid } from "@/components/crm/ui/mini-kpi"
import { BadgeEstado, MarcoTabla, Td, filaTabla, FilaVacia } from "@/components/crm/ui/modulo"
import { DetalleDialog, FuenteDato } from "@/components/crm/ui/detalle-dialog"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export function ResumenCarteraVenta({
  cuenta,
  cargando,
}: {
  cuenta: Cuenta360 | null
  cargando: boolean
}) {
  const [verFacturas, setVerFacturas] = useState(false)

  if (cargando) {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Consultando cartera…
      </div>
    )
  }
  if (!cuenta) return null

  const c = cuenta.cuenta
  const sobrecupo = c.disponible < 0
  const abiertas = cuenta.facturas.filter((f) => f.saldo > 0)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {cuenta.cliente.bloqueado_cartera && (
          <BadgeEstado tono="peligro" icono={Ban}>Bloqueado por cartera</BadgeEstado>
        )}
        {sobrecupo && <BadgeEstado tono="peligro">Sobrecupo</BadgeEstado>}
        {c.diasMora > 0 && (
          <BadgeEstado tono="advertencia">{c.diasMora} días de mora</BadgeEstado>
        )}
        <BadgeEstado tono="neutral">
          {cuenta.cliente.dias_credito > 0 ? `Crédito a ${cuenta.cliente.dias_credito} días` : "Sin días de crédito"}
        </BadgeEstado>
        {abiertas.length > 0 && (
          <Button
            type="button" variant="ghost" size="sm"
            className="ml-auto h-8 text-xs"
            onClick={() => setVerFacturas(true)}
          >
            <FileText className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {abiertas.length} factura{abiertas.length === 1 ? "" : "s"} abierta{abiertas.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      <MiniKpiGrid>
        <MiniKpi etiqueta="Cupo" valor={money(c.cupo)} icono={Wallet} />
        <MiniKpi etiqueta="Saldo" valor={money(c.saldo)} />
        <MiniKpi
          etiqueta={sobrecupo ? "Sobrecupo" : "Disponible"}
          valor={money(c.disponible)}
          tono={sobrecupo ? "peligro" : "exito"}
        />
        <MiniKpi
          etiqueta={c.diasMora > 0 ? `Vencido · ${c.diasMora} d mora` : "Vencido"}
          valor={money(c.vencido)}
          tono={c.vencido > 0 ? "advertencia" : "neutral"}
        />
      </MiniKpiGrid>

      <DetalleDialog
        abierto={verFacturas}
        onCerrar={() => setVerFacturas(false)}
        titulo="Facturas abiertas"
        subtitulo={cuenta.cliente.nombre}
        icono={FileText}
        ancho="tabla"
      >
        <MarcoTabla alto="max-h-[50vh]">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs font-semibold">Factura</TableHead>
                <TableHead className="text-xs font-semibold">Vence</TableHead>
                <TableHead className="text-right text-xs font-semibold">Saldo</TableHead>
                <TableHead className="text-xs font-semibold">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {abiertas.length === 0 && <FilaVacia columnas={4} mensaje="Sin facturas abiertas." />}
              {abiertas.map((f) => (
                <TableRow key={f.id} className={filaTabla}>
                  <Td fuerte>{f.numero_factura ?? f.pedido_numero ?? `#${f.id}`}</Td>
                  <Td>{f.fecha_vencimiento}</Td>
                  <Td num>{money(f.saldo)}</Td>
                  <Td>{f.estado}</Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </MarcoTabla>
        <FuenteDato>Cartera del CRM (crm_cuentas_cobrar), la misma que usa Cartera al aprobar.</FuenteDato>
      </DetalleDialog>
    </div>
  )
}

/**
 * Aviso de crédito EN VIVO (PED-04).
 *
 * Se recalcula con cada tecla usando evaluarCredito, la misma función que
 * corre el servidor al solicitar aprobación. Así lo que el vendedor ve aquí es
 * lo que Cartera verá después, no una aproximación.
 */
export function AvisoCredito({
  resultado,
  bloquea,
}: {
  resultado: ResultadoCredito | null
  /** true = el documento no se puede enviar (pedido). En cotización solo informa. */
  bloquea: boolean
}) {
  if (!resultado) return null

  if (!resultado.permitido) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">
        <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="space-y-1 text-xs">
          <p className="font-semibold">
            {bloquea ? "No se puede enviar este pedido" : "A este cliente no se le podrá generar el pedido así"}
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.motivos.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      </div>
    )
  }

  if (resultado.requiereSobrecupo) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="space-y-1 text-xs">
          <p className="font-semibold">
            Este pedido deja al cliente en sobrecupo por {money(resultado.sobrecupoValor)}.
          </p>
          <p>Se puede enviar: lo verán Cartera y Gerencia al aprobar.</p>
          {resultado.motivos.length > 1 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {resultado.motivos.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
        </div>
      </div>
    )
  }

  // Mora informada sin sobrecupo: no bloquea en modo sobrecupo, pero se dice.
  if (resultado.motivos.length) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <ul className="space-y-0.5">
          {resultado.motivos.map((m) => <li key={m}>{m}</li>)}
        </ul>
      </div>
    )
  }

  return null
}
