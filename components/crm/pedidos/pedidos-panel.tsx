"use client"

// Listado de pedidos (PED-27..29).
//
// Filtros y paginación viven EN EL SERVIDOR: antes se traían 300 pedidos y se
// filtraba en el navegador, así que el pedido 301 sencillamente no existía para
// quien lo buscaba. Por eso la tabla no usa su buscador propio (que filtra solo
// lo que ya llegó) y el texto viaja como filtro a `buscarPedidos`.
//
// Todo lo que se hace con un pedido —ver, editar, enviar a aprobación, anular,
// reintentar LIPgo— pasa por el diálogo de detalle. La tabla solo informa: así
// el botón de una acción delicada nunca queda a un clic accidental de la fila.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  AlertTriangle, Ban, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock,
  Eye, FileEdit, Layers, RefreshCw, Search, ShieldAlert, Truck, XCircle, X,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { buscarPedidos, type FiltrosPedidos } from "@/lib/crm-pedidos-actions"
import { ESTADO_LABEL, esPendiente } from "@/lib/crm-pedidos-estado"
import { money, type EstadoPedido, type PedidoConDetalle } from "@/lib/crm-pedidos"
import { getClientesCrm, getSucursalesCrm, getVendedoresCrm } from "@/lib/crm-catalogos-actions"
import { listarMaestro } from "@/lib/crm-maestros-actions"
import type { ClienteCrm, SucursalCrm, VendedorCrm } from "@/lib/crm-catalogos"
import { formatearISO } from "@/lib/crm-fechas"
import { TablaDatos } from "@/components/crm/ui/tabla-datos"
import { KpiCompacto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { BadgeEstado } from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
// Las piezas compartidas viven en los diálogos (panel → detalle → edición) y
// no al revés: así no hay importaciones circulares entre los tres archivos.
import { PedidoDetalleDialog, ChipsIntegracion, TONO_ESTADO, hayErrorIntegracion } from "./pedido-detalle-dialog"
import { SelectorBuscable } from "./pedido-editar-dialog"
import { useIntencion } from "@/lib/crm-navegacion"

const POR_PAGINA = 50

// ------------------------------------------------------------------ estados

type Vista = "todos" | "borrador" | "aprobacion" | "aprobado" | "lipgo" | "rechazado" | "anulado"

// Cada píldora agrupa también los estados de la versión anterior: si la
// migración dejó alguno sin convertir, sigue apareciendo donde se le busca.
const ESTADOS_VISTA: Record<Exclude<Vista, "todos">, EstadoPedido[]> = {
  borrador: ["borrador"],
  aprobacion: ["pendiente_cartera", "pendiente_gerencia", "pendiente_autorizacion", "autorizado_parcial"],
  aprobado: ["aprobado", "autorizado"],
  lipgo: ["programado_lipgo", "enviado_lipgo"],
  rechazado: ["rechazado"],
  anulado: ["anulado"],
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

const TODOS = "todos"

interface Filtros {
  texto: string
  desde: string
  hasta: string
  mes: string
  anio: string
  clienteId: number | null
  sucursalId: string
  vendedorId: string
  ownerId: string
  soloSobrecupo: boolean
}

const FILTROS_VACIOS: Filtros = {
  texto: "", desde: "", hasta: "", mes: TODOS, anio: TODOS, clienteId: null,
  sucursalId: TODOS, vendedorId: TODOS, ownerId: TODOS, soloSobrecupo: false,
}

// ------------------------------------------------------------------- panel

export function PedidosPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [vista, setVista] = useState<Vista>("todos")
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  // El texto se aplica con retardo: consultar al servidor en cada tecla
  // dispara una búsqueda por letra y las respuestas llegan desordenadas.
  const [textoAplicado, setTextoAplicado] = useState("")
  const [pagina, setPagina] = useState(1)

  const [filas, setFilas] = useState<PedidoConDetalle[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [detalleId, setDetalleId] = useState<number | null>(null)
  // Llegando de otro módulo: abrir un pedido concreto o filtrar por cliente.
  useIntencion(["ver_pedido", "ver_pedidos_cliente"], (i) => {
    if (i.accion === "ver_pedido") setDetalleId(i.pedidoId)
    else {
      setVista("todos")
      setFiltros({ ...FILTROS_VACIOS, clienteId: i.clienteId })
    }
  })

  // Catálogos de los selectores
  const [clientes, setClientes] = useState<ClienteCrm[]>([])
  const [sucursales, setSucursales] = useState<SucursalCrm[]>([])
  const [vendedores, setVendedores] = useState<VendedorCrm[]>([])
  const [owners, setOwners] = useState<{ id: number; nombre: string }[]>([])

  useEffect(() => {
    Promise.all([getClientesCrm(empresaId), getVendedoresCrm(empresaId), listarMaestro("owners", empresaId)]).then(
      ([c, v, o]) => {
        if (c.success) setClientes(c.data ?? [])
        if (v.success) setVendedores(v.data ?? [])
        if (o.success) setOwners((o.data ?? []).map((f) => ({ id: f.id, nombre: String(f.nombre ?? f.id) })))
      },
    )
  }, [empresaId])

  // La sucursal solo tiene sentido dentro de un cliente: con miles de
  // sucursales en la lista, elegir una sin cliente es buscar una aguja.
  useEffect(() => {
    setSucursales([])
    if (!filtros.clienteId) return
    getSucursalesCrm(empresaId, filtros.clienteId).then((r) => r.success && setSucursales(r.data ?? []))
  }, [empresaId, filtros.clienteId])

  useEffect(() => {
    const t = setTimeout(() => setTextoAplicado(filtros.texto.trim()), 350)
    return () => clearTimeout(t)
  }, [filtros.texto])

  const consulta = useMemo<FiltrosPedidos>(() => {
    const f: FiltrosPedidos = {}
    if (vista !== "todos") f.estado = ESTADOS_VISTA[vista]
    if (textoAplicado) f.texto = textoAplicado
    if (filtros.anio !== TODOS) {
      f.anio = Number(filtros.anio)
      if (filtros.mes !== TODOS) f.mes = Number(filtros.mes)
    } else {
      if (filtros.desde) f.desde = filtros.desde
      if (filtros.hasta) f.hasta = filtros.hasta
    }
    if (filtros.clienteId) f.clienteId = filtros.clienteId
    if (filtros.sucursalId !== TODOS) f.bodegaId = Number(filtros.sucursalId)
    if (filtros.vendedorId !== TODOS) f.vendedorId = Number(filtros.vendedorId)
    if (filtros.ownerId !== TODOS) f.ownerId = Number(filtros.ownerId)
    if (filtros.soloSobrecupo) f.soloSobrecupo = true
    return f
  }, [vista, textoAplicado, filtros])

  // Cualquier cambio de filtro vuelve a la primera página: quedarse en la 7
  // de un resultado que ahora tiene dos páginas muestra una tabla vacía.
  useEffect(() => {
    setPagina(1)
  }, [consulta])

  // Número de la última consulta lanzada. Al cambiar de filtro rápido llegan
  // respuestas viejas después de las nuevas; solo se pinta la más reciente.
  const turno = useRef(0)

  const cargar = useCallback(async () => {
    const mio = ++turno.current
    setCargando(true)
    const r = await buscarPedidos(empresaId, consulta, pagina, POR_PAGINA)
    if (mio !== turno.current) return
    if (r.success) {
      setFilas(r.data?.filas ?? [])
      setTotal(r.data?.total ?? 0)
    } else {
      toast({ title: "No se pudieron cargar los pedidos", description: r.error, variant: "destructive" })
    }
    setCargando(false)
  }, [empresaId, consulta, pagina])

  useEffect(() => {
    cargar()
  }, [cargar])

  const poner = <K extends keyof Filtros>(k: K, v: Filtros[K]) => setFiltros((f) => ({ ...f, [k]: v }))

  // Rango y mes/año se excluyen: dos criterios de fecha a la vez producen
  // resultados que nadie sabe explicar ("puse marzo y me salen de abril").
  const ponerRango = (k: "desde" | "hasta", v: string) =>
    setFiltros((f) => ({ ...f, [k]: v, mes: TODOS, anio: TODOS }))
  const ponerMesAnio = (k: "mes" | "anio", v: string) =>
    setFiltros((f) => {
      const n = { ...f, [k]: v, desde: "", hasta: "" }
      // Un mes sin año no se puede consultar: se asume el año en curso.
      if (k === "mes" && v !== TODOS && n.anio === TODOS) n.anio = String(new Date().getFullYear())
      if (k === "anio" && v === TODOS) n.mes = TODOS
      return n
    })

  const hayFiltros = JSON.stringify({ ...filtros, texto: filtros.texto.trim() }) !== JSON.stringify(FILTROS_VACIOS)

  const anios = useMemo(() => {
    const a = new Date().getFullYear()
    return [a, a - 1, a - 2, a - 3]
  }, [])

  // KPIs sobre la página visible: son la lectura rápida de lo que se tiene
  // delante, no un conteo global (ese lo da "de N" en la paginación).
  const kpi = useMemo(
    () => ({
      aprobacion: filas.filter((p) => esPendiente(p.estado)).length,
      sobrecupo: filas.filter((p) => p.requiere_sobrecupo).length,
      errores: filas.filter(hayErrorIntegracion).length,
      valor: filas.reduce((s, p) => s + (Number(p.total) || 0), 0),
    }),
    [filas],
  )

  const columnas = useMemo<ColumnDef<any, any>[]>(
    () => [
      {
        id: "numero",
        accessorFn: (p: PedidoConDetalle) => p.numero ?? "",
        header: "Número",
        cell: ({ row }) => {
          const p = row.original as PedidoConDetalle
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium">
              {p.numero ?? `#${p.id}`}
              {(p.version ?? 1) > 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="rounded bg-violet-50 px-1 py-px text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200">
                      v{p.version}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Reenviado tras un rechazo ({p.version}ª versión)</TooltipContent>
                </Tooltip>
              )}
            </span>
          )
        },
      },
      {
        id: "fecha",
        accessorFn: (p: PedidoConDetalle) => p.fecha ?? "",
        header: "Fecha",
        cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{formatearISO(getValue() as string) || "—"}</span>,
      },
      {
        id: "cliente",
        accessorFn: (p: PedidoConDetalle) => p.cliente_nombre ?? "",
        header: "Cliente",
        cell: ({ getValue }) => <span className="block max-w-[220px] truncate">{(getValue() as string) || "—"}</span>,
      },
      {
        id: "sucursal",
        accessorFn: (p: PedidoConDetalle) => p.sucursal_nombre ?? "",
        header: "Sucursal",
        cell: ({ getValue }) => <span className="block max-w-[160px] truncate">{(getValue() as string) || "—"}</span>,
      },
      {
        id: "vendedor",
        accessorFn: (p: PedidoConDetalle) => p.vendedor_nombre ?? "",
        header: "Vendedor",
        cell: ({ getValue }) => <span className="block max-w-[140px] truncate">{(getValue() as string) || "—"}</span>,
      },
      {
        id: "owner",
        accessorFn: (p: PedidoConDetalle) => p.owner_nombre ?? "",
        header: "Owner",
        cell: ({ getValue }) => <span className="whitespace-nowrap">{(getValue() as string) || "—"}</span>,
      },
      {
        id: "total",
        // Se ordena por el número, no por el texto con puntos de miles.
        accessorFn: (p: PedidoConDetalle) => Number(p.total) || 0,
        header: () => <span className="block text-right">Total</span>,
        cell: ({ getValue }) => <div className="text-right font-medium tabular-nums">{money(getValue() as number)}</div>,
      },
      {
        id: "estado",
        accessorFn: (p: PedidoConDetalle) => p.estado,
        header: "Estado",
        cell: ({ getValue }) => {
          const e = getValue() as EstadoPedido
          return <BadgeEstado tono={TONO_ESTADO[e]} className="whitespace-nowrap">{ESTADO_LABEL[e]}</BadgeEstado>
        },
      },
      {
        id: "sobrecupo",
        accessorFn: (p: PedidoConDetalle) => (p.requiere_sobrecupo ? Number(p.sobrecupo_valor) || 0 : 0),
        header: "Sobrecupo",
        cell: ({ row }) => {
          const p = row.original as PedidoConDetalle
          if (!p.requiere_sobrecupo) return <span className="text-muted-foreground">—</span>
          return (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-red-700 ring-1 ring-red-200">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              {money(Number(p.sobrecupo_valor) || 0)}
            </span>
          )
        },
      },
      {
        id: "integracion",
        accessorFn: (p: PedidoConDetalle) => (hayErrorIntegracion(p) ? 0 : p.idpedido_lipgo ? 2 : 1),
        header: "Integración",
        cell: ({ row }) => <ChipsIntegracion pedido={row.original as PedidoConDetalle} />,
      },
      {
        id: "acciones",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original as PedidoConDetalle
          return (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Ver el pedido ${p.numero ?? p.id}`}
              onClick={(e) => {
                e.stopPropagation()
                setDetalleId(p.id)
              }}
            >
              <Eye className="h-4 w-4" />
            </Button>
          )
        },
      },
    ],
    [],
  )

  const desdeN = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1
  const hastaN = Math.min(pagina * POR_PAGINA, total)
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const clienteSel = clientes.find((c) => c.id === filtros.clienteId) ?? null

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Pedidos</h1>
            <p className="text-sm text-muted-foreground">
              Un pedido pasa por Cartera y Gerencia antes de programarse en LIPgo
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={cargar} disabled={cargando}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
        </Button>
      </header>

      <TiraKpi>
        <KpiCompacto
          etiqueta="En pantalla"
          valor={filas.length}
          detalle={`${money(kpi.valor)} · de ${total.toLocaleString("es-CO")}`}
          icono={ClipboardList}
        />
        <KpiCompacto
          etiqueta="En aprobación"
          valor={kpi.aprobacion}
          icono={Clock}
          tono={kpi.aprobacion > 0 ? "warning" : "neutral"}
        />
        <KpiCompacto
          etiqueta="Con sobrecupo"
          valor={kpi.sobrecupo}
          icono={ShieldAlert}
          tono={kpi.sobrecupo > 0 ? "danger" : "neutral"}
        />
        <KpiCompacto
          etiqueta="Error de integración"
          valor={kpi.errores}
          icono={AlertTriangle}
          tono={kpi.errores > 0 ? "danger" : "neutral"}
        />
      </TiraKpi>

      <SubNav<Vista>
        vistas={[
          { valor: "todos", etiqueta: "Todos", icono: Layers },
          { valor: "borrador", etiqueta: "Borradores", icono: FileEdit },
          { valor: "aprobacion", etiqueta: "En aprobación", icono: Clock },
          { valor: "aprobado", etiqueta: "Aprobados", icono: CheckCircle2 },
          { valor: "lipgo", etiqueta: "En LIPgo", icono: Truck },
          { valor: "rechazado", etiqueta: "Rechazados", icono: XCircle },
          { valor: "anulado", etiqueta: "Anulados", icono: Ban },
        ]}
        activa={vista}
        onCambiar={setVista}
      />

      {/* Barra de filtros compacta: h-8 y text-xs, como las de LIPgo. */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
        <Campo etiqueta="Número" className="w-full sm:w-48">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filtros.texto}
              onChange={(e) => poner("texto", e.target.value)}
              placeholder="Nº pedido o nº LIPgo"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </Campo>

        <Campo etiqueta="Desde" className="w-36">
          <DatePickerField
            value={filtros.desde}
            onChange={(v) => ponerRango("desde", v)}
            maxDate={filtros.hasta || undefined}
            placeholder="Desde"
            className="h-8 text-xs"
          />
        </Campo>
        <Campo etiqueta="Hasta" className="w-36">
          <DatePickerField
            value={filtros.hasta}
            onChange={(v) => ponerRango("hasta", v)}
            minDate={filtros.desde || undefined}
            placeholder="Hasta"
            className="h-8 text-xs"
          />
        </Campo>

        <Campo etiqueta="Mes" className="w-32">
          <Select value={filtros.mes} onValueChange={(v) => ponerMesAnio("mes", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS} className="text-xs">Todos</SelectItem>
              {MESES.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)} className="text-xs">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo etiqueta="Año" className="w-24">
          <Select value={filtros.anio} onValueChange={(v) => ponerMesAnio("anio", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS} className="text-xs">Todos</SelectItem>
              {anios.map((a) => (
                <SelectItem key={a} value={String(a)} className="text-xs">{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>

        <Campo etiqueta="Cliente" className="w-full sm:w-56">
          <SelectorBuscable
            opciones={clientes.map((c) => ({ id: c.id, etiqueta: c.nombre, extra: c.documento }))}
            valor={filtros.clienteId}
            onCambiar={(id) => setFiltros((f) => ({ ...f, clienteId: id, sucursalId: TODOS }))}
            placeholder="Todos los clientes"
            vacio="Ningún cliente coincide"
          />
        </Campo>

        {clienteSel && (
          <Campo etiqueta="Sucursal" className="w-44">
            <Select value={filtros.sucursalId} onValueChange={(v) => poner("sucursalId", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS} className="text-xs">Todas</SelectItem>
                {sucursales.map((s) => (
                  <SelectItem key={s.idbodega} value={String(s.idbodega)} className="text-xs">{s.nombrebodega}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        )}

        {/* Se muestra a todos: el servidor ya limita a cada vendedor a sus
            propios pedidos, así que para él este filtro no abre nada ajeno. */}
        <Campo etiqueta="Vendedor" className="w-44">
          <Select value={filtros.vendedorId} onValueChange={(v) => poner("vendedorId", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS} className="text-xs">Todos</SelectItem>
              {vendedores.map((v) => (
                <SelectItem key={v.idvendedor} value={String(v.idvendedor)} className="text-xs">{v.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>

        <Campo etiqueta="Owner" className="w-36">
          <Select value={filtros.ownerId} onValueChange={(v) => poner("ownerId", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS} className="text-xs">Todos</SelectItem>
              {owners.map((o) => (
                <SelectItem key={o.id} value={String(o.id)} className="text-xs">{o.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>

        <label className="flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs">
          <Switch checked={filtros.soloSobrecupo} onCheckedChange={(v) => poner("soloSobrecupo", v)} />
          Solo sobrecupo
        </label>

        {hayFiltros && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFiltros(FILTROS_VACIOS)}>
            <X className="mr-1 h-3.5 w-3.5" /> Limpiar
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <TablaDatos
          datos={filas}
          columnas={columnas}
          cargando={cargando}
          mensajeVacio={
            hayFiltros || vista !== "todos"
              ? "Ningún pedido coincide con los filtros."
              : "Todavía no hay pedidos. Se crean al aceptar una cotización."
          }
          onFila={(p: PedidoConDetalle) => setDetalleId(p.id)}
          claseFila={(p: PedidoConDetalle) => (hayErrorIntegracion(p) ? "bg-destructive/5" : undefined)}
        />

        {/* Paginación del servidor. El contador de la tabla habla solo de la
            página; éste dice cuántos hay en total. */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {total === 0
              ? "Sin resultados"
              : `Mostrando ${desdeN.toLocaleString("es-CO")}–${hastaN.toLocaleString("es-CO")} de ${total.toLocaleString("es-CO")}`}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={cargando || pagina <= 1}
              onClick={() => setPagina((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Anterior
            </Button>
            <span className="px-1 tabular-nums">
              {pagina} / {paginas}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={cargando || pagina >= paginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguiente <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {detalleId != null && (
        <PedidoDetalleDialog
          pedidoId={detalleId}
          empresaId={empresaId}
          onCerrar={() => setDetalleId(null)}
          onCambio={cargar}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- piezas

function Campo({ etiqueta, className, children }: { etiqueta: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-[11px] font-medium text-muted-foreground">{etiqueta}</Label>
      {children}
    </div>
  )
}

export default PedidosPanel
