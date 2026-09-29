// Resumen de cartera para los tableros (DSH-01, DSH-02).
//
// Calculo PURO. Se apoya en calcularCuenta (lib/crm-cuenta.ts) para el
// vencido, la mora y los porcentajes: el tablero, la Cuenta 360 y el
// formulario del pedido tienen que decir lo mismo del mismo cliente, y eso
// solo se garantiza si los tres salen de la misma funcion. Aqui se agrega lo
// que la Cuenta 360 no tenia: la distribucion por rango de vencimiento, los
// agrupados (por cliente, vendedor u owner) y el recaudo por mes.

import { calcularCuenta, type CuentaCliente, type DocumentoCartera } from "@/lib/crm-cuenta"
import { rangoVencimiento } from "@/lib/crm-cartera"
import { diasEntre } from "@/lib/crm-fechas"

export type Cortes = [number, number, number]

export interface FacturaTablero extends DocumentoCartera {
  cliente_id: number
  vendedor_id: number | null
  owner_id: number | null
}

export interface TramoRango {
  /** 0 = al dia, 1..4 = cada vez mas vencido. Ordena y colorea. */
  orden: number
  etiqueta: string
  cantidad: number
  valor: number
}

export interface ResumenCartera {
  cuenta: CuentaCliente
  rangos: TramoRango[]
}

/** Las cinco etiquetas en orden, para que un tramo vacio tambien se vea. */
export function etiquetasRango(cortes: Cortes): string[] {
  const [a, b, c] = cortes
  return ["Al día", `1–${a}`, `${a + 1}–${b}`, `${b + 1}–${c}`, `>${c}`]
}

const ABIERTOS = new Set(["pendiente", "parcial"])
const cent = (n: number) => Math.round(n * 100) / 100

/** Dias de vencida de una factura (negativo = aun no vence). */
export const diasDeFactura = (f: { fecha_vencimiento: string }, hoy: string) => diasEntre(f.fecha_vencimiento, hoy)

/**
 * Resumen de un conjunto de facturas. `cupo` solo tiene sentido para un
 * cliente; para agrupados se pasa 0 y el disponible no se lee.
 */
export function resumirCartera(
  facturas: DocumentoCartera[],
  hoy: string,
  cortes: Cortes,
  cupo = 0,
  saldoFavor = 0,
): ResumenCartera {
  const etiquetas = etiquetasRango(cortes)
  const rangos: TramoRango[] = etiquetas.map((etiqueta, orden) => ({ orden, etiqueta, cantidad: 0, valor: 0 }))
  for (const f of facturas) {
    const s = Number(f.saldo) || 0
    if (!ABIERTOS.has(f.estado) || s <= 0) continue
    const i = etiquetas.indexOf(rangoVencimiento(diasDeFactura(f, hoy), cortes))
    rangos[i].cantidad++
    rangos[i].valor = cent(rangos[i].valor + s)
  }
  return { cuenta: calcularCuenta(facturas, cupo, hoy, saldoFavor), rangos }
}

/** Filtra por un rango ("Al día", "1–30"…). Sin rango, todas. */
export function filtrarPorRango<T extends FacturaTablero>(facturas: T[], rango: string | null | undefined, hoy: string, cortes: Cortes): T[] {
  if (!rango) return facturas
  return facturas.filter((f) => rangoVencimiento(diasDeFactura(f, hoy), cortes) === rango)
}

/** Agrupa y resume. Los grupos salen ordenados por vencido y luego por saldo. */
export function agruparCartera<T extends FacturaTablero>(
  facturas: T[],
  clave: (f: T) => number | null,
  hoy: string,
  cortes: Cortes,
): { id: number | null; resumen: ResumenCartera }[] {
  const grupos = new Map<number | null, T[]>()
  for (const f of facturas) {
    const k = clave(f)
    const g = grupos.get(k)
    if (g) g.push(f)
    else grupos.set(k, [f])
  }
  return [...grupos.entries()]
    .map(([id, fs]) => ({ id, resumen: resumirCartera(fs, hoy, cortes) }))
    .sort((a, b) => b.resumen.cuenta.vencido - a.resumen.cuenta.vencido || b.resumen.cuenta.saldo - a.resumen.cuenta.saldo)
}

export interface MovimientoRecaudo {
  fecha: string
  valor: number
}

export interface RecaudoMes {
  /** "2026-09" */
  mes: string
  /** "sep 26" */
  etiqueta: string
  valor: number
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

/**
 * Recaudo por mes de los ultimos `meses` meses, incluido el actual. Los meses
 * sin recaudo salen en cero: una grafica que se salta meses esconde justo los
 * meses malos.
 */
export function recaudoPorMes(movimientos: MovimientoRecaudo[], hoy: string, meses = 12): RecaudoMes[] {
  const [a, m] = hoy.split("-").map(Number)
  const serie: RecaudoMes[] = []
  for (let i = meses - 1; i >= 0; i--) {
    const t = a * 12 + (m - 1) - i
    const anio = Math.floor(t / 12)
    const mes = (t % 12) + 1
    serie.push({ mes: `${anio}-${String(mes).padStart(2, "0")}`, etiqueta: `${MESES[mes - 1]} ${String(anio).slice(2)}`, valor: 0 })
  }
  const indice = new Map(serie.map((s, i) => [s.mes, i]))
  for (const mv of movimientos) {
    const i = indice.get(String(mv.fecha).slice(0, 7))
    if (i != null) serie[i].valor = cent(serie[i].valor + (Number(mv.valor) || 0))
  }
  return serie
}

/** Primer dia del mes que abre la serie de `meses` meses. */
export function inicioSerie(hoy: string, meses = 12): string {
  const [a, m] = hoy.split("-").map(Number)
  const t = a * 12 + (m - 1) - (meses - 1)
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`
}

/** Tipos de pago que son plata recibida. Descuentos y notas credito bajan el
 *  saldo pero no son recaudo. */
export const TIPOS_RECAUDO = ["recaudo", "legacy", "ajuste"] as const
