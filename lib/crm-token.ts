// Token de sesion del CRM: un JWT HS256 firmado con CRM_AUTH_SECRET que viaja
// en una cookie httpOnly. Sin "use server" y sin acceso a la base: lo usan el
// middleware (runtime edge), el cliente admin (para saber quien audita) y
// lib/crm-sesion.ts, que es quien ademas contrasta la sesion con crm_sesiones.
//
// LA FIRMA SOLA NO BASTA: dice que el CRM emitio el token, no que siga vigente.
// Cerrar sesion, cambiar la clave o desactivar al usuario revocan la fila de
// crm_sesiones; por eso lib/crm-sesion.ts la consulta en cada peticion. El
// middleware solo mira la firma porque en el edge no hay base de datos, y su
// trabajo es mandar al login a quien no tiene cookie, no autorizar.

import { SignJWT, jwtVerify } from "jose"

export const COOKIE_SESION = "crm_sesion"

/** Duracion de la sesion. Una jornada larga: el vendedor no debe perder la
 *  sesion a media visita, y al otro dia vuelve a entrar. */
export const DURACION_SESION_SEG = 12 * 60 * 60

export interface ClaimsSesion {
  /** crm_usuarios.id */
  sub: string
  /** crm_sesiones.id */
  sid: string
  /** Debe cambiar la clave antes de usar el CRM. */
  dcc: boolean
}

function secreto(): Uint8Array {
  const s = process.env.CRM_AUTH_SECRET
  if (!s || s.length < 32) {
    throw new Error("Falta CRM_AUTH_SECRET (mínimo 32 caracteres) en las variables de entorno del CRM.")
  }
  return new TextEncoder().encode(s)
}

export async function firmarSesion(c: ClaimsSesion): Promise<string> {
  return new SignJWT({ sid: c.sid, dcc: c.dcc })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.sub)
    .setIssuer("crm-indupan")
    .setIssuedAt()
    .setExpirationTime(`${DURACION_SESION_SEG}s`)
    .sign(secreto())
}

/** null si no hay token, la firma no cuadra o ya expiro. Nunca lanza. */
export async function verificarSesion(token: string | undefined | null): Promise<ClaimsSesion | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secreto(), { issuer: "crm-indupan", algorithms: ["HS256"] })
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null
    return { sub: payload.sub, sid: payload.sid, dcc: payload.dcc === true }
  } catch {
    return null
  }
}

/** Opciones de la cookie. `secure` solo en produccion: en localhost:3100 no hay https. */
export function opcionesCookie(maxAge = DURACION_SESION_SEG) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  }
}

/** Reglas de la clave. Una sola fuente para el servidor y el formulario. */
export function validarClaveNueva(clave: string, actual?: string): string | null {
  if (!clave || clave.length < 10) return "La contraseña debe tener al menos 10 caracteres."
  if (!/[A-Za-z]/.test(clave) || !/\d/.test(clave)) return "La contraseña debe combinar letras y números."
  if (actual && clave === actual) return "La contraseña nueva debe ser distinta de la actual."
  return null
}
