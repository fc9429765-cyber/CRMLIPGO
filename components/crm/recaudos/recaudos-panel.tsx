"use client"

// Recaudos del vendedor (REC-01, REC-03, REC-24).
//
// Dos vistas: registrar un pago y seguir los que ya reportó. Un recaudo
// rechazado aparece arriba y con contador: es lo único que le pide acción al
// vendedor, y enterrado entre los aprobados se queda sin corregir.

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle, Clock, DollarSign, Inbox, ListChecks, Loader2, Plus, Receipt, RefreshCw, XCircle } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { buscarRecaudos, getPermisosRecaudo, type PermisosRecaudo } from "@/lib/crm-recaudos-actions"
import { getClientesCrm } from "@/lib/crm-catalogos-actions"
import type { ClienteCrm } from "@/lib/crm-catalogos"
import type { EstadoRecaudo, RecaudoConDetalle } from "@/lib/crm-recaudos"
import {
  AlertasRecaudo, BotonPdfRecaudo, EstadoRecaudoBadge, cop, fechaHora, useMaestrosRecaudo,
} from "@/components/crm/recaudos/comun"
import { RecaudoForm } from "@/components/crm/recaudos/recaudo-form"
import { RecaudoDetalleDialog } from "@/components/crm/recaudos/recaudo-detalle-dialog"
import { DetalleDialog } from "@/components/crm/ui/detalle-dialog"
import { KpiCompacto, KpiEsqueleto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { CabeceraTabla, FilaCargando, FilaVacia, MarcoTabla, SinDatos, Td, Th, filaTabla } from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type Vista = "registrar" | "mios"
type FiltroEstado = "todos" | EstadoRecaudo

const FILTROS: { valor: FiltroEstado; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "rechazado", etiqueta: "Rechazados" },
  { valor: "pendiente_aprobacion", etiqueta: "Pendientes" },
  { valor: "aprobado", etiqueta: "Aprobados" },
  { valor: "anulado", etiqueta: "Anulados" },
]

export function RecaudosPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1
  const maestros = useMaestrosRecaudo(empresaId)

  const [permisos, setPermisos] = useState<PermisosRecaudo | null>(null)
  const [clientes, setClientes] = useState<ClienteCrm[]>([])
  const [vista, setVista] = useState<Vista>("registrar")
  const [recaudos, setRecaudos] = useState<RecaudoConDetalle[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<FiltroEstado>("todos")
  const [abierto, setAbierto] = useState<number | null>(null)
  const [corrigiendo, setCorrigiendo] = useState<RecaudoConDetalle | null>(null)
  const [hecho, setHecho] = useState<{ id: number | null; numero: string | null; alertas: string[] } | null>(null)
  const [formKey, setFormKey] = useState(0)

  useEffect(() => {
    getPermisosRecaudo().then((r) => r.success && r.data && setPermisos(r.data))
    getClientesCrm(empresaId).then((r) => r.success && setClientes(r.data ?? []))
  }, [empresaId])

  const cargar = useCallback(async () => {
    setCargando(true)
    // Los últimos 200: el vendedor mira lo reciente. Para buscar lo viejo está Cartera.
    const r = await buscarRecaudos(empresaId, {}, 1, 200)
    if (r.success && r.data) setRecaudos(r.data.filas)
    else toast({ title: "No se pudieron cargar los recaudos", description: r.error, variant: "destructive" })
    setCargando(false)
  }, [empresaId])

  useEffect(() => { cargar() }, [cargar])

  const cuenta = useMemo(() => {
    const c = { rechazado: 0, pendiente_aprobacion: 0, aprobado: 0, anulado: 0, valorPendiente: 0 }
    for (const r of recaudos) {
      c[r.estado]++
      if (r.estado === "pendiente_aprobacion") c.valorPendiente += Number(r.valor) || 0
    }
    return c
  }, [recaudos])

  const visibles = useMemo(() => {
    const lista = filtro === "todos" ? recaudos : recaudos.filter((r) => r.estado === filtro)
    // Rechazados primero: son los que esperan algo del vendedor.
    return [...lista].sort((a, b) => Number(b.estado === "rechazado") - Number(a.estado === "rechazado"))
  }, [recaudos, filtro])

  if (permisos && !permisos.registrar) {
    return (
      <Card><CardContent>
        <SinDatos icono={Receipt} mensaje="No tienes permiso para registrar recaudos" ayuda="Se otorga desde Configuración → Gestión de Usuarios." />
      </CardContent></Card>
    )
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <Receipt className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Recaudos</h1>
            <p className="text-sm text-muted-foreground">Reporta el pago con su comprobante; Cartera lo aprueba y aplica</p>
          </div>
        </div>
        {vista === "mios" && (
          <Button variant="outline" size="sm" className="h-8" onClick={cargar} disabled={cargando}>
            {cargando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Actualizar
          </Button>
        )}
      </header>

      <SubNav<Vista>
        vistas={[
          { valor: "registrar", etiqueta: "Registrar pago", icono: Plus },
          { valor: "mios", etiqueta: "Mis recaudos", icono: ListChecks, contador: cuenta.rechazado || undefined },
        ]}
        activa={vista}
        onCambiar={setVista}
      />

      {vista === "registrar" ? (
        <Card className="mx-auto max-w-2xl">
          <CardContent className="pt-5">
            {hecho ? (
              <div className="space-y-4 py-4 text-center">
                <CheckCircle className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
                <div>
                  <p className="text-base font-semibold">Recaudo {hecho.numero} enviado a Cartera</p>
                  <p className="text-sm text-muted-foreground">Los saldos se actualizan cuando Cartera lo apruebe.</p>
                </div>
                <AlertasRecaudo alertas={hecho.alertas} className="text-left" />
                <div className="flex flex-wrap justify-center gap-2">
                  {hecho.id && <BotonPdfRecaudo recaudoId={hecho.id} empresaId={empresaId} estado="pendiente_aprobacion" variante="default" />}
                  <Button variant="outline" size="sm" className="h-8" onClick={() => { setHecho(null); setFormKey((k) => k + 1) }}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Registrar otro
                  </Button>
                </div>
              </div>
            ) : !maestros ? (
              <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <RecaudoForm
                key={formKey}
                empresaId={empresaId}
                maestros={maestros}
                clientes={clientes}
                onHecho={(x) => { setHecho(x); cargar() }}
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <TiraKpi>
            {cargando && !recaudos.length ? (
              <><KpiEsqueleto /><KpiEsqueleto /><KpiEsqueleto /></>
            ) : (
              <>
                <KpiCompacto
                  etiqueta="Rechazados" valor={cuenta.rechazado} icono={XCircle}
                  detalle={cuenta.rechazado ? "Corrígelos y reenvíalos" : "Nada por corregir"}
                  tono={cuenta.rechazado ? "danger" : "neutral"} onClick={() => setFiltro("rechazado")}
                />
                <KpiCompacto
                  etiqueta="En revisión" valor={cuenta.pendiente_aprobacion} icono={Clock}
                  detalle={cop(cuenta.valorPendiente)} tono={cuenta.pendiente_aprobacion ? "warning" : "neutral"}
                  onClick={() => setFiltro("pendiente_aprobacion")}
                />
                <KpiCompacto etiqueta="Aprobados" valor={cuenta.aprobado} icono={DollarSign} tono="success" onClick={() => setFiltro("aprobado")} />
              </>
            )}
          </TiraKpi>

          <div className="flex flex-wrap gap-1.5">
            {FILTROS.map((f) => (
              <Button
                key={f.valor} size="sm" variant={filtro === f.valor ? "default" : "outline"} className="h-7 text-xs"
                onClick={() => setFiltro(f.valor)}
              >
                {f.etiqueta}
              </Button>
            ))}
          </div>

          <div className="hidden md:block">
            <MarcoTabla>
              <Table>
                <TableHeader>
                  <CabeceraTabla>
                    <Th>Recaudo</Th>
                    <Th>Cliente</Th>
                    <Th>Fecha pago</Th>
                    <Th>Medio / banco</Th>
                    <Th>Estado</Th>
                    <Th align="right">Valor</Th>
                  </CabeceraTabla>
                </TableHeader>
                <TableBody>
                  {cargando && !recaudos.length ? (
                    <FilaCargando columnas={6} />
                  ) : visibles.length === 0 ? (
                    <FilaVacia columnas={6} mensaje="No hay recaudos con este filtro." />
                  ) : visibles.map((r) => (
                    <TableRow key={r.id} className={cn(filaTabla, "cursor-pointer", r.estado === "rechazado" && "bg-red-50/40")} onClick={() => setAbierto(r.id)}>
                      <Td>
                        <p className="font-semibold">{r.numero ?? `#${r.id}`}</p>
                        <p className="text-muted-foreground">{fechaHora(r.registrado_en)}</p>
                      </Td>
                      <Td className="max-w-[240px]"><p className="truncate">{r.cliente_nombre ?? "—"}</p></Td>
                      <Td className="tabular-nums">{r.fecha_documento}</Td>
                      <Td>{r.medio_pago_nombre ?? "—"}{r.banco_nombre ? ` · ${r.banco_nombre}` : ""}</Td>
                      <Td>
                        <EstadoRecaudoBadge estado={r.estado} />
                        {r.estado === "rechazado" && r.motivo_rechazo && (
                          <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-red-700">{r.motivo_rechazo}</p>
                        )}
                      </Td>
                      <Td num fuerte>{cop(r.valor)}</Td>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </MarcoTabla>
          </div>

          <div className="space-y-2 md:hidden">
            {cargando && !recaudos.length ? (
              <div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : visibles.length === 0 ? (
              <Card><CardContent><SinDatos icono={Inbox} mensaje="No hay recaudos con este filtro." /></CardContent></Card>
            ) : visibles.map((r) => (
              <button
                key={r.id} type="button" onClick={() => setAbierto(r.id)}
                className={cn("w-full rounded-lg border bg-card p-3 text-left text-xs transition-colors hover:bg-muted/30", r.estado === "rechazado" && "border-red-300")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{r.numero ?? `#${r.id}`}</p>
                    <p className="truncate">{r.cliente_nombre ?? "—"}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">{cop(r.valor)}</p>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <EstadoRecaudoBadge estado={r.estado} />
                  <span className="text-muted-foreground">Pago del {r.fecha_documento}</span>
                </div>
                {r.estado === "rechazado" && r.motivo_rechazo && <p className="mt-1 text-red-700">{r.motivo_rechazo}</p>}
              </button>
            ))}
          </div>
        </>
      )}

      {abierto !== null && permisos && (
        <RecaudoDetalleDialog
          key={abierto}
          recaudoId={abierto}
          empresaId={empresaId}
          permisos={permisos}
          maestros={maestros}
          onCerrar={() => setAbierto(null)}
          onCambio={cargar}
          onCorregir={(r) => { setAbierto(null); setCorrigiendo(r) }}
        />
      )}

      {corrigiendo && maestros && (
        <DetalleDialog
          abierto
          onCerrar={() => setCorrigiendo(null)}
          icono={Receipt}
          titulo={`Corregir ${corrigiendo.numero ?? ""}`}
          subtitulo={corrigiendo.motivo_rechazo ? `Motivo: ${corrigiendo.motivo_rechazo}` : undefined}
        >
          <RecaudoForm
            empresaId={empresaId}
            maestros={maestros}
            clientes={clientes}
            corrigiendo={corrigiendo}
            onCancelar={() => setCorrigiendo(null)}
            onHecho={(x) => {
              setCorrigiendo(null)
              toast({ title: `Recaudo ${x.numero ?? ""} reenviado a Cartera`, description: x.alertas.length ? "Con alertas para revisar" : undefined })
              cargar()
            }}
          />
        </DetalleDialog>
      )}
    </div>
  )
}

export default RecaudosPanel
