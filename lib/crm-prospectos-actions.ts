"use server"

// Prospectos: el embudo comercial.
//
// Convencion del proyecto, heredada de LIPgo y conservada a proposito:
//   - "use server" + solo funciones async (los tipos viven en crm-prospectos.ts)
//   - envelope { success, data?, error? }, nunca throw
//   - empresaId explicito en cada funcion, aunque hoy siempre valga 1
//   - try/catch en todas: un error de red no puede tumbar la pantalla

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { hoyISO } from "@/lib/crm-fechas"
import {
  exigirPermiso, exigirSesion, filtrarPorVendedor, asegurarClienteVisible, mensajeError,
  type ContextoCrm,
} from "@/lib/crm-auth"
import type {
  Prospecto, ProspectoInteres, Actividad, Etapa, ProspectoConEtapa,
  NuevoProspecto, ResumenEmbudo,
} from "@/lib/crm-prospectos"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

function fallo(err: unknown): ActionResult<never> {
  const msg = mensajeError(err)
  console.error("[crm-prospectos]", msg)
  return { success: false, error: msg }
}

// Permisos del embudo. Cualquiera de los dos basta: el kanban y la ficha de
// prospectos son dos vistas del mismo dato, y quien trabaja en una necesita
// la otra.
const PERM_PROSPECTOS = ["crm_prospectos", "crm_embudo"] as const

/**
 * Columnas que la interfaz puede escribir en un prospecto. Todo lo demas
 * (estado de aprobacion, cliente creado, enlace de carga, firmas) lo escriben
 * solo las acciones que lo gobiernan. Sin esta lista, crear o editar un
 * prospecto copiaba lo que mandara el navegador: bastaba enviar
 * `estado_aprobacion: "aprobado"` para saltarse a Cartera.
 */
const CAMPOS_DATOS = [
  "razon_social", "nombre_comercial", "documento", "tipo_documento",
  "contacto_nombre", "contacto_cargo", "contacto_celular", "contacto_telefono", "contacto_email",
  "direccion", "barrio", "ciudad", "departamento", "latitud", "longitud", "gps_precision_m",
] as const
/** Seguimiento comercial: se puede tocar aun con el prospecto en revision o aprobado. */
const CAMPOS_SEGUIMIENTO = [
  "valor_estimado", "probabilidad_manual", "fuente", "proxima_accion", "proxima_fecha", "proxima_hora",
  "observaciones", "motivo_perdida", "activo",
] as const

function soloCampos(obj: Record<string, unknown>, campos: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const k of campos) if (k in obj) out[k] = obj[k]
  return out
}

/**
 * true si el prospecto existe en la empresa y el usuario lo puede ver.
 *
 * Un vendedor que adivina el id de un prospecto ajeno no debe poder leerlo
 * ni moverlo. Se responde igual que si no existiera: decir "es de otro"
 * confirmaria que el id es valido.
 */
async function prospectoVisible(
  supabase: Awaited<ReturnType<typeof getSupabaseAdmin>>,
  ctx: ContextoCrm,
  id: number,
  empresaId?: number,
): Promise<boolean> {
  let q = supabase.from("crm_prospectos").select("id").eq("id", id)
  if (empresaId != null) q = q.eq("idempresa", empresaId)
  q = filtrarPorVendedor(q, ctx, "vendedor_id") as typeof q
  const { data } = await q.maybeSingle()
  return !!data
}

// ---------------------------------------------------------------- Etapas

export async function getEtapas(empresaId = 1): Promise<ActionResult<Etapa[]>> {
  try {
    // Las etapas son configuracion, no datos de nadie: basta con sesion.
    await exigirSesion()
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("crm_etapas")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .order("orden")

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as Etapa[] }
  } catch (err) {
    return fallo(err)
  }
}

// ------------------------------------------------------------ Prospectos

export async function getProspectos(
  empresaId = 1,
  filtros?: { etapaId?: number; vendedorId?: number; busqueda?: string; soloActivos?: boolean },
): Promise<ActionResult<ProspectoConEtapa[]>> {
  try {
    const ctx = await exigirPermiso("getProspectos", ...PERM_PROSPECTOS)
    const supabase = await getSupabaseAdmin()

    // El join con crm_etapas trae nombre y probabilidad en la misma consulta:
    // el embudo los necesita en cada tarjeta y pedirlos aparte serian N+1.
    let q = supabase
      .from("crm_prospectos")
      .select("*, etapa:crm_etapas(id, nombre, orden, probabilidad, color, es_ganada, es_perdida)")
      .eq("idempresa", empresaId)

    if (filtros?.soloActivos !== false) q = q.eq("activo", true)
    if (filtros?.etapaId) q = q.eq("etapa_id", filtros.etapaId)
    if (filtros?.vendedorId) q = q.eq("vendedor_id", filtros.vendedorId)
    if (filtros?.busqueda) {
      const t = filtros.busqueda.trim()
      q = q.or(`razon_social.ilike.%${t}%,nombre_comercial.ilike.%${t}%,documento.ilike.%${t}%,codigo.ilike.%${t}%`)
    }
    // El vendedor ve solo su embudo, pida el filtro que pida.
    q = filtrarPorVendedor(q, ctx, "vendedor_id") as typeof q

    const { data, error } = await q.order("actualizado_en", { ascending: false }).limit(500)
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as ProspectoConEtapa[] }
  } catch (err) {
    return fallo(err)
  }
}

export async function getProspecto(id: number, empresaId = 1): Promise<ActionResult<ProspectoConEtapa>> {
  try {
    const ctx = await exigirPermiso("getProspecto", ...PERM_PROSPECTOS)
    const supabase = await getSupabaseAdmin()
    let q = supabase
      .from("crm_prospectos")
      .select("*, etapa:crm_etapas(id, nombre, orden, probabilidad, color, es_ganada, es_perdida)")
      .eq("id", id)
      .eq("idempresa", empresaId)
    // Fuera de su alcance se responde como si no existiera.
    q = filtrarPorVendedor(q, ctx, "vendedor_id") as typeof q
    const { data, error } = await q.maybeSingle()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "El prospecto no existe" }
    return { success: true, data: data as ProspectoConEtapa }
  } catch (err) {
    return fallo(err)
  }
}

export async function crearProspecto(
  entrada: NuevoProspecto,
  // Se ignora: quien crea sale de la sesion, no de lo que mande el navegador.
  _usuario: string,
  empresaId = 1,
): Promise<ActionResult<Prospecto>> {
  try {
    const ctx = await exigirPermiso("crearProspecto", ...PERM_PROSPECTOS)
    if (!entrada.razon_social?.trim()) {
      return { success: false, error: "La razón social es obligatoria" }
    }

    const supabase = await getSupabaseAdmin()

    // Si no viene etapa, arranca en la primera del embudo.
    let etapaId = entrada.etapa_id
    if (!etapaId) {
      const { data: primera } = await supabase
        .from("crm_etapas")
        .select("id")
        .eq("idempresa", empresaId)
        .eq("activo", true)
        .order("orden")
        .limit(1)
        .maybeSingle()
      etapaId = primera?.id
    }
    if (!etapaId) return { success: false, error: "No hay etapas configuradas en el embudo" }

    const { interes } = entrada
    const cabecera = soloCampos(entrada as unknown as Record<string, unknown>, [...CAMPOS_DATOS, ...CAMPOS_SEGUIMIENTO])
    // Sin vendedor explicito, el prospecto es de quien lo crea. Si no, un
    // vendedor crearia prospectos que despues no podria ver. Un vendedor con
    // alcance "propios" no puede crearlo a nombre de otro.
    const vendedorId = ctx.alcance === "propios" ? ctx.vendedorId : entrada.vendedor_id ?? ctx.vendedorId

    // El codigo lo asigna un trigger (PROS-2026-0001), por eso no se manda.
    const { data, error } = await supabase
      .from("crm_prospectos")
      .insert({
        ...cabecera,
        vendedor_id: vendedorId,
        idempresa: empresaId,
        etapa_id: etapaId,
        // El GPS solo se sella si de verdad llego una coordenada.
        gps_capturado_en: entrada.latitud != null ? new Date().toISOString() : null,
        creado_por: ctx.nombre,
      })
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    // Productos de interes, si los hay.
    if (interes?.length) {
      const filas = interes
        .filter((i) => i.producto_nombre?.trim())
        .map((i) => ({ ...i, prospecto_id: data.id, idempresa: empresaId }))

      if (filas.length) {
        const { error: errInteres } = await supabase.from("crm_prospecto_interes").insert(filas)
        // El interes no invalida el prospecto: se avisa, no se revierte.
        if (errInteres) console.error("[crm-prospectos] interés:", errInteres.message)
      }
    }

    // Si se agendo un proximo contacto, entra en la agenda.
    if (entrada.proxima_fecha) {
      await supabase.from("crm_agenda").insert({
        idempresa: empresaId,
        titulo: entrada.proxima_accion || `Contactar a ${entrada.razon_social}`,
        tipo: "visita",
        fecha: entrada.proxima_fecha,
        hora_inicio: entrada.proxima_hora ?? null,
        prospecto_id: data.id,
        vendedor_id: vendedorId,
        direccion: entrada.direccion ?? null,
        latitud: entrada.latitud ?? null,
        longitud: entrada.longitud ?? null,
        creado_por: ctx.nombre,
      })
    }

    return { success: true, data: data as Prospecto }
  } catch (err) {
    return fallo(err)
  }
}

export async function actualizarProspecto(
  id: number,
  cambios: Partial<Prospecto>,
  empresaId = 1,
): Promise<ActionResult<Prospecto>> {
  try {
    const ctx = await exigirPermiso("actualizarProspecto", ...PERM_PROSPECTOS)
    const supabase = await getSupabaseAdmin()
    if (!(await prospectoVisible(supabase, ctx, id, empresaId))) {
      return { success: false, error: "El prospecto no existe" }
    }

    // Solo columnas de datos y seguimiento. Con el prospecto en revision o ya
    // aprobado, los datos que Cartera valido (NIT, razon social, direccion…)
    // quedan fijos: cambiarlos despues cambiaria lo que se aprobo.
    const { data: actual } = await supabase.from("crm_prospectos").select("estado_aprobacion").eq("id", id).maybeSingle()
    const editableDatos = !actual?.estado_aprobacion || ["borrador", "rechazado"].includes(actual.estado_aprobacion as string)
    const limpio: Record<string, unknown> = soloCampos(
      cambios as unknown as Record<string, unknown>,
      editableDatos ? [...CAMPOS_DATOS, ...CAMPOS_SEGUIMIENTO] : CAMPOS_SEGUIMIENTO,
    )
    if (ctx.alcance === "todos" && "vendedor_id" in (cambios as object)) limpio.vendedor_id = (cambios as { vendedor_id?: number | null }).vendedor_id
    if (!Object.keys(limpio).length) {
      return { success: false, error: editableDatos ? "Nada que actualizar" : "El prospecto está en revisión o aprobado: sus datos ya no se editan" }
    }

    const { data, error } = await supabase
      .from("crm_prospectos")
      .update(limpio)
      .eq("id", id)
      .eq("idempresa", empresaId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as Prospecto }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Mueve un prospecto de etapa (el arrastre del kanban).
 *
 * Deja rastro en la bitacora: el embudo sin historia no sirve para aprender
 * por que se gana o se pierde.
 */
export async function moverEtapa(
  id: number,
  etapaId: number,
  // Se ignora: la bitacora firma con el usuario de la sesion.
  _usuario: string,
  empresaId = 1,
  motivo?: string,
): Promise<ActionResult<Prospecto>> {
  try {
    const ctx = await exigirPermiso("moverEtapa", ...PERM_PROSPECTOS)
    const supabase = await getSupabaseAdmin()

    // Un prospecto fuera del alcance no aparece: se trata como inexistente.
    let qActual = supabase.from("crm_prospectos")
      .select("id, razon_social, etapa_id, etapa:crm_etapas(nombre)")
      .eq("id", id).eq("idempresa", empresaId)
    qActual = filtrarPorVendedor(qActual, ctx, "vendedor_id") as typeof qActual

    const [{ data: actual }, { data: etapa }] = await Promise.all([
      qActual.maybeSingle(),
      supabase.from("crm_etapas")
        .select("id, nombre, es_ganada, es_perdida")
        .eq("id", etapaId).maybeSingle(),
    ])

    if (!actual) return { success: false, error: "El prospecto no existe" }
    if (!etapa) return { success: false, error: "La etapa no existe" }

    const cambios: Record<string, unknown> = { etapa_id: etapaId }

    // Al llegar a una etapa terminal se sella la fecha de cierre.
    if (etapa.es_ganada || etapa.es_perdida) {
      cambios.fecha_cierre = hoyISO()
      if (etapa.es_perdida && motivo) cambios.motivo_perdida = motivo
    } else {
      // Si vuelve atras desde una terminal, se limpia el cierre.
      cambios.fecha_cierre = null
    }

    const { data, error } = await supabase
      .from("crm_prospectos")
      .update(cambios)
      .eq("id", id)
      .eq("idempresa", empresaId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    const etapaPrevia = (actual as any).etapa?.nombre ?? "etapa anterior"
    await supabase.from("crm_actividades").insert({
      idempresa: empresaId,
      prospecto_id: id,
      tipo: "nota",
      asunto: `Cambio de etapa: ${etapaPrevia} → ${etapa.nombre}`,
      detalle: motivo ?? null,
      usuario: ctx.nombre,
    })

    return { success: true, data: data as Prospecto }
  } catch (err) {
    return fallo(err)
  }
}

// ------------------------------------------------------ Productos de interés

export async function getInteres(prospectoId: number): Promise<ActionResult<ProspectoInteres[]>> {
  try {
    const ctx = await exigirPermiso("getInteres", ...PERM_PROSPECTOS)
    const supabase = await getSupabaseAdmin()
    // El interes trae lo que el prospecto paga hoy a su proveedor: se protege
    // igual que el prospecto mismo.
    if (!(await prospectoVisible(supabase, ctx, prospectoId))) {
      return { success: false, error: "No encontrado" }
    }
    const { data, error } = await supabase
      .from("crm_prospecto_interes")
      .select("*")
      .eq("prospecto_id", prospectoId)
      .order("id")

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as ProspectoInteres[] }
  } catch (err) {
    return fallo(err)
  }
}

export async function guardarInteres(
  prospectoId: number,
  lineas: Omit<ProspectoInteres, "id" | "prospecto_id" | "idempresa" | "creado_en">[],
  empresaId = 1,
): Promise<ActionResult<ProspectoInteres[]>> {
  try {
    const ctx = await exigirPermiso("guardarInteres", ...PERM_PROSPECTOS)
    const supabase = await getSupabaseAdmin()
    if (!(await prospectoVisible(supabase, ctx, prospectoId, empresaId))) {
      return { success: false, error: "No encontrado" }
    }

    // Se reemplaza el conjunto completo: son pocas lineas y comparar cual
    // cambio no compensa la complejidad.
    await supabase.from("crm_prospecto_interes").delete().eq("prospecto_id", prospectoId)

    const filas = lineas
      .filter((l) => l.producto_nombre?.trim())
      .map((l) => ({ ...l, prospecto_id: prospectoId, idempresa: empresaId }))

    if (!filas.length) return { success: true, data: [] }

    const { data, error } = await supabase.from("crm_prospecto_interes").insert(filas).select()
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as ProspectoInteres[] }
  } catch (err) {
    return fallo(err)
  }
}

// ----------------------------------------------------------- Actividades

export async function getActividades(
  empresaId = 1,
  filtros?: { prospectoId?: number; clienteId?: number; desde?: string; limite?: number },
): Promise<ActionResult<Actividad[]>> {
  try {
    const ctx = await exigirPermiso("getActividades", "crm_actividades", "crm_prospectos")
    const supabase = await getSupabaseAdmin()
    let q = supabase.from("crm_actividades").select("*").eq("idempresa", empresaId)

    if (filtros?.prospectoId) q = q.eq("prospecto_id", filtros.prospectoId)
    if (filtros?.clienteId) q = q.eq("cliente_id", filtros.clienteId)

    // Alcance. Con prospecto o cliente se valida ESE registro y se muestra su
    // historia completa: hay actividades sin vendedor_id (los cambios de
    // etapa, por ejemplo) y filtrar por esa columna las esconderia de la
    // ficha. Sin ninguno de los dos es un listado general: se filtra por
    // vendedor.
    if (filtros?.prospectoId) {
      if (!(await prospectoVisible(supabase, ctx, filtros.prospectoId, empresaId))) {
        return { success: false, error: "No encontrado" }
      }
    } else if (filtros?.clienteId) {
      await asegurarClienteVisible(ctx, filtros.clienteId)
    } else {
      q = filtrarPorVendedor(q, ctx, "vendedor_id") as typeof q
    }
    if (filtros?.desde) q = q.gte("fecha_hora", filtros.desde)

    const { data, error } = await q
      .order("fecha_hora", { ascending: false })
      .limit(filtros?.limite ?? 100)

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as Actividad[] }
  } catch (err) {
    return fallo(err)
  }
}

export async function registrarActividad(
  actividad: Omit<Actividad, "id" | "creado_en">,
  empresaId = 1,
): Promise<ActionResult<Actividad>> {
  try {
    const ctx = await exigirPermiso(
      "registrarActividad", "crm_actividades", "crm_prospectos", "crm_agenda",
    )
    if (!actividad.prospecto_id && !actividad.cliente_id) {
      return { success: false, error: "La actividad debe ir asociada a un prospecto o a un cliente" }
    }
    if (!actividad.asunto?.trim()) {
      return { success: false, error: "El asunto es obligatorio" }
    }

    const supabase = await getSupabaseAdmin()
    if (actividad.prospecto_id && !(await prospectoVisible(supabase, ctx, actividad.prospecto_id, empresaId))) {
      return { success: false, error: "No encontrado" }
    }
    if (actividad.cliente_id) await asegurarClienteVisible(ctx, actividad.cliente_id)

    const { data, error } = await supabase
      .from("crm_actividades")
      .insert({
        ...actividad,
        idempresa: empresaId,
        // Quien registra sale de la sesion; el `usuario` que venga del
        // navegador se ignora.
        usuario: ctx.nombre,
        vendedor_id: actividad.vendedor_id ?? ctx.vendedorId,
      })
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    // Registrar actividad sobre un prospecto lo saca de "sin gestion": se
    // refresca su marca de tiempo para que las alertas dejen de senalarlo.
    if (actividad.prospecto_id) {
      await supabase
        .from("crm_prospectos")
        .update({ actualizado_en: new Date().toISOString() })
        .eq("id", actividad.prospecto_id)
    }

    return { success: true, data: data as Actividad }
  } catch (err) {
    return fallo(err)
  }
}

// --------------------------------------------------------------- Embudo

/** Resumen por etapa: cuantos, cuanto valen y cuanto vale ponderado. */
export async function getResumenEmbudo(empresaId = 1, vendedorId?: number): Promise<ActionResult<ResumenEmbudo>> {
  try {
    const ctx = await exigirPermiso("getResumenEmbudo", "crm_embudo", "crm_dashboard")
    const supabase = await getSupabaseAdmin()

    const [etapasRes, prospectosRes] = await Promise.all([
      supabase.from("crm_etapas").select("*").eq("idempresa", empresaId).eq("activo", true).order("orden"),
      (() => {
        let q = supabase
          .from("crm_prospectos")
          .select("id, etapa_id, valor_estimado, probabilidad_manual")
          .eq("idempresa", empresaId)
          .eq("activo", true)
        if (vendedorId) q = q.eq("vendedor_id", vendedorId)
        return filtrarPorVendedor(q, ctx, "vendedor_id") as typeof q
      })(),
    ])

    if (etapasRes.error) return { success: false, error: etapasRes.error.message }
    if (prospectosRes.error) return { success: false, error: prospectosRes.error.message }

    const etapas = (etapasRes.data ?? []) as Etapa[]
    const prospectos = prospectosRes.data ?? []

    const porEtapa = etapas.map((e) => {
      const suyos = prospectos.filter((p: any) => p.etapa_id === e.id)
      const valor = suyos.reduce((s: number, p: any) => s + Number(p.valor_estimado || 0), 0)
      // La probabilidad del prospecto manda sobre la de su etapa: el vendedor
      // puede saber algo que el embudo no.
      const ponderado = suyos.reduce((s: number, p: any) => {
        const prob = p.probabilidad_manual ?? e.probabilidad
        return s + Number(p.valor_estimado || 0) * (Number(prob) / 100)
      }, 0)

      return {
        etapa: e,
        cantidad: suyos.length,
        valor: Math.round(valor),
        valorPonderado: Math.round(ponderado),
      }
    })

    // Ganadas y perdidas no son "pipeline": ya no se van a cerrar.
    const abiertas = porEtapa.filter((x) => !x.etapa.es_ganada && !x.etapa.es_perdida)

    return {
      success: true,
      data: {
        porEtapa,
        totalProspectos: prospectos.length,
        valorTotal: abiertas.reduce((s, x) => s + x.valor, 0),
        valorPonderado: abiertas.reduce((s, x) => s + x.valorPonderado, 0),
      },
    }
  } catch (err) {
    return fallo(err)
  }
}

/** Prospectos con contacto pendiente: alimenta el tablero y la alerta. */
export async function getProximosContactos(
  empresaId = 1,
  dias = 7,
  vendedorId?: number,
): Promise<ActionResult<ProspectoConEtapa[]>> {
  try {
    // Alimenta el tablero de todos: basta con sesion, pero cada vendedor ve
    // solo sus contactos.
    const ctx = await exigirSesion()
    const supabase = await getSupabaseAdmin()
    const hoy = hoyISO()
    const hasta = new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10)

    let q = supabase
      .from("crm_prospectos")
      .select("*, etapa:crm_etapas(id, nombre, color)")
      .eq("idempresa", empresaId)
      .eq("activo", true)
      .not("proxima_fecha", "is", null)
      .lte("proxima_fecha", hasta)

    if (vendedorId) q = q.eq("vendedor_id", vendedorId)
    q = filtrarPorVendedor(q, ctx, "vendedor_id") as typeof q

    const { data, error } = await q.order("proxima_fecha")
    if (error) return { success: false, error: error.message }

    // Incluye los vencidos (fecha anterior a hoy): son los que mas urgen.
    return { success: true, data: (data ?? []) as ProspectoConEtapa[] }
  } catch (err) {
    return fallo(err)
  }
}
