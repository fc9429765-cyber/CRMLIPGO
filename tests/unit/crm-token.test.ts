import { beforeAll, describe, expect, it } from "vitest"
import { firmarSesion, validarClaveNueva, verificarSesion } from "@/lib/crm-token"

// Sesion propia del CRM (scripts/209): el token lo firma el CRM con su propio
// secreto; uno ajeno, alterado o vencido no abre nada.
beforeAll(() => {
  process.env.CRM_AUTH_SECRET = "secreto-de-prueba-solo-para-vitest-0123456789"
})

describe("token de sesión", () => {
  it("firma y verifica conservando usuario, sesión y cambio pendiente", async () => {
    const t = await firmarSesion({ sub: "u-1", sid: "s-1", dcc: true })
    expect(await verificarSesion(t)).toEqual({ sub: "u-1", sid: "s-1", dcc: true })
  })

  it("rechaza un token alterado", async () => {
    const t = await firmarSesion({ sub: "u-1", sid: "s-1", dcc: false })
    const [h, p, f] = t.split(".")
    const payload = JSON.parse(Buffer.from(p, "base64url").toString())
    payload.sub = "otro-usuario"
    const falso = [h, Buffer.from(JSON.stringify(payload)).toString("base64url"), f].join(".")
    expect(await verificarSesion(falso)).toBeNull()
  })

  it("rechaza un token firmado con otro secreto (p. ej. el de otra app)", async () => {
    const t = await firmarSesion({ sub: "u-1", sid: "s-1", dcc: false })
    process.env.CRM_AUTH_SECRET = "otro-secreto-distinto-tambien-de-32-caracteres"
    try {
      expect(await verificarSesion(t)).toBeNull()
    } finally {
      process.env.CRM_AUTH_SECRET = "secreto-de-prueba-solo-para-vitest-0123456789"
    }
  })

  it("sin token, basura o un JWT de Supabase devuelve null sin lanzar", async () => {
    expect(await verificarSesion(undefined)).toBeNull()
    expect(await verificarSesion("no-es-un-jwt")).toBeNull()
    expect(await verificarSesion("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma")).toBeNull()
  })
})

describe("reglas de la contraseña", () => {
  it("exige 10 caracteres con letras y números, distinta de la actual", () => {
    expect(validarClaveNueva("corta1")).toMatch(/10 caracteres/)
    expect(validarClaveNueva("solamenteletras")).toMatch(/letras y números/)
    expect(validarClaveNueva("1234567890")).toMatch(/letras y números/)
    expect(validarClaveNueva("Indupan2026x", "Indupan2026x")).toMatch(/distinta/)
    expect(validarClaveNueva("Indupan2026x", "temporal99a")).toBeNull()
  })
})
