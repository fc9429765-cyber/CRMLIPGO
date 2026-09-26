"use client"

// Catálogo comercial de productos: fotos, descripción de venta y precio base.
//
// LO QUE ESTA PANTALLA NO TOCA: peso, gramaje, unidades por estiba y vida útil.
// Esos datos los usa producción e inventario en el sistema operativo, sobre la
// misma tabla. Aquí solo se agrega lo comercial, y la server action tiene lista
// blanca por campo para que no pueda ser de otro modo.

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Loader2, Search, Package, ImagePlus, Trash2, Star, Pencil, Camera, AlertTriangle,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getProductosCrm, actualizarDatosComercialesProducto } from "@/lib/crm-catalogos-actions"
import type { ProductoCrm } from "@/lib/crm-catalogos"
import { opcionesMaestro } from "@/lib/crm-maestros-actions"
import { BadgeEstado } from "@/components/crm/ui/modulo"
import { SubNav, type VistaSubNav } from "@/components/crm/ui/sub-nav"
import { compressImageIfNeeded } from "@/lib/image-compress"
import { money } from "@/lib/crm-cotizaciones"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"

type Opcion = { valor: string; etiqueta: string }

/** Valores especiales del filtro de owner y del selector de impuesto. */
const TODOS = "todos"
const SIN_OWNER = "sin"
const IMPUESTO_DEFECTO = "__defecto__"

const numeroCO = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

export function ProductosPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [productos, setProductos] = useState<ProductoCrm[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState("")
  const [editando, setEditando] = useState<ProductoCrm | null>(null)
  const [owners, setOwners] = useState<Opcion[]>([])
  const [impuestos, setImpuestos] = useState<Opcion[]>([])
  const [filtroOwner, setFiltroOwner] = useState<string>(TODOS)

  const cargar = async () => {
    // Todos los owners: INDUPAN vive en la empresa 1 y Molinos en la 3 y la 4.
    // Sin esto, los productos de Molinos no se podían ni ver ni completar.
    const [res, oRes, iRes] = await Promise.all([
      getProductosCrm(empresaId, false, true),
      opcionesMaestro("owners", empresaId),
      opcionesMaestro("impuestos", empresaId),
    ])
    if (res.success) setProductos(res.data ?? [])
    else toast({ title: "No se pudieron cargar", description: res.error, variant: "destructive" })
    if (oRes.success) setOwners(oRes.data ?? [])
    if (iRes.success) setImpuestos(iRes.data ?? [])
    setCargando(false)
  }

  const nombreOwner = (id: number | null | undefined) =>
    id == null ? null : owners.find((o) => o.valor === String(id))?.etiqueta ?? `Owner ${id}`

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    const delOwner =
      filtroOwner === TODOS
        ? productos
        : filtroOwner === SIN_OWNER
          ? productos.filter((p) => p.owner_id == null)
          : productos.filter((p) => String(p.owner_id) === filtroOwner)
    if (!t) return delOwner
    return delOwner.filter((p) =>
      [p.nombre, p.codigo, p.categoria].some((x) => x?.toLowerCase().includes(t)),
    )
  }, [productos, busqueda, filtroOwner])

  const sinFoto = productos.filter((p) => !p.foto_url).length
  const sinPrecio = productos.filter((p) => p.precio_base == null).length
  const sinOwner = productos.filter((p) => p.owner_id == null).length

  // La píldora "Sin owner" solo aparece si hay alguno: es lo que hay que
  // corregir, y una píldora vacía no dice nada.
  const vistasOwner: VistaSubNav[] = [
    { valor: TODOS, etiqueta: "Todos", contador: productos.length },
    ...owners.map((o) => ({
      valor: o.valor,
      etiqueta: o.etiqueta,
      contador: productos.filter((p) => String(p.owner_id) === o.valor).length,
    })),
    ...(sinOwner > 0 ? [{ valor: SIN_OWNER, etiqueta: "Sin owner", contador: sinOwner }] : []),
  ]

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <Package className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Productos</h1>
            <p className="text-sm text-muted-foreground">Fotos, descripción comercial y precio base. Los datos de producción
          (peso, estiba, vida útil) se administran en el sistema operativo.</p>
          </div>
        </div>
      </header>

      {/* Lo que falta por completar, que es lo accionable. Un contador de
          "productos totales" no le dice a nadie qué hacer. */}
      <SubNav vistas={vistasOwner} activa={filtroOwner} onCambiar={setFiltroOwner} />

      {(sinFoto > 0 || sinPrecio > 0 || sinOwner > 0) && (
        <div className="flex flex-wrap gap-2">
          {sinOwner > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700">
              {sinOwner} sin owner — no se pueden vender
            </Badge>
          )}
          {sinPrecio > 0 && (
            <Badge variant="outline" className="border-[var(--chart-3)] text-[var(--chart-3)]">
              {sinPrecio} sin precio base — no se pueden cotizar
            </Badge>
          )}
          {sinFoto > 0 && (
            <Badge variant="outline">{sinFoto} sin foto</Badge>
          )}
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar producto…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9"
        />
      </div>

      {cargando ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibles.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className="relative aspect-[4/3] bg-muted">
                {p.foto_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.foto_url}
                    alt={p.nombre}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Package className="h-10 w-10 text-muted-foreground/30" />
                  </div>
                )}

                {p.fotos.length > 0 && (
                  <Badge variant="secondary" className="absolute right-2 top-2 text-[10px]">
                    +{p.fotos.length}
                  </Badge>
                )}
              </div>

              <CardContent className="space-y-2 p-3">
                <div className="min-h-[2.5rem]">
                  <p className="line-clamp-2 text-sm font-medium leading-tight">{p.nombre}</p>
                  {p.categoria && (
                    <p className="text-xs text-muted-foreground">{p.categoria}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {p.owner_id != null ? (
                    <BadgeEstado className="text-[10px]">{nombreOwner(p.owner_id)}</BadgeEstado>
                  ) : (
                    <BadgeEstado tono="advertencia" icono={AlertTriangle} className="text-[10px]">
                      <span title="No se puede vender hasta que se le asigne un owner">Sin owner</span>
                    </BadgeEstado>
                  )}
                  {p.impuesto_pct != null && (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      Impuesto {numeroCO(p.impuesto_pct)}%
                    </span>
                  )}
                </div>
                {/* El owner decide quién factura: sin él, el pedido no sabe a
                    qué empresa cargarlo, por eso se avisa en la propia tarjeta. */}
                {p.owner_id == null && (
                  <p className="text-[11px] text-muted-foreground">
                    No se puede vender hasta que se le asigne un owner.
                  </p>
                )}

                <p className="text-xs">
                  <span className="text-muted-foreground">Stock: </span>
                  {p.stock_disponible != null ? (
                    <span className="font-medium tabular-nums">{numeroCO(p.stock_disponible)}</span>
                  ) : (
                    <span className="text-muted-foreground">Sin dato</span>
                  )}
                </p>

                <div className="flex items-center justify-between">
                  {p.precio_base != null ? (
                    <span className="font-semibold tabular-nums">{money(p.precio_base)}</span>
                  ) : (
                    <span className="text-xs text-[var(--chart-3)]">Sin precio</span>
                  )}

                  <Button size="sm" variant="ghost" onClick={() => setEditando(p)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!cargando && visibles.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {busqueda || filtroOwner !== TODOS ? "Ningún producto coincide." : "No hay productos en el catálogo."}
          </CardContent>
        </Card>
      )}

      {editando && (
        <EditorProducto
          producto={editando}
          impuestos={impuestos}
          empresaId={empresaId}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            cargar()
          }}
        />
      )}
    </div>
  )
}

function EditorProducto({
  producto, impuestos, empresaId, onCerrar, onGuardado,
}: {
  producto: ProductoCrm
  impuestos: Opcion[]
  empresaId: number
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [precio, setPrecio] = useState(producto.precio_base != null ? String(producto.precio_base) : "")
  const [descripcion, setDescripcion] = useState(producto.descripcion_comercial ?? "")
  const [principal, setPrincipal] = useState(producto.foto_url)
  const [galeria, setGaleria] = useState<string[]>(producto.fotos ?? [])
  const [impuestoId, setImpuestoId] = useState(
    producto.crm_impuesto_id != null ? String(producto.crm_impuesto_id) : IMPUESTO_DEFECTO,
  )
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const subir = async (archivos: FileList | null) => {
    if (!archivos?.length) return
    setSubiendo(true)

    // De a una por petición: subirlas juntas choca contra el límite de cuerpo
    // de Vercel en cuanto son tres fotos de celular.
    for (const archivo of Array.from(archivos)) {
      try {
        // Comprimir ANTES de enviar. Sin esto, una foto de celular (5-12 MB)
        // supera el límite y falla con un 413 que el usuario no entiende.
        const comprimido = await compressImageIfNeeded(archivo)

        const form = new FormData()
        form.append("file", comprimido)
        form.append("carpeta", "productos")
        form.append("referencia", String(producto.id))

        const res = await fetch("/api/crm/upload-imagen", { method: "POST", body: form })
        const data = await res.json()

        if (!data.success) {
          toast({ title: "No se subió", description: data.error, variant: "destructive" })
          continue
        }

        // La primera foto que se sube pasa a ser la principal.
        if (!principal) setPrincipal(data.url)
        else setGaleria((g) => [...g, data.url])
      } catch (err) {
        toast({
          title: "Error al subir",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        })
      }
    }

    setSubiendo(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  const hacerPrincipal = (url: string) => {
    // Se intercambian: la que era principal baja a la galería, para no perderla.
    setGaleria((g) => [...g.filter((x) => x !== url), ...(principal ? [principal] : [])])
    setPrincipal(url)
  }

  const quitar = (url: string) => {
    // Solo se desvincula; el archivo sigue en el Storage. Borrarlo de verdad
    // rompería cualquier documento ya emitido que lo referencie.
    if (url === principal) setPrincipal(galeria[0] ?? null)
    setGaleria((g) => g.filter((x) => x !== url))
  }

  const guardar = async () => {
    setGuardando(true)
    const res = await actualizarDatosComercialesProducto(
      producto.id,
      {
        precio_base: precio ? Number(precio) : null,
        descripcion_comercial: descripcion.trim() || null,
        foto_url: principal,
        fotos: galeria.filter((u) => u !== principal),
        // null = el impuesto por defecto de la empresa, no "sin impuesto".
        crm_impuesto_id: impuestoId === IMPUESTO_DEFECTO ? null : Number(impuestoId),
      },
      empresaId,
    )
    setGuardando(false)

    if (!res.success) {
      toast({ title: "No se guardó", description: res.error, variant: "destructive" })
      return
    }
    toast({ title: "Producto actualizado" })
    onGuardado()
  }

  const todas = [...(principal ? [principal] : []), ...galeria.filter((u) => u !== principal)]

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="line-clamp-2">{producto.nombre}</DialogTitle>
          <DialogDescription>
            {producto.codigo && `${producto.codigo} · `}
            {producto.categoria ?? "Sin categoría"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Fotos</Label>
              <Button
                size="sm" variant="outline"
                onClick={() => inputRef.current?.click()}
                disabled={subiendo}
              >
                {subiendo ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="mr-1 h-3.5 w-3.5" />
                )}
                Agregar
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => subir(e.target.files)}
              />
            </div>

            {todas.length === 0 ? (
              <button
                onClick={() => inputRef.current?.click()}
                className="flex h-32 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-[var(--chart-1)] hover:text-[var(--chart-1)]"
              >
                <Camera className="h-6 w-6" />
                <span className="text-xs">Sin fotos. Toca para agregar.</span>
              </button>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {todas.map((url) => (
                  <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />

                    {url === principal && (
                      <Badge className="absolute left-1 top-1 gap-0.5 px-1 text-[9px]">
                        <Star className="h-2.5 w-2.5" />
                        Principal
                      </Badge>
                    )}

                    <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      {url !== principal && (
                        <Button
                          size="icon" variant="secondary" className="h-7 w-7"
                          onClick={() => hacerPrincipal(url)}
                          aria-label="Hacer principal"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon" variant="destructive" className="h-7 w-7"
                        onClick={() => quitar(url)}
                        aria-label="Quitar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <Separator />

          <div className="space-y-1.5">
            <Label className="text-sm">Precio base</Label>
            <Input
              type="number" min="0"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              Es la base sobre la que operan las listas de precios. Sin precio
              base, el producto no se puede cotizar.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Impuesto</Label>
            <Select value={impuestoId} onValueChange={setImpuestoId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={IMPUESTO_DEFECTO}>— Por defecto —</SelectItem>
                {impuestos.map((i) => (
                  <SelectItem key={i.valor} value={i.valor}>{i.etiqueta}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Por defecto se aplica el impuesto predeterminado de Maestros
              {producto.impuesto_pct != null && ` (hoy ${numeroCO(producto.impuesto_pct)}%)`}.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Descripción comercial</Label>
            <Textarea
              rows={3}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Cómo se le presenta al cliente…"
            />
          </div>

          {/* Se muestran los datos operativos, pero solo para consulta: verlos
              evita pedirlos por otro canal; editarlos rompería producción. */}
          <div className="rounded-lg bg-muted/50 p-3 text-xs">
            <p className="mb-1.5 font-medium text-muted-foreground">
              Datos de operación (solo lectura)
            </p>
            <div className="grid grid-cols-2 gap-1 text-muted-foreground">
              <span>Peso neto: {producto.peso_unitkg ?? "—"} kg</span>
              <span>Unidad: {producto.unidad ?? "—"}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando || subiendo}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ProductosPanel
