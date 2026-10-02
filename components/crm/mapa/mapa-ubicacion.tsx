// @ts-nocheck — wrapper de react-leaflet/leaflet: fricción de tipos de librería
// externa, igual que en rutas/mapa-ruta.tsx. Debe ir ANTES de "use client".
"use client"

// Mapa para FIJAR una ubicación: muestra dónde está el usuario (punto azul
// con su radio de precisión) y un pin que se arrastra o se pone con un clic.
//
// SOLO SE CARGA CON ssr:false (lo hace quien lo usa): Leaflet toca `window`
// al importarse y revienta el render del servidor.
//
// Dentro de un diálogo, Leaflet calcula mal el tamaño mientras el diálogo
// aparece y deja medio mapa gris: por eso `invalidateSize` tras montar.

import { useEffect, useRef } from "react"
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, useMap, useMapEvents } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
})

export interface Punto { latitud: number; longitud: number }

/** Pin del CRM: el color de marca, con sombra, para distinguirlo del punto azul "yo". */
export function iconoPin(color = "#0c6b61", tamano = 34) {
  return L.divIcon({
    className: "",
    html: `<svg width="${tamano}" height="${tamano}" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))">
      <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="12" cy="9" r="2.8" fill="#fff"/></svg>`,
    iconSize: [tamano, tamano],
    iconAnchor: [tamano / 2, tamano - 2],
    popupAnchor: [0, -tamano + 6],
  })
}

/** Bogotá: a donde se mira cuando no hay nada mejor. */
export const CENTRO_POR_DEFECTO: [number, number] = [4.711, -74.0721]

function Controlador({ objetivo, seguir }: { objetivo: Punto | null; seguir: number }) {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 250)
    const t2 = setTimeout(() => map.invalidateSize(), 900)
    const onResize = () => map.invalidateSize()
    window.addEventListener("resize", onResize)
    return () => { clearTimeout(t); clearTimeout(t2); window.removeEventListener("resize", onResize) }
  }, [map])
  // Solo cuando quien usa el mapa lo pide (capturar GPS, elegir una dirección):
  // arrastrar el pin no recentra, porque la mano del usuario ya está ahí.
  useEffect(() => {
    if (objetivo) map.flyTo([objetivo.latitud, objetivo.longitud], Math.max(map.getZoom(), 16), { duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seguir])
  return null
}

function Clics({ onMover }: { onMover?: (p: Punto) => void }) {
  useMapEvents({
    click(e) {
      onMover?.({ latitud: Number(e.latlng.lat.toFixed(7)), longitud: Number(e.latlng.lng.toFixed(7)) })
    },
  })
  return null
}

export function MapaUbicacion({
  valor, actual, onMover, alto = 280, seguir = 0,
}: {
  /** El pin. */
  valor: Punto | null
  /** Dónde está el usuario según el GPS, con su precisión en metros. */
  actual: (Punto & { precision_m: number }) | null
  /** Si no se pasa, el pin no se puede mover (solo se mira). */
  onMover?: (p: Punto) => void
  alto?: number
  /** Cambiar este número recentra el mapa en `valor` (o en `actual`). */
  seguir?: number
}) {
  const objetivo = valor ?? actual ?? null
  const centro: [number, number] = objetivo ? [objetivo.latitud, objetivo.longitud] : CENTRO_POR_DEFECTO
  const icono = useRef(iconoPin())

  return (
    <MapContainer
      center={centro}
      zoom={objetivo ? 16 : 12}
      scrollWheelZoom
      style={{ height: alto, width: "100%", borderRadius: "0.5rem", zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Controlador objetivo={objetivo} seguir={seguir} />
      <Clics onMover={onMover} />

      {actual && (
        <>
          {actual.precision_m > 0 && (
            <Circle center={[actual.latitud, actual.longitud]} radius={actual.precision_m}
              pathOptions={{ color: "#2563eb", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.12 }} />
          )}
          <CircleMarker center={[actual.latitud, actual.longitud]} radius={7}
            pathOptions={{ color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }} />
        </>
      )}

      {valor && (
        <Marker
          position={[valor.latitud, valor.longitud]}
          icon={icono.current}
          draggable={!!onMover}
          eventHandlers={onMover ? {
            dragend(e) {
              const ll = e.target.getLatLng()
              onMover({ latitud: Number(ll.lat.toFixed(7)), longitud: Number(ll.lng.toFixed(7)) })
            },
          } : undefined}
        />
      )}
    </MapContainer>
  )
}

export default MapaUbicacion
