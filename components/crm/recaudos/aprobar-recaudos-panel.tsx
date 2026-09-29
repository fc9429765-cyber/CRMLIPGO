"use client"

// Bandeja de Cartera: recaudos por aprobar (REC-02, REC-03, REC-18).
//
// Los que traen alertas de la lectura del comprobante (REC-22) se marcan en
// ámbar en la propia fila: son los que se miran con lupa. El resto suele ser
// aprobar con el reparto propuesto.

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle, CheckCircle, Clock, DollarSign, Inbox, Loader2, RefreshCw, Search, Stamp, XCircle, Ban,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { buscarRecaudos, getPermisosRecaudo, type PermisosRecaudo } from "@/lib/crm-recaudos-actions"
import type { EstadoRecaudo, RecaudoConDetalle } from "@/lib/crm-recaudos"
import { EstadoRecaudoBadge, EstadoSapBadge, cop, fechaHora, useMaestrosRecaudo } from "@/components/crm/recaudos/comun"
import { RecaudoDetalleDialog } from "@/components/crm/recaudos/recaudo-detalle-dialog"
import { KpiCompacto, KpiEsqueleto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { CabeceraTabla, FilaCargando, FilaVacia, MarcoTabla, SinDatos, Td, Th, filaTabla } from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const TAMANO = 100

export function AprobarRecaudosPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1
  const maestros = useMaestrosRecaudo(empresaId)

  const [permisos, setPermisos] = useState<PermisosRecaudo | null>(null)
  const [estado, setEstado] = useState<EstadoRecaudo>("pendiente_aprobacion")
  const [soloAlertas, setSoloAlertas] = useState(false)
  const [texto, setTexto] = useState("")
  const [filas, setFilas] = useState<RecaudoConDetalle[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState<number | null>(null)

  useEffect(() => {
    getPermisosRecaudo().then((r) => r.success && r.data && setPermisos(r.data))
  }, [])

  const cargar = useCallback(async (pag = 1) => {
    setCargando(true)
    const r = await buscarRecaudos(empresaId, { estado, conAlertas: soloAlertas || undefined, texto: texto || undefined }, pag, TAMANO)
    if (r.success && r.data) {
      setFilas((prev) => (pag === 1 ? r.data!.filas : [...prev, ...r.data!.filas]))
      setTotal(r.data.total)
      setPagina(pag)
    } else {
      toast({ title: "No se pudo cargar la bandeja", description: r.error, variant: "destructive" })
    }
    setCargando(false)
  }, [empresaId, estado, soloAlertas, texto])

  // El texto espera a que se deje de escribir; lo demás recarga de una vez.
  useEffect(() => {
    const t = setTimeout(() => cargar(1), texto ? 350 : 0)
    return () => clearTimeout(t)
  }, [cargar, texto])

  const kpis = useMemo(() => {
    const valor = filas.reduce((s, r) => s + (Number(r.valor) || 0), 0)
    const conAlertas = filas.filter((r) => r.ocr_alertas?.length).length
    const masViejo = filas.reduce<string | null>((m, r) => (!m || r.registrado_en < m ? r.registrado_en : m), null)
    const horas = masViejo ? Math.floor((Date.now() - Date.parse(masViejo)) / 3_600_000) : 0
    return { valor, conAlertas, horas }
  }, [filas])

  if (permisos && !permisos.aprobar) {
    return (
      <Card><CardContent>
        <SinDatos icono={Stamp} mensaje="No tienes permiso para aprobar recaudos" ayuda="Se otorga desde Configuración → Gestión de Usuarios." />
      </CardContent></Card>
    )
  }

  const esPendiente = estado === "pendiente_aprobacion"

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <CheckCircle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Aprobar recaudos</h1>
            <p className="text-sm text-muted-foreground">Al aprobar se aplican los pagos a las facturas y se mueven los saldos</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => cargar(1)} disabled={cargando}>
          {cargando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Actualizar
        </Button>
      </header>

      <SubNav<EstadoRecaudo>
        vistas={[
          { valor: "pendiente_aprobacion", etiqueta: "Por aprobar", icono: Clock, contador: esPendiente ? total : undefined },
          { valor: "aprobado", etiqueta: "Aprobados", icono: CheckCircle },
          { valor: "rechazado", etiqueta: "Rechazados", icono: XCircle },
          { valor: "anulado", etiqueta: "Anulados", icono: Ban },
        ]}
        activa={estado}
        onCambiar={(v) => { setEstado(v); setFilas([]) }}
      />

      <TiraKpi>
        {cargando && !filas.length ? (
          <><KpiEsqueleto /><KpiEsqueleto /><KpiEsqueleto /></>
        ) : (
          <>
            <KpiCompacto
              etiqueta={esPendiente ? "Esperando aprobación" : "Recaudos"} valor={total} icono={Clock}
              detalle={esPendiente && filas.length ? `El más antiguo lleva ${kpis.horas} h` : undefined}
              tono={esPendiente && total ? "warning" : "neutral"}
            />
            <KpiCompacto etiqueta="Valor" valor={cop(kpis.valor)} icono={DollarSign}
              detalle={filas.length < total ? `De los ${filas.length} cargados` : undefined} />
            <KpiCompacto
              etiqueta="Con alertas" valor={kpis.conAlertas} icono={AlertTriangle}
              detalle={kpis.conAlertas ? "Lo digitado no cuadra con el comprobante" : "Sin diferencias"}
              tono={kpis.conAlertas ? "danger" : "neutral"}
              onClick={() => setSoloAlertas((v) => !v)}
            />
          </>
        )}
      </TiraKpi>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" placeholder="Número o referencia…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <Button size="sm" variant={soloAlertas ? "default" : "outline"} className="h-8 text-xs" onClick={() => setSoloAlertas((v) => !v)}>
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> Solo con alertas
        </Button>
      </div>

      <div className="hidden md:block">
        <MarcoTabla>
          <Table>
            <TableHeader>
              <CabeceraTabla>
                <Th>Recaudo</Th>
                <Th>Cliente / owner</Th>
                <Th>Vendedor</Th>
                <Th>Pago</Th>
                <Th>Estado</Th>
                <Th align="right">Valor</Th>
              </CabeceraTabla>
            </TableHeader>
            <TableBody>
              {cargando && !filas.length ? (
                <FilaCargando columnas={6} />
              ) : filas.length === 0 ? (
                <FilaVacia columnas={6} mensaje={esPendiente ? "No hay recaudos esperando aprobación." : "No hay recaudos en este estado."} />
              ) : filas.map((r) => {
                const alerta = !!r.ocr_alertas?.length
                return (
                  <TableRow key={r.id} className={cn(filaTabla, "cursor-pointer", alerta && esPendiente && "bg-amber-50/50")} onClick={() => setAbierto(r.id)}>
                    <Td className="align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{r.numero ?? `#${r.id}`}</span>
                        {(r.version ?? 1) > 1 && <span className="text-[10px] text-violet-700">Reenvío v{r.version}</span>}
                      </div>
                      <p className="text-muted-foreground">{fechaHora(r.registrado_en)}</p>
                      {alerta && (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-800">
                          <AlertTriangle className="h-3 w-3" /> {r.ocr_alertas.length} alerta{r.ocr_alertas.length === 1 ? "" : "s"}
                        </p>
                      )}
                    </Td>
                    <Td className="max-w-[240px] align-top">
                      <p className="truncate font-medium">{r.cliente_nombre ?? "—"}</p>
                      <p className="truncate text-muted-foreground">{r.owner_nombre ?? "—"}</p>
                    </Td>
                    <Td className="align-top">{r.vendedor_nombre ?? r.registrado_nombre ?? "—"}</Td>
                    <Td className="align-top">
                      <p className="tabular-nums">{r.fecha_documento}</p>
                      <p className="text-muted-foreground">{r.medio_pago_nombre ?? "—"}{r.banco_nombre ? ` · ${r.banco_nombre}` : ""}</p>
                    </Td>
                    <Td className="align-top">
                      <div className="flex flex-wrap gap-1"><EstadoRecaudoBadge estado={r.estado} /><EstadoSapBadge estado={r.sap_estado} /></div>
                    </Td>
                    <Td num fuerte className="align-top">{cop(r.valor)}</Td>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </MarcoTabla>
      </div>

      <div className="space-y-2 md:hidden">
        {cargando && !filas.length ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filas.length === 0 ? (
          <Card><CardContent><SinDatos icono={Inbox} mensaje="No hay recaudos en este estado." /></CardContent></Card>
        ) : filas.map((r) => (
          <button
            key={r.id} type="button" onClick={() => setAbierto(r.id)}
            className={cn("w-full rounded-lg border bg-card p-3 text-left text-xs hover:bg-muted/30", r.ocr_alertas?.length && "border-amber-300")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{r.numero ?? `#${r.id}`}</p>
                <p className="truncate">{r.cliente_nombre ?? "—"}</p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{cop(r.valor)}</p>
            </div>
            <p className="mt-1 text-muted-foreground">{r.vendedor_nombre ?? r.registrado_nombre ?? "—"} · pago del {r.fecha_documento}</p>
            {!!r.ocr_alertas?.length && <p className="mt-1 font-medium text-amber-800">{r.ocr_alertas.length} alerta(s) para revisar</p>}
          </button>
        ))}
      </div>

      {filas.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" className="h-8" onClick={() => cargar(pagina + 1)} disabled={cargando}>
            Cargar más ({filas.length} de {total})
          </Button>
        </div>
      )}

      {abierto !== null && permisos && (
        <RecaudoDetalleDialog
          key={abierto}
          recaudoId={abierto}
          empresaId={empresaId}
          permisos={permisos}
          maestros={maestros}
          onCerrar={() => setAbierto(null)}
          onCambio={() => cargar(1)}
        />
      )}
    </div>
  )
}

export default AprobarRecaudosPanel
