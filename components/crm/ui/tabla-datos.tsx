"use client"

// Tabla de datos con orden, filtro y virtualización.
//
// Mantiene exactamente el aspecto de LIPgo —`text-xs` en todo, sin cebra, con
// el marco y la cabecera tenue de siempre— y le añade lo que allá no hay:
//
//   - Ordenar pulsando la cabecera. En LIPgo hay que exportar a Excel para
//     ordenar, que es pedirle al usuario que salga del sistema para hacer algo
//     que el sistema debería hacer.
//   - Búsqueda global sobre todas las columnas.
//   - Virtualización: solo se pintan las filas visibles. Sin esto, una cartera
//     de cinco mil facturas congela el navegador al abrir el módulo.
//
// El componente no decide qué columnas hay ni de dónde salen los datos: eso lo
// pasa cada módulo. Aquí solo vive la mecánica, para que no se reimplemente
// veinticinco veces y para que el día que cambie el aspecto se cambie una vez.

import { useRef, useState } from "react"
import {
  useTable,
  flexRender,
  createCoreRowModel,
  createSortedRowModel,
  createFilteredRowModel,
  coreRowModelsFeature,
  coreCellsFeature,
  coreColumnsFeature,
  coreHeadersFeature,
  coreRowsFeature,
  coreTablesFeature,
  rowSortingFeature,
  globalFilteringFeature,
  type ColumnDef,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// v9 exige declarar las prestaciones que se usan, en vez de cargarlas todas.
// Se listan solo estas para no arrastrar al navegador el código de agrupación,
// paginación o selección, que aquí no hacen falta.
//
// En v9 las fábricas de row model viajan dentro de `features`, no como opción
// aparte: es el mismo objeto el que declara qué sabe hacer la tabla y con qué
// lo hace.
const FEATURES = {
  coreCellsFeature,
  coreColumnsFeature,
  coreHeadersFeature,
  coreRowModelsFeature,
  coreRowsFeature,
  coreTablesFeature,
  rowSortingFeature,
  globalFilteringFeature,
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
}

export interface TablaDatosProps<T> {
  datos: T[]
  columnas: ColumnDef<any, any>[]
  cargando?: boolean
  /** Texto del buscador. Si se omite, no se muestra. */
  placeholderBusqueda?: string
  mensajeVacio?: string
  /** A partir de cuántas filas conviene virtualizar. Por debajo no compensa. */
  umbralVirtual?: number
  alto?: string
  /** Se llama al pulsar una fila. Es el gesto de "ver el detalle". */
  onFila?: (fila: T) => void
  /**
   * Clase extra por fila, según sus propios datos.
   *
   * Existe porque en un ERP la fila misma comunica: una factura vencida se tiñe
   * de rojo y se ve desde el otro lado de la oficina, sin leer la columna de
   * estado. Sin esto cada módulo que lo necesite tendría que renunciar a la
   * tabla compartida y volver a escribir la suya.
   */
  claseFila?: (fila: T) => string | undefined
  className?: string
}

export function TablaDatos<T>({
  datos,
  columnas,
  cargando,
  placeholderBusqueda,
  mensajeVacio = "No se encontraron registros.",
  umbralVirtual = 100,
  alto = "max-h-[600px]",
  onFila,
  claseFila,
  className,
}: TablaDatosProps<T>) {
  const [filtro, setFiltro] = useState("")
  const contenedor = useRef<HTMLDivElement>(null)

  const tabla = useTable({
    features: FEATURES,
    data: datos,
    columns: columnas,
    state: { globalFilter: filtro },
    onGlobalFilterChange: setFiltro,
  })

  const filas = tabla.getRowModel().rows

  // Solo se virtualiza cuando hay volumen suficiente. Montar el virtualizador
  // para veinte filas cuesta más de lo que ahorra.
  const virtualizar = filas.length > umbralVirtual

  const virtualizador = useVirtualizer({
    count: filas.length,
    getScrollElement: () => contenedor.current,
    estimateSize: () => 37,
    overscan: 12,
    enabled: virtualizar,
  })

  const virtuales = virtualizador.getVirtualItems()
  const totalAlto = virtualizador.getTotalSize()
  const relleno = virtualizar && virtuales.length > 0 ? virtuales[0].start : 0
  const rellenoFinal =
    virtualizar && virtuales.length > 0 ? totalAlto - virtuales[virtuales.length - 1].end : 0

  const visibles = virtualizar ? virtuales.map((v) => filas[v.index]) : filas
  const nCols = tabla.getAllLeafColumns().length

  return (
    <div className={cn("space-y-2", className)}>
      {placeholderBusqueda && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder={placeholderBusqueda}
            className="h-8 pl-9 text-xs"
          />
        </div>
      )}

      <div
        ref={contenedor}
        className={cn("relative w-full overflow-auto rounded-md border bg-card", alto)}
      >
        {/* Tabla nativa y no la primitiva: la virtualización necesita insertar
            filas de relleno, y `border-separate` es lo que permite que la
            cabecera pegajosa conserve su borde al desplazar. */}
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              {tabla.getHeaderGroups()[0]?.headers.map((h) => {
                const ordenable = h.column.getCanSort()
                const orden = h.column.getIsSorted()
                return (
                  <th
                    key={h.id}
                    onClick={ordenable ? h.column.getToggleSortingHandler() : undefined}
                    className={cn(
                      "sticky top-0 z-20 border-b bg-muted/50 px-3 py-2 text-left align-middle",
                      "text-xs font-semibold text-foreground",
                      ordenable && "cursor-pointer select-none hover:bg-muted",
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {ordenable &&
                        (orden === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        ) : orden === "desc" ? (
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          // El icono neutro se mantiene tenue pero presente: si
                          // solo apareciera al pasar el ratón, nadie descubriría
                          // que las columnas se ordenan.
                          <ChevronsUpDown className="h-3 w-3 opacity-25" aria-hidden="true" />
                        ))}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={nCols} className="h-24 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                </td>
              </tr>
            ) : filas.length === 0 ? (
              <tr>
                <td colSpan={nCols} className="h-24 text-center text-xs text-muted-foreground">
                  {filtro ? "Nada coincide con la búsqueda." : mensajeVacio}
                </td>
              </tr>
            ) : (
              <>
                {relleno > 0 && <tr style={{ height: relleno }} aria-hidden="true" />}

                {visibles.map((fila) => (
                  <tr
                    key={fila.id}
                    onClick={onFila ? () => onFila(fila.original as T) : undefined}
                    className={cn(
                      "transition-colors",
                      // El tinte de la fila va antes del hover: así el hover
                      // sigue ganando al pasar el ratón y no queda una fila
                      // roja que no reacciona al puntero.
                      claseFila?.(fila.original as T),
                      "hover:bg-muted/30",
                      onFila && "cursor-pointer",
                    )}
                  >
                    {/* getAllCells y no getVisibleCells: en la v9 este último
                        solo existe si se declara columnVisibilityFeature, y
                        con la tabla vacía el error no aparece nunca. */}
                    {fila.getAllCells().map((c) => (
                      <td key={c.id} className="border-b px-3 py-1.5 align-middle text-xs">
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}

                {rellenoFinal > 0 && <tr style={{ height: rellenoFinal }} aria-hidden="true" />}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Cuántas se ven de cuántas hay. Con filtro activo, el usuario necesita
          saber que lo que mira es un subconjunto. */}
      {!cargando && datos.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {filas.length === datos.length
            ? `${datos.length.toLocaleString("es-CO")} registro${datos.length === 1 ? "" : "s"}`
            : `${filas.length.toLocaleString("es-CO")} de ${datos.length.toLocaleString("es-CO")} registros`}
          {virtualizar && " · lista virtualizada"}
        </p>
      )}
    </div>
  )
}

export default TablaDatos
