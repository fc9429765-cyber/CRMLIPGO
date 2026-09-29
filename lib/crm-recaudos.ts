// Tipos y reglas puras de los recaudos (REC-01..REC-24).
// Sin "use server": lo usan la interfaz, el servidor y las pruebas.

import type { LecturaComprobante } from "@/lib/integraciones/ocr"

export type EstadoRecaudo = "pendiente_aprobacion" | "aprobado" | "rechazado" | "anulado"

export const ESTADO_RECAUDO_LABEL: Record<EstadoRecaudo, string> = {
  pendiente_aprobacion: "Pendiente de aprobación",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  anulado: "Anulado",
}

export interface Recaudo {
  id: number
  idempresa: number
  numero: string | null
  cliente_id: number
  owner_id: number | null
  vendedor_id: number | null
  fecha_documento: string
  valor: number
  medio_pago_id: number | null
  banco_id: number | null
  cuenta_destino_id: number | null
  referencia: string | null
  observaciones: string | null
  comprobante_id: number | null
  ocr: (LecturaComprobante & { modelo?: string }) | null
  ocr_alertas: string[]
  estado: EstadoRecaudo
  version: number
  registrado_nombre: string | null
  registrado_en: string
  aprobado_nombre: string | null
  aprobado_en: string | null
  rechazado_nombre: string | null
  rechazado_en: string | null
  motivo_rechazo: string | null
  anulado_nombre: string | null
  anulado_en: string | null
  motivo_anulacion: string | null
  total_aplicado: number
  saldo_favor_valor: number
  sap_estado: "no_aplica" | "pendiente" | "enviado" | "error"
  sap_referencia: string | null
}

export interface AplicacionRecaudo {
  id: number
  cuenta_cobrar_id: number
  numero_factura: string | null
  fecha_vencimiento: string | null
  valor_aplicado: number
  valor_descuento: number
  saldo_anterior: number | null
  saldo_posterior: number | null
  orden: number
  modo: "auto" | "manual"
  aplicado: boolean
}

export interface RecaudoConDetalle extends Recaudo {
  cliente_nombre?: string | null
  owner_nombre?: string | null
  vendedor_nombre?: string | null
  medio_pago_nombre?: string | null
  banco_nombre?: string | null
  cuenta_destino_alias?: string | null
  aplicaciones?: AplicacionRecaudo[]
}

/** Lo que el vendedor digito, para comparar con lo que leyo la IA. */
export interface DatosDigitados {
  valor: number
  fecha_documento: string
  banco_nombre?: string | null
  referencia?: string | null
}

const soloAlfanum = (t: string | null | undefined) => String(t ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")

/**
 * Diferencias entre lo digitado y lo leido del comprobante (REC-22).
 *
 * No bloquea: marca el recaudo para que Cartera lo mire con cuidado. Un
 * vendedor que digita 15.000.000 sobre un comprobante de 1.500.000 no debe
 * pasar desapercibido, pero la IA tambien se equivoca, y la ultima palabra es
 * de una persona.
 */
export function compararConComprobante(d: DatosDigitados, l: LecturaComprobante | null): string[] {
  if (!l) return []
  const alertas: string[] = []
  if (!l.legible) alertas.push(`La IA no pudo leer el comprobante: ${l.motivo_ilegible ?? "sin motivo"}`)
  if (!l.es_comprobante) alertas.push("La IA no reconoce la imagen como un comprobante de pago")

  if (l.valor != null && Math.round(l.valor) !== Math.round(d.valor)) {
    alertas.push(
      `Valor digitado ${d.valor.toLocaleString("es-CO")} ≠ valor del comprobante ${l.valor.toLocaleString("es-CO")}`,
    )
  }
  if (l.fecha && l.fecha !== d.fecha_documento) {
    alertas.push(`Fecha digitada ${d.fecha_documento} ≠ fecha del comprobante ${l.fecha}`)
  }
  if (l.referencia && d.referencia) {
    const a = soloAlfanum(l.referencia), b = soloAlfanum(d.referencia)
    // Una referencia puede venir recortada en el comprobante: solo se alerta
    // si ninguna contiene a la otra.
    if (a && b && !a.includes(b) && !b.includes(a)) {
      alertas.push(`Referencia digitada "${d.referencia}" ≠ la del comprobante "${l.referencia}"`)
    }
  }
  if (l.banco && d.banco_nombre) {
    const a = soloAlfanum(l.banco), b = soloAlfanum(d.banco_nombre)
    if (a && b && !a.includes(b) && !b.includes(a)) {
      alertas.push(`Banco elegido "${d.banco_nombre}" ≠ el del comprobante "${l.banco}"`)
    }
  }
  if (l.confianza < 0.6 && l.legible) alertas.push(`Lectura con confianza baja (${Math.round(l.confianza * 100)} %)`)
  return alertas
}
