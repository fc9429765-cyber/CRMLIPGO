// Maquina de estados del pedido (PED-18..22). Logica PURA, probada.
//
// Sin "use server". La usan el servidor (que es quien decide) y la interfaz
// (para mostrar solo los botones que tienen sentido).
//
//   borrador ──solicitar──▶ pendiente_cartera ──firma cartera──▶ pendiente_gerencia
//      ▲                          │                                   │
//      │                       rechazo                        firma gerencia
//      │                          ▼                                   ▼
//      └──────editar─────── rechazado ◀──────rechazo──────────── aprobado ──LIPgo──▶ programado_lipgo
//
//   anulado: desde borrador, rechazado o pendiente (nunca despues de aprobar).
//
// SAP NO ES UN ESTADO DEL PEDIDO: para INDUPAN, el envio a SAP y la
// programacion en LIPgo ocurren en paralelo (PED-23) y SAP puede estar
// apagado. Por eso va en su propia columna `sap_estado`, y un pedido puede
// estar "programado en LIPgo" con "SAP pendiente" a la vez sin contradiccion.
//
// El rol interno de la primera firma se llama "contabilidad" porque asi se
// llaman sus columnas y su permiso en la tabla compartida con LIPgo. En
// pantalla es "Cartera" (decision del usuario).

export type EstadoPedidoV2 =
  | "borrador"
  | "pendiente_cartera"
  | "pendiente_gerencia"
  | "aprobado"
  | "programado_lipgo"
  | "rechazado"
  | "anulado"
  // Estados de la version anterior. La migracion (script 199) los convierte;
  // se aceptan aqui para no fallar si queda alguno.
  | "pendiente_autorizacion"
  | "autorizado_parcial"
  | "autorizado"
  | "enviado_lipgo"

export type Rol = "contabilidad" | "gerencia"
export type ModoAprobacion = "secuencial" | "paralelo"
export type EstadoSap = "no_aplica" | "pendiente" | "enviado" | "error"

export const ESTADO_LABEL: Record<EstadoPedidoV2, string> = {
  borrador: "Borrador",
  pendiente_cartera: "Pendiente de Cartera",
  pendiente_gerencia: "Pendiente de Gerencia",
  aprobado: "Aprobado",
  programado_lipgo: "Programado en LIPgo",
  rechazado: "Rechazado",
  anulado: "Anulado",
  pendiente_autorizacion: "Pendiente de Cartera",
  autorizado_parcial: "Pendiente de Gerencia",
  autorizado: "Aprobado",
  enviado_lipgo: "Programado en LIPgo",
}

export const ROL_ETIQUETA: Record<Rol, string> = { contabilidad: "Cartera", gerencia: "Gerencia" }

export const SAP_LABEL: Record<EstadoSap, string> = {
  no_aplica: "No aplica",
  pendiente: "SAP pendiente",
  enviado: "En SAP",
  error: "Error SAP",
}

/** Lo minimo del pedido que necesitan las reglas. */
export interface PedidoParaReglas {
  estado: EstadoPedidoV2
  auth_contabilidad_en: string | null
  auth_contabilidad_por: string | null
  auth_gerencia_en: string | null
  auth_gerencia_por: string | null
  creado_por: string | null
  solicitado_por?: string | null
  idpedido_lipgo: number | null
}

const PENDIENTES = new Set<EstadoPedidoV2>([
  "pendiente_cartera", "pendiente_gerencia", "pendiente_autorizacion", "autorizado_parcial",
])

export const esPendiente = (e: EstadoPedidoV2) => PENDIENTES.has(e)
export const esEditable = (e: EstadoPedidoV2) => e === "borrador" || e === "rechazado"
export const esFinal = (e: EstadoPedidoV2) =>
  e === "programado_lipgo" || e === "enviado_lipgo" || e === "anulado"

type Veredicto = { ok: true } | { ok: false; motivo: string }

/** Se puede pedir aprobacion: borrador, o rechazado ya corregido (PED-21). */
export function puedeSolicitar(p: Pick<PedidoParaReglas, "estado">): Veredicto {
  return esEditable(p.estado)
    ? { ok: true }
    : { ok: false, motivo: `Un pedido ${ESTADO_LABEL[p.estado].toLowerCase()} no se puede enviar a aprobación` }
}

export function puedeEditar(p: Pick<PedidoParaReglas, "estado">): Veredicto {
  return esEditable(p.estado)
    ? { ok: true }
    : { ok: false, motivo: "Solo se edita un pedido en borrador o rechazado" }
}

export function puedeAnular(p: Pick<PedidoParaReglas, "estado" | "idpedido_lipgo">): Veredicto {
  if (p.idpedido_lipgo) return { ok: false, motivo: "El pedido ya está en LIPgo: se anula allá" }
  if (esEditable(p.estado) || esPendiente(p.estado)) return { ok: true }
  return { ok: false, motivo: `Un pedido ${ESTADO_LABEL[p.estado].toLowerCase()} no se puede anular` }
}

/**
 * Si un usuario puede dar una firma.
 *
 * SEPARACION DE FUNCIONES: quien dio una firma no da la otra, y quien creo o
 * envio el pedido no lo autoriza. Sin esto, "dos autorizaciones" son dos
 * clics de la misma mano.
 *
 * SECUENCIAL (por defecto, PED-19): Gerencia firma despues de Cartera.
 */
export function puedeFirmar(
  p: PedidoParaReglas,
  rol: Rol,
  usuarioId: string,
  usuarioNombre: string,
  modo: ModoAprobacion,
): Veredicto {
  if (!esPendiente(p.estado)) {
    return { ok: false, motivo: `El pedido está ${ESTADO_LABEL[p.estado].toLowerCase()}: no espera firmas` }
  }
  if (p.idpedido_lipgo) return { ok: false, motivo: "El pedido ya está en LIPgo" }

  const yaFirmo = rol === "contabilidad" ? p.auth_contabilidad_en : p.auth_gerencia_en
  if (yaFirmo) return { ok: false, motivo: `${ROL_ETIQUETA[rol]} ya aprobó este pedido` }

  if (modo === "secuencial" && rol === "gerencia" && !p.auth_contabilidad_en) {
    return { ok: false, motivo: "Primero debe aprobar Cartera" }
  }

  const otro = rol === "contabilidad" ? p.auth_gerencia_por : p.auth_contabilidad_por
  if (otro && otro === usuarioId) {
    return { ok: false, motivo: "Ya diste la otra aprobación: las dos deben ser de personas distintas" }
  }
  if ((p.creado_por && p.creado_por === usuarioNombre) || (p.solicitado_por && p.solicitado_por === usuarioId)) {
    return { ok: false, motivo: "No puedes aprobar un pedido que tú creaste o enviaste" }
  }
  return { ok: true }
}

/** Estado despues de registrar una firma valida. */
export function estadoTrasFirma(
  p: Pick<PedidoParaReglas, "auth_contabilidad_en" | "auth_gerencia_en">,
  rol: Rol,
): EstadoPedidoV2 {
  const cartera = rol === "contabilidad" || !!p.auth_contabilidad_en
  const gerencia = rol === "gerencia" || !!p.auth_gerencia_en
  if (cartera && gerencia) return "aprobado"
  return cartera ? "pendiente_gerencia" : "pendiente_cartera"
}

/** Se puede rechazar mientras espera firmas. */
export function puedeRechazar(p: Pick<PedidoParaReglas, "estado" | "idpedido_lipgo">): Veredicto {
  if (p.idpedido_lipgo) return { ok: false, motivo: "El pedido ya está en LIPgo" }
  return esPendiente(p.estado) ? { ok: true } : { ok: false, motivo: "Solo se rechaza un pedido pendiente de aprobación" }
}

/** Quien le toca firmar ahora, para la bandeja de cada rol. */
export function rolesQueFaltan(
  p: Pick<PedidoParaReglas, "estado" | "auth_contabilidad_en" | "auth_gerencia_en">,
  modo: ModoAprobacion,
): Rol[] {
  if (!esPendiente(p.estado)) return []
  const faltan: Rol[] = []
  if (!p.auth_contabilidad_en) faltan.push("contabilidad")
  if (!p.auth_gerencia_en && (modo === "paralelo" || p.auth_contabilidad_en)) faltan.push("gerencia")
  return faltan
}
