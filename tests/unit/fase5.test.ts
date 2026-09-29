// Fase 5: expediente del prospecto (PRO-01, PRO-02).

import { describe, expect, it } from "vitest"
import {
  evaluarExpediente, nitSinDv, puedeEditarExpediente, type DocumentoExpediente, type TipoDocumento,
} from "@/lib/crm-prospectos-aprobacion"

const tipos: TipoDocumento[] = [
  { id: 1, codigo: "RUT", nombre: "RUT", obligatorio: true, ayuda: null, orden: 1 },
  { id: 2, codigo: "CAMARA", nombre: "Cámara de comercio", obligatorio: true, ayuda: null, orden: 2 },
  { id: 3, codigo: "REF", nombre: "Referencias", obligatorio: false, ayuda: null, orden: 3 },
]
const doc = (id: number, tipo: number, estado: DocumentoExpediente["estado"] = "pendiente"): DocumentoExpediente => ({
  id, tipo_documento_id: tipo, nombre_archivo: "a.pdf", mime: "application/pdf", tamano: 1, estado,
  subido_nombre: "v", subido_en: "2026-09-29T10:00:00Z", nota: null,
})
const datos = {
  razon_social: "Panadería La Espiga SAS", documento: "900.123.456-7", direccion: "Cra 1 # 2-3", ciudad: "Bogotá",
  contacto_nombre: "Ana", contacto_celular: "3001234567", contacto_telefono: null,
}

describe("expediente del prospecto", () => {
  it("completo: listo para enviar", () => {
    const e = evaluarExpediente(tipos, [doc(1, 1), doc(2, 2)], datos)
    expect(e.listo).toBe(true)
    expect(e.checklist.map((c) => c.cumplido)).toEqual([true, true, false])
  })

  it("falta un obligatorio: no se puede enviar; el opcional no cuenta", () => {
    const e = evaluarExpediente(tipos, [doc(1, 1)], datos)
    expect(e.listo).toBe(false)
    expect(e.documentosFaltantes).toEqual(["Cámara de comercio"])
  })

  it("un documento rechazado por Cartera no cuenta: hay que subir otro", () => {
    expect(evaluarExpediente(tipos, [doc(1, 1), doc(2, 2, "rechazado")], datos).documentosFaltantes).toEqual(["Cámara de comercio"])
    expect(evaluarExpediente(tipos, [doc(1, 1), doc(2, 2, "rechazado"), doc(3, 2)], datos).listo).toBe(true)
  })

  it("con documentos no exigidos (parametro), solo cuentan los datos", () => {
    expect(evaluarExpediente(tipos, [], datos, false).listo).toBe(true)
  })

  it("datos minimos para crear el cliente en LIPgo", () => {
    const e = evaluarExpediente(tipos, [doc(1, 1), doc(2, 2)], { ...datos, documento: "12", ciudad: " ", contacto_celular: null })
    expect(e.datosFaltantes).toEqual(["NIT o documento", "Ciudad", "Celular o teléfono"])
    expect(evaluarExpediente(tipos, [doc(1, 1), doc(2, 2)], { ...datos, contacto_celular: null, contacto_telefono: "6011234567" }).listo).toBe(true)
  })

  it("solo se edita en preparacion o rechazado", () => {
    expect(["borrador", "pendiente_aprobacion", "aprobado", "rechazado"].map((e) => puedeEditarExpediente(e as never)))
      .toEqual([true, false, false, true])
  })
})

describe("NIT sin digito de verificacion (como LIPgo)", () => {
  it("quita el DV y los separadores", () => {
    expect(nitSinDv("900.123.456-7")).toBe(900123456)
    expect(nitSinDv("9001234567")).toBe(900123456)
    expect(nitSinDv("80740512")).toBe(80740512)
    expect(nitSinDv("1.020.304.050")).toBe(1020304050) // cedula de 10 digitos que empieza por 1: se deja
    expect(nitSinDv("")).toBeNull()
  })
})
