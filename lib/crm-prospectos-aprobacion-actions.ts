"use server"

// De prospecto a cliente: expediente, envio a Cartera y aprobacion (PRO-01..05).
//
// QUIEN HACE QUE
//   - El vendedor (crm_prospectos) arma el expediente de SUS prospectos,
//     comparte el enlace de carga y lo envia a Cartera.
//   - Cartera (crm_prospectos_aprobar) revisa los documentos, aprueba fijando
//     cupo, plazo, lista y vendedor, o rechaza con motivo. Quien envio el
//     prospecto no puede aprobarlo, igual que en pedidos y recaudos.
//   - Al aprobar, crm_convertir_prospecto (script 206) crea el cliente y su
//     sucursal en LIPgo en una sola transaccion.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import {
  asegurarClienteVisible, exigirPermiso, mensajeError, tienePermiso, type ContextoCrm,
} from "@/lib/crm-auth"
import { leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { registrarEvento } from "@/lib/crm-eventos"
import { encolarAviso, encolarSap } from "@/lib/integraciones/outbox"
import { guardarDocumento, urlFirmada, validarArchivo } from "@/lib/crm-documentos-server"
import {
  COLUMNAS_EXPEDIENTE, MAX_DOCUMENTOS_PROSPECTO, contarDocumentos, documentosDe, evaluar, leerProspecto, nuevoToken,
  tiposDocumentoProspecto, type ProspectoExpediente,
} from "@/lib/crm-expediente-server"
import {
  nitSinDv, puedeEditarExpediente, type DocumentoExpediente, type EstadoAprobacionProspecto, type EvaluacionExpediente,
} from "@/lib/crm-prospectos-aprobacion"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

const fallo = (err: unknown): ActionResult<never> => ({ success: false, error: mensajeError(err) })

const VER = ["crm_prospectos", "crm_embudo", "crm_prospectos_aprobar"] as const
const EDITAR = ["crm_prospectos", "crm_embudo"] as const
const APROBAR = "crm_prospectos_aprobar"

/** El prospecto, si este usuario puede verlo. Un vendedor solo ve los suyos. */
async function prospectoVisible(ctx: ContextoCrm, id: number, empresaId: number) {
  const p = await leerProspecto(id, empresaId)
  if (!p) return null
  if (ctx.alcance === "propios" && !tienePermiso(ctx, APROBAR) && p.vendedor_id !== ctx.vendedorId) return null
  return p
}

// ================================================================ EXPEDIENTE

export interface Expediente {
  prospecto: Omit<ProspectoExpediente, "enlace_hash" | "solicitado_por">
  evaluacion: EvaluacionExpediente
  enlaceActivo: boolean
  /** Clientes de LIPgo con el mismo NIT: se avisa antes de enviar y al aprobar. */
  clientesMismoNit: { id: number; nombre: string }[]
  puedeEditar: boolean
  puedeAprobar: boolean
  /** true si quien mira fue quien lo envio: no puede aprobarlo. */
  esSolicitante: boolean
}

async function clientesConNit(empresaId: number, documento: string | null) {
  const nit = nitSinDv(documento)
  if (!nit) return []
  const db = await getSupabaseAdmin()
  const { data } = await db.from("clientes").select("id, nombre").eq("id_empresa", empresaId).eq("documento", nit).limit(10)
  return (data ?? []) as { id: number; nombre: string }[]
}

export async function getExpediente(prospectoId: number, empresaId = 1): Promise<ActionResult<Expediente>> {
  try {
    const ctx = await exigirPermiso("getExpediente", ...VER)
    const p = await prospectoVisible(ctx, prospectoId, empresaId)
    if (!p) return { success: false, error: "No encontrado" }
    const [evaluacion, dups] = await Promise.all([evaluar(p), clientesConNit(empresaId, p.documento)])
    const { enlace_hash, solicitado_por, ...visible } = p
    return {
      success: true,
      data: {
        prospecto: visible,
        evaluacion,
        enlaceActivo: !!enlace_hash && !!p.enlace_vence && Date.parse(p.enlace_vence) > Date.now(),
        clientesMismoNit: p.cliente_id ? [] : dups,
        puedeEditar: puedeEditarExpediente(p.estado_aprobacion) && tienePermiso(ctx, ...EDITAR),
        puedeAprobar: tienePermiso(ctx, APROBAR),
        esSolicitante: !!solicitado_por && solicitado_por === ctx.userId,
      },
    }
  } catch (err) {
    return fallo(err)
  }
}

export async function subirDocumentoProspecto(fd: FormData, empresaId = 1): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await exigirPermiso("subirDocumentoProspecto", ...EDITAR)
    const prospectoId = Number(fd.get("prospecto_id"))
    const tipoCodigo = String(fd.get("tipo_codigo") ?? "")
    const archivo = fd.get("archivo")
    const p = await prospectoVisible(ctx, prospectoId, empresaId)
    if (!p) return { success: false, error: "No encontrado" }
    if (!puedeEditarExpediente(p.estado_aprobacion)) return { success: false, error: "El prospecto ya está en revisión o aprobado" }
    if (!(archivo instanceof File)) return { success: false, error: "Adjunta el archivo" }
    const invalido = validarArchivo(archivo.type, archivo.size)
    if (invalido) return { success: false, error: invalido }
    if (!(await tiposDocumentoProspecto(empresaId)).some((t) => t.codigo === tipoCodigo)) {
      return { success: false, error: "Tipo de documento no válido" }
    }
    if ((await contarDocumentos(empresaId, prospectoId)) >= MAX_DOCUMENTOS_PROSPECTO) {
      return { success: false, error: "El expediente ya tiene demasiados archivos. Borra los que sobren." }
    }
    const r = await guardarDocumento({
      empresaId, entidad: "prospecto", entidadId: prospectoId, tipoCodigo,
      bytes: new Uint8Array(await archivo.arrayBuffer()), mime: archivo.type, nombre: archivo.name, ctx,
    })
    if (!r.ok) return { success: false, error: r.error }
    await registrarEvento({
      empresaId, entidad: "prospecto", entidadId: prospectoId, tipo: "documento_subido",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, datos: { documento_id: r.id, tipo: tipoCodigo },
    })
    return { success: true, data: { id: r.id } }
  } catch (err) {
    return fallo(err)
  }
}

/** Borra un archivo del expediente mientras se prepara. Uno ya revisado no. */
export async function eliminarDocumentoProspecto(documentoId: number, empresaId = 1): Promise<ActionResult> {
  try {
    const ctx = await exigirPermiso("eliminarDocumentoProspecto", ...EDITAR)
    const db = await getSupabaseAdmin()
    const { data: doc } = await db.from("crm_documentos").select("id, entidad, entidad_id, bucket, storage_path, estado")
      .eq("id", documentoId).eq("idempresa", empresaId).maybeSingle()
    if (!doc || doc.entidad !== "prospecto") return { success: false, error: "No encontrado" }
    const p = await prospectoVisible(ctx, doc.entidad_id as number, empresaId)
    if (!p) return { success: false, error: "No encontrado" }
    if (!puedeEditarExpediente(p.estado_aprobacion)) return { success: false, error: "El prospecto ya está en revisión o aprobado" }
    if (doc.estado === "aprobado") return { success: false, error: "Cartera ya aprobó ese documento" }
    const { error } = await db.from("crm_documentos").delete().eq("id", documentoId)
    if (error) return { success: false, error: error.message }
    await db.storage.from(doc.bucket as string).remove([doc.storage_path as string])
    await registrarEvento({
      empresaId, entidad: "prospecto", entidadId: p.id, tipo: "documento_eliminado",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, datos: { documento_id: documentoId },
    })
    return { success: true }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * URL temporal de un documento de prospecto o de cliente. Se valida que
 * quien la pide pueda ver ese prospecto o ese cliente. Los comprobantes de
 * recaudo tienen su propia accion (getUrlComprobante).
 */
export async function getUrlDocumento(documentoId: number, empresaId = 1): Promise<ActionResult<{ url: string; mime: string; nombre: string | null }>> {
  try {
    const ctx = await exigirPermiso("getUrlDocumento", ...VER, "crm_clientes", "crm_cartera", "crm_recaudos_aprobar")
    const db = await getSupabaseAdmin()
    const { data: doc } = await db.from("crm_documentos").select("entidad, entidad_id").eq("id", documentoId).eq("idempresa", empresaId).maybeSingle()
    if (!doc) return { success: false, error: "No encontrado" }
    if (doc.entidad === "prospecto") {
      if (!(await prospectoVisible(ctx, doc.entidad_id as number, empresaId))) return { success: false, error: "No encontrado" }
    } else if (doc.entidad === "cliente") {
      await asegurarClienteVisible(ctx, doc.entidad_id as number)
    } else {
      return { success: false, error: "No encontrado" }
    }
    const u = await urlFirmada(documentoId, empresaId)
    return u ? { success: true, data: u } : { success: false, error: "No se pudo abrir el documento" }
  } catch (err) {
    return fallo(err)
  }
}

// ============================================================ ENLACE PUBLICO

/**
 * Enlace para que el propio prospecto suba sus documentos (PRO-05). Crear uno
 * nuevo invalida el anterior. Caduca en `prospecto.enlace_dias`.
 */
export async function crearEnlaceCarga(prospectoId: number, empresaId = 1): Promise<ActionResult<{ token: string; vence: string; celular: string | null }>> {
  try {
    const ctx = await exigirPermiso("crearEnlaceCarga", ...EDITAR)
    const p = await prospectoVisible(ctx, prospectoId, empresaId)
    if (!p) return { success: false, error: "No encontrado" }
    if (!puedeEditarExpediente(p.estado_aprobacion)) return { success: false, error: "El prospecto ya está en revisión o aprobado" }
    const dias = Math.max(1, await leerParamNumber(PARAM.PROSPECTO_ENLACE_DIAS, empresaId, 7))
    const vence = new Date(Date.now() + dias * 86_400_000).toISOString()
    const { token, hash } = nuevoToken()
    const db = await getSupabaseAdmin()
    const { error } = await db.from("crm_prospectos").update({ enlace_hash: hash, enlace_vence: vence, enlace_creado_nombre: ctx.nombre }).eq("id", prospectoId)
    if (error) return { success: false, error: error.message }
    await registrarEvento({
      empresaId, entidad: "prospecto", entidadId: prospectoId, tipo: "enlace_creado",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, datos: { vence },
    })
    const celular = String(p.contacto_celular ?? "").replace(/\D/g, "")
    // El token se devuelve UNA vez: en la base solo queda su hash.
    return { success: true, data: { token, vence, celular: celular.length === 10 ? `57${celular}` : celular.length === 12 ? celular : null } }
  } catch (err) {
    return fallo(err)
  }
}

export async function revocarEnlaceCarga(prospectoId: number, empresaId = 1): Promise<ActionResult> {
  try {
    const ctx = await exigirPermiso("revocarEnlaceCarga", ...EDITAR)
    const p = await prospectoVisible(ctx, prospectoId, empresaId)
    if (!p) return { success: false, error: "No encontrado" }
    const db = await getSupabaseAdmin()
    await db.from("crm_prospectos").update({ enlace_hash: null, enlace_vence: null }).eq("id", prospectoId)
    await registrarEvento({ empresaId, entidad: "prospecto", entidadId: prospectoId, tipo: "enlace_revocado", usuarioId: ctx.userId, usuarioNombre: ctx.nombre })
    return { success: true }
  } catch (err) {
    return fallo(err)
  }
}

// ========================================================= ENVIO A CARTERA

export async function solicitarAprobacionProspecto(
  prospectoId: number,
  solicitud: { cupo: number; dias: number; nota?: string | null },
  empresaId = 1,
): Promise<ActionResult> {
  try {
    const ctx = await exigirPermiso("solicitarAprobacionProspecto", ...EDITAR)
    const p = await prospectoVisible(ctx, prospectoId, empresaId)
    if (!p) return { success: false, error: "No encontrado" }
    if (!puedeEditarExpediente(p.estado_aprobacion)) return { success: false, error: "El prospecto ya está en revisión o aprobado" }
    const cupo = Math.max(0, Math.round(Number(solicitud.cupo) || 0))
    const dias = Math.max(0, Math.round(Number(solicitud.dias) || 0))
    const ev = await evaluar(p)
    if (!ev.listo) {
      return { success: false, error: `Falta: ${[...ev.datosFaltantes, ...ev.documentosFaltantes].join(", ")}` }
    }
    const db = await getSupabaseAdmin()
    const desde = p.estado_aprobacion
    const { data } = await db.from("crm_prospectos").update({
      estado_aprobacion: "pendiente_aprobacion", cupo_solicitado: cupo, dias_credito_solicitado: dias,
      solicitado_por: ctx.userId, solicitado_nombre: ctx.nombre, solicitado_en: new Date().toISOString(),
      solicitud_nota: solicitud.nota?.trim() || null, version: desde === "rechazado" ? (p.version ?? 1) + 1 : p.version,
      rechazado_por: null, rechazado_nombre: null, rechazado_en: null, motivo_rechazo_id: null, motivo_rechazo: null,
      // Enviado a Cartera, el expediente ya no se toca: el enlace se cierra.
      enlace_hash: null, enlace_vence: null,
    }).eq("id", prospectoId).eq("estado_aprobacion", desde).select("id")
    if (!data?.length) return { success: false, error: "El prospecto cambió de estado. Recarga la pantalla." }

    await registrarEvento({
      empresaId, entidad: "prospecto", entidadId: prospectoId, tipo: desde === "rechazado" ? "reenviado" : "enviado_a_cartera",
      estadoDesde: desde, estadoHasta: "pendiente_aprobacion", usuarioId: ctx.userId, usuarioNombre: ctx.nombre,
      nota: solicitud.nota?.trim() || null, datos: { cupo, dias },
    })
    const { data: dest } = await db.from("crm_notificacion_destinatarios").select("nombre, celular")
      .eq("idempresa", empresaId).eq("evento", "prospecto_pendiente").eq("activo", true)
    for (const d of dest ?? []) {
      await encolarAviso({
        empresaId, evento: "prospecto_pendiente", entidad: "prospecto", entidadId: prospectoId, creadoPor: ctx.nombre,
        aviso: {
          celular: d.celular as string, titulo: `Prospecto por aprobar ${p.codigo ?? ""}`.trim(),
          destinatario: String(d.nombre).split(" ")[0],
          contenido: `${p.razon_social} · cupo solicitado $ ${cupo.toLocaleString("es-CO")} a ${dias} días · enviado por ${ctx.nombre}`,
        },
      })
    }
    return { success: true }
  } catch (err) {
    return fallo(err)
  }
}

// =================================================================== CARTERA

export interface FilaAprobacionProspecto {
  id: number
  codigo: string | null
  razon_social: string
  documento: string | null
  ciudad: string | null
  vendedor_nombre: string | null
  estado_aprobacion: EstadoAprobacionProspecto
  version: number
  cupo_solicitado: number | null
  dias_credito_solicitado: number | null
  solicitado_nombre: string | null
  solicitado_en: string | null
  aprobado_en: string | null
  rechazado_en: string | null
  motivo_rechazo: string | null
  cliente_id: number | null
  documentos: number
  nitRepetido: boolean
}

export async function buscarProspectosAprobacion(
  estado: EstadoAprobacionProspecto = "pendiente_aprobacion",
  empresaId = 1,
): Promise<ActionResult<FilaAprobacionProspecto[]>> {
  try {
    const ctx = await exigirPermiso("buscarProspectosAprobacion", APROBAR)
    if (!tienePermiso(ctx, APROBAR)) return { success: false, error: "No tienes permiso para aprobar prospectos" }
    const db = await getSupabaseAdmin()
    const { data, error } = await db.from("crm_prospectos").select(COLUMNAS_EXPEDIENTE)
      .eq("idempresa", empresaId).eq("estado_aprobacion", estado)
      .order(estado === "pendiente_aprobacion" ? "solicitado_en" : "actualizado_en", { ascending: estado === "pendiente_aprobacion" })
      .limit(200)
    if (error) return { success: false, error: error.message }
    const filas = (data ?? []) as unknown as ProspectoExpediente[]
    const idsVen = [...new Set(filas.map((p) => p.vendedor_id).filter((v): v is number => v != null))]
    const nits = [...new Set(filas.map((p) => nitSinDv(p.documento)).filter((n): n is number => n != null))]
    const [ven, docs, cli] = await Promise.all([
      idsVen.length ? db.from("vendedores").select("idvendedor, nombre").in("idvendedor", idsVen) : Promise.resolve({ data: [] }),
      filas.length
        ? db.from("crm_documentos").select("entidad_id").eq("idempresa", empresaId).eq("entidad", "prospecto").in("entidad_id", filas.map((p) => p.id))
        : Promise.resolve({ data: [] }),
      nits.length ? db.from("clientes").select("documento").eq("id_empresa", empresaId).in("documento", nits) : Promise.resolve({ data: [] }),
    ])
    const nVen = new Map(((ven.data ?? []) as { idvendedor: number; nombre: string }[]).map((v) => [v.idvendedor, v.nombre]))
    const nDocs = new Map<number, number>()
    for (const d of (docs.data ?? []) as { entidad_id: number }[]) nDocs.set(d.entidad_id, (nDocs.get(d.entidad_id) ?? 0) + 1)
    const nitsExistentes = new Set(((cli.data ?? []) as { documento: number }[]).map((c) => Number(c.documento)))
    return {
      success: true,
      data: filas.map((p) => ({
        id: p.id, codigo: p.codigo, razon_social: p.razon_social, documento: p.documento, ciudad: p.ciudad,
        vendedor_nombre: p.vendedor_id ? nVen.get(p.vendedor_id) ?? null : null,
        estado_aprobacion: p.estado_aprobacion, version: p.version, cupo_solicitado: p.cupo_solicitado,
        dias_credito_solicitado: p.dias_credito_solicitado, solicitado_nombre: p.solicitado_nombre, solicitado_en: p.solicitado_en,
        aprobado_en: p.aprobado_en, rechazado_en: p.rechazado_en, motivo_rechazo: p.motivo_rechazo, cliente_id: p.cliente_id,
        documentos: nDocs.get(p.id) ?? 0,
        nitRepetido: !p.cliente_id && nitsExistentes.has(nitSinDv(p.documento) ?? -1),
      })),
    }
  } catch (err) {
    return fallo(err)
  }
}

/** Cartera marca un documento como valido o no (el rechazo pide otro archivo). */
export async function revisarDocumento(
  documentoId: number, estado: "aprobado" | "rechazado" | "pendiente", nota: string | null, empresaId = 1,
): Promise<ActionResult> {
  try {
    const ctx = await exigirPermiso("revisarDocumento", APROBAR)
    if (!tienePermiso(ctx, APROBAR)) return { success: false, error: "No tienes permiso para revisar documentos" }
    if (estado === "rechazado" && !nota?.trim()) return { success: false, error: "Indica qué tiene mal el documento" }
    const db = await getSupabaseAdmin()
    const { data, error } = await db.from("crm_documentos").update({
      estado, nota: nota?.trim() || null, revisado_por: ctx.userId, revisado_nombre: ctx.nombre, revisado_en: new Date().toISOString(),
    }).eq("id", documentoId).eq("idempresa", empresaId).in("entidad", ["prospecto", "cliente"]).select("entidad, entidad_id")
    if (error) return { success: false, error: error.message }
    if (!data?.length) return { success: false, error: "No encontrado" }
    await registrarEvento({
      empresaId, entidad: data[0].entidad as "prospecto" | "cliente", entidadId: data[0].entidad_id as number,
      tipo: `documento_${estado}`, usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: nota?.trim() || null,
      datos: { documento_id: documentoId },
    })
    return { success: true }
  } catch (err) {
    return fallo(err)
  }
}

export interface DecisionAprobacion {
  cupo: number
  dias: number
  listaPrecioId: number | null
  vendedorId: number | null
  /** Si el NIT ya existe en LIPgo: vincular a ese cliente en vez de crear otro. */
  vincularClienteId?: number | null
  nota?: string | null
}

export async function aprobarProspecto(
  prospectoId: number, d: DecisionAprobacion, empresaId = 1,
): Promise<ActionResult<{ clienteId: number; sucursalId: number | null; creado: boolean }> & { clientesMismoNit?: { id: number; nombre: string }[] }> {
  try {
    const ctx = await exigirPermiso("aprobarProspecto", APROBAR)
    // Crea un cliente en LIPgo: se exige el permiso aunque la seguridad este en modo registro.
    if (!tienePermiso(ctx, APROBAR)) return { success: false, error: "No tienes permiso para aprobar prospectos" }
    const db = await getSupabaseAdmin()
    const { data: sol } = await db.from("crm_prospectos").select("solicitado_por, codigo, razon_social").eq("id", prospectoId).eq("idempresa", empresaId).maybeSingle()
    if (!sol) return { success: false, error: "El prospecto no existe" }
    if (sol.solicitado_por === ctx.userId) return { success: false, error: "No puedes aprobar un prospecto que tú enviaste" }

    const { data, error } = await db.rpc("crm_convertir_prospecto", {
      p_prospecto_id: prospectoId, p_usuario_id: ctx.userId, p_usuario_nombre: ctx.nombre,
      p_cupo: Math.max(0, Math.round(Number(d.cupo) || 0)), p_dias: Math.max(0, Math.round(Number(d.dias) || 0)),
      p_lista_precio_id: d.listaPrecioId ?? null, p_vendedor_id: d.vendedorId ?? null,
      p_vincular_cliente_id: d.vincularClienteId ?? null, p_nota: d.nota?.trim() || null,
    })
    if (error) return { success: false, error: error.message }
    const r = data as { ok: boolean; error?: string; clientes?: { id: number; nombre: string }[]; cliente_id?: number; sucursal_id?: number | null; creado?: boolean }
    if (!r?.ok) {
      if (r?.error === "nit_existe") {
        return { success: false, error: "Ese NIT ya existe en LIPgo. Elige el cliente al que se vincula.", clientesMismoNit: r.clientes ?? [] }
      }
      return { success: false, error: r?.error ?? "No se pudo aprobar" }
    }

    // SAP (PRO-04): solo si algun owner factura por SAP y el flujo esta
    // encendido. Con SAP apagado, el cliente ya quedo en LIPgo.
    const { data: owners } = await db.from("crm_owners").select("envia_sap").eq("idempresa", empresaId).eq("activo", true)
    const enviaSap = (owners ?? []).some((o) => o.envia_sap === true)
    const p = await leerProspecto(prospectoId, empresaId)
    const e = await encolarSap({
      empresaId, flujo: "clientes", entidad: "prospecto", entidadId: prospectoId, operacion: "crear_cliente",
      version: p?.version ?? 1, ownerEnviaSap: enviaSap, creadoPor: ctx.nombre,
      payload: {
        cliente: {
          id_lipgo: r.cliente_id, nit: nitSinDv(p?.documento ?? null), nombre: p?.razon_social, direccion: p?.direccion,
          ciudad: p?.ciudad, departamento: p?.departamento, contacto: p?.contacto_nombre, celular: p?.contacto_celular,
          correo: p?.contacto_email, cupo: d.cupo, dias_credito: d.dias,
        },
      },
    })
    if ("id" in e && e.ok && e.id) await db.from("crm_prospectos").update({ sap_estado: "pendiente" }).eq("id", prospectoId)

    await registrarEvento({
      empresaId, entidad: "prospecto", entidadId: prospectoId, tipo: "aprobado", estadoDesde: "pendiente_aprobacion", estadoHasta: "aprobado",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: d.nota?.trim() || null,
      datos: { cliente_id: r.cliente_id, sucursal_id: r.sucursal_id, creado: r.creado, cupo: d.cupo, dias: d.dias, vinculado: !!d.vincularClienteId },
    })
    await registrarEvento({
      empresaId, entidad: "cliente", entidadId: r.cliente_id!, tipo: r.creado ? "creado_desde_prospecto" : "vinculado_a_prospecto",
      usuarioId: ctx.userId, usuarioNombre: ctx.nombre, datos: { prospecto_id: prospectoId, codigo: sol.codigo },
    })
    return { success: true, data: { clienteId: r.cliente_id!, sucursalId: r.sucursal_id ?? null, creado: !!r.creado } }
  } catch (err) {
    return fallo(err)
  }
}

export async function rechazarProspecto(prospectoId: number, motivoId: number | null, nota: string, empresaId = 1): Promise<ActionResult> {
  try {
    const ctx = await exigirPermiso("rechazarProspecto", APROBAR)
    if (!tienePermiso(ctx, APROBAR)) return { success: false, error: "No tienes permiso para rechazar prospectos" }
    const db = await getSupabaseAdmin()
    let texto = nota?.trim() ?? ""
    if (motivoId) {
      const { data: m } = await db.from("crm_motivos").select("nombre, exige_nota, tipo").eq("id", motivoId).maybeSingle()
      if (!m || m.tipo !== "rechazo_prospecto") return { success: false, error: "Motivo no válido" }
      if (m.exige_nota && !texto) return { success: false, error: `"${m.nombre}" exige una explicación` }
      texto = texto ? `${m.nombre}: ${texto}` : m.nombre
    }
    if (!texto) return { success: false, error: "Indica el motivo del rechazo" }
    const { data } = await db.from("crm_prospectos").update({
      estado_aprobacion: "rechazado", rechazado_por: ctx.userId, rechazado_nombre: ctx.nombre,
      rechazado_en: new Date().toISOString(), motivo_rechazo_id: motivoId, motivo_rechazo: texto,
    }).eq("id", prospectoId).eq("idempresa", empresaId).eq("estado_aprobacion", "pendiente_aprobacion").select("id")
    if (!data?.length) return { success: false, error: "El prospecto cambió de estado. Recarga la pantalla." }
    await registrarEvento({
      empresaId, entidad: "prospecto", entidadId: prospectoId, tipo: "rechazado", estadoDesde: "pendiente_aprobacion",
      estadoHasta: "rechazado", usuarioId: ctx.userId, usuarioNombre: ctx.nombre, nota: texto, datos: { motivo_id: motivoId },
    })
    return { success: true }
  } catch (err) {
    return fallo(err)
  }
}

export interface EventoProspecto {
  id: number
  tipo: string
  estado_desde: string | null
  estado_hasta: string | null
  usuario_nombre: string | null
  nota: string | null
  creado_en: string
}

export async function getHistorialProspecto(prospectoId: number, empresaId = 1): Promise<ActionResult<EventoProspecto[]>> {
  try {
    const ctx = await exigirPermiso("getHistorialProspecto", ...VER)
    if (!(await prospectoVisible(ctx, prospectoId, empresaId))) return { success: false, error: "No encontrado" }
    const db = await getSupabaseAdmin()
    const { data, error } = await db.from("crm_eventos")
      .select("id, tipo, estado_desde, estado_hasta, usuario_nombre, nota, creado_en")
      .eq("idempresa", empresaId).eq("entidad", "prospecto").eq("entidad_id", prospectoId).order("creado_en")
    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as EventoProspecto[] }
  } catch (err) {
    return fallo(err)
  }
}

// ======================================================= CARPETA DEL CLIENTE

export interface DocumentoCliente extends DocumentoExpediente {
  tipo_nombre: string | null
  prospecto_id: number | null
}

/** Carpeta de documentos del cliente (PRO-03): lo que traia como prospecto y lo que se suba despues. */
export async function getDocumentosCliente(clienteId: number, empresaId = 1): Promise<ActionResult<DocumentoCliente[]>> {
  try {
    const ctx = await exigirPermiso("getDocumentosCliente", "crm_clientes", "crm_cartera", "crm_recaudos_aprobar", "crm_prospectos_aprobar")
    await asegurarClienteVisible(ctx, clienteId)
    const db = await getSupabaseAdmin()
    const [docs, tipos, origen] = await Promise.all([
      documentosDe(empresaId, "cliente", clienteId),
      db.from("crm_tipos_documento").select("id, nombre").eq("idempresa", empresaId),
      db.from("crm_documentos").select("id, prospecto_id").eq("idempresa", empresaId).eq("entidad", "cliente").eq("entidad_id", clienteId),
    ])
    const nTipo = new Map((tipos.data ?? []).map((t) => [t.id as number, t.nombre as string]))
    const nPros = new Map((origen.data ?? []).map((o) => [o.id as number, (o.prospecto_id as number) ?? null]))
    return {
      success: true,
      data: docs.map((d) => ({
        ...d, tipo_nombre: d.tipo_documento_id ? nTipo.get(d.tipo_documento_id) ?? null : null, prospecto_id: nPros.get(d.id) ?? null,
      })).reverse(),
    }
  } catch (err) {
    return fallo(err)
  }
}

export async function subirDocumentoCliente(fd: FormData, empresaId = 1): Promise<ActionResult<{ id: number }>> {
  try {
    const ctx = await exigirPermiso("subirDocumentoCliente", "crm_clientes", "crm_cartera", "crm_recaudos_aprobar")
    const clienteId = Number(fd.get("cliente_id"))
    await asegurarClienteVisible(ctx, clienteId)
    const archivo = fd.get("archivo")
    if (!(archivo instanceof File)) return { success: false, error: "Adjunta el archivo" }
    const r = await guardarDocumento({
      empresaId, entidad: "cliente", entidadId: clienteId, tipoCodigo: String(fd.get("tipo_codigo") || "OTRO"),
      bytes: new Uint8Array(await archivo.arrayBuffer()), mime: archivo.type, nombre: archivo.name, ctx,
    })
    if (!r.ok) return { success: false, error: r.error }
    await registrarEvento({ empresaId, entidad: "cliente", entidadId: clienteId, tipo: "documento_subido", usuarioId: ctx.userId, usuarioNombre: ctx.nombre, datos: { documento_id: r.id } })
    return { success: true, data: { id: r.id } }
  } catch (err) {
    return fallo(err)
  }
}
