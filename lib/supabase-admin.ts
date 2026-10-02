// SIN "use server": este modulo entrega el cliente con la clave service_role
// (salta RLS). Como accion de servidor, cada funcion exportada seria invocable
// desde el navegador. Solo lo importa codigo del servidor.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { COOKIE_SESION, verificarSesion } from "@/lib/crm-token"
import { cache } from "react"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Tipo de esquema PERMISIVO: este proyecto no versiona tipos generados de la BD,
// así que sin un `Database` el cliente resolvía cada tabla a `never` y rompía
// `.from()/.insert()/.select()` en todo el repo. Tipar el cliente como
// SupabaseClient<any,any,any> en el helper (una sola vez) restablece el uso sin
// afectar runtime.
type DBClient = SupabaseClient<any, any, any>

// AUDITORÍA: cada cliente admin lleva ligado el header `x-audit-user` con el UUID
// del usuario logueado. El trigger de BD `fn_auditoria` lee ese header y así sabe
// QUIÉN hizo cada cambio (con service-role, `auth.uid()` sería NULL). Se cachea un
// cliente por actor para no recrearlo en cada llamada. Clave `__system__` = sin
// header (cron/background/contextos sin cookies) → auditoría queda como 'sistema'.
const SYSTEM = "__system__"
const clientsByActor = new Map<string, DBClient>()

function buildClient(auditUser?: string): DBClient {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(auditUser ? { global: { headers: { "x-audit-user": auditUser } } } : {}),
  })
}

// Resuelve el id del usuario del CRM (crm_usuarios.id) desde la cookie de
// sesion firmada. Solo se verifica la firma: para la auditoria basta saber
// quien firmo la peticion; la vigencia la valida lib/crm-sesion.ts en cada
// accion. Memoizado por request. Fuera de sesion (cron/jobs) devuelve null y la
// auditoria queda como 'sistema'.
const resolverActorId = cache(async (): Promise<string | null> => {
  try {
    const claims = await verificarSesion((await cookies()).get(COOKIE_SESION)?.value)
    return claims?.sub ?? null
  } catch {
    return null
  }
})

// Cliente admin service-role del usuario actual (para ESCRITURAS → auditoría con
// el actor correcto). Misma firma de siempre; el interior ahora inyecta el actor.
export async function getSupabaseAdmin(): Promise<DBClient> {
  const actor = await resolverActorId()
  const key = actor ?? SYSTEM
  let client = clientsByActor.get(key)
  if (!client) {
    client = buildClient(actor ?? undefined)
    clientsByActor.set(key, client)
  }
  return client
}

// Cliente admin SIN actor (auditoría = 'sistema'). Úsalo para LECTURAS puras y
// para jobs/cron, para no crear un cliente por-actor innecesario.
export async function getSupabaseAdminAsSystem(): Promise<DBClient> {
  let client = clientsByActor.get(SYSTEM)
  if (!client) {
    client = buildClient()
    clientsByActor.set(SYSTEM, client)
  }
  return client
}
