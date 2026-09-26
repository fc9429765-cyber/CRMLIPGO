// Fase 1: owners, cuenta 360 del cliente e importacion por archivo.

import { describe, expect, it } from "vitest"
import { ownerDelPedido, resolverOwner } from "@/lib/crm-owners"
import { calcularCuenta } from "@/lib/crm-cuenta"
import {
  IMPORTACIONES, candidatosDocumento, leerBooleano, leerFecha, leerFila, leerNumero,
  mapearEncabezados, normalizarEncabezado,
} from "@/lib/crm-importacion"

// Los mismos owners que siembra el script 193.
const OWNERS = [
  { id: 1, alias_producto: ["HARINERA INDUPAN", "INDUPAN"], idempresas_origen: [1, 6], activo: true },
  { id: 2, alias_producto: ["MOLINOS DEL ATLANTICO"], idempresas_origen: [3, 4], activo: true },
]

describe("owner de un producto", () => {
  it("manda el texto de productos.owner, sin importar mayusculas ni espacios", () => {
    expect(resolverOwner({ owner: "HARINERA INDUPAN", id_empresa: 1 }, OWNERS)).toBe(1)
    expect(resolverOwner({ owner: " molinos del atlantico ", id_empresa: 3 }, OWNERS)).toBe(2)
  })

  it("sin texto, decide la empresa donde esta creado", () => {
    expect(resolverOwner({ owner: null, id_empresa: 1 }, OWNERS)).toBe(1)
    expect(resolverOwner({ owner: "", id_empresa: 4 }, OWNERS)).toBe(2)
  })

  it("un texto que no es de ningun owner NO cae a la empresa: no se adivina", () => {
    expect(resolverOwner({ owner: "AVIMOL", id_empresa: 1 }, OWNERS)).toBeNull()
  })

  it("un owner inactivo no se asigna", () => {
    const inactivos = OWNERS.map((o) => ({ ...o, activo: o.id !== 2 }))
    expect(resolverOwner({ owner: "MOLINOS DEL ATLANTICO", id_empresa: 3 }, inactivos)).toBeNull()
  })
})

describe("un pedido pertenece a un solo owner (PED-17)", () => {
  it("todas las lineas del mismo owner", () => {
    expect(ownerDelPedido([1, 1, 1])).toEqual({ ok: true, ownerId: 1 })
  })
  it("mezclar INDUPAN y Molinos se rechaza", () => {
    expect(ownerDelPedido([1, 2]).ok).toBe(false)
  })
  it("una linea sin owner se rechaza", () => {
    expect(ownerDelPedido([1, null]).ok).toBe(false)
  })
})

describe("cuenta del cliente (CTA-01, CTA-04)", () => {
  const hoy = "2026-09-26"
  const docs = [
    { saldo: 1_000_000, fecha_vencimiento: "2026-08-27", estado: "pendiente" }, // 30 dias vencida
    { saldo: 500_000, fecha_vencimiento: "2026-09-20", estado: "parcial" },     // 6 dias vencida
    { saldo: 2_500_000, fecha_vencimiento: "2026-10-15", estado: "pendiente" }, // al dia
    { saldo: 900_000, fecha_vencimiento: "2026-07-01", estado: "pagada" },      // pagada: no cuenta
  ]

  it("suma solo lo abierto y separa vencido de al dia", () => {
    const c = calcularCuenta(docs, 5_000_000, hoy)
    expect(c.saldo).toBe(4_000_000)
    expect(c.vencido).toBe(1_500_000)
    expect(c.alDia).toBe(2_500_000)
    expect(c.disponible).toBe(1_000_000)
  })

  it("los dias de mora son los de la factura mas vencida", () => {
    expect(calcularCuenta(docs, 5_000_000, hoy).diasMora).toBe(30)
  })

  it("los porcentajes de vencido y al dia suman 100", () => {
    const c = calcularCuenta(docs, 5_000_000, hoy)
    expect(c.pctVencido).toBe(37.5)
    expect(c.pctAlDia).toBe(62.5)
  })

  it("el dia del vencimiento todavia esta al dia", () => {
    const c = calcularCuenta([{ saldo: 100, fecha_vencimiento: hoy, estado: "pendiente" }], 0, hoy)
    expect(c.vencido).toBe(0)
    expect(c.diasMora).toBe(0)
  })

  it("el disponible es negativo cuando el cliente ya esta en sobrecupo", () => {
    expect(calcularCuenta(docs, 3_000_000, hoy).disponible).toBe(-1_000_000)
  })

  it("sin deuda, todo en cero", () => {
    const c = calcularCuenta([], 2_000_000, hoy)
    expect(c).toMatchObject({ saldo: 0, vencido: 0, diasMora: 0, pctVencido: 0, pctAlDia: 0, disponible: 2_000_000 })
  })
})

describe("importacion: numeros como vienen de un Excel colombiano", () => {
  it.each([
    ["1.234.567", 1234567],
    ["$ 1.234.567", 1234567],
    ["1.234.567,50", 1234567.5],
    ["1,234,567.50", 1234567.5],
    ["1234567.50", 1234567.5],
    ["1234567", 1234567],
    ["12,5", 12.5],
    ["1.500", 1500],
    [1234567, 1234567],
  ])("%s → %s", (entrada, esperado) => {
    expect(leerNumero(entrada)).toBe(esperado)
  })

  it("lo que no es numero devuelve null", () => {
    expect(leerNumero("abc")).toBeNull()
    expect(leerNumero("")).toBeNull()
  })
})

describe("importacion: fechas", () => {
  it("dia/mes/año, que es como se escribe en Colombia", () => {
    expect(leerFecha("05/09/2026")).toBe("2026-09-05")
    expect(leerFecha("5-9-2026")).toBe("2026-09-05")
  })
  it("ISO", () => {
    expect(leerFecha("2026-09-30")).toBe("2026-09-30")
  })
  it("numero de serie de Excel", () => {
    expect(leerFecha(46291)).toBe("2026-09-26")
  })
  it("rechaza fechas imposibles en vez de correrlas al mes siguiente", () => {
    expect(leerFecha("31/02/2026")).toBeNull()
    expect(leerFecha("2026-13-01")).toBeNull()
  })
})

describe("importacion: encabezados y filas", () => {
  it("reconoce el encabezado con tildes, mayusculas o espacios", () => {
    expect(normalizarEncabezado("  Días de Crédito ")).toBe("dias_de_credito")
    const mapa = mapearEncabezados(["NIT / Documento", "Cupo de Crédito", "columna rara"], IMPORTACIONES.clientes)
    expect(mapa).toEqual({ "NIT / Documento": "documento", "Cupo de Crédito": "cupo_credito" })
  })

  it("lee una fila de saldos iniciales y reporta lo que falta", () => {
    const def = IMPORTACIONES.saldos_iniciales
    const mapa = mapearEncabezados(["NIT del cliente", "Owner", "Saldo pendiente"], def)
    const { valores, errores } = leerFila({ "NIT del cliente": "900.123.456-7", Owner: "INDUPAN", "Saldo pendiente": "1.500.000" }, mapa, def)
    expect(valores.saldo).toBe(1500000)
    expect(errores).toContain("Falta Número de factura")
    expect(errores).toContain("Falta Fecha de vencimiento")
  })

  it("rechaza un vencimiento anterior a la factura", () => {
    const def = IMPORTACIONES.facturas
    const mapa = mapearEncabezados(["pedido", "numero_factura", "fecha_factura", "fecha_vencimiento"], def)
    const { errores } = leerFila(
      { pedido: "CRM-1", numero_factura: "FE-1", fecha_factura: "10/09/2026", fecha_vencimiento: "01/09/2026" }, mapa, def)
    expect(errores).toContain("La fecha de vencimiento es anterior a la de factura")
  })

  it("booleanos en español", () => {
    expect(leerBooleano("Sí")).toBe(true)
    expect(leerBooleano("no")).toBe(false)
    expect(leerBooleano("tal vez")).toBeNull()
  })
})

describe("importacion: NIT con y sin digito de verificacion", () => {
  it("con guion, tambien prueba sin el digito", () => {
    expect(candidatosDocumento("900.123.456-7")).toEqual(["9001234567", "900123456"])
  })
  it("diez digitos de empresa pegados, tambien prueba los nueve primeros", () => {
    expect(candidatosDocumento("9001234567")).toEqual(["9001234567", "900123456"])
  })
  it("una cedula se deja como esta", () => {
    expect(candidatosDocumento("51975721")).toEqual(["51975721"])
    expect(candidatosDocumento(80071127)).toEqual(["80071127"])
  })
  it("vacio no da candidatos", () => {
    expect(candidatosDocumento("")).toEqual([])
  })
})
