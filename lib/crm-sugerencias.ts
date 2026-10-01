// Sugerencias del asistente segun donde este parado el usuario.
//
// SIN "use server": es una funcion pura sobre constantes.
//
// El asistente arranca con la pantalla en blanco y eso intimida: nadie sabe
// que se le puede preguntar. Estas sugerencias son el empujon inicial, y
// cambian segun el modulo para que sean pertinentes.

/** Preguntas de arranque cuando no hay contexto de modulo. */
const GENERALES = [
  "¿Cuánto vendimos este mes?",
  "¿Qué visitas tengo mañana?",
  "¿Cuánta cartera está vencida?",
]

/** Por modulo. La clave debe coincidir con `Module.name` de dashboard-data. */
const POR_MODULO: Record<string, string[]> = {
  "Dashboard Comercial": [
    "¿Cómo vamos contra la meta del mes?",
    "¿Qué vendedor va mejor?",
    "¿Cuánto hay en negociación?",
  ],
  "Mi Agenda": [
    "¿Qué tengo pendiente hoy?",
    "¿Qué visitas quedaron sin cumplir?",
  ],
  "Registrar Prospecto": [
    "¿Cuántos prospectos nuevos van este mes?",
    "¿De dónde vienen los prospectos que más cierran?",
  ],
  "Embudo de Ventas": [
    "¿Cuántos prospectos hay en cada etapa?",
    "¿Cuánto vale el embudo ponderado?",
    "¿Qué prospectos llevan más tiempo sin moverse?",
  ],
  "Actividades": [
    "¿Cuántas visitas se hicieron esta semana?",
    "¿Qué clientes no reciben contacto hace un mes?",
  ],
  "Calendario de Visitas": [
    "¿Cómo está la agenda de esta semana?",
    "¿Quién tiene más visitas programadas?",
  ],
  "Cotizaciones": [
    "¿Qué cotizaciones están por vencer?",
    "¿Cuántas se aceptaron este mes?",
    "¿Cuál es el monto promedio de una cotización?",
  ],
  "Pedidos CRM": [
    "¿Qué pedidos están esperando autorización?",
    "¿Cuánto se ha pedido este mes?",
  ],
  "Autorizar Pedidos": [
    "¿Qué pedidos esperan mi firma?",
    "¿Cuál es el pedido más grande pendiente?",
  ],
  "Gestión de Clientes": [
    "¿Qué clientes están cerca de su cupo de crédito?",
    "¿Qué clientes no compran hace tres meses?",
  ],
  "Listas de Precios": [
    "¿Qué clientes tienen lista de precios asignada?",
    "¿Cuál es la lista con más descuento?",
  ],
  "Aprobaciones": [
    "¿Qué pedidos llevan más tiempo esperando aprobación?",
    "¿Cuántos recaudos hay por aprobar?",
  ],
  "Tablero de Cartera": [
    "¿Qué vendedor tiene más cartera vencida?",
    "¿Cuánto se recaudó este mes frente al anterior?",
  ],
  "Cuentas por Cobrar": [
    "¿Cuánto nos deben en total?",
    "¿Qué facturas vencen esta semana?",
    "¿Quién es el cliente con más mora?",
  ],
  "Antigüedad de Cartera": [
    "¿Cómo está repartida la cartera por antigüedad?",
    "¿Cuánto hay a más de 90 días?",
  ],
  "Comisiones": [
    "¿Cuánto lleva comisionado cada vendedor?",
    "¿Qué comisiones están pendientes de pago?",
  ],
  "Rutas Óptimas": [
    "¿Qué clientes debería visitar mañana?",
    "¿Cómo agrupo las visitas de esta semana por zona?",
  ],
  "Oportunidades de Negocio": [
    "¿Qué clientes bajaron su compra?",
    "¿Dónde hay oportunidad de venta cruzada?",
  ],
}

/** Sugerencias para el modulo indicado; generales si no hay o no se reconoce. */
export function sugerenciasDe(contexto?: string | null): string[] {
  if (!contexto) return GENERALES
  return POR_MODULO[contexto] ?? GENERALES
}
