// Fase 4: tablero de cartera (DSH-01, DSH-02).

import { describe, expect, it } from "vitest"
import {
  agruparCartera, etiquetasRango, filtrarPorRango, inicioSerie, recaudoPorMes, resumirCartera, type FacturaTablero,
} from "@/lib/crm-cartera-resumen"

const HOY = "2026-09-28"
const C: [number, number, number] = [30, 60, 90]
const f = (venc: string, saldo: number, extra: Partial<FacturaTablero> = {}): FacturaTablero => ({
  cliente_id: 1, vendedor_id: 10, owner_id: 1, fecha_vencimiento: venc, saldo, estado: "pendiente", ...extra,
})

describe("resumen con rangos", () => {
  const facturas = [
    f("2026-10-10", 100),            // al dia
    f("2026-09-28", 50),             // vence hoy: al dia
    f("2026-09-18", 200),            // 10 dias → 1–30
    f("2026-08-20", 300),            // 39 → 31–60
    f("2026-07-20", 400),            // 70 → 61–90
    f("2026-05-01", 500),            // >90
    f("2026-01-01", 999, { estado: "pagada" }), // no cuenta
  ]
  const r = resumirCartera(facturas, HOY, C, 2000, 25)

  it("reparte por rango con sus etiquetas, incluidos los vacios", () => {
    expect(r.rangos.map((t) => [t.etiqueta, t.cantidad, t.valor])).toEqual([
      ["Al día", 2, 150], ["1–30", 1, 200], ["31–60", 1, 300], ["61–90", 1, 400], [">90", 1, 500],
    ])
  })

  it("cuadra con calcularCuenta: la suma de rangos es el saldo, y el vencido excluye el al dia", () => {
    expect(r.rangos.reduce((s, t) => s + t.valor, 0)).toBe(r.cuenta.saldo)
    expect(r.cuenta.saldo).toBe(1550)
    expect(r.cuenta.vencido).toBe(1400)
    expect(r.cuenta.alDia).toBe(150)
    expect(r.cuenta.disponible).toBe(450)
    expect(r.cuenta.saldoFavor).toBe(25)
    expect(r.cuenta.diasMora).toBe(150)
  })

  it("los cortes parametrizados cambian la clasificacion", () => {
    expect(etiquetasRango([15, 45, 120])).toEqual(["Al día", "1–15", "16–45", "46–120", ">120"])
    const r2 = resumirCartera(facturas, HOY, [15, 45, 120])
    expect(r2.rangos.map((t) => t.cantidad)).toEqual([2, 1, 1, 1, 1])
  })

  it("filtra por rango", () => {
    expect(filtrarPorRango(facturas, "31–60", HOY, C).map((x) => x.saldo)).toEqual([300])
    expect(filtrarPorRango(facturas, null, HOY, C)).toHaveLength(facturas.length)
  })
})

describe("agrupado (DSH-02)", () => {
  it("por vendedor, con el de mas vencido primero", () => {
    const g = agruparCartera([
      f("2026-10-10", 1000, { vendedor_id: 1 }),
      f("2026-08-01", 100, { vendedor_id: 2 }),
      f("2026-08-01", 50, { vendedor_id: null }),
    ], (x) => x.vendedor_id, HOY, C)
    expect(g.map((x) => x.id)).toEqual([2, null, 1])
    expect(g[2].resumen.cuenta.vencido).toBe(0)
  })
})

describe("recaudo por mes", () => {
  it("12 meses con ceros donde no hubo recaudo, incluido el actual", () => {
    const s = recaudoPorMes([
      { fecha: "2026-09-02", valor: 100 }, { fecha: "2026-09-30", valor: 50 },
      { fecha: "2025-10-15", valor: 7 }, { fecha: "2025-09-30", valor: 999 }, // fuera de la ventana
    ], HOY)
    expect(s).toHaveLength(12)
    expect(s[0]).toEqual({ mes: "2025-10", etiqueta: "oct 25", valor: 7 })
    expect(s[11]).toEqual({ mes: "2026-09", etiqueta: "sep 26", valor: 150 })
    expect(s.filter((x) => x.valor === 0)).toHaveLength(10)
  })
  it("cruza el cambio de año", () => {
    expect(inicioSerie("2026-02-10", 12)).toBe("2025-03-01")
    expect(recaudoPorMes([], "2026-02-10", 3).map((x) => x.mes)).toEqual(["2025-12", "2026-01", "2026-02"])
  })
})
