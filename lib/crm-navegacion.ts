"use client"

// Navegacion entre modulos LLEVANDO LOS DATOS.
//
// El CRM vive en una sola pagina y el modulo activo es estado de React (ver
// app/page.tsx), asi que no hay URL que lleve "/ventas?cliente=12". Hasta
// ahora un modulo podia mandar al usuario a otro por nombre, pero sin datos:
// el vendedor que miraba la cartera de un cliente y queria venderle tenia que
// ir a Nueva Venta y buscar al cliente otra vez.
//
// COMO FUNCIONA
//   irA({ accion: "nueva_venta", clienteId: 12 })
//     1. deja la intencion en memoria (con hora: caduca a los 15 s);
//     2. pide a la pagina abrir el modulo que corresponde a esa accion;
//     3. el modulo de destino, al montarse, la toma con useIntencion() y
//        precarga lo que trae (el cliente elegido, el filtro puesto…).
//   Si el destino ya estaba abierto, la toma igual por el evento crm:intencion.
//
// abrirCuenta360(id) no navega: abre la Cuenta 360 del cliente ENCIMA del
// modulo actual (la pinta HostDialogosGlobales en app/page.tsx), para no
// perder el lugar donde se estaba.
//
// Esto es interfaz, no seguridad: el modulo de destino conserva su
// PermissionGuard y cada accion del servidor valida permisos y alcance.

import { useEffect, useRef, useState } from "react"

export type Intencion =
  | { accion: "nueva_venta"; clienteId: number }
  | { accion: "nueva_cotizacion"; clienteId?: number; prospectoId?: number }
  | { accion: "registrar_pago"; clienteId: number }
  | { accion: "ver_cartera_cliente"; clienteId: number; nombre?: string }
  | { accion: "ver_pedidos_cliente"; clienteId: number }
  | { accion: "ver_pedido"; pedidoId: number }
  | { accion: "ver_cotizaciones_cliente"; clienteId?: number; texto?: string }
  | { accion: "ver_prospecto"; prospectoId: number }
  | { accion: "registrar_actividad"; clienteId?: number; prospectoId?: number }
  | { accion: "ver_clientes"; texto?: string }
  | { accion: "ver_mapa_clientes"; clienteId?: number }

export type AccionIntencion = Intencion["accion"]

/** Modulo que atiende cada accion. Nombres exactos del menu (dashboard-data). */
export const MODULO_DE: Record<AccionIntencion, string> = {
  nueva_venta: "Nueva Venta",
  nueva_cotizacion: "Cotizaciones",
  registrar_pago: "Registrar Pago",
  ver_cartera_cliente: "Cuentas por Cobrar",
  ver_pedidos_cliente: "Pedidos CRM",
  ver_pedido: "Pedidos CRM",
  ver_cotizaciones_cliente: "Cotizaciones",
  ver_prospecto: "Registrar Prospecto",
  registrar_actividad: "Actividades",
  ver_clientes: "Gestión de Clientes",
  ver_mapa_clientes: "Gestión de Clientes",
}

const CADUCA_MS = 15_000
let pendiente: { intencion: Intencion; en: number } | null = null

/** Lleva al usuario al modulo de la accion, con sus datos. */
export function irA(intencion: Intencion) {
  pendiente = { intencion, en: Date.now() }
  window.dispatchEvent(new CustomEvent("crm:navigate-module", { detail: MODULO_DE[intencion.accion] }))
  window.dispatchEvent(new CustomEvent("crm:intencion"))
}

/** Lleva a un modulo sin datos (el canal de siempre). */
export function irAModulo(modulo: string) {
  window.dispatchEvent(new CustomEvent("crm:navigate-module", { detail: modulo }))
}

/** Abre la Cuenta 360 del cliente sobre el modulo actual, sin navegar. */
export function abrirCuenta360(clienteId: number) {
  window.dispatchEvent(new CustomEvent("crm:cuenta360", { detail: clienteId }))
}

function tomar<A extends AccionIntencion>(acciones: readonly A[]): Extract<Intencion, { accion: A }> | null {
  if (!pendiente) return null
  if (Date.now() - pendiente.en > CADUCA_MS) {
    pendiente = null
    return null
  }
  if (!(acciones as readonly string[]).includes(pendiente.intencion.accion)) return null
  const i = pendiente.intencion
  pendiente = null
  return i as Extract<Intencion, { accion: A }>
}

/**
 * El modulo de destino declara que acciones atiende y que hacer con ellas.
 * Se ejecuta al montarse y cada vez que llega una intencion nueva.
 */
export function useIntencion<A extends AccionIntencion>(
  acciones: readonly A[],
  manejar: (i: Extract<Intencion, { accion: A }>) => void,
) {
  const ref = useRef(manejar)
  ref.current = manejar
  const clave = acciones.join(",")
  useEffect(() => {
    const correr = () => {
      const i = tomar(acciones)
      if (i) ref.current(i)
    }
    correr()
    window.addEventListener("crm:intencion", correr)
    return () => window.removeEventListener("crm:intencion", correr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])
}

// ------------------------------------------------------------------ permisos

/**
 * Modulos que el usuario puede abrir, consultados UNA vez por carga de
 * pagina y compartidos por todos los accesos directos. Mismo criterio y misma
 * fuente que el menu (/api/user-modules).
 */
let permisos: Promise<{ protegidos: Set<string>; permitidos: Set<string> } | null> | null = null

function cargarPermisos() {
  if (!permisos) {
    permisos = fetch("/api/user-modules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { protectedModules: string[]; allowedModules: string[] } | null) =>
        d ? { protegidos: new Set(d.protectedModules), permitidos: new Set(d.allowedModules) } : null)
      .catch(() => null)
  }
  return permisos
}

/** Mientras carga, o si la consulta falla, se muestran los accesos: el
 *  PermissionGuard del destino sigue siendo la barrera. */
export function useModuloVisible(): (modulo: string) => boolean {
  const [p, setP] = useState<{ protegidos: Set<string>; permitidos: Set<string> } | null | undefined>(undefined)
  useEffect(() => {
    let vivo = true
    cargarPermisos().then((r) => vivo && setP(r))
    return () => { vivo = false }
  }, [])
  return (modulo: string) => {
    if (!p) return true
    return !p.protegidos.has(modulo) || p.permitidos.has(modulo)
  }
}
