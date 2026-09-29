// Preparacion de un archivo en el navegador antes de subirlo.
//
// Las fotos de celular pesan 5-12 MB y Vercel corta el cuerpo de una peticion
// en ~4.5 MB: sin comprimir, la subida falla en produccion aunque en local
// funcione. Se reducen a 1600 px (legibles para Cartera y para la IA). Un PDF
// no se puede comprimir aqui: si pesa demasiado, se avisa.

import { compressImageIfNeeded } from "@/lib/image-compress"

export const TIPOS_ACEPTADOS = "image/jpeg,image/png,image/webp,application/pdf"
const LIMITE = 4 * 1024 * 1024

export async function prepararArchivo(original: File): Promise<{ archivo: File } | { error: string }> {
  if (!TIPOS_ACEPTADOS.split(",").includes(original.type)) {
    return { error: "Solo se aceptan fotos (JPG, PNG, WebP) o PDF" }
  }
  const archivo = await compressImageIfNeeded(original)
  if (archivo.size > LIMITE) {
    return { error: `Pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 4 MB. Si es un PDF, guárdalo más liviano o sube una foto.` }
  }
  return { archivo }
}
