// Qué hace cada módulo, en una frase, y sus capacidades como chips.
//
// Lo leen las tarjetas del portal de cada área (components/modules-view.tsx):
// una tarjeta que solo dice "Cuentas por Cobrar" obliga a entrar para saber
// si es lo que se busca; con la frase y los chips se decide desde afuera.
// La clave es el `name` del módulo (lib/dashboard-data.ts).

export interface InfoModulo {
  descripcion: string
  chips: string[]
}

export const INFO_MODULOS: Record<string, InfoModulo> = {
  // Inicio
  "Dashboard Comercial": { descripcion: "Ventas del mes, pronóstico del embudo, tasa de cierre y cartera vencida de un vistazo.", chips: ["KPIs", "Gráficas", "Vendedores"] },
  "Mi Agenda": { descripcion: "Los compromisos del vendedor: qué visita hoy, qué tiene atrasado y qué reprogramar.", chips: ["Hoy", "Atrasadas", "Semana"] },

  // Prospectos
  "Registrar Prospecto": { descripcion: "Alta del prospecto con ubicación en el mapa, contacto y productos de interés; desde su expediente se envía a Cartera.", chips: ["Mapa", "Expediente", "Documentos"] },
  "Aprobar Prospectos": { descripcion: "Cartera revisa los documentos, fija cupo y plazo y crea el cliente y su sucursal en LIPgo.", chips: ["Documentos", "Cupo", "LIPgo"] },
  "Embudo de Ventas": { descripcion: "Tablero por etapas: arrastra el prospecto para moverlo y mira cuánto hay en juego.", chips: ["Kanban", "Etapas", "Pronóstico"] },
  "Actividades": { descripcion: "Bitácora de llamadas, visitas y correos con prospectos y clientes, con GPS en las visitas.", chips: ["Visitas", "Llamadas", "GPS"] },
  "Calendario de Visitas": { descripcion: "Vista de mes con los compromisos programados del equipo.", chips: ["Mes", "Compromisos"] },

  // Ventas
  "Cotizaciones": { descripcion: "Emite cotizaciones con vigencia, descarga el PDF y conviértelas en pedido en un paso.", chips: ["PDF", "Vigencia", "Convertir"] },
  "Nueva Venta": { descripcion: "Pedido directo: ficha del cliente, catálogo con stock, precios por lista y sobrecupo a la vista.", chips: ["Ficha", "Catálogo", "Sobrecupo"] },
  "Pedidos CRM": { descripcion: "Todos los pedidos con filtros, su historial y el estado del despacho en LIPgo.", chips: ["Filtros", "Historial", "LIPgo"] },
  "Autorizar Pedidos": { descripcion: "Bandeja de firmas: primero Cartera, luego Gerencia, con la cartera del cliente al lado.", chips: ["Cartera", "Gerencia", "Clave"] },

  // Clientes
  "Gestión de Clientes": { descripcion: "Cupo, plazo, lista de precios, bloqueo y ubicación. Lista o mapa, y la Cuenta 360 de cada uno.", chips: ["Cuenta 360", "Mapa", "Catálogo"] },
  "Sucursales": { descripcion: "Los puntos de entrega de cada cliente, con su ubicación para despachar y planificar rutas.", chips: ["Ubicación", "Mapa"] },
  "Listas de Precios": { descripcion: "Precio fijo por producto o porcentaje de descuento, asignable por cliente.", chips: ["Precios", "Descuentos"] },

  // Cartera
  "Aprobaciones": { descripcion: "Torre de control: pedidos por firmar, recaudos por aprobar y clientes nuevos, lo más antiguo primero.", chips: ["Pedidos", "Recaudos", "Clientes nuevos"] },
  "Tablero de Cartera": { descripcion: "Cartera total, vencida por rango, mora y recaudo por mes; por cliente, vendedor y empresa.", chips: ["Rangos", "Recaudo", "Vendedores"] },
  "Cuentas por Cobrar": { descripcion: "Facturas abiertas con días, saldo vencido y rango; cada una con sus abonos y recaudos.", chips: ["Facturas", "Abonos", "Rangos"] },
  "Registrar Pago": { descripcion: "El vendedor reporta el pago con la foto del comprobante; la IA lo lee y propone el reparto.", chips: ["Foto", "IA", "Reparto"] },
  "Aprobar Recaudos": { descripcion: "Cartera revisa el comprobante, ajusta el reparto y aprueba: ahí se mueven los saldos.", chips: ["Comprobante", "Reparto", "Recibo"] },
  "Antigüedad de Cartera": { descripcion: "Aging por tramos y a quién cobrar primero.", chips: ["Tramos", "Prioridad"] },
  "Comisiones": { descripcion: "Liquidación de comisiones por vendedor y período, con el porcentaje congelado al liquidar.", chips: ["Liquidar", "Vendedores"] },

  // Inteligencia
  "Rutas Óptimas": { descripcion: "Orden de visita más corto a partir de la ubicación de los clientes, con mapa.", chips: ["Mapa", "Recorrido"] },
  "Oportunidades de Negocio": { descripcion: "Quién bajó volumen, quién dejó de comprar y qué venderle a quién.", chips: ["Señales", "Clientes"] },
  "Asistente IA": { descripcion: "Pregunta en lenguaje natural sobre tus clientes, pedidos y cartera; te lleva al módulo.", chips: ["Chat", "Datos", "Navega"] },
  "Reportes": { descripcion: "Informes comerciales para descargar.", chips: ["Informes"] },

  // Configuración
  "Productos": { descripcion: "Lo comercial del producto: fotos, descripción, precio base, owner e impuesto.", chips: ["Precios", "Fotos", "Owner"] },
  "Vendedores": { descripcion: "Zona, meta, comisión y el usuario con el que entra cada vendedor.", chips: ["Metas", "Usuarios"] },
  "Parametrización": { descripcion: "Las reglas del negocio: plazos, rangos, claves, integraciones. Sin tocar código.", chips: ["Reglas", "Vigencias"] },
  "Gestión de Usuarios": { descripcion: "Alta de usuarios, contraseñas y permisos por módulo.", chips: ["Permisos"] },
  "Bitácora de Auditoría": { descripcion: "Quién hizo qué y cuándo.", chips: ["Auditoría"] },
  "Maestros": { descripcion: "Owners, impuestos, bancos, cuentas destino, medios de pago, motivos y tipos de documento.", chips: ["Owners", "Bancos", "Motivos"] },
  "Importar datos": { descripcion: "Carga desde Excel con simulación previa: clientes, sucursales, saldos, facturas y notas crédito.", chips: ["Excel", "Simulación"] },
  "Integraciones": { descripcion: "Lo que sale hacia SAP, WhatsApp y LIPgo, con reintentos; mapeos y prueba de conexión SAP.", chips: ["SAP", "WhatsApp", "Bandeja"] },
}

export function infoDeModulo(nombre: string): InfoModulo {
  return INFO_MODULOS[nombre] ?? { descripcion: "", chips: [] }
}
