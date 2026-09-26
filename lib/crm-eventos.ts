// Escritura en la bitacora unica del CRM (tabla crm_eventos, script 191).
//
// SIN "use server" A PROPOSITO: esto no es una accion que el navegador pueda
// invocar. Si lo fuera, cualquiera podria escribir eventos falsos en el
// historial de un pedido. Solo lo importan las acciones del servidor.
//
// Un evento que no se puede guardar NO tumba la operacion que lo origino:
// perder una linea del historial es malo, pero rechazar el pago de un cliente
// porque la bitacora fallo es peor. Se registra el fallo en el log del
// servidor y se sigue.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"

export type EntidadEvento =
  | "pedido" | "cotizacion" | "recaudo" | "cuenta" | "prospecto"
  | "cliente" | "documento" | "integracion" | "seguridad" | "importacion"
  // Script 198
  | "maestro" | "producto" | "vendedor" | "catalogo"

export interface NuevoEvento {
  empresaId: number
  entidad: EntidadEvento
  entidadId?: number | null
  /** Que paso: creado, editado, solicitado, firmado, rechazado, reenviado… */
  tipo: string
  estadoDesde?: string | null
  estadoHasta?: string | null
  usuarioId?: string | null
  usuarioNombre?: string | null
  nota?: string | null
  datos?: Record<string, unknown>
}

export async function registrarEvento(e: NuevoEvento): Promise<void> {
  try {
    const supabase = await getSupabaseAdminAsSystem()
    const { error } = await supabase.from("crm_eventos").insert({
      idempresa: e.empresaId,
      entidad: e.entidad,
      entidad_id: e.entidadId ?? null,
      tipo: e.tipo,
      estado_desde: e.estadoDesde ?? null,
      estado_hasta: e.estadoHasta ?? null,
      usuario_id: e.usuarioId ?? null,
      usuario_nombre: e.usuarioNombre ?? null,
      nota: e.nota ?? null,
      datos: e.datos ?? {},
    })
    if (error) console.error("[crm-eventos] no se pudo registrar:", error.message, e.tipo)
  } catch (err) {
    console.error("[crm-eventos] error inesperado:", err)
  }
}
