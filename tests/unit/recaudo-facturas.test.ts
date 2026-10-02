import { describe, expect, it } from "vitest"
import { distribucionManual, validarAplicacionManual, type FacturaAplicable } from "@/lib/crm-cartera-aplicacion"

// Quien registra el pago elige a que facturas va (no siempre a la mas vencida).
const facturas: FacturaAplicable[] = [
  { id: 1, numero: "F-1", fecha_documento: "2026-07-01", fecha_vencimiento: "2026-08-01", saldo: 10_000_000 },
  { id: 2, numero: "F-2", fecha_documento: "2026-08-01", fecha_vencimiento: "2026-09-01", saldo: 4_000_000 },
]

describe("reparto elegido por quien registra el pago", () => {
  it("aplica a la factura elegida aunque no sea la más vencida", () => {
    const d = distribucionManual(4_000_000, facturas, [{ cuenta_cobrar_id: 2, valor_aplicado: 4_000_000 }])
    expect(d.aplicaciones).toHaveLength(1)
    expect(d.aplicaciones[0]).toMatchObject({ cuenta_cobrar_id: 2, valor_aplicado: 4_000_000, saldo_posterior: 0 })
    expect(d.saldoFavor).toBe(0)
  })

  it("lo que no se asigna queda a favor del cliente", () => {
    const d = distribucionManual(5_000_000, facturas, [{ cuenta_cobrar_id: 2, valor_aplicado: 4_000_000 }])
    expect(d.totalAplicado).toBe(4_000_000)
    expect(d.saldoFavor).toBe(1_000_000)
  })

  it("ignora líneas en cero y facturas ajenas", () => {
    const d = distribucionManual(1_000, facturas, [
      { cuenta_cobrar_id: 1, valor_aplicado: 0 },
      { cuenta_cobrar_id: 99, valor_aplicado: 500 },
      { cuenta_cobrar_id: 1, valor_aplicado: 1_000 },
    ])
    expect(d.aplicaciones.map((a) => a.cuenta_cobrar_id)).toEqual([1])
  })

  it("la validación impide aplicar más del pago o más del saldo", () => {
    expect(validarAplicacionManual(1_000, facturas, [{ cuenta_cobrar_id: 2, valor_aplicado: 2_000, valor_descuento: 0 }], { permiteDescuento: false }))
      .toContain("Se aplica más de lo que se recibió")
    expect(validarAplicacionManual(9_000_000, facturas, [{ cuenta_cobrar_id: 2, valor_aplicado: 5_000_000, valor_descuento: 0 }], { permiteDescuento: false })
      .some((e) => e.includes("más que su saldo"))).toBe(true)
  })
})
