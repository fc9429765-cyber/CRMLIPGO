// Expediente del prospecto y su aprobacion (PRO-01..PRO-05).
//
// Tipos y reglas PURAS: las usan la pantalla del vendedor, la bandeja de
// Cartera, la pagina publica de carga y las pruebas. La regla de "que falta
// para poder enviar a Cartera" vive aqui una sola vez: si la pantalla y el
// servidor la calcularan por separado, el boton podria habilitarse y el
// servidor rechazar, que es lo peor que le puede pasar a un vendedor.

export type EstadoAprobacionProspecto = "borrador" | "pendiente_aprobacion" | "aprobado" | "rechazado"

export const ESTADO_APROBACION_LABEL: Record<EstadoAprobacionProspecto, string> = {
  borrador: "En preparación",
  pendiente_aprobacion: "En revisión de Cartera",
  aprobado: "Aprobado · ya es cliente",
  rechazado: "Rechazado",
}

export interface TipoDocumento {
  id: number
  codigo: string
  nombre: string
  obligatorio: boolean
  ayuda: string | null
  orden: number
}

export interface DocumentoExpediente {
  id: number
  tipo_documento_id: number | null
  nombre_archivo: string | null
  mime: string | null
  tamano: number | null
  estado: "pendiente" | "aprobado" | "rechazado"
  subido_nombre: string | null
  subido_en: string
  nota: string | null
}

/** Datos minimos para crear el cliente en LIPgo. */
export interface DatosProspectoMinimos {
  razon_social: string | null
  documento: string | null
  direccion: string | null
  ciudad: string | null
  contacto_nombre: string | null
  contacto_celular: string | null
  contacto_telefono: string | null
}

export interface ItemChecklist {
  tipo: TipoDocumento
  documentos: DocumentoExpediente[]
  /** Hay al menos uno que no esta rechazado. */
  cumplido: boolean
}

export interface EvaluacionExpediente {
  checklist: ItemChecklist[]
  /** Documentos obligatorios que faltan (o cuyos archivos fueron todos rechazados). */
  documentosFaltantes: string[]
  datosFaltantes: string[]
  /** true si se puede enviar a Cartera. */
  listo: boolean
}

/**
 * Que tiene y que le falta a un expediente. Un documento rechazado por
 * Cartera no cuenta: hay que subir otro.
 */
export function evaluarExpediente(
  tipos: TipoDocumento[],
  documentos: DocumentoExpediente[],
  datos: DatosProspectoMinimos,
  exigirDocumentos = true,
): EvaluacionExpediente {
  const ordenados = [...tipos].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const checklist = ordenados.map((tipo) => {
    const docs = documentos.filter((d) => d.tipo_documento_id === tipo.id)
    return { tipo, documentos: docs, cumplido: docs.some((d) => d.estado !== "rechazado") }
  })
  const documentosFaltantes = exigirDocumentos
    ? checklist.filter((c) => c.tipo.obligatorio && !c.cumplido).map((c) => c.tipo.nombre)
    : []

  const vacio = (v: string | null | undefined) => !v || !String(v).trim()
  const datosFaltantes: string[] = []
  if (vacio(datos.razon_social)) datosFaltantes.push("Razón social")
  if (vacio(datos.documento) || !/\d{5,}/.test(String(datos.documento).replace(/\D/g, ""))) datosFaltantes.push("NIT o documento")
  if (vacio(datos.direccion)) datosFaltantes.push("Dirección")
  if (vacio(datos.ciudad)) datosFaltantes.push("Ciudad")
  if (vacio(datos.contacto_nombre)) datosFaltantes.push("Nombre de contacto")
  if (vacio(datos.contacto_celular) && vacio(datos.contacto_telefono)) datosFaltantes.push("Celular o teléfono")

  return {
    checklist,
    documentosFaltantes,
    datosFaltantes,
    listo: documentosFaltantes.length === 0 && datosFaltantes.length === 0,
  }
}

/** Se puede editar el expediente (subir, borrar, enviar) en estos estados. */
export const puedeEditarExpediente = (estado: EstadoAprobacionProspecto) =>
  estado === "borrador" || estado === "rechazado"

/**
 * NIT sin digito de verificacion, como lo guarda LIPgo. Misma regla que la
 * funcion crm_nit_sin_dv del script 206: se usa aqui para avisar de un NIT
 * repetido ANTES de enviar, no solo al aprobar.
 */
export function nitSinDv(texto: string | null | undefined): number | null {
  const t = String(texto ?? "")
  if (!t.trim()) return null
  if (t.includes("-")) {
    const d = t.split("-")[0].replace(/\D/g, "")
    return d ? Number(d) : null
  }
  const d = t.replace(/\D/g, "")
  if (!d) return null
  if (d.length === 10 && /^[89]/.test(d)) return Number(d.slice(0, 9))
  return Number(d)
}
