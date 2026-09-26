// Tipos del pedido y su doble aprobacion.
//
// SIN "use server": las funciones viven en crm-pedidos-actions.ts. Las reglas
// del ciclo de vida estan en crm-pedidos-estado.ts (fase 2 del requerimiento
// INDUPAN); aqui se reexportan con los nombres que ya usaba la interfaz.

import {
  ESTADO_LABEL, ROL_ETIQUETA, puedeFirmar as puedeFirmarV2,
  type EstadoPedidoV2, type EstadoSap, type ModoAprobacion, type Rol,
} from "@/lib/crm-pedidos-estado"

export type EstadoPedido = EstadoPedidoV2
export type RolAutorizacion = Rol

export const ESTADO_PEDIDO_LABEL: Record<EstadoPedido, string> = ESTADO_LABEL

/** La primera firma se muestra como "Cartera"; internamente sigue siendo
 *  "contabilidad", que es como se llaman sus columnas en la tabla compartida. */
export const ROL_LABEL: Record<RolAutorizacion, string> = ROL_ETIQUETA

/** Permiso que habilita cada firma. */
export const PERMISO_POR_ROL: Record<RolAutorizacion, "crm_autorizar_contabilidad" | "crm_autorizar_gerencia"> = {
  contabilidad: "crm_autorizar_contabilidad",
  gerencia: "crm_autorizar_gerencia",
}

export interface Pedido {
  id: number
  idempresa: number
  numero: string | null

  cotizacion_id: number | null
  cliente_id: number
  bodega_id: number | null
  vendedor_id: number | null

  fecha: string
  fecha_programada: string | null

  forma_pago: "contado" | "credito"
  dias_credito: number
  condicion_pago_id: number | null
  tipo_despacho_id: number | null
  orden_compra: string | null
  destino: string | null
  direccion: string | null

  subtotal: number
  descuento_valor: number
  iva_pct: number
  iva_valor: number
  total: number
  peso_total: number

  estado: EstadoPedido

  // Las dos firmas. Se guarda QUIEN firmo aunque la clave sea compartida:
  // con la clave sola no habria forma de saber quien autorizo un pedido que
  // no debia pasar.
  auth_contabilidad_por: string | null
  auth_contabilidad_nombre: string | null
  auth_contabilidad_en: string | null
  auth_contabilidad_nota: string | null

  auth_gerencia_por: string | null
  auth_gerencia_nombre: string | null
  auth_gerencia_en: string | null
  auth_gerencia_nota: string | null

  rechazado_por: string | null
  rechazado_nombre: string | null
  rechazado_en: string | null
  motivo_rechazo: string | null

  // Puente a LIPgo
  idpedido_lipgo: number | null
  enviado_lipgo_en: string | null
  enviado_lipgo_por: string | null
  error_lipgo: string | null

  pdf_url: string | null
  observaciones: string | null
  creado_por: string | null
  creado_en: string
  actualizado_en: string

  // Fase 2 (scripts 193 y 199)
  owner_id?: number | null
  idempresa_despacho?: number | null
  requiere_sobrecupo?: boolean
  sobrecupo_valor?: number
  cupo_snapshot?: number | null
  saldo_snapshot?: number | null
  vencido_snapshot?: number | null
  dias_mora_snapshot?: number | null
  solicitado_por?: string | null
  solicitado_nombre?: string | null
  solicitado_en?: string | null
  version?: number
  motivo_rechazo_id?: number | null
  sap_estado?: EstadoSap
  sap_referencia?: string | null
  sap_error?: string | null
}

export interface LineaPedido {
  id?: number
  pedido_id?: number
  linea: number
  producto_id: number | null
  producto_nombre: string
  categoria: string | null
  unidad: string | null
  cantidad: number
  precio_lista: number | null
  precio_unitario: number
  descuento_pct: number
  descuento_valor: number
  subtotal: number
  total_linea: number
  peso: number
  impuesto_id?: number | null
  impuesto_pct?: number | null
  base_impuesto?: number | null
  impuesto_valor?: number | null
}

export interface PedidoConDetalle extends Pedido {
  cliente_nombre?: string | null
  vendedor_nombre?: string | null
  cotizacion_numero?: string | null
  sucursal_nombre?: string | null
  owner_nombre?: string | null
  lineas?: LineaPedido[]
}

export interface EventoAutorizacion {
  id: number
  pedido_id: number
  rol: RolAutorizacion
  accion: "autorizar" | "rechazar" | "revertir" | "intento_fallido"
  usuario_id: string | null
  usuario_nombre: string | null
  nota: string | null
  total_al_momento: number | null
  creado_en: string
}

/** Qué firmas faltan. */
export function firmasPendientes(p: Pedido): RolAutorizacion[] {
  const faltan: RolAutorizacion[] = []
  if (!p.auth_contabilidad_en) faltan.push("contabilidad")
  if (!p.auth_gerencia_en) faltan.push("gerencia")
  return faltan
}

/**
 * Si un usuario puede dar una firma. Envoltorio de la version con modo de
 * aprobacion (crm-pedidos-estado.ts), con la forma de respuesta de antes.
 */
export function puedeFirmar(
  p: Pedido,
  rol: RolAutorizacion,
  usuarioId: string,
  usuarioNombre: string,
  modo: ModoAprobacion = "secuencial",
): { puede: boolean; motivo?: string } {
  const r = puedeFirmarV2(p, rol, usuarioId, usuarioNombre, modo)
  return r.ok ? { puede: true } : { puede: false, motivo: r.motivo }
}

export const money = (n: number) =>
  (Number(n) || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  })
