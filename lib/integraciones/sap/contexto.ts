// Lee de la base lo que el traductor necesita para un evento: los codigos SAP
// de sus ids y los maestros con codigo propio. Solo servidor, sin "use server".

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { leerParam } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { clave, necesidades, traducir, type ContextoSap, type Traduccion } from "./traductor"

export async function cargarContextoSap(empresaId: number, operacion: string, payload: Record<string, unknown>): Promise<ContextoSap> {
  const db = await getSupabaseAdminAsSystem()
  const req = necesidades(operacion, payload)
  const porEntidad = new Map<string, number[]>()
  for (const n of req) porEntidad.set(n.entidad, [...(porEntidad.get(n.entidad) ?? []), n.id])

  const [mapeos, impuestos, medios, cuentas, prefijo] = await Promise.all([
    Promise.all([...porEntidad.entries()].map(([entidad, ids]) =>
      db.from("crm_sap_mapeo").select("entidad, entidad_id, codigo_sap")
        .eq("idempresa", empresaId).eq("entidad", entidad).in("entidad_id", [...new Set(ids)]))),
    db.from("crm_impuestos").select("id, tarifa, nombre, sap_codigo").eq("idempresa", empresaId),
    db.from("crm_medios_pago").select("id, codigo, nombre").eq("idempresa", empresaId),
    db.from("crm_cuentas_destino").select("id, alias, sap_cuenta").eq("idempresa", empresaId),
    leerParam(PARAM.SAP_PREFIJO_CLIENTE, empresaId),
  ])

  const codigos: Record<string, string> = {}
  for (const r of mapeos) {
    for (const m of r.data ?? []) codigos[clave(m.entidad, m.entidad_id as number)] = String(m.codigo_sap)
  }
  return {
    codigos,
    impuestos: (impuestos.data ?? []).map((i) => ({ id: i.id as number, tarifa: Number(i.tarifa), nombre: String(i.nombre), sap_codigo: (i.sap_codigo as string) ?? null })),
    medios: Object.fromEntries((medios.data ?? []).map((m) => [m.id as number, { codigo: String(m.codigo), nombre: String(m.nombre) }])),
    cuentas: Object.fromEntries((cuentas.data ?? []).map((c) => [c.id as number, { alias: String(c.alias), sap_cuenta: (c.sap_cuenta as string) ?? null }])),
    prefijoCliente: prefijo || "C",
  }
}

/** Traduce un evento de la bandeja con los codigos vigentes en la base. */
export async function traducirEvento(empresaId: number, operacion: string, payload: Record<string, unknown>): Promise<Traduccion> {
  return traducir(operacion, payload as Record<string, any>, await cargarContextoSap(empresaId, operacion, payload))
}

/**
 * Tras crear un cliente en SAP, su CardCode queda en Mapeos SAP: los pedidos
 * y recaudos de ese cliente ya salen sin que nadie tenga que copiarlo a mano.
 */
export async function recordarCardCode(empresaId: number, clienteId: number, cardCode: string) {
  const db = await getSupabaseAdminAsSystem()
  await db.from("crm_sap_mapeo").upsert(
    { idempresa: empresaId, entidad: "cliente", entidad_id: clienteId, codigo_sap: cardCode, actualizado_por: "SAP (alta de cliente)", actualizado_en: new Date().toISOString() },
    { onConflict: "idempresa,entidad,entidad_id" },
  )
}
