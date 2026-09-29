"use server"

// Estado de cuenta del cliente en PDF (EDC-01, EDC-02).
//
// PLANTILLA PARAMETRIZABLE. Mientras INDUPAN entrega su formato oficial
// (pregunta abierta EDC-02), el membrete sale del owner que cobra: logo, NIT,
// direccion, contacto, color y texto legal se editan en Maestros → Owners, y
// la nota al cliente y los dias de movimientos en Parametrizacion. Cambiar el
// formato no exige tocar codigo.
//
// UN ESTADO DE CUENTA POR OWNER. INDUPAN y Molinos del Atlantico cobran por
// separado y con NIT distinto: un solo documento con las dos carteras seria un
// cobro de una empresa por facturas de otra. Si el cliente debe a los dos, se
// pide elegir.
//
// COMPARTIR: el PDF se guarda en el bucket privado como documento del cliente
// y se entrega un enlace que caduca (estado_cuenta.enlace_dias), listo para
// WhatsApp. Nunca un enlace publico: lleva saldos y referencias de pago.

import { asegurarClienteVisible, exigirPermiso, mensajeError } from "@/lib/crm-auth"
import { leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { guardarDocumento, urlFirmada } from "@/lib/crm-documentos-server"
import { registrarEvento } from "@/lib/crm-eventos"
import { normalizarCelularCO } from "@/lib/integraciones/whatsapp"
import { construirEstadoCuenta, type OpcionesEstadoCuenta } from "@/lib/crm-estado-cuenta-server"

const VER = [
  "crm_clientes", "crm_cartera", "crm_pagos", "crm_recaudos_registrar", "crm_recaudos_aprobar",
  "crm_autorizar_contabilidad", "crm_autorizar_gerencia",
] as const

export interface ResultadoEstadoCuenta {
  success: boolean
  base64?: string
  nombreArchivo?: string
  error?: string
  /** Si el cliente debe a varios owners y no se indico cual. */
  requiereOwner?: { id: number; nombre: string }[]
}

export async function generarEstadoCuenta(
  clienteId: number, opciones: OpcionesEstadoCuenta = {}, empresaId = 1,
): Promise<ResultadoEstadoCuenta> {
  try {
    const ctx = await exigirPermiso("generarEstadoCuenta", ...VER)
    await asegurarClienteVisible(ctx, clienteId)
    const r = await construirEstadoCuenta(ctx, clienteId, opciones, empresaId)
    if ("error" in r) return { success: false, error: r.error }
    if ("requiereOwner" in r) return { success: false, error: "El cliente debe a varias empresas: elige cuál", requiereOwner: r.requiereOwner }
    return { success: true, base64: Buffer.from(r.bytes).toString("base64"), nombreArchivo: r.nombreArchivo }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}

export interface EnlaceEstadoCuenta {
  url: string
  venceEl: string
  /** Celular del cliente en formato internacional, si es valido. */
  celular: string | null
  mensaje: string
}

/**
 * Guarda el estado de cuenta en el bucket privado y devuelve un enlace que
 * caduca, con el mensaje listo para WhatsApp (EDC-01).
 */
export async function compartirEstadoCuenta(
  clienteId: number, opciones: OpcionesEstadoCuenta = {}, empresaId = 1,
): Promise<{ success: boolean; data?: EnlaceEstadoCuenta; error?: string; requiereOwner?: { id: number; nombre: string }[] }> {
  try {
    const ctx = await exigirPermiso("compartirEstadoCuenta", ...VER)
    await asegurarClienteVisible(ctx, clienteId)
    const r = await construirEstadoCuenta(ctx, clienteId, opciones, empresaId)
    if ("error" in r) return { success: false, error: r.error }
    if ("requiereOwner" in r) return { success: false, error: "El cliente debe a varias empresas: elige cuál", requiereOwner: r.requiereOwner }

    const doc = await guardarDocumento({
      empresaId, entidad: "cliente", entidadId: clienteId, tipoCodigo: "ESTADO_CUENTA",
      bytes: r.bytes, mime: "application/pdf", nombre: r.nombreArchivo, ctx,
    })
    if (!doc.ok) return { success: false, error: doc.error }
    const dias = Math.max(1, await leerParamNumber(PARAM.ESTADO_CUENTA_ENLACE_DIAS, empresaId, 7))
    const firmada = await urlFirmada(doc.id, empresaId, dias * 86_400)
    if (!firmada) return { success: false, error: "No se pudo crear el enlace" }

    const venceEl = new Date(Date.now() + dias * 86_400_000).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })
    const saludo = r.cliente.personacontacto ? `Hola ${String(r.cliente.personacontacto).split(" ")[0]}` : "Hola"
    const mensaje =
      `${saludo}, le compartimos el estado de cuenta de ${r.cliente.nombre} con ${r.emisor}. ` +
      `Saldo a la fecha: $ ${Math.round(r.saldo).toLocaleString("es-CO")}.\n${firmada.url}\n` +
      `(El enlace estará disponible hasta el ${venceEl}.)`

    await registrarEvento({
      empresaId, entidad: "cliente", entidadId: clienteId, tipo: "estado_cuenta_compartido",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, datos: { documento_id: doc.id, owner_id: r.ownerId, dias },
    })
    return {
      success: true,
      data: { url: firmada.url, venceEl, celular: normalizarCelularCO(r.cliente.celular), mensaje },
    }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}
