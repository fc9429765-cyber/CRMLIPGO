"use client"

// Vista "Mapa" de Gestión de Clientes: dónde están los clientes y las
// sucursales, con filtro por vendedor y búsqueda, y cuántos faltan por ubicar.
//
// Un vendedor ve solo sus clientes (el servidor ya filtra la lista) y las
// sucursales de esos clientes.

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Building2, Loader2, LocateFixed, MapPin, Search, Store, Users } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getClientesCrm, getSucursalesCrm, getVendedoresCrm } from "@/lib/crm-catalogos-actions"
import type { ClienteCrm, SucursalCrm, VendedorCrm } from "@/lib/crm-catalogos"
import { abrirCuenta360, irA } from "@/lib/crm-navegacion"
import type { PuntoCliente } from "@/components/crm/clientes/mapa-clientes"
import { KpiCompacto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"

const MapaClientes = dynamic(() => import("@/components/crm/clientes/mapa-clientes"), {
  ssr: false,
  loading: () => <div className="flex h-[520px] items-center justify-center rounded-xl bg-muted/30"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>,
})

const TODOS = "__todos__"

export function MapaClientesPanel({ enfocarClienteId }: { enfocarClienteId?: number | null }) {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1
  const [clientes, setClientes] = useState<ClienteCrm[]>([])
  const [sucursales, setSucursales] = useState<SucursalCrm[]>([])
  const [vendedores, setVendedores] = useState<VendedorCrm[]>([])
  const [cargando, setCargando] = useState(true)
  const [verClientes, setVerClientes] = useState(true)
  const [verSucursales, setVerSucursales] = useState(true)
  const [vendedor, setVendedor] = useState(TODOS)
  const [texto, setTexto] = useState("")
  const [miUbicacion, setMiUbicacion] = useState<{ latitud: number; longitud: number; precision_m: number } | null>(null)
  const [ubicando, setUbicando] = useState(false)

  useEffect(() => {
    let vivo = true
    Promise.all([getClientesCrm(empresaId), getSucursalesCrm(empresaId), getVendedoresCrm(empresaId)]).then(([c, s, v]) => {
      if (!vivo) return
      if (c.success) setClientes(c.data ?? [])
      if (s.success) setSucursales(s.data ?? [])
      if (v.success) setVendedores(v.data ?? [])
      setCargando(false)
    })
    return () => { vivo = false }
  }, [empresaId])

  const nombreVendedor = useMemo(() => new Map(vendedores.map((v) => [v.idvendedor, v.nombre])), [vendedores])
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes])

  const puntos = useMemo<PuntoCliente[]>(() => {
    const t = texto.trim().toLowerCase()
    const pasaVendedor = (c: ClienteCrm | undefined) => vendedor === TODOS || String(c?.vendedor_asignado ?? "") === vendedor
    const pasaTexto = (s: string) => !t || s.toLowerCase().includes(t)
    const out: PuntoCliente[] = []
    if (verClientes) {
      for (const c of clientes) {
        if (c.latitud == null || c.longitud == null || !pasaVendedor(c) || !pasaTexto(`${c.nombre} ${c.documento ?? ""}`)) continue
        out.push({ tipo: "cliente", id: c.id, clienteId: c.id, nombre: c.nombre, latitud: c.latitud, longitud: c.longitud, bloqueado: c.bloqueado_cartera,
          detalle: [c.documento ? `NIT ${c.documento}` : null, c.vendedor_asignado ? nombreVendedor.get(c.vendedor_asignado) : null].filter(Boolean).join(" · ") || null })
      }
    }
    if (verSucursales) {
      for (const s of sucursales) {
        if (s.latitud == null || s.longitud == null || !s.activo) continue
        const c = s.clienteid ? clientePorId.get(s.clienteid) : undefined
        // Sucursal de un cliente que no está en la lista visible: no se pinta.
        if (s.clienteid && !c) continue
        if (!pasaVendedor(c) || !pasaTexto(`${s.nombrebodega} ${c?.nombre ?? ""} ${s.ciudad ?? ""}`)) continue
        out.push({ tipo: "sucursal", id: s.idbodega, clienteId: s.clienteid, nombre: s.nombrebodega, latitud: s.latitud, longitud: s.longitud,
          detalle: [c?.nombre, s.direccion, s.ciudad].filter(Boolean).join(" · ") || null })
      }
    }
    return out
  }, [clientes, sucursales, verClientes, verSucursales, vendedor, texto, nombreVendedor, clientePorId])

  const enfocar = useMemo(() => (enfocarClienteId ? puntos.find((p) => p.tipo === "cliente" && p.id === enfocarClienteId) ?? null : null), [puntos, enfocarClienteId])

  const sinUbicacion = useMemo(() => ({
    clientes: clientes.filter((c) => c.latitud == null).length,
    sucursales: sucursales.filter((s) => s.activo && s.latitud == null && (!s.clienteid || clientePorId.has(s.clienteid))).length,
  }), [clientes, sucursales, clientePorId])

  const ubicarme = useCallback(() => {
    if (!navigator.geolocation) { toast({ title: "Este dispositivo no permite obtener la ubicación", variant: "destructive" }); return }
    setUbicando(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUbicando(false); setMiUbicacion({ latitud: pos.coords.latitude, longitud: pos.coords.longitude, precision_m: Math.round(pos.coords.accuracy) }) },
      () => { setUbicando(false); toast({ title: "No se pudo obtener tu ubicación", variant: "destructive" }) },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  }, [])

  const accion = useCallback((tipo: string, p: PuntoCliente) => {
    if (!p.clienteId) return
    if (tipo === "cuenta") abrirCuenta360(p.clienteId)
    if (tipo === "venta") irA({ accion: "nueva_venta", clienteId: p.clienteId })
  }, [])

  return (
    <div className="space-y-3">
      <TiraKpi>
        <KpiCompacto etiqueta="Clientes en el mapa" valor={clientes.filter((c) => c.latitud != null).length} icono={Users}
          detalle={sinUbicacion.clientes ? `${sinUbicacion.clientes} sin ubicación` : "Todos ubicados"} tono={sinUbicacion.clientes ? "warning" : "success"} />
        <KpiCompacto etiqueta="Sucursales en el mapa" valor={sucursales.filter((s) => s.activo && s.latitud != null).length} icono={Store}
          detalle={sinUbicacion.sucursales ? `${sinUbicacion.sucursales} sin ubicación` : "Todas ubicadas"} tono={sinUbicacion.sucursales ? "warning" : "success"} />
        <KpiCompacto etiqueta="Mostrando" valor={puntos.length} icono={MapPin} tono="primary" detalle="Con los filtros actuales" />
      </TiraKpi>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" placeholder="Cliente, NIT, sucursal, ciudad…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <Select value={vendedor} onValueChange={setVendedor}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los vendedores</SelectItem>
            {vendedores.filter((v) => v.activo).map((v) => <SelectItem key={v.idvendedor} value={String(v.idvendedor)}>{v.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs"><Switch checked={verClientes} onCheckedChange={setVerClientes} /> <Users className="h-3.5 w-3.5 text-[#6E1614]" /> Clientes</label>
        <label className="flex items-center gap-1.5 text-xs"><Switch checked={verSucursales} onCheckedChange={setVerSucursales} /> <Building2 className="h-3.5 w-3.5 text-[#B07A2A]" /> Sucursales</label>
        <Button variant="outline" size="sm" className="ml-auto h-8 text-xs" onClick={ubicarme} disabled={ubicando}>
          {ubicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="mr-1.5 h-3.5 w-3.5" />} Mi ubicación
        </Button>
      </div>

      {cargando ? (
        <div className="flex h-[520px] items-center justify-center rounded-xl bg-muted/30"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <MapaClientes puntos={puntos} miUbicacion={miUbicacion} enfocar={enfocar} onAccion={accion} />
      )}
      <p className="text-[11px] text-muted-foreground">
        Pin vinotinto: cliente · dorado: sucursal · rojo: cliente bloqueado por cartera. La ubicación se fija al editar el cliente o la sucursal.
        "Cómo llegar" abre Google Maps con la ruta.
      </p>
    </div>
  )
}

export default MapaClientesPanel
