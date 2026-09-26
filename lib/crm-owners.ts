// Owners comerciales (INDUPAN, Molinos) y como se resuelve el de un producto.
//
// Sin "use server": tipos y logica pura, que tambien usan el navegador y las
// pruebas. La MISMA regla vive en SQL (crm_owner_de_producto, script 193); si
// cambia una, hay que cambiar la otra, y las pruebas de owners lo vigilan.

export interface CrmOwner {
  id: number
  idempresa: number
  codigo: string
  nombre: string
  owner_lipgo_id: number | null
  nombre_empresafactura: string
  alias_producto: string[]
  idempresas_origen: number[]
  idempresa_lipgo: number
  /** Centros de LIPgo desde los que despacha (script 199). */
  idempresas_despacho?: number[]
  envia_sap: boolean
  color: string | null
  activo: boolean
}

const norm = (t: string | null | undefined) => String(t ?? "").trim().toUpperCase()

/**
 * Owner de un producto.
 *
 * 1. Si `productos.owner` trae texto, manda ese texto (comparado contra los
 *    alias de cada owner, en mayusculas).
 * 2. Si viene vacio, se decide por la empresa donde esta creado el producto.
 * 3. Si ninguno encaja, null: el producto no se puede vender por el CRM hasta
 *    que se le asigne owner. Mejor eso que adivinar y facturarlo por la
 *    empresa equivocada.
 *
 * Un texto de owner que no coincide con ningun alias NO cae al paso 2: si dice
 * "AVIMOL", es de Avimol aunque este creado en la empresa 1.
 */
export function resolverOwner(
  producto: { owner?: string | null; id_empresa: number },
  owners: Pick<CrmOwner, "id" | "alias_producto" | "idempresas_origen" | "activo">[],
): number | null {
  const activos = owners.filter((o) => o.activo)
  const texto = norm(producto.owner)

  if (texto) {
    const porTexto = activos.find((o) => o.alias_producto.some((a) => norm(a) === texto))
    return porTexto?.id ?? null
  }
  const porEmpresa = activos.find((o) => o.idempresas_origen.includes(producto.id_empresa))
  return porEmpresa?.id ?? null
}

/**
 * PED-17: un pedido pertenece a UN solo owner. Devuelve el owner comun de las
 * lineas, o el motivo por el que no se puede.
 */
export function ownerDelPedido(
  ownersDeLineas: (number | null)[],
): { ok: true; ownerId: number | null } | { ok: false; error: string } {
  if (ownersDeLineas.length === 0) return { ok: true, ownerId: null }
  if (ownersDeLineas.some((o) => o == null)) {
    return { ok: false, error: "Hay productos sin owner asignado. Asígnalo en Maestros antes de venderlos." }
  }
  const distintos = new Set(ownersDeLineas)
  if (distintos.size > 1) {
    return {
      ok: false,
      error: "Un pedido no puede mezclar productos de INDUPAN y de Molinos. Haz un pedido por cada uno.",
    }
  }
  return { ok: true, ownerId: ownersDeLineas[0] }
}
