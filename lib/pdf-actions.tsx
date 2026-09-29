// SIN "use server" A PROPOSITO (se quito en la fase 3). Con la directiva,
// estas funciones eran invocables desde el navegador sin ningun control:
// imagenABase64 hacia que el servidor descargara CUALQUIER URL que se le
// pasara (incluidas direcciones internas), y subirPdf/subirArchivo dejaban
// subir archivos arbitrarios al bucket publico. Son utilidades del servidor:
// solo las importan otros modulos del servidor.

// Utilidades compartidas para generar PDF.
//
// Queda lo REUTILIZABLE de los nueve generadores que tenia LIPgo (ordenes de
// cargue, traslados, produccion, lotes, registro sanitario): la subida al
// Storage, el recorte de texto por ancho real y la conversion de imagenes.
// Los documentos concretos del CRM (cotizacion, pedido) viven en sus propios
// archivos y se apoyan en esto.
//
// RECETA DEL PROYECTO, heredada y conservada porque funciona:
//   import dinamico de jsPDF -> dibujar -> doc.output("blob")
//   -> storage.from("archivos").upload(carpeta/nombre)
//   -> getPublicUrl() -> guardar la URL en la fila que origino el documento
//
// El import de jsPDF es dinamico a proposito: es una libreria pesada que solo
// hace falta cuando de verdad se genera un PDF, y cargarla en el arranque del
// modulo penaliza cada peticion que no lo necesita.

import { getSupabaseAdmin } from "@/lib/supabase-admin"

/** Bucket unico de archivos del sistema. Es publico de lectura. */
const BUCKET = "archivos"

/**
 * Recorta `texto` para que quepa en `anchoMm` con el tamano de fuente ACTUAL
 * del documento, agregando un puntito suspensivo cuando sobra.
 *
 * Se mide con getTextWidth en vez de cortar por numero de caracteres: un corte
 * por caracteres no sabe cuanto ocupa el texto en la hoja, asi que un nombre
 * largo o en mayusculas se salia de su columna y se montaba sobre la
 * siguiente. Es el tipo de defecto que solo se ve cuando el documento ya esta
 * impreso y en manos del cliente.
 *
 * No se exporta: en un archivo "use server" todo export debe ser async, y esta
 * es sincrona. Los generadores la reciben por parametro o la reimplementan.
 */
function recortarAAncho(doc: any, texto: string, anchoMm: number): string {
  const t = String(texto ?? "")
  if (!t) return ""
  if (doc.getTextWidth(t) <= anchoMm) return t
  let out = t
  while (out.length > 1 && doc.getTextWidth(out + "…") > anchoMm) {
    out = out.slice(0, -1)
  }
  return out + "…"
}

/** Version async de recortarAAncho, para poder exportarla desde "use server". */
export async function recortarTexto(doc: any, texto: string, anchoMm: number): Promise<string> {
  return recortarAAncho(doc, texto, anchoMm)
}

/** Descarga una imagen y la devuelve como data URL, que es lo que acepta
 *  jsPDF.addImage. Se usa para el logo de la empresa en el encabezado. */
export async function imagenABase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const buffer = Buffer.from(await blob.arrayBuffer())
    return `data:${blob.type || "image/png"};base64,${buffer.toString("base64")}`
  } catch (error) {
    // Un logo que no carga no puede impedir que se emita el documento.
    console.error("[pdf] no se pudo cargar la imagen:", error)
    return null
  }
}

export interface ResultadoPdf {
  success: boolean
  url?: string
  error?: string
}

/**
 * Sube un PDF ya generado y devuelve su URL publica.
 *
 * @param blob    lo que devuelve doc.output("blob")
 * @param carpeta subcarpeta dentro del bucket: "cotizaciones", "pedidos"...
 * @param nombre  nombre del archivo, sin extension
 */
export async function subirPdf(
  blob: Blob,
  carpeta: string,
  nombre: string,
): Promise<ResultadoPdf> {
  try {
    const supabase = await getSupabaseAdmin()

    // Nombre saneado + marca de tiempo: evita colisiones y caracteres que
    // rompen la URL (un numero de cotizacion con barras, por ejemplo).
    const limpio = nombre.replace(/[^a-zA-Z0-9_-]/g, "_")
    const ruta = `${carpeta}/${limpio}_${Date.now()}.pdf`

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(ruta, blob, { contentType: "application/pdf", upsert: false })

    if (error) return { success: false, error: error.message }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
    return { success: true, url: data.publicUrl }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al subir el PDF"
    console.error("[pdf]", msg)
    return { success: false, error: msg }
  }
}

/** Sube un archivo cualquiera (soporte de pago, adjunto de actividad). */
export async function subirArchivo(
  archivo: File | Blob,
  carpeta: string,
  nombre: string,
  contentType?: string,
): Promise<ResultadoPdf> {
  try {
    const supabase = await getSupabaseAdmin()
    const limpio = nombre.replace(/[^a-zA-Z0-9_.-]/g, "_")
    const ruta = `${carpeta}/${Date.now()}_${limpio}`

    const { error } = await supabase.storage.from(BUCKET).upload(ruta, archivo, {
      contentType: contentType || (archivo as File).type || "application/octet-stream",
      upsert: false,
    })

    if (error) return { success: false, error: error.message }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta)
    return { success: true, url: data.publicUrl }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al subir el archivo"
    console.error("[pdf]", msg)
    return { success: false, error: msg }
  }
}
