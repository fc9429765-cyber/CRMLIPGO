"use client"

// Cuerpo del formulario de venta: lo comparten la cotización (diálogo del
// panel de Cotizaciones) y la venta directa (página propia, pensada para el
// teléfono: PED-01).
//
// EL SERVIDOR CALCULA TODO LO QUE VALE (RNF-05). Este formulario solo arma
// INTENCIONES —cliente, sucursal, centro de despacho, producto, cantidad y
// precio— y muestra en vivo lo que el servidor va a calcular, con las mismas
// funciones puras (calcularDocumento, evaluarCredito). Si algo de aquí no
// coincide con el servidor, manda el servidor: sus errores se muestran tal cual.
//
// Las reglas que se reflejan en pantalla son las de lib/crm-venta-server.ts:
//   - PED-17: un documento, un owner. Por eso el owner se elige ANTES que los
//     productos, y cambiarlo vacía las líneas.
//   - El centro de despacho es uno de los del owner, y cada producto debe
//     existir POR NOMBRE en ese centro (así lo busca LIPgo al cargar).
//   - PED-08: si el cliente tiene catálogo, solo se le ofrece ese catálogo.
//   - PED-11: el impuesto es el de cada producto, no uno global.
//   - PED-10/PED-14: el precio unitario ES el precio. El descuento frente a la
//     lista solo se informa; no hay campo de descuento (lo da solo admin).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle, Building2, Loader2, MapPin, Minus, Plus, Trash2, Truck, User, UserPlus,
} from "lucide-react"
import { getClientesCrm, getProductosCrm, getSucursalesCrm, resolverPrecio } from "@/lib/crm-catalogos-actions"
import { getCatalogoCliente, getCuenta360, type Cuenta360 } from "@/lib/crm-cuenta-actions"
import { listarMaestro } from "@/lib/crm-maestros-actions"
import { getParams } from "@/lib/crm-parametros-actions"
import { getProspectos } from "@/lib/crm-prospectos-actions"
import { PARAM } from "@/lib/crm-parametros"
import { calcularDocumento, calcularLineaDocumento, type LineaCalculable } from "@/lib/crm-calculos"
import { evaluarCredito, type ResultadoCredito } from "@/lib/crm-credito"
import { money, type FormaPago, type NuevaCotizacion, type TipoVenta } from "@/lib/crm-cotizaciones"
import type { ClienteCrm, ProductoCrm, SucursalCrm } from "@/lib/crm-catalogos"
import type { ProspectoConEtapa } from "@/lib/crm-prospectos"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "@/hooks/use-toast"
import { AvisoCredito, ResumenCarteraVenta } from "./cartera-venta"
import { CatalogoVenta } from "./catalogo-venta"

/**
 * Nombres de los centros de LIPgo, SOLO para rotular los ids de
 * `crm_owners.idempresas_despacho`. No decide nada: el centro válido lo dice
 * el owner y lo verifica el servidor. Un id que no esté aquí se muestra como
 * "Centro N".
 */
const CENTROS_DESPACHO: Record<number, string> = {
  1: "Harinera Indupan",
  3: "Cedi Funza",
  4: "Cedi Medellín",
}
const nombreCentro = (id: number) =>
  CENTROS_DESPACHO[id] ? `${CENTROS_DESPACHO[id]} · centro ${id}` : `Centro ${id}`

/** Misma normalización que el servidor usa para buscar el producto en el centro. */
const normNombre = (t: unknown) => String(t ?? "").trim().toUpperCase()
const num = (t: string) => {
  const n = Number(String(t).replace(",", "."))
  return Number.isFinite(n) ? n : 0
}

interface OwnerVenta {
  id: number
  nombre: string
  codigo: string
  color: string | null
  despachos: number[]
}

interface LineaVenta {
  producto: ProductoCrm
  cantidad: string
  precio: string
  /** Lo que dice la lista del cliente (o el precio base). Solo informativo. */
  precioLista: number | null
  /** Si el vendedor tocó el precio, cambiar de cliente no se lo pisa. */
  precioEditado: boolean
}

interface ParamsVenta {
  modoCupo: "sobrecupo" | "bloquear"
  bloquearMora: boolean
  diasMoraBloqueo: number
  mostrarStock: boolean
  topeDescuento: number
  diasCreditoDefault: number
  catalogoRestringido: boolean
}

/** Lo que el formulario entrega a quien pinta los botones. */
export interface EstadoEnvio {
  /** La intención lista para el servidor, o null si aún falta algo. */
  entrada: NuevaCotizacion | null
  /** Lo primero que falta para poder guardar, dicho para el vendedor. */
  pendiente: string | null
  /** El crédito impide enviar (cliente bloqueado o modo bloquear). */
  bloqueoCredito: boolean
  credito: ResultadoCredito | null
  total: number
}

export function FormularioVenta({
  empresaId,
  modo,
  pie,
  inicial,
}: {
  empresaId: number
  /** Destinatario ya elegido al llegar desde otro módulo (lib/crm-navegacion). */
  inicial?: { clienteId?: number | null; prospectoId?: number | null }
  /** "cotizacion" admite prospectos y sucursal opcional; "directa" genera pedido. */
  modo: TipoVenta
  /** Botones de acción. Se pintan en la barra fija de abajo, al alcance del pulgar. */
  pie: (estado: EstadoEnvio) => ReactNode
}) {
  const esPedido = modo === "directa"

  // ------------------------------------------------------------ Datos base
  const [cargando, setCargando] = useState(true)
  const [clientes, setClientes] = useState<ClienteCrm[]>([])
  const [prospectos, setProspectos] = useState<ProspectoConEtapa[]>([])
  const [productos, setProductos] = useState<ProductoCrm[]>([])
  const [owners, setOwners] = useState<OwnerVenta[]>([])
  const [consultadoEn, setConsultadoEn] = useState<Date | null>(null)
  const [params, setParams] = useState<ParamsVenta>({
    modoCupo: "sobrecupo", bloquearMora: false, diasMoraBloqueo: 15, mostrarStock: false,
    topeDescuento: 10, diasCreditoDefault: 30, catalogoRestringido: false,
  })

  // ------------------------------------------------------------ Destinatario
  const [tipoDestino, setTipoDestino] = useState<"cliente" | "prospecto">(
    inicial?.prospectoId && modo === "cotizacion" ? "prospecto" : "cliente",
  )
  const [clienteId, setClienteId] = useState<number | null>(inicial?.clienteId ?? null)
  const [prospectoId, setProspectoId] = useState<number | null>(modo === "cotizacion" ? inicial?.prospectoId ?? null : null)
  const [buscadorAbierto, setBuscadorAbierto] = useState(false)

  const [cuenta, setCuenta] = useState<Cuenta360 | null>(null)
  const [errorCuenta, setErrorCuenta] = useState<string | null>(null)
  const [cargandoCliente, setCargandoCliente] = useState(false)
  const [catalogo, setCatalogo] = useState<number[]>([])
  const [sucursales, setSucursales] = useState<SucursalCrm[]>([])
  const [bodegaId, setBodegaId] = useState<string>("")

  // ------------------------------------------------------------ Pedido
  const [ownerId, setOwnerId] = useState<number | null>(null)
  const [centro, setCentro] = useState<number | null>(null)
  const [lineas, setLineas] = useState<LineaVenta[]>([])
  const [formaPago, setFormaPago] = useState<FormaPago>("contado")
  const [diasCredito, setDiasCredito] = useState("30")
  const [observaciones, setObservaciones] = useState("")

  useEffect(() => {
    let vivo = true
    Promise.all([
      getClientesCrm(empresaId),
      // Todos los owners: el filtro por owner y centro se hace aquí, con el
      // owner que elija el vendedor.
      getProductosCrm(empresaId, false, true),
      listarMaestro("owners", empresaId),
      getParams(
        [
          PARAM.CREDITO_MODO_CUPO, PARAM.CARTERA_BLOQUEAR_MORA, PARAM.CARTERA_DIAS_MORA_BLOQUEO,
          PARAM.INVENTARIO_MOSTRAR, PARAM.DESCUENTO_MAXIMO_VENDEDOR, PARAM.CREDITO_DIAS_DEFAULT,
          PARAM.CATALOGO_MODO,
        ],
        empresaId,
      ),
      modo === "cotizacion" ? getProspectos(empresaId) : Promise.resolve(null),
    ]).then(([cRes, pRes, oRes, p, prRes]) => {
      if (!vivo) return
      if (cRes.success) setClientes(cRes.data ?? [])
      if (pRes.success) {
        setProductos(pRes.data ?? [])
        setConsultadoEn(new Date())
      } else {
        toast({ title: "No se cargaron los productos", description: pRes.error, variant: "destructive" })
      }
      if (prRes?.success) setProspectos(prRes.data ?? [])

      const activos: OwnerVenta[] = (oRes.success ? oRes.data ?? [] : [])
        .filter((o) => o.activo !== false)
        .map((o) => {
          const desp = Array.isArray(o.idempresas_despacho) ? (o.idempresas_despacho as unknown[]).map(Number) : []
          return {
            id: o.id,
            nombre: String(o.nombre ?? `Owner ${o.id}`),
            codigo: String(o.codigo ?? ""),
            color: (o.color as string | null) ?? null,
            // Igual que el servidor: sin centros configurados, despacha desde
            // su centro de LIPgo.
            despachos: desp.length ? desp : [Number(o.idempresa_lipgo)].filter((n) => n > 0),
          }
        })
      setOwners(activos)
      // Con un solo owner no hay nada que elegir.
      if (activos.length === 1) {
        setOwnerId(activos[0].id)
        setCentro(activos[0].despachos[0] ?? null)
      }

      const diasDef = Number(p[PARAM.CREDITO_DIAS_DEFAULT])
      setParams({
        modoCupo: p[PARAM.CREDITO_MODO_CUPO] === "bloquear" ? "bloquear" : "sobrecupo",
        bloquearMora: String(p[PARAM.CARTERA_BLOQUEAR_MORA]).toLowerCase() === "true",
        diasMoraBloqueo: Number(p[PARAM.CARTERA_DIAS_MORA_BLOQUEO]) || 15,
        mostrarStock: String(p[PARAM.INVENTARIO_MOSTRAR]).toLowerCase() === "true",
        topeDescuento: Number.isFinite(Number(p[PARAM.DESCUENTO_MAXIMO_VENDEDOR]))
          ? Number(p[PARAM.DESCUENTO_MAXIMO_VENDEDOR]) : 10,
        diasCreditoDefault: Number.isFinite(diasDef) ? diasDef : 30,
        catalogoRestringido: p[PARAM.CATALOGO_MODO] === "restringido",
      })
      if (Number.isFinite(diasDef)) setDiasCredito(String(diasDef))
      setCargando(false)
    })
    return () => { vivo = false }
  }, [empresaId, modo])

  const cliente = useMemo(() => clientes.find((c) => c.id === clienteId) ?? null, [clientes, clienteId])
  const prospecto = useMemo(() => prospectos.find((p) => p.id === prospectoId) ?? null, [prospectos, prospectoId])
  const listaId = cliente?.lista_precio_id ?? null

  // ------------------------------------------------------------ Precio
  // Propone el precio de la lista del cliente (PED-10). Si el vendedor ya lo
  // cambió a mano, solo se actualiza la referencia de lista, no su precio.
  const proponerPrecio = useCallback(
    async (productoId: number, lista: number | null) => {
      const res = await resolverPrecio(productoId, lista, empresaId)
      if (!res.success || !(Number(res.data) > 0)) return
      const valor = Number(res.data)
      setLineas((prev) =>
        prev.map((l) =>
          l.producto.id === productoId
            ? { ...l, precioLista: valor, precio: l.precioEditado ? l.precio : String(valor) }
            : l,
        ),
      )
    },
    [empresaId],
  )

  // ------------------------------------------------------------ Cliente
  // Al elegir cliente, LO PRIMERO es su cartera (PED-03); luego catálogo y
  // sucursales, que condicionan qué se le puede vender y dónde se entrega.
  useEffect(() => {
    setCuenta(null)
    setErrorCuenta(null)
    setCatalogo([])
    setSucursales([])
    setBodegaId("")
    if (!clienteId) return

    let vivo = true
    setCargandoCliente(true)
    Promise.all([
      getCuenta360(clienteId, empresaId),
      getCatalogoCliente(clienteId, empresaId),
      getSucursalesCrm(empresaId, clienteId),
    ]).then(([cRes, catRes, sucRes]) => {
      if (!vivo) return
      if (cRes.success && cRes.data) {
        setCuenta(cRes.data)
        // Los días de crédito por defecto son los del cliente, no los de la empresa.
        if (cRes.data.cliente.dias_credito > 0) setDiasCredito(String(cRes.data.cliente.dias_credito))
      } else {
        setErrorCuenta(cRes.error ?? "No se pudo consultar la cartera")
      }
      setCatalogo(catRes.success ? catRes.data ?? [] : [])
      const activas = (sucRes.success ? sucRes.data ?? [] : []).filter((s) => s.activo)
      setSucursales(activas)
      if (activas.length === 1) setBodegaId(String(activas[0].idbodega))
      setCargandoCliente(false)
    })
    return () => { vivo = false }
  }, [clienteId, empresaId])

  // Otro cliente puede tener otra lista: se vuelve a consultar el precio de
  // cada línea (proponerPrecio respeta los que el vendedor ya tocó). Solo debe
  // correr al cambiar la lista, no en cada tecla: por eso `lineas` no está en
  // las dependencias.
  useEffect(() => {
    lineas.forEach((l) => proponerPrecio(l.producto.id, listaId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaId])

  const cambiarDestino = (t: "cliente" | "prospecto") => {
    setTipoDestino(t)
    setClienteId(null)
    setProspectoId(null)
  }

  // ------------------------------------------------------------ Owner y centro
  const owner = owners.find((o) => o.id === ownerId) ?? null

  const elegirOwner = (o: OwnerVenta) => {
    if (o.id === ownerId) return
    if (lineas.length) {
      toast({ title: "Se vaciaron las líneas", description: "Un pedido lleva productos de un solo owner." })
    }
    setOwnerId(o.id)
    setCentro(o.despachos[0] ?? null)
    setLineas([])
  }

  const catalogoSet = useMemo(() => new Set(catalogo), [catalogo])

  const nombresCentro = useMemo(
    () => new Set(productos.filter((p) => p.id_empresa === centro).map((p) => normNombre(p.nombre))),
    [productos, centro],
  )

  // Lo que se puede vender con este owner, centro y cliente. Mismo criterio
  // que prepararDocumento: owner del producto, nombre presente en el centro y
  // catálogo del cliente por id. Si el mismo nombre existe en varias empresas
  // se muestra una sola tarjeta, preferiendo la copia del propio centro; la
  // del catálogo manda cuando el cliente tiene catálogo, porque ese filtro es
  // por id.
  const disponibles = useMemo(() => {
    if (!ownerId || centro == null) return []
    const porNombre = new Map<string, ProductoCrm>()
    for (const p of productos) {
      if (p.owner_id !== ownerId) continue
      const k = normNombre(p.nombre)
      if (!nombresCentro.has(k)) continue
      if (catalogoSet.size && !catalogoSet.has(p.id)) continue
      const previo = porNombre.get(k)
      if (!previo || (previo.id_empresa !== centro && p.id_empresa === centro)) porNombre.set(k, p)
    }
    return [...porNombre.values()]
  }, [productos, ownerId, centro, nombresCentro, catalogoSet])

  const productosPorOwner = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of productos) if (p.owner_id != null) m.set(p.owner_id, (m.get(p.owner_id) ?? 0) + 1)
    return m
  }, [productos])

  // ------------------------------------------------------------ Líneas
  const agregar = (p: ProductoCrm) => {
    const existe = lineas.some((l) => l.producto.id === p.id)
    if (existe) {
      setLineas((prev) =>
        prev.map((l) => (l.producto.id === p.id ? { ...l, cantidad: String(num(l.cantidad) + 1) } : l)),
      )
      return
    }
    setLineas((prev) => [
      ...prev,
      {
        producto: p,
        cantidad: "1",
        precio: p.precio_base != null ? String(p.precio_base) : "",
        precioLista: p.precio_base ?? null,
        precioEditado: false,
      },
    ])
    proponerPrecio(p.id, listaId)
  }

  const cambiarLinea = (id: number, cambio: Partial<LineaVenta>) =>
    setLineas((prev) => prev.map((l) => (l.producto.id === id ? { ...l, ...cambio } : l)))

  const quitar = (id: number) => setLineas((prev) => prev.filter((l) => l.producto.id !== id))

  /** Por qué el servidor rechazaría esta línea, para marcarla antes de enviar. */
  const motivoLinea = (l: LineaVenta): string | null => {
    if (l.producto.owner_id !== ownerId) return "Es de otro owner"
    if (!nombresCentro.has(normNombre(l.producto.nombre))) return "No existe en el centro de despacho elegido"
    if (catalogoSet.size && !catalogoSet.has(l.producto.id)) return "No está en el catálogo del cliente"
    if (!(num(l.cantidad) > 0)) return "Falta la cantidad"
    if (!(num(l.precio) > 0)) return "Falta el precio"
    return null
  }

  const cantidades = useMemo(
    () => new Map(lineas.map((l) => [l.producto.id, num(l.cantidad)])),
    [lineas],
  )

  // ------------------------------------------------------------ Totales
  // Con la misma función que guarda el servidor: el total que ve el vendedor
  // es el que queda en el documento.
  const calculables: LineaCalculable[] = useMemo(
    () =>
      lineas.map((l) => ({
        cantidad: num(l.cantidad),
        precio_unitario: num(l.precio),
        precio_lista: l.precioLista,
        impuesto_pct: l.producto.impuesto_pct ?? 0,
        peso: num(l.cantidad) * (l.producto.peso_unitkg ?? 0),
      })),
    [lineas],
  )
  const totales = useMemo(() => calcularDocumento(calculables), [calculables])

  // ------------------------------------------------------------ Crédito
  const credito = useMemo<ResultadoCredito | null>(() => {
    if (tipoDestino !== "cliente" || !cuenta) return null
    return evaluarCredito({
      formaPago,
      cupo: cuenta.cuenta.cupo,
      saldo: cuenta.cuenta.saldo,
      vencido: cuenta.cuenta.vencido,
      diasMora: cuenta.cuenta.diasMora,
      bloqueado: cuenta.cliente.bloqueado_cartera,
      totalPedido: totales.total,
      modo: params.modoCupo,
      bloquearPorMora: params.bloquearMora,
      diasMoraBloqueo: params.diasMoraBloqueo,
    })
  }, [tipoDestino, cuenta, formaPago, totales.total, params])

  // Una cotización no compromete cupo: el crédito se informa pero no impide
  // guardarla. El pedido sí se detiene.
  const bloqueoCredito = esPedido && credito != null && !credito.permitido

  const sinCatalogoRestringido =
    tipoDestino === "cliente" && !!clienteId && !cargandoCliente && catalogo.length === 0 && params.catalogoRestringido

  // ------------------------------------------------------------ Envío
  const hayLineaMala = lineas.some((l) => motivoLinea(l) != null)

  let pendiente: string | null = null
  if (tipoDestino === "cliente" && !clienteId) pendiente = "Elige el cliente"
  else if (tipoDestino === "prospecto" && !prospectoId) pendiente = "Elige el prospecto"
  else if (cargandoCliente) pendiente = "Consultando el cliente…"
  else if (esPedido && !bodegaId) pendiente = "Elige la sucursal de entrega"
  else if (sinCatalogoRestringido) pendiente = "El cliente no tiene catálogo asignado"
  else if (!ownerId) pendiente = "Elige el owner"
  else if (centro == null) pendiente = "Elige el centro de despacho"
  else if (!lineas.length) pendiente = "Agrega al menos un producto"
  else if (hayLineaMala) pendiente = "Revisa las líneas marcadas"

  const entrada: NuevaCotizacion | null = pendiente
    ? null
    : {
        cliente_id: tipoDestino === "cliente" ? clienteId : null,
        prospecto_id: tipoDestino === "prospecto" ? prospectoId : null,
        bodega_id: tipoDestino === "cliente" && bodegaId ? Number(bodegaId) : null,
        idempresa_despacho: centro,
        tipo_venta: modo,
        forma_pago: formaPago,
        dias_credito: formaPago === "credito" ? Math.max(0, Math.round(num(diasCredito))) : 0,
        lista_precio_id: listaId,
        observaciones: observaciones.trim() || null,
        // Solo intenciones: el servidor pone lista, impuesto, owner y totales.
        lineas: lineas.map((l) => ({
          producto_id: l.producto.id,
          cantidad: num(l.cantidad),
          precio_unitario: num(l.precio),
        })),
      }

  const estado: EstadoEnvio = { entrada, pendiente, bloqueoCredito, credito, total: totales.total }

  // ------------------------------------------------------------ Vista
  if (cargando) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  const hayExceso = calculables.some((c) => calcularLineaDocumento(c).descuento_pct > params.topeDescuento)
  let paso = 0

  return (
    <div className="space-y-5">
      {/* 1. Destinatario y su cartera -------------------------------------- */}
      <Paso n={++paso} titulo={modo === "cotizacion" ? "Para quién" : "Cliente"} icono={User}>
        {modo === "cotizacion" && (
          <SubNav
            vistas={[
              { valor: "cliente" as const, etiqueta: "Cliente", icono: User },
              { valor: "prospecto" as const, etiqueta: "Prospecto", icono: UserPlus, contador: prospectos.length },
            ]}
            activa={tipoDestino}
            onCambiar={cambiarDestino}
          />
        )}

        <Popover open={buscadorAbierto} onOpenChange={setBuscadorAbierto}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="h-10 w-full justify-between font-normal">
              <span className="truncate">
                {tipoDestino === "cliente"
                  ? cliente?.nombre ?? "Buscar cliente…"
                  : prospecto?.razon_social ?? "Buscar prospecto…"}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Escribe para buscar…" />
              <CommandList>
                <CommandEmpty>Ninguno coincide.</CommandEmpty>
                <CommandGroup>
                  {tipoDestino === "cliente"
                    ? clientes.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={`${c.nombre} ${c.documento ?? ""}`}
                          onSelect={() => { setClienteId(c.id); setBuscadorAbierto(false) }}
                        >
                          <span className="truncate">{c.nombre}</span>
                          {c.bloqueado_cartera && (
                            <Badge variant="outline" className="ml-auto border-red-200 bg-red-50 text-[10px] text-red-700">
                              Bloqueado
                            </Badge>
                          )}
                          {!c.bloqueado_cartera && c.lista_precio_nombre && (
                            <Badge variant="outline" className="ml-auto text-[10px]">{c.lista_precio_nombre}</Badge>
                          )}
                        </CommandItem>
                      ))
                    : prospectos.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={`${p.razon_social} ${p.documento ?? ""}`}
                          onSelect={() => { setProspectoId(p.id); setBuscadorAbierto(false) }}
                        >
                          <span className="truncate">{p.razon_social}</span>
                        </CommandItem>
                      ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {cliente && (
          <p className="text-xs text-muted-foreground">
            {cliente.lista_precio_nombre
              ? `Lista: ${cliente.lista_precio_nombre}`
              : "Sin lista asignada: se propone el precio base"}
            {catalogo.length > 0 && ` · Catálogo propio de ${catalogo.length} producto${catalogo.length === 1 ? "" : "s"}`}
          </p>
        )}

        {tipoDestino === "cliente" && clienteId && (
          <>
            <ResumenCarteraVenta cuenta={cuenta} cargando={cargandoCliente} />
            {errorCuenta && (
              <p className="text-xs text-muted-foreground">
                No se pudo consultar la cartera: {errorCuenta}. El servidor la revisará al enviar.
              </p>
            )}
          </>
        )}

        {sinCatalogoRestringido && (
          <Aviso tono="peligro">
            Este cliente no tiene catálogo asignado y la configuración no permite venderle sin él.
            Pide a quien administra listas de precios que se lo asigne.
          </Aviso>
        )}
      </Paso>

      {/* 2. Sucursal de entrega (PED-05) ------------------------------------ */}
      {tipoDestino === "cliente" && (
        <Paso n={++paso} titulo={`Sucursal de entrega${esPedido ? " *" : ""}`} icono={MapPin}>
          {!clienteId ? (
            <p className="text-xs text-muted-foreground">Primero elige el cliente.</p>
          ) : sucursales.length === 0 && !cargandoCliente ? (
            <Aviso tono={esPedido ? "peligro" : "advertencia"}>
              El cliente no tiene sucursales activas.{" "}
              {esPedido ? "Sin sucursal no se puede generar el pedido." : "Hará falta una para convertir la cotización en pedido."}
            </Aviso>
          ) : (
            <>
              <Select value={bodegaId} onValueChange={setBodegaId} disabled={cargandoCliente}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Elige dónde se entrega…" />
                </SelectTrigger>
                <SelectContent>
                  {sucursales.map((s) => (
                    <SelectItem key={s.idbodega} value={String(s.idbodega)}>
                      {s.nombrebodega}
                      {s.ciudad ? ` · ${s.ciudad}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!esPedido && (
                <p className="text-[11px] text-muted-foreground">Opcional en la cotización; obligatoria para convertirla en pedido.</p>
              )}
            </>
          )}
        </Paso>
      )}

      {/* 3. Owner y centro de despacho (PED-17) ----------------------------- */}
      <Paso n={++paso} titulo="Owner y centro de despacho" icono={Truck}>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="radiogroup" aria-label="Owner">
          {owners.map((o) => {
            const activo = o.id === ownerId
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => elegirOwner(o)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-medium transition-colors",
                  activo
                    ? "border-[var(--chart-1)] bg-[var(--chart-1)] text-white"
                    : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full border border-white/60"
                  style={{ backgroundColor: o.color ?? "var(--muted-foreground)" }}
                  aria-hidden="true"
                />
                {o.nombre}
                <span className={cn("tabular-nums text-[10px]", activo ? "text-white/80" : "text-muted-foreground")}>
                  {productosPorOwner.get(o.id) ?? 0}
                </span>
              </button>
            )
          })}
          {owners.length === 0 && (
            <p className="text-xs text-muted-foreground">No hay owners activos. Configúralos en Maestros.</p>
          )}
        </div>

        {owner && (
          <div className="space-y-1.5">
            <Label className="text-xs">Centro de despacho</Label>
            <Select
              value={centro != null ? String(centro) : ""}
              onValueChange={(v) => setCentro(Number(v))}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Elige el centro…" />
              </SelectTrigger>
              <SelectContent>
                {owner.despachos.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    <span className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {nombreCentro(d)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Un pedido lleva productos de un solo owner. Cambiar de owner vacía las líneas.
        </p>
      </Paso>

      {/* 4. Catálogo (PED-06/08/09) ------------------------------------------ */}
      {owner && centro != null && (
        <Paso
          n={++paso}
          titulo="Productos"
          icono={Plus}
          derecha={<span className="text-[11px] text-muted-foreground">{disponibles.length} disponibles</span>}
        >
          <CatalogoVenta
            productos={disponibles}
            cantidades={cantidades}
            mostrarStock={params.mostrarStock}
            centro={centro}
            consultadoEn={consultadoEn}
            onAgregar={agregar}
          />
        </Paso>
      )}

      {/* 5. Líneas (PED-10, PED-11, PED-14) ---------------------------------- */}
      {lineas.length > 0 && (
        <Paso
          n={++paso}
          titulo="Pedido"
          derecha={<span className="text-[11px] text-muted-foreground">{lineas.length} línea{lineas.length === 1 ? "" : "s"}</span>}
        >
          <ul className="divide-y rounded-lg border">
            {lineas.map((l, i) => {
              const c = calcularLineaDocumento(calculables[i])
              const motivo = motivoLinea(l)
              const excede = c.descuento_pct > params.topeDescuento
              return (
                <li key={l.producto.id} className={cn("space-y-2 p-3 text-xs", motivo && "bg-red-50/60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.producto.nombre}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {l.producto.codigo ?? "Sin código"} · IVA {c.impuesto_pct} %
                        {l.precioLista != null && ` · Lista ${money(l.precioLista)}`}
                      </p>
                    </div>
                    <Button
                      type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                      onClick={() => quitar(l.producto.id)}
                      aria-label={`Quitar ${l.producto.nombre}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[auto_1fr_auto]">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Cantidad {l.producto.unidad ? `(${l.producto.unidad})` : ""}</Label>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0"
                          onClick={() => cambiarLinea(l.producto.id, { cantidad: String(Math.max(0, num(l.cantidad) - 1)) })}
                          aria-label="Restar uno"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <Input
                          inputMode="decimal" value={l.cantidad}
                          onChange={(e) => cambiarLinea(l.producto.id, { cantidad: e.target.value })}
                          className="h-9 w-16 text-center text-xs tabular-nums"
                          aria-label="Cantidad"
                        />
                        <Button
                          type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0"
                          onClick={() => cambiarLinea(l.producto.id, { cantidad: String(num(l.cantidad) + 1) })}
                          aria-label="Sumar uno"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Precio unitario</Label>
                      <Input
                        inputMode="decimal" value={l.precio}
                        onChange={(e) => cambiarLinea(l.producto.id, { precio: e.target.value, precioEditado: true })}
                        className={cn("h-9 text-xs tabular-nums", excede && "border-amber-400")}
                        aria-label="Precio unitario"
                      />
                    </div>
                    <div className="col-span-2 space-y-1 text-right sm:col-span-1">
                      <p className="text-[11px] text-muted-foreground">Subtotal</p>
                      <p className="h-9 pt-2 font-semibold tabular-nums">{money(c.subtotal)}</p>
                    </div>
                  </div>

                  {c.descuento_pct > 0 && (
                    <p className={cn("text-[11px]", excede ? "font-medium text-amber-700" : "text-muted-foreground")}>
                      {c.descuento_pct.toLocaleString("es-CO")} % bajo la lista
                      {excede && ` · supera el tope de ${params.topeDescuento} %: quedará marcada para revisión`}
                    </p>
                  )}
                  {motivo && <p className="text-[11px] font-medium text-red-700">{motivo}</p>}
                </li>
              )
            })}
          </ul>

          {hayExceso && (
            <Aviso tono="advertencia">
              Hay precios más de {params.topeDescuento} % por debajo de la lista. Se puede guardar; el documento
              quedará marcado para revisión antes de autorizarse.
            </Aviso>
          )}

          {/* 6. Totales -------------------------------------------------- */}
          <div className="ml-auto w-full space-y-1 text-xs sm:max-w-xs">
            <Fila etiqueta="Subtotal" valor={money(totales.subtotal)} />
            {totales.impuestoPorTarifa.map((t) => (
              <Fila
                key={t.tarifa}
                etiqueta={t.tarifa > 0 ? `IVA ${t.tarifa} %` : "Sin IVA (0 %)"}
                valor={money(t.valor)}
              />
            ))}
            <div className="flex justify-between border-t pt-1.5 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(totales.total)}</span>
            </div>
            {totales.peso > 0 && (
              <Fila etiqueta="Peso" valor={`${totales.peso.toLocaleString("es-CO")} kg`} />
            )}
            {totales.descuento > 0 && (
              <Fila etiqueta="Cedido frente a lista (ya en el precio)" valor={money(totales.descuento)} />
            )}
          </div>
        </Paso>
      )}

      {/* 7-8. Pago, crédito y notas (PED-04) --------------------------------- */}
      <Paso n={++paso} titulo="Pago">
        <div className="grid grid-cols-2 gap-2">
          {(["contado", "credito"] as const).map((f) => (
            <Button
              key={f}
              type="button"
              variant={formaPago === f ? "default" : "outline"}
              className="h-10"
              onClick={() => setFormaPago(f)}
              aria-pressed={formaPago === f}
            >
              {f === "contado" ? "Contado" : "Crédito"}
            </Button>
          ))}
        </div>
        {formaPago === "credito" && (
          <div className="flex items-center gap-2">
            <Label htmlFor="dias-credito" className="text-xs">Días de crédito</Label>
            <Input
              id="dias-credito" inputMode="numeric" value={diasCredito}
              onChange={(e) => setDiasCredito(e.target.value)}
              className="h-9 w-20 text-xs tabular-nums"
            />
          </div>
        )}

        <AvisoCredito resultado={lineas.length || credito?.permitido === false ? credito : null} bloquea={esPedido} />

        <div className="space-y-1.5">
          <Label className="text-xs">Observaciones</Label>
          <Textarea
            rows={2} value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Condiciones de entrega, notas para el cliente…"
            className="text-sm"
          />
        </div>
      </Paso>

      {/* Barra fija: el total y el botón siempre al alcance del pulgar. */}
      <div className="sticky bottom-0 z-10 -mx-1 border-t bg-background/95 px-1 pb-1 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">Total</p>
            <p className="text-base font-semibold tabular-nums leading-tight">{money(totales.total)}</p>
            {pendiente && <p className="truncate text-[11px] text-muted-foreground">{pendiente}</p>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">{pie(estado)}</div>
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- piezas

function Paso({
  n, titulo, icono: Icono, derecha, children,
}: {
  n: number
  titulo: string
  icono?: typeof User
  derecha?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--chart-1)]/10 text-[10px] font-semibold text-[var(--chart-1)]">
            {n}
          </span>
          {Icono && <Icono className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
          {titulo}
        </h3>
        {derecha}
      </div>
      {children}
    </section>
  )
}

function Aviso({ tono, children }: { tono: "advertencia" | "peligro"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-xs",
        tono === "peligro" ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  )
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 text-muted-foreground">
      <span>{etiqueta}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  )
}
