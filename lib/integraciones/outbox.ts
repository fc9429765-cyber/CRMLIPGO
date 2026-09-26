// Bandeja de salida hacia sistemas externos (patron outbox, INT-04).
//
// SIN "use server": se usa desde acciones del servidor y desde el cron, nunca
// desde el navegador.
//
// REGLA DE ORO: el negocio nunca espera a un sistema externo. Aprobar un
// pedido deja un registro aqui y termina; el envio a SAP o el WhatsApp salen
// despues, en `procesarLote`, que corre por cron o a mano desde el panel.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { leerParamBool, leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM, type ParamKey } from "@/lib/crm-parametros"
import { registrarEvento } from "@/lib/crm-eventos"
import {
  debeEncolarSap, esperaReintentoMin, flujoSapActivo, interpretarModoSap, llaveIdempotencia,
} from "./config"
import { getSapGateway } from "./sap/gateways"
import { canalWhatsapp } from "./whatsapp"
import type { AvisoEstandar, FlujoSap, ModoSap, RegistroOutbox, ResultadoEnvio, SistemaExterno } from "./tipos"

/** Modo de SAP de este despliegue. */
export function modoSapActual(): ModoSap {
  return interpretarModoSap(process.env.SAP_MODE)
}

const INTERRUPTOR: Record<FlujoSap, ParamKey> = {
  pedidos: PARAM.SAP_PEDIDOS,
  recaudos: PARAM.SAP_RECAUDOS,
  clientes: PARAM.SAP_CLIENTES,
  facturas: PARAM.SAP_FACTURAS,
  inventario: PARAM.SAP_INVENTARIO,
  sucursales: PARAM.SAP_SUCURSALES,
}

// ------------------------------------------------------------------ encolar

export interface NuevoEnvio {
  empresaId: number
  sistema: SistemaExterno
  flujo: string
  entidad: string
  entidadId: number | null
  operacion: string
  payload: Record<string, unknown>
  /** Sube cuando el mismo documento se reenvia corregido (p. ej. un pedido
   *  rechazado y vuelto a aprobar): es otra llave, otro envio. */
  version?: number
  creadoPor?: string | null
}

/**
 * Deja un envio en la bandeja. Idempotente: si ya hay uno con la misma llave,
 * no crea otro y devuelve el existente. Nunca lanza: un fallo aqui se registra
 * y no tumba la operacion de negocio que lo origino.
 */
export async function encolar(e: NuevoEnvio): Promise<{ ok: boolean; id?: number; duplicado?: boolean; error?: string }> {
  try {
    const supabase = await getSupabaseAdminAsSystem()
    const llave = llaveIdempotencia({
      sistema: e.sistema, entidad: e.entidad, entidadId: e.entidadId ?? "0",
      operacion: e.operacion, version: e.version,
    })
    const maxIntentos = await leerParamNumber(PARAM.OUTBOX_MAX_INTENTOS, e.empresaId, 5)

    const { data, error } = await supabase
      .from("crm_integracion_outbox")
      .upsert(
        {
          idempresa: e.empresaId,
          sistema: e.sistema,
          flujo: e.flujo,
          entidad: e.entidad,
          entidad_id: e.entidadId,
          operacion: e.operacion,
          payload: e.payload,
          idempotency_key: llave,
          max_intentos: maxIntentos,
          creado_por: e.creadoPor ?? null,
        },
        { onConflict: "idempresa,idempotency_key", ignoreDuplicates: true },
      )
      .select("id")

    if (error) throw error
    if (data?.length) return { ok: true, id: data[0].id as number }

    // ignoreDuplicates no devuelve la fila existente: se busca.
    const { data: previo } = await supabase
      .from("crm_integracion_outbox")
      .select("id")
      .eq("idempresa", e.empresaId)
      .eq("idempotency_key", llave)
      .maybeSingle()
    return { ok: true, id: previo?.id as number | undefined, duplicado: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[outbox] no se pudo encolar:", msg, e.sistema, e.operacion)
    return { ok: false, error: msg }
  }
}

/**
 * Encola un envio a SAP respetando el owner: lo de un owner que no factura por
 * SAP (Molinos) no se encola nunca, ni siquiera como pendiente.
 */
export async function encolarSap(
  e: Omit<NuevoEnvio, "sistema" | "flujo"> & { flujo: FlujoSap; ownerEnviaSap: boolean },
) {
  if (!debeEncolarSap(e.ownerEnviaSap)) return { ok: true, omitido: true as const }
  return encolar({ ...e, sistema: "sap" })
}

/** Encola un aviso de WhatsApp con la plantilla estandar. */
export async function encolarAviso(p: {
  empresaId: number
  evento: string
  entidad: string
  entidadId: number | null
  aviso: AvisoEstandar
  creadoPor?: string | null
}) {
  return encolar({
    empresaId: p.empresaId,
    sistema: "whatsapp",
    flujo: p.evento,
    entidad: p.entidad,
    entidadId: p.entidadId,
    // El celular va en la operacion para que la llave distinga a cada
    // destinatario del mismo evento.
    operacion: `aviso:${p.evento}:${p.aviso.celular}`,
    payload: p.aviso as unknown as Record<string, unknown>,
    creadoPor: p.creadoPor,
  })
}

// ------------------------------------------------------------------ procesar

export interface ResumenLote {
  tomados: number
  enviados: number
  errores: number
  enEspera: number
}

/**
 * Procesa un lote de la bandeja. Lo llama el cron y el boton "Procesar ahora"
 * del panel de integraciones.
 *
 * Un registro cuya integracion esta apagada NO se marca como fallido ni
 * consume intentos: vuelve a la cola con una espera larga. Asi, al encender
 * SAP, todo lo acumulado sale solo (criterio de aceptacion 3).
 */
export async function procesarLote(limite = 20, worker = "cron"): Promise<ResumenLote> {
  const supabase = await getSupabaseAdminAsSystem()
  const resumen: ResumenLote = { tomados: 0, enviados: 0, errores: 0, enEspera: 0 }

  const { data, error } = await supabase.rpc("crm_outbox_reclamar", { p_limite: limite, p_worker: worker })
  if (error) {
    console.error("[outbox] no se pudo reclamar el lote:", error.message)
    return resumen
  }

  const modo = modoSapActual()

  for (const reg of (data ?? []) as RegistroOutbox[]) {
    resumen.tomados++

    // ¿Esta encendido lo que este registro necesita?
    let activo = true
    let motivoEspera = ""
    if (reg.sistema === "sap") {
      const flujo = reg.flujo as FlujoSap
      const interruptor = INTERRUPTOR[flujo] ? await leerParamBool(INTERRUPTOR[flujo], reg.idempresa) : false
      // El owner ya se filtro al encolar: si esta aqui, factura por SAP.
      activo = flujoSapActivo({ modo, interruptorFlujo: interruptor, ownerEnviaSap: true })
      if (!activo) motivoEspera = modo === "disabled" ? "SAP desactivado" : `Flujo SAP "${flujo}" apagado`
    } else if (reg.sistema === "lipgo") {
      // Hoy LIPgo no tiene donde recibir recaudos (su "consola de
      // administrador" no existe). Quedan anotados hasta que la tenga.
      activo = false
      motivoEspera = "LIPgo aún no tiene dónde recibir este envío"
    }

    if (!activo) {
      await supabase
        .from("crm_integracion_outbox")
        .update({
          estado: "pendiente",
          bloqueado_por: null,
          bloqueado_en: null,
          ultimo_error: motivoEspera,
          proximo_intento_en: new Date(Date.now() + 60 * 60_000).toISOString(),
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", reg.id)
      resumen.enEspera++
      continue
    }

    const t0 = Date.now()
    let res: ResultadoEnvio
    try {
      if (reg.sistema === "sap") {
        res = await getSapGateway(modo).ejecutar(reg.operacion, reg.payload, reg.idempotency_key)
      } else if (reg.sistema === "whatsapp") {
        res = await canalWhatsapp.enviarAviso(reg.payload as unknown as AvisoEstandar)
      } else {
        res = { ok: false, reintentable: false, error: `Sistema sin implementación: ${reg.sistema}` }
      }
    } catch (e) {
      res = { ok: false, reintentable: true, error: e instanceof Error ? e.message : String(e) }
    }

    await supabase.from("crm_integracion_log").insert({
      idempresa: reg.idempresa,
      outbox_id: reg.id,
      sistema: reg.sistema,
      modo: reg.sistema === "sap" ? modo : canalWhatsapp.activo ? "live" : "disabled",
      request: res.request ?? null,
      response: res.respuesta ?? null,
      http_status: res.httpStatus ?? null,
      duracion_ms: Date.now() - t0,
      ok: res.ok,
      error: res.error ?? null,
    })

    const intentos = reg.intentos + 1

    // El documento de origen refleja el estado de SAP (INT-07): el pedido
    // muestra "En SAP" o "Error SAP" sin tener que abrir la bandeja.
    if (reg.sistema === "sap" && reg.entidad === "pedido" && reg.entidad_id) {
      const agotado = !res.ok && (res.reintentable === false || intentos >= reg.max_intentos)
      if (res.ok || agotado) {
        await supabase.from("crm_pedidos").update(
          res.ok
            ? { sap_estado: "enviado", sap_referencia: res.referencia ?? null, sap_error: null }
            : { sap_estado: "error", sap_error: res.error ?? "Error desconocido" },
        ).eq("id", reg.entidad_id)
      }
    }

    if (res.ok) {
      resumen.enviados++
      await supabase
        .from("crm_integracion_outbox")
        .update({
          estado: "enviado",
          intentos,
          referencia_externa: res.referencia ?? null,
          respuesta: res.respuesta ?? null,
          ultimo_error: null,
          enviado_en: new Date().toISOString(),
          bloqueado_por: null,
          bloqueado_en: null,
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", reg.id)
    } else {
      resumen.errores++
      const espera = esperaReintentoMin(intentos, await leerParamNumber(PARAM.OUTBOX_ESPERA_MIN, reg.idempresa, 5))
      // Un error no reintentable agota los intentos de una vez: seguir
      // mandando lo mismo a un sistema que lo rechaza por datos no sirve.
      await supabase
        .from("crm_integracion_outbox")
        .update({
          estado: "error",
          intentos: res.reintentable === false ? reg.max_intentos : intentos,
          ultimo_error: res.error ?? "Error desconocido",
          respuesta: res.respuesta ?? null,
          proximo_intento_en: new Date(Date.now() + espera * 60_000).toISOString(),
          bloqueado_por: null,
          bloqueado_en: null,
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", reg.id)

      if (res.reintentable === false || intentos >= reg.max_intentos) {
        await registrarEvento({
          empresaId: reg.idempresa,
          entidad: "integracion",
          entidadId: reg.id,
          tipo: "error_integracion",
          nota: res.error ?? null,
          datos: { sistema: reg.sistema, operacion: reg.operacion, entidad: reg.entidad, entidad_id: reg.entidad_id },
        })
      }
    }
  }

  return resumen
}
