// Claves de los parametros de negocio del CRM.
//
// SIN "use server" A PROPOSITO: este archivo exporta constantes y tipos, y un
// modulo con esa directiva solo puede exportar funciones async. Las funciones
// que LEEN los parametros viven en crm-parametros-actions.ts. Es el mismo
// patron que ya usaba LIPgo con permissions-map.ts / permissions-actions.ts.
//
// POR QUE CONSTANTES Y NO STRINGS SUELTOS: escribir
// getParamNumber("cotizacion.vigencia_dias") en veinte sitios significa que un
// dia alguien escribe "cotizacion.vigencia_dia" y el sistema toma el valor por
// defecto en silencio, sin error, y las cotizaciones vencen cuando no deben.
// Con PARAM.COTIZACION_VIGENCIA, ese error no compila.

export const PARAM = {
  // Fiscal
  IVA: "iva.porcentaje_default",

  // Cotizaciones
  COTIZACION_VIGENCIA: "cotizacion.vigencia_dias",
  COTIZACION_ALERTA_VENCIMIENTO: "cotizacion.dias_alerta_vencimiento",

  // Prospectos
  PROSPECTO_ALERTA_SEGUIMIENTO: "prospecto.dias_alerta_seguimiento",
  PROSPECTO_DIAS_FRIO: "prospecto.dias_sin_gestion_frio",
  VISITA_RADIO_GPS: "visita.radio_validacion_gps",

  // Comisiones
  COMISION_PORCENTAJE: "comision.porcentaje_default",
  COMISION_MOMENTO: "comision.momento_causacion",
  COMISION_BASE: "comision.base",

  // Cartera
  CARTERA_RANGO_1: "cartera.rango_1_hasta",
  CARTERA_RANGO_2: "cartera.rango_2_hasta",
  CARTERA_RANGO_3: "cartera.rango_3_hasta",
  CARTERA_ALERTA_VENCIMIENTO: "cartera.dias_alerta_vencimiento",
  CARTERA_BLOQUEAR_MORA: "cartera.bloquear_por_mora",
  CARTERA_DIAS_MORA_BLOQUEO: "cartera.dias_mora_bloqueo",

  // Credito
  CREDITO_VALIDAR_CUPO: "credito.validar_cupo",
  CREDITO_DIAS_DEFAULT: "credito.dias_default",

  // Descuentos
  DESCUENTO_MAXIMO_VENDEDOR: "descuento.maximo_vendedor",

  // Pedidos
  PEDIDO_DOBLE_AUTORIZACION: "pedido.requiere_doble_autorizacion",
  PEDIDO_UMBRAL_GERENCIA: "pedido.monto_autorizacion_gerencia",
  /** Claves compartidas por rol. Estan aqui y no escritas en el codigo, que
   *  es como las tenia LIPgo ("LIP123456" literal en annulOrder). Aun asi, la
   *  clave sola no identifica a nadie: quien firma se toma de la sesion. */
  CLAVE_CONTABILIDAD: "pedido.clave_contabilidad",
  CLAVE_GERENCIA: "pedido.clave_gerencia",

  // Rutas
  RUTA_MAX_PARADAS: "ruta.max_paradas_dia",
  RUTA_VELOCIDAD_KMH: "ruta.velocidad_promedio_kmh",

  // Seguridad (script 191)
  /** log = registra la denegacion y deja pasar; enforce = bloquea. */
  SEGURIDAD_MODO: "seguridad.modo",

  // Integraciones (script 192). El modo global va en la variable de entorno
  // SAP_MODE; estos deciden que flujos viajan con la conexion encendida.
  SAP_PEDIDOS: "integracion.sap.pedidos",
  SAP_RECAUDOS: "integracion.sap.recaudos",
  SAP_CLIENTES: "integracion.sap.clientes",
  SAP_FACTURAS: "integracion.sap.facturas",
  SAP_INVENTARIO: "integracion.sap.inventario",
  SAP_SUCURSALES: "integracion.sap.sucursales",
  OUTBOX_MAX_INTENTOS: "integracion.outbox.max_intentos",
  OUTBOX_ESPERA_MIN: "integracion.outbox.espera_min",

  // Catalogo e inventario (script 196)
  CATALOGO_MODO: "catalogo.modo",
  INVENTARIO_MOSTRAR: "inventario.mostrar_al_vendedor",

  // Flujo del pedido (script 199)
  PEDIDO_APROBACION_MODO: "pedido.aprobacion_modo",
  CREDITO_MODO_CUPO: "credito.modo_cupo",
  PEDIDO_PROYECTAR_AL_APROBAR: "pedido.proyectar_al_aprobar",

  // Documentos y lectura de comprobantes (script 201)
  DOCUMENTOS_URL_MINUTOS: "documentos.url_minutos",
  IA_LECTURA_COMPROBANTES: "ia.lectura_comprobantes",
  IA_MODELO_OCR: "ia.modelo_ocr",

  // Estado de cuenta (script 205)
  ESTADO_CUENTA_DIAS_MOVIMIENTOS: "estado_cuenta.dias_movimientos",
  ESTADO_CUENTA_ENLACE_DIAS: "estado_cuenta.enlace_dias",
  ESTADO_CUENTA_NOTA: "estado_cuenta.nota",

  // Prospectos: expediente y aprobacion (script 206)
  PROSPECTO_EXIGIR_DOCUMENTOS: "prospecto.exigir_documentos",
  PROSPECTO_ENLACE_DIAS: "prospecto.enlace_dias",

  // SAP (script 207)
  SAP_PREFIJO_CLIENTE: "integracion.sap.prefijo_cliente",

  // Torre de aprobaciones (script 208)
  APROBACIONES_HORAS_ALERTA: "aprobaciones.horas_alerta",
} as const

export type ParamKey = (typeof PARAM)[keyof typeof PARAM]

/** Valores de respaldo. Solo se usan si la base no responde o si falta la fila:
 *  una pantalla que no carga es mejor que una que calcula con cero. Deben
 *  coincidir con la semilla del script 181. */
export const PARAM_FALLBACK: Record<ParamKey, string> = {
  "iva.porcentaje_default": "5",
  "cotizacion.vigencia_dias": "15",
  "cotizacion.dias_alerta_vencimiento": "3",
  "prospecto.dias_alerta_seguimiento": "7",
  "prospecto.dias_sin_gestion_frio": "30",
  "visita.radio_validacion_gps": "500",
  "comision.porcentaje_default": "2.5",
  "comision.momento_causacion": "recaudo",
  "comision.base": "subtotal",
  "cartera.rango_1_hasta": "30",
  "cartera.rango_2_hasta": "60",
  "cartera.rango_3_hasta": "90",
  "cartera.dias_alerta_vencimiento": "5",
  "cartera.bloquear_por_mora": "true",
  "cartera.dias_mora_bloqueo": "15",
  "credito.validar_cupo": "true",
  "credito.dias_default": "30",
  "descuento.maximo_vendedor": "10",
  "pedido.requiere_doble_autorizacion": "true",
  "pedido.monto_autorizacion_gerencia": "0",
  // Sin valor de respaldo a proposito: si la clave no esta configurada, la
  // autorizacion se niega y avisa. Un respaldo aqui seria una clave por
  // defecto que nadie cambia.
  "pedido.clave_contabilidad": "",
  "pedido.clave_gerencia": "",
  "ruta.max_paradas_dia": "12",
  "ruta.velocidad_promedio_kmh": "35",
  // Si la base no responde, se valida en modo registro: bloquear a todos por
  // una caida de la base es peor que dejar pasar y dejar constancia.
  "seguridad.modo": "log",
  // Apagados si falta la fila: SAP nunca se enciende por omision.
  "integracion.sap.pedidos": "false",
  "integracion.sap.recaudos": "false",
  "integracion.sap.clientes": "false",
  "integracion.sap.facturas": "false",
  "integracion.sap.inventario": "false",
  "integracion.sap.sucursales": "false",
  "integracion.outbox.max_intentos": "5",
  "integracion.outbox.espera_min": "5",
  // Mismos valores que siembran los scripts 196 y 199: si falta la fila, el
  // sistema se comporta como con la configuracion de fabrica.
  "catalogo.modo": "todos",
  "inventario.mostrar_al_vendedor": "true",
  "pedido.aprobacion_modo": "secuencial",
  "credito.modo_cupo": "sobrecupo",
  "pedido.proyectar_al_aprobar": "true",
  "documentos.url_minutos": "10",
  "ia.lectura_comprobantes": "true",
  "ia.modelo_ocr": "claude-sonnet-5",
  "estado_cuenta.dias_movimientos": "90",
  "estado_cuenta.enlace_dias": "7",
  "estado_cuenta.nota": "Si ya realizó el pago, por favor haga caso omiso de este estado de cuenta y envíenos el soporte.",
  "prospecto.exigir_documentos": "true",
  "prospecto.enlace_dias": "7",
  "integracion.sap.prefijo_cliente": "C",
  "aprobaciones.horas_alerta": "24",
}

/** Como se llama cada grupo en la pantalla de Parametrizacion. */
export const GRUPOS_PARAMETROS: Record<string, string> = {
  fiscal: "Impuestos",
  cotizaciones: "Cotizaciones",
  prospectos: "Prospectos y visitas",
  comisiones: "Comisiones",
  cartera: "Cartera y cobranza",
  credito: "Credito",
  descuentos: "Descuentos",
  pedidos: "Pedidos y autorizaciones",
  rutas: "Rutas y planificacion",
  seguridad: "Seguridad",
  integracion: "Integraciones (SAP, LIPgo, WhatsApp)",
  catalogo: "Catálogo e inventario",
  documentos: "Documentos y comprobantes",
}

export interface CrmParametro {
  id: number
  idempresa: number
  clave: string
  valor: string
  tipo: "number" | "string" | "boolean" | "json" | "date"
  grupo: string
  etiqueta: string
  descripcion: string | null
  unidad: string | null
  min_valor: number | null
  max_valor: number | null
  vigente_desde: string
  vigente_hasta: string | null
  editable: boolean
  actualizado_por: string | null
  actualizado_en: string
  /** Solo en parametros secretos: el valor NUNCA viaja al navegador, y esto
   *  dice si ya se configuro o sigue con el valor de fabrica. */
  secreto?: { configurado: boolean }
}

/**
 * Parametros SECRETOS: su valor nunca sale del servidor. Las acciones publicas
 * los devuelven vacios; solo el codigo del servidor los lee, con
 * `leerParam` de crm-parametros-server.ts.
 */
export const PARAMS_SECRETOS: ReadonlySet<string> = new Set([
  "pedido.clave_contabilidad",
  "pedido.clave_gerencia",
])

/** Valor con el que se siembran las claves. Mientras siga asi, no protegen nada. */
export const VALOR_SECRETO_DE_FABRICA = "CAMBIAR"

/** Momentos en que puede causarse una comision (parametro COMISION_MOMENTO). */
export type MomentoComision = "recaudo" | "despacho" | "autorizacion"

export const MOMENTO_COMISION_LABEL: Record<MomentoComision, string> = {
  recaudo: "Cuando el cliente paga",
  despacho: "Cuando se despacha el pedido",
  autorizacion: "Cuando se autoriza el pedido",
}
