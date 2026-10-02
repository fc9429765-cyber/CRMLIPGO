// Señales del cliente: lo que la ficha dice antes de vender o cobrar.

import { describe, expect, it } from "vitest"
import { facturasPorVencer, semaforoCliente, senalesCliente } from "@/lib/crm-senales-cliente"
import { calcularCuenta } from "@/lib/crm-cuenta"

const HOY = "2026-10-02"
const f = (venc: string, saldo: number, estado = "pendiente") => ({ fecha_vencimiento: venc, saldo, estado })
const datos = (facturas: ReturnType<typeof f>[], cupo = 10_000_000, bloqueado = false, favor = 0) => ({
  cliente: { bloqueado_cartera: bloqueado, dias_credito: 30, cupo_credito: cupo },
  cuenta: calcularCuenta(facturas, cupo, HOY, favor),
  facturas,
})

describe("señales del cliente", () => {
  it("al día y sin deuda: una sola señal verde", () => {
    const s = senalesCliente(datos([]), HOY)
    expect(s).toEqual([{ tono: "exito", texto: "Al día, sin facturas pendientes" }])
    expect(semaforoCliente(datos([]))).toEqual({ nivel: "verde", etiqueta: "Al día" })
  })

  it("vencido: primero lo rojo, con el valor y la mora exactos", () => {
    const s = senalesCliente(datos([f("2026-09-20", 2_000_000), f("2026-10-20", 1_000_000)]), HOY)
    expect(s[0].tono).toBe("peligro")
    expect(s[0].texto).toBe("$ 2.000.000 vencidos en 1 factura")
    expect(s[0].detalle).toMatch(/12 días de mora/)
    expect(semaforoCliente(datos([f("2026-09-20", 2_000_000)]))).toEqual({ nivel: "rojo", etiqueta: "Vencido 12 d" })
  })

  it("bloqueado va antes que todo", () => {
    const s = senalesCliente(datos([f("2026-09-20", 100)], 10_000_000, true), HOY)
    expect(s[0].texto).toBe("Bloqueado por cartera")
    expect(s[1].tono).toBe("peligro")
  })

  it("sobrecupo y poco cupo", () => {
    expect(senalesCliente(datos([f("2026-10-30", 12_000_000)]), HOY)[0].texto).toBe("Ya está en sobrecupo por $ 2.000.000")
    const poco = senalesCliente(datos([f("2026-10-30", 9_000_000)]), HOY)
    expect(poco[0].texto).toBe("Le queda poco cupo: $ 1.000.000")
    expect(poco[0].detalle).toMatch(/90 %/)
    expect(semaforoCliente(datos([f("2026-10-30", 9_000_000)])).etiqueta).toBe("Poco cupo")
  })

  it("facturas por vencer en la ventana, sin contar las vencidas ni las pagadas", () => {
    const fs = [f("2026-10-04", 500_000), f("2026-10-07", 300_000), f("2026-10-08", 1), f("2026-09-30", 1), f("2026-10-03", 1, "pagada")]
    expect(facturasPorVencer(fs, HOY, 5).map((x) => x.fecha_vencimiento)).toEqual(["2026-10-04", "2026-10-07"])
    const s = senalesCliente(datos(fs), HOY)
    expect(s.map((x) => x.texto)).toContain("2 facturas vencen en los próximos 5 días")
  })

  it("saldo a favor y cliente de contado se informan", () => {
    expect(senalesCliente(datos([], 10_000_000, false, 55_000), HOY).map((s) => s.texto)).toContain("Tiene $ 55.000 a favor")
    const contado = { cliente: { bloqueado_cartera: false, dias_credito: 0, cupo_credito: 0 }, cuenta: calcularCuenta([], 0, HOY), facturas: [] }
    expect(senalesCliente(contado, HOY).map((s) => s.texto)).toContain("Cliente de contado")
  })

  it("nunca más de lo que cabe en la ficha", () => {
    const s = senalesCliente(datos([f("2026-09-01", 9_900_000), f("2026-10-04", 200_000)], 10_000_000, true, 10), HOY, 5, 3)
    expect(s).toHaveLength(3)
  })
})
