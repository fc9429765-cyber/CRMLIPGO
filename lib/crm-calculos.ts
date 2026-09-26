// Totales de cotizaciones y pedidos, con impuesto POR LINEA (PED-10..12).
//
// Sin "use server": lo usan el formulario (para mostrar), el servidor (para
// guardar, que es lo que vale: RNF-05) y las pruebas.
//
// CORRECCION DE UN ERROR DE COBRO que tenia la version anterior
// (calcularLinea / calcularTotales en crm-cotizaciones.ts):
// el formulario guardaba en `descuento_pct` cuanto bajo el vendedor el precio
// FRENTE A LA LISTA, y el calculo volvia a descontar ese porcentaje del precio
// ya rebajado. Lista $100, precio $90 → cobraba $81. Aqui el precio unitario
// es EL precio (PED-10: precio personalizado), y el descuento frente a la
// lista es solo informativo: sirve para saber cuanto se cedio, no se resta.

export interface LineaCalculable {
  cantidad: number
  /** Precio final por unidad, el que paga el cliente (antes de impuesto). */
  precio_unitario: number
  /** Precio que decia la lista de precios. Solo informativo. */
  precio_lista: number | null
  /** Tarifa de impuesto de ESTE producto, en %. */
  impuesto_pct: number
  peso?: number
}

export interface LineaCalculada {
  /** cantidad × precio_unitario: base del impuesto. */
  subtotal: number
  /** cantidad × precio de lista (o unitario si no hay lista). */
  total_linea: number
  /** Lo que se cedio frente a la lista (total_linea - subtotal), nunca negativo. */
  descuento_valor: number
  /** Ese mismo descuento en %, para comparar con el tope del vendedor. */
  descuento_pct: number
  base_impuesto: number
  impuesto_pct: number
  impuesto_valor: number
}

export interface TotalesDocumento {
  /** Suma de subtotales: lo que se factura antes de impuestos. */
  subtotal: number
  /** Suma de lo cedido frente a lista. Informativo. */
  descuento: number
  /** Suma de impuestos de las lineas. */
  impuesto: number
  total: number
  peso: number
  /** Impuesto agrupado por tarifa, para mostrar "IVA 5 %: $X · IVA 19 %: $Y". */
  impuestoPorTarifa: { tarifa: number; base: number; valor: number }[]
}

/** A dos decimales, sin arrastre de coma flotante. */
export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function calcularLineaDocumento(l: LineaCalculable): LineaCalculada {
  const cantidad = Number(l.cantidad) || 0
  const precio = Number(l.precio_unitario) || 0
  const lista = l.precio_lista != null && Number(l.precio_lista) > 0 ? Number(l.precio_lista) : precio
  const tarifa = Number(l.impuesto_pct) || 0

  const subtotal = redondear(cantidad * precio)
  const totalLinea = redondear(cantidad * lista)
  const descuento = Math.max(0, redondear(totalLinea - subtotal))
  const impuesto = redondear(subtotal * (tarifa / 100))

  return {
    subtotal,
    total_linea: totalLinea,
    descuento_valor: descuento,
    descuento_pct: lista > 0 ? Math.max(0, Math.round(((lista - precio) / lista) * 10000) / 100) : 0,
    base_impuesto: subtotal,
    impuesto_pct: tarifa,
    impuesto_valor: impuesto,
  }
}

export function calcularDocumento(lineas: LineaCalculable[]): TotalesDocumento {
  let subtotal = 0
  let descuento = 0
  let impuesto = 0
  let peso = 0
  const porTarifa = new Map<number, { base: number; valor: number }>()

  for (const l of lineas) {
    const c = calcularLineaDocumento(l)
    subtotal += c.subtotal
    descuento += c.descuento_valor
    impuesto += c.impuesto_valor
    peso += Number(l.peso) || 0
    const t = porTarifa.get(c.impuesto_pct) ?? { base: 0, valor: 0 }
    t.base += c.base_impuesto
    t.valor += c.impuesto_valor
    porTarifa.set(c.impuesto_pct, t)
  }

  return {
    subtotal: redondear(subtotal),
    descuento: redondear(descuento),
    impuesto: redondear(impuesto),
    total: redondear(subtotal + impuesto),
    peso: Math.round(peso * 1000) / 1000,
    impuestoPorTarifa: [...porTarifa]
      .map(([tarifa, v]) => ({ tarifa, base: redondear(v.base), valor: redondear(v.valor) }))
      .sort((a, b) => a.tarifa - b.tarifa),
  }
}

/**
 * Tarifa de impuesto "del encabezado" para las columnas heredadas iva_pct e
 * iva_valor. Si todas las lineas tienen la misma tarifa, esa; si hay mezcla,
 * la tasa efectiva ponderada. Solo para compatibilidad: la verdad esta en cada
 * linea.
 */
export function tarifaEfectiva(t: Pick<TotalesDocumento, "subtotal" | "impuesto" | "impuestoPorTarifa">): number {
  if (t.impuestoPorTarifa.length === 1) return t.impuestoPorTarifa[0].tarifa
  return t.subtotal > 0 ? Math.round((t.impuesto / t.subtotal) * 100000) / 1000 : 0
}
