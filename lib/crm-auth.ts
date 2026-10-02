// Seguridad del lado del servidor para todas las acciones del CRM.
//
// POR QUE EXISTE: hasta la fase 0 casi ninguna accion validaba permisos. El
// menu ocultaba los modulos, pero cualquiera con sesion podia invocar la accion
// directamente y registrar un pago, cambiar un precio o ver la cartera de otro
// vendedor. Ocultar un boton no es seguridad (RNF-02).
//
// SIN "use server": no es una accion invocable desde el navegador. Solo la
// importan las acciones del servidor, que es donde tiene que ejecutarse.
//
// TRES REGLAS:
//   1. Quien actua SIEMPRE sale de la sesion. Varias acciones recibian el
//      nombre del usuario como argumento desde el navegador: cualquiera podia
//      firmar como otro. Esos argumentos se ignoran.
//   2. Un usuario vinculado a un vendedor ve solo lo de ese vendedor, salvo
//      que tenga `crm_ver_todos_clientes`. Quien no es vendedor (cartera,
//      gerencia, administracion) ve todo.
//   3. Despliegue gradual con el parametro `seguridad.modo`. En `log`, una
//      denegacion se anota en la bitacora y se deja pasar; en `enforce`, se
//      bloquea. Endurecer de golpe un sistema en uso rompe pantallas que hoy
//      funcionan porque nadie validaba nada.

import { cache } from "react"
import { leerSesion } from "@/lib/crm-sesion"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { leerParam } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { registrarEvento } from "@/lib/crm-eventos"

export type Alcance = "todos" | "propios"

export interface ContextoCrm {
  userId: string
  /** Nombre de usuario (crm_usuarios.usuario). Es el que queda en la bitacora. */
  nombre: string
  empresaId: number
  permisos: Record<string, unknown>
  /** Vendedor vinculado a este login, si lo hay. */
  vendedorId: number | null
  alcance: Alcance
}

/** Error de permiso. Las acciones lo capturan en su try/catch y devuelven
 *  `{ success: false, error }` con este mensaje. */
export class ErrorPermiso extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = "ErrorPermiso"
  }
}

/**
 * Contexto de quien hace la peticion. Memoizado por request: una accion que
 * valida tres cosas consulta la sesion y los permisos una sola vez.
 */
export const getContexto = cache(async (): Promise<ContextoCrm | null> => {
  // Usuario propio del CRM (crm_usuarios, scripts/209). Ya no se usan
  // profiles ni permisos_usuarios de LIPgo.
  const s = await leerSesion()
  if (!s) return null
  const u = s.usuario

  const admin = await getSupabaseAdminAsSystem()
  const { data: vendedor } = await admin
    .from("crm_vendedores_detalle")
    .select("vendedor_id")
    .eq("usuario_id", u.id)
    .eq("activo", true)
    .maybeSingle()

  const p = u.permisos as Record<string, unknown>
  const vendedorId = (vendedor?.vendedor_id as number | undefined) ?? null
  const veTodo = p.crm_ver_todos_clientes === true || vendedorId == null

  return {
    userId: u.id,
    nombre: u.usuario || u.email || "usuario",
    empresaId: u.empresa_id ?? 1,
    permisos: p,
    vendedorId,
    alcance: veTodo ? "todos" : "propios",
  }
})

/** true si tiene AL MENOS UNO de los permisos. */
export function tienePermiso(ctx: ContextoCrm, ...permisos: string[]): boolean {
  return permisos.some((k) => ctx.permisos[k] === true)
}

const modoSeguridad = cache(async (): Promise<"log" | "enforce"> => {
  const v = await leerParam(PARAM.SEGURIDAD_MODO)
  return v === "enforce" ? "enforce" : "log"
})

/**
 * Exige sesion y al menos uno de los permisos. Devuelve el contexto.
 *
 * Sin sesion se bloquea SIEMPRE, en cualquier modo: no hay nada que registrar
 * de alguien que no se sabe quien es.
 *
 * @param accion nombre de la accion, para que la bitacora diga que se intento.
 */
export async function exigirPermiso(accion: string, ...permisos: string[]): Promise<ContextoCrm> {
  const ctx = await getContexto()
  if (!ctx) throw new ErrorPermiso("Tu sesión expiró. Vuelve a iniciar sesión.")

  if (permisos.length === 0 || tienePermiso(ctx, ...permisos)) return ctx

  const modo = await modoSeguridad()
  await registrarEvento({
    empresaId: ctx.empresaId,
    entidad: "seguridad",
    tipo: modo === "enforce" ? "acceso_denegado" : "acceso_denegado_registrado",
    usuarioId: ctx.userId,
    usuarioNombre: ctx.nombre,
    datos: { accion, permisos_requeridos: permisos, modo },
  })

  if (modo === "enforce") {
    throw new ErrorPermiso("No tienes permiso para esta acción.")
  }
  return ctx
}

/** Solo exige sesion. Para lecturas que cualquier usuario del CRM puede hacer. */
export async function exigirSesion(): Promise<ContextoCrm> {
  const ctx = await getContexto()
  if (!ctx) throw new ErrorPermiso("Tu sesión expiró. Vuelve a iniciar sesión.")
  return ctx
}

/**
 * Filtra una consulta por el vendedor del usuario, si su alcance es `propios`.
 * Devuelve la misma consulta para encadenar.
 *
 * @param columna columna que guarda el vendedor en esa tabla:
 *   `vendedor_asignado` en clientes, `vendedor_id` en pedidos, cotizaciones,
 *   cuentas por cobrar y prospectos.
 */
export function filtrarPorVendedor<Q extends { eq: (col: string, val: unknown) => Q }>(
  query: Q,
  ctx: ContextoCrm,
  columna = "vendedor_id",
): Q {
  if (ctx.alcance === "propios" && ctx.vendedorId != null) {
    return query.eq(columna, ctx.vendedorId)
  }
  return query
}

/**
 * Comprueba que el cliente sea visible para el usuario. Un vendedor que
 * adivina el id de un cliente ajeno no debe poder leer su cartera ni
 * venderle.
 */
export async function asegurarClienteVisible(ctx: ContextoCrm, clienteId: number): Promise<void> {
  if (ctx.alcance === "todos") return
  const admin = await getSupabaseAdminAsSystem()
  const { data } = await admin
    .from("clientes")
    .select("vendedor_asignado")
    .eq("id", clienteId)
    .maybeSingle()
  if (data?.vendedor_asignado !== ctx.vendedorId) {
    const modo = await modoSeguridad()
    await registrarEvento({
      empresaId: ctx.empresaId,
      entidad: "seguridad",
      tipo: modo === "enforce" ? "acceso_denegado" : "acceso_denegado_registrado",
      usuarioId: ctx.userId,
      usuarioNombre: ctx.nombre,
      datos: { motivo: "cliente_de_otro_vendedor", cliente_id: clienteId, modo },
    })
    if (modo === "enforce") throw new ErrorPermiso("Ese cliente no está asignado a ti.")
  }
}

/** Mensaje legible de cualquier error capturado en una accion. */
export function mensajeError(err: unknown, porDefecto = "Ocurrió un error inesperado."): string {
  if (err instanceof ErrorPermiso) return err.message
  if (err instanceof Error && err.message) return err.message
  return porDefecto
}

/**
 * Empresa sobre la que se puede trabajar. El navegador manda la del selector
 * global; se acepta si es la del usuario o una a la que tiene acceso explicito
 * (crm_usuarios.empresas_acceso). Si no, se usa la suya: cambiar un numero en
 * la URL no debe dar acceso a los datos de otra empresa.
 */
export async function empresaPermitida(ctx: ContextoCrm, pedida?: number | null): Promise<number> {
  if (pedida == null || !Number.isFinite(pedida) || pedida === ctx.empresaId) return ctx.empresaId
  const s = await leerSesion()
  return s?.usuario.empresas_acceso.includes(pedida) ? pedida : ctx.empresaId
}
