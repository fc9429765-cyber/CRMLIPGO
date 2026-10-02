"use client"

// Importar datos: maestros y facturas por archivo mientras SAP está apagado.
//
// DOS PASOS, SIEMPRE. Subir el archivo solo SIMULA: el servidor dice fila por
// fila qué haría (crear, actualizar, omitir, error) y qué valor había antes.
// Nada se escribe hasta pulsar "Aplicar". Un Excel equivocado puede pisar
// seiscientos clientes; eso tiene que verse aquí antes, no descubrirse después.
//
// El navegador solo lee el archivo y manda las celdas tal cual (números y
// fechas de Excel en crudo). La interpretación —puntos de miles, coma decimal,
// series de fecha— vive en el servidor, en un solo sitio y con pruebas.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import * as XLSX from "xlsx"
import {
  Upload, FileSpreadsheet, Download, Loader2, CheckCircle2, RefreshCw, AlertTriangle,
  PlusCircle, Pencil, MinusCircle, History, ListChecks, Trash2, Info,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { IMPORTACIONES, type TipoImportacion } from "@/lib/crm-importacion"
import {
  simularImportacion, aplicarImportacion, listarImportaciones, descartarImportacion,
  type ResultadoSimulacion, type FilaSimulada, type ImportacionResumen,
} from "@/lib/crm-importacion-actions"
import { TablaDatos } from "@/components/crm/ui/tabla-datos"
import { KpiCompacto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { BadgeEstado, type TonoEstado } from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

// Mismo tope que el servidor. Se revisa aquí también para no subir un archivo
// de cincuenta mil filas solo para que el servidor lo rechace.
const MAX_FILAS = 5000

type Vista = "nueva" | "historial"
type Accion = FilaSimulada["accion"]
type Filtro = "todas" | Accion

const ACCION: Record<Accion, { etiqueta: string; tono: TonoEstado }> = {
  crear: { etiqueta: "Crear", tono: "exito" },
  actualizar: { etiqueta: "Actualizar", tono: "info" },
  omitir: { etiqueta: "Omitir", tono: "neutral" },
  error: { etiqueta: "Error", tono: "peligro" },
}

const ESTADO_IMPORTACION: Record<string, { etiqueta: string; tono: TonoEstado }> = {
  simulada: { etiqueta: "Simulada", tono: "advertencia" },
  aplicada: { etiqueta: "Aplicada", tono: "exito" },
  fallida: { etiqueta: "Fallida", tono: "peligro" },
  descartada: { etiqueta: "Descartada", tono: "neutral" },
}

const TIPOS = Object.values(IMPORTACIONES)

const fecha = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("es-CO", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        timeZone: "America/Bogota",
      }).format(new Date(iso))
    : "—"

/** Valor de la comparación antes/después, legible y sin "null" a la vista. */
const mostrar = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "vacío"
  if (typeof v === "boolean") return v ? "Sí" : "No"
  if (typeof v === "number") return v.toLocaleString("es-CO")
  return String(v)
}

export function ImportarPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [vista, setVista] = useState<Vista>("nueva")
  const [tipo, setTipo] = useState<TipoImportacion>("clientes")
  const [archivo, setArchivo] = useState<string | null>(null)
  const [simulando, setSimulando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoSimulacion | null>(null)
  const [filtro, setFiltro] = useState<Filtro>("todas")
  const [confirmando, setConfirmando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [descartando, setDescartando] = useState(false)
  const [fallidas, setFallidas] = useState<{ fila: number; error: string }[] | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [historial, setHistorial] = useState<ImportacionResumen[]>([])
  const [cargandoHistorial, setCargandoHistorial] = useState(false)

  const def = IMPORTACIONES[tipo]

  const cargarHistorial = useCallback(async () => {
    setCargandoHistorial(true)
    const r = await listarImportaciones(empresaId)
    setCargandoHistorial(false)
    if (r.success) setHistorial(r.data ?? [])
    else toast({ title: "No se pudo cargar el historial", description: r.error, variant: "destructive" })
  }, [empresaId])

  useEffect(() => {
    if (vista === "historial") cargarHistorial()
  }, [vista, cargarHistorial])

  const reiniciar = () => {
    setResultado(null)
    setArchivo(null)
    setFiltro("todas")
    if (inputRef.current) inputRef.current.value = ""
  }

  // Cambiar de tipo con una simulación abierta la dejaría huérfana: sus filas
  // son de otro tipo y ya no corresponden a las columnas que se muestran.
  const elegirTipo = (t: TipoImportacion) => {
    if (resultado) return
    setTipo(t)
    setFallidas(null)
  }

  const descargarPlantilla = () => {
    const hoja = XLSX.utils.aoa_to_sheet([def.campos.map((c) => c.etiqueta)])
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, def.titulo.slice(0, 31))
    XLSX.writeFile(libro, `plantilla-${tipo}.xlsx`)
  }

  const procesarArchivo = async (file: File) => {
    setFallidas(null)
    setSimulando(true)
    try {
      // cellDates:false y raw:true a propósito: la fecha llega como serie de
      // Excel y el número sin formato. Convertirlos aquí dependería de la
      // configuración regional del navegador de quien sube el archivo.
      const libro = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false })
      const primera = libro.Sheets[libro.SheetNames[0]]
      if (!primera) {
        toast({ title: "El archivo no tiene hojas", variant: "destructive" })
        return
      }
      const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(primera, { defval: "", raw: true })
      if (!filas.length) {
        toast({ title: "El archivo no tiene filas", description: "La primera hoja está vacía o solo tiene encabezados.", variant: "destructive" })
        return
      }
      if (filas.length > MAX_FILAS) {
        toast({
          title: `El archivo tiene ${filas.length.toLocaleString("es-CO")} filas`,
          description: `Máximo ${MAX_FILAS.toLocaleString("es-CO")} por archivo. Divídelo en partes.`,
          variant: "destructive",
        })
        return
      }
      const r = await simularImportacion(tipo, filas, file.name, empresaId)
      if (!r.success || !r.data) {
        toast({ title: "No se pudo simular la importación", description: r.error, variant: "destructive" })
        return
      }
      setArchivo(file.name)
      setResultado(r.data)
      setFiltro(r.data.totales.error > 0 ? "error" : "todas")
    } catch (e) {
      toast({
        title: "No se pudo leer el archivo",
        description: e instanceof Error ? e.message : "Revisa que sea un Excel o CSV válido.",
        variant: "destructive",
      })
    } finally {
      setSimulando(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const descartar = async () => {
    if (!resultado) return
    setDescartando(true)
    const r = await descartarImportacion(resultado.importacionId, empresaId)
    setDescartando(false)
    if (!r.success) {
      toast({ title: "No se pudo descartar", description: r.error, variant: "destructive" })
      return
    }
    toast({ title: "Simulación descartada", description: "No se escribió nada." })
    reiniciar()
  }

  const aplicar = async () => {
    if (!resultado) return
    setConfirmando(false)
    setAplicando(true)
    const r = await aplicarImportacion(resultado.importacionId, empresaId)
    setAplicando(false)
    if (!r.success || !r.data) {
      toast({ title: "No se pudo aplicar", description: r.error, variant: "destructive" })
      return
    }
    const { aplicadas, fallidas: f } = r.data
    toast({
      title: `Se aplicaron ${aplicadas.toLocaleString("es-CO")} cambio(s)`,
      description: f.length ? `${f.length} fila(s) fallaron al escribir. Revisa el detalle.` : undefined,
      variant: f.length && !aplicadas ? "destructive" : undefined,
    })
    setFallidas(f.length ? f : null)
    reiniciar()
  }

  const totales = resultado?.totales ?? { crear: 0, actualizar: 0, omitir: 0, error: 0 }
  const cambios = totales.crear + totales.actualizar

  const filasVisibles = useMemo(
    () => (!resultado ? [] : filtro === "todas" ? resultado.filas : resultado.filas.filter((f) => f.accion === filtro)),
    [resultado, filtro],
  )

  const columnas = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "fila",
        header: "Fila",
        cell: ({ getValue }) => <div className="text-right tabular-nums">{getValue() as number}</div>,
      },
      {
        accessorKey: "accion",
        header: "Acción",
        cell: ({ getValue }) => {
          const a = ACCION[getValue() as Accion]
          return <BadgeEstado tono={a.tono}>{a.etiqueta}</BadgeEstado>
        },
      },
      {
        accessorKey: "resumen",
        header: "Qué se hará",
        cell: ({ row }) => {
          const f = row.original as FilaSimulada
          return (
            <span className={cn("break-words", f.accion === "error" && "text-red-700")}>
              {f.resumen}
            </span>
          )
        },
      },
      {
        id: "cambio",
        header: "Antes → Después",
        enableSorting: false,
        accessorFn: (f: FilaSimulada) => (f.antes ? Object.keys(f.antes).join(" ") : ""),
        cell: ({ row }) => {
          const f = row.original as FilaSimulada
          if (f.accion !== "actualizar" || !f.antes) return <span className="text-muted-foreground">—</span>
          return (
            <ul className="space-y-0.5 text-[11px] leading-tight">
              {Object.entries(f.antes).map(([k, antes]) => (
                <li key={k}>
                  <span className="text-muted-foreground">{k}:</span>{" "}
                  <span className="text-muted-foreground line-through">{mostrar(antes)}</span>
                  {" → "}
                  <span className="font-medium">{mostrar(f.datos[k])}</span>
                </li>
              ))}
            </ul>
          )
        },
      },
    ],
    [],
  )

  const columnasHistorial = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        accessorKey: "creado_en",
        header: "Fecha",
        cell: ({ getValue }) => <span className="tabular-nums">{fecha(getValue() as string)}</span>,
      },
      {
        id: "tipo",
        accessorFn: (i: ImportacionResumen) => IMPORTACIONES[i.tipo]?.titulo ?? i.tipo,
        header: "Tipo",
      },
      {
        accessorKey: "archivo_nombre",
        header: "Archivo",
        cell: ({ getValue }) => <span className="break-all">{(getValue() as string) || "—"}</span>,
      },
      {
        accessorKey: "estado",
        header: "Estado",
        cell: ({ getValue }) => {
          const e = ESTADO_IMPORTACION[getValue() as string] ?? { etiqueta: String(getValue()), tono: "neutral" as TonoEstado }
          return <BadgeEstado tono={e.tono}>{e.etiqueta}</BadgeEstado>
        },
      },
      {
        id: "totales",
        header: "C / A / O / E",
        accessorFn: (i: ImportacionResumen) => i.total_filas,
        cell: ({ row }) => {
          const i = row.original as ImportacionResumen
          return (
            <span className="whitespace-nowrap tabular-nums" title="Crear / Actualizar / Omitir / Error">
              <span className="text-emerald-700">{i.filas_crear}</span>
              {" / "}
              <span className="text-blue-700">{i.filas_actualizar}</span>
              {" / "}
              <span className="text-muted-foreground">{i.filas_omitir}</span>
              {" / "}
              <span className={i.filas_error ? "text-red-700" : "text-muted-foreground"}>{i.filas_error}</span>
            </span>
          )
        },
      },
      { accessorKey: "creado_por", header: "Simuló", cell: ({ getValue }) => (getValue() as string) || "—" },
      {
        accessorKey: "aplicado_por",
        header: "Aplicó",
        cell: ({ row }) => {
          const i = row.original as ImportacionResumen
          return i.aplicado_por ? (
            <span>
              {i.aplicado_por}
              <span className="block text-[11px] text-muted-foreground tabular-nums">{fecha(i.aplicado_en)}</span>
            </span>
          ) : (
            "—"
          )
        },
      },
    ],
    [],
  )

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <Upload className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Importar datos</h1>
            <p className="text-sm text-muted-foreground">
              Primero se simula y se revisa fila por fila. Nada se escribe hasta que pulses «Aplicar».
            </p>
          </div>
        </div>
        {vista === "historial" && (
          <Button variant="outline" size="sm" className="h-8" onClick={cargarHistorial} disabled={cargandoHistorial}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", cargandoHistorial && "animate-spin")} /> Actualizar
          </Button>
        )}
      </header>

      <SubNav<Vista>
        vistas={[
          { valor: "nueva", etiqueta: "Nueva importación", icono: Upload },
          { valor: "historial", etiqueta: "Historial", icono: History },
        ]}
        activa={vista}
        onCambiar={setVista}
      />

      {vista === "historial" ? (
        <TablaDatos
          datos={historial}
          columnas={columnasHistorial}
          cargando={cargandoHistorial && !historial.length}
          placeholderBusqueda="Buscar por tipo, archivo o usuario…"
          mensajeVacio="Todavía no se ha importado nada."
          claseFila={(i: ImportacionResumen) => (i.estado === "fallida" ? "bg-destructive/5" : undefined)}
        />
      ) : (
        <div className="space-y-4">
          {/* Resultado de la última aplicación. Va arriba y se queda hasta la
              siguiente: las filas que fallaron al escribir hay que corregirlas
              en el archivo, y el toast desaparece antes de copiarlas. */}
          {fallidas && (
            <Card className="border-red-200 shadow-none">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    {fallidas.length} fila(s) no se pudieron escribir
                  </p>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFallidas(null)}>
                    Cerrar
                  </Button>
                </div>
                <ul className="max-h-48 space-y-1 overflow-auto text-xs">
                  {fallidas.map((f) => (
                    <li key={f.fila} className="flex gap-2">
                      <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">Fila {f.fila}</span>
                      <span className="break-words text-red-700">{f.error}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* 1. Tipo */}
          <Paso numero={1} titulo="Qué vas a cargar">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {TIPOS.map((d) => {
                const activo = d.tipo === tipo
                return (
                  <button
                    key={d.tipo}
                    type="button"
                    onClick={() => elegirTipo(d.tipo)}
                    disabled={!!resultado && !activo}
                    aria-pressed={activo}
                    className={cn(
                      "rounded-lg border bg-card p-3 text-left transition-colors",
                      activo
                        ? "border-[#0f7b6f] ring-2 ring-[#0f7b6f]/30"
                        : "hover:border-primary/40 hover:bg-muted/30",
                      !!resultado && !activo && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <p className="text-sm font-medium">{d.titulo}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{d.descripcion}</p>
                  </button>
                )
              })}
            </div>

            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Columnas de {def.titulo.toLowerCase()} <span className="font-normal">(* obligatoria)</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {def.campos.map((c) => {
                  const chip = (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
                        c.obligatorio ? "border-[#0f7b6f]/60 bg-[#0f7b6f]/10 font-medium" : "bg-muted/40",
                      )}
                    >
                      {c.etiqueta}
                      {c.obligatorio && <span className="text-red-600">*</span>}
                      {c.ayuda && <Info className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                    </span>
                  )
                  return c.ayuda ? (
                    <Tooltip key={c.clave}>
                      <TooltipTrigger asChild>{chip}</TooltipTrigger>
                      <TooltipContent className="max-w-xs">{c.ayuda}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span key={c.clave}>{chip}</span>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                El encabezado puede venir con o sin tildes y mayúsculas. Las fechas se leen como día/mes/año.
              </p>
            </div>
          </Paso>

          {/* 2. Plantilla */}
          <Paso numero={2} titulo="Descarga la plantilla (opcional)">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" className="h-8" onClick={descargarPlantilla}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Descargar plantilla
              </Button>
              <p className="text-xs text-muted-foreground">
                Un Excel con los encabezados exactos de {def.titulo.toLowerCase()}. Llénalo desde la fila 2.
              </p>
            </div>
          </Paso>

          {/* 3. Archivo */}
          <Paso numero={3} titulo="Sube el archivo">
            {resultado ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <FileSpreadsheet className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                <span className="font-medium">{archivo}</span>
                <span className="text-muted-foreground">
                  · simulado como {def.titulo.toLowerCase()} · descarta la simulación para subir otro archivo
                </span>
              </div>
            ) : (
              <label
                onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setArrastrando(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f && !simulando) procesarArchivo(f)
                }}
                className={cn(
                  "block cursor-pointer rounded-lg border-2 border-dashed bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/40",
                  arrastrando && "border-primary/60 bg-muted/60",
                  simulando && "pointer-events-none opacity-70",
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  disabled={simulando}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) procesarArchivo(f)
                  }}
                />
                {simulando ? (
                  <>
                    <Loader2 className="mx-auto h-7 w-7 animate-spin text-muted-foreground" aria-hidden="true" />
                    <p className="mt-2 text-sm font-medium">Simulando…</p>
                    <p className="text-xs text-muted-foreground">Se cruza cada fila con la base. Todavía no se escribe nada.</p>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
                    <p className="mt-2 text-sm font-medium">Arrastra el archivo aquí o pulsa para elegirlo</p>
                    <p className="text-xs text-muted-foreground">
                      Excel (.xlsx, .xls) o CSV · primera hoja · máximo {MAX_FILAS.toLocaleString("es-CO")} filas
                    </p>
                  </>
                )}
              </label>
            )}
          </Paso>

          {/* 4. Revisión */}
          {resultado && (
            <Paso numero={4} titulo="Revisa lo que se hará">
              <div className="space-y-3">
                <TiraKpi>
                  <KpiCompacto etiqueta="Crear" valor={totales.crear} icono={PlusCircle} tono="success"
                    onClick={() => setFiltro("crear")} />
                  <KpiCompacto etiqueta="Actualizar" valor={totales.actualizar} icono={Pencil} tono="primary"
                    onClick={() => setFiltro("actualizar")} />
                  <KpiCompacto etiqueta="Omitir" valor={totales.omitir} icono={MinusCircle} tono="neutral"
                    detalle="Sin cambios o ya existen" onClick={() => setFiltro("omitir")} />
                  <KpiCompacto etiqueta="Con error" valor={totales.error} icono={AlertTriangle}
                    tono={totales.error ? "danger" : "neutral"} detalle="No se cargarán"
                    onClick={() => setFiltro("error")} />
                </TiraKpi>

                {resultado.columnasIgnoradas.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
                    <p className="font-semibold">Estas columnas no se reconocieron y no se cargarán:</p>
                    <p className="mt-0.5 break-words">{resultado.columnasIgnoradas.join(", ")}</p>
                    <p className="mt-1 text-amber-700">
                      Si alguna debía cargarse, renombra el encabezado como en la plantilla y vuelve a subir el archivo.
                    </p>
                  </div>
                )}

                <SubNav<Filtro>
                  vistas={[
                    { valor: "todas", etiqueta: "Todas", icono: ListChecks, contador: resultado.filas.length },
                    { valor: "crear", etiqueta: "Crear", icono: PlusCircle, contador: totales.crear },
                    { valor: "actualizar", etiqueta: "Actualizar", icono: Pencil, contador: totales.actualizar },
                    { valor: "error", etiqueta: "Error", icono: AlertTriangle, contador: totales.error },
                    { valor: "omitir", etiqueta: "Omitir", icono: MinusCircle, contador: totales.omitir },
                  ]}
                  activa={filtro}
                  onCambiar={setFiltro}
                />

                <TablaDatos
                  datos={filasVisibles}
                  columnas={columnas}
                  placeholderBusqueda="Buscar en el resultado…"
                  mensajeVacio="No hay filas con esta acción."
                  claseFila={(f: FilaSimulada) => (f.accion === "error" ? "bg-destructive/5" : undefined)}
                />

                <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                  {totales.error > 0 && (
                    <p className="mr-auto text-xs text-amber-700">
                      {totales.error} fila(s) con error no se cargarán. Corrígelas en el archivo y súbelo de nuevo si las necesitas.
                    </p>
                  )}
                  <Button variant="outline" size="sm" className="h-8" onClick={descartar} disabled={descartando || aplicando}>
                    {descartando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                    Descartar
                  </Button>
                  <Button size="sm" className="h-8" onClick={() => setConfirmando(true)} disabled={cambios === 0 || aplicando || descartando}>
                    {aplicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                    Aplicar {cambios.toLocaleString("es-CO")} cambio{cambios === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>
            </Paso>
          )}
        </div>
      )}

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aplicar la importación?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Se escribirán <strong className="text-foreground">{cambios.toLocaleString("es-CO")} cambios</strong> en{" "}
                  {def.titulo.toLowerCase()} ({totales.crear} nuevos, {totales.actualizar} actualizados). Las filas con
                  error no se cargan.
                </p>
                {totales.error > 0 && (
                  <p className="rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs text-amber-800">
                    Hay {totales.error} fila(s) con error que quedarán por fuera.
                  </p>
                )}
                <p className="text-xs">
                  Cada fila se vuelve a validar al aplicar: si la base cambió desde la simulación, esa fila puede fallar.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={aplicar}>Aplicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Tarjeta numerada de un paso. El número guía el orden sin tener que leerlo. */
function Paso({ numero, titulo, children }: { numero: number; titulo: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0f7b6f] text-xs font-semibold text-white">
            {numero}
          </span>
          <h2 className="text-sm font-semibold">{titulo}</h2>
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export default ImportarPanel
