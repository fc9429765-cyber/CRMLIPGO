"use client"

// Catálogo personalizado del cliente (PED-07): qué productos se le pueden
// vender.
//
// Se listan los productos de TODOS los owners (INDUPAN y Molinos) porque un
// mismo cliente les compra a los dos, y el catálogo es uno solo por cliente.
// Guardar lo puede hacer quien administra listas de precios o maestros; si un
// vendedor lo intenta, el servidor lo rechaza y aquí solo se muestra el aviso.

import { useEffect, useMemo, useState } from "react"
import { Loader2, ListChecks, Search } from "lucide-react"
import { getProductosCrm } from "@/lib/crm-catalogos-actions"
import { getCatalogoCliente, guardarCatalogoCliente } from "@/lib/crm-cuenta-actions"
import { opcionesMaestro } from "@/lib/crm-maestros-actions"
import type { ProductoCrm } from "@/lib/crm-catalogos"
import { DetalleDialog } from "@/components/crm/ui/detalle-dialog"
import { BadgeEstado } from "@/components/crm/ui/modulo"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { toast } from "@/hooks/use-toast"

export function CatalogoClienteDialog({
  clienteId,
  clienteNombre,
  empresaId,
  abierto,
  onCerrar,
}: {
  clienteId: number
  clienteNombre: string
  empresaId: number
  abierto: boolean
  onCerrar: () => void
}) {
  const [productos, setProductos] = useState<ProductoCrm[]>([])
  const [owners, setOwners] = useState<Map<number, string>>(new Map())
  // Arreglo y no Set: el orden se guarda como `orden` del catálogo, así que se
  // conserva el que ya tenía y lo nuevo va al final.
  const [seleccion, setSeleccion] = useState<number[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    setCargando(true)
    setError(null)
    setBusqueda("")
    Promise.all([
      getProductosCrm(empresaId, false, true),
      getCatalogoCliente(clienteId, empresaId),
      opcionesMaestro("owners", empresaId),
    ]).then(([pRes, cRes, oRes]) => {
      if (!vigente) return
      if (!pRes.success || !cRes.success) {
        setError(pRes.error ?? cRes.error ?? "No se pudo cargar el catálogo")
      } else {
        setProductos(pRes.data ?? [])
        setSeleccion(cRes.data ?? [])
      }
      if (oRes.success) setOwners(new Map((oRes.data ?? []).map((o) => [Number(o.valor), o.etiqueta])))
      setCargando(false)
    })
    return () => {
      vigente = false
    }
  }, [abierto, clienteId, empresaId])

  const elegidos = useMemo(() => new Set(seleccion), [seleccion])

  const nombreOwner = (id: number | null | undefined) =>
    id == null ? "Sin owner" : owners.get(id) ?? `Owner ${id}`

  // Agrupado por owner: al armar el catálogo se piensa "qué le vendemos de
  // INDUPAN y qué de Molinos", no una lista alfabética mezclada.
  const grupos = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    const filtrados = t
      ? productos.filter((p) => [p.nombre, p.codigo, p.categoria].some((x) => x?.toLowerCase().includes(t)))
      : productos
    const mapa = new Map<string, { clave: string; ownerId: number | null; items: ProductoCrm[] }>()
    for (const p of filtrados) {
      const ownerId = p.owner_id ?? null
      const clave = String(ownerId ?? "sin")
      if (!mapa.has(clave)) mapa.set(clave, { clave, ownerId, items: [] })
      mapa.get(clave)!.items.push(p)
    }
    // Los sin owner al final: no se pueden vender hasta que se les asigne uno.
    return [...mapa.values()].sort((a, b) =>
      a.ownerId == null ? 1 : b.ownerId == null ? -1 : nombreOwner(a.ownerId).localeCompare(nombreOwner(b.ownerId)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, busqueda, owners])

  const alternar = (id: number, marcar: boolean) =>
    setSeleccion((s) => (marcar ? (s.includes(id) ? s : [...s, id]) : s.filter((x) => x !== id)))

  const guardar = async () => {
    setGuardando(true)
    const res = await guardarCatalogoCliente(clienteId, seleccion, empresaId)
    setGuardando(false)
    if (!res.success) {
      toast({ title: "No se guardó el catálogo", description: res.error, variant: "destructive" })
      return
    }
    const { agregados = 0, retirados = 0 } = res.data ?? {}
    toast({
      title: "Catálogo actualizado",
      description: `${agregados} agregado${agregados === 1 ? "" : "s"} · ${retirados} retirado${retirados === 1 ? "" : "s"}`,
    })
    onCerrar()
  }

  return (
    <DetalleDialog
      abierto={abierto}
      onCerrar={onCerrar}
      icono={ListChecks}
      titulo={`Catálogo · ${clienteNombre}`}
      subtitulo={`${seleccion.length} producto${seleccion.length === 1 ? "" : "s"} en el catálogo`}
      ancho="normal"
      pie={
        <>
          <Button variant="outline" className="h-8" onClick={onCerrar}>Cancelar</Button>
          <Button className="h-8" onClick={guardar} disabled={guardando || cargando || !!error}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </>
      }
    >
      <p className="text-xs text-muted-foreground">
        Los productos que marques salen como favoritos del cliente, arriba, al crear una venta; los demás siguen
        disponibles en "Todos los productos". Solo con el parámetro catalogo.modo = restringido el catálogo limita lo
        que se le puede vender.
      </p>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar producto o código…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="h-8 pl-9 text-xs"
        />
      </div>

      {cargando ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Cargando…</span>
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-800">{error}</div>
      ) : grupos.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">
          {busqueda ? "Ningún producto coincide con la búsqueda." : "No hay productos activos."}
        </p>
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => {
            const marcados = g.items.filter((p) => elegidos.has(p.id)).length
            return (
              <section key={g.clave} className="rounded-md border">
                <header className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5">
                  <span className="text-xs font-semibold">{nombreOwner(g.ownerId)}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {marcados} de {g.items.length}
                  </span>
                </header>
                <ul className="divide-y">
                  {g.items.map((p) => {
                    const idCheck = `cat-${clienteId}-${p.id}`
                    return (
                      <li key={p.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted/30">
                        <Checkbox
                          id={idCheck}
                          checked={elegidos.has(p.id)}
                          onCheckedChange={(v) => alternar(p.id, v === true)}
                        />
                        <label htmlFor={idCheck} className="min-w-0 flex-1 cursor-pointer text-xs">
                          <span className="block truncate font-medium">{p.nombre}</span>
                          {p.codigo && <span className="text-[10px] text-muted-foreground">{p.codigo}</span>}
                        </label>
                        <BadgeEstado
                          tono={p.owner_id == null ? "advertencia" : "neutral"}
                          className="shrink-0 text-[10px]"
                        >
                          {nombreOwner(p.owner_id)}
                        </BadgeEstado>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </DetalleDialog>
  )
}

export default CatalogoClienteDialog
