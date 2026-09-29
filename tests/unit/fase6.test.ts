// Fase 6: traduccion de eventos del CRM a documentos SAP B1 (INT-03).

import { describe, expect, it } from "vitest"
import { clave, necesidades, traducir, type ContextoSap } from "@/lib/integraciones/sap/traductor"

const ctx = (codigos: Record<string, string> = {}): ContextoSap => ({
  codigos,
  impuestos: [
    { id: 1, tarifa: 19, nombre: "IVA 19%", sap_codigo: "IVA19" },
    { id: 2, tarifa: 5, nombre: "IVA 5%", sap_codigo: null },
  ],
  medios: { 1: { codigo: "transferencia", nombre: "Transferencia" }, 3: { codigo: "efectivo", nombre: "Efectivo" } },
  cuentas: { 7: { alias: "Bancolombia INDUPAN", sap_cuenta: "11100501" }, 8: { alias: "Sin cuenta", sap_cuenta: null } },
  prefijoCliente: "C",
})

const pedido = {
  pedido: { numero: "CRM-2026-0001", cliente_id: 2629, cliente: "PRUEBA", fecha: "2026-09-29", fecha_programada: "2026-09-30",
    forma_pago: "credito", dias_credito: 30, idpedido_lipgo: 12008, sucursal_id: 1200, vendedor_id: 10, centro_id: 1 },
  lineas: [
    { producto_id: 6, producto: "HARINA", cantidad: 10, precio_unitario: 90000, impuesto_id: 1, impuesto_pct: 19 },
    { producto_id: 6, producto: "HARINA", cantidad: 5, precio_unitario: 88000, impuesto_id: 1, impuesto_pct: 19 },
  ],
}

describe("pedido → Orders", () => {
  it("sin codigos: dice exactamente que falta, sin repetir", () => {
    const t = traducir("crear_pedido", pedido, ctx())
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.faltantes).toEqual(["Cliente #2629 PRUEBA sin CardCode", "Producto #6 HARINA sin ItemCode"])
  })

  it("con codigos: documento con el precio aprobado de cada linea (PED-13)", () => {
    const t = traducir("crear_pedido", pedido, ctx({
      [clave("cliente", 2629)]: "C999000111", [clave("producto", 6)]: "HAR-001", [clave("centro", 1)]: "BOG01",
      [clave("vendedor", 10)]: "5", [clave("condicion_pago", 30)]: "2", [clave("sucursal", 1200)]: "PRINCIPAL",
    }))
    expect(t.ok).toBe(true)
    if (!t.ok) return
    expect(t.endpoint).toBe("Orders")
    expect(t.cuerpo).toMatchObject({
      CardCode: "C999000111", NumAtCard: "CRM-2026-0001", DocDueDate: "2026-09-30", SalesPersonCode: 5,
      PaymentGroupCode: 2, ShipToCode: "PRINCIPAL", Comments: "CRM CRM-2026-0001 · LIPgo 12008",
    })
    expect(t.cuerpo.DocumentLines).toEqual([
      { ItemCode: "HAR-001", ItemDescription: "HARINA", Quantity: 10, UnitPrice: 90000, TaxCode: "IVA19", WarehouseCode: "BOG01" },
      { ItemCode: "HAR-001", ItemDescription: "HARINA", Quantity: 5, UnitPrice: 88000, TaxCode: "IVA19", WarehouseCode: "BOG01" },
    ])
    expect(t.avisos).toEqual([])
  })

  it("un impuesto sin codigo SAP bloquea; vendedor y sucursal sin codigo solo avisan", () => {
    const p = { ...pedido, lineas: [{ producto_id: 6, producto: "HARINA", cantidad: 1, precio_unitario: 1, impuesto_id: 2, impuesto_pct: 5 }] }
    const t = traducir("crear_pedido", p, ctx({ [clave("cliente", 2629)]: "C1", [clave("producto", 6)]: "H" }))
    expect(t.ok).toBe(false)
    if (!t.ok) {
      expect(t.faltantes).toEqual(["Impuesto IVA 5% sin código SAP (Maestros → Impuestos)"])
      expect(t.avisos.join(" ")).toMatch(/SalesPersonCode/)
      expect(t.avisos.join(" ")).toMatch(/ShipToCode/)
    }
  })

  it("lista los ids a leer de la base", () => {
    expect(necesidades("crear_pedido", pedido).map((n) => clave(n.entidad, n.id))).toEqual([
      "cliente:2629", "sucursal:1200", "vendedor:10", "centro:1", "condicion_pago:30", "producto:6", "producto:6",
    ])
  })
})

describe("recaudo → IncomingPayments", () => {
  const recaudo = {
    recaudo: { numero: "RC-2026-0001", cliente_id: 2629, fecha: "2026-09-29", valor: 1_000_000, referencia: "123", medio_pago_id: 1, cuenta_destino_id: 7 },
    aplicaciones: [{ cuenta_cobrar_id: 1, numero_factura: "FE-10", valor: 945_000 }],
  }
  it("transferencia a la factura con su DocEntry", () => {
    const t = traducir("crear_recaudo", recaudo, ctx({ [clave("cliente", 2629)]: "C1", [clave("factura", 1)]: "5501" }))
    expect(t.ok).toBe(true)
    if (t.ok) expect(t.cuerpo).toMatchObject({
      CardCode: "C1", TransferSum: 1_000_000, TransferAccount: "11100501", TransferReference: "123",
      PaymentInvoices: [{ DocEntry: 5501, SumApplied: 945_000, InvoiceType: "it_Invoice" }],
    })
  })
  it("efectivo va como CashSum", () => {
    const t = traducir("crear_recaudo", { ...recaudo, recaudo: { ...recaudo.recaudo, medio_pago_id: 3 } },
      ctx({ [clave("cliente", 2629)]: "C1", [clave("factura", 1)]: "5501" }))
    expect(t.ok && t.cuerpo).toMatchObject({ CashSum: 1_000_000, CashAccount: "11100501" })
  })
  it("sin DocEntry de la factura ni cuenta SAP: no se envia", () => {
    const t = traducir("crear_recaudo", { ...recaudo, recaudo: { ...recaudo.recaudo, cuenta_destino_id: 8 } }, ctx({ [clave("cliente", 2629)]: "C1" }))
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.faltantes).toEqual(["Factura FE-10 sin DocEntry de SAP", 'Cuenta destino "Sin cuenta" sin cuenta SAP (Maestros → Cuentas destino)'])
  })
})

describe("cliente → BusinessPartners", () => {
  it("cliente nuevo: CardCode con prefijo y NIT", () => {
    const t = traducir("crear_cliente", { cliente: { id_lipgo: 3000, nit: 900123456, nombre: "PANADERIA X", direccion: "Cra 1", ciudad: "Bogotá", cupo: 5_000_000, dias_credito: 30 } }, ctx())
    expect(t.ok).toBe(true)
    if (t.ok) {
      expect(t.cuerpo).toMatchObject({ CardCode: "C900123456", CardType: "cCustomer", FederalTaxID: "900123456", CreditLimit: 5_000_000 })
      expect(t.avisos[0]).toBe("CardCode nuevo: C900123456")
    }
  })
  it("sin NIT no se crea", () => {
    expect(traducir("crear_cliente", { cliente: { id_lipgo: 1, nombre: "X" } }, ctx()).ok).toBe(false)
  })
})
