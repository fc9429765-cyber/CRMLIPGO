// Permisos del CRM.
//
// SIN "use server" A PROPOSITO: Next prohibe exportar valores no-async desde un
// modulo con esa directiva, y aqui se exportan una interfaz y un objeto. Las
// funciones que CONSULTAN permisos viven en permissions-actions.ts.
//
// La tabla `permisos_usuarios` es COMPARTIDA con LIPgo, que sigue en produccion
// con sus ~153 columnas operativas. El script 186 agrega las columnas crm_*
// sin borrar ninguna: para el CRM las viejas simplemente no existen, y para
// LIPgo las nuevas son invisibles.

/** Columnas crm_* de `permisos_usuarios` (ver scripts/186_crm_permisos.sql). */
export interface UserPermissions {
  usuario_id: string

  // Inicio
  crm_dashboard: boolean
  crm_agenda: boolean

  // Prospectos
  crm_prospectos: boolean
  crm_embudo: boolean
  crm_actividades: boolean

  // Ventas
  crm_cotizaciones: boolean
  crm_pedidos: boolean
  /** Primera firma del pedido: CARTERA. La columna conserva el nombre
   *  historico "contabilidad" para no renombrar en la tabla compartida. */
  crm_autorizar_contabilidad: boolean
  /** Segunda firma. Con ambas, el pedido viaja a LIPgo. */
  crm_autorizar_gerencia: boolean

  // Clientes
  crm_clientes: boolean
  crm_listas_precios: boolean

  // Cartera
  crm_cartera: boolean
  crm_pagos: boolean
  crm_comisiones: boolean

  // Inteligencia
  crm_ia_rutas: boolean
  crm_ia_oportunidades: boolean
  crm_reportes: boolean

  // Configuracion
  crm_productos: boolean
  crm_vendedores: boolean
  crm_parametros: boolean
  crm_usuarios: boolean
  crm_auditoria: boolean

  // Requerimiento INDUPAN (script 191)
  /** Ver lo de todos los vendedores. Sin el, un vendedor ve solo lo suyo. */
  crm_ver_todos_clientes: boolean
  crm_recaudos_registrar: boolean
  crm_recaudos_aprobar: boolean
  crm_prospectos_aprobar: boolean
  crm_maestros_admin: boolean
  crm_importar: boolean
  crm_integraciones_admin: boolean
  crm_descuentos_admin: boolean
}

/**
 * Nombre visible del modulo -> columna de permiso.
 *
 * La llave debe coincidir EXACTAMENTE con `Module.name` de dashboard-data.ts y
 * con la entrada de MODULE_REGISTRY. Un modulo que no aparezca aqui NO esta
 * protegido y lo ve cualquiera; uno que aparezca con una columna inexistente
 * no lo ve nadie.
 */
export const MODULE_PERMISSION_MAP: Record<string, keyof UserPermissions> = {
  // Inicio
  "Dashboard Comercial": "crm_dashboard",
  "Mi Agenda": "crm_agenda",

  // Prospectos
  "Registrar Prospecto": "crm_prospectos",
  "Embudo de Ventas": "crm_embudo",
  "Actividades": "crm_actividades",
  // El calendario y la agenda comparten permiso: son la misma informacion,
  // una en rejilla mensual y otra como lista del dia.
  "Calendario de Visitas": "crm_agenda",

  // Ventas
  "Cotizaciones": "crm_cotizaciones",
  // "Nueva Venta" es la venta directa, que se salta la cotizacion: por eso
  // depende del permiso de pedidos y no del de cotizaciones.
  "Nueva Venta": "crm_pedidos",
  "Pedidos CRM": "crm_pedidos",
  // La bandeja de firmas se muestra a quien pueda dar CUALQUIERA de las dos.
  // Cual de los dos botones aparece lo decide el componente, que vuelve a
  // consultar el permiso concreto.
  "Autorizar Pedidos": "crm_autorizar_contabilidad",
  // "Integraciones" es el panel de la bandeja de salida (SAP, WhatsApp).
  "Integraciones": "crm_integraciones_admin",
  "Maestros": "crm_maestros_admin",
  "Importar datos": "crm_importar",

  // Clientes
  "Gestión de Clientes": "crm_clientes",
  "Sucursales": "crm_clientes",
  "Listas de Precios": "crm_listas_precios",

  // Cartera
  "Cuentas por Cobrar": "crm_cartera",
  "Registrar Pago": "crm_pagos",
  "Antigüedad de Cartera": "crm_cartera",
  "Comisiones": "crm_comisiones",

  // Inteligencia
  "Rutas Óptimas": "crm_ia_rutas",
  "Oportunidades de Negocio": "crm_ia_oportunidades",
  "Asistente IA": "crm_dashboard",
  "Reportes": "crm_reportes",

  // Configuracion
  "Productos": "crm_productos",
  "Vendedores": "crm_vendedores",
  "Parametrización": "crm_parametros",
  "Gestión de Usuarios": "crm_usuarios",
  "Bitácora de Auditoría": "crm_auditoria",
}

/**
 * Permisos ALTERNATIVOS por modulo: con cualquiera de estos, ademas del de
 * MODULE_PERMISSION_MAP, el modulo tambien es visible.
 *
 * Existe porque la bandeja de firmas debe verla quien pueda dar CUALQUIERA de
 * las dos firmas, y el mapa principal solo admite una columna. Antes solo la
 * veia cartera: un firmante unicamente de gerencia no encontraba el modulo.
 */
export const MODULE_PERMISOS_ALTERNOS: Record<string, (keyof UserPermissions)[]> = {
  "Autorizar Pedidos": ["crm_autorizar_gerencia"],
  "Registrar Pago": ["crm_recaudos_registrar", "crm_recaudos_aprobar"],
  "Cuentas por Cobrar": ["crm_recaudos_aprobar"],
}

/** Todas las columnas que habilitan un modulo (principal + alternativas). */
export function permisosDelModulo(moduleName: string): (keyof UserPermissions)[] {
  const principal = MODULE_PERMISSION_MAP[moduleName]
  if (!principal) return []
  return [principal, ...(MODULE_PERMISOS_ALTERNOS[moduleName] ?? [])]
}

/** true si los permisos habilitan el modulo. Un modulo que no esta en el mapa
 *  no lo ve nadie: fallar cerrado. */
export function puedeVerModulo(
  permisos: Partial<Record<string, unknown>> | null | undefined,
  moduleName: string,
): boolean {
  if (!permisos) return false
  return permisosDelModulo(moduleName).some((k) => permisos[k] === true)
}

/** Todas las columnas de permiso, para crear un usuario con todo en false. */
export const TODOS_LOS_PERMISOS: (keyof UserPermissions)[] = [
  "crm_dashboard", "crm_agenda",
  "crm_prospectos", "crm_embudo", "crm_actividades",
  "crm_cotizaciones", "crm_pedidos", "crm_autorizar_contabilidad", "crm_autorizar_gerencia",
  "crm_clientes", "crm_listas_precios",
  "crm_cartera", "crm_pagos", "crm_comisiones",
  "crm_ia_rutas", "crm_ia_oportunidades", "crm_reportes",
  "crm_productos", "crm_vendedores", "crm_parametros", "crm_usuarios", "crm_auditoria",
  "crm_ver_todos_clientes", "crm_recaudos_registrar", "crm_recaudos_aprobar",
  "crm_prospectos_aprobar", "crm_maestros_admin", "crm_importar",
  "crm_integraciones_admin", "crm_descuentos_admin",
]

/** Permisos que no cuelgan de un modulo del menu, para la grilla de checkboxes. */
export const PERMISOS_EXTRA: { key: keyof UserPermissions; etiqueta: string; grupo: string }[] = [
  {
    key: "crm_autorizar_contabilidad",
    etiqueta: "Autorizar pedidos — Cartera (primera firma)",
    grupo: "Ventas",
  },
  {
    key: "crm_autorizar_gerencia",
    etiqueta: "Autorizar pedidos — Gerencia (segunda firma)",
    grupo: "Ventas",
  },
  {
    key: "crm_ver_todos_clientes",
    etiqueta: "Ver clientes y cartera de todos los vendedores",
    grupo: "Clientes",
  },
  {
    key: "crm_recaudos_registrar",
    etiqueta: "Registrar recaudos con comprobante",
    grupo: "Cartera",
  },
  {
    key: "crm_recaudos_aprobar",
    etiqueta: "Aprobar recaudos y editar facturas",
    grupo: "Cartera",
  },
  {
    key: "crm_prospectos_aprobar",
    etiqueta: "Aprobar la creación de clientes",
    grupo: "Prospectos",
  },
  {
    key: "crm_descuentos_admin",
    etiqueta: "Gestionar descuentos",
    grupo: "Clientes",
  },
  {
    key: "crm_maestros_admin",
    etiqueta: "Administrar maestros (bancos, impuestos, owners…)",
    grupo: "Configuración",
  },
  {
    key: "crm_importar",
    etiqueta: "Importar archivos CSV / Excel",
    grupo: "Configuración",
  },
]
