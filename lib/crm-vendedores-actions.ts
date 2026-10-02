"use server"

// Datos comerciales del vendedor.
//
// Viven en crm_vendedores_detalle, 1:1 con la tabla `vendedores` del sistema
// operativo. Se separa a proposito: `vendedores` la usa LIPgo (el pedido
// guarda el nombre del vendedor) y agregarle columnas seria modificar una
// tabla que otro sistema lee.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { esActivo } from "@/lib/crm-catalogos"
import { exigirPermiso, mensajeError } from "@/lib/crm-auth"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface VendedorDetalle {
  vendedor_id: number
  idempresa: number
  /** crm_usuarios.id. Si esta, el vendedor entra al CRM y ve solo lo suyo. */
  usuario_id: string | null
  zona: string | null
  ciudad_base: string | null
  meta_mensual: number
  /** Tasa individual. Si es null se aplica la regla de comision general. */
  comision_propia: number | null
  fecha_ingreso: string | null
  fecha_retiro: string | null
  telefono: string | null
  email: string | null
  foto_url: string | null
  latitud: number | null
  longitud: number | null
  observaciones: string | null
  activo: boolean
}

/** Vendedor con su detalle y su desempeño del mes. */
export interface VendedorCompleto extends VendedorDetalle {
  nombre: string
  cedula: string | null
  celular: string | null
  correo: string | null
  usuario_nombre?: string | null

  // Del período en curso
  ventas_mes?: number
  pedidos_mes?: number
  prospectos_activos?: number
  cartera_asignada?: number
  cumplimiento?: number
}

function fallo(err: unknown): ActionResult<never> {
  const msg = mensajeError(err)
  console.error("[crm-vendedores]", msg)
  return { success: false, error: msg }
}

export async function getVendedoresCompletos(
  empresaId = 1,
  conDesempeno = true,
): Promise<ActionResult<VendedorCompleto[]>> {
  try {
    const ctx = await exigirPermiso("getVendedoresCompletos", "crm_vendedores", "crm_dashboard")
    const supabase = await getSupabaseAdmin()

    const [vendRes, detRes] = await Promise.all([
      supabase.from("vendedores").select("*").eq("id_empresa", empresaId).order("nombre"),
      supabase.from("crm_vendedores_detalle").select("*").eq("idempresa", empresaId),
    ])

    if (vendRes.error) return { success: false, error: vendRes.error.message }

    const detalle = new Map((detRes.data ?? []).map((d: any) => [d.vendedor_id, d]))

    let vendedores: VendedorCompleto[] = (vendRes.data ?? [])
      .filter((v: any) => esActivo(v.activo))
      .map((v: any) => {
        const d = detalle.get(v.idvendedor)
        return {
          vendedor_id: v.idvendedor,
          idempresa: empresaId,
          nombre: v.nombre ?? "",
          cedula: v.cedula ?? null,
          celular: v.celular ?? null,
          correo: v.correo ?? null,
          usuario_id: d?.usuario_id ?? null,
          zona: d?.zona ?? null,
          ciudad_base: d?.ciudad_base ?? null,
          meta_mensual: Number(d?.meta_mensual) || 0,
          comision_propia: d?.comision_propia != null ? Number(d.comision_propia) : null,
          fecha_ingreso: d?.fecha_ingreso ?? null,
          fecha_retiro: d?.fecha_retiro ?? null,
          telefono: d?.telefono ?? v.celular ?? null,
          email: d?.email ?? v.correo ?? null,
          foto_url: d?.foto_url ?? null,
          latitud: d?.latitud != null ? Number(d.latitud) : null,
          longitud: d?.longitud != null ? Number(d.longitud) : null,
          observaciones: d?.observaciones ?? null,
          activo: d?.activo ?? true,
        }
      })

    // Un vendedor con alcance `propios` ve solo su fila: la meta, la comision
    // y la cartera de sus compañeros no son asunto suyo. Se filtra ANTES de
    // calcular el desempeño para no consultar lo que se va a descartar.
    if (ctx.alcance === "propios") {
      vendedores = vendedores.filter((v) => v.vendedor_id === ctx.vendedorId)
    }

    if (conDesempeno && vendedores.length) {
      vendedores = await agregarDesempeno(vendedores, empresaId)
    }

    return { success: true, data: vendedores }
  } catch (err) {
    return fallo(err)
  }
}

/**
 * Ventas, prospectos y cartera del mes en curso.
 *
 * Se consulta TODO de una vez y se reparte en memoria. Una consulta por
 * vendedor serían N+1 llamadas para una pantalla que carga entera.
 */
async function agregarDesempeno(
  vendedores: VendedorCompleto[],
  empresaId: number,
): Promise<VendedorCompleto[]> {
  const supabase = await getSupabaseAdmin()
  const inicioMes = new Date().toISOString().slice(0, 8) + "01"

  const [pedidosRes, prospectosRes, carteraRes] = await Promise.all([
    supabase
      .from("crm_pedidos")
      .select("vendedor_id, total")
      .eq("idempresa", empresaId)
      .gte("fecha", inicioMes)
      .not("estado", "in", "(rechazado,anulado,borrador)"),
    supabase
      .from("crm_prospectos")
      .select("vendedor_id")
      .eq("idempresa", empresaId)
      .eq("activo", true),
    supabase
      .from("crm_cuentas_cobrar")
      .select("vendedor_id, saldo")
      .eq("idempresa", empresaId)
      .in("estado", ["pendiente", "parcial"]),
  ])

  const ventas = new Map<number, { total: number; n: number }>()
  for (const p of pedidosRes.data ?? []) {
    if (!p.vendedor_id) continue
    const g = ventas.get(p.vendedor_id) ?? { total: 0, n: 0 }
    g.total += Number(p.total) || 0
    g.n += 1
    ventas.set(p.vendedor_id, g)
  }

  const prospectos = new Map<number, number>()
  for (const p of prospectosRes.data ?? []) {
    if (!p.vendedor_id) continue
    prospectos.set(p.vendedor_id, (prospectos.get(p.vendedor_id) ?? 0) + 1)
  }

  const cartera = new Map<number, number>()
  for (const c of carteraRes.data ?? []) {
    if (!c.vendedor_id) continue
    cartera.set(c.vendedor_id, (cartera.get(c.vendedor_id) ?? 0) + (Number(c.saldo) || 0))
  }

  return vendedores.map((v) => {
    const venta = ventas.get(v.vendedor_id)
    return {
      ...v,
      ventas_mes: venta?.total ?? 0,
      pedidos_mes: venta?.n ?? 0,
      prospectos_activos: prospectos.get(v.vendedor_id) ?? 0,
      cartera_asignada: cartera.get(v.vendedor_id) ?? 0,
      cumplimiento: v.meta_mensual > 0
        ? Math.round(((venta?.total ?? 0) / v.meta_mensual) * 1000) / 10
        : 0,
    }
  })
}

export async function guardarDetalleVendedor(
  vendedorId: number,
  datos: Partial<Omit<VendedorDetalle, "vendedor_id" | "idempresa">>,
  empresaId = 1,
): Promise<ActionResult<VendedorDetalle>> {
  try {
    // Meta, comision y usuario vinculado: quien los edita decide cuanto gana
    // el vendedor y que ve. No puede hacerlo el propio vendedor.
    await exigirPermiso("guardarDetalleVendedor", "crm_vendedores")
    const supabase = await getSupabaseAdmin()

    // Upsert: la fila puede no existir si el vendedor se creó en el sistema
    // operativo después de correr el script de alta inicial.
    const { data, error } = await supabase
      .from("crm_vendedores_detalle")
      .upsert(
        { vendedor_id: vendedorId, idempresa: empresaId, ...datos },
        { onConflict: "vendedor_id" },
      )
      .select()
      .single()

    if (error) {
      // Un usuario no puede ser dos vendedores: lo impide un índice único, y
      // si pasara, "mis prospectos" no sabría cuál mostrar.
      if (error.code === "23505" && error.message.includes("usuario")) {
        return { success: false, error: "Ese usuario ya está vinculado a otro vendedor" }
      }
      return { success: false, error: error.message }
    }

    return { success: true, data: data as VendedorDetalle }
  } catch (err) {
    return fallo(err)
  }
}

/** Usuarios del sistema, para vincularlos a un vendedor. */
export async function getUsuariosDisponibles(): Promise<
  ActionResult<{ id: string; usuario: string }[]>
> {
  try {
    await exigirPermiso("getUsuariosDisponibles", "crm_vendedores", "crm_usuarios")
    const supabase = await getSupabaseAdmin()
    // Usuarios propios del CRM (scripts/209), no los de LIPgo.
    const { data, error } = await supabase
      .from("crm_usuarios")
      .select("id, usuario")
      .eq("activo", true)
      .order("usuario")

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data ?? []) as { id: string; usuario: string }[] }
  } catch (err) {
    return fallo(err)
  }
}
