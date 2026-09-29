// Construccion del estado de cuenta en PDF (EDC-01, EDC-02). Solo servidor.
//
// SIN "use server": no valida permisos, asi que no puede ser invocable desde
// el navegador. Lo usan las acciones de lib/crm-estado-cuenta-pdf.ts, que si
// validan permiso y alcance antes de llamarlo.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import type { ContextoCrm } from "@/lib/crm-auth"
import { leerParam, leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { hoyISO, sumarDias } from "@/lib/crm-fechas"
import { resumirCartera, diasDeFactura, type Cortes, type FacturaTablero } from "@/lib/crm-cartera-resumen"
import { numeroALetrasPesos } from "@/lib/numero-a-letras"

export interface OpcionesEstadoCuenta {
  /** Obligatorio si el cliente debe a mas de un owner. */
  ownerId?: number | null
}

type RGB = [number, number, number]
const AZUL: RGB = [44, 82, 130]
const money = (n: number) => "$ " + (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })

function hexARgb(hex: string | null | undefined): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function recortar(doc: any, texto: string, anchoMm: number): string {
  const t = String(texto ?? "")
  if (!t || doc.getTextWidth(t) <= anchoMm) return t
  let out = t
  while (out.length > 1 && doc.getTextWidth(out + "…") > anchoMm) out = out.slice(0, -1)
  return out + "…"
}

/**
 * Descarga el logo SOLO si esta en el Storage de este proyecto. Aceptar
 * cualquier URL convertiria al servidor en un cliente HTTP al servicio de
 * quien edite el maestro (SSRF): podria pedirle direcciones internas.
 */
async function leerLogo(url: string | null | undefined): Promise<{ data: string; formato: "PNG" | "JPEG" } | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url || !base || !url.startsWith(`${base}/storage/v1/object/public/`)) return null
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const tipo = r.headers.get("content-type") ?? ""
    const formato = tipo.includes("png") ? "PNG" : tipo.includes("jpeg") || tipo.includes("jpg") ? "JPEG" : null
    if (!formato) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.byteLength > 2 * 1024 * 1024) return null
    return { data: `data:${tipo};base64,${buf.toString("base64")}`, formato }
  } catch {
    return null
  }
}

const TIPO_MOV: Record<string, string> = {
  recaudo: "Recaudo", legacy: "Abono", ajuste: "Abono", descuento: "Descuento", nota_credito: "Nota crédito",
}

/** Arma el PDF. Sin validar permisos: quien llama ya lo hizo. */
export async function construirEstadoCuenta(ctx: ContextoCrm, clienteId: number, opciones: OpcionesEstadoCuenta, empresaId: number) {
  const db = await getSupabaseAdmin()
  const hoy = hoyISO()

  const [{ data: cli }, { data: cuentas }, { data: owners }, { data: empresa }] = await Promise.all([
    db.from("clientes").select("*").eq("id", clienteId).maybeSingle(),
    db.from("crm_cuentas_cobrar").select("id, numero_factura, fecha_factura, fecha_vencimiento, valor_original, valor_abonado, saldo, estado, owner_id, cliente_id, vendedor_id")
      .eq("idempresa", empresaId).eq("cliente_id", clienteId).order("fecha_vencimiento"),
    db.from("crm_owners").select("*").eq("idempresa", empresaId),
    db.from("empresas").select("nombre, nit, direccion").eq("id", empresaId).maybeSingle(),
  ])
  if (!cli) return { error: "El cliente no existe" } as const

  const abiertas = (cuentas ?? []).filter((c) => ["pendiente", "parcial"].includes(c.estado as string) && Number(c.saldo) > 0)
  const ownersConSaldo = [...new Set(abiertas.map((c) => c.owner_id as number | null).filter((o): o is number => o != null))]
  let ownerId = opciones.ownerId ?? null
  if (!ownerId && ownersConSaldo.length > 1) {
    return {
      requiereOwner: ownersConSaldo.map((id) => ({ id, nombre: String(owners?.find((o) => o.id === id)?.nombre ?? `Owner ${id}`) })),
    } as const
  }
  ownerId = ownerId ?? ownersConSaldo[0] ?? null
  const owner = (owners ?? []).find((o) => o.id === ownerId) as Record<string, any> | undefined

  const delOwner = (cuentas ?? []).filter((c) => !ownerId || c.owner_id === ownerId)
  const facturas = delOwner.filter((c) => ["pendiente", "parcial"].includes(c.estado as string) && Number(c.saldo) > 0)

  const [cortes, dias, nota, favor] = await Promise.all([
    Promise.all([
      leerParamNumber(PARAM.CARTERA_RANGO_1, empresaId, 30),
      leerParamNumber(PARAM.CARTERA_RANGO_2, empresaId, 60),
      leerParamNumber(PARAM.CARTERA_RANGO_3, empresaId, 90),
    ]) as Promise<Cortes>,
    leerParamNumber(PARAM.ESTADO_CUENTA_DIAS_MOVIMIENTOS, empresaId, 90),
    leerParam(PARAM.ESTADO_CUENTA_NOTA, empresaId),
    (async () => {
      let q = db.from("crm_saldos_favor").select("saldo").eq("idempresa", empresaId).eq("cliente_id", clienteId).is("anulado_en", null)
      if (ownerId) q = q.eq("owner_id", ownerId)
      const { data } = await q
      return (data ?? []).reduce((s, r) => s + Number(r.saldo), 0)
    })(),
  ])
  const desde = sumarDias(hoy, -Math.max(1, dias))
  const ids = delOwner.map((c) => c.id as number)
  const { data: pagos } = ids.length
    ? await db.from("crm_pagos").select("fecha_pago, valor, tipo, referencia, cuenta_cobrar_id, anulado_en")
        .in("cuenta_cobrar_id", ids).gte("fecha_pago", desde).is("anulado_en", null).order("fecha_pago")
    : { data: [] as Record<string, unknown>[] }
  const numeroDe = new Map(delOwner.map((c) => [c.id as number, (c.numero_factura as string) ?? `CxC ${c.id}`]))

  const cupo = Number(cli.cupo_credito) || 0
  const r = resumirCartera(
    facturas.map((f) => ({ ...f, saldo: Number(f.saldo) })) as unknown as FacturaTablero[], hoy, cortes, cupo, favor)

  // ------------------------------------------------------------------ PDF
  const { default: jsPDF } = await import("jspdf")
  const doc = new jsPDF({ format: "letter", unit: "mm" })
  const M = 15
  const DER = 210 - M
  const ANCHO = DER - M
  const COLOR = hexARgb(owner?.color) ?? AZUL
  const emisor = String(owner?.nombre_empresafactura ?? empresa?.nombre ?? "")
  const nit = owner ? owner.nit : empresa?.nit
  let y = 15

  const logo = await leerLogo(owner?.logo_url)
  let xTexto = M
  if (logo) {
    try {
      const prop = doc.getImageProperties(logo.data)
      const alto = 16
      const ancho = Math.min(45, (prop.width / prop.height) * alto)
      doc.addImage(logo.data, logo.formato, M, y - 4, ancho, alto)
      xTexto = M + ancho + 4
    } catch { /* un logo corrupto no impide el documento */ }
  }
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(30)
  doc.text(recortar(doc, emisor, 95), xTexto, y)
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(100)
  const lineasEmisor = [
    nit ? `NIT ${nit}` : "",
    owner?.direccion ?? (owner ? "" : empresa?.direccion ?? ""),
    [owner?.telefono, owner?.correo].filter(Boolean).join(" · "),
  ].filter(Boolean) as string[]
  lineasEmisor.forEach((l, i) => doc.text(recortar(doc, l, 95), xTexto, y + 4.5 + i * 3.8))

  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...COLOR)
  doc.text("ESTADO DE CUENTA", DER, y, { align: "right" })
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(90)
  doc.text(`Fecha de corte: ${hoy}`, DER, y + 5, { align: "right" })
  doc.text(`Movimientos desde: ${desde}`, DER, y + 9, { align: "right" })

  y = Math.max(y + 16, y + 6 + lineasEmisor.length * 3.8)
  doc.setDrawColor(...COLOR).setLineWidth(0.6).line(M, y, DER, y)

  // Cliente
  y += 7
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(110)
  doc.text("CLIENTE", M, y)
  y += 5
  doc.setFontSize(11).setTextColor(30)
  doc.text(recortar(doc, String(cli.nombre ?? ""), 120), M, y)
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(90)
  if (cli.documento) doc.text(`NIT/CC ${cli.documento}`, DER, y, { align: "right" })
  const contacto = [cli.personacontacto, cli.celular, cli.correo].filter(Boolean).join(" · ")
  if (contacto) { y += 4.5; doc.text(recortar(doc, contacto, ANCHO), M, y) }
  y += 4.5
  doc.text(`Condición: ${Number(cli.dias_credito) > 0 ? `crédito ${cli.dias_credito} días` : "contado"}${cupo > 0 ? ` · Cupo ${money(cupo)}` : ""}`, M, y)

  // Resumen
  y += 6
  const cajas: [string, string, boolean][] = [
    ["Saldo total", money(r.cuenta.saldo), true],
    ["Por vencer", money(r.cuenta.alDia), false],
    ["Vencido", money(r.cuenta.vencido), r.cuenta.vencido > 0],
    ["Días de mora", String(r.cuenta.diasMora), r.cuenta.diasMora > 0],
    ["Saldo a favor", money(favor), false],
  ]
  const anchoCaja = ANCHO / cajas.length
  doc.setFillColor(242, 244, 247).roundedRect(M, y, ANCHO, 15, 2, 2, "F")
  cajas.forEach(([et, v, fuerte], i) => {
    const x = M + 3 + anchoCaja * i
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120).text(et.toUpperCase(), x, y + 5)
    doc.setFont("helvetica", "bold").setFontSize(fuerte ? 10.5 : 9.5)
    doc.setTextColor(...((i === 2 || i === 3) && fuerte ? [180, 40, 40] as RGB : i === 0 ? COLOR : [40, 40, 40] as RGB))
    doc.text(v, x, y + 11)
  })
  y += 19

  // Rangos
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(110).text("ANTIGÜEDAD", M, y)
  y += 2
  const anchoR = ANCHO / r.rangos.length
  r.rangos.forEach((t, i) => {
    const x = M + anchoR * i
    doc.setDrawColor(225).setLineWidth(0.2).rect(x, y, anchoR, 10)
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(120).text(t.etiqueta === "Al día" ? "Por vencer" : `${t.etiqueta} días`, x + 2, y + 4)
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...(i > 0 && t.valor > 0 ? [180, 40, 40] as RGB : [40, 40, 40] as RGB))
    doc.text(money(t.valor), x + 2, y + 8.3)
  })
  y += 16

  // Facturas abiertas
  const C = { num: M + 2, fec: M + 42, ven: M + 66, dias: M + 100, val: M + 128, abo: M + 152, sal: DER - 2 }
  const cabeceraFact = () => {
    doc.setFillColor(...COLOR).rect(M, y, ANCHO, 6.5, "F")
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(255)
    doc.text("FACTURA", C.num, y + 4.4)
    doc.text("FECHA", C.fec, y + 4.4)
    doc.text("VENCE", C.ven, y + 4.4)
    doc.text("DÍAS", C.dias, y + 4.4, { align: "right" })
    doc.text("VALOR", C.val, y + 4.4, { align: "right" })
    doc.text("ABONADO", C.abo, y + 4.4, { align: "right" })
    doc.text("SALDO", C.sal, y + 4.4, { align: "right" })
    y += 6.5
  }
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(110).text("FACTURAS PENDIENTES", M, y)
  y += 2
  cabeceraFact()
  doc.setFont("helvetica", "normal").setFontSize(8)
  if (!facturas.length) {
    doc.setTextColor(120).text("No hay facturas pendientes.", C.num, y + 4.2)
    y += 6
  }
  for (const [i, f] of facturas.entries()) {
    if (y > 245) { doc.addPage(); y = 18; cabeceraFact(); doc.setFont("helvetica", "normal").setFontSize(8) }
    if (i % 2 === 1) doc.setFillColor(250, 250, 252).rect(M, y, ANCHO, 5.8, "F")
    const d = diasDeFactura(f as { fecha_vencimiento: string }, hoy)
    const vencida = d > 0
    doc.setTextColor(...(vencida ? [170, 40, 40] as RGB : [40, 40, 40] as RGB))
    doc.text(recortar(doc, (f.numero_factura as string) ?? `CxC ${f.id}`, 38), C.num, y + 4)
    doc.text(String(f.fecha_factura ?? ""), C.fec, y + 4)
    doc.text(String(f.fecha_vencimiento ?? ""), C.ven, y + 4)
    doc.text(vencida ? String(d) : "—", C.dias, y + 4, { align: "right" })
    doc.text(money(Number(f.valor_original)), C.val, y + 4, { align: "right" })
    doc.text(money(Number(f.valor_abonado)), C.abo, y + 4, { align: "right" })
    doc.setFont("helvetica", "bold").text(money(Number(f.saldo)), C.sal, y + 4, { align: "right" })
    doc.setFont("helvetica", "normal")
    y += 5.8
  }
  doc.setDrawColor(220).setLineWidth(0.2).line(M, y, DER, y)
  y += 5
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(30)
  doc.text("TOTAL A PAGAR", C.abo, y, { align: "right" })
  doc.setTextColor(...COLOR).text(money(r.cuenta.saldo), C.sal, y, { align: "right" })
  y += 4
  doc.setFont("helvetica", "italic").setFontSize(7).setTextColor(110)
  doc.text(recortar(doc, `Son: ${numeroALetrasPesos(r.cuenta.saldo)}`, ANCHO), M, y)

  // Movimientos
  y += 8
  if (y > 235) { doc.addPage(); y = 18 }
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(110).text(`ABONOS Y NOTAS DESDE ${desde}`, M, y)
  y += 4
  doc.setFont("helvetica", "normal").setFontSize(8)
  if (!(pagos ?? []).length) {
    doc.setTextColor(120).text("Sin movimientos en el período.", M + 2, y + 1)
    y += 5
  }
  for (const p of pagos ?? []) {
    if (y > 250) { doc.addPage(); y = 18 }
    doc.setTextColor(60)
    doc.text(String(p.fecha_pago), M + 2, y)
    doc.text(TIPO_MOV[String(p.tipo)] ?? String(p.tipo), M + 26, y)
    doc.text(recortar(doc, `Factura ${numeroDe.get(p.cuenta_cobrar_id as number) ?? ""}`, 50), M + 56, y)
    doc.text(recortar(doc, String(p.referencia ?? ""), 45), M + 110, y)
    doc.text(money(Number(p.valor)), DER - 2, y, { align: "right" })
    y += 4.5
  }

  // Nota y pie legal
  y += 4
  if (y > 240) { doc.addPage(); y = 18 }
  if (nota) {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(70)
    for (const l of doc.splitTextToSize(nota, ANCHO) as string[]) { doc.text(l, M, y); y += 3.8 }
  }
  const paginas = doc.getNumberOfPages()
  for (let pg = 1; pg <= paginas; pg++) {
    doc.setPage(pg)
    doc.setDrawColor(220).setLineWidth(0.2).line(M, 262, DER, 262)
    doc.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(130)
    const pie = (doc.splitTextToSize(String(owner?.pie_documento ?? ""), ANCHO - 30) as string[]).slice(0, 3)
    pie.forEach((l, i) => doc.text(l, M, 266 + i * 3.2))
    doc.text(`Página ${pg} de ${paginas}`, DER, 266, { align: "right" })
    doc.text(`Generado por ${ctx.nombre}`, DER, 269.2, { align: "right" })
  }

  const bytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer)
  const limpio = String(cli.nombre ?? "cliente").replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40)
  return {
    bytes,
    nombreArchivo: `Estado-cuenta-${limpio}-${hoy}.pdf`,
    cliente: cli as Record<string, any>,
    emisor,
    saldo: r.cuenta.saldo,
    ownerId,
  } as const
}

