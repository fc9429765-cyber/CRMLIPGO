"use client"

// Catálogo con imágenes para armar el pedido (PED-06, PED-08, PED-09).
//
// Tarjetas y no un combobox: en el teléfono, en la tienda del cliente, el
// vendedor reconoce el producto por la foto antes que por el nombre, y un
// toque lo agrega. La lista que llega aquí YA viene filtrada por owner, centro
// de despacho y catálogo del cliente; este componente solo busca y muestra.

import { useMemo, useState } from "react"
import { ImageOff, Package, Plus, Search } from "lucide-react"
import type { ProductoCrm } from "@/lib/crm-catalogos"
import { money } from "@/lib/crm-cotizaciones"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/** Tope de tarjetas pintadas: con miles de productos el teléfono se arrastra.
 *  Buscar es más rápido que desplazar de todos modos. */
const MAX_TARJETAS = 60

const norm = (t: unknown) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export function CatalogoVenta({
  productos,
  cantidades,
  mostrarStock,
  consultadoEn,
  onAgregar,
  centro,
}: {
  productos: ProductoCrm[]
  /** Cantidad ya pedida por producto, para marcar la tarjeta. */
  cantidades: Map<number, number>
  mostrarStock: boolean
  /** Centro que despacha: el stock que se muestra es el de ESE centro. */
  centro?: number | null
  consultadoEn: Date | null
  onAgregar: (p: ProductoCrm) => void
}) {
  const [busqueda, setBusqueda] = useState("")

  const filtrados = useMemo(() => {
    const t = norm(busqueda.trim())
    if (!t) return productos
    return productos.filter((p) =>
      [p.nombre, p.codigo, p.categoria].some((v) => norm(v).includes(t)),
    )
  }, [productos, busqueda])

  const visibles = filtrados.slice(0, MAX_TARJETAS)

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, código o categoría…"
          className="h-10 pl-9"
          inputMode="search"
        />
      </div>

      {mostrarStock && consultadoEn && (
        <p className="text-[11px] text-muted-foreground">
          Existencias según LIPgo, consultadas a las{" "}
          {consultadoEn.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed py-8 text-center text-xs text-muted-foreground">
          <Package className="h-6 w-6" aria-hidden="true" />
          {productos.length === 0
            ? "No hay productos de este owner en el centro de despacho elegido."
            : "Ningún producto coincide con la búsqueda."}
        </div>
      ) : (
        <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-3 lg:grid-cols-4">
          {visibles.map((p) => {
            const enPedido = cantidades.get(p.id) ?? 0
            // Stock del centro que va a despachar: el total de todas las
            // sedes haria creer al vendedor que hay lo que esta en otra ciudad.
            const stock = centro != null && p.stock_por_sede
              ? (p.stock_por_sede[centro] ?? 0)
              : p.stock_disponible
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onAgregar(p)}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors",
                  "hover:border-[var(--chart-1)] active:scale-[0.99]",
                  enPedido > 0 && "border-[var(--chart-1)] ring-1 ring-[var(--chart-1)]/40",
                )}
                aria-label={`Agregar ${p.nombre}`}
              >
                <div className="relative flex h-24 items-center justify-center bg-muted/40">
                  {p.foto_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.foto_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <ImageOff className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
                  )}
                  {enPedido > 0 ? (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-[var(--chart-1)] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                      {enPedido.toLocaleString("es-CO")}
                    </span>
                  ) : (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 text-[var(--chart-1)] opacity-80 group-hover:opacity-100">
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-0.5 p-2">
                  <span className="line-clamp-2 text-xs font-medium leading-tight">{p.nombre}</span>
                  {p.codigo && <span className="text-[10px] text-muted-foreground">{p.codigo}</span>}
                  <div className="mt-auto flex items-baseline justify-between gap-1 pt-1">
                    <span className="text-xs font-semibold tabular-nums">
                      {p.precio_base != null ? money(p.precio_base) : "Sin precio"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">IVA {p.impuesto_pct ?? 0} %</span>
                  </div>
                  {mostrarStock && (
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        stock == null ? "text-muted-foreground" : stock > 0 ? "text-emerald-700" : "text-red-700",
                      )}
                    >
                      {stock == null ? "Sin dato" : `Disp.: ${stock.toLocaleString("es-CO")}`}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {filtrados.length > MAX_TARJETAS && (
        <p className="text-[11px] text-muted-foreground">
          Mostrando {MAX_TARJETAS} de {filtrados.length}. Afina la búsqueda para ver el resto.
        </p>
      )}
    </div>
  )
}
