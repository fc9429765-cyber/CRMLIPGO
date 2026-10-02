// @ts-nocheck — wrapper de react-leaflet/leaflet: fricción de tipos de librería
// externa, igual que en rutas/mapa-ruta.tsx. Debe ir ANTES de "use client".
"use client"

// Mapa con todos los clientes y sucursales que tienen ubicación.
//
// Cada pin abre una tarjeta con lo siguiente que uno hace al mirar un cliente
// en el mapa: abrir su cuenta, venderle, o pedir la ruta en Google Maps (que
// es lo que el vendedor usa para manejar). Se carga con ssr:false.

import { useEffect, useMemo, useRef } from "react"
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { iconoPin, CENTRO_POR_DEFECTO } from "@/components/crm/mapa/mapa-ubicacion"

export interface PuntoCliente {
  tipo: "cliente" | "sucursal"
  id: number
  clienteId: number | null
  nombre: string
  detalle: string | null
  latitud: number
  longitud: number
  bloqueado?: boolean
}

function Ajuste({ puntos, enfocar }: { puntos: PuntoCliente[]; enfocar: PuntoCliente | null }) {
  const map = useMap()
  const ajustado = useRef(false)
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 250)
    return () => clearTimeout(t)
  }, [map])
  // Al llegar con un cliente concreto, se va a él; si no, se encuadra todo
  // una sola vez (volver a encuadrar en cada filtro marea).
  useEffect(() => {
    if (enfocar) { map.flyTo([enfocar.latitud, enfocar.longitud], 16, { duration: 0.6 }); return }
    if (ajustado.current || !puntos.length) return
    ajustado.current = true
    if (puntos.length === 1) map.setView([puntos[0].latitud, puntos[0].longitud], 15)
    else map.fitBounds(L.latLngBounds(puntos.map((p) => [p.latitud, p.longitud])), { padding: [30, 30], maxZoom: 14 })
  }, [map, puntos, enfocar])
  return null
}

function Pin({ p, abierto, onAccion }: { p: PuntoCliente; abierto: boolean; onAccion: (accion: string, p: PuntoCliente) => void }) {
  const ref = useRef(null)
  useEffect(() => { if (abierto) setTimeout(() => ref.current?.openPopup(), 700) }, [abierto])
  const icono = useMemo(() => iconoPin(p.tipo === "cliente" ? (p.bloqueado ? "#dc2626" : "#0c6b61") : "#16a34a", p.tipo === "cliente" ? 34 : 28), [p.tipo, p.bloqueado])
  const comoLlegar = `https://www.google.com/maps/dir/?api=1&destination=${p.latitud},${p.longitud}`
  return (
    <Marker ref={ref} position={[p.latitud, p.longitud]} icon={icono}>
      <Popup minWidth={220}>
        <div style={{ fontSize: 12, lineHeight: 1.35 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{p.nombre}</div>
          <div style={{ color: "#64748b" }}>{p.tipo === "sucursal" ? "Sucursal" : "Cliente"}{p.detalle ? ` · ${p.detalle}` : ""}</div>
          {p.bloqueado && <div style={{ color: "#dc2626", fontWeight: 600, marginTop: 2 }}>Bloqueado por cartera</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {p.clienteId && <Boton onClick={() => onAccion("cuenta", p)}>Cuenta 360</Boton>}
            {p.clienteId && <Boton onClick={() => onAccion("venta", p)}>Nueva venta</Boton>}
            <a href={comoLlegar} target="_blank" rel="noreferrer" style={estiloBoton(true)}>Cómo llegar ↗</a>
          </div>
        </div>
      </Popup>
    </Marker>
  )
}

const estiloBoton = (primario = false) => ({
  display: "inline-block", padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
  border: "1px solid " + (primario ? "#0c6b61" : "#cbd5e1"), background: primario ? "#0c6b61" : "#fff", color: primario ? "#fff" : "#0f172a", textDecoration: "none",
})
function Boton({ children, onClick }) {
  return <button type="button" onClick={onClick} style={estiloBoton()}>{children}</button>
}

export function MapaClientes({
  puntos, miUbicacion, enfocar, onAccion, alto = 520,
}: {
  puntos: PuntoCliente[]
  miUbicacion: { latitud: number; longitud: number; precision_m: number } | null
  enfocar: PuntoCliente | null
  onAccion: (accion: string, p: PuntoCliente) => void
  alto?: number
}) {
  return (
    <MapContainer center={CENTRO_POR_DEFECTO} zoom={11} scrollWheelZoom style={{ height: alto, width: "100%", borderRadius: "0.75rem", zIndex: 0 }}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Ajuste puntos={puntos} enfocar={enfocar} />
      {miUbicacion && (
        <CircleMarker center={[miUbicacion.latitud, miUbicacion.longitud]} radius={8} pathOptions={{ color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }}>
          <Popup>Estás aquí (±{miUbicacion.precision_m} m)</Popup>
        </CircleMarker>
      )}
      {puntos.map((p) => (
        <Pin key={`${p.tipo}-${p.id}`} p={p} abierto={!!enfocar && enfocar.tipo === p.tipo && enfocar.id === p.id} onAccion={onAccion} />
      ))}
    </MapContainer>
  )
}

export default MapaClientes
