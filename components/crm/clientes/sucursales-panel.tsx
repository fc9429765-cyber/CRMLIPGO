"use client"

// Sucursales: los puntos de entrega de cada cliente.
//
// Son la tabla `bodegas` del sistema operativo, que el CRM lee para saber a
// dónde se despacha y para planificar rutas. Aquí solo se edita el GPS: el
// resto lo administra operación, que es quien despacha.

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search, Store, MapPin, Building2, ChevronRight } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getSucursalesCrm, getClientesCrm, actualizarUbicacionSucursal } from "@/lib/crm-catalogos-actions"
import { GpsCapture, type Ubicacion } from "@/components/crm/prospectos/gps-capture"
import { DetalleDialog } from "@/components/crm/ui/detalle-dialog"
import { Button } from "@/components/ui/button"
import { irA } from "@/lib/crm-navegacion"
import type { SucursalCrm, ClienteCrm } from "@/lib/crm-catalogos"
import { KpiCompacto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/hooks/use-toast"

interface GrupoCliente {
  clienteId: number | null
  nombre: string
  sucursales: SucursalCrm[]
  conGps: number
}

export function SucursalesPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [sucursales, setSucursales] = useState<SucursalCrm[]>([])
  const [clientes, setClientes] = useState<ClienteCrm[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState("")
  // Fijar la ubicación de una sucursal en el mapa.
  const [fijando, setFijando] = useState<SucursalCrm | null>(null)
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [version, setVersion] = useState(0)

  const abrirFijar = (s: SucursalCrm) => {
    setUbicacion(s.latitud != null && s.longitud != null ? { latitud: s.latitud, longitud: s.longitud, precision_m: 0, manual: true } : null)
    setFijando(s)
  }
  const guardarUbicacion = async () => {
    if (!fijando) return
    setGuardando(true)
    const r = await actualizarUbicacionSucursal(fijando.idbodega, ubicacion ? { latitud: ubicacion.latitud, longitud: ubicacion.longitud } : null, empresaId)
    setGuardando(false)
    if (!r.success) { toast({ title: "No se guardó la ubicación", description: r.error, variant: "destructive" }); return }
    toast({ title: ubicacion ? "Ubicación guardada" : "Ubicación quitada" })
    setFijando(null)
    setVersion((v) => v + 1)
  }

  useEffect(() => {
    let cancelado = false

    Promise.all([getSucursalesCrm(empresaId), getClientesCrm(empresaId)]).then(([sRes, cRes]) => {
      if (cancelado) return
      if (sRes.success) setSucursales(sRes.data ?? [])
      else toast({ title: "No se pudieron cargar", description: sRes.error, variant: "destructive" })
      if (cRes.success) setClientes(cRes.data ?? [])
      setCargando(false)
    })

    return () => { cancelado = true }
  }, [empresaId, version])

  const nombreCliente = useMemo(
    () => new Map(clientes.map((c) => [c.id, c.nombre])),
    [clientes],
  )

  // Se agrupan por cliente: una sucursal suelta no dice nada, lo que importa
  // es a cuántos puntos hay que llegar por cada cliente.
  const grupos = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    const mapa = new Map<number | null, GrupoCliente>()

    for (const s of sucursales) {
      if (!s.activo) continue

      const nombre = s.clienteid ? nombreCliente.get(s.clienteid) ?? s.cliente ?? "—" : s.cliente ?? "Sin cliente"

      if (t && ![nombre, s.nombrebodega, s.ciudad, s.direccion].some((x) => x?.toLowerCase().includes(t))) {
        continue
      }

      const g = mapa.get(s.clienteid) ?? {
        clienteId: s.clienteid,
        nombre,
        sucursales: [],
        conGps: 0,
      }
      g.sucursales.push(s)
      if (s.latitud != null) g.conGps += 1
      mapa.set(s.clienteid, g)
    }

    return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [sucursales, nombreCliente, busqueda])

  const totales = useMemo(() => {
    const activas = sucursales.filter((s) => s.activo)
    return {
      total: activas.length,
      conGps: activas.filter((s) => s.latitud != null).length,
      ciudades: new Set(activas.map((s) => s.ciudad).filter(Boolean)).size,
    }
  }, [sucursales])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <Store className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Sucursales</h1>
            <p className="text-sm text-muted-foreground">Los puntos de entrega de cada cliente. Las administra el sistema
          operativo; aquí se fija su ubicación para despachar y planificar rutas.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => irA({ accion: "ver_mapa_clientes" })}>
          <MapPin className="mr-1.5 h-3.5 w-3.5" /> Ver todas en el mapa
        </Button>
      </header>

      {/* Tira compacta: aquí lo que importa es el listado de sucursales, así
          que los indicadores acompañan sin robarle la mirada. */}
      <TiraKpi>
        <KpiCompacto icono={Store} etiqueta="Sucursales activas" valor={totales.total} tono="primary" />
        <KpiCompacto
          icono={MapPin}
          etiqueta="Con ubicación GPS"
          valor={totales.conGps}
          tono={totales.conGps < totales.total ? "warning" : "success"}
          detalle={
            totales.conGps < totales.total
              ? `Faltan ${totales.total - totales.conGps} para rutas`
              : "Todas ubicadas"
          }
        />
        <KpiCompacto icono={Building2} etiqueta="Ciudades" valor={totales.ciudades} tono="primary" />
      </TiraKpi>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por cliente, sucursal o ciudad…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9"
        />
      </div>

      {cargando ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : grupos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Store className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {busqueda ? "Nada coincide con la búsqueda." : "No hay sucursales registradas."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {grupos.map((g) => (
            <Card key={g.clienteId ?? "sin-cliente"}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{g.nombre}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {g.sucursales.length} punto{g.sucursales.length === 1 ? "" : "s"}
                    </Badge>
                    {g.conGps < g.sucursales.length && (
                      <Badge variant="secondary" className="text-[10px]">
                        {g.sucursales.length - g.conGps} sin GPS
                      </Badge>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="grid gap-2 sm:grid-cols-2">
                  {g.sucursales.map((s) => (
                    <div key={s.idbodega} className="flex items-start gap-2 rounded-lg border p-2.5">
                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.nombrebodega}</p>

                        {s.direccion && (
                          <p className="truncate text-xs text-muted-foreground">{s.direccion}</p>
                        )}

                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {s.ciudad && <span>{s.ciudad}</span>}
                          {s.departamento && <span>· {s.departamento}</span>}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => abrirFijar(s)}
                        title={s.latitud != null ? "Ver o mover la ubicación" : "Fijar la ubicación"}
                        className={`flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] hover:bg-muted ${s.latitud != null ? "text-[var(--chart-2)]" : "text-muted-foreground"}`}
                      >
                        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                        {s.latitud != null ? "Ubicada" : "Fijar"}
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {fijando && (
        <DetalleDialog
          abierto
          onCerrar={() => setFijando(null)}
          icono={MapPin}
          titulo={fijando.nombrebodega}
          subtitulo={[fijando.direccion, fijando.ciudad].filter(Boolean).join(" · ") || "Sucursal"}
          pie={
            <>
              <Button variant="ghost" onClick={() => setFijando(null)} disabled={guardando}>Cancelar</Button>
              <Button onClick={guardarUbicacion} disabled={guardando}>
                {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Guardar ubicación
              </Button>
            </>
          }
        >
          {/* Sin GPS automático: la sucursal se ubica desde la oficina casi
              siempre. "Mi ubicación" sigue ahí para cuando se está en el sitio. */}
          <GpsCapture value={ubicacion} onChange={setUbicacion} auto={false} titulo="Ubicación de la sucursal" alto={320} />
        </DetalleDialog>
      )}
    </div>
  )
}

export default SucursalesPanel
