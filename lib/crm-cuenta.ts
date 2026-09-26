// Cuenta del cliente: la vista 360 de su credito (CTA-01, CTA-04).
//
// Calculo PURO, sin base de datos: lo usa el servidor para armar la cuenta y
// lo usan las pruebas. Que el disponible, el vencido y los dias de mora salgan
// de una sola funcion es lo que evita que el tablero diga una cosa y el
// formulario del pedido otra.

import { diasEntre } from "@/lib/crm-fechas"

export interface DocumentoCartera {
  saldo: number
  fecha_vencimiento: string
  estado: string
}

export interface CuentaCliente {
  cupo: number
  /** Total adeudado: suma de saldos abiertos. */
  saldo: number
  /** cupo - saldo. Negativo = el cliente ya esta en sobrecupo. */
  disponible: number
  /** Solo lo que ya paso su fecha de vencimiento (CTA-04). */
  vencido: number
  /** Lo que aun no vence. */
  alDia: number
  /** Dias de mora de la factura mas vencida. 0 si nada esta vencido. */
  diasMora: number
  /** % del saldo que esta vencido, y % al dia. Suman 100 si hay saldo. */
  pctVencido: number
  pctAlDia: number
  facturasAbiertas: number
  facturasVencidas: number
  saldoFavor: number
}

/** Estados que siguen debiendo plata. */
const ABIERTOS = new Set(["pendiente", "parcial"])

const redondear = (n: number) => Math.round(n * 100) / 100

/**
 * Calcula la cuenta de un cliente a una fecha.
 *
 * Una factura esta vencida si su fecha de vencimiento es ANTERIOR a hoy: el
 * dia del vencimiento todavia esta al dia. Es la regla que usa la vista de
 * aging, y tienen que coincidir.
 */
export function calcularCuenta(
  documentos: DocumentoCartera[],
  cupo: number,
  hoy: string,
  saldoFavor = 0,
): CuentaCliente {
  let saldo = 0
  let vencido = 0
  let diasMora = 0
  let abiertas = 0
  let vencidas = 0

  for (const d of documentos) {
    if (!ABIERTOS.has(d.estado)) continue
    const s = Number(d.saldo) || 0
    if (s <= 0) continue
    abiertas++
    saldo += s
    const dias = diasEntre(d.fecha_vencimiento, hoy)
    if (dias > 0) {
      vencido += s
      vencidas++
      if (dias > diasMora) diasMora = dias
    }
  }

  saldo = redondear(saldo)
  vencido = redondear(vencido)
  const alDia = redondear(saldo - vencido)
  const pctVencido = saldo > 0 ? Math.round((vencido / saldo) * 1000) / 10 : 0

  return {
    cupo: Number(cupo) || 0,
    saldo,
    disponible: redondear((Number(cupo) || 0) - saldo),
    vencido,
    alDia,
    diasMora,
    pctVencido,
    pctAlDia: saldo > 0 ? Math.round((100 - pctVencido) * 10) / 10 : 0,
    facturasAbiertas: abiertas,
    facturasVencidas: vencidas,
    saldoFavor: redondear(saldoFavor),
  }
}
