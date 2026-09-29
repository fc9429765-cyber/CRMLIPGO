// Fase 3: aplicacion de recaudos a facturas (REC-14..18, criterio 5).

import { describe, expect, it } from "vitest"
import {
  distribuirPago, ordenarParaAplicar, validarAplicacionManual, type FacturaAplicable,
} from "@/lib/crm-cartera-aplicacion"

const f = (id: number, venc: string, saldo: number, doc = "2026-08-01", numero = `FE-${id}`): FacturaAplicable => ({
  id, numero, fecha_documento: doc, fecha_vencimiento: venc, saldo,
})

describe("aplicacion automatica: la mas vencida primero", () => {
  it("criterio 5: $15M sobre dos facturas de $10M → 10M y 5M a la mas vencida primero", () => {
    // La factura 2 vence antes aunque venga despues en la lista.
    const d = distribuirPago(15_000_000, [f(1, "2026-09-30", 10_000_000), f(2, "2026-09-10", 10_000_000)])
    expect(d.aplicaciones).toEqual([
      expect.objectContaining({ cuenta_cobrar_id: 2, valor_aplicado: 10_000_000, saldo_posterior: 0, orden: 1 }),
      expect.objectContaining({ cuenta_cobrar_id: 1, valor_aplicado: 5_000_000, saldo_posterior: 5_000_000, orden: 2 }),
    ])
    expect(d.totalAplicado).toBe(15_000_000)
    expect(d.saldoFavor).toBe(0)
  })

  it("pago parcial: queda todo en la mas vencida", () => {
    const d = distribuirPago(3_000_000, [f(1, "2026-09-30", 10_000_000), f(2, "2026-09-10", 10_000_000)])
    expect(d.aplicaciones).toHaveLength(1)
    expect(d.aplicaciones[0]).toMatchObject({ cuenta_cobrar_id: 2, valor_aplicado: 3_000_000, saldo_posterior: 7_000_000 })
  })

  it("el sobrante queda como saldo a favor (REC-17)", () => {
    const d = distribuirPago(25_000_000, [f(1, "2026-09-30", 10_000_000), f(2, "2026-09-10", 10_000_000)])
    expect(d.totalAplicado).toBe(20_000_000)
    expect(d.saldoFavor).toBe(5_000_000)
  })

  it("sin facturas abiertas, todo es saldo a favor", () => {
    expect(distribuirPago(500_000, [])).toMatchObject({ aplicaciones: [], totalAplicado: 0, saldoFavor: 500_000 })
  })

  it("ignora facturas sin saldo", () => {
    const d = distribuirPago(100, [f(1, "2026-01-01", 0), f(2, "2026-02-01", 100)])
    expect(d.aplicaciones.map((a) => a.cuenta_cobrar_id)).toEqual([2])
  })

  it("empates: a igual vencimiento, la de documento mas antiguo; luego el numero", () => {
    const orden = ordenarParaAplicar([
      f(1, "2026-09-10", 1, "2026-08-20", "FE-20"),
      f(2, "2026-09-10", 1, "2026-08-01", "FE-30"),
      f(3, "2026-09-10", 1, "2026-08-20", "FE-9"),
    ])
    expect(orden.map((x) => x.id)).toEqual([2, 3, 1]) // FE-9 antes que FE-20: orden numerico
  })

  it("no deja residuos de coma flotante", () => {
    const d = distribuirPago(0.3, [f(1, "2026-01-01", 0.1), f(2, "2026-01-02", 0.2)])
    expect(d.aplicaciones.map((a) => a.saldo_posterior)).toEqual([0, 0])
    expect(d.saldoFavor).toBe(0)
  })
})

describe("distribucion manual de Cartera (REC-18)", () => {
  const facturas = [f(1, "2026-09-30", 10_000_000), f(2, "2026-09-10", 10_000_000)]

  it("una distribucion valida no tiene errores", () => {
    expect(validarAplicacionManual(15_000_000, facturas, [
      { cuenta_cobrar_id: 1, valor_aplicado: 10_000_000, valor_descuento: 0 },
      { cuenta_cobrar_id: 2, valor_aplicado: 5_000_000, valor_descuento: 0 },
    ], { permiteDescuento: false })).toEqual([])
  })

  it("no se aplica mas que el saldo de una factura", () => {
    const e = validarAplicacionManual(15_000_000, facturas, [{ cuenta_cobrar_id: 1, valor_aplicado: 12_000_000, valor_descuento: 0 }], { permiteDescuento: false })
    expect(e.join(" ")).toMatch(/más que su saldo/)
  })

  it("no se aplica mas de lo recibido", () => {
    const e = validarAplicacionManual(5_000_000, facturas, [
      { cuenta_cobrar_id: 1, valor_aplicado: 4_000_000, valor_descuento: 0 },
      { cuenta_cobrar_id: 2, valor_aplicado: 4_000_000, valor_descuento: 0 },
    ], { permiteDescuento: false })
    expect(e.join(" ")).toMatch(/más de lo que se recibió/)
  })

  it("el descuento solo lo aplica quien administra descuentos (REC-19)", () => {
    const aplic = [{ cuenta_cobrar_id: 1, valor_aplicado: 9_500_000, valor_descuento: 500_000 }]
    expect(validarAplicacionManual(9_500_000, facturas, aplic, { permiteDescuento: false }).join(" ")).toMatch(/descuentos/)
    expect(validarAplicacionManual(9_500_000, facturas, aplic, { permiteDescuento: true })).toEqual([])
  })

  it("una factura ajena o repetida es error", () => {
    const e = validarAplicacionManual(10, facturas, [
      { cuenta_cobrar_id: 99, valor_aplicado: 1, valor_descuento: 0 },
      { cuenta_cobrar_id: 1, valor_aplicado: 1, valor_descuento: 0 },
      { cuenta_cobrar_id: 1, valor_aplicado: 1, valor_descuento: 0 },
    ], { permiteDescuento: false })
    expect(e.join(" ")).toMatch(/no es de este cliente/)
    expect(e.join(" ")).toMatch(/dos veces/)
  })
})

import { compararConComprobante } from "@/lib/crm-recaudos"

describe("lo digitado frente a lo leido del comprobante (REC-22)", () => {
  const lectura = {
    legible: true, motivo_ilegible: null, es_comprobante: true, valor: 1_500_000, fecha: "2026-09-25",
    banco: "BANCOLOMBIA S.A.", referencia: "000123456", cuenta_destino: null, confianza: 0.95,
  }
  const digitado = { valor: 1_500_000, fecha_documento: "2026-09-25", banco_nombre: "Bancolombia", referencia: "123456" }

  it("si coincide todo, no hay alertas (la referencia recortada cuenta como igual)", () => {
    expect(compararConComprobante(digitado, lectura)).toEqual([])
  })

  it("un cero de mas en el valor se marca", () => {
    const a = compararConComprobante({ ...digitado, valor: 15_000_000 }, lectura)
    expect(a.join(" ")).toMatch(/Valor digitado 15\.000\.000 ≠ valor del comprobante 1\.500\.000/)
  })

  it("fecha, banco y referencia distintos se marcan", () => {
    const a = compararConComprobante({ ...digitado, fecha_documento: "2026-09-20", banco_nombre: "Davivienda", referencia: "999" }, lectura)
    expect(a).toHaveLength(3)
  })

  it("una foto ilegible queda marcada con su motivo", () => {
    const a = compararConComprobante(digitado, { ...lectura, legible: false, motivo_ilegible: "La foto está borrosa", valor: null, fecha: null })
    expect(a.join(" ")).toMatch(/borrosa/)
  })

  it("sin lectura (IA apagada) no hay alertas", () => {
    expect(compararConComprobante(digitado, null)).toEqual([])
  })
})

import { rangoVencimiento } from "@/lib/crm-cartera"

describe("rango de vencimiento (CAR-03)", () => {
  it("clasifica con los cortes por defecto", () => {
    expect([-5, 0, 1, 30, 31, 60, 61, 90, 91].map((d) => rangoVencimiento(d))).toEqual([
      "Al día", "Al día", "1–30", "1–30", "31–60", "31–60", "61–90", "61–90", ">90",
    ])
  })
  it("respeta cortes parametrizados", () => {
    expect(rangoVencimiento(20, [15, 45, 120])).toBe("16–45")
    expect(rangoVencimiento(121, [15, 45, 120])).toBe(">120")
  })
})
