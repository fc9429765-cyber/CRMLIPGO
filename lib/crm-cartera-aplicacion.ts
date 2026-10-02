// Aplicacion de un recaudo a las facturas del cliente (REC-14..REC-18).
//
// Logica PURA, probada (RNF-07). La usan el asistente de recaudo (para
// proponer la distribucion mientras el vendedor la ve) y el servidor al
// aprobar (que es la que vale).
//
// REGLA POR DEFECTO (REC-15): se paga primero la factura MAS VENCIDA, es
// decir, la de fecha de vencimiento mas antigua; a igual vencimiento, la de
// fecha de documento mas antigua; y a igual fecha, la de numero menor. Hasta
// agotar el valor. Lo que sobra queda como saldo a favor (REC-17).
//
// Ejemplo del requerimiento (criterio de aceptacion 5):
//   facturas de $10.000.000 y $10.000.000, pago de $15.000.000
//   → la mas vencida queda en 0 y la otra con $5.000.000.
//
// Cartera puede ajustar la distribucion a mano antes de aprobar (REC-18); la
// distribucion manual se valida con `validarAplicacionManual`.

export interface FacturaAplicable {
  id: number
  numero: string | null
  fecha_documento: string
  fecha_vencimiento: string
  saldo: number
}

export interface Aplicacion {
  cuenta_cobrar_id: number
  numero: string | null
  valor_aplicado: number
  /** Descuento concedido sobre la factura. Solo lo aplica quien tiene
   *  crm_descuentos_admin (REC-19); el reparto automatico nunca lo usa. */
  valor_descuento: number
  saldo_anterior: number
  saldo_posterior: number
  orden: number
}

export interface Distribucion {
  aplicaciones: Aplicacion[]
  /** Lo aplicado a facturas. */
  totalAplicado: number
  /** Lo que sobra y queda como saldo a favor del cliente. */
  saldoFavor: number
}

const cent = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100)
const pesos = (c: number) => c / 100

/** Orden de aplicacion: vencimiento, luego documento, luego numero. */
export function ordenarParaAplicar<T extends Pick<FacturaAplicable, "fecha_vencimiento" | "fecha_documento" | "numero" | "id">>(
  facturas: T[],
): T[] {
  return [...facturas].sort(
    (a, b) =>
      a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) ||
      a.fecha_documento.localeCompare(b.fecha_documento) ||
      String(a.numero ?? "").localeCompare(String(b.numero ?? ""), "es", { numeric: true }) ||
      a.id - b.id,
  )
}

/**
 * Reparto automatico. Trabaja en centavos enteros: con decimales de punto
 * flotante, repartir 15.000.000 entre tres facturas puede dejar un saldo de
 * 0,0000001 que nunca cierra la factura.
 */
export function distribuirPago(valor: number, facturas: FacturaAplicable[]): Distribucion {
  let resto = cent(valor)
  const aplicaciones: Aplicacion[] = []

  for (const f of ordenarParaAplicar(facturas.filter((x) => cent(x.saldo) > 0))) {
    if (resto <= 0) break
    const saldo = cent(f.saldo)
    const aplicado = Math.min(saldo, resto)
    resto -= aplicado
    aplicaciones.push({
      cuenta_cobrar_id: f.id,
      numero: f.numero,
      valor_aplicado: pesos(aplicado),
      valor_descuento: 0,
      saldo_anterior: pesos(saldo),
      saldo_posterior: pesos(saldo - aplicado),
      orden: aplicaciones.length + 1,
    })
  }

  return {
    aplicaciones,
    totalAplicado: pesos(cent(valor) - Math.max(resto, 0)),
    saldoFavor: pesos(Math.max(resto, 0)),
  }
}

/**
 * Valida una distribucion hecha a mano (REC-18).
 * Devuelve la lista de errores; vacia = valida.
 */
export function validarAplicacionManual(
  valor: number,
  facturas: FacturaAplicable[],
  aplicaciones: Pick<Aplicacion, "cuenta_cobrar_id" | "valor_aplicado" | "valor_descuento">[],
  opciones: { permiteDescuento: boolean },
): string[] {
  const errores: string[] = []
  const porId = new Map(facturas.map((f) => [f.id, f]))
  const vistas = new Set<number>()
  let total = 0

  for (const a of aplicaciones) {
    const f = porId.get(a.cuenta_cobrar_id)
    const etiqueta = f?.numero ?? `#${a.cuenta_cobrar_id}`
    if (!f) {
      errores.push(`La factura ${etiqueta} no es de este cliente o ya no tiene saldo`)
      continue
    }
    if (vistas.has(a.cuenta_cobrar_id)) errores.push(`La factura ${etiqueta} aparece dos veces`)
    vistas.add(a.cuenta_cobrar_id)

    const aplicado = cent(a.valor_aplicado)
    const descuento = cent(a.valor_descuento ?? 0)
    if (aplicado < 0 || descuento < 0) errores.push(`Valores negativos en ${etiqueta}`)
    if (descuento > 0 && !opciones.permiteDescuento) {
      errores.push("Solo quien administra descuentos puede aplicar un descuento sobre el pago")
    }
    if (aplicado + descuento > cent(f.saldo)) {
      errores.push(`A ${etiqueta} se le aplica más que su saldo`)
    }
    total += aplicado
  }
  if (total > cent(valor)) errores.push("Se aplica más de lo que se recibió")
  return errores
}

/**
 * Reparto ELEGIDO por quien registra el pago: las facturas que el cliente dice
 * que esta pagando, con el valor de cada una. Lo que no se aplica queda como
 * saldo a favor. Quien llama debe validarlo antes con `validarAplicacionManual`.
 */
export function distribucionManual(
  valor: number,
  facturas: FacturaAplicable[],
  elegidas: Pick<Aplicacion, "cuenta_cobrar_id" | "valor_aplicado">[],
): Distribucion {
  const porId = new Map(facturas.map((f) => [f.id, f]))
  const aplicaciones: Aplicacion[] = []
  let total = 0
  for (const e of elegidas) {
    const f = porId.get(e.cuenta_cobrar_id)
    const aplicado = cent(e.valor_aplicado)
    if (!f || aplicado <= 0) continue
    total += aplicado
    aplicaciones.push({
      cuenta_cobrar_id: f.id,
      numero: f.numero,
      valor_aplicado: pesos(aplicado),
      valor_descuento: 0,
      saldo_anterior: f.saldo,
      saldo_posterior: pesos(cent(f.saldo) - aplicado),
      orden: aplicaciones.length + 1,
    })
  }
  return { aplicaciones, totalAplicado: pesos(total), saldoFavor: pesos(Math.max(cent(valor) - total, 0)) }
}
