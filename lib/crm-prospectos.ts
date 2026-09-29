// Tipos del embudo comercial.
//
// SIN "use server": las funciones viven en crm-prospectos-actions.ts, que si
// lleva la directiva y por eso solo puede exportar funciones async.

export interface Etapa {
  id: number
  idempresa: number
  nombre: string
  orden: number
  /** 0-100. Pondera el pronostico: un negocio en Negociacion vale mas que uno
   *  en Contacto inicial aunque el monto sea igual. */
  probabilidad: number
  es_ganada: boolean
  es_perdida: boolean
  color: string | null
  activo: boolean
}

export interface Prospecto {
  id: number
  idempresa: number
  codigo: string | null

  razon_social: string
  nombre_comercial: string | null
  documento: string | null
  tipo_documento: string | null

  contacto_nombre: string | null
  contacto_cargo: string | null
  contacto_celular: string | null
  contacto_telefono: string | null
  contacto_email: string | null

  direccion: string | null
  barrio: string | null
  ciudad: string | null
  departamento: string | null

  latitud: number | null
  longitud: number | null
  /** Exactitud en metros que reporto el navegador. Por encima de ~100 casi
   *  seguro es ubicacion por IP, no GPS. */
  gps_precision_m: number | null
  gps_capturado_en: string | null

  etapa_id: number
  vendedor_id: number | null
  valor_estimado: number
  probabilidad_manual: number | null
  fuente: string | null

  proxima_accion: string | null
  proxima_fecha: string | null
  proxima_hora: string | null

  motivo_perdida: string | null
  fecha_cierre: string | null
  cliente_id: number | null
  convertido_en: string | null

  observaciones: string | null
  activo: boolean
  creado_por: string | null
  creado_en: string
  actualizado_en: string

  /** Paso a cliente (script 206). Opcional: antes del script no existe. */
  estado_aprobacion?: "borrador" | "pendiente_aprobacion" | "aprobado" | "rechazado"
  motivo_rechazo?: string | null
}

/** Prospecto con su etapa ya resuelta, que es como lo pide la interfaz. */
export interface ProspectoConEtapa extends Prospecto {
  etapa?: Pick<Etapa, "id" | "nombre" | "color"> &
    Partial<Pick<Etapa, "orden" | "probabilidad" | "es_ganada" | "es_perdida">>
}

export interface ProspectoInteres {
  id: number
  idempresa: number
  prospecto_id: number
  producto_id: number | null
  producto_nombre: string
  cantidad: number | null
  unidad: string | null
  frecuencia: string | null
  /** Lo que hoy paga a su proveedor actual: el dato mas util para la oferta. */
  precio_referencia: number | null
  observacion: string | null
  creado_en: string
}

export interface Actividad {
  id: number
  idempresa: number
  prospecto_id: number | null
  cliente_id: number | null
  tipo: TipoActividad
  asunto: string
  detalle: string | null
  resultado: string | null
  fecha_hora: string
  duracion_min: number | null
  latitud: number | null
  longitud: number | null
  gps_precision_m: number | null
  vendedor_id: number | null
  usuario: string | null
  adjunto_url: string | null
  creado_en: string
}

export type TipoActividad = "llamada" | "visita" | "correo" | "whatsapp" | "reunion" | "nota"

export const TIPOS_ACTIVIDAD: { valor: TipoActividad; etiqueta: string }[] = [
  { valor: "visita", etiqueta: "Visita" },
  { valor: "llamada", etiqueta: "Llamada" },
  { valor: "whatsapp", etiqueta: "WhatsApp" },
  { valor: "correo", etiqueta: "Correo" },
  { valor: "reunion", etiqueta: "Reunión" },
  { valor: "nota", etiqueta: "Nota" },
]

export const RESULTADOS_ACTIVIDAD = [
  { valor: "exitoso", etiqueta: "Exitoso" },
  { valor: "sin_contacto", etiqueta: "Sin contacto" },
  { valor: "reprogramar", etiqueta: "Hay que reprogramar" },
]

export const FUENTES_PROSPECTO = [
  "Referido",
  "Visita en frío",
  "Feria o evento",
  "Sitio web",
  "Llamada entrante",
  "Redes sociales",
  "Otro",
]

export const FRECUENCIAS_COMPRA = [
  { valor: "semanal", etiqueta: "Semanal" },
  { valor: "quincenal", etiqueta: "Quincenal" },
  { valor: "mensual", etiqueta: "Mensual" },
  { valor: "esporadica", etiqueta: "Esporádica" },
]

/** Lo que manda el formulario al crear. El codigo lo pone un trigger. */
export interface NuevoProspecto
  extends Partial<Omit<Prospecto, "id" | "codigo" | "creado_en" | "actualizado_en">> {
  razon_social: string
  interes?: Omit<ProspectoInteres, "id" | "prospecto_id" | "idempresa" | "creado_en">[]
}

export interface ResumenEmbudo {
  porEtapa: {
    etapa: Etapa
    cantidad: number
    valor: number
    /** Valor por probabilidad: el pronostico realista. */
    valorPonderado: number
  }[]
  totalProspectos: number
  /** Solo etapas abiertas: ganadas y perdidas ya no son pipeline. */
  valorTotal: number
  valorPonderado: number
}

/** Por encima de esta precision, la ubicacion no es GPS sino deduccion por IP:
 *  parece un dato bueno y no lo es, asi que la interfaz lo advierte. */
export const GPS_PRECISION_SOSPECHOSA_M = 100

export function esGpsConfiable(precisionM: number | null | undefined): boolean {
  return precisionM != null && precisionM <= GPS_PRECISION_SOSPECHOSA_M
}
