// Señales de un cliente: lo que hay que saber ANTES de venderle o cobrarle.
//
// Calculo PURO sobre la Cuenta 360 (misma fuente que ve Cartera). Son reglas
// deterministas, no IA: una señal que diga "tiene $2.000.000 vencidos" tiene
// que ser exacta y salir en el acto, en el teléfono del vendedor frente al
// cliente. El analisis con IA (lib/crm-ia-cliente-actions.ts) se apoya en
// estas señales y añade la lectura; no las reemplaza.

import type { CuentaCliente } from "@/lib/crm-cuenta"
import { diasEntre } from "@/lib/crm-fechas"

export type TonoSenal = "peligro" | "advertencia" | "info" | "exito"

export interface SenalCliente {
  tono: TonoSenal
  texto: string
  detalle?: string
}

export interface DatosSenales {
  cliente: { bloqueado_cartera: boolean; dias_credito: number; cupo_credito: number }
  cuenta: CuentaCliente
  facturas: { fecha_vencimiento: string; saldo: number; estado: string }[]
}

const pesos = (n: number) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO")
const ABIERTOS = new Set(["pendiente", "parcial"])

/** Facturas abiertas que vencen entre hoy y `dias` dias adelante (inclusive). */
export function facturasPorVencer(facturas: DatosSenales["facturas"], hoy: string, dias: number) {
  return facturas.filter((f) => {
    if (!ABIERTOS.has(f.estado) || Number(f.saldo) <= 0) return false
    const faltan = diasEntre(hoy, f.fecha_vencimiento)
    return faltan >= 0 && faltan <= dias
  })
}

/**
 * Señales en orden de importancia: primero lo que impide vender, luego lo que
 * obliga a cobrar, luego lo que conviene saber, y al final la buena noticia.
 * Se devuelven como mucho `maximo` para que quepan en una ficha.
 */
export function senalesCliente(d: DatosSenales, hoy: string, diasAviso = 5, maximo = 5): SenalCliente[] {
  const c = d.cuenta
  const out: SenalCliente[] = []
  const cupo = Number(d.cliente.cupo_credito) || 0

  if (d.cliente.bloqueado_cartera) {
    out.push({ tono: "peligro", texto: "Bloqueado por cartera", detalle: "No se le puede vender a crédito hasta que Cartera lo desbloquee." })
  }
  if (c.vencido > 0) {
    out.push({
      tono: "peligro",
      texto: `${pesos(c.vencido)} vencidos en ${c.facturasVencidas} factura${c.facturasVencidas === 1 ? "" : "s"}`,
      detalle: `${c.diasMora} día${c.diasMora === 1 ? "" : "s"} de mora en la más antigua. Conviene cobrar antes de vender.`,
    })
  }
  if (cupo > 0 && c.disponible < 0) {
    out.push({ tono: "peligro", texto: `Ya está en sobrecupo por ${pesos(-c.disponible)}`, detalle: "Un pedido nuevo a crédito necesitará aprobación con sobrecupo." })
  } else if (cupo > 0 && c.disponible < cupo * 0.2) {
    out.push({ tono: "advertencia", texto: `Le queda poco cupo: ${pesos(c.disponible)}`, detalle: `Usa el ${Math.round((c.saldo / cupo) * 100)} % de ${pesos(cupo)}.` })
  }
  const porVencer = facturasPorVencer(d.facturas, hoy, diasAviso)
  if (porVencer.length) {
    const total = porVencer.reduce((s, f) => s + Number(f.saldo), 0)
    out.push({
      tono: "advertencia",
      texto: `${porVencer.length} factura${porVencer.length === 1 ? "" : "s"} vence${porVencer.length === 1 ? "" : "n"} en los próximos ${diasAviso} días`,
      detalle: `${pesos(total)}. Buen momento para recordarle el pago.`,
    })
  }
  if (c.saldoFavor > 0) {
    out.push({ tono: "info", texto: `Tiene ${pesos(c.saldoFavor)} a favor`, detalle: "Se aplica en el próximo recaudo o se descuenta en la próxima factura." })
  }
  if (cupo === 0 && d.cliente.dias_credito === 0) {
    out.push({ tono: "info", texto: "Cliente de contado", detalle: "Sin cupo ni plazo: los pedidos no generan cartera." })
  }
  if (!out.length || (c.vencido === 0 && c.saldo === 0 && !d.cliente.bloqueado_cartera)) {
    if (c.saldo === 0) out.push({ tono: "exito", texto: "Al día, sin facturas pendientes" })
    else if (c.vencido === 0) out.push({ tono: "exito", texto: `Al día: debe ${pesos(c.saldo)} y nada está vencido` })
  }
  return out.slice(0, maximo)
}

/** Semáforo del cliente: una sola palabra para la lista o el buscador. */
export function semaforoCliente(d: Pick<DatosSenales, "cliente" | "cuenta">): { nivel: "rojo" | "ambar" | "verde"; etiqueta: string } {
  const c = d.cuenta
  if (d.cliente.bloqueado_cartera) return { nivel: "rojo", etiqueta: "Bloqueado" }
  if (c.vencido > 0) return { nivel: "rojo", etiqueta: `Vencido ${c.diasMora} d` }
  if (c.disponible < 0 && d.cliente.cupo_credito > 0) return { nivel: "ambar", etiqueta: "Sobrecupo" }
  if (d.cliente.cupo_credito > 0 && c.disponible < d.cliente.cupo_credito * 0.2) return { nivel: "ambar", etiqueta: "Poco cupo" }
  return { nivel: "verde", etiqueta: "Al día" }
}
