// Fase 2: calculo con impuesto por linea, credito/sobrecupo y maquina de
// estados del pedido. Cubre los criterios 6 (sobrecupo visible y enviable)
// y 9 (rechazo y reenvio) del requerimiento, en su parte de logica.

import { describe, expect, it } from "vitest"
import { calcularDocumento, calcularLineaDocumento, tarifaEfectiva } from "@/lib/crm-calculos"
import { evaluarCredito, type EntradaCredito } from "@/lib/crm-credito"
import {
  estadoTrasFirma, puedeAnular, puedeEditar, puedeFirmar, puedeRechazar, puedeSolicitar, rolesQueFaltan,
  type PedidoParaReglas,
} from "@/lib/crm-pedidos-estado"

describe("calculo de lineas (corrige el doble descuento)", () => {
  it("el precio unitario es el precio: lista 100, precio 90 → se cobra 90, no 81", () => {
    const c = calcularLineaDocumento({ cantidad: 1, precio_unitario: 90, precio_lista: 100, impuesto_pct: 0 })
    expect(c.subtotal).toBe(90)
    expect(c.descuento_valor).toBe(10)
    expect(c.descuento_pct).toBe(10)
  })

  it("el impuesto se calcula sobre el subtotal de la linea con SU tarifa", () => {
    const c = calcularLineaDocumento({ cantidad: 10, precio_unitario: 50_000, precio_lista: 50_000, impuesto_pct: 5 })
    expect(c.subtotal).toBe(500_000)
    expect(c.impuesto_valor).toBe(25_000)
  })

  it("un precio por encima de la lista no genera descuento negativo", () => {
    const c = calcularLineaDocumento({ cantidad: 2, precio_unitario: 120, precio_lista: 100, impuesto_pct: 0 })
    expect(c.descuento_valor).toBe(0)
    expect(c.descuento_pct).toBe(0)
  })

  it("documento con tarifas mezcladas: suma por linea y agrupa por tarifa", () => {
    const t = calcularDocumento([
      { cantidad: 10, precio_unitario: 100_000, precio_lista: 100_000, impuesto_pct: 5, peso: 500 },
      { cantidad: 1, precio_unitario: 200_000, precio_lista: 250_000, impuesto_pct: 19, peso: 10 },
      { cantidad: 3, precio_unitario: 10_000, precio_lista: null, impuesto_pct: 0 },
    ])
    expect(t.subtotal).toBe(1_230_000)
    expect(t.impuesto).toBe(50_000 + 38_000)
    expect(t.total).toBe(1_318_000)
    expect(t.descuento).toBe(50_000)
    expect(t.peso).toBe(510)
    expect(t.impuestoPorTarifa).toEqual([
      { tarifa: 0, base: 30_000, valor: 0 },
      { tarifa: 5, base: 1_000_000, valor: 50_000 },
      { tarifa: 19, base: 200_000, valor: 38_000 },
    ])
  })

  it("tarifa efectiva: la unica si todas son iguales", () => {
    const t = calcularDocumento([{ cantidad: 1, precio_unitario: 100, precio_lista: 100, impuesto_pct: 5 }])
    expect(tarifaEfectiva(t)).toBe(5)
  })
})

describe("credito y sobrecupo (PED-03, PED-04)", () => {
  const base: EntradaCredito = {
    formaPago: "credito", cupo: 10_000_000, saldo: 7_000_000, vencido: 0, diasMora: 0, bloqueado: false,
    totalPedido: 2_000_000, modo: "sobrecupo", bloquearPorMora: true, diasMoraBloqueo: 15,
  }

  it("dentro del cupo: permitido, sin sobrecupo", () => {
    const r = evaluarCredito(base)
    expect(r).toMatchObject({ permitido: true, requiereSobrecupo: false, sobrecupoValor: 0, disponibleDespues: 1_000_000 })
  })

  it("excede el cupo: calcula el sobrecupo EXACTO y deja enviar (criterio 6)", () => {
    const r = evaluarCredito({ ...base, totalPedido: 4_500_000 })
    expect(r.permitido).toBe(true)
    expect(r.requiereSobrecupo).toBe(true)
    expect(r.sobrecupoValor).toBe(1_500_000)
    expect(r.motivos.join(" ")).toContain("Excede el cupo")
  })

  it("en modo bloquear, el mismo sobrecupo no deja enviar", () => {
    expect(evaluarCredito({ ...base, totalPedido: 4_500_000, modo: "bloquear" }).permitido).toBe(false)
  })

  it("justo en el limite no es sobrecupo", () => {
    expect(evaluarCredito({ ...base, totalPedido: 3_000_000 }).requiereSobrecupo).toBe(false)
  })

  it("cliente sin cupo: todo el pedido queda en sobrecupo", () => {
    const r = evaluarCredito({ ...base, cupo: 0, saldo: 0, totalPedido: 800_000 })
    expect(r.sobrecupoValor).toBe(800_000)
    expect(r.permitido).toBe(true)
  })

  it("de contado no consume cupo", () => {
    const r = evaluarCredito({ ...base, formaPago: "contado", totalPedido: 99_000_000 })
    expect(r).toMatchObject({ permitido: true, requiereSobrecupo: false, sobrecupoValor: 0 })
  })

  it("cliente bloqueado por cartera no pasa, ni de contado", () => {
    expect(evaluarCredito({ ...base, bloqueado: true }).permitido).toBe(false)
    expect(evaluarCredito({ ...base, bloqueado: true, formaPago: "contado" }).permitido).toBe(false)
  })

  it("la mora se informa; solo bloquea en modo bloquear", () => {
    const moroso = { ...base, diasMora: 40, vencido: 1_000_000 }
    const r = evaluarCredito(moroso)
    expect(r.permitido).toBe(true)
    expect(r.motivos.join(" ")).toContain("40 días de mora")
    expect(evaluarCredito({ ...moroso, modo: "bloquear" }).permitido).toBe(false)
  })
})

describe("maquina de estados del pedido (PED-18..22)", () => {
  const pendiente = (x: Partial<PedidoParaReglas> = {}): PedidoParaReglas => ({
    estado: "pendiente_cartera", auth_contabilidad_en: null, auth_contabilidad_por: null,
    auth_gerencia_en: null, auth_gerencia_por: null, creado_por: "vendedor1", solicitado_por: "uuid-vendedor",
    idpedido_lipgo: null, ...x,
  })

  it("solo se solicita aprobacion desde borrador o rechazado", () => {
    expect(puedeSolicitar({ estado: "borrador" }).ok).toBe(true)
    expect(puedeSolicitar({ estado: "rechazado" }).ok).toBe(true)
    expect(puedeSolicitar({ estado: "pendiente_cartera" }).ok).toBe(false)
    expect(puedeSolicitar({ estado: "aprobado" }).ok).toBe(false)
  })

  it("un rechazado se puede editar y reenviar (PED-21); uno aprobado no", () => {
    expect(puedeEditar({ estado: "rechazado" }).ok).toBe(true)
    expect(puedeEditar({ estado: "aprobado" }).ok).toBe(false)
  })

  it("secuencial: Gerencia no firma antes que Cartera", () => {
    const r = puedeFirmar(pendiente(), "gerencia", "uuid-gerente", "gerente", "secuencial")
    expect(r.ok).toBe(false)
  })

  it("paralelo: Gerencia puede firmar primero", () => {
    expect(puedeFirmar(pendiente(), "gerencia", "uuid-gerente", "gerente", "paralelo").ok).toBe(true)
  })

  it("la misma persona no da las dos firmas", () => {
    const p = pendiente({ estado: "pendiente_gerencia", auth_contabilidad_en: "2026-09-26", auth_contabilidad_por: "uuid-x" })
    expect(puedeFirmar(p, "gerencia", "uuid-x", "x", "secuencial").ok).toBe(false)
  })

  it("quien creo o envio el pedido no lo aprueba", () => {
    expect(puedeFirmar(pendiente(), "contabilidad", "otro", "vendedor1", "secuencial").ok).toBe(false)
    expect(puedeFirmar(pendiente(), "contabilidad", "uuid-vendedor", "alguien", "secuencial").ok).toBe(false)
  })

  it("un rol no firma dos veces", () => {
    const p = pendiente({ auth_contabilidad_en: "2026-09-26", auth_contabilidad_por: "uuid-c" })
    expect(puedeFirmar(p, "contabilidad", "uuid-c2", "c2", "paralelo").ok).toBe(false)
  })

  it("transiciones: Cartera → pendiente de Gerencia → aprobado", () => {
    expect(estadoTrasFirma({ auth_contabilidad_en: null, auth_gerencia_en: null }, "contabilidad")).toBe("pendiente_gerencia")
    expect(estadoTrasFirma({ auth_contabilidad_en: "x", auth_gerencia_en: null }, "gerencia")).toBe("aprobado")
    // paralelo, Gerencia primero:
    expect(estadoTrasFirma({ auth_contabilidad_en: null, auth_gerencia_en: null }, "gerencia")).toBe("pendiente_cartera")
  })

  it("no se firma un borrador, un rechazado ni un aprobado", () => {
    for (const estado of ["borrador", "rechazado", "aprobado", "programado_lipgo"] as const) {
      expect(puedeFirmar(pendiente({ estado }), "contabilidad", "u", "n", "secuencial").ok).toBe(false)
    }
  })

  it("rechazar solo mientras espera firmas; anular nunca despues de LIPgo", () => {
    expect(puedeRechazar({ estado: "pendiente_gerencia", idpedido_lipgo: null }).ok).toBe(true)
    expect(puedeRechazar({ estado: "aprobado", idpedido_lipgo: null }).ok).toBe(false)
    expect(puedeAnular({ estado: "borrador", idpedido_lipgo: null }).ok).toBe(true)
    expect(puedeAnular({ estado: "programado_lipgo", idpedido_lipgo: 55 }).ok).toBe(false)
  })

  it("bandejas: en secuencial, Gerencia solo ve lo que Cartera ya aprobo", () => {
    expect(rolesQueFaltan(pendiente(), "secuencial")).toEqual(["contabilidad"])
    expect(rolesQueFaltan(pendiente({ estado: "pendiente_gerencia", auth_contabilidad_en: "x" }), "secuencial")).toEqual(["gerencia"])
    expect(rolesQueFaltan(pendiente(), "paralelo")).toEqual(["contabilidad", "gerencia"])
  })
})
