"use client"

// Catálogo con imágenes para armar el pedido (PED-06, PED-08, PED-09).
//
// Tarjetas y no un combobox: en el teléfono, en la tienda del cliente, el
// vendedor reconoce el producto por la foto antes que por el nombre, y un
// toque lo agrega. La lista que llega aquí YA viene filtrada por owner y
// centro de despacho; este componente solo busca y muestra.
//
// FAVORITOS: si el cliente tiene catálogo asignado, esos productos salen
// arriba, a la vista, porque son los que compra. Debajo, en un acordeón
// cerrado, están TODOS los productos para buscar cualquier otro. La búsqueda
// filtra las dos partes, y si lo buscado no está entre los favoritos el
// acordeón se abre solo.

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ImageOff, Package, Plus, Search, Star } from "lucide-react"
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
  favoritos,
  cantidades,
  mostrarStock,
  consultadoEn,
  onAgregar,
  centro,
}: {
  productos: ProductoCrm[]
  /** Ids del catálogo del cliente. Sin ellos (o vacío) se muestra todo plano. */
  favoritos?: Set<number>
  /** Cantidad ya pedida por producto, para marcar la tarjeta. */
  cantidades: Map<number, number>
  mostrarStock: boolean
  /** Centro que despacha: el stock que se muestra es el de ESE centro. */
  centro?: number | null
  consultadoEn: Date | null
  onAgregar: (p: ProductoCrm) => void
}) {
  const [busqueda, setBusqueda] = useState("")
  const [todosAbierto, setTodosAbierto] = useState(false)
  const hayFavoritos = !!favoritos && favoritos.size > 0
  const buscando = busqueda.trim().length > 0

  const filtrados = useMemo(() => {
    const t = norm(busqueda.trim())
    if (!t) return productos
    return productos.filter((p) =>
      [p.nombre, p.codigo, p.categoria].some((v) => norm(v).includes(t)),
    )
  }, [productos, busqueda])

  const favFiltrados = useMemo(
    () => (hayFavoritos ? filtrados.filter((p) => favoritos!.has(p.id)) : []),
    [filtrados, favoritos, hayFavoritos],
  )

  // Lo buscado no está entre los favoritos pero sí en el resto: se abre el
  // acordeón para que el vendedor no crea que el producto no existe.
  useEffect(() => {
    if (hayFavoritos && buscando && favFiltrados.length === 0 && filtrados.length > 0) setTodosAbierto(true)
  }, [buscando, favFiltrados.length, filtrados.length, hayFavoritos])

  const rejilla = (lista: ProductoCrm[]) => (
    <Rejilla
      productos={lista}
      favoritos={favoritos}
      cantidades={cantidades}
      mostrarStock={mostrarStock}
      centro={centro}
      onAgregar={onAgregar}
    />
  )

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={hayFavoritos ? "Buscar en favoritos y en todos los productos…" : "Buscar por nombre, código o categoría…"}
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

      {!hayFavoritos ? (
        filtrados.length === 0 ? (
          <Vacio
            texto={productos.length === 0
              ? "No hay productos de este owner en el centro de despacho elegido."
              : "Ningún producto coincide con la búsqueda."}
          />
        ) : (
          rejilla(filtrados)
        )
      ) : (
        <>
          {/* Favoritos: el catálogo del cliente, siempre a la vista */}
          <section className="space-y-1.5">
            <h4 className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
              <Star className="h-3.5 w-3.5 fill-[#D4A95E] text-[#D4A95E]" aria-hidden="true" />
              Favoritos del cliente
              <span className="font-normal text-muted-foreground">
                · {buscando ? `${favFiltrados.length} de ${favoritos!.size}` : favoritos!.size} de su catálogo
              </span>
            </h4>
            {favFiltrados.length === 0 ? (
              <Vacio
                texto={buscando
                  ? "Ningún favorito coincide. Mira en todos los productos."
                  : "Sus favoritos no están en este owner o centro de despacho."}
              />
            ) : (
              rejilla(favFiltrados)
            )}
          </section>

          {/* Todos los productos, en acordeón */}
          <section className="rounded-lg border">
            <button
              type="button"
              onClick={() => setTodosAbierto((v) => !v)}
              aria-expanded={todosAbierto}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-muted/40"
            >
              <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                <Package className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Todos los productos
                <span className="font-normal text-muted-foreground">
                  · {buscando ? `${filtrados.length} coinciden de ${productos.length}` : productos.length}
                </span>
              </span>
              <ChevronDown
                className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", todosAbierto && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            {todosAbierto && (
              <div className="border-t p-2">
                {filtrados.length === 0 ? <Vacio texto="Ningún producto coincide con la búsqueda." /> : rejilla(filtrados)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Vacio({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
      <Package className="h-6 w-6" aria-hidden="true" />
      {texto}
    </div>
  )
}

function Rejilla({
  productos, favoritos, cantidades, mostrarStock, centro, onAgregar,
}: {
  productos: ProductoCrm[]
  favoritos?: Set<number>
  cantidades: Map<number, number>
  mostrarStock: boolean
  centro?: number | null
  onAgregar: (p: ProductoCrm) => void
}) {
  const visibles = productos.slice(0, MAX_TARJETAS)
  return (
    <>
      <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-3 lg:grid-cols-4">
        {visibles.map((p) => {
          const enPedido = cantidades.get(p.id) ?? 0
          const esFavorito = favoritos?.has(p.id) ?? false
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
                {esFavorito && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-[#1A1715]/85 p-1" title="Del catálogo del cliente">
                    <Star className="h-3 w-3 fill-[#D4A95E] text-[#D4A95E]" aria-hidden="true" />
                  </span>
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
      {productos.length > MAX_TARJETAS && (
        <p className="text-[11px] text-muted-foreground">
          Mostrando {MAX_TARJETAS} de {productos.length}. Busca para ver el resto.
        </p>
      )}
    </>
  )
}
