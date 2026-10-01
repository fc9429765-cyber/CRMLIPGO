"use client"

// Antigüedad de cartera: cuánto se debe y desde hace cuánto.
//
// Los tramos NO están escritos aquí: vienen de la vista crm_cartera_aging, que
// los lee de los parámetros. Cambiar "cartera.rango_1_hasta" en Parametrización
// reclasifica esta pantalla sin tocar una línea de código.

import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, LabelList,
} from "recharts"
import { Wallet, AlertTriangle, TrendingDown, Users, TrendingUp } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getAging } from "@/lib/crm-cartera-actions"
import { money, type CuentaConAging, type ResumenAging } from "@/lib/crm-cartera"
import { KpiCompacto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"
import { MarcoTabla, FilaCargando, FilaVacia } from "@/components/crm/ui/modulo"
import { abrirCuenta360 } from "@/lib/crm-navegacion"

/** Del verde al rojo según se envejece. El corriente en el color de marca. */
const COLOR_TRAMO = [
  "var(--chart-2)",   // corriente
  "var(--chart-1)",   // primer tramo
  "var(--chart-3)",   // segundo
  "#fb923c",          // tercero
  "var(--destructive)", // el más viejo
]

export function AgingPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [cuentas, setCuentas] = useState<CuentaConAging[]>([])
  const [resumen, setResumen] = useState<ResumenAging | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let cancelado = false

    getAging(empresaId).then((res) => {
      if (cancelado) return
      if (res.success && res.data) {
        setCuentas(res.data.cuentas)
        setResumen(res.data.resumen)
      } else {
        toast({ title: "No se pudo cargar", description: res.error, variant: "destructive" })
      }
      setCargando(false)
    })

    return () => { cancelado = true }
  }, [empresaId])

  const datosGrafica = useMemo(
    () =>
      (resumen?.tramos ?? []).map((t) => ({
        tramo: t.etiqueta,
        valor: t.valor,
        cantidad: t.cantidad,
        color: COLOR_TRAMO[Math.min(t.orden, COLOR_TRAMO.length - 1)],
      })),
    [resumen],
  )

  // Los peores clientes primero: es la lista de a quién llamar hoy.
  const peores = useMemo(() => {
    const mapa = new Map<number, { nombre: string; total: number; vencido: number; facturas: number }>()

    for (const c of cuentas) {
      const g = mapa.get(c.cliente_id) ?? {
        nombre: c.cliente_nombre ?? "—", total: 0, vencido: 0, facturas: 0,
      }
      const saldo = Number(c.saldo) || 0
      g.total += saldo
      if (c.tramo_orden > 0) g.vencido += saldo
      g.facturas += 1
      mapa.set(c.cliente_id, g)
    }

    return [...mapa.entries()]
      .map(([id, g]) => ({ id, ...g }))
      .filter((g) => g.vencido > 0)
      .sort((a, b) => b.vencido - a.vencido)
      .slice(0, 10)
  }, [cuentas])

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Antigüedad de cartera</h1>
            <p className="text-sm text-muted-foreground">Los tramos se configuran en Parametrización</p>
          </div>
        </div>
      </header>

      {/* Indicadores compactos: dentro de un módulo acompañan a la tabla en
          vez de competir con ella. La tarjeta grande queda para el tablero. */}
      <TiraKpi>
        <KpiCompacto etiqueta="Total por cobrar" valor={money(resumen?.totalPendiente ?? 0)} icono={Wallet} tono="primary" />
        <KpiCompacto
          etiqueta="Vencido"
          valor={money(resumen?.totalVencido ?? 0)}
          icono={AlertTriangle}
          tono={(resumen?.totalVencido ?? 0) > 0 ? "danger" : "neutral"}
        />
        <KpiCompacto
          etiqueta="% de la cartera vencida"
          valor={`${(resumen?.porcentajeVencido ?? 0).toFixed(1)}%`}
          icono={TrendingDown}
          tono={(resumen?.porcentajeVencido ?? 0) > 20 ? "danger" : "warning"}
        />
        <KpiCompacto etiqueta="Clientes en mora" valor={peores.length} icono={Users} tono={peores.length > 0 ? "warning" : "neutral"} />
      </TiraKpi>

      {datosGrafica.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distribución por antigüedad</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={datosGrafica} margin={{ top: 20, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="tramo"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`}
                  />
                  <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                    {datosGrafica.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                    {/* El valor sobre la barra: leer una cifra exacta de un eje
                        es adivinar, y aquí el monto es lo que importa. */}
                    <LabelList
                      dataKey="valor"
                      position="top"
                      formatter={(v: number) => money(v)}
                      style={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex flex-wrap gap-3">
              {datosGrafica.map((d) => (
                <span key={d.tramo} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                  {d.tramo}: {d.cantidad} factura{d.cantidad === 1 ? "" : "s"}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">A quién cobrar primero</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* La tabla no desaparece mientras carga: la cabecera se queda en su
              sitio y el aviso de carga ocupa el cuerpo. Cambiar el bloque
              entero por un spinner hace saltar el contenido dos veces en cada
              consulta. */}
          <MarcoTabla>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs font-semibold">Cliente</TableHead>
                  <TableHead className="text-xs font-semibold text-center">Facturas</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Total</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Vencido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cargando ? (
                  <FilaCargando columnas={4} />
                ) : peores.length === 0 ? (
                  <FilaVacia columnas={4} mensaje="No hay cartera vencida." />
                ) : (
                  peores.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => abrirCuenta360(c.id)} title="Abrir la cuenta del cliente">
                      <TableCell className="text-xs max-w-[240px] truncate font-medium">{c.nombre}</TableCell>
                      <TableCell className="text-xs text-center">{c.facturas}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                        {money(c.total)}
                      </TableCell>
                      <TableCell className="text-xs text-right font-semibold tabular-nums text-destructive">
                        {money(c.vencido)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </MarcoTabla>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalle</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Mismo criterio que arriba: la cabecera del detalle aguanta en su
              sitio y el aviso de carga o de vacío ocupa el cuerpo. */}
          <MarcoTabla>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs font-semibold">Cliente</TableHead>
                  <TableHead className="text-xs font-semibold">Factura</TableHead>
                  <TableHead className="text-xs font-semibold">Vence</TableHead>
                  <TableHead className="text-xs font-semibold">Antigüedad</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cargando ? (
                  <FilaCargando columnas={5} />
                ) : cuentas.length === 0 ? (
                  <FilaVacia columnas={5} mensaje="No hay cartera pendiente." />
                ) : (
                  cuentas.slice(0, 100).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs max-w-[200px] truncate">{c.cliente_nombre ?? "—"}</TableCell>
                      <TableCell className="text-xs text-sm">
                        {c.numero_factura ?? c.pedido_numero ?? `#${c.id}`}
                      </TableCell>
                      <TableCell className="text-xs text-sm">{c.fecha_vencimiento}</TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: COLOR_TRAMO[Math.min(c.tramo_orden, COLOR_TRAMO.length - 1)],
                            color: COLOR_TRAMO[Math.min(c.tramo_orden, COLOR_TRAMO.length - 1)],
                          }}
                        >
                          {c.tramo_aging}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right font-medium tabular-nums">
                        {money(c.saldo)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </MarcoTabla>

          {cuentas.length > 100 && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Se muestran las 100 más vencidas de {cuentas.length}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default AgingPanel
