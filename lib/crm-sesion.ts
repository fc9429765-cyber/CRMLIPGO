// Sesion e identidad de los usuarios del CRM (scripts/209_crm_usuarios.sql).
//
// El CRM ya NO usa Supabase Auth: tenia los mismos usuarios que LIPgo, asi que
// cualquiera de LIPgo entraba aqui con su clave, y quien se creaba aqui quedaba
// creado alla. Ahora los usuarios viven en crm_usuarios con su propia clave
// (bcrypt) y la sesion es una cookie firmada que se contrasta con crm_sesiones.
//
// SIN "use server": nada de esto debe poder invocarse desde el navegador. Lo
// usan las rutas /api/crm-auth/* y el resto del servidor.

import { cache } from "react"
import { cookies } from "next/headers"
import bcrypt from "bcryptjs"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  COOKIE_SESION, DURACION_SESION_SEG, firmarSesion, opcionesCookie, verificarSesion,
} from "@/lib/crm-token"

type DB = SupabaseClient<any, any, any>

/** Cliente service-role sin actor de auditoria. Propio de este modulo para no
 *  depender de lib/supabase-admin, que a su vez pregunta aqui quien es el actor. */
let _db: DB | null = null
function db(): DB {
  if (!_db) {
    _db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return _db
}

export interface UsuarioCrm {
  id: string
  usuario: string
  email: string
  nombre: string | null
  empresa_id: number
  empresas_acceso: number[]
  owners_acceso: string[]
  permisos: Record<string, boolean>
  activo: boolean
  debe_cambiar_clave: boolean
  ultimo_ingreso: string | null
}

const COLUMNAS = "id, usuario, email, nombre, empresa_id, empresas_acceso, owners_acceso, permisos, activo, debe_cambiar_clave, ultimo_ingreso"

/** Intentos fallidos seguidos antes de bloquear, y por cuanto tiempo. */
const MAX_INTENTOS = 5
const BLOQUEO_MIN = 15

/** Hash de relleno: se compara aunque el usuario no exista, para que el tiempo
 *  de respuesta no delate que correos estan registrados. */
let _relleno: string | null = null
function hashRelleno(): string {
  if (!_relleno) _relleno = bcrypt.hashSync("relleno-sin-usuario", 10)
  return _relleno
}

export async function hashClave(clave: string): Promise<string> {
  return bcrypt.hash(clave, 10)
}

// ---------------------------------------------------------------------------
// Lectura de la sesion actual
// ---------------------------------------------------------------------------

export interface SesionActual {
  usuario: UsuarioCrm
  sesionId: string
}

/**
 * Usuario de la peticion en curso, o null. Memoizado por peticion.
 *
 * @param permitirCambioPendiente true SOLO en la pantalla de cambio de clave:
 *   un usuario con clave temporal no puede usar nada mas del CRM.
 */
async function leerSesionInterna(permitirCambioPendiente: boolean): Promise<SesionActual | null> {
  let token: string | undefined
  try {
    token = (await cookies()).get(COOKIE_SESION)?.value
  } catch {
    return null // fuera de una peticion (cron, scripts)
  }
  const claims = await verificarSesion(token)
  if (!claims) return null

  const { data: ses } = await db()
    .from("crm_sesiones")
    .select("id, usuario_id, expira_en, revocada_en")
    .eq("id", claims.sid)
    .maybeSingle()
  if (!ses || ses.usuario_id !== claims.sub || ses.revocada_en || new Date(ses.expira_en) <= new Date()) return null

  const { data: u } = await db().from("crm_usuarios").select(COLUMNAS).eq("id", claims.sub).maybeSingle()
  if (!u || !u.activo) return null
  if (u.debe_cambiar_clave && !permitirCambioPendiente) return null

  return { usuario: normalizar(u), sesionId: ses.id as string }
}

export const leerSesion = cache(() => leerSesionInterna(false))
export const leerSesionParaCambioDeClave = cache(() => leerSesionInterna(true))

function normalizar(u: Record<string, any>): UsuarioCrm {
  return {
    id: u.id,
    usuario: u.usuario,
    email: u.email,
    nombre: u.nombre ?? null,
    empresa_id: u.empresa_id ?? 1,
    empresas_acceso: u.empresas_acceso ?? [],
    owners_acceso: u.owners_acceso ?? [],
    permisos: (u.permisos ?? {}) as Record<string, boolean>,
    activo: u.activo !== false,
    debe_cambiar_clave: u.debe_cambiar_clave === true,
    ultimo_ingreso: u.ultimo_ingreso ?? null,
  }
}

// ---------------------------------------------------------------------------
// Ingreso, salida y cambio de clave
// ---------------------------------------------------------------------------

export type ResultadoIngreso =
  | { ok: true; debeCambiarClave: boolean }
  | { ok: false; error: string; status: number }

async function abrirSesion(usuarioId: string, dcc: boolean, meta: { ip?: string | null; userAgent?: string | null }) {
  const expira = new Date(Date.now() + DURACION_SESION_SEG * 1000).toISOString()
  const { data: ses, error } = await db()
    .from("crm_sesiones")
    .insert({ usuario_id: usuarioId, expira_en: expira, ip: meta.ip ?? null, user_agent: meta.userAgent?.slice(0, 300) ?? null })
    .select("id")
    .single()
  if (error || !ses) throw new Error("No se pudo abrir la sesión.")
  const token = await firmarSesion({ sub: usuarioId, sid: ses.id, dcc })
  ;(await cookies()).set(COOKIE_SESION, token, opcionesCookie())
}

/** Correo o nombre de usuario + clave. Mensaje generico ante cualquier fallo
 *  de credenciales: no se dice si el correo existe. */
export async function ingresar(
  identificador: string,
  clave: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ResultadoIngreso> {
  const id = identificador.trim().toLowerCase()
  if (!id || !clave) return { ok: false, error: "Escribe tu correo y tu contraseña.", status: 400 }

  const campo = id.includes("@") ? "email" : "usuario"
  const { data: u } = await db()
    .from("crm_usuarios")
    .select("id, password_hash, activo, debe_cambiar_clave, intentos_fallidos, bloqueado_hasta")
    .ilike(campo, id.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle()

  const generico = { ok: false as const, error: "Correo o contraseña incorrectos.", status: 401 }

  if (!u) {
    await bcrypt.compare(clave, hashRelleno())
    return generico
  }

  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    const min = Math.ceil((new Date(u.bloqueado_hasta).getTime() - Date.now()) / 60000)
    return { ok: false, error: `Demasiados intentos fallidos. Intenta de nuevo en ${min} minuto${min === 1 ? "" : "s"}.`, status: 429 }
  }

  const coincide = await bcrypt.compare(clave, u.password_hash)
  if (!coincide) {
    const intentos = (u.intentos_fallidos ?? 0) + 1
    const bloquear = intentos >= MAX_INTENTOS
    await db().from("crm_usuarios").update({
      intentos_fallidos: bloquear ? 0 : intentos,
      bloqueado_hasta: bloquear ? new Date(Date.now() + BLOQUEO_MIN * 60000).toISOString() : null,
    }).eq("id", u.id)
    return bloquear
      ? { ok: false, error: `Demasiados intentos fallidos. La cuenta queda bloqueada ${BLOQUEO_MIN} minutos.`, status: 429 }
      : generico
  }

  // La clave es correcta: recien aqui se puede decir que esta inactivo.
  if (!u.activo) return { ok: false, error: "Tu usuario está desactivado. Habla con el administrador del CRM.", status: 403 }

  await db().from("crm_usuarios").update({
    intentos_fallidos: 0, bloqueado_hasta: null, ultimo_ingreso: new Date().toISOString(),
  }).eq("id", u.id)
  await abrirSesion(u.id, u.debe_cambiar_clave === true, meta)
  return { ok: true, debeCambiarClave: u.debe_cambiar_clave === true }
}

export async function salir(): Promise<void> {
  const jar = await cookies()
  const claims = await verificarSesion(jar.get(COOKIE_SESION)?.value)
  if (claims) {
    await db().from("crm_sesiones").update({ revocada_en: new Date().toISOString() }).eq("id", claims.sid).is("revocada_en", null)
  }
  jar.set(COOKIE_SESION, "", opcionesCookie(0))
}

/** Revoca todas las sesiones abiertas de un usuario, salvo `excepto`. */
export async function revocarSesiones(usuarioId: string, excepto?: string): Promise<void> {
  let q = db().from("crm_sesiones").update({ revocada_en: new Date().toISOString() }).eq("usuario_id", usuarioId).is("revocada_en", null)
  if (excepto) q = q.neq("id", excepto)
  await q
}

/** Cambia la clave del usuario de la sesion (incluida la temporal). Cierra
 *  sus demas sesiones y reemite la cookie ya sin la marca de cambio pendiente. */
export async function cambiarClave(actual: string, nueva: string, meta: { ip?: string | null; userAgent?: string | null } = {}):
  Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const s = await leerSesionParaCambioDeClave()
  if (!s) return { ok: false, error: "Tu sesión expiró. Vuelve a iniciar sesión.", status: 401 }

  const { data: u } = await db().from("crm_usuarios").select("password_hash").eq("id", s.usuario.id).single()
  if (!u || !(await bcrypt.compare(actual, u.password_hash))) {
    return { ok: false, error: "La contraseña actual no es correcta.", status: 400 }
  }

  await db().from("crm_usuarios").update({
    password_hash: await hashClave(nueva),
    debe_cambiar_clave: false,
    clave_cambiada_en: new Date().toISOString(),
    actualizado_en: new Date().toISOString(),
  }).eq("id", s.usuario.id)

  await revocarSesiones(s.usuario.id)
  await abrirSesion(s.usuario.id, false, meta)
  return { ok: true }
}

/** Nombre de la empresa, para la barra superior. */
export async function nombreEmpresa(id: number): Promise<string> {
  const { data } = await db().from("empresas").select("nombre").eq("id", id).maybeSingle()
  return (data?.nombre as string | undefined) ?? "Harinera Indupan"
}
