"use client"

// Edición de un pedido en borrador o rechazado (PED-21).
//
// Solo se corrige lo que un vendedor puede corregir: sucursal, condiciones de
// pago, fecha, orden de compra, observaciones y las líneas. El cliente no se
// cambia: un pedido para otro cliente es otro pedido.
//
// Los productos que se pueden añadir son los del MISMO owner y el MISMO centro
// de despacho del pedido (PED-17): un pedido de INDUPAN con una línea de
// Molinos no se puede programar en LIPgo, y es mejor no ofrecerlo que dejar
// que el servidor lo rechace al guardar.
//
// Totales e impuestos NO se calculan aquí: el servidor recalcula cada línea
// con las mismas reglas que al crear el pedido. Lo que se ve en esta pantalla
// es una estimación para orientarse.

import { useEffect, useMemo, useState } from "react"
import { Check, ChevronsUpDown, Loader2, Pencil, Save, Trash2, X } from "lucide-react"
import { editarPedido, type CambiosPedido } from "@/lib/crm-pedidos-actions"
import { money, type PedidoConDetalle } from "@/lib/crm-pedidos"
import { getClienteCrm, getProductosCrm, getSucursalesCrm, resolverPrecio } from "@/lib/crm-catalogos-actions"
import type { ProductoCrm, SucursalCrm } from "@/lib/crm-catalogos"
import { DetalleDialog, FuenteDato } from "@/components/crm/ui/detalle-dialog"
import { CabeceraTabla, FilaVacia, MarcoTabla, PieDato, PieResumen, Td, Th } from "@/components/crm/ui/modulo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

// ----------------------------------------------------- selector con búsqueda

/**
 * Selector con búsqueda. Para clientes y productos una lista desplegable
 * plana no sirve: son cientos y hay que poder escribir parte del nombre.
 * Vive aquí porque este archivo es el último de la cadena panel → detalle →
 * edición: el panel lo importa sin crear un ciclo.
 */
export function SelectorBuscable({
  opciones,
  valor,
  onCambiar,
  placeholder,
  vacio,
  permitirVacio = true,
  className,
}: {
  opciones: { id: number; etiqueta: string; extra?: string | null }[]
  valor: number | null
  onCambiar: (id: number | null) => void
  placeholder: string
  vacio: string
  /** Muestra la opción de quitar la selección. */
  permitirVacio?: boolean
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const sel = opciones.find((o) => o.id === valor)
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={abierto}
          className={cn("h-8 w-full justify-between px-2.5 text-xs font-normal", className)}
        >
          <span className={cn("truncate", !sel && "text-muted-foreground")}>{sel?.etiqueta ?? placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Escribe para buscar…" className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs">{vacio}</CommandEmpty>
            <CommandGroup>
              {permitirVacio && sel && (
                <CommandItem
                  value="__quitar__"
                  onSelect={() => {
                    onCambiar(null)
                    setAbierto(false)
                  }}
                  className="text-xs text-muted-foreground"
                >
                  <X className="mr-1.5 h-3.5 w-3.5" /> Quitar selección
                </CommandItem>
              )}
              {opciones.map((o) => (
                <CommandItem
                  key={o.id}
                  // El id va en el valor: dos productos con el mismo nombre
                  // serían, para cmdk, la misma opción.
                  value={`${o.etiqueta} ${o.extra ?? ""} ${o.id}`}
                  onSelect={() => {
                    onCambiar(o.id)
                    setAbierto(false)
                  }}
                  className="text-xs"
                >
                  <Check className={cn("mr-1.5 h-3.5 w-3.5", o.id === valor ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.etiqueta}</span>
                  {o.extra && <span className="ml-auto pl-2 text-[10px] text-muted-foreground">{o.extra}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// -------------------------------------------------------------- diálogo

interface LineaEdicion {
  producto_id: number
  producto_nombre: string
  unidad: string | null
  impuesto_pct: number | null
  cantidad: string
  precio_unitario: string
}

const SIN_SUCURSAL = "ninguna"

const num = (v: string) => Number(String(v).replace(",", "."))

export function PedidoEditarDialog({
  pedido: p,
  empresaId,
  onCerrar,
  onGuardado,
}: {
  pedido: PedidoConDetalle
  empresaId: number
  onCerrar: () => void
  onGuardado: () => void
}) {
  const lineasOriginales = useMemo<LineaEdicion[]>(
    () =>
      (p.lineas ?? [])
        .filter((l) => l.producto_id != null)
        .map((l) => ({
          producto_id: l.producto_id as number,
          producto_nombre: l.producto_nombre,
          unidad: l.unidad,
          impuesto_pct: l.impuesto_pct ?? null,
          cantidad: String(l.cantidad),
          precio_unitario: String(l.precio_unitario),
        })),
    [p.lineas],
  )
  // Una línea sin producto (heredada de la versión anterior) no se puede
  // reenviar: el servidor recalcula por producto. Se avisa en vez de perderla
  // en silencio.
  const lineasSinProducto = (p.lineas ?? []).filter((l) => l.producto_id == null)

  const [bodegaId, setBodegaId] = useState(p.bodega_id ? String(p.bodega_id) : SIN_SUCURSAL)
  const [formaPago, setFormaPago] = useState<"contado" | "credito">(p.forma_pago)
  const [dias, setDias] = useState(String(p.dias_credito ?? 0))
  const [fechaProgramada, setFechaProgramada] = useState(p.fecha_programada?.slice(0, 10) ?? "")
  const [ordenCompra, setOrdenCompra] = useState(p.orden_compra ?? "")
  const [observaciones, setObservaciones] = useState(p.observaciones ?? "")
  const [lineas, setLineas] = useState<LineaEdicion[]>(lineasOriginales)

  const [sucursales, setSucursales] = useState<SucursalCrm[]>([])
  const [productos, setProductos] = useState<ProductoCrm[] | null>(null)
  const [listaPrecio, setListaPrecio] = useState<number | null>(null)
  const [agregando, setAgregando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSucursalesCrm(empresaId, p.cliente_id).then((r) => r.success && setSucursales(r.data ?? []))
    getClienteCrm(p.cliente_id, empresaId).then((r) => r.success && setListaPrecio(r.data?.lista_precio_id ?? null))
    getProductosCrm(empresaId, false, true).then((r) => setProductos(r.success ? r.data ?? [] : []))
  }, [empresaId, p.cliente_id])

  // Mismo owner y mismo centro que el pedido. Si el pedido aún no tiene owner
  // (borrador sin líneas), no se restringe: la primera línea lo fija.
  const disponibles = useMemo(() => {
    const ya = new Set(lineas.map((l) => l.producto_id))
    return (productos ?? []).filter(
      (x) =>
        x.owner_id != null &&
        (p.owner_id == null || x.owner_id === p.owner_id) &&
        (p.idempresa_despacho == null || x.id_empresa === p.idempresa_despacho) &&
        !ya.has(x.id),
    )
  }, [productos, lineas, p.owner_id, p.idempresa_despacho])

  const agregar = async (id: number | null) => {
    const prod = (productos ?? []).find((x) => x.id === id)
    if (!prod) return
    setAgregando(true)
    // El precio de partida es el de la lista del cliente, el mismo que
    // pondría el formulario de venta; el vendedor puede ajustarlo.
    const r = await resolverPrecio(prod.id, listaPrecio, empresaId)
    setAgregando(false)
    const precio = r.success && r.data ? r.data : Number(prod.precio_base) || 0
    setLineas((ls) => [
      ...ls,
      {
        producto_id: prod.id,
        producto_nombre: prod.nombre,
        unidad: prod.unidad,
        impuesto_pct: prod.impuesto_pct ?? null,
        cantidad: "1",
        precio_unitario: String(precio),
      },
    ])
  }

  const cambiarLinea = (i: number, k: "cantidad" | "precio_unitario", v: string) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)))

  const quitarLinea = (i: number) => setLineas((ls) => ls.filter((_, j) => j !== i))

  // Estimación en pantalla. El valor que cuenta es el que devuelve el servidor.
  const estimado = useMemo(() => {
    let subtotal = 0
    let impuesto = 0
    for (const l of lineas) {
      const s = (num(l.cantidad) || 0) * (num(l.precio_unitario) || 0)
      subtotal += s
      impuesto += s * ((l.impuesto_pct ?? 0) / 100)
    }
    return { subtotal, impuesto, total: subtotal + impuesto }
  }, [lineas])

  const lineasCambiaron =
    JSON.stringify(lineas.map((l) => [l.producto_id, num(l.cantidad), num(l.precio_unitario)])) !==
    JSON.stringify(lineasOriginales.map((l) => [l.producto_id, num(l.cantidad), num(l.precio_unitario)]))

  const invalida = lineas.find((l) => !(num(l.cantidad) > 0) || !(num(l.precio_unitario) > 0))

  const guardar = async () => {
    setError(null)
    if (!lineas.length) return setError("El pedido necesita al menos un producto.")
    if (invalida) return setError(`Revisa «${invalida.producto_nombre}»: cantidad y precio deben ser mayores que cero.`)
    const diasN = formaPago === "credito" ? Math.max(0, Math.round(num(dias) || 0)) : 0

    const cambios: CambiosPedido = {
      bodega_id: bodegaId === SIN_SUCURSAL ? null : Number(bodegaId),
      forma_pago: formaPago,
      dias_credito: diasN,
      fecha_programada: fechaProgramada || null,
      orden_compra: ordenCompra.trim() || null,
      observaciones: observaciones.trim() || null,
    }
    // Las líneas solo viajan si cambiaron: enviarlas reemplaza TODAS y fuerza
    // el recálculo, que no hace falta para cambiar la orden de compra.
    if (lineasCambiaron) {
      cambios.lineas = lineas.map((l) => ({
        producto_id: l.producto_id,
        cantidad: num(l.cantidad),
        precio_unitario: num(l.precio_unitario),
      }))
    }

    setGuardando(true)
    const r = await editarPedido(p.id, cambios, empresaId)
    setGuardando(false)
    if (!r.success) {
      // El mensaje del servidor tal cual: nombra el producto o la regla que
      // falló, y reescribirlo aquí lo volvería genérico.
      setError(r.error ?? "No se pudo guardar el pedido")
      return
    }
    toast({ title: "Pedido guardado", description: r.data ? `Total recalculado: ${money(r.data.total)}` : undefined })
    onGuardado()
  }

  return (
    <DetalleDialog
      abierto
      onCerrar={() => !guardando && onCerrar()}
      icono={Pencil}
      ancho="tabla"
      titulo={`Editar pedido ${p.numero ?? `#${p.id}`}`}
      subtitulo={<>{p.cliente_nombre ?? `Cliente ${p.cliente_id}`}{p.owner_nombre ? ` · ${p.owner_nombre}` : ""}</>}
      pie={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Guardar
          </Button>
        </>
      }
    >
      {p.estado === "rechazado" && p.motivo_rechazo && (
        <div className="rounded-md border border-red-200 bg-red-50/60 p-2.5 text-xs text-red-800">
          <span className="font-semibold">Motivo del rechazo: </span>
          {p.motivo_rechazo}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Sucursal de entrega</Label>
          <Select value={bodegaId} onValueChange={setBodegaId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_SUCURSAL} className="text-xs text-muted-foreground">Sin sucursal</SelectItem>
              {sucursales.map((s) => (
                <SelectItem key={s.idbodega} value={String(s.idbodega)} className="text-xs">
                  {s.nombrebodega}
                  {s.ciudad ? ` · ${s.ciudad}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Forma de pago</Label>
          <Select value={formaPago} onValueChange={(v) => setFormaPago(v as "contado" | "credito")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contado" className="text-xs">Contado</SelectItem>
              <SelectItem value="credito" className="text-xs">Crédito</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Días de crédito</Label>
          <Input
            type="number"
            min={0}
            value={formaPago === "credito" ? dias : "0"}
            onChange={(e) => setDias(e.target.value)}
            disabled={formaPago !== "credito"}
            className="h-8 text-xs tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Fecha programada</Label>
          <DatePickerField value={fechaProgramada} onChange={setFechaProgramada} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Orden de compra</Label>
          <Input value={ordenCompra} onChange={(e) => setOrdenCompra(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Observaciones</Label>
          <Textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={1} className="min-h-8 text-xs" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground">Productos</p>
          <div className="flex w-full items-center gap-2 sm:w-80">
            {agregando || productos === null ? (
              <span className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {productos === null ? "Cargando productos…" : "Consultando precio…"}
              </span>
            ) : (
              <SelectorBuscable
                opciones={disponibles.map((x) => ({ id: x.id, etiqueta: x.nombre, extra: x.codigo }))}
                valor={null}
                onCambiar={agregar}
                permitirVacio={false}
                placeholder="+ Añadir producto"
                vacio="No hay más productos de este owner y centro"
              />
            )}
          </div>
        </div>

        <MarcoTabla alto="max-h-[320px]">
          <Table>
            <TableHeader>
              <CabeceraTabla>
                <Th>Producto</Th>
                <Th align="right" className="w-28">Cantidad</Th>
                <Th align="right" className="w-36">Precio</Th>
                <Th align="right">Imp. %</Th>
                <Th align="right">Subtotal</Th>
                <Th className="w-10"><span className="sr-only">Quitar</span></Th>
              </CabeceraTabla>
            </TableHeader>
            <TableBody>
              {lineas.length === 0 ? (
                <FilaVacia columnas={6} mensaje="Sin productos. Añade al menos uno para poder enviarlo a aprobación." />
              ) : (
                lineas.map((l, i) => {
                  const malo = !(num(l.cantidad) > 0) || !(num(l.precio_unitario) > 0)
                  return (
                    <TableRow key={l.producto_id} className={cn("hover:bg-muted/30", malo && "bg-red-50/50")}>
                      <Td className="max-w-[260px]">
                        <span className="block truncate">{l.producto_nombre}</span>
                        {l.unidad && <span className="text-[10.5px] text-muted-foreground">{l.unidad}</span>}
                      </Td>
                      <Td num>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={l.cantidad}
                          onChange={(e) => cambiarLinea(i, "cantidad", e.target.value)}
                          className="h-7 text-right text-xs tabular-nums"
                          aria-label={`Cantidad de ${l.producto_nombre}`}
                        />
                      </Td>
                      <Td num>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={l.precio_unitario}
                          onChange={(e) => cambiarLinea(i, "precio_unitario", e.target.value)}
                          className="h-7 text-right text-xs tabular-nums"
                          aria-label={`Precio de ${l.producto_nombre}`}
                        />
                      </Td>
                      <Td num>{l.impuesto_pct != null ? `${l.impuesto_pct} %` : "—"}</Td>
                      <Td num>{money((num(l.cantidad) || 0) * (num(l.precio_unitario) || 0))}</Td>
                      <Td>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-700"
                          onClick={() => quitarLinea(i)}
                          aria-label={`Quitar ${l.producto_nombre}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </Td>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </MarcoTabla>

        {lineas.length > 0 && (
          <PieResumen>
            <PieDato etiqueta="Líneas" valor={lineas.length} />
            <PieDato etiqueta="Subtotal estimado" valor={money(estimado.subtotal)} />
            <PieDato etiqueta="Impuesto estimado" valor={money(estimado.impuesto)} />
            <PieDato etiqueta="Total estimado" valor={money(estimado.total)} />
          </PieResumen>
        )}

        {lineasSinProducto.length > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-800">
            {lineasSinProducto.length} línea(s) no están ligadas a un producto del catálogo (
            {lineasSinProducto.map((l) => l.producto_nombre).join(", ")}). Si cambias los productos, esas líneas se
            eliminan: vuelve a añadirlas desde el buscador.
          </p>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-800">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p className="whitespace-pre-wrap break-words">{error}</p>
        </div>
      )}

      <FuenteDato>
        Totales e impuestos se recalculan en el servidor al guardar, con la tarifa de cada producto y las reglas del
        pedido. Las cifras de esta pantalla son una estimación. Solo se ofrecen productos del owner y del centro de
        despacho de este pedido ({p.owner_nombre ?? "sin owner aún"}).
      </FuenteDato>
    </DetalleDialog>
  )
}

export default PedidoEditarDialog
