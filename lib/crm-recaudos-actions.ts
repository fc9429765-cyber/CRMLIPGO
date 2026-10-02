"use server"

// Recaudos: el vendedor reporta un pago con su comprobante, Cartera lo aprueba
// y solo entonces se mueven los saldos (REC-01..REC-24).
//
// FLUJO
//   1. analizarComprobante: la IA lee la foto y prellena el formulario; si la
//      foto no sirve, lo dice alli mismo (REC-20, REC-21).
//   2. registrarRecaudo: se guarda el recaudo con su comprobante en el bucket
//      privado, y el sistema PROPONE el reparto entre facturas, la mas vencida
//      primero (REC-15). Los saldos NO se tocan todavia (REC-07).
//   3. aprobarRecaudo (Cartera): aplica el reparto propuesto o uno ajustado
//      (REC-18), en una funcion de la base que bloquea cada factura. Lo que
//      sobra queda como saldo a favor (REC-17).
//      rechazarRecaudo: con motivo; el vendedor corrige y reenvia.
//   4. Tras aprobar: SAP (si el owner factura por SAP) y LIPgo quedan en la
//      bandeja de integraciones; las comisiones "por recaudo" se causan.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { leerParam, leerParamBool } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { hoyISO } from "@/lib/crm-fechas"
import {
  asegurarClienteVisible, exigirPermiso, exigirSesion, filtrarPorVendedor, mensajeError, tienePermiso, type ContextoCrm,
} from "@/lib/crm-auth"
import { registrarEvento } from "@/lib/crm-eventos"
import { encolar, encolarAviso, encolarSap } from "@/lib/integraciones/outbox"
import { leerComprobante, type LecturaComprobante } from "@/lib/integraciones/ocr"
import { guardarDocumento, huella, recaudoConMismoComprobante, urlFirmada, validarArchivo } from "@/lib/crm-documentos-server"
import { distribuirPago, validarAplicacionManual, type Distribucion, type FacturaAplicable, distribucionManual } from "@/lib/crm-cartera-aplicacion"
import { compararConComprobante, type AplicacionRecaudo, type EstadoRecaudo, type Recaudo, type RecaudoConDetalle } from "@/lib/crm-recaudos"
import { liquidarComisionInterna } from "@/lib/crm-comisiones-server"
import type { MomentoComision } from "@/lib/crm-cartera"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

const fallo = (err: unknown): ActionResult<never> => ({ success: false, error: mensajeError(err) })

const VER = ["crm_cartera", "crm_pagos", "crm_recaudos_registrar", "crm_recaudos_aprobar"] as const
const REGISTRAR = ["crm_recaudos_registrar", "crm_recaudos_aprobar", "crm_pagos"] as const

const cop = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

async function opcionesOcr(empresaId: number) {
  const [activo, modelo] = await Promise.all([
    leerParamBool(PARAM.IA_LECTURA_COMPROBANTES, empresaId),
    leerParam(PARAM.IA_MODELO_OCR, empresaId),
  ])
  return { activo, modelo: modelo || "claude-sonnet-5" }
}

// ============================================================== CAPACIDADES

export interface PermisosRecaudo {
  registrar: boolean
  aprobar: boolean
  descuentos: boolean
  /** true = solo ve sus clientes y sus recaudos. */
  soloPropios: boolean
}

/**
 * Que puede hacer el usuario en recaudos, para que la pantalla no ofrezca
 * botones que el servidor va a rechazar. No reemplaza las validaciones de
 * cada accion: solo decide que se muestra.
 */
export async function getPermisosRecaudo(): Promise<ActionResult<PermisosRecaudo>> {
  try {
    const ctx = await exigirSesion()
    return {
      success: true,
      data: {
        registrar: REGISTRAR.some((p) => tienePermiso(ctx, p)),
        aprobar: tienePermiso(ctx, "crm_recaudos_aprobar"),
        descuentos: tienePermiso(ctx, "crm_descuentos_admin"),
        soloPropios: ctx.alcance === "propios",
      },
    }
  } catch (err) {
    return fallo(err)
  }
}

// ================================================================ LECTURA

export interface Analisis {
  disponible: boolean
  motivo?: string
  lectura?: LecturaComprobante
  /** Si esta misma foto ya sustenta otro recaudo. */
  duplicado?: { id: number; numero: string; estado: string } | null
}

/** Lee el comprobante para prellenar el formulario. No guarda nada. */
export async function analizarComprobante(fd: FormData, empresaId = 1): Promise<ActionResult<Analisis>> {
  try {
    await exigirPermiso("analizarComprobante", ...REGISTRAR)
    const archivo = fd.get("archivo")
    if (!(archivo instanceof File)) return { success: false, error: "Adjunta la foto o el PDF del comprobante" }
    const invalido = validarArchivo(archivo.type, archivo.size)
    if (invalido) return { success: false, error: invalido }

    const bytes = new Uint8Array(await archivo.arrayBuffer())
    const duplicado = await recaudoConMismoComprobante(empresaId, huella(bytes))
    const r = await leerComprobante(bytes, archivo.type, await opcionesOcr(empresaId))
    return {
      success: true,
      data: r.disponible ? { disponible: true, lectura: r.lectura, duplicado } : { disponible: false, motivo: r.motivo, duplicado },
    }
  } catch (err) {
    return fallo(err)
  }
}

// ======================================================= FACTURAS Y REPARTO

export interface CarteraParaRecaudo {
  facturas: (FacturaAplicable & { owner_id: number | null; dias_vencido: number })[]
  saldoFavor: number
}

/** Facturas abiertas del cliente (de un owner, si se indica) y su saldo a favor. */
async function carteraInterna(empresaId: number, clienteId: number, ownerId: number | null): Promise<CarteraParaRecaudo> {
  const db = await getSupabaseAdmin()
  let q = db.from("crm_cuentas_cobrar")
    .select("id, numero_factura, fecha_factura, fecha_vencimiento, saldo, owner_id")
    .eq("idempresa", empresaId).eq("cliente_id", clienteId).in("estado", ["pendiente", "parcial"])
  if (ownerId) q = q.eq("owner_id", ownerId)
  const [{ data }, { data: sf }] = await Promise.all([
    q,
    db.from("crm_saldos_favor").select("saldo").eq("idempresa", empresaId).eq("cliente_id", clienteId).is("anulado_en", null),
  ])
  const hoy = hoyISO()
  return {
    facturas: (data ?? []).filter((c) => Number(c.saldo) > 0).map((c) => ({
      id: c.id as number,
      numero: (c.numero_factura as string) ?? null,
      fecha_documento: c.fecha_factura as string,
      fecha_vencimiento: c.fecha_vencimiento as string,
      saldo: Number(c.saldo),
      owner_id: (c.owner_id as number) ?? null,
      dias_vencido: Math.max(0, Math.round((Date.parse(hoy) - Date.parse(c.fecha_vencimiento as string)) / 86_400_000)),
    })),
    saldoFavor: (sf ?? []).reduce((s, r) => s + Number(r.saldo), 0),
  }
}

/** Reparto propuesto para un valor, para que el vendedor lo vea antes de enviar. */
export async function proponerAplicacion(
  clienteId: number,
  ownerId: number | null,
  valor: number,
  empresaId = 1,
): Promise<ActionResult<CarteraParaRecaudo & { distribucion: Distribucion }>> {
  try {
    const ctx = await exigirPermiso("proponerAplicacion", ...VER)
    await asegurarClienteVisible(ctx, clienteId)
    const cartera = await carteraInterna(empresaId, clienteId, ownerId)
    return { success: true, data: { ...cartera, distribucion: distribuirPago(Number(valor) || 0, cartera.facturas) } }
  } catch (err) {
    return fallo(err)
  }
}

// ================================================================ REGISTRO

function leerCampos(fd: FormData) {
  const n = (k: string) => {
    const v = fd.get(k)
    return v == null || v === "" ? null : Number(v)
  }
  const t = (k: string) => {
    const v = fd.get(k)
    return v == null || String(v).trim() === "" ? null : String(v).trim()
  }
  return {
    cliente_id: n("cliente_id"), owner_id: n("owner_id"), fecha_documento: t("fecha_documento"), valor: n("valor"),
    medio_pago_id: n("medio_pago_id"), banco_id: n("banco_id"), cuenta_destino_id: n("cuenta_destino_id"),
    referencia: t("referencia"), observaciones: t("observaciones"),
  }
}

type Campos = ReturnType<typeof leerCampos>

type Elegida = { cuenta_cobrar_id: number; valor_aplicado: number }

/** Facturas que eligio quien registra el pago. null = reparto automatico. */
function leerElegidas(fd: FormData): Elegida[] | null {
  const raw = fd.get("aplicaciones")
  if (raw == null || String(raw).trim() === "") return null
  try {
    const lista = JSON.parse(String(raw)) as unknown
    if (!Array.isArray(lista)) return null
    const out = lista
      .map((a) => ({ cuenta_cobrar_id: Number((a as Elegida).cuenta_cobrar_id), valor_aplicado: Number((a as Elegida).valor_aplicado) }))
      .filter((a) => Number.isFinite(a.cuenta_cobrar_id) && Number.isFinite(a.valor_aplicado) && a.valor_aplicado > 0)
    return out.length ? out : null
  } catch {
    return null
  }
}

/** Valida las facturas elegidas contra la cartera abierta del cliente. */
async function validarElegidas(empresaId: number, clienteId: number, ownerId: number | null, valor: number, elegidas: Elegida[] | null) {
  if (!elegidas) return null
  const cartera = await carteraInterna(empresaId, clienteId, ownerId)
  const errores = validarAplicacionManual(valor, cartera.facturas, elegidas.map((e) => ({ ...e, valor_descuento: 0 })), { permiteDescuento: false })
  return errores.length ? errores.join(". ") : null
}

/**
 * Valida los datos del recaudo contra los maestros y decide su owner.
 * Devuelve el owner resuelto y el nombre del banco (para comparar con la IA).
 */
async function validarCampos(empresaId: number, c: Campos, archivo: File | null, exigirArchivo: boolean) {
  const db = await getSupabaseAdmin()
  if (!c.cliente_id) return { error: "Elige el cliente" }
  if (!c.valor || c.valor <= 0) return { error: "El valor debe ser mayor que cero" }
  if (!c.fecha_documento || !/^\d{4}-\d{2}-\d{2}$/.test(c.fecha_documento)) return { error: "Indica la fecha exacta del pago (REC-09)" }
  if (c.fecha_documento > hoyISO()) return { error: "La fecha del pago no puede ser futura" }
  if (!c.medio_pago_id) return { error: "Elige el medio de pago" }

  const [{ data: medio }, { data: banco }, { data: cuenta }] = await Promise.all([
    db.from("crm_medios_pago").select("nombre, requiere_banco, requiere_comprobante, activo").eq("id", c.medio_pago_id).maybeSingle(),
    c.banco_id ? db.from("crm_bancos").select("nombre, activo").eq("id", c.banco_id).maybeSingle() : Promise.resolve({ data: null }),
    c.cuenta_destino_id ? db.from("crm_cuentas_destino").select("owner_id, banco_id, activo").eq("id", c.cuenta_destino_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (!medio?.activo) return { error: "Ese medio de pago no está disponible" }
  if (medio.requiere_banco && !c.banco_id) return { error: `${medio.nombre} exige indicar el banco` }
  if (c.banco_id && !(banco as { activo?: boolean } | null)?.activo) return { error: "Ese banco no está disponible" }
  if (exigirArchivo && medio.requiere_comprobante && !archivo) return { error: `${medio.nombre} exige adjuntar el comprobante` }

  // Owner: el indicado; si no, el de la cuenta destino; si no, el unico owner
  // con facturas abiertas del cliente. Con varios y sin indicacion, se pregunta:
  // aplicar un pago de INDUPAN a una factura de Molinos descuadra dos carteras.
  let ownerId = c.owner_id ?? ((cuenta as { owner_id?: number } | null)?.owner_id ?? null)
  if ((cuenta as { owner_id?: number } | null)?.owner_id && c.owner_id && (cuenta as { owner_id: number }).owner_id !== c.owner_id) {
    return { error: "La cuenta destino es de otro owner" }
  }
  if (!ownerId) {
    const { data: abiertas } = await db.from("crm_cuentas_cobrar").select("owner_id")
      .eq("idempresa", empresaId).eq("cliente_id", c.cliente_id).in("estado", ["pendiente", "parcial"])
    const owners = [...new Set((abiertas ?? []).map((a) => a.owner_id).filter((o) => o != null))]
    if (owners.length > 1) return { error: "El cliente tiene facturas de varios owners: indica a cuál corresponde el pago" }
    ownerId = (owners[0] as number | undefined) ?? null
  }
  return { ownerId, bancoNombre: (banco as { nombre?: string } | null)?.nombre ?? null, medio }
}

/**
 * Registra un recaudo con su comprobante (REC-01, REC-08..REC-13).
 * NO mueve saldos: eso ocurre al aprobar.
 */
export async function registrarRecaudo(fd: FormData, empresaId = 1): Promise<ActionResult<{ recaudo: Recaudo; distribucion: Distribucion; alertas: string[] }>> {
  try {
    const ctx = await exigirPermiso("registrarRecaudo", ...REGISTRAR)
    const db = await getSupabaseAdmin()
    const c = leerCampos(fd)
    const archivoRaw = fd.get("archivo")
    const archivo = archivoRaw instanceof File && archivoRaw.size > 0 ? archivoRaw : null
    if (c.cliente_id) await asegurarClienteVisible(ctx, c.cliente_id)

    const v = await validarCampos(empresaId, c, archivo, true)
    if ("error" in v) return { success: false, error: v.error }
    const elegidas = leerElegidas(fd)
    const errElegidas = await validarElegidas(empresaId, c.cliente_id!, v.ownerId, c.valor!, elegidas)
    if (errElegidas) return { success: false, error: errElegidas }

    // Comprobante: duplicado y lectura con IA.
    let lectura: LecturaComprobante | null = null
    let modelo: string | undefined
    let bytes: Uint8Array | null = null
    if (archivo) {
      const invalido = validarArchivo(archivo.type, archivo.size)
      if (invalido) return { success: false, error: invalido }
      bytes = new Uint8Array(await archivo.arrayBuffer())
      const dup = await recaudoConMismoComprobante(empresaId, huella(bytes))
      if (dup) return { success: false, error: `Ese comprobante ya fue reportado en el recaudo ${dup.numero} (${dup.estado})` }
      const r = await leerComprobante(bytes, archivo.type, await opcionesOcr(empresaId))
      if (r.disponible) {
        lectura = r.lectura
        modelo = r.modelo
        // REC-21: una foto ilegible se rechaza en el acto, con el motivo, para
        // tomarla de nuevo alli mismo. Mas barato que un rechazo de Cartera
        // dias despues, cuando el vendedor ya no esta donde el cliente.
        if (!r.lectura.legible) {
          return { success: false, error: `Toma de nuevo la foto: ${r.lectura.motivo_ilegible ?? "no se alcanza a leer el comprobante"}` }
        }
        if (!r.lectura.es_comprobante) {
          return { success: false, error: "La imagen no parece un comprobante de pago. Adjunta la consignación o transferencia." }
        }
      }
    }

    const alertas = compararConComprobante(
      { valor: c.valor!, fecha_documento: c.fecha_documento!, banco_nombre: v.bancoNombre, referencia: c.referencia },
      lectura,
    )
    // Mismo banco, fecha y valor en otro recaudo: puede ser legitimo (dos
    // pagos iguales el mismo dia), asi que no bloquea; lo decide Cartera.
    if (c.banco_id) {
      const { data: parecido } = await db.from("crm_recaudos").select("numero")
        .eq("idempresa", empresaId).eq("banco_id", c.banco_id).eq("fecha_documento", c.fecha_documento!)
        .eq("valor", c.valor!).neq("estado", "anulado").limit(1)
      if (parecido?.length) alertas.push(`Posible duplicado: ${parecido[0].numero} tiene el mismo banco, fecha y valor`)
    }

    const { data: cli } = await db.from("clientes").select("vendedor_asignado").eq("id", c.cliente_id!).maybeSingle()
    const { data: rec, error } = await db.from("crm_recaudos").insert({
      idempresa: empresaId, cliente_id: c.cliente_id, owner_id: v.ownerId,
      vendedor_id: ctx.vendedorId ?? (cli?.vendedor_asignado as number | null) ?? null,
      fecha_documento: c.fecha_documento, valor: c.valor, medio_pago_id: c.medio_pago_id, banco_id: c.banco_id,
      cuenta_destino_id: c.cuenta_destino_id, referencia: c.referencia, observaciones: c.observaciones,
      ocr: lectura ? { ...lectura, modelo } : null, ocr_alertas: alertas,
      registrado_por: ctx.userId, registrado_nombre: ctx.nombre,
    }).select().single()
    if (error) return { success: false, error: error.message }

    if (archivo && bytes) {
      const doc = await guardarDocumento({
        empresaId, entidad: "recaudo", entidadId: rec.id, tipoCodigo: "COMPROBANTE",
        bytes, mime: archivo.type, nombre: archivo.name, ctx, ocr: lectura,
      })
      if (!doc.ok) {
        // Sin su comprobante el recaudo no se sostiene: se deshace.
        await db.from("crm_recaudos").delete().eq("id", rec.id)
        return { success: false, error: doc.error }
      }
      await db.from("crm_recaudos").update({ comprobante_id: doc.id }).eq("id", rec.id)
    }

    const distribucion = await guardarPropuesta(empresaId, rec.id, c.cliente_id!, v.ownerId, c.valor!, elegidas)

    await registrarEvento({
      empresaId, entidad: "recaudo", entidadId: rec.id, tipo: "registrado", estadoHasta: "pendiente_aprobacion",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: alertas.length ? alertas.join(". ") : null,
      datos: { valor: c.valor, numero: rec.numero, aplicado: distribucion.totalAplicado, saldo_favor: distribucion.saldoFavor },
    })
    await avisar(empresaId, "recaudo_registrado", rec.id, v.ownerId, ctx, {
      titulo: `Recaudo por aprobar ${rec.numero}`,
      contenido: `${cop(c.valor!)} · registrado por ${ctx.nombre}${alertas.length ? " · con alertas para revisar" : ""}`,
    })
    return { success: true, data: { recaudo: { ...rec, comprobante_id: rec.comprobante_id } as Recaudo, distribucion, alertas } }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Guarda el reparto propuesto de un recaudo pendiente: el que eligio quien lo
 * registro (modo manual) o, si no eligio, el automatico (la mas vencida
 * primero). Cartera lo ve al aprobar y aun puede cambiarlo (REC-18).
 */
async function guardarPropuesta(
  empresaId: number, recaudoId: number, clienteId: number, ownerId: number | null, valor: number,
  elegidas: Elegida[] | null = null,
) {
  const db = await getSupabaseAdmin()
  const cartera = await carteraInterna(empresaId, clienteId, ownerId)
  const distribucion = elegidas ? distribucionManual(valor, cartera.facturas, elegidas) : distribuirPago(valor, cartera.facturas)
  await db.from("crm_recaudo_aplicaciones").delete().eq("recaudo_id", recaudoId)
  if (distribucion.aplicaciones.length) {
    await db.from("crm_recaudo_aplicaciones").insert(distribucion.aplicaciones.map((a) => ({
      idempresa: empresaId, recaudo_id: recaudoId, cuenta_cobrar_id: a.cuenta_cobrar_id,
      valor_aplicado: a.valor_aplicado, valor_descuento: 0, saldo_anterior: a.saldo_anterior,
      saldo_posterior: a.saldo_posterior, orden: a.orden, modo: elegidas ? "manual" : "auto",
    })))
  }
  return distribucion
}

async function avisar(
  empresaId: number, evento: string, recaudoId: number, ownerId: number | null, ctx: ContextoCrm,
  m: { titulo: string; contenido: string },
) {
  const db = await getSupabaseAdmin()
  const { data: dest } = await db.from("crm_notificacion_destinatarios").select("nombre, celular, owner_id")
    .eq("idempresa", empresaId).eq("evento", evento).eq("activo", true)
  for (const d of dest ?? []) {
    if (d.owner_id && d.owner_id !== ownerId) continue
    await encolarAviso({
      empresaId, evento, entidad: "recaudo", entidadId: recaudoId, creadoPor: ctx.nombre,
      aviso: { celular: d.celular, titulo: m.titulo, destinatario: String(d.nombre).split(" ")[0], contenido: m.contenido },
    })
  }
}

// ================================================================ CONSULTA

export interface FiltrosRecaudos {
  estado?: EstadoRecaudo | EstadoRecaudo[]
  clienteId?: number
  vendedorId?: number
  ownerId?: number
  desde?: string
  hasta?: string
  texto?: string
  conAlertas?: boolean
}

async function conNombres(filas: Recaudo[]): Promise<RecaudoConDetalle[]> {
  if (!filas.length) return []
  const db = await getSupabaseAdmin()
  const ids = (k: keyof Recaudo) => [...new Set(filas.map((r) => r[k]).filter((v) => v != null))] as number[]
  const [cli, ven, own, med, ban, cta] = await Promise.all([
    db.from("clientes").select("id, nombre").in("id", ids("cliente_id")),
    ids("vendedor_id").length ? db.from("vendedores").select("idvendedor, nombre").in("idvendedor", ids("vendedor_id")) : Promise.resolve({ data: [] }),
    db.from("crm_owners").select("id, nombre"),
    db.from("crm_medios_pago").select("id, nombre"),
    db.from("crm_bancos").select("id, nombre"),
    db.from("crm_cuentas_destino").select("id, alias"),
  ])
  const m = (rows: unknown, k: string, v: string) => new Map(((rows ?? []) as Record<string, unknown>[]).map((r) => [r[k] as number, r[v] as string]))
  const [nCli, nVen, nOwn, nMed, nBan, nCta] = [
    m(cli.data, "id", "nombre"), m(ven.data, "idvendedor", "nombre"), m(own.data, "id", "nombre"),
    m(med.data, "id", "nombre"), m(ban.data, "id", "nombre"), m(cta.data, "id", "alias"),
  ]
  return filas.map((r) => ({
    ...r,
    cliente_nombre: nCli.get(r.cliente_id) ?? null,
    vendedor_nombre: r.vendedor_id ? nVen.get(r.vendedor_id) ?? null : null,
    owner_nombre: r.owner_id ? nOwn.get(r.owner_id) ?? null : null,
    medio_pago_nombre: r.medio_pago_id ? nMed.get(r.medio_pago_id) ?? null : null,
    banco_nombre: r.banco_id ? nBan.get(r.banco_id) ?? null : null,
    cuenta_destino_alias: r.cuenta_destino_id ? nCta.get(r.cuenta_destino_id) ?? null : null,
  }))
}

export async function buscarRecaudos(
  empresaId = 1,
  filtros: FiltrosRecaudos = {},
  pagina = 1,
  tamano = 50,
): Promise<ActionResult<{ filas: RecaudoConDetalle[]; total: number }>> {
  try {
    const ctx = await exigirPermiso("buscarRecaudos", ...VER)
    const db = await getSupabaseAdmin()
    let q = db.from("crm_recaudos").select("*", { count: "exact" }).eq("idempresa", empresaId)
    q = filtrarPorVendedor(q, ctx, "vendedor_id")
    if (filtros.estado) q = Array.isArray(filtros.estado) ? q.in("estado", filtros.estado) : q.eq("estado", filtros.estado)
    if (filtros.clienteId) q = q.eq("cliente_id", filtros.clienteId)
    if (filtros.vendedorId) q = q.eq("vendedor_id", filtros.vendedorId)
    if (filtros.ownerId) q = q.eq("owner_id", filtros.ownerId)
    if (filtros.desde) q = q.gte("fecha_documento", filtros.desde)
    if (filtros.hasta) q = q.lte("fecha_documento", filtros.hasta)
    if (filtros.conAlertas) q = q.neq("ocr_alertas", "{}")
    if (filtros.texto?.trim()) q = q.or(`numero.ilike.%${filtros.texto.trim()}%,referencia.ilike.%${filtros.texto.trim()}%`)
    const tam = Math.min(Math.max(tamano, 1), 200)
    const ini = (Math.max(pagina, 1) - 1) * tam
    const { data, error, count } = await q.order("registrado_en", { ascending: false }).range(ini, ini + tam - 1)
    if (error) return { success: false, error: error.message }
    return { success: true, data: { filas: await conNombres((data ?? []) as Recaudo[]), total: count ?? 0 } }
  } catch (err) {
    return fallo(err)
  }
}

async function getRecaudoInterno(id: number, empresaId: number): Promise<RecaudoConDetalle | null> {
  const db = await getSupabaseAdmin()
  const [{ data: r }, { data: ap }] = await Promise.all([
    db.from("crm_recaudos").select("*").eq("id", id).eq("idempresa", empresaId).maybeSingle(),
    db.from("crm_recaudo_aplicaciones").select("*").eq("recaudo_id", id).order("orden"),
  ])
  if (!r) return null
  const cuentas = (ap ?? []).map((a) => a.cuenta_cobrar_id as number)
  const { data: fac } = cuentas.length
    ? await db.from("crm_cuentas_cobrar").select("id, numero_factura, fecha_vencimiento").in("id", cuentas)
    : { data: [] }
  const porId = new Map((fac ?? []).map((f) => [f.id as number, f]))
  const [conN] = await conNombres([r as Recaudo])
  return {
    ...conN,
    aplicaciones: (ap ?? []).map((a) => ({
      ...(a as unknown as AplicacionRecaudo),
      numero_factura: (porId.get(a.cuenta_cobrar_id)?.numero_factura as string) ?? null,
      fecha_vencimiento: (porId.get(a.cuenta_cobrar_id)?.fecha_vencimiento as string) ?? null,
    })),
  }
}

async function recaudoVisible(ctx: ContextoCrm, id: number, empresaId: number) {
  const r = await getRecaudoInterno(id, empresaId)
  if (!r || (ctx.alcance === "propios" && r.vendedor_id !== ctx.vendedorId)) return null
  return r
}

export async function getRecaudo(id: number, empresaId = 1): Promise<ActionResult<RecaudoConDetalle>> {
  try {
    const ctx = await exigirPermiso("getRecaudo", ...VER)
    const r = await recaudoVisible(ctx, id, empresaId)
    return r ? { success: true, data: r } : { success: false, error: "No encontrado" }
  } catch (err) {
    return fallo(err)
  }
}

/** URL temporal del comprobante (REC-23). Caduca en minutos. */
export async function getUrlComprobante(recaudoId: number, empresaId = 1): Promise<ActionResult<{ url: string; mime: string; nombre: string | null }>> {
  try {
    const ctx = await exigirPermiso("getUrlComprobante", ...VER)
    const r = await recaudoVisible(ctx, recaudoId, empresaId)
    if (!r?.comprobante_id) return { success: false, error: "El recaudo no tiene comprobante" }
    const u = await urlFirmada(r.comprobante_id, empresaId)
    return u ? { success: true, data: u } : { success: false, error: "No se pudo abrir el comprobante" }
  } catch (err) {
    return fallo(err)
  }
}

export interface EventoRecaudo {
  id: number
  tipo: string
  estado_desde: string | null
  estado_hasta: string | null
  usuario_nombre: string | null
  nota: string | null
  datos: Record<string, unknown>
  creado_en: string
}

export async function getHistorialRecaudo(id: number, empresaId = 1): Promise<ActionResult<EventoRecaudo[]>> {
  try {
    const ctx = await exigirPermiso("getHistorialRecaudo", ...VER)
    if (!(await recaudoVisible(ctx, id, empresaId))) return { success: false, error: "No encontrado" }
    const db = await getSupabaseAdmin()
    const { data, error } = await db.from("crm_eventos")
      .select("id, tipo, estado_desde, estado_hasta, usuario_nombre, nota, datos, creado_en")
      .eq("idempresa", empresaId).eq("entidad", "recaudo").eq("entidad_id", id).order("creado_en")
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as EventoRecaudo[] }
  } catch (err) {
    return fallo(err)
  }
}

// ====================================================== APROBAR / RECHAZAR

/**
 * Aprueba un recaudo (REC-03, REC-04). Con `aplicaciones`, Cartera reemplaza
 * el reparto propuesto (REC-18); los descuentos solo los aplica quien
 * administra descuentos (REC-19).
 */
export async function aprobarRecaudo(
  id: number,
  aplicaciones?: { cuenta_cobrar_id: number; valor_aplicado: number; valor_descuento?: number }[] | null,
  nota?: string | null,
  empresaId = 1,
): Promise<ActionResult<{ totalAplicado: number; saldoFavor: number; comisiones: number }>> {
  try {
    const ctx = await exigirPermiso("aprobarRecaudo", "crm_recaudos_aprobar")
    // Aprobar mueve saldos: se exige el permiso aunque la seguridad este en modo registro.
    if (!tienePermiso(ctx, "crm_recaudos_aprobar")) return { success: false, error: "No tienes permiso para aprobar recaudos" }
    const db = await getSupabaseAdmin()
    const r = await getRecaudoInterno(id, empresaId)
    if (!r) return { success: false, error: "El recaudo no existe" }
    if (r.estado !== "pendiente_aprobacion") return { success: false, error: `El recaudo está ${r.estado}` }
    const { data: reg } = await db.from("crm_recaudos").select("registrado_por").eq("id", id).single()
    if (reg?.registrado_por === ctx.userId) return { success: false, error: "No puedes aprobar un recaudo que tú registraste" }

    let payload: unknown = null
    if (aplicaciones) {
      const cartera = await carteraInterna(empresaId, r.cliente_id, r.owner_id)
      const lista = aplicaciones.map((a, i) => ({ ...a, valor_descuento: a.valor_descuento ?? 0, orden: i + 1 }))
      const errores = validarAplicacionManual(r.valor, cartera.facturas, lista, {
        permiteDescuento: tienePermiso(ctx, "crm_descuentos_admin"),
      })
      if (errores.length) return { success: false, error: errores.join(". ") }
      payload = lista.filter((a) => a.valor_aplicado > 0 || a.valor_descuento > 0)
    }

    const { data, error } = await db.rpc("crm_aprobar_recaudo", {
      p_recaudo_id: id, p_usuario_id: ctx.userId, p_usuario_nombre: ctx.nombre, p_aplicaciones: payload,
    })
    if (error) return { success: false, error: error.message }
    const res = data as { ok: boolean; error?: string; total_aplicado?: number; saldo_favor?: number }
    if (!res?.ok) return { success: false, error: res?.error ?? "No se pudo aprobar" }

    // Comisiones "por recaudo": se causan al quedar pagada la factura.
    let comisiones = 0
    if (((await leerParam(PARAM.COMISION_MOMENTO, empresaId)) as MomentoComision) === "recaudo") {
      const { data: pagadas } = await db.from("crm_cuentas_cobrar").select("id")
        .in("id", (r.aplicaciones ?? []).map((a) => a.cuenta_cobrar_id).concat(
          ((payload as { cuenta_cobrar_id: number }[] | null) ?? []).map((a) => a.cuenta_cobrar_id)))
        .eq("estado", "pagada")
      for (const p of pagadas ?? []) {
        const l = await liquidarComisionInterna(p.id as number, ctx.nombre, empresaId)
        if (l.success) comisiones++
      }
    }

    // Integraciones: SAP solo si el owner factura por SAP; LIPgo cuando tenga
    // donde recibirlos (REC-02). Ninguna bloquea: quedan en la bandeja.
    const { data: owner } = r.owner_id
      ? await db.from("crm_owners").select("codigo, envia_sap").eq("id", r.owner_id).maybeSingle()
      : { data: null }
    // El reparto que quedo aplicado (el propuesto o el que ajusto Cartera):
    // SAP necesita saber a que factura va cada peso.
    const aplicado = await getRecaudoInterno(id, empresaId)
    const payloadInt = {
      recaudo: { numero: r.numero, cliente_id: r.cliente_id, cliente: r.cliente_nombre, fecha: r.fecha_documento,
        valor: r.valor, medio: r.medio_pago_nombre, banco: r.banco_nombre, cuenta_destino: r.cuenta_destino_alias,
        referencia: r.referencia, owner: owner?.codigo ?? null,
        medio_pago_id: r.medio_pago_id, banco_id: r.banco_id, cuenta_destino_id: r.cuenta_destino_id },
      aplicaciones: (aplicado?.aplicaciones ?? [])
        .filter((a) => a.aplicado && Number(a.valor_aplicado) > 0)
        .map((a) => ({ cuenta_cobrar_id: a.cuenta_cobrar_id, numero_factura: a.numero_factura, valor: Number(a.valor_aplicado) })),
    }
    if (owner?.envia_sap) {
      const e = await encolarSap({ empresaId, flujo: "recaudos", entidad: "recaudo", entidadId: id, operacion: "crear_recaudo",
        version: r.version, ownerEnviaSap: true, creadoPor: ctx.nombre, payload: payloadInt })
      if (e.ok) await db.from("crm_recaudos").update({ sap_estado: "pendiente" }).eq("id", id)
    }
    await encolar({ empresaId, sistema: "lipgo", flujo: "recaudos", entidad: "recaudo", entidadId: id,
      operacion: "registrar_recaudo", version: r.version, payload: payloadInt, creadoPor: ctx.nombre })

    await registrarEvento({
      empresaId, entidad: "recaudo", entidadId: id, tipo: "aprobado", estadoDesde: "pendiente_aprobacion", estadoHasta: "aprobado",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: nota ?? null,
      datos: { total_aplicado: res.total_aplicado, saldo_favor: res.saldo_favor, reparto: aplicaciones ? "manual" : "automatico", comisiones },
    })
    return { success: true, data: { totalAplicado: Number(res.total_aplicado), saldoFavor: Number(res.saldo_favor), comisiones } }
  } catch (err) {
    return fallo(err)
  }
}

export async function rechazarRecaudo(id: number, motivoId: number | null, nota: string, empresaId = 1): Promise<ActionResult> {
  try {
    const ctx = await exigirPermiso("rechazarRecaudo", "crm_recaudos_aprobar")
    if (!tienePermiso(ctx, "crm_recaudos_aprobar")) return { success: false, error: "No tienes permiso para rechazar recaudos" }
    const db = await getSupabaseAdmin()
    let texto = nota?.trim() ?? ""
    if (motivoId) {
      const { data: m } = await db.from("crm_motivos").select("nombre, exige_nota, tipo").eq("id", motivoId).maybeSingle()
      if (!m || m.tipo !== "rechazo_recaudo") return { success: false, error: "Motivo no válido" }
      if (m.exige_nota && !texto) return { success: false, error: `"${m.nombre}" exige una explicación` }
      texto = texto ? `${m.nombre}: ${texto}` : m.nombre
    }
    if (!texto) return { success: false, error: "Indica el motivo del rechazo" }
    const { data } = await db.from("crm_recaudos").update({
      estado: "rechazado", rechazado_por: ctx.userId, rechazado_nombre: ctx.nombre, rechazado_en: new Date().toISOString(),
      motivo_rechazo_id: motivoId, motivo_rechazo: texto,
    }).eq("id", id).eq("idempresa", empresaId).eq("estado", "pendiente_aprobacion").select("id")
    if (!data?.length) return { success: false, error: "El recaudo cambió de estado. Recarga la pantalla." }
    await registrarEvento({
      empresaId, entidad: "recaudo", entidadId: id, tipo: "rechazado", estadoDesde: "pendiente_aprobacion", estadoHasta: "rechazado",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: texto, datos: { motivo_id: motivoId },
    })
    return { success: true }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * El vendedor corrige un recaudo rechazado y lo reenvia (REC-03). Puede
 * cambiar los datos y el comprobante; el reparto se vuelve a proponer.
 */
export async function corregirRecaudo(id: number, fd: FormData, empresaId = 1): Promise<ActionResult<{ alertas: string[] }>> {
  try {
    const ctx = await exigirPermiso("corregirRecaudo", ...REGISTRAR)
    const db = await getSupabaseAdmin()
    const r = await recaudoVisible(ctx, id, empresaId)
    if (!r) return { success: false, error: "No encontrado" }
    if (r.estado !== "rechazado") return { success: false, error: "Solo se corrige un recaudo rechazado" }

    const c = { ...leerCampos(fd), cliente_id: r.cliente_id }
    const archivoRaw = fd.get("archivo")
    const archivo = archivoRaw instanceof File && archivoRaw.size > 0 ? archivoRaw : null
    const v = await validarCampos(empresaId, c, archivo, false)
    if ("error" in v) return { success: false, error: v.error }
    const elegidas = leerElegidas(fd)
    const errElegidas = await validarElegidas(empresaId, r.cliente_id, v.ownerId, c.valor!, elegidas)
    if (errElegidas) return { success: false, error: errElegidas }

    let lectura: LecturaComprobante | null = (r.ocr as LecturaComprobante | null) ?? null
    let comprobanteId = r.comprobante_id
    if (archivo) {
      const bytes = new Uint8Array(await archivo.arrayBuffer())
      const dup = await recaudoConMismoComprobante(empresaId, huella(bytes), id)
      if (dup) return { success: false, error: `Ese comprobante ya fue reportado en el recaudo ${dup.numero}` }
      const ocr = await leerComprobante(bytes, archivo.type, await opcionesOcr(empresaId))
      if (ocr.disponible && !ocr.lectura.legible) {
        return { success: false, error: `Toma de nuevo la foto: ${ocr.lectura.motivo_ilegible ?? "no se alcanza a leer"}` }
      }
      lectura = ocr.disponible ? ocr.lectura : null
      const doc = await guardarDocumento({ empresaId, entidad: "recaudo", entidadId: id, tipoCodigo: "COMPROBANTE", bytes, mime: archivo.type, nombre: archivo.name, ctx, ocr: lectura })
      if (!doc.ok) return { success: false, error: doc.error }
      comprobanteId = doc.id
    }
    if (!comprobanteId && v.medio?.requiere_comprobante) return { success: false, error: "Adjunta el comprobante" }

    const alertas = compararConComprobante(
      { valor: c.valor!, fecha_documento: c.fecha_documento!, banco_nombre: v.bancoNombre, referencia: c.referencia }, lectura)
    const { data } = await db.from("crm_recaudos").update({
      owner_id: v.ownerId, fecha_documento: c.fecha_documento, valor: c.valor, medio_pago_id: c.medio_pago_id,
      banco_id: c.banco_id, cuenta_destino_id: c.cuenta_destino_id, referencia: c.referencia, observaciones: c.observaciones,
      comprobante_id: comprobanteId, ocr: lectura, ocr_alertas: alertas, estado: "pendiente_aprobacion",
      version: (r.version ?? 1) + 1, rechazado_por: null, rechazado_nombre: null, rechazado_en: null,
      motivo_rechazo_id: null, motivo_rechazo: null,
    }).eq("id", id).eq("estado", "rechazado").select("id")
    if (!data?.length) return { success: false, error: "El recaudo cambió de estado. Recarga la pantalla." }
    await guardarPropuesta(empresaId, id, r.cliente_id, v.ownerId, c.valor!, elegidas)
    await registrarEvento({
      empresaId, entidad: "recaudo", entidadId: id, tipo: "reenviado", estadoDesde: "rechazado", estadoHasta: "pendiente_aprobacion",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: alertas.length ? alertas.join(". ") : null, datos: { version: (r.version ?? 1) + 1 },
    })
    return { success: true, data: { alertas } }
  } catch (err) {
    return fallo(err)
  }
}

/** Anula un recaudo (Cartera). Si estaba aprobado, devuelve los saldos. */
export async function anularRecaudo(id: number, motivo: string, empresaId = 1): Promise<ActionResult> {
  try {
    const ctx = await exigirPermiso("anularRecaudo", "crm_recaudos_aprobar")
    if (!tienePermiso(ctx, "crm_recaudos_aprobar")) return { success: false, error: "No tienes permiso para anular recaudos" }
    const db = await getSupabaseAdmin()
    const r = await getRecaudoInterno(id, empresaId)
    if (!r) return { success: false, error: "El recaudo no existe" }
    const { data, error } = await db.rpc("crm_anular_recaudo", { p_recaudo_id: id, p_usuario_nombre: ctx.nombre, p_motivo: motivo })
    if (error) return { success: false, error: error.message }
    const res = data as { ok: boolean; error?: string }
    if (!res?.ok) return { success: false, error: res?.error ?? "No se pudo anular" }
    // Si ya estaba en la bandeja hacia SAP o LIPgo sin enviarse, no debe salir.
    await db.from("crm_integracion_outbox").update({ estado: "descartado", ultimo_error: `Descartado: recaudo anulado (${motivo})` })
      .eq("entidad", "recaudo").eq("entidad_id", id).in("estado", ["pendiente", "error"])
    await registrarEvento({
      empresaId, entidad: "recaudo", entidadId: id, tipo: "anulado", estadoDesde: r.estado, estadoHasta: "anulado",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: motivo,
    })
    return { success: true }
  } catch (err) {
    return fallo(err)
  }
}
