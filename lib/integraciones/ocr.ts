// Lectura de comprobantes de pago con IA (REC-20, REC-21, INT-13).
//
// SIN "use server": solo lo usan acciones del servidor. La clave de Anthropic
// nunca sale al navegador.
//
// QUE HACE: recibe la foto o el PDF del comprobante y devuelve fecha, valor,
// banco, referencia y cuenta destino, mas un veredicto de LEGIBILIDAD. Si la
// imagen esta borrosa, cortada o no es un comprobante, lo dice y explica por
// que, para que el vendedor la tome de nuevo alli mismo (REC-21) en vez de que
// Cartera la rechace dias despues.
//
// LO QUE NO HACE: aprobar. La IA prellena el formulario y señala diferencias;
// quien decide es Cartera. Un modelo que lee "1.500.000" como "15.000.000" no
// puede mover la cartera de un cliente.
//
// DESACTIVABLE: con el parametro `ia.lectura_comprobantes = false`, o sin
// ANTHROPIC_API_KEY, devuelve `{ disponible: false }` y el vendedor digita todo.

import { generateText, Output } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { z } from "zod"

export const esquemaComprobante = z.object({
  legible: z.boolean().describe("true si se puede leer con confianza el valor y la fecha del pago"),
  motivo_ilegible: z
    .string()
    .nullable()
    .describe("Si no es legible: por que, en español y en una frase dirigida al vendedor (ej. 'La foto está borrosa: el valor no se alcanza a leer')"),
  es_comprobante: z.boolean().describe("true si la imagen es un comprobante de pago, consignación, transferencia o recibo"),
  valor: z.number().nullable().describe("Valor pagado en pesos colombianos, como número sin separadores"),
  fecha: z.string().nullable().describe("Fecha del pago en formato AAAA-MM-DD"),
  banco: z.string().nullable().describe("Banco o entidad del pago, tal como aparece"),
  referencia: z.string().nullable().describe("Número de referencia, aprobación, comprobante o transacción"),
  cuenta_destino: z.string().nullable().describe("Últimos dígitos o nombre de la cuenta que recibe el dinero, si aparece"),
  confianza: z.number().min(0).max(1).describe("Confianza global en los datos extraídos, de 0 a 1"),
})

export type LecturaComprobante = z.infer<typeof esquemaComprobante>

export type ResultadoOcr =
  | { disponible: true; lectura: LecturaComprobante; modelo: string }
  | { disponible: false; motivo: string }

const INSTRUCCIONES = `Eres el asistente de cartera de una empresa colombiana. Recibes la foto o el PDF de un comprobante de pago (consignación, transferencia, recibo de caja, pantallazo de banca móvil) y extraes sus datos.

Reglas:
- Los valores están en pesos colombianos. En Colombia el punto separa miles y la coma los decimales: "1.500.000" es un millón quinientos mil. Devuelve el número sin separadores.
- Las fechas suelen venir como día/mes/año. Devuélvelas como AAAA-MM-DD.
- Si un dato no aparece o no se alcanza a leer con seguridad, devuélvelo como null. NO adivines: un dato inventado es peor que uno vacío.
- Marca legible=false si no se puede leer con confianza el VALOR o la FECHA (foto borrosa, cortada, con reflejo, muy oscura, de lejos). Explica el motivo en una frase corta y útil para quien tomó la foto.
- Marca es_comprobante=false si la imagen no es un comprobante de pago.`

export async function leerComprobante(
  archivo: Uint8Array,
  mime: string,
  opciones: { activo: boolean; modelo: string },
): Promise<ResultadoOcr> {
  if (!opciones.activo) return { disponible: false, motivo: "La lectura con IA está desactivada" }
  if (!process.env.ANTHROPIC_API_KEY) return { disponible: false, motivo: "Falta ANTHROPIC_API_KEY" }

  const esPdf = mime === "application/pdf"
  try {
    const r = await generateText({
      model: anthropic(opciones.modelo),
      output: Output.object({ schema: esquemaComprobante }),
      system: INSTRUCCIONES,
      messages: [
        {
          role: "user",
          content: [
            esPdf
              ? { type: "file", data: archivo, mediaType: "application/pdf" }
              : { type: "image", image: archivo, mediaType: mime },
            { type: "text", text: "Extrae los datos de este comprobante." },
          ],
        },
      ],
      // Poca temperatura: se quiere lectura, no creatividad.
      temperature: 0,
      maxRetries: 1,
    })
    if (!r.output) return { disponible: false, motivo: "La IA no devolvió datos" }
    return { disponible: true, lectura: r.output, modelo: opciones.modelo }
  } catch (e) {
    // Si la IA falla, el recaudo sigue: se digita a mano. Nunca se bloquea el
    // registro de un pago porque un servicio externo no respondio.
    return { disponible: false, motivo: e instanceof Error ? e.message : "Error al leer el comprobante" }
  }
}
