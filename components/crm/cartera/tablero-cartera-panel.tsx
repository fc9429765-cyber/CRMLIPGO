"use client"

// Tablero de cartera consolidado (DSH-02), para Cartera y Gerencia.
//
// Mismos indicadores que el tablero de un cliente (DSH-01), sumados, y tres
// cortes de la misma cartera: por cliente, por vendedor y por owner. Cada fila
// lleva a lo siguiente que uno haría: el cliente abre su cuenta, el vendedor y
// el owner se vuelven filtro. Un vendedor ve aquí solo su cartera: el alcance
// lo pone el servidor, no la pantalla.

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  AlertTriangle, Banknote, Building2, CalendarClock, FileWarning, Loader2, PieChart, RefreshCw, Users, Wallet, X,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import {
  getTableroCartera, type FilaClienteTablero, type FilaGrupoTablero, type FiltrosTablero, type TableroCartera,
} from "@/lib/crm-tablero-cartera-actions"
import { etiquetasRango } from "@/lib/crm-cartera-resumen"
import { Cuenta360Dialog } from "@/components/crm/clientes/cuenta-360-dialog"
import { KpiCompacto, KpiEsqueleto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { GraficaArea, GraficaBarras } from "@/components/crm/ui/graficas"
import { TablaDatos } from "@/components/crm/ui/tabla-datos"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { FuenteDato } from "@/components/crm/ui/detalle-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const pesos = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO")
const TODOS = "__todos__"

type Corte = "clientes" | "vendedores" | "owners"

const num = (className?: string) => ({ getValue }: { getValue: () => unknown }) => (
  <div className={cn("text-right tabular-nums", className)}>{pesos(Number(getValue()))}</div>
)

export function TableroCarteraPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [filtros, setFiltros] = useState<FiltrosTablero>({})
  const [datos, setDatos] = useState<TableroCartera | null>(null)
  const [cargando, setCargando] = useState(true)
  const [corte, setCorte] = useState<Corte>("clientes")
  const [cliente, setCliente] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await getTableroCartera(empresaId, filtros)
    if (r.success && r.data) setDatos(r.data)
    else toast({ title: "No se pudo cargar el tablero", description: r.error, variant: "destructive" })
    setCargando(false)
  }, [empresaId, filtros])

  useEffect(() => { cargar() }, [cargar])

  const poner = (k: keyof FiltrosTablero, v: string) =>
    setFiltros((f) => ({ ...f, [k]: v === TODOS ? null : k === "rango" ? v : Number(v) }))

  const t = datos?.total.cuenta
  const recaudo12 = datos?.recaudoMensual.reduce((s, m) => s + m.valor, 0) ?? 0
  const recaudoMes = datos?.recaudoMensual.at(-1)?.valor ?? 0
  const recaudoAnterior = datos?.recaudoMensual.at(-2)?.valor ?? 0
  const valorVencidas = datos ? datos.total.rangos.slice(1).reduce((s, r) => s + r.valor, 0) : 0

  const colClientes = useMemo<ColumnDef<any, any>[]>(() => [
    {
      accessorKey: "nombre", header: "Cliente",
      cell: ({ row }) => (
        <div className="max-w-[240px]">
          <p className="truncate font-medium">{row.original.nombre}</p>
          <p className="truncate text-[11px] text-muted-foreground">{row.original.vendedorNombre ?? "Sin vendedor"}</p>
        </div>
      ),
    },
    { id: "saldo", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.saldo, header: "Saldo", cell: num("font-semibold") },
    { id: "alDia", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.alDia, header: "Por vencer", cell: num("text-muted-foreground") },
    {
      id: "vencido", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.vencido, header: "Vencido",
      cell: ({ row }) => (
        <div className={cn("text-right tabular-nums", row.original.resumen.cuenta.vencido > 0 && "font-medium text-destructive")}>
          {pesos(row.original.resumen.cuenta.vencido)}
          {row.original.resumen.cuenta.vencido > 0 && (
            <span className="block text-[10px] font-normal">{row.original.resumen.cuenta.pctVencido.toLocaleString("es-CO")}%</span>
          )}
        </div>
      ),
    },
    {
      id: "mora", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.diasMora, header: "Mora",
      cell: ({ getValue }) => <div className="text-right tabular-nums">{Number(getValue()) > 0 ? `${getValue()} d` : "—"}</div>,
    },
    {
      id: "disponible", accessorFn: (r: FilaClienteTablero) => (r.cupo > 0 ? r.resumen.cuenta.disponible : Number.NEGATIVE_INFINITY), header: "Cupo / disponible",
      cell: ({ row }) => {
        const c = row.original
        if (c.cupo <= 0) return <div className="text-right text-muted-foreground">Contado</div>
        const d = c.resumen.cuenta.disponible
        return (
          <div className="text-right tabular-nums">
            <span className={cn(d < 0 && "font-semibold text-destructive")}>{d < 0 ? `Sobrecupo ${pesos(-d)}` : pesos(d)}</span>
            <span className="block text-[10px] text-muted-foreground">de {pesos(c.cupo)}</span>
          </div>
        )
      },
    },
    { id: "favor", accessorFn: (r: FilaClienteTablero) => r.saldoFavor, header: "A favor", cell: num("text-emerald-700") },
  ], [])

  const colGrupo = useMemo<ColumnDef<any, any>[]>(() => [
    { accessorKey: "nombre", header: corte === "vendedores" ? "Vendedor" : "Owner", cell: ({ getValue }) => <span className="font-medium">{String(getValue())}</span> },
    { accessorKey: "clientes", header: "Clientes", cell: ({ getValue }) => <div className="text-right tabular-nums">{String(getValue())}</div> },
    { id: "saldo", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.saldo, header: "Saldo", cell: num("font-semibold") },
    { id: "alDia", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.alDia, header: "Por vencer", cell: num("text-muted-foreground") },
    { id: "vencido", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.vencido, header: "Vencido", cell: num("text-destructive") },
    {
      id: "pct", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.pctVencido, header: "% vencido",
      cell: ({ getValue }) => <div className="text-right tabular-nums">{Number(getValue()).toLocaleString("es-CO")}%</div>,
    },
    {
      id: "vencidas", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.facturasVencidas, header: "Fact. vencidas",
      cell: ({ row }) => <div className="text-right tabular-nums">{row.original.resumen.cuenta.facturasVencidas} / {row.original.resumen.cuenta.facturasAbiertas}</div>,
    },
    {
      id: "mora", accessorFn: (r: FilaClienteTablero | FilaGrupoTablero) => r.resumen.cuenta.diasMora, header: "Mora máx.",
      cell: ({ getValue }) => <div className="text-right tabular-nums">{Number(getValue()) > 0 ? `${getValue()} d` : "—"}</div>,
    },
  ], [corte])

  const hayFiltros = !!(filtros.vendedorId || filtros.ownerId || filtros.rango)
  const rangos = datos ? etiquetasRango(datos.cortes) : []

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <PieChart className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Tablero de cartera</h1>
            <p className="text-sm text-muted-foreground">Cuánto se debe, cuánto está vencido y cuánto se recauda</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={cargar} disabled={cargando}>
          {cargando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Actualizar
        </Button>
      </header>

      {/* ------------------------------------------------------------ Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filtros.vendedorId ? String(filtros.vendedorId) : TODOS} onValueChange={(v) => poner("vendedorId", v)}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Vendedor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los vendedores</SelectItem>
            {datos?.opciones.vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtros.ownerId ? String(filtros.ownerId) : TODOS} onValueChange={(v) => poner("ownerId", v)}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Owner" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas las empresas</SelectItem>
            {datos?.opciones.owners.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtros.rango ?? TODOS} onValueChange={(v) => poner("rango", v)}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Rango" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los rangos</SelectItem>
            {rangos.map((r) => <SelectItem key={r} value={r}>{r === "Al día" ? "Por vencer" : `${r} días`}</SelectItem>)}
          </SelectContent>
        </Select>
        {hayFiltros && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFiltros({})}>
            <X className="mr-1 h-3.5 w-3.5" /> Quitar filtros
          </Button>
        )}
      </div>

      {/* --------------------------------------------------------------- KPIs */}
      <TiraKpi>
        {!datos || !t ? (
          <><KpiEsqueleto /><KpiEsqueleto /><KpiEsqueleto /><KpiEsqueleto /></>
        ) : (
          <>
            <KpiCompacto etiqueta="Cartera total" valor={pesos(t.saldo)} icono={Wallet} tono="primary"
              detalle={`${t.facturasAbiertas} facturas · ${datos.porCliente.length} clientes`} />
            <KpiCompacto etiqueta="Por vencer" valor={pesos(t.alDia)} icono={CalendarClock} tono="success"
              detalle={`${t.pctAlDia.toLocaleString("es-CO")}% de la cartera`} />
            <KpiCompacto etiqueta="Vencida" valor={pesos(t.vencido)} icono={AlertTriangle} tono={t.vencido > 0 ? "danger" : "neutral"}
              detalle={`${t.pctVencido.toLocaleString("es-CO")}% · ${t.facturasVencidas} facturas`}
              onClick={() => setCorte("clientes")} />
            <KpiCompacto etiqueta="Mora máxima" valor={t.diasMora ? `${t.diasMora} días` : "—"} icono={FileWarning}
              tono={t.diasMora > 0 ? "warning" : "neutral"} detalle={pesos(valorVencidas) + " fuera de plazo"} />
            <KpiCompacto etiqueta="Recaudo del mes" valor={pesos(recaudoMes)} icono={Banknote} tono="primary"
              detalle={`Mes anterior ${pesos(recaudoAnterior)} · 12 meses ${pesos(recaudo12)}`} />
            <KpiCompacto etiqueta="Saldo a favor" valor={pesos(datos.saldoFavor)} icono={Wallet} tono="neutral"
              detalle="Pagos de más, por aplicar" />
          </>
        )}
      </TiraKpi>

      {/* ------------------------------------------------------------ Gráficas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm">Antigüedad de la cartera</CardTitle></CardHeader>
          <CardContent>
            {datos ? (
              <GraficaBarras
                datos={datos.total.rangos.map((r) => ({ rango: r.etiqueta === "Al día" ? "Por vencer" : `${r.etiqueta} d`, valor: r.valor }))}
                x="rango" y="valor" etiqueta="Saldo" moneda colorear alto={210}
              />
            ) : <div className="h-[210px]" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm">Recaudo por mes</CardTitle></CardHeader>
          <CardContent>
            {datos ? (
              <GraficaArea datos={datos.recaudoMensual} x="etiqueta" y="valor" etiqueta="Recaudo" moneda alto={210} />
            ) : <div className="h-[210px]" />}
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------------------- Cortes */}
      <SubNav<Corte>
        vistas={[
          { valor: "clientes", etiqueta: "Por cliente", icono: Users, contador: datos?.porCliente.length },
          { valor: "vendedores", etiqueta: "Por vendedor", icono: Users, contador: datos?.porVendedor.length },
          { valor: "owners", etiqueta: "Por empresa", icono: Building2, contador: datos?.porOwner.length },
        ]}
        activa={corte}
        onCambiar={setCorte}
      />

      {corte === "clientes" ? (
        <TablaDatos<FilaClienteTablero>
          datos={datos?.porCliente ?? []}
          columnas={colClientes}
          cargando={cargando && !datos}
          placeholderBusqueda="Buscar cliente o vendedor…"
          mensajeVacio="No hay cartera con estos filtros."
          onFila={(c) => setCliente(c.clienteId)}
          claseFila={(c) => (c.resumen.cuenta.disponible < 0 && c.cupo > 0 ? "bg-destructive/5" : undefined)}
        />
      ) : (
        <TablaDatos<FilaGrupoTablero>
          datos={(corte === "vendedores" ? datos?.porVendedor : datos?.porOwner) ?? []}
          columnas={colGrupo}
          cargando={cargando && !datos}
          mensajeVacio="No hay cartera con estos filtros."
          // Pulsar un vendedor o una empresa la vuelve filtro y regresa a clientes.
          onFila={(g) => {
            if (g.id == null) return
            setFiltros((f) => ({ ...f, [corte === "vendedores" ? "vendedorId" : "ownerId"]: g.id }))
            setCorte("clientes")
          }}
        />
      )}

      {datos && (
        <FuenteDato>
          Vencida = facturas cuya fecha de vencimiento ya pasó (el día del vencimiento aún está al día). Rangos
          según Parametrización ({datos.cortes.join(" / ")} días). Recaudo = abonos no anulados, sin descuentos ni notas
          crédito. {datos.truncado && "Hay más facturas de las que se leen de una vez: los totales son parciales."}
        </FuenteDato>
      )}

      {cliente !== null && (
        <Cuenta360Dialog clienteId={cliente} empresaId={empresaId} abierto onCerrar={() => setCliente(null)} />
      )}
    </div>
  )
}

export default TableroCarteraPanel
