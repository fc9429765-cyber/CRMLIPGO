"use client"

// Cuenta 360 del cliente (CTA-01..04): cupo, saldo, vencido y mora en un solo
// diálogo, con las facturas y los pagos que explican cada cifra.
//
// Las cifras NO se calculan aquí: vienen de getCuenta360, que usa la misma
// función que el formulario del pedido y la vista de aging. Recalcularlas en el
// cliente abriría la puerta a que dos pantallas digan cosas distintas del mismo
// cliente. Lo único que se calcula aquí son los días de cada fila, con la misma
// regla (lib/crm-fechas), solo para pintarlos.

import { useEffect, useState } from "react"
import { Loader2, Wallet, ShieldAlert, FileText, Banknote, Receipt, FolderOpen } from "lucide-react"
import { getCuenta360, type Cuenta360 } from "@/lib/crm-cuenta-actions"
import { getTableroCliente, type TableroCliente } from "@/lib/crm-tablero-cartera-actions"
import { buscarRecaudos } from "@/lib/crm-recaudos-actions"
import type { RecaudoConDetalle } from "@/lib/crm-recaudos"
import { GraficaArea, GraficaBarras } from "@/components/crm/ui/graficas"
import { EstadoCuentaAcciones } from "@/components/crm/cartera/estado-cuenta-acciones"
import { BotonPdfRecaudo, EstadoRecaudoBadge } from "@/components/crm/recaudos/comun"
import { RecaudoDetalleDialog } from "@/components/crm/recaudos/recaudo-detalle-dialog"
import { DocumentosCliente } from "@/components/crm/clientes/documentos-cliente"
import { AccesosRapidos, accesosCliente } from "@/components/crm/ui/accesos-rapidos"
import { diasEntre, hoyISO } from "@/lib/crm-fechas"
import { DetalleDialog, FuenteDato } from "@/components/crm/ui/detalle-dialog"
import {
  BadgeEstado, CabeceraTabla, FilaVacia, MarcoTabla, Td, Th, type TonoEstado,
} from "@/components/crm/ui/modulo"
import { MiniKpi, MiniKpiGrid, BarraMeta } from "@/components/crm/ui/mini-kpi"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { FichaCliente } from "@/components/crm/clientes/ficha-cliente"
import { AnalisisIACliente } from "@/components/crm/clientes/analisis-ia-cliente"

const pesos = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

const ESTADO_FACTURA: Record<string, { etiqueta: string; tono: TonoEstado }> = {
  pendiente: { etiqueta: "Pendiente", tono: "advertencia" },
  parcial: { etiqueta: "Parcial", tono: "proceso" },
  pagada: { etiqueta: "Pagada", tono: "exito" },
  anulada: { etiqueta: "Anulada", tono: "neutral" },
}

/** Estados que siguen debiendo: solo esos pueden estar vencidos. */
const ABIERTOS = new Set(["pendiente", "parcial"])

type Vista = "facturas" | "pagos" | "recibos" | "documentos"

export function Cuenta360Dialog({
  clienteId,
  empresaId,
  abierto,
  onCerrar,
}: {
  clienteId: number
  empresaId: number
  abierto: boolean
  onCerrar: () => void
}) {
  const [datos, setDatos] = useState<Cuenta360 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [vista, setVista] = useState<Vista>("facturas")

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    setCargando(true)
    setError(null)
    setDatos(null)
    getCuenta360(clienteId, empresaId).then((res) => {
      // Si el usuario cerró o cambió de cliente mientras cargaba, esta
      // respuesta ya no le corresponde a lo que está en pantalla.
      if (!vigente) return
      if (res.success && res.data) setDatos(res.data)
      else setError(res.error ?? "No se pudo cargar la cuenta")
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [abierto, clienteId, empresaId])

  const cli = datos?.cliente
  const subtitulo = cli
    ? [
        cli.documento ? `NIT ${cli.documento}` : "Sin NIT",
        cli.vendedor_nombre ?? "Sin vendedor",
        cli.dias_credito > 0 ? `${cli.dias_credito} días de plazo` : "Solo contado",
      ].join(" · ")
    : undefined

  return (
    <DetalleDialog
      abierto={abierto}
      onCerrar={onCerrar}
      icono={Wallet}
      titulo={cli?.nombre ?? "Cuenta del cliente"}
      subtitulo={subtitulo}
      ancho="tabla"
    >
      {cargando ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Cargando…</span>
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-800">
          <p className="font-semibold">No se pudo cargar la cuenta</p>
          <p className="mt-0.5 break-words">{error}</p>
        </div>
      ) : datos ? (
        <Contenido datos={datos} vista={vista} onVista={setVista} empresaId={empresaId} />
      ) : null}
    </DetalleDialog>
  )
}

function Contenido({
  datos, vista, onVista, empresaId,
}: {
  datos: Cuenta360
  vista: Vista
  onVista: (v: Vista) => void
  empresaId: number
}) {
  const { cliente, cuenta, porOwner, facturas, pagos } = datos
  const hoy = hoyISO()
  const sobrecupo = cuenta.disponible < 0

  // DSH-01: antigüedad y recaudo histórico. Se piden aparte para no demorar
  // la cuenta, que es lo que el usuario abrió a mirar.
  const [tablero, setTablero] = useState<TableroCliente | null>(null)
  const [recibos, setRecibos] = useState<RecaudoConDetalle[] | null>(null)
  const [recibo, setRecibo] = useState<number | null>(null)
  useEffect(() => {
    let vivo = true
    getTableroCliente(cliente.id, empresaId).then((r) => vivo && r.success && r.data && setTablero(r.data))
    buscarRecaudos(empresaId, { clienteId: cliente.id, estado: ["aprobado", "anulado"] }, 1, 100)
      .then((r) => vivo && setRecibos(r.success && r.data ? r.data.filas : []))
    return () => { vivo = false }
  }, [cliente.id, empresaId])
  const ownersConSaldo = porOwner
    .filter((o) => o.ownerId != null && o.cuenta.saldo > 0)
    .map((o) => ({ id: o.ownerId as number, nombre: o.ownerNombre }))

  return (
    <>
      {/* Lo siguiente que uno hace al mirar la cuenta de un cliente: venderle,
          cobrarle, ver sus pedidos. Lleva al módulo con el cliente ya elegido. */}
      <AccesosRapidos accesos={accesosCliente(cliente.id, { sinCuenta: true })} />

      {/* La ficha: identidad, cupo, cifras, desglose por owner y señales. */}
      <FichaCliente cuenta={datos} diasAviso={5} />

      <AnalisisIACliente clienteId={cliente.id} empresaId={empresaId} />

      <SubNav<Vista>
        vistas={[
          { valor: "facturas", etiqueta: "Facturas", icono: FileText, contador: facturas.length },
          { valor: "pagos", etiqueta: "Pagos", icono: Banknote, contador: pagos.length },
          { valor: "recibos", etiqueta: "Recibos de caja", icono: Receipt, contador: recibos?.length },
          { valor: "documentos", etiqueta: "Documentos", icono: FolderOpen },
        ]}
        activa={vista}
        onCambiar={onVista}
      />

      {vista === "documentos" ? (
        <DocumentosCliente clienteId={cliente.id} empresaId={empresaId} />
      ) : vista === "recibos" ? (
        <MarcoTabla alto="max-h-[360px]">
          <Table className="text-xs">
            <TableHeader>
              <CabeceraTabla>
                <Th>Recibo</Th>
                <Th>Fecha pago</Th>
                <Th>Medio</Th>
                <Th align="right">Valor</Th>
                <Th align="right">Aplicado</Th>
                <Th>Estado</Th>
                <Th> </Th>
              </CabeceraTabla>
            </TableHeader>
            <TableBody>
              {recibos === null ? (
                <FilaVacia columnas={7} mensaje="Cargando…" />
              ) : recibos.length === 0 ? (
                <FilaVacia columnas={7} mensaje="El cliente no tiene recibos de caja." />
              ) : (
                recibos.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setRecibo(r.id)}>
                    <Td><span className="font-medium">{r.numero}</span></Td>
                    <Td className="whitespace-nowrap">{r.fecha_documento}</Td>
                    <Td>{r.medio_pago_nombre ?? "—"}</Td>
                    <Td num>{pesos(Number(r.valor))}</Td>
                    <Td num>{pesos(Number(r.total_aplicado))}</Td>
                    <Td><EstadoRecaudoBadge estado={r.estado} /></Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <BotonPdfRecaudo recaudoId={r.id} empresaId={empresaId} estado={r.estado} />
                    </Td>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </MarcoTabla>
      ) : vista === "facturas" ? (
        <MarcoTabla alto="max-h-[360px]">
          <Table className="text-xs">
            <TableHeader>
              <CabeceraTabla>
                <Th>Número</Th>
                <Th>Tipo</Th>
                <Th>Fecha</Th>
                <Th>Vence</Th>
                <Th align="right">Días</Th>
                <Th align="right">Valor</Th>
                <Th align="right">Abonado</Th>
                <Th align="right">Saldo</Th>
                <Th>Estado</Th>
              </CabeceraTabla>
            </TableHeader>
            <TableBody>
              {facturas.length === 0 ? (
                <FilaVacia columnas={9} mensaje="El cliente no tiene facturas en cartera." />
              ) : (
                facturas.map((f) => {
                  // Misma regla del aging: vencida desde el día siguiente al
                  // vencimiento, y solo si sigue debiendo.
                  const dias = diasEntre(f.fecha_vencimiento, hoy)
                  const vencida = ABIERTOS.has(f.estado) && f.saldo > 0 && dias > 0
                  const est = ESTADO_FACTURA[f.estado] ?? { etiqueta: f.estado, tono: "neutral" as TonoEstado }
                  return (
                    <TableRow key={f.id} className={cn("hover:bg-muted/30", vencida && "bg-destructive/5")}>
                      <Td>
                        {f.numero_factura ? (
                          <span className="font-medium">{f.numero_factura}</span>
                        ) : (
                          <span className="text-muted-foreground">Sin número</span>
                        )}
                        {f.pedido_numero && (
                          <p className="text-[10px] text-muted-foreground">Pedido {f.pedido_numero}</p>
                        )}
                      </Td>
                      <Td>
                        {f.tipo_documento === "saldo_inicial" ? (
                          <BadgeEstado tono="info">Saldo inicial</BadgeEstado>
                        ) : (
                          <BadgeEstado tono="neutral">Factura</BadgeEstado>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">{f.fecha_factura}</Td>
                      <Td className="whitespace-nowrap">{f.fecha_vencimiento}</Td>
                      <Td num className={cn(vencida && "font-semibold text-red-700")}>
                        {ABIERTOS.has(f.estado) ? (dias > 0 ? dias : "—") : "—"}
                      </Td>
                      <Td num>{pesos(f.valor_original)}</Td>
                      <Td num>{pesos(f.valor_abonado)}</Td>
                      <Td num fuerte>{pesos(f.saldo)}</Td>
                      <Td><BadgeEstado tono={est.tono}>{est.etiqueta}</BadgeEstado></Td>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </MarcoTabla>
      ) : (
        <MarcoTabla alto="max-h-[360px]">
          <Table className="text-xs">
            <TableHeader>
              <CabeceraTabla>
                <Th>Fecha</Th>
                <Th>Factura</Th>
                <Th align="right">Valor</Th>
                <Th>Medio</Th>
                <Th>Referencia</Th>
              </CabeceraTabla>
            </TableHeader>
            <TableBody>
              {pagos.length === 0 ? (
                <FilaVacia columnas={5} mensaje="No hay pagos registrados." />
              ) : (
                pagos.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/30">
                    <Td className="whitespace-nowrap">{p.fecha_pago}</Td>
                    <Td>{p.numero_factura ?? <span className="text-muted-foreground">Sin número</span>}</Td>
                    <Td num fuerte>{pesos(p.valor)}</Td>
                    <Td>{p.medio_pago ?? "—"}</Td>
                    <Td className="max-w-[180px] truncate">{p.referencia ?? "—"}</Td>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </MarcoTabla>
      )}

      {recibo !== null && (
        <RecaudoDetalleDialog
          key={recibo}
          recaudoId={recibo}
          empresaId={empresaId}
          // Desde la cuenta solo se consulta y se reimprime (EDC-03).
          permisos={{ registrar: false, aprobar: false, descuentos: false, soloPropios: true }}
          maestros={null}
          onCerrar={() => setRecibo(null)}
          onCambio={() => {}}
        />
      )}

      <FuenteDato>
        Calculado con la misma regla del aging: una factura está vencida desde el día siguiente a su
        vencimiento. Consultado a las{" "}
        {new Date(datos.calculadoEl).toLocaleTimeString("es-CO", {
          timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit",
        })}
        {pagos.length >= 100 && " · Se muestran los últimos 100 pagos."}
      </FuenteDato>
    </>
  )
}

export default Cuenta360Dialog
