"use client"

// Cuentas por cobrar: qué se debe, desde cuándo y cuánto falta.

import { useEffect, useMemo, useState } from "react"
import {
  Loader2, Wallet, AlertTriangle, Receipt, Banknote, FileText,
} from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { useAuth } from "@/components/auth-provider"
import { getCuentasPorCobrar, asignarNumeroFactura } from "@/lib/crm-cartera-actions"
import {
  ESTADO_CUENTA_LABEL, diasVencido, money, rangoVencimiento, type CuentaPorCobrar,
} from "@/lib/crm-cartera"
import { getPermisosRecaudo, type PermisosRecaudo } from "@/lib/crm-recaudos-actions"
import { getParamNumber } from "@/lib/crm-parametros-actions"
import { PARAM } from "@/lib/crm-parametros"
import { FacturaDetalleDialog } from "./factura-detalle-dialog"
import { hoyISO } from "@/lib/crm-fechas"
import { RegistrarPagoDialog } from "./registrar-pago-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { KpiCompacto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "@/hooks/use-toast"
import { TablaDatos } from "@/components/crm/ui/tabla-datos"
import { AccesosRapidos } from "@/components/crm/ui/accesos-rapidos"
import { useIntencion } from "@/lib/crm-navegacion"

export function CxcPanel() {
  const { profile, selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [cuentas, setCuentas] = useState<CuentaPorCobrar[]>([])
  const [cargando, setCargando] = useState(true)
  // Ya no hay estado de búsqueda propio: el buscador vive dentro de TablaDatos.
  // Dos cajas de texto sobre la misma tabla solo sirven para que el usuario se
  // pregunte cuál de las dos manda.
  const [filtro, setFiltro] = useState("pendientes")
  const [cobrando, setCobrando] = useState<CuentaPorCobrar | null>(null)
  const [facturando, setFacturando] = useState<CuentaPorCobrar | null>(null)
  const [viendo, setViendo] = useState<CuentaPorCobrar | null>(null)
  // CAR-01: el vendedor ve la cartera en solo lectura. Abonar y asignar
  // factura quedan para Cartera; el vendedor reporta pagos en Recaudos.
  const [permisos, setPermisos] = useState<PermisosRecaudo | null>(null)
  const [cortes, setCortes] = useState<[number, number, number]>([30, 60, 90])
  const gestiona = !!permisos?.aprobar

  useEffect(() => {
    getPermisosRecaudo().then((r) => r.success && r.data && setPermisos(r.data))
    Promise.all([
      getParamNumber(PARAM.CARTERA_RANGO_1, empresaId, 30),
      getParamNumber(PARAM.CARTERA_RANGO_2, empresaId, 60),
      getParamNumber(PARAM.CARTERA_RANGO_3, empresaId, 90),
    ]).then(([a, b, c]) => setCortes([a, b, c]))
  }, [empresaId])

  // Llegando de la cuenta de un cliente: solo su cartera.
  const [clienteFiltro, setClienteFiltro] = useState<{ id: number; nombre?: string } | null>(null)
  useIntencion(["ver_cartera_cliente"], (i) => setClienteFiltro({ id: i.clienteId, nombre: i.nombre }))

  const cargar = async () => {
    const res = await getCuentasPorCobrar(empresaId, {
      soloVencidas: filtro === "vencidas",
      clienteId: clienteFiltro?.id,
    })
    if (res.success) setCuentas(res.data ?? [])
    else toast({ title: "No se pudo cargar la cartera", description: res.error, variant: "destructive" })
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, filtro, clienteFiltro?.id])

  // El filtro de estado se aplica ANTES de entregar los datos a la tabla: la
  // consulta ya trae solo lo pedido, así que aquí `visibles` es exactamente lo
  // que la tabla recibe, y los KPIs de arriba cuadran con lo que se ve abajo.
  const visibles = cuentas

  // Columnas de la tabla.
  //
  // Lo importante está en cómo ordenan, no en cómo se pintan: "Vence" ordena
  // por los días de vencimiento reales y "Valor"/"Saldo" por el número, nunca
  // por el texto ya formateado. Ordenar "$ 1.000.000" como cadena lo pondría
  // antes que "$ 900.000", que es justo el error que hace desconfiar de la
  // tabla y mandar a todo el mundo de vuelta a Excel.
  const columnas = useMemo<ColumnDef<any, any>[]>(() => [
    {
      accessorKey: "cliente_nombre",
      header: "Cliente",
      cell: ({ row }) => (
        <span className="block max-w-[200px] truncate font-medium">
          {row.original.cliente_nombre ?? "—"}
        </span>
      ),
    },
    {
      // Se ordena e indexa por el número de factura, pero la celda también
      // muestra el pedido, que es por donde pregunta el cliente cuando aún no
      // hay factura emitida.
      accessorKey: "numero_factura",
      header: "Factura",
      cell: ({ row }) => {
        const c = row.original as CuentaPorCobrar
        return (
          <>
            {c.numero_factura ? (
              <span className="text-sm">{c.numero_factura}</span>
            ) : !gestiona ? (
              <span className="text-xs text-muted-foreground">Sin número</span>
            ) : (
              <Button
                variant="ghost" size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground"
                onClick={(e) => { e.stopPropagation(); setFacturando(c) }}
              >
                <FileText className="mr-1 h-3 w-3" />
                Asignar
              </Button>
            )}
            {c.pedido_numero && (
              <p className="text-[11px] text-muted-foreground">{c.pedido_numero}</p>
            )}
          </>
        )
      },
    },
    {
      accessorKey: "fecha_factura",
      header: "Contabilización",
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.fecha_factura}</span>,
    },
    {
      // `accessorFn` y no `accessorKey`: se ordena por los días vencidos, que
      // es LA pregunta del módulo ("¿a quién cobro primero?"). Ordenar por la
      // fecha en texto daría el mismo orden solo por casualidad del formato
      // ISO, y dejaría de funcionar el día que cambie el formato.
      id: "vence",
      accessorFn: (c: CuentaPorCobrar) => diasVencido(c.fecha_vencimiento, hoyISO()),
      header: "Vence",
      cell: ({ row }) => {
        const c = row.original as CuentaPorCobrar
        const dias = diasVencido(c.fecha_vencimiento, hoyISO())
        return (
          <>
            <span className="text-sm">{c.fecha_vencimiento}</span>
            {dias > 0 ? (
              <p className="text-[11px] font-medium text-destructive">
                {dias} día{dias === 1 ? "" : "s"} vencida
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {-dias} día{dias === -1 ? "" : "s"} por vencer
              </p>
            )}
          </>
        )
      },
    },
    {
      accessorKey: "valor_original",
      header: "Valor",
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-muted-foreground">
          {money(row.original.valor_original)}
        </div>
      ),
    },
    {
      accessorKey: "valor_abonado",
      header: "Abonado",
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-muted-foreground">
          {money(row.original.valor_abonado)}
        </div>
      ),
    },
    {
      accessorKey: "saldo",
      header: "Saldo",
      cell: ({ row }) => (
        <div className="text-right font-semibold tabular-nums">
          {money(row.original.saldo)}
        </div>
      ),
    },
    {
      id: "saldo_vencido",
      accessorFn: (c: CuentaPorCobrar) => (diasVencido(c.fecha_vencimiento, hoyISO()) > 0 ? Number(c.saldo) : 0),
      header: "Saldo vencido",
      cell: ({ getValue }) => (
        <div className={`text-right tabular-nums ${Number(getValue()) > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          {money(Number(getValue()))}
        </div>
      ),
    },
    {
      id: "rango",
      accessorFn: (c: CuentaPorCobrar) => diasVencido(c.fecha_vencimiento, hoyISO()),
      header: "Rango",
      cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{rangoVencimiento(Number(getValue()), cortes)}</span>,
    },
    {
      accessorKey: "estado",
      header: "Estado",
      cell: ({ row }) => {
        const c = row.original as CuentaPorCobrar
        const vencida = diasVencido(c.fecha_vencimiento, hoyISO()) > 0
        return (
          // Vencida en rojo, abonada en azul, al dia en gris:
          // el color dice que hacer sin leer la fila entera.
          <Badge
            variant="outline"
            className={`font-medium ${
              vencida
                ? "bg-red-50 text-red-700 border-red-200"
                : c.estado === "parcial"
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-slate-50 text-slate-700 border-slate-200"
            }`}
          >
            {ESTADO_CUENTA_LABEL[c.estado]}
          </Badge>
        )
      },
    },
    {
      // Accesos a lo relacionado: la cuenta del cliente, cobrarle, el pedido.
      id: "ir",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const c = row.original as CuentaPorCobrar
        return (
          <AccesosRapidos
            variante="menu"
            accesos={[
              { cuenta360: c.cliente_id },
              { intencion: { accion: "registrar_pago", clienteId: c.cliente_id } },
              !!c.pedido_id && { intencion: { accion: "ver_pedido", pedidoId: c.pedido_id } },
            ]}
          />
        )
      },
    },
    ...(gestiona ? ([
    {
      // Columna de acciones: no ordena ni entra en la búsqueda global, porque
      // no contiene un dato sino un botón.
      id: "acciones",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setCobrando(row.original as CuentaPorCobrar) }}>
          <Banknote className="mr-1 h-3.5 w-3.5" />
          Abonar
        </Button>
      ),
    },
    ] as ColumnDef<any, any>[]) : []),
  ], [gestiona, cortes])

  const totales = useMemo(() => {
    const hoy = hoyISO()
    let pendiente = 0
    let vencido = 0
    let cuentasVencidas = 0

    for (const c of visibles) {
      const saldo = Number(c.saldo) || 0
      pendiente += saldo
      if (diasVencido(c.fecha_vencimiento, hoy) > 0) {
        vencido += saldo
        cuentasVencidas += 1
      }
    }
    return { pendiente, vencido, cuentasVencidas }
  }, [visibles])

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <Wallet className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Cuentas por cobrar</h1>
            <p className="text-sm text-muted-foreground">La cartera nace cuando un pedido a crédito viaja a operación</p>
          </div>
        </div>
      </header>

      {/* Indicadores compactos: los de módulo, no los del tablero. */}
      <TiraKpi>
        <KpiCompacto etiqueta="Por cobrar" valor={money(totales.pendiente)} icono={Wallet} tono="primary" />
        <KpiCompacto
          etiqueta="Vencido"
          valor={money(totales.vencido)}
          detalle={`${totales.cuentasVencidas} factura(s)`}
          icono={AlertTriangle}
          // Rojo en cuanto hay algo vencido: que suba es mala noticia y el
          // color tiene que decirlo sin que haya que leer la cifra.
          tono={totales.vencido > 0 ? "danger" : "neutral"}
        />
        <KpiCompacto etiqueta="Facturas abiertas" valor={visibles.length} icono={Receipt} tono="primary" />
      </TiraKpi>

      <div className="flex flex-wrap gap-2">
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pendientes">Pendientes</SelectItem>
            <SelectItem value="vencidas">Solo vencidas</SelectItem>
          </SelectContent>
        </Select>
        {clienteFiltro && (
          <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => setClienteFiltro(null)}>
            {clienteFiltro.nombre ?? cuentas[0]?.cliente_nombre ?? "Un cliente"} · quitar filtro ✕
          </Button>
        )}
      </div>

      {/* La tabla no desaparece mientras carga: la cabecera se queda en su
          sitio y el aviso de carga ocupa el cuerpo. Cambiar el bloque entero
          por un spinner hace saltar el contenido dos veces en cada consulta. */}
      <TablaDatos
        datos={visibles}
        columnas={columnas}
        cargando={cargando}
        placeholderBusqueda="Buscar por cliente o factura…"
        onFila={(c) => setViendo(c as CuentaPorCobrar)}
        mensajeVacio="No hay cartera pendiente."
        // La factura vencida se tiñe de rojo: es el aviso que se ve antes de
        // leer nada, y sin él la cartera vencida se pierde entre la que no lo está.
        claseFila={(c) => (diasVencido(c.fecha_vencimiento, hoyISO()) > 0 ? "bg-destructive/5" : undefined)}
      />

      <RegistrarPagoDialog
        cuenta={cobrando}
        empresaId={empresaId}
        usuario={profile?.usuario ?? "desconocido"}
        onCerrar={() => setCobrando(null)}
        onPagado={() => {
          setCobrando(null)
          cargar()
        }}
      />

      {viendo && (
        <FacturaDetalleDialog
          key={viendo.id}
          cuenta={viendo}
          empresaId={empresaId}
          permisos={permisos}
          cortes={cortes}
          onCerrar={() => setViendo(null)}
        />
      )}

      <DialogoFactura
        cuenta={facturando}
        empresaId={empresaId}
        onCerrar={() => setFacturando(null)}
        onGuardado={() => {
          setFacturando(null)
          cargar()
        }}
      />
    </div>
  )
}

/** Número de factura de Siigo. La cartera ya existe desde que el pedido viajó;
 *  esto solo la amarra al documento contable. */
function DialogoFactura({
  cuenta, empresaId, onCerrar, onGuardado,
}: {
  cuenta: CuentaPorCobrar | null
  empresaId: number
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [numero, setNumero] = useState("")
  const [guardando, setGuardando] = useState(false)

  useEffect(() => setNumero(cuenta?.numero_factura ?? ""), [cuenta])

  if (!cuenta) return null

  const guardar = async () => {
    setGuardando(true)
    const res = await asignarNumeroFactura(cuenta.id, numero, empresaId)
    setGuardando(false)

    if (!res.success) {
      toast({ title: "No se guardó", description: res.error, variant: "destructive" })
      return
    }
    toast({ title: "Factura asignada" })
    onGuardado()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Número de factura</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label className="text-sm">Factura emitida en el sistema contable</Label>
          <Input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="FV-1234"
            onKeyDown={(e) => e.key === "Enter" && numero && guardar()}
          />
          <p className="text-xs text-muted-foreground">
            {cuenta.cliente_nombre} · {money(cuenta.valor_original)}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando || !numero.trim()}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CxcPanel
