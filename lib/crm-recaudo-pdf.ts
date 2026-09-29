"use server"

// Documento de pago y recibo de caja de un recaudo (REC-24, EDC-03).
//
// UN SOLO DOCUMENTO, DOS MOMENTOS:
//   - pendiente o rechazado → "DOCUMENTO DE PAGO", provisional: prueba de que
//     el vendedor reporto el pago y muestra como quedaria la cuenta si Cartera
//     aprueba el reparto propuesto.
//   - aprobado → "RECIBO DE CAJA" definitivo, con quien aprobo.
//   - anulado → el mismo documento marcado ANULADO, para reimprimir sin que
//     parezca vigente.
//
// NO SE SUBE A STORAGE. La cotizacion va al bucket publico porque se le envia
// al cliente; esto lleva saldos y referencias bancarias, y un enlace publico
// quedaria abierto para siempre. Se genera al vuelo y viaja en base64 solo a
// quien pudo ver el recaudo (getRecaudo ya valida permiso y alcance).

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getRecaudo } from "@/lib/crm-recaudos-actions"
import { numeroALetrasPesos } from "@/lib/numero-a-letras"
import { hoyISO } from "@/lib/crm-fechas"

export interface ResultadoPdfRecaudo {
  success: boolean
  /** PDF en base64, listo para `data:application/pdf;base64,…`. */
  base64?: string
  nombreArchivo?: string
  error?: string
}

const AZUL: [number, number, number] = [44, 82, 130]
const GRIS: [number, number, number] = [240, 242, 245]

const money = (n: number) => "$ " + (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })

function recortar(doc: any, texto: string, anchoMm: number): string {
  const t = String(texto ?? "")
  if (!t || doc.getTextWidth(t) <= anchoMm) return t
  let out = t
  while (out.length > 1 && doc.getTextWidth(out + "…") > anchoMm) out = out.slice(0, -1)
  return out + "…"
}

export async function generarPdfRecaudo(recaudoId: number, empresaId = 1): Promise<ResultadoPdfRecaudo> {
  try {
    const res = await getRecaudo(recaudoId, empresaId)
    if (!res.success || !res.data) return { success: false, error: res.error ?? "No encontrado" }
    const r = res.data
    const db = await getSupabaseAdmin()

    const [{ data: cli }, { data: owner }, { data: empresa }, { data: abiertas }] = await Promise.all([
      db.from("clientes").select("nombre, documento").eq("id", r.cliente_id).maybeSingle(),
      r.owner_id
        ? db.from("crm_owners").select("nombre, nombre_empresafactura").eq("id", r.owner_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("empresas").select("nombre, nit, direccion").eq("id", empresaId).maybeSingle(),
      (() => {
        let q = db.from("crm_cuentas_cobrar")
          .select("id, numero_factura, fecha_factura, fecha_vencimiento, saldo, estado")
          .eq("idempresa", empresaId).eq("cliente_id", r.cliente_id).in("estado", ["pendiente", "parcial"])
        if (r.owner_id) q = q.eq("owner_id", r.owner_id)
        return q.order("fecha_vencimiento")
      })(),
    ])

    const aprobado = r.estado === "aprobado"
    const anulado = r.estado === "anulado"
    const titulo = aprobado || (anulado && r.aprobado_en) ? "RECIBO DE CAJA" : "DOCUMENTO DE PAGO"
    const emisor = (owner as { nombre_empresafactura?: string } | null)?.nombre_empresafactura ?? empresa?.nombre ?? ""
    const aplicaciones = (r.aplicaciones ?? []).filter((a) => Number(a.valor_aplicado) > 0 || Number(a.valor_descuento) > 0)
    const totalAplicado = aplicaciones.reduce((s, a) => s + Number(a.valor_aplicado), 0)
    const saldoFavor = aprobado ? Number(r.saldo_favor_valor) || 0 : Math.max(0, Number(r.valor) - totalAplicado)

    // Estado de cuenta tras el pago. Aprobado: los saldos ya son los de hoy.
    // Pendiente: saldo de hoy menos lo que se propone aplicar a cada factura.
    const propuesto = new Map(aplicaciones.map((a) => [a.cuenta_cobrar_id, Number(a.valor_aplicado) + Number(a.valor_descuento)]))
    const cuentaTras = (abiertas ?? []).map((c) => ({
      numero: (c.numero_factura as string) ?? `CxC ${c.id}`,
      vence: c.fecha_vencimiento as string,
      saldo: Math.max(0, Number(c.saldo) - (aprobado || anulado ? 0 : propuesto.get(c.id as number) ?? 0)),
    })).filter((c) => c.saldo > 0)
    const hoy = hoyISO()

    const { default: jsPDF } = await import("jspdf")
    const doc = new jsPDF({ format: "letter", unit: "mm" })
    const M = 15
    const ANCHO = 210 - M * 2
    const DER = 210 - M
    let y = 16

    // ---------------------------------------------------------- Encabezado
    doc.setFont("helvetica", "bold").setFontSize(17).setTextColor(...AZUL)
    doc.text(titulo, M, y)
    doc.setFontSize(11).setTextColor(60)
    doc.text(r.numero ?? `#${r.id}`, DER, y, { align: "right" })

    y += 6
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90)
    doc.text(recortar(doc, emisor, 130), M, y)
    if (empresa?.nit && !owner) doc.text(`NIT ${empresa.nit}`, DER, y, { align: "right" })
    y += 5
    doc.setDrawColor(...AZUL).setLineWidth(0.5).line(M, y, DER, y)

    if (!aprobado && !anulado) {
      y += 6
      doc.setFillColor(255, 247, 230).roundedRect(M, y - 4, ANCHO, 7, 1.5, 1.5, "F")
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(150, 90, 0)
      doc.text(
        r.estado === "rechazado"
          ? `RECHAZADO por Cartera: ${recortar(doc, r.motivo_rechazo ?? "", 140)}`
          : "PROVISIONAL · Sujeto a aprobación de Cartera. Los saldos cambian solo al aprobarse.",
        M + 3, y + 0.8,
      )
    }

    // -------------------------------------------------------------- Cliente
    y += 9
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(60)
    doc.text("RECIBIDO DE", M, y)
    y += 5
    doc.setFontSize(11).setTextColor(30)
    doc.text(recortar(doc, cli?.nombre ?? r.cliente_nombre ?? "—", 130), M, y)
    if (cli?.documento) {
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(110)
      doc.text(`NIT/CC ${cli.documento}`, DER, y, { align: "right" })
    }

    // --------------------------------------------------------- Datos del pago
    y += 6
    doc.setFillColor(...GRIS).roundedRect(M, y, ANCHO, 22, 2, 2, "F")
    const celdas: [string, string][] = [
      ["Fecha del pago", r.fecha_documento],
      ["Medio", r.medio_pago_nombre ?? "—"],
      ["Banco", r.banco_nombre ?? "—"],
      ["Cuenta destino", r.cuenta_destino_alias ?? "—"],
      ["Referencia", r.referencia ?? "—"],
      ["Valor recibido", money(r.valor)],
    ]
    const ancho3 = ANCHO / 3
    celdas.forEach(([et, v], i) => {
      const x = M + 4 + ancho3 * (i % 3)
      const yy = y + (i < 3 ? 5 : 15)
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120)
      doc.text(et.toUpperCase(), x, yy)
      const destacado = i === 5
      doc.setFont("helvetica", "bold").setFontSize(destacado ? 10.5 : 9)
      doc.setTextColor(...(destacado ? AZUL : [40, 40, 40] as [number, number, number]))
      doc.text(recortar(doc, v, ancho3 - 6), x, yy + 4.8)
    })
    y += 28

    // ------------------------------------------------------ Facturas pagadas
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(60)
    doc.text(aprobado ? "APLICADO A LAS FACTURAS" : "APLICACIÓN PROPUESTA (la más vencida primero)", M, y)
    y += 3
    const C = { fac: M + 2, vence: M + 48, ant: M + 98, apl: M + 126, dto: M + 150, fin: DER - 2 }
    const cabecera = (yy: number) => {
      doc.setFillColor(...AZUL).rect(M, yy, ANCHO, 7, "F")
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(255)
      doc.text("FACTURA", C.fac, yy + 4.8)
      doc.text("VENCE", C.vence, yy + 4.8)
      doc.text("SALDO ANTES", C.ant, yy + 4.8, { align: "right" })
      doc.text("APLICADO", C.apl, yy + 4.8, { align: "right" })
      doc.text("DESCUENTO", C.dto, yy + 4.8, { align: "right" })
      doc.text("SALDO FINAL", C.fin, yy + 4.8, { align: "right" })
    }
    cabecera(y)
    y += 7
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(40)
    if (!aplicaciones.length) {
      doc.setTextColor(120).text("Sin facturas abiertas: todo el valor queda como saldo a favor.", C.fac, y + 4.2)
      y += 6
    }
    for (const [i, a] of aplicaciones.entries()) {
      if (y > 240) { doc.addPage(); y = 20; cabecera(y); y += 7; doc.setFont("helvetica", "normal").setFontSize(8) }
      if (i % 2 === 1) doc.setFillColor(250, 250, 252).rect(M, y, ANCHO, 6, "F")
      doc.setTextColor(40)
      doc.text(recortar(doc, a.numero_factura ?? `CxC ${a.cuenta_cobrar_id}`, 44), C.fac, y + 4.2)
      doc.text(a.fecha_vencimiento ?? "—", C.vence, y + 4.2)
      doc.text(money(Number(a.saldo_anterior)), C.ant, y + 4.2, { align: "right" })
      doc.setFont("helvetica", "bold").text(money(Number(a.valor_aplicado)), C.apl, y + 4.2, { align: "right" })
      doc.setFont("helvetica", "normal")
      doc.text(Number(a.valor_descuento) > 0 ? money(Number(a.valor_descuento)) : "—", C.dto, y + 4.2, { align: "right" })
      doc.text(money(Number(a.saldo_posterior)), C.fin, y + 4.2, { align: "right" })
      y += 6
    }
    doc.setDrawColor(220).setLineWidth(0.2).line(M, y, DER, y)

    // --------------------------------------------------------------- Totales
    y += 5
    const xEt = DER - 70
    const filas: [string, string, boolean][] = [
      ["Valor recibido", money(r.valor), false],
      ["Aplicado a facturas", money(totalAplicado), false],
      ...(saldoFavor > 0 ? [["Saldo a favor del cliente", money(saldoFavor), false] as [string, string, boolean]] : []),
      ["TOTAL RECIBIDO", money(r.valor), true],
    ]
    for (const [et, v, dest] of filas) {
      if (dest) {
        y += 1
        doc.setFillColor(...AZUL).rect(xEt - 3, y - 1, 73, 8, "F")
        doc.setTextColor(255).setFont("helvetica", "bold").setFontSize(10)
      } else {
        doc.setTextColor(70).setFont("helvetica", "normal").setFontSize(9)
      }
      doc.text(et, xEt, y + 4.5)
      doc.text(v, C.fin, y + 4.5, { align: "right" })
      y += dest ? 9 : 5.5
    }
    y += 2
    doc.setFont("helvetica", "italic").setFontSize(7.5).setTextColor(110)
    doc.text(recortar(doc, `Son: ${numeroALetrasPesos(Number(r.valor))}`, ANCHO), M, y)

    // -------------------------------------------- Estado de cuenta tras el pago
    y += 9
    if (y > 225) { doc.addPage(); y = 20 }
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(60)
    doc.text(aprobado ? "ESTADO DE CUENTA DESPUÉS DEL PAGO" : "ESTADO DE CUENTA SI SE APRUEBA", M, y)
    y += 4.5
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(60)
    if (!cuentaTras.length) {
      doc.text("El cliente queda sin saldo pendiente.", M, y)
      y += 5
    } else {
      for (const c of cuentaTras) {
        if (y > 250) { doc.addPage(); y = 20 }
        const vencida = c.vence < hoy
        doc.setTextColor(...(vencida ? [170, 40, 40] as [number, number, number] : [60, 60, 60] as [number, number, number]))
        doc.text(recortar(doc, c.numero, 60), M + 2, y)
        doc.text(`Vence ${c.vence}${vencida ? " (vencida)" : ""}`, M + 66, y)
        doc.text(money(c.saldo), C.fin, y, { align: "right" })
        y += 4.5
      }
      doc.setDrawColor(220).line(xEt, y - 2, DER, y - 2)
      doc.setFont("helvetica", "bold").setTextColor(40)
      doc.text("Saldo pendiente", xEt, y + 2)
      doc.text(money(cuentaTras.reduce((s, c) => s + c.saldo, 0)), C.fin, y + 2, { align: "right" })
      y += 6
    }

    // ------------------------------------------------------------ Anulado
    if (anulado) {
      doc.setFont("helvetica", "bold").setFontSize(60).setTextColor(220, 60, 60)
      doc.text("ANULADO", 105, 150, { align: "center", angle: 30 })
      doc.setFontSize(8).setTextColor(170, 40, 40)
      doc.text(recortar(doc, `Anulado: ${r.motivo_anulacion ?? ""} (${r.anulado_nombre ?? ""})`, ANCHO), M, 258)
    }

    // ---------------------------------------------------------------- Pie
    const yPie = 262
    doc.setDrawColor(220).setLineWidth(0.2).line(M, yPie, DER, yPie)
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(130)
    doc.text(`Registrado por ${r.registrado_nombre ?? "—"} · ${String(r.registrado_en ?? "").slice(0, 10)}`, M, yPie + 5)
    if (r.aprobado_en) doc.text(`Aprobado por ${r.aprobado_nombre ?? "—"} · ${String(r.aprobado_en).slice(0, 10)}`, M, yPie + 9)
    doc.text(
      `Generado el ${new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}`,
      DER, yPie + 9, { align: "right" },
    )

    const bytes = doc.output("arraybuffer") as ArrayBuffer
    return {
      success: true,
      base64: Buffer.from(bytes).toString("base64"),
      nombreArchivo: `${titulo === "RECIBO DE CAJA" ? "Recibo" : "Documento-pago"}-${r.numero ?? r.id}.pdf`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al generar el PDF"
    console.error("[crm-recaudo-pdf]", msg)
    return { success: false, error: msg }
  }
}
