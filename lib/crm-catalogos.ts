// Tipos de los maestros que el CRM lee de la base compartida con LIPgo.
//
// SIN "use server": las funciones viven en crm-catalogos-actions.ts.
//
// OJO CON LOS NOMBRES DE COLUMNA: estas tablas son heredadas y no siguen la
// convencion del CRM. `clientes`, `productos` y `vendedores` usan `id_empresa`
// (con guion bajo); `bodegas` usa `idempresa`. Y `activo` es TEXT con las
// cadenas 'true'/'false', no boolean. Se normaliza al leer.

export interface ClienteCrm {
  id: number
  nombre: string
  documento: string | null
  correo: string | null
  correofact: string | null
  personacontacto: string | null
  celular: string | null
  tipo_cliente: string | null
  activo: boolean

  // Columnas que agrego el CRM (script 181)
  cupo_credito: number
  dias_credito: number
  lista_precio_id: number | null
  latitud: number | null
  longitud: number | null
  bloqueado_cartera: boolean
  vendedor_asignado: number | null
  segmento: string | null

  // Resueltas al leer
  lista_precio_nombre?: string | null
  cartera_pendiente?: number
}

export interface ProductoCrm {
  id: number
  nombre: string
  codigo: string | null
  categoria: string | null
  subcategoria: string | null
  /** Peso neto por unidad, en kg. Lo usa el calculo de peso del pedido. */
  peso_unitkg: number | null
  unidad: string | null
  activo: boolean

  // Columnas comerciales que agrego el CRM (script 181)
  foto_url: string | null
  fotos: string[]
  descripcion_comercial: string | null
  precio_base: number | null

  // Fase 1 del requerimiento INDUPAN (scripts 193, 194, 196)
  /** Empresa de LIPgo donde esta creado. Molinos: 3 y 4. */
  id_empresa?: number
  /** Owner comercial resuelto (crm_owners.id). null = sin owner: no se vende. */
  owner_id?: number | null
  /** Impuesto asignado; null = el de por defecto. */
  crm_impuesto_id?: number | null
  /** Tarifa efectiva (la asignada o la de por defecto). */
  impuesto_pct?: number
  /** Existencias disponibles en LIPgo, sumando sedes. undefined = no consultado. */
  stock_disponible?: number | null
  /** Existencias por sede de despacho (id_empresa de LIPgo → disponible). Es
   *  el dato que sirve al vender: lo que hay en el centro que va a despachar. */
  stock_por_sede?: Record<number, number>
}

export interface SucursalCrm {
  idbodega: number
  nombrebodega: string
  clienteid: number | null
  cliente: string | null
  direccion: string | null
  ciudad: string | null
  departamento: string | null
  latitud: number | null
  longitud: number | null
  activo: boolean
}

export interface VendedorCrm {
  idvendedor: number
  nombre: string
  cedula: string | null
  celular: string | null
  correo: string | null
  activo: boolean

  // De crm_vendedores_detalle (script 188)
  zona?: string | null
  ciudad_base?: string | null
  meta_mensual?: number
  comision_propia?: number | null
  usuario_id?: string | null
  foto_url?: string | null
}

/**
 * Normaliza el `activo` de las tablas heredadas.
 *
 * Es TEXT y guarda 'true'/'false', pero en otras tablas de la misma base la
 * convencion es 'SI'/'NO' o '1'/'0' segun cuando se creo. Se aceptan todas en
 * lugar de confiar en que siempre sea la misma.
 */
export function esActivo(valor: unknown): boolean {
  if (typeof valor === "boolean") return valor
  if (valor == null) return true // sin dato se asume activo, como hace LIPgo
  // "s" incluido: en la base hay productos con activo = 'S' (verificado el
  // 2026-09-26). Sin esto se mostraban como inactivos y no se podian vender.
  return ["true", "t", "s", "si", "sí", "1", "y", "yes"].includes(String(valor).trim().toLowerCase())
}
