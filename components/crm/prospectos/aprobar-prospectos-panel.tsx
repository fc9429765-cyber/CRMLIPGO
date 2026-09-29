"use client"

// Bandeja de Cartera: prospectos que esperan volverse clientes (PRO-02).
//
// Lo que hace mirar con lupa va en la fila: el NIT que ya existe en LIPgo
// (crear un cliente repetido es el error clásico) y cuántos documentos trae.

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle, Clock, FileText, Inbox, Loader2, RefreshCw, UserCheck, XCircle } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { buscarProspectosAprobacion, type FilaAprobacionProspecto } from "@/lib/crm-prospectos-aprobacion-actions"
import type { EstadoAprobacionProspecto } from "@/lib/crm-prospectos-aprobacion"
import { ExpedienteDialog } from "@/components/crm/prospectos/expediente-dialog"
import { KpiCompacto, KpiEsqueleto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { CabeceraTabla, FilaCargando, FilaVacia, MarcoTabla, SinDatos, Td, Th, filaTabla } from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type Vista = Exclude<EstadoAprobacionProspecto, "borrador">
const pesos = (n: number | null | undefined) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO")
const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"

export function AprobarProspectosPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1
  const [vista, setVista] = useState<Vista>("pendiente_aprobacion")
  const [filas, setFilas] = useState<FilaAprobacionProspecto[]>([])
  const [cargando, setCargando] = useState(true)
  const [sinPermiso, setSinPermiso] = useState(false)
  const [abierto, setAbierto] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await buscarProspectosAprobacion(vista, empresaId)
    if (r.success) setFilas(r.data ?? [])
    else if (/permiso/i.test(r.error ?? "")) setSinPermiso(true)
    else toast({ title: "No se pudo cargar la bandeja", description: r.error, variant: "destructive" })
    setCargando(false)
  }, [vista, empresaId])

  useEffect(() => { cargar() }, [cargar])

  if (sinPermiso) {
    return (
      <Card><CardContent>
        <SinDatos icono={UserCheck} mensaje="No tienes permiso para aprobar prospectos" ayuda="Se otorga desde Configuración → Gestión de Usuarios." />
      </CardContent></Card>
    )
  }

  const pendiente = vista === "pendiente_aprobacion"
  const conNit = filas.filter((f) => f.nitRepetido).length
  const cupo = filas.reduce((s, f) => s + (Number(f.cupo_solicitado) || 0), 0)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]"><UserCheck className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Aprobar prospectos</h1>
            <p className="text-sm text-muted-foreground">Al aprobar, el cliente y su sucursal se crean en LIPgo</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={cargar} disabled={cargando}>
          {cargando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Actualizar
        </Button>
      </header>

      <SubNav<Vista>
        vistas={[
          { valor: "pendiente_aprobacion", etiqueta: "Por aprobar", icono: Clock, contador: pendiente ? filas.length : undefined },
          { valor: "aprobado", etiqueta: "Aprobados", icono: CheckCircle },
          { valor: "rechazado", etiqueta: "Rechazados", icono: XCircle },
        ]}
        activa={vista}
        onCambiar={(v) => { setVista(v); setFilas([]) }}
      />

      {pendiente && (
        <TiraKpi>
          {cargando && !filas.length ? (<><KpiEsqueleto /><KpiEsqueleto /><KpiEsqueleto /></>) : (
            <>
              <KpiCompacto etiqueta="Esperando" valor={filas.length} icono={Clock} tono={filas.length ? "warning" : "neutral"} />
              <KpiCompacto etiqueta="Cupo solicitado" valor={pesos(cupo)} icono={FileText} />
              <KpiCompacto etiqueta="NIT ya en LIPgo" valor={conNit} icono={AlertTriangle} tono={conNit ? "danger" : "neutral"}
                detalle={conNit ? "Revisar si se vinculan" : "Ninguno repetido"} />
            </>
          )}
        </TiraKpi>
      )}

      <div className="hidden md:block">
        <MarcoTabla>
          <Table>
            <TableHeader>
              <CabeceraTabla>
                <Th>Prospecto</Th>
                <Th>NIT / ciudad</Th>
                <Th>Vendedor</Th>
                <Th>{pendiente ? "Enviado" : vista === "aprobado" ? "Aprobado" : "Rechazado"}</Th>
                <Th align="right">Docs</Th>
                <Th align="right">Cupo solicitado</Th>
              </CabeceraTabla>
            </TableHeader>
            <TableBody>
              {cargando && !filas.length ? <FilaCargando columnas={6} /> : filas.length === 0 ? (
                <FilaVacia columnas={6} mensaje={pendiente ? "No hay prospectos esperando aprobación." : "No hay prospectos en este estado."} />
              ) : filas.map((f) => (
                <TableRow key={f.id} className={cn(filaTabla, "cursor-pointer", f.nitRepetido && pendiente && "bg-amber-50/50")} onClick={() => setAbierto(f.id)}>
                  <Td className="max-w-[260px] align-top">
                    <p className="truncate font-medium">{f.razon_social}</p>
                    <p className="text-muted-foreground">{f.codigo}{f.version > 1 ? ` · reenvío v${f.version}` : ""}</p>
                    {vista === "rechazado" && f.motivo_rechazo && <p className="truncate text-[11px] text-red-700">{f.motivo_rechazo}</p>}
                    {vista === "aprobado" && f.cliente_id && <p className="text-[11px] text-emerald-700">Cliente #{f.cliente_id}</p>}
                  </Td>
                  <Td className="align-top">
                    <p className="tabular-nums">{f.documento ?? "—"}</p>
                    {f.nitRepetido && <p className="flex items-center gap-1 text-[11px] font-medium text-amber-800"><AlertTriangle className="h-3 w-3" /> Ya existe en LIPgo</p>}
                    <p className="text-muted-foreground">{f.ciudad ?? "—"}</p>
                  </Td>
                  <Td className="align-top">{f.vendedor_nombre ?? f.solicitado_nombre ?? "—"}</Td>
                  <Td className="align-top tabular-nums">{fechaHora(pendiente ? f.solicitado_en : vista === "aprobado" ? f.aprobado_en : f.rechazado_en)}</Td>
                  <Td num className="align-top">{f.documentos}</Td>
                  <Td num fuerte className="align-top">
                    {pesos(f.cupo_solicitado)}
                    <span className="block text-[10px] font-normal text-muted-foreground">{f.dias_credito_solicitado ?? 0} días</span>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </MarcoTabla>
      </div>

      <div className="space-y-2 md:hidden">
        {cargando && !filas.length ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filas.length === 0 ? (
          <Card><CardContent><SinDatos icono={Inbox} mensaje="No hay prospectos en este estado." /></CardContent></Card>
        ) : filas.map((f) => (
          <button key={f.id} type="button" onClick={() => setAbierto(f.id)}
            className={cn("w-full rounded-lg border bg-card p-3 text-left text-xs hover:bg-muted/30", f.nitRepetido && "border-amber-300")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{f.razon_social}</p>
                <p className="text-muted-foreground">{f.documento ?? "Sin NIT"} · {f.ciudad ?? "—"}</p>
              </div>
              <p className="shrink-0 font-semibold tabular-nums">{pesos(f.cupo_solicitado)}</p>
            </div>
            {f.nitRepetido && <p className="mt-1 font-medium text-amber-800">El NIT ya existe en LIPgo</p>}
            <p className="mt-1 text-muted-foreground">{f.vendedor_nombre ?? "—"} · {f.documentos} documentos</p>
          </button>
        ))}
      </div>

      {abierto !== null && (
        <ExpedienteDialog key={abierto} prospectoId={abierto} empresaId={empresaId} modo="cartera"
          onCerrar={() => setAbierto(null)} onCambio={cargar} />
      )}
    </div>
  )
}

export default AprobarProspectosPanel
