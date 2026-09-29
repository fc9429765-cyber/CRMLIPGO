// Implementaciones del contrato con SAP (INT-02).
//
//   disabled → no llama a nada. Nunca deberia recibir trabajo: el proceso de la
//              bandeja no toma registros de SAP con la conexion apagada, y asi
//              quedan pendientes para cuando se encienda.
//   mock     → simula SAP: numero de documento ficticio, latencia y errores
//              ocasionales si se pide. Sirve para probar el flujo completo sin
//              un SAP de por medio (criterio de aceptacion 2).
//   live     → SAP Business One Service Layer. CODIFICADO E INACTIVO: solo se
//              usa con SAP_MODE=live y las credenciales puestas.
//
// Cualquiera de las tres NUNCA lanza: devuelve { ok:false, error } para que el
// proceso de la bandeja registre el fallo fila por fila y siga con las demas.

import type { ModoSap, ResultadoEnvio, SapGateway } from "../tipos"

// ------------------------------------------------------------------ disabled

export const sapDesactivado: SapGateway = {
  modo: "disabled",
  async ejecutar(operacion) {
    return {
      ok: false,
      reintentable: true,
      error: `SAP está desactivado (SAP_MODE=disabled). La operación "${operacion}" queda pendiente.`,
    }
  },
}

// ---------------------------------------------------------------------- mock

/** Numero de documento ficticio pero estable: el mismo envio da el mismo
 *  numero, como haria un SAP real con una llave de idempotencia. */
function docEntryFicticio(llave: string): string {
  let h = 0
  for (const c of llave) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return String(100000 + (h % 900000))
}

export const sapSimulado: SapGateway = {
  modo: "mock",
  async ejecutar(operacion, payload, llave) {
    // `__simular_error` en el payload fuerza un fallo, para probar reintentos
    // y el panel de errores sin tener que romper nada de verdad.
    if (payload.__simular_error) {
      return {
        ok: false,
        reintentable: payload.__simular_error !== "permanente",
        error: `SAP simulado rechazó "${operacion}": ${String(payload.__simular_error)}`,
        request: { operacion, payload },
        httpStatus: 400,
      }
    }
    const referencia = `MOCK-${docEntryFicticio(llave)}`
    // El simulado acepta aunque falten codigos (criterio 2: probar el flujo
    // sin SAP), pero deja a la vista el documento que se habria mandado y lo
    // que falta mapear antes de pasar a live.
    return {
      ok: true,
      referencia,
      respuesta: {
        simulado: true, operacion, DocEntry: referencia,
        endpoint: payload.__endpoint ?? null,
        documento_sap: payload.sap ?? null,
        falta_mapear: payload.__faltantes ?? [],
        avisos: payload.__avisos ?? [],
      },
      request: { operacion, payload },
      httpStatus: 201,
    }
  },
}

// ---------------------------------------------------------------------- live

/**
 * SAP Business One Service Layer.
 *
 * Variables de entorno: SAP_SL_URL (ej. https://sap:50000/b1s/v1),
 * SAP_COMPANY_DB, SAP_USER, SAP_PASSWORD, y opcional SAP_UDF_REFERENCIA
 * (campo de usuario donde se guarda la llave del CRM; por defecto U_CRM_REF).
 *
 * PED-13: el pedido viaja con el PRECIO PERSONALIZADO aprobado en cada linea
 * (UnitPrice), no con el de lista. Es la queja que origino el requerimiento.
 *
 * Idempotencia (INT-09): antes de crear se busca un documento con la misma
 * llave en el campo de usuario. Si ya existe, se devuelve ese en vez de crear
 * otro. Si la consulta falla (p. ej. el campo no existe aun), se crea igual.
 */
const ENDPOINT: Record<string, string> = {
  crear_pedido: "Orders",
  crear_recaudo: "IncomingPayments",
  crear_cliente: "BusinessPartners",
}

let sesion: { cookie: string; expira: number } | null = null

async function login(base: string): Promise<string> {
  if (sesion && sesion.expira > Date.now()) return sesion.cookie
  const r = await fetch(`${base}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: process.env.SAP_COMPANY_DB,
      UserName: process.env.SAP_USER,
      Password: process.env.SAP_PASSWORD,
    }),
  })
  if (!r.ok) throw new Error(`Login en SAP falló (HTTP ${r.status})`)
  const cookie = (r.headers.get("set-cookie") ?? "")
    .split(/,(?=\s*\w+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.startsWith("B1SESSION") || c.startsWith("ROUTEID"))
    .join("; ")
  // La sesion de Service Layer dura 30 min por defecto; se renueva a los 25.
  sesion = { cookie, expira: Date.now() + 25 * 60_000 }
  return cookie
}

export const sapReal: SapGateway = {
  modo: "live",
  async ejecutar(operacion, payload, llave) {
    const base = process.env.SAP_SL_URL
    const endpoint = (payload.__endpoint as string | undefined) ?? ENDPOINT[operacion]
    if (!base || !process.env.SAP_COMPANY_DB || !process.env.SAP_USER || !process.env.SAP_PASSWORD) {
      return { ok: false, reintentable: false, error: "Faltan SAP_SL_URL, SAP_COMPANY_DB, SAP_USER o SAP_PASSWORD." }
    }
    if (!endpoint) {
      return { ok: false, reintentable: false, error: `Operación SAP desconocida: "${operacion}"` }
    }

    // Solo se manda un documento ya traducido (lib/integraciones/sap/traductor):
    // el evento crudo del CRM no es un documento que SAP entienda.
    if (!payload.sap) {
      return { ok: false, reintentable: false, error: "El evento no se tradujo a documento SAP (revisa Mapeos SAP)." }
    }
    const udf = process.env.SAP_UDF_REFERENCIA || "U_CRM_REF"
    const cuerpo = { ...(payload.sap as Record<string, unknown>), [udf]: llave }

    try {
      const cookie = await login(base)
      const headers = { "Content-Type": "application/json", Cookie: cookie }

      // ¿Ya existe? (idempotencia)
      try {
        const filtro = encodeURIComponent(`${udf} eq '${llave.replace(/'/g, "''")}'`)
        // Los socios de negocio no tienen DocEntry: su llave es CardCode.
        const campos = endpoint === "BusinessPartners" ? "CardCode" : "DocEntry,CardCode"
        const q = await fetch(`${base}/${endpoint}?$filter=${filtro}&$select=${campos}`, { headers })
        if (q.ok) {
          const d = (await q.json()) as { value?: { DocEntry?: number; CardCode?: string }[] }
          const previo = d.value?.[0]
          if (previo) {
            return {
              ok: true,
              referencia: String(previo.DocEntry ?? previo.CardCode),
              respuesta: { ya_existia: true },
              request: { operacion, llave },
              httpStatus: 200,
            }
          }
        }
      } catch {
        /* sin campo de usuario: se sigue y se crea */
      }

      const r = await fetch(`${base}/${endpoint}`, { method: "POST", headers, body: JSON.stringify(cuerpo) })
      const texto = await r.text()
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(texto) } catch { data = { cuerpo: texto } }

      if (r.status === 401) sesion = null
      if (!r.ok) {
        const err = (data.error as { message?: { value?: string } } | undefined)?.message?.value
        return {
          ok: false,
          // 4xx = datos que SAP no acepta: reintentar no cambia nada.
          reintentable: r.status >= 500 || r.status === 401 || r.status === 429,
          error: err || `HTTP ${r.status}`,
          respuesta: data,
          request: { operacion, cuerpo },
          httpStatus: r.status,
        }
      }
      return {
        ok: true,
        referencia: String(data.DocEntry ?? data.CardCode ?? ""),
        respuesta: data,
        request: { operacion, cuerpo },
        httpStatus: r.status,
      }
    } catch (e) {
      return { ok: false, reintentable: true, error: e instanceof Error ? e.message : "Error de red con SAP" }
    }
  },
}

/**
 * Prueba de conexion con Service Layer, sin tocar ningun documento: inicia
 * sesion, lee un socio de negocio y cierra la sesion. Sirve para confirmar
 * URL, base y credenciales antes de encender un flujo.
 */
export async function probarServiceLayer(): Promise<{ ok: boolean; ms: number; detalle: string }> {
  const t0 = Date.now()
  const base = process.env.SAP_SL_URL
  const faltan = ["SAP_SL_URL", "SAP_COMPANY_DB", "SAP_USER", "SAP_PASSWORD"].filter((k) => !process.env[k])
  if (faltan.length) return { ok: false, ms: 0, detalle: `Faltan variables de entorno: ${faltan.join(", ")}` }
  try {
    const login = await fetch(`${base}/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CompanyDB: process.env.SAP_COMPANY_DB, UserName: process.env.SAP_USER, Password: process.env.SAP_PASSWORD }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!login.ok) return { ok: false, ms: Date.now() - t0, detalle: `SAP rechazó el inicio de sesión (HTTP ${login.status}). Revisa base y credenciales.` }
    const cookie = (login.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/).map((c) => c.split(";")[0].trim())
      .filter((c) => c.startsWith("B1SESSION") || c.startsWith("ROUTEID")).join("; ")
    const q = await fetch(`${base}/BusinessPartners?$top=1&$select=CardCode`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000) })
    await fetch(`${base}/Logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => undefined)
    if (!q.ok) return { ok: false, ms: Date.now() - t0, detalle: `Inició sesión pero no pudo leer socios de negocio (HTTP ${q.status}). Revisa permisos del usuario SAP.` }
    return { ok: true, ms: Date.now() - t0, detalle: `Conectado a ${process.env.SAP_COMPANY_DB}` }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detalle: e instanceof Error ? `Sin respuesta de SAP: ${e.message}` : "Sin respuesta de SAP" }
  }
}

export function getSapGateway(modo: ModoSap): SapGateway {
  return modo === "live" ? sapReal : modo === "mock" ? sapSimulado : sapDesactivado
}

export type { ResultadoEnvio }
