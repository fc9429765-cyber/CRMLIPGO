"use client"

// Integraciones: la bandeja de salida hacia SAP, WhatsApp y LIPgo (INT-08).
//
// Responde las tres preguntas que llegan cuando algo no aparece en el otro
// sistema: ¿esta encendida la integracion?, ¿se intento enviar?, ¿que contesto?
// Y deja actuar: reintentar tras corregir un dato, descartar con motivo, o
// procesar la bandeja ya sin esperar al cron.

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Cable, RefreshCw, Loader2, Play, RotateCcw, Ban, CheckCircle2, AlertTriangle,
  Clock, Send, MessageCircle, Database,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import {
  getEstadoIntegraciones, listarOutbox, getIntentosOutbox, reintentarEnvio, descartarEnvio, procesarAhora,
  type EstadoIntegraciones, type IntentoLog,
} from "@/lib/crm-integraciones-actions"
import type { EstadoOutbox, RegistroOutbox } from "@/lib/integraciones/tipos"
import { TablaDatos } from "@/components/crm/ui/tabla-datos"
import { DetalleDialog, FuenteDato } from "@/components/crm/ui/detalle-dialog"
import { KpiCompacto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { BadgeEstado, Dato, ResumenDatos, type TonoEstado } from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { MapeosSap } from "@/components/crm/integraciones/mapeos-sap"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/hooks/use-toast"

const ESTADO: Record<EstadoOutbox, { etiqueta: string; tono: TonoEstado }> = {
  pendiente: { etiqueta: "Pendiente", tono: "advertencia" },
  procesando: { etiqueta: "Procesando", tono: "proceso" },
  enviado: { etiqueta: "Enviado", tono: "exito" },
  error: { etiqueta: "Error", tono: "peligro" },
  omitido: { etiqueta: "Omitido", tono: "neutral" },
  descartado: { etiqueta: "Descartado", tono: "neutral" },
}

const MODO_SAP: Record<string, { etiqueta: string; tono: TonoEstado }> = {
  disabled: { etiqueta: "Desactivado", tono: "neutral" },
  mock: { etiqueta: "Simulado", tono: "info" },
  live: { etiqueta: "Conectado", tono: "exito" },
}

type Vista = "todos" | "pendiente" | "error" | "enviado"

const fecha = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("es-CO", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota",
      }).format(new Date(iso))
    : "—"

export function IntegracionesPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [estado, setEstado] = useState<EstadoIntegraciones | null>(null)
  const [filas, setFilas] = useState<RegistroOutbox[]>([])
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [vista, setVista] = useState<Vista>("todos")
  const [detalle, setDetalle] = useState<RegistroOutbox | null>(null)
  const [seccion, setSeccion] = useState<"bandeja" | "sap">("bandeja")

  const cargar = useCallback(async () => {
    const [e, l] = await Promise.all([getEstadoIntegraciones(empresaId), listarOutbox(empresaId)])
    if (e.success) setEstado(e.data ?? null)
    if (l.success) setFilas(l.data ?? [])
    else toast({ title: "No se pudo cargar la bandeja", description: l.error, variant: "destructive" })
    setCargando(false)
  }, [empresaId])

  useEffect(() => {
    cargar()
  }, [cargar])

  const procesar = async () => {
    setProcesando(true)
    const r = await procesarAhora()
    setProcesando(false)
    if (!r.success || !r.data) {
      toast({ title: "No se pudo procesar", description: r.error, variant: "destructive" })
      return
    }
    const { tomados, enviados, errores, enEspera } = r.data
    toast({
      title: tomados ? `Se procesaron ${tomados} envío(s)` : "No había nada por procesar",
      description: tomados ? `${enviados} enviados · ${errores} con error · ${enEspera} en espera` : undefined,
    })
    cargar()
  }

  const visibles = useMemo(
    () => (vista === "todos" ? filas : filas.filter((f) => f.estado === vista)),
    [filas, vista],
  )

  const c = estado?.conteo ?? {}

  const columnas = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        id: "sistema",
        accessorFn: (f: RegistroOutbox) => f.sistema,
        header: "Sistema",
        cell: ({ row }) => <span className="font-medium uppercase">{(row.original as RegistroOutbox).sistema}</span>,
      },
      { accessorKey: "flujo", header: "Flujo" },
      {
        id: "documento",
        accessorFn: (f: RegistroOutbox) => `${f.entidad} ${f.entidad_id ?? ""}`,
        header: "Documento",
      },
      { accessorKey: "operacion", header: "Operación", cell: ({ getValue }) => <span className="truncate">{String(getValue())}</span> },
      {
        accessorKey: "estado",
        header: "Estado",
        cell: ({ getValue }) => {
          const e = ESTADO[getValue() as EstadoOutbox]
          return <BadgeEstado tono={e.tono}>{e.etiqueta}</BadgeEstado>
        },
      },
      {
        accessorKey: "intentos",
        header: "Intentos",
        cell: ({ row }) => {
          const f = row.original as RegistroOutbox
          return <div className="text-right tabular-nums">{f.intentos}/{f.max_intentos}</div>
        },
      },
      {
        accessorKey: "creado_en",
        header: "Creado",
        cell: ({ getValue }) => <span className="tabular-nums">{fecha(getValue() as string)}</span>,
      },
    ],
    [],
  )

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <Cable className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Integraciones</h1>
            <p className="text-sm text-muted-foreground">
              Lo que el CRM envía a SAP, WhatsApp y LIPgo. Nada del negocio espera a que esto salga.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={() => { setCargando(true); cargar() }}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Actualizar
          </Button>
          <Button size="sm" className="h-8" onClick={procesar} disabled={procesando}>
            {procesando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
            Procesar ahora
          </Button>
        </div>
      </header>

      <SubNav<"bandeja" | "sap">
        vistas={[
          { valor: "bandeja", etiqueta: "Bandeja de salida", icono: Send },
          { valor: "sap", etiqueta: "Mapeos y conexión SAP", icono: Database },
        ]}
        activa={seccion}
        onCambiar={setSeccion}
      />

      {seccion === "sap" ? <MapeosSap empresaId={empresaId} /> : (<>
      {/* Estado de las conexiones: es lo primero que hay que descartar cuando
          "no llego a SAP". */}
      {estado && (
        <ResumenDatos className="lg:grid-cols-4">
          <Dato etiqueta="SAP">
            <BadgeEstado tono={MODO_SAP[estado.modoSap].tono} icono={Database}>
              {MODO_SAP[estado.modoSap].etiqueta}
            </BadgeEstado>
          </Dato>
          <Dato etiqueta="Flujos SAP encendidos">
            {Object.entries(estado.flujosSap).filter(([, v]) => v).map(([k]) => k).join(", ") || "Ninguno"}
          </Dato>
          <Dato etiqueta="WhatsApp">
            <BadgeEstado tono={estado.whatsappActivo ? "exito" : "neutral"} icono={MessageCircle}>
              {estado.whatsappActivo ? "Enviando" : "Simulado"}
            </BadgeEstado>
          </Dato>
          <Dato etiqueta="LIPgo">
            <span className="text-xs">Pedidos: directo · Recaudos: en espera</span>
          </Dato>
        </ResumenDatos>
      )}

      <TiraKpi>
        <KpiCompacto etiqueta="Pendientes" valor={c.pendiente ?? 0} icono={Clock} tono={(c.pendiente ?? 0) > 0 ? "warning" : "neutral"} />
        <KpiCompacto etiqueta="Con error" valor={c.error ?? 0} icono={AlertTriangle} tono={(c.error ?? 0) > 0 ? "danger" : "neutral"} />
        <KpiCompacto etiqueta="Enviados" valor={c.enviado ?? 0} icono={CheckCircle2} tono="success" />
        <KpiCompacto etiqueta="Descartados" valor={c.descartado ?? 0} icono={Ban} tono="neutral" />
      </TiraKpi>

      <SubNav<Vista>
        vistas={[
          { valor: "todos", etiqueta: "Todos", icono: Send },
          { valor: "pendiente", etiqueta: "Pendientes", icono: Clock, contador: c.pendiente },
          { valor: "error", etiqueta: "Con error", icono: AlertTriangle, contador: c.error },
          { valor: "enviado", etiqueta: "Enviados", icono: CheckCircle2 },
        ]}
        activa={vista}
        onCambiar={setVista}
      />

      <TablaDatos
        datos={visibles}
        columnas={columnas}
        cargando={cargando}
        placeholderBusqueda="Buscar por flujo, documento u operación…"
        mensajeVacio={
          vista === "todos"
            ? "La bandeja está vacía. Aquí aparecerá cada envío a SAP, WhatsApp o LIPgo."
            : "No hay envíos en este estado."
        }
        onFila={setDetalle}
        claseFila={(f) => (f.estado === "error" ? "bg-destructive/5" : undefined)}
      />

      {detalle && (
        <DetalleEnvio
          registro={detalle}
          empresaId={empresaId}
          onCerrar={() => setDetalle(null)}
          onCambio={() => { setDetalle(null); cargar() }}
        />
      )}
      </>)}
    </div>
  )
}

/** Detalle de un envio: que se mando, que contesto el otro sistema, y acciones. */
function DetalleEnvio({
  registro: r, empresaId, onCerrar, onCambio,
}: {
  registro: RegistroOutbox
  empresaId: number
  onCerrar: () => void
  onCambio: () => void
}) {
  const [intentos, setIntentos] = useState<IntentoLog[] | null>(null)
  const [descartando, setDescartando] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [trabajando, setTrabajando] = useState(false)

  useEffect(() => {
    getIntentosOutbox(r.id, empresaId).then((res) => setIntentos(res.success ? res.data ?? [] : []))
  }, [r.id, empresaId])

  const reintentar = async () => {
    setTrabajando(true)
    const res = await reintentarEnvio(r.id, empresaId)
    setTrabajando(false)
    if (!res.success) return toast({ title: "No se pudo reintentar", description: res.error, variant: "destructive" })
    toast({ title: "Vuelve a la cola", description: "Saldrá en la próxima pasada, o pulsa «Procesar ahora»." })
    onCambio()
  }

  const descartar = async () => {
    setTrabajando(true)
    const res = await descartarEnvio(r.id, motivo, empresaId)
    setTrabajando(false)
    if (!res.success) return toast({ title: "No se pudo descartar", description: res.error, variant: "destructive" })
    toast({ title: "Envío descartado" })
    onCambio()
  }

  const e = ESTADO[r.estado]
  const puedeReintentar = ["error", "omitido", "descartado"].includes(r.estado)
  const puedeDescartar = ["pendiente", "error", "omitido"].includes(r.estado)

  return (
    <DetalleDialog
      abierto
      onCerrar={onCerrar}
      icono={Cable}
      titulo={`${r.sistema.toUpperCase()} · ${r.operacion}`}
      subtitulo={<>Envío #{r.id} · {r.entidad} {r.entidad_id ?? ""}</>}
      ancho="tabla"
      pie={
        <>
          <Button variant="outline" onClick={onCerrar}>Cerrar</Button>
          {puedeDescartar && !descartando && (
            <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setDescartando(true)}>
              <Ban className="mr-1.5 h-4 w-4" /> Descartar
            </Button>
          )}
          {puedeReintentar && (
            <Button onClick={reintentar} disabled={trabajando}>
              {trabajando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
              Reintentar
            </Button>
          )}
        </>
      }
    >
      <ResumenDatos className="md:grid-cols-4 lg:grid-cols-4">
        <Dato etiqueta="Estado"><BadgeEstado tono={e.tono}>{e.etiqueta}</BadgeEstado></Dato>
        <Dato etiqueta="Intentos" num>{r.intentos} de {r.max_intentos}</Dato>
        <Dato etiqueta="Referencia externa">{r.referencia_externa || "—"}</Dato>
        <Dato etiqueta="Enviado">{fecha(r.enviado_en)}</Dato>
      </ResumenDatos>

      {r.ultimo_error && (
        <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-800">
          <p className="font-semibold">Último error</p>
          <p className="mt-0.5 break-words">{r.ultimo_error}</p>
        </div>
      )}

      {descartando && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/50 p-3">
          <p className="text-xs text-amber-800">
            Un envío descartado <strong>no llegará nunca</strong> al otro sistema. Indica por qué.
          </p>
          <Textarea value={motivo} onChange={(ev) => setMotivo(ev.target.value)} rows={2} className="text-xs" placeholder="Motivo del descarte" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDescartando(false)}>Cancelar</Button>
            <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={descartar} disabled={trabajando || !motivo.trim()}>
              Confirmar descarte
            </Button>
          </div>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">Datos enviados</p>
        <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-3 text-[11px] leading-relaxed">
          {JSON.stringify(r.payload, null, 2)}
        </pre>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">Intentos</p>
        {intentos === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : intentos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no se ha intentado enviar.</p>
        ) : (
          <ul className="space-y-1.5">
            {intentos.map((i) => (
              <li key={i.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
                {i.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="tabular-nums">
                    {fecha(i.creado_en)} · modo {i.modo}
                    {i.http_status ? ` · HTTP ${i.http_status}` : ""}
                    {i.duracion_ms != null ? ` · ${i.duracion_ms} ms` : ""}
                  </p>
                  {i.error && <p className="mt-0.5 break-words text-red-700">{i.error}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <FuenteDato>
        Fuente: bandeja de integraciones del CRM. La llave de idempotencia ({r.idempotency_key}) evita que un
        reintento duplique el documento en el sistema externo.
      </FuenteDato>
    </DetalleDialog>
  )
}

export default IntegracionesPanel
