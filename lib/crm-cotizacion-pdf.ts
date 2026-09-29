"use server"

// Documento de cotizacion en PDF.
//
// Sigue la receta del proyecto: import dinamico de jsPDF, dibujo imperativo,
// output("blob") y subida al Storage con la URL guardada en la fila.
//
// LA VIGENCIA VA DESTACADA. Es la diferencia entre una cotizacion y una lista
// de precios: si el cliente no ve hasta cuando le sirve, el documento no
// cumple su funcion y el vendedor termina discutiendo precios de hace meses.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { exigirPermiso } from "@/lib/crm-auth"
import { subirPdf } from "@/lib/pdf-actions"
import { numeroALetrasPesos } from "@/lib/numero-a-letras"
import type { CotizacionConDetalle } from "@/lib/crm-cotizaciones"

export interface ResultadoPdfCotizacion {
  success: boolean
  url?: string
  error?: string
}

const AZUL: [number, number, number] = [44, 82, 130]
const GRIS: [number, number, number] = [240, 242, 245]

const money = (n: number) =>
  "$ " + (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })

/** Recorta midiendo el ancho real: cortar por numero de caracteres deja
 *  nombres montados sobre la columna siguiente. */
function recortar(doc: any, texto: string, anchoMm: number): string {
  const t = String(texto ?? "")
  if (!t || doc.getTextWidth(t) <= anchoMm) return t
  let out = t
  while (out.length > 1 && doc.getTextWidth(out + "…") > anchoMm) out = out.slice(0, -1)
  return out + "…"
}

export async function generarPdfCotizacion(
  cotizacionId: number,
  empresaId = 1,
): Promise<ResultadoPdfCotizacion> {
  try {
    // Era invocable desde el navegador sin control: cualquiera con sesion
    // generaba el PDF de cualquier cotizacion, con precios y datos del cliente.
    const ctx = await exigirPermiso("generarPdfCotizacion", "crm_cotizaciones", "crm_pedidos")
    const supabase = await getSupabaseAdmin()

    const [cabRes, detRes] = await Promise.all([
      supabase.from("crm_cotizaciones").select("*").eq("id", cotizacionId).eq("idempresa", empresaId).maybeSingle(),
      supabase.from("crm_cotizacion_detalle").select("*").eq("cotizacion_id", cotizacionId).order("linea"),
    ])

    if (cabRes.error || !cabRes.data) {
      return { success: false, error: cabRes.error?.message ?? "La cotización no existe" }
    }

    const cot = cabRes.data as CotizacionConDetalle
    if (ctx.alcance === "propios" && cot.vendedor_id !== ctx.vendedorId) {
      return { success: false, error: "No encontrado" }
    }
    const lineas = detRes.data ?? []

    // Destinatario: cliente o prospecto, segun de donde venga.
    let destinatario = "—"
    let documento = ""
    let contacto = ""
    let direccion = ""

    if (cot.cliente_id) {
      const { data } = await supabase
        .from("clientes")
        .select("nombre, documento, personacontacto, celular, correo")
        .eq("id", cot.cliente_id).maybeSingle()
      if (data) {
        destinatario = data.nombre ?? "—"
        documento = data.documento ? `NIT/CC ${data.documento}` : ""
        contacto = [data.personacontacto, data.celular, data.correo].filter(Boolean).join(" · ")
      }
    } else if (cot.prospecto_id) {
      const { data } = await supabase
        .from("crm_prospectos")
        .select("razon_social, documento, contacto_nombre, contacto_celular, contacto_email, direccion, ciudad")
        .eq("id", cot.prospecto_id).maybeSingle()
      if (data) {
        destinatario = data.razon_social ?? "—"
        documento = data.documento ? `NIT/CC ${data.documento}` : ""
        contacto = [data.contacto_nombre, data.contacto_celular, data.contacto_email].filter(Boolean).join(" · ")
        direccion = [data.direccion, data.ciudad].filter(Boolean).join(", ")
      }
    }

    let vendedor = ""
    if (cot.vendedor_id) {
      const { data } = await supabase
        .from("vendedores").select("nombre").eq("idvendedor", cot.vendedor_id).maybeSingle()
      vendedor = data?.nombre ?? ""
    }

    const { data: empresa } = await supabase
      .from("empresas").select("nombre, nit, direccion").eq("id", empresaId).maybeSingle()

    // jsPDF se carga aqui y no arriba: es pesada y solo hace falta al generar.
    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter", unit: "mm" })

    const M = 15                       // margen
    const ANCHO = 210 - M * 2          // ancho util
    let y = 16

    // ---------------------------------------------------------- Encabezado
    doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(...AZUL)
    doc.text("COTIZACIÓN", M, y)

    doc.setFontSize(11).setTextColor(60)
    doc.text(cot.numero ?? "", 210 - M, y, { align: "right" })

    y += 6
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90)
    doc.text(empresa?.nombre ?? "", M, y)
    if (empresa?.nit) doc.text(`NIT ${empresa.nit}`, 210 - M, y, { align: "right" })

    if (empresa?.direccion) {
      y += 4
      doc.text(empresa.direccion, M, y)
    }

    y += 5
    doc.setDrawColor(...AZUL).setLineWidth(0.5).line(M, y, 210 - M, y)

    // -------------------------------------------------------- Destinatario
    y += 7
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(60)
    doc.text("PARA", M, y)

    y += 5
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(30)
    doc.text(recortar(doc, destinatario, 120), M, y)

    if (documento) {
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(110)
      doc.text(documento, 210 - M, y, { align: "right" })
    }

    if (contacto) {
      y += 4.5
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(110)
      doc.text(recortar(doc, contacto, ANCHO), M, y)
    }
    if (direccion) {
      y += 4
      doc.text(recortar(doc, direccion, ANCHO), M, y)
    }

    // ------------------------------------------------------- LA VIGENCIA
    // Caja destacada: es el dato que distingue una cotizacion de una lista de
    // precios, y el que evita discutir despues sobre precios caducados.
    y += 7
    doc.setFillColor(...GRIS)
    doc.roundedRect(M, y, ANCHO, 14, 2, 2, "F")

    const anchoTercio = ANCHO / 3
    const etiquetas: [string, string][] = [
      ["Emitida", cot.fecha_emision],
      ["Válida hasta", cot.fecha_vencimiento],
      ["Forma de pago", cot.forma_pago === "credito" ? `Crédito ${cot.dias_credito} días` : "Contado"],
    ]

    etiquetas.forEach(([etiqueta, valor], i) => {
      const x = M + 4 + anchoTercio * i
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120)
      doc.text(etiqueta.toUpperCase(), x, y + 5)
      // El vencimiento en azul y negrita: es lo primero que debe saltar.
      const destacado = i === 1
      doc.setFont("helvetica", "bold").setFontSize(destacado ? 10 : 9)
      doc.setTextColor(...(destacado ? AZUL : [40, 40, 40] as [number, number, number]))
      doc.text(String(valor ?? ""), x, y + 10.5)
    })

    y += 20

    // ---------------------------------------------------------- Tabla
    const COLS = { n: M + 2, prod: M + 10, cant: M + 105, precio: M + 128, dto: M + 152, total: 210 - M - 2 }

    doc.setFillColor(...AZUL)
    doc.rect(M, y, ANCHO, 7, "F")
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(255)
    doc.text("#", COLS.n, y + 4.8)
    doc.text("PRODUCTO", COLS.prod, y + 4.8)
    doc.text("CANT.", COLS.cant, y + 4.8, { align: "right" })
    doc.text("PRECIO", COLS.precio, y + 4.8, { align: "right" })
    doc.text("DTO.", COLS.dto, y + 4.8, { align: "right" })
    doc.text("TOTAL", COLS.total, y + 4.8, { align: "right" })

    y += 7

    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(40)

    for (const [i, l] of lineas.entries()) {
      // Salto de pagina cuando ya no cabe otra fila mas los totales.
      if (y > 235) {
        doc.addPage()
        y = 20
      }

      if (i % 2 === 1) {
        doc.setFillColor(250, 250, 252)
        doc.rect(M, y, ANCHO, 6, "F")
      }

      doc.setTextColor(140).text(String(l.linea), COLS.n, y + 4.2)
      doc.setTextColor(40).text(recortar(doc, l.producto_nombre, 90), COLS.prod, y + 4.2)
      doc.text(
        `${Number(l.cantidad).toLocaleString("es-CO")}${l.unidad ? " " + l.unidad : ""}`,
        COLS.cant, y + 4.2, { align: "right" },
      )
      doc.text(money(l.precio_unitario), COLS.precio, y + 4.2, { align: "right" })
      doc.text(
        Number(l.descuento_pct) > 0 ? `${Number(l.descuento_pct)}%` : "—",
        COLS.dto, y + 4.2, { align: "right" },
      )
      doc.setFont("helvetica", "bold").text(money(l.subtotal), COLS.total, y + 4.2, { align: "right" })
      doc.setFont("helvetica", "normal")

      y += 6
    }

    doc.setDrawColor(220).setLineWidth(0.2).line(M, y, 210 - M, y)

    // ---------------------------------------------------------- Totales
    y += 6
    const xEtiqueta = 210 - M - 60
    const filas: [string, string, boolean][] = [
      ["Subtotal", money(cot.subtotal), false],
      ...(Number(cot.descuento_valor) > 0
        ? ([["Descuento", "- " + money(cot.descuento_valor), false]] as [string, string, boolean][])
        : []),
      [`IVA (${Number(cot.iva_pct)}%)`, money(cot.iva_valor), false],
      ["TOTAL", money(cot.total), true],
    ]

    for (const [etiqueta, valor, destacado] of filas) {
      if (destacado) {
        y += 1
        doc.setFillColor(...AZUL)
        doc.rect(xEtiqueta - 3, y - 1, 63, 8, "F")
        doc.setTextColor(255).setFont("helvetica", "bold").setFontSize(10)
      } else {
        doc.setTextColor(70).setFont("helvetica", "normal").setFontSize(9)
      }
      doc.text(etiqueta, xEtiqueta, y + 4.5)
      doc.text(valor, COLS.total, y + 4.5, { align: "right" })
      y += destacado ? 9 : 5.5
    }

    // Total en letras: se exige en los documentos comerciales colombianos.
    y += 3
    doc.setFont("helvetica", "italic").setFontSize(7.5).setTextColor(110)
    doc.text(recortar(doc, `Son: ${numeroALetrasPesos(Number(cot.total))}`, ANCHO), M, y)

    // ------------------------------------------------------ Observaciones
    if (cot.observaciones) {
      y += 8
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(60)
      doc.text("OBSERVACIONES", M, y)
      y += 4.5
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90)
      for (const l of doc.splitTextToSize(cot.observaciones, ANCHO) as string[]) {
        doc.text(l, M, y)
        y += 4
      }
    }

    // ------------------------------------------------------------- Pie
    const yPie = 262
    doc.setDrawColor(220).setLineWidth(0.2).line(M, yPie, 210 - M, yPie)
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(130)

    doc.text(
      `Esta cotización es válida hasta el ${cot.fecha_vencimiento}. Los precios pueden variar después de esa fecha.`,
      M, yPie + 5,
    )
    if (vendedor) doc.text(`Atendido por: ${vendedor}`, M, yPie + 9)

    doc.text(
      `Generada el ${new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}`,
      210 - M, yPie + 9, { align: "right" },
    )

    // ------------------------------------------------------------ Subida
    const blob = doc.output("blob") as Blob
    const subida = await subirPdf(blob, "cotizaciones", cot.numero ?? `cot_${cotizacionId}`)

    if (!subida.success || !subida.url) {
      return { success: false, error: subida.error ?? "No se pudo subir el PDF" }
    }

    await supabase.from("crm_cotizaciones").update({ pdf_url: subida.url }).eq("id", cotizacionId)

    return { success: true, url: subida.url }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al generar el PDF"
    console.error("[crm-cotizacion-pdf]", msg)
    return { success: false, error: msg }
  }
}
