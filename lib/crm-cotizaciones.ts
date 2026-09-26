// Tipos del ciclo de venta: cotizacion y sus lineas.
//
// SIN "use server": las funciones viven en crm-cotizaciones-actions.ts.

export type EstadoCotizacion =
  | "borrador"
  | "enviada"
  | "aceptada"
  | "rechazada"
  | "vencida"
  | "convertida"

export type TipoVenta = "cotizacion" | "directa"
export type FormaPago = "contado" | "credito"

export const ESTADO_COTIZACION_LABEL: Record<EstadoCotizacion, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  convertida: "Convertida en pedido",
}

/** Acento de la tarjeta de KPI y del badge, por estado. */
export const ESTADO_COTIZACION_TONO: Record<EstadoCotizacion, string> = {
  borrador: "neutral",
  enviada: "info",
  aceptada: "success",
  rechazada: "danger",
  vencida: "warning",
  convertida: "primary",
}

export interface Cotizacion {
  id: number
  idempresa: number
  numero: string | null

  prospecto_id: number | null
  cliente_id: number | null
  bodega_id: number | null
  vendedor_id: number | null

  tipo_venta: TipoVenta
  forma_pago: FormaPago
  dias_credito: number
  condicion_pago_id: number | null

  fecha_emision: string
  /** Copiada del parametro AL EMITIR. Cambiar el parametro no mueve las ya
   *  emitidas: su vencimiento es un compromiso con el cliente. */
  vigencia_dias: number
  fecha_vencimiento: string

  estado: EstadoCotizacion

  subtotal: number
  descuento_valor: number
  /** Congelado igual que la vigencia, y por el mismo motivo. */
  iva_pct: number
  iva_valor: number
  total: number
  peso_total: number

  lista_precio_id: number | null
  requiere_autorizacion_descuento: boolean

  pdf_url: string | null
  version: number
  cotizacion_padre_id: number | null

  observaciones: string | null
  motivo_rechazo: string | null
  crm_pedido_id: number | null

  creado_por: string | null
  creado_en: string
  actualizado_en: string
}

export interface LineaCotizacion {
  impuesto_id?: number | null
  impuesto_pct?: number | null
  base_impuesto?: number | null
  impuesto_valor?: number | null
  id?: number
  idempresa?: number
  cotizacion_id?: number
  linea: number

  producto_id: number | null
  producto_nombre: string
  categoria: string | null
  unidad: string | null

  cantidad: number
  /** Lo que dijo la lista de precios antes de que el vendedor lo tocara.
   *  Comparado con precio_unitario dice cuanto descuento dio. */
  precio_lista: number | null
  precio_unitario: number
  descuento_pct: number
  descuento_valor: number
  subtotal: number
  total_linea: number
  peso: number
}

/** Cotizacion con los nombres ya resueltos, como la pide la interfaz. */
export interface CotizacionConDetalle extends Cotizacion {
  cliente_nombre?: string | null
  prospecto_nombre?: string | null
  vendedor_nombre?: string | null
  lineas?: LineaCotizacion[]
}

/**
 * Lo que manda el formulario. Solo INTENCIONES: producto, cantidad y precio
 * por linea. Precio de lista, impuesto, owner y totales los calcula el
 * servidor (lib/crm-venta-server.ts), que es lo unico que se guarda.
 */
export interface NuevaCotizacion {
  prospecto_id?: number | null
  cliente_id?: number | null
  /** Sucursal de entrega (PED-05). Un borrador puede no tenerla; se exige al
   *  enviar el pedido a aprobacion. */
  bodega_id?: number | null
  vendedor_id?: number | null
  /** Centro de LIPgo que despacha. Si no viene, el primero del owner. */
  idempresa_despacho?: number | null
  tipo_venta?: TipoVenta
  forma_pago?: FormaPago
  dias_credito?: number
  condicion_pago_id?: number | null
  lista_precio_id?: number | null
  observaciones?: string | null
  lineas: { producto_id: number; cantidad: number; precio_unitario: number }[]
}

// ---------------------------------------------------------------- Calculo

export interface TotalesCotizacion {
  subtotal: number
  descuento: number
  iva: number
  total: number
  peso: number
}

/**
 * Totales de una cotizacion.
 *
 * DOS COSAS QUE DIFIEREN DE COMO LO HACIA LIPGO, a proposito:
 *
 * 1. El IVA SUMA, no resta. En el formulario de pedidos de LIPgo el "descuento
 *    IVA" se restaba del total, que es al reves de lo que hace un impuesto.
 *    Aqui el IVA se calcula sobre la base ya descontada y se suma.
 *
 * 2. El porcentaje de IVA llega como parametro, no esta escrito en el codigo.
 *    En LIPgo era un 5 literal en el componente.
 */
export function calcularTotales(
  lineas: Pick<LineaCotizacion, "cantidad" | "precio_unitario" | "descuento_pct" | "peso">[],
  ivaPct: number,
): TotalesCotizacion {
  let subtotal = 0
  let descuento = 0
  let peso = 0

  for (const l of lineas) {
    const bruto = (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0)
    const dto = bruto * ((Number(l.descuento_pct) || 0) / 100)
    subtotal += bruto - dto
    descuento += dto
    peso += Number(l.peso) || 0
  }

  const iva = subtotal * (ivaPct / 100)

  return {
    subtotal: redondear(subtotal),
    descuento: redondear(descuento),
    iva: redondear(iva),
    total: redondear(subtotal + iva),
    peso: Math.round(peso * 1000) / 1000,
  }
}

/** Totales de UNA linea, como los guarda la base. */
export function calcularLinea(
  cantidad: number,
  precioUnitario: number,
  descuentoPct: number,
): Pick<LineaCotizacion, "descuento_valor" | "subtotal" | "total_linea"> {
  const bruto = (Number(cantidad) || 0) * (Number(precioUnitario) || 0)
  const dto = bruto * ((Number(descuentoPct) || 0) / 100)
  return {
    descuento_valor: redondear(dto),
    subtotal: redondear(bruto - dto),
    total_linea: redondear(bruto),
  }
}

/** A dos decimales, evitando el arrastre de coma flotante. */
function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Descuento que dio el vendedor frente al precio de lista, en porcentaje. */
export function descuentoSobreLista(precioLista: number | null, precioUnitario: number): number {
  if (!precioLista || precioLista <= 0) return 0
  const dto = ((precioLista - precioUnitario) / precioLista) * 100
  return Math.max(0, Math.round(dto * 100) / 100)
}

/** Una cotizacion vencida no se puede confirmar: hay que reeditarla. */
export function estaVencida(c: Pick<Cotizacion, "fecha_vencimiento" | "estado">, hoyISO: string): boolean {
  if (c.estado === "convertida" || c.estado === "rechazada") return false
  return c.fecha_vencimiento < hoyISO
}

export const money = (n: number) =>
  (Number(n) || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  })
