"use server"

// Lectura de los maestros compartidos con LIPgo.
//
// REGLA DE ORO DE ESTE ARCHIVO: sobre `clientes`, `productos`, `bodegas` y
// `vendedores` el CRM solo LEE y solo escribe las columnas comerciales que
// agrego el script 181 (cupo, lista de precios, GPS, fotos). Peso, gramaje,
// estiba, vida util y demas datos operativos son de LIPgo y no se tocan: los
// usa produccion e inventario.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { resolverOwner, type CrmOwner } from "@/lib/crm-owners"
import { leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { esActivo, type ClienteCrm, type ProductoCrm, type SucursalCrm, type VendedorCrm } from "@/lib/crm-catalogos"
import {
  exigirPermiso, exigirSesion, tienePermiso, filtrarPorVendedor, asegurarClienteVisible, mensajeError,
} from "@/lib/crm-auth"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

function fallo(err: unknown): ActionResult<never> {
  const msg = mensajeError(err)
  console.error("[crm-catalogos]", msg)
  return { success: false, error: msg }
}

// -------------------------------------------------------------- Clientes

export async function getClientesCrm(
  empresaId = 1,
  incluirInactivos = false,
): Promise<ActionResult<ClienteCrm[]>> {
  try {
    const ctx = await exigirSesion()
    const supabase = await getSupabaseAdmin()

    // `clientes` usa id_empresa, con guion bajo: es tabla heredada.
    // Un vendedor sin `crm_ver_todos_clientes` solo recibe sus clientes: el
    // filtro va en la consulta, no en la pantalla, para que no viajen al
    // navegador los datos de clientes ajenos.
    let q = supabase
      .from("clientes")
      .select("*")
      .eq("id_empresa", empresaId)
    q = filtrarPorVendedor(q, ctx, "vendedor_asignado")
    const { data, error } = await q.order("nombre")

    if (error) return { success: false, error: error.message }

    // El filtro de activo se hace en memoria porque la columna es TEXT: un
    // .eq("activo", true) fallaria contra las cadenas 'true'/'false'.
    let filas = (data ?? []).map(normalizarCliente)
    if (!incluirInactivos) filas = filas.filter((c) => c.activo)

    // Nombre de la lista de precios, en una sola consulta.
    const idsLista = [...new Set(filas.map((c) => c.lista_precio_id).filter(Boolean))] as number[]
    if (idsLista.length) {
      const { data: listas } = await supabase
        .from("crm_listas_precios")
        .select("id, nombre")
        .in("id", idsLista)

      const nombre = new Map((listas ?? []).map((l: any) => [l.id, l.nombre]))
      filas = filas.map((c) => ({
        ...c,
        lista_precio_nombre: c.lista_precio_id ? nombre.get(c.lista_precio_id) ?? null : null,
      }))
    }

    return { success: true, data: filas }
  } catch (err) {
    return fallo(err)
  }
}

export async function getClienteCrm(id: number, empresaId = 1): Promise<ActionResult<ClienteCrm>> {
  try {
    const ctx = await exigirSesion()
    // Adivinar el id de un cliente ajeno no debe bastar para ver su cupo y cartera.
    await asegurarClienteVisible(ctx, id)
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", id)
      .eq("id_empresa", empresaId)
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: "El cliente no existe" }

    const cliente = normalizarCliente(data)

    // Cartera pendiente: lo que ya debe, para saber cuánto cupo le queda.
    const { data: cartera } = await supabase
      .from("crm_cuentas_cobrar")
      .select("saldo")
      .eq("idempresa", empresaId)
      .eq("cliente_id", id)
      .in("estado", ["pendiente", "parcial"])

    cliente.cartera_pendiente = (cartera ?? []).reduce(
      (s: number, c: any) => s + (Number(c.saldo) || 0), 0,
    )

    return { success: true, data: cliente }
  } catch (err) {
    return fallo(err)
  }
}

/** Actualiza SOLO las columnas comerciales. Las operativas son de LIPgo. */
export async function actualizarDatosComercialesCliente(
  id: number,
  datos: Partial<Pick<ClienteCrm,
    "cupo_credito" | "dias_credito" | "lista_precio_id" | "latitud" | "longitud" |
    "bloqueado_cartera" | "vendedor_asignado" | "segmento">>,
  empresaId = 1,
): Promise<ActionResult<ClienteCrm>> {
  try {
    const ctx = await exigirPermiso("actualizarDatosComercialesCliente", "crm_clientes")

    // Cupo, plazo, bloqueo, lista de precios y vendedor son decisiones de
    // credito, no de venta (CTA-02: el cupo lo edita Cartera o Administracion).
    // Sin esta segunda validacion, un vendedor con `crm_clientes` podia subirle
    // el cupo a su propio cliente para destrabar un pedido.
    const tocaCredito = (
      ["cupo_credito", "dias_credito", "bloqueado_cartera", "lista_precio_id", "vendedor_asignado"] as const
    ).some((k) => datos[k] !== undefined)
    if (tocaCredito && !tienePermiso(ctx, "crm_recaudos_aprobar", "crm_maestros_admin")) {
      // exigirPermiso registra la denegacion y, en modo enforce, bloquea.
      await exigirPermiso("actualizarCreditoCliente", "crm_recaudos_aprobar", "crm_maestros_admin")
    }

    const supabase = await getSupabaseAdmin()

    // Lista blanca explícita: si el llamador manda "nombre" o "documento", no
    // pasa. Es lo que impide que el CRM pise el maestro de LIPgo por descuido.
    const permitido = {
      cupo_credito: datos.cupo_credito,
      dias_credito: datos.dias_credito,
      lista_precio_id: datos.lista_precio_id,
      latitud: datos.latitud,
      longitud: datos.longitud,
      bloqueado_cartera: datos.bloqueado_cartera,
      vendedor_asignado: datos.vendedor_asignado,
      segmento: datos.segmento,
    }
    const limpio = Object.fromEntries(Object.entries(permitido).filter(([, v]) => v !== undefined))

    if (!Object.keys(limpio).length) {
      return { success: false, error: "No hay nada que actualizar" }
    }

    const { data, error } = await supabase
      .from("clientes")
      .update(limpio)
      .eq("id", id)
      .eq("id_empresa", empresaId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: normalizarCliente(data) }
  } catch (err) {
    return fallo(err)
  }
}

// ------------------------------------------------------------- Productos

export async function getProductosCrm(
  empresaId = 1,
  incluirInactivos = false,
  /**
   * true = productos de TODOS los owners (INDUPAN en la empresa 1, Molinos en
   * la 3 y la 4), con owner, impuesto y existencias. false (por defecto) = solo
   * la empresa indicada, como hasta ahora: la venta sigue viendo lo mismo hasta
   * que la fase 2 aplique la regla de un owner por pedido.
   */
  todosLosOwners = false,
): Promise<ActionResult<ProductoCrm[]>> {
  try {
    await exigirSesion()
    const supabase = await getSupabaseAdmin()

    const { data: owners } = await supabase
      .from("crm_owners").select("id, alias_producto, idempresas_origen, activo").eq("idempresa", empresaId)
    const listaOwners = (owners ?? []) as Pick<CrmOwner, "id" | "alias_producto" | "idempresas_origen" | "activo">[]

    const empresas = todosLosOwners
      ? [...new Set([empresaId, ...listaOwners.filter((o) => o.activo).flatMap((o) => o.idempresas_origen)])]
      : [empresaId]

    const [prods, impuestos] = await Promise.all([
      supabase.from("productos").select("*").in("id_empresa", empresas).order("nombre"),
      supabase.from("crm_impuestos").select("id, tarifa, es_default").eq("idempresa", empresaId),
    ])
    if (prods.error) return { success: false, error: prods.error.message }

    const tarifas = new Map((impuestos.data ?? []).map((i) => [i.id as number, Number(i.tarifa)]))
    const porDefecto = (impuestos.data ?? []).find((i) => i.es_default)
    const tarifaDefecto = porDefecto ? Number(porDefecto.tarifa) : await leerParamNumber(PARAM.IVA, empresaId, 5)

    let filas = (prods.data ?? []).map((f) => {
      const p = normalizarProducto(f)
      p.id_empresa = f.id_empresa
      p.owner_id = resolverOwner({ owner: f.owner, id_empresa: f.id_empresa }, listaOwners)
      p.crm_impuesto_id = f.crm_impuesto_id ?? null
      p.impuesto_pct = f.crm_impuesto_id != null ? tarifas.get(f.crm_impuesto_id) ?? tarifaDefecto : tarifaDefecto
      return p
    })
    if (!incluirInactivos) filas = filas.filter((p) => p.activo)

    if (todosLosOwners && filas.length) {
      const { data: inv } = await supabase
        .from("crm_inventario_producto")
        .select("producto_id, stock_disponible, por_sede")
        .in("producto_id", filas.map((p) => p.id))
      const stock = new Map((inv ?? []).map((i) => [i.producto_id as number, i]))
      for (const p of filas) {
        const i = stock.get(p.id)
        p.stock_disponible = i ? Number(i.stock_disponible) : null
        p.stock_por_sede = Object.fromEntries(
          ((i?.por_sede as { idempresa: number; disponible: number }[] | null) ?? []).map((s) => [s.idempresa, Number(s.disponible)]),
        )
      }
    }

    return { success: true, data: filas }
  } catch (err) {
    return fallo(err)
  }
}

/** Actualiza SOLO lo comercial del producto: fotos, descripción, precio base.
 *  Peso, gramaje, estiba y vida útil los administra LIPgo. */
export async function actualizarDatosComercialesProducto(
  id: number,
  datos: Partial<Pick<ProductoCrm, "foto_url" | "fotos" | "descripcion_comercial" | "precio_base" | "crm_impuesto_id">>,
  empresaId = 1,
): Promise<ActionResult<ProductoCrm>> {
  try {
    await exigirPermiso("actualizarDatosComercialesProducto", "crm_productos", "crm_maestros_admin")
    const supabase = await getSupabaseAdmin()

    const permitido = {
      foto_url: datos.foto_url,
      fotos: datos.fotos,
      descripcion_comercial: datos.descripcion_comercial,
      precio_base: datos.precio_base,
      crm_impuesto_id: datos.crm_impuesto_id,
    }
    const limpio = Object.fromEntries(Object.entries(permitido).filter(([, v]) => v !== undefined))

    if (!Object.keys(limpio).length) {
      return { success: false, error: "No hay nada que actualizar" }
    }

    // El producto puede ser de otra empresa de LIPgo (Molinos esta en la 3 y
    // la 4): se acepta si es de la empresa o de una empresa de algun owner.
    const { data: owners } = await supabase
      .from("crm_owners").select("idempresas_origen").eq("idempresa", empresaId).eq("activo", true)
    const empresas = [...new Set([empresaId, ...(owners ?? []).flatMap((o) => o.idempresas_origen as number[])])]

    const { data, error } = await supabase
      .from("productos")
      .update(limpio)
      .eq("id", id)
      .in("id_empresa", empresas)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: normalizarProducto(data) }
  } catch (err) {
    return fallo(err)
  }
}

/** Precio final de un producto para una lista. Llama a la función de la base
 *  para que el precio sea el mismo lo consulte quien lo consulte. */
export async function resolverPrecio(
  productoId: number,
  listaId: number | null,
  empresaId = 1,
): Promise<ActionResult<number>> {
  try {
    // Solo sesion: el precio lo consulta cualquiera que arme un pedido o una cotizacion.
    await exigirSesion()
    const supabase = await getSupabaseAdmin()
    const { data, error } = await supabase.rpc("crm_resolver_precio", {
      p_idempresa: empresaId,
      p_producto_id: productoId,
      p_lista_id: listaId,
    })

    if (error) return { success: false, error: error.message }
    return { success: true, data: Number(data) || 0 }
  } catch (err) {
    return fallo(err)
  }
}

// ------------------------------------------------------------ Sucursales

export async function getSucursalesCrm(
  empresaId = 1,
  clienteId?: number,
): Promise<ActionResult<SucursalCrm[]>> {
  try {
    const ctx = await exigirSesion()
    if (clienteId) await asegurarClienteVisible(ctx, clienteId)
    const supabase = await getSupabaseAdmin()

    // `bodegas` usa idempresa SIN guion bajo, al revés que clientes.
    let q = supabase.from("bodegas").select("*").eq("idempresa", empresaId)
    if (clienteId) q = q.eq("clienteid", clienteId)

    const { data, error } = await q.order("nombrebodega")
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      data: (data ?? []).map((b: any) => ({
        idbodega: b.idbodega,
        nombrebodega: b.nombrebodega ?? "",
        clienteid: b.clienteid ?? null,
        cliente: b.cliente ?? null,
        direccion: b.direccion ?? null,
        ciudad: b.ciudad ?? null,
        departamento: b.departamento ?? null,
        latitud: b.latitud != null ? Number(b.latitud) : null,
        longitud: b.longitud != null ? Number(b.longitud) : null,
        activo: esActivo(b.activo),
      })),
    }
  } catch (err) {
    return fallo(err)
  }
}

// ------------------------------------------------------------ Vendedores

export async function getVendedoresCrm(empresaId = 1): Promise<ActionResult<VendedorCrm[]>> {
  try {
    await exigirSesion()
    const supabase = await getSupabaseAdmin()

    const [vendRes, detRes] = await Promise.all([
      supabase.from("vendedores").select("*").eq("id_empresa", empresaId).order("nombre"),
      supabase.from("crm_vendedores_detalle").select("*").eq("idempresa", empresaId),
    ])

    if (vendRes.error) return { success: false, error: vendRes.error.message }

    const detalle = new Map((detRes.data ?? []).map((d: any) => [d.vendedor_id, d]))

    return {
      success: true,
      data: (vendRes.data ?? [])
        .map((v: any) => {
          const d = detalle.get(v.idvendedor)
          return {
            idvendedor: v.idvendedor,
            nombre: v.nombre ?? "",
            cedula: v.cedula ?? null,
            celular: v.celular ?? null,
            correo: v.correo ?? null,
            activo: esActivo(v.activo),
            zona: d?.zona ?? null,
            ciudad_base: d?.ciudad_base ?? null,
            meta_mensual: Number(d?.meta_mensual) || 0,
            comision_propia: d?.comision_propia != null ? Number(d.comision_propia) : null,
            usuario_id: d?.usuario_id ?? null,
            foto_url: d?.foto_url ?? null,
          }
        })
        .filter((v) => v.activo),
    }
  } catch (err) {
    return fallo(err)
  }
}

// ------------------------------------------------------- Normalizadores

function normalizarCliente(fila: any): ClienteCrm {
  return {
    id: fila.id,
    nombre: fila.nombre ?? "",
    documento: fila.documento != null ? String(fila.documento) : null,
    correo: fila.correo ?? null,
    correofact: fila.correofact ?? null,
    personacontacto: fila.personacontacto ?? null,
    celular: fila.celular ?? null,
    tipo_cliente: fila.tipo_cliente ?? null,
    activo: esActivo(fila.activo),
    cupo_credito: Number(fila.cupo_credito) || 0,
    dias_credito: Number(fila.dias_credito) || 0,
    lista_precio_id: fila.lista_precio_id ?? null,
    latitud: fila.latitud != null ? Number(fila.latitud) : null,
    longitud: fila.longitud != null ? Number(fila.longitud) : null,
    bloqueado_cartera: Boolean(fila.bloqueado_cartera),
    vendedor_asignado: fila.vendedor_asignado ?? null,
    segmento: fila.segmento ?? null,
  }
}

function normalizarProducto(fila: any): ProductoCrm {
  return {
    id: fila.id,
    nombre: fila.nombre ?? "",
    codigo: fila.codigo ?? null,
    categoria: fila.categoria ?? null,
    subcategoria: fila.subcategoria ?? null,
    peso_unitkg: fila.peso_unitkg != null ? Number(fila.peso_unitkg) : null,
    unidad: fila.und != null ? String(fila.und) : null,
    activo: esActivo(fila.activo),
    foto_url: fila.foto_url ?? null,
    // `fotos` es jsonb: puede llegar como array o como texto sin parsear.
    fotos: Array.isArray(fila.fotos) ? fila.fotos : [],
    descripcion_comercial: fila.descripcion_comercial ?? null,
    precio_base: fila.precio_base != null ? Number(fila.precio_base) : null,
  }
}
