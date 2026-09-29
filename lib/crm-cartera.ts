// Tipos de cartera y comisiones.
//
// SIN "use server": las funciones viven en crm-cartera-actions.ts.

export type EstadoCuenta = "pendiente" | "parcial" | "pagada" | "anulada" | "incobrable"

export const ESTADO_CUENTA_LABEL: Record<EstadoCuenta, string> = {
  pendiente: "Pendiente",
  parcial: "Abono parcial",
  pagada: "Pagada",
  anulada: "Anulada",
  incobrable: "Incobrable",
}

export interface CuentaPorCobrar {
  id: number
  idempresa: number
  cliente_id: number
  pedido_id: number | null
  idpedido_lipgo: number | null

  numero_factura: string | null
  fecha_factura: string
  fecha_vencimiento: string

  valor_original: number
  valor_abonado: number
  /** GENERADA en la base: valor_original - valor_abonado. No se toca a mano. */
  saldo: number

  estado: EstadoCuenta
  vendedor_id: number | null
  observaciones: string | null
  creado_por: string | null
  creado_en: string

  // Resueltos al leer
  cliente_nombre?: string | null
  pedido_numero?: string | null
}

/** Fila de la vista crm_cartera_aging: ya trae el tramo calculado. */
export interface CuentaConAging extends CuentaPorCobrar {
  dias_vencido: number
  tramo_aging: string
  /** 0 corriente, 1..4 tramos vencidos. Para ordenar sin parsear la etiqueta. */
  tramo_orden: number
}

export interface Pago {
  id: number
  idempresa: number
  cuenta_cobrar_id: number
  fecha_pago: string
  valor: number
  medio_pago: string | null
  referencia: string | null
  soporte_url: string | null
  observacion: string | null
  registrado_por: string | null
  creado_en: string
  // Script 202
  tipo?: "legacy" | "recaudo" | "descuento" | "nota_credito" | "ajuste" | string
  recaudo_id?: number | null
  anulado_en?: string | null
  anulado_por?: string | null
  motivo_anulacion?: string | null
}

export const MEDIOS_PAGO = [
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "cheque", etiqueta: "Cheque" },
  { valor: "consignacion", etiqueta: "Consignación" },
  { valor: "otro", etiqueta: "Otro" },
]

// ------------------------------------------------------------- Comisiones

export type EstadoComision = "pendiente" | "aprobada" | "pagada" | "anulada"
export type MomentoComision = "recaudo" | "despacho" | "autorizacion"
export type AmbitoRegla = "global" | "vendedor" | "categoria" | "producto" | "cliente"

export const ESTADO_COMISION_LABEL: Record<EstadoComision, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  pagada: "Pagada",
  anulada: "Anulada",
}

export interface Comision {
  id: number
  idempresa: number
  vendedor_id: number
  pedido_id: number | null
  cuenta_cobrar_id: number | null
  regla_id: number | null

  periodo: string
  base_calculo: number
  /** CONGELADO al liquidar. Leerlo de la regla vigente reescribiria el pasado. */
  porcentaje: number
  valor: number

  estado: EstadoComision
  liquidado_por: string | null
  liquidado_en: string | null
  observaciones: string | null
  creado_en: string

  vendedor_nombre?: string | null
}

export interface ReglaComision {
  id: number
  idempresa: number
  nombre: string
  ambito: AmbitoRegla
  ambito_valor: string | null
  porcentaje: number
  base: "subtotal" | "total"
  momento: MomentoComision
  monto_minimo: number
  vigente_desde: string
  vigente_hasta: string | null
  /** Ante varias reglas aplicables gana la de mayor prioridad. */
  prioridad: number
  activo: boolean
}

export interface ResumenAging {
  tramos: { etiqueta: string; orden: number; cantidad: number; valor: number }[]
  totalPendiente: number
  totalVencido: number
  cuentas: number
  /** Cuánto de lo pendiente ya está vencido. El número que mira gerencia. */
  porcentajeVencido: number
}

/** Días vencidos con signo: negativo = aún no vence. */
export function diasVencido(fechaVencimiento: string, hoy: string): number {
  const [a1, m1, d1] = hoy.split("-").map(Number)
  const [a2, m2, d2] = fechaVencimiento.split("-").map(Number)
  return Math.round((Date.UTC(a1, m1 - 1, d1) - Date.UTC(a2, m2 - 1, d2)) / 86_400_000)
}

/**
 * Rango de vencimiento de CAR-03: "Al día", "1–30", "31–60", "61–90", ">90".
 * Los cortes salen de los parametros cartera.rango_1/2/3_hasta, asi que
 * cambiarlos reclasifica sin tocar codigo.
 */
export function rangoVencimiento(dias: number, cortes: [number, number, number] = [30, 60, 90]): string {
  const [a, b, c] = cortes
  if (dias <= 0) return "Al día"
  if (dias <= a) return `1–${a}`
  if (dias <= b) return `${a + 1}–${b}`
  if (dias <= c) return `${b + 1}–${c}`
  return `>${c}`
}

export const money = (n: number) =>
  (Number(n) || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  })
