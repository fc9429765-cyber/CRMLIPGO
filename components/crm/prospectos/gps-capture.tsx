"use client"

// Ubicación de un prospecto, cliente, sucursal o visita: GPS + mapa.
//
// ANTES solo capturaba el GPS y mostraba dos números. AHORA abre un mapa en
// la misma pantalla con el punto azul de "dónde estoy" y un pin que se puede
// arrastrar o poner con un clic, y una búsqueda por dirección para cuando no
// se está en el sitio (registrar un cliente desde la oficina).
//
// DOS DECISIONES QUE SE CONSERVAN:
//
// 1. La ubicación se pide AL ABRIR el formulario, no al guardar: el permiso
//    se pide una sola vez y el GPS tarda en fijar.
//
// 2. Se muestra la PRECISIÓN en metros y se avisa cuando es mala. Una
//    ubicación deducida de la IP tiene la misma forma que una del GPS y sin
//    mirar `accuracy` no se distinguen.
//
// Y UNA NUEVA: un pin puesto a mano NO es evidencia de haber estado ahí. Por
// eso lleva `manual: true`, se muestra como "fijada en el mapa" y las
// pantallas de visitas (actividades, agenda) no permiten moverlo: ahí la
// ubicación es prueba, no dato.

import { useEffect, useState, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { MapPin, Loader2, AlertTriangle, CheckCircle2, LocateFixed, Search, X, Hand } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { GPS_PRECISION_SOSPECHOSA_M, esGpsConfiable } from "@/lib/crm-prospectos"
import { cn } from "@/lib/utils"

// Leaflet toca `window` al importarse: solo en el navegador.
const MapaUbicacion = dynamic(() => import("@/components/crm/mapa/mapa-ubicacion"), {
  ssr: false,
  loading: () => <div className="flex h-[280px] items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando el mapa…</div>,
})

export interface Ubicacion {
  latitud: number
  longitud: number
  precision_m: number
  /** true si el pin se puso o se movió a mano: no es evidencia de presencia. */
  manual?: boolean
}

interface GpsCaptureProps {
  value: Ubicacion | null
  onChange: (u: Ubicacion | null) => void
  /** Pide la ubicacion al montar. Por defecto si. */
  auto?: boolean
  /** Permite mover el pin y buscar por dirección. Falso en visitas (evidencia). */
  permitirManual?: boolean
  titulo?: string
  /** Alto del mapa en px. */
  alto?: number
}

type Estado = "inicial" | "capturando" | "listo" | "error"

interface ResultadoDireccion { lat: string; lon: string; display_name: string }

export function GpsCapture({ value, onChange, auto = true, permitirManual = true, titulo = "Ubicación", alto = 280 }: GpsCaptureProps) {
  const [estado, setEstado] = useState<Estado>(value ? "listo" : "inicial")
  const [mensajeError, setMensajeError] = useState<string | null>(null)
  /** Último fix del GPS: el punto azul. Es distinto del pin (`value`). */
  const [actual, setActual] = useState<(Ubicacion & { precision_m: number }) | null>(null)
  const [seguir, setSeguir] = useState(0)
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ResultadoDireccion[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [direccion, setDireccion] = useState<string | null>(null)
  const ultimaBusqueda = useRef(0)

  const capturar = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setEstado("error")
      setMensajeError("Este dispositivo no permite obtener la ubicación.")
      return
    }
    setEstado("capturando")
    setMensajeError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const u = {
          latitud: Number(pos.coords.latitude.toFixed(7)),
          longitud: Number(pos.coords.longitude.toFixed(7)),
          precision_m: Math.round(pos.coords.accuracy),
        }
        setActual(u)
        onChange(u)
        setSeguir((n) => n + 1)
        setEstado("listo")
      },
      (err) => {
        setEstado("error")
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setMensajeError("Diste permiso denegado. Actívalo en el candado de la barra de direcciones y vuelve a intentar.")
            break
          case err.POSITION_UNAVAILABLE:
            setMensajeError("No se pudo determinar la ubicación. Revisa que el GPS esté encendido.")
            break
          case err.TIMEOUT:
            setMensajeError("La ubicación tardó demasiado. Intenta de nuevo, preferiblemente al aire libre.")
            break
          default:
            setMensajeError("No se pudo obtener la ubicación.")
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  }, [onChange])

  useEffect(() => {
    if (auto && estado === "inicial" && !value) capturar()
    // Solo al montar: reintentar en cada cambio dejaria el componente pidiendo ubicacion en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dirección aproximada del pin (geocodificación inversa de OpenStreetMap).
  // Es orientativa: sirve para confirmar "sí, es esa cuadra".
  useEffect(() => {
    if (!value) { setDireccion(null); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${value.latitud}&lon=${value.longitud}&zoom=18`, { signal: ctrl.signal })
        const j = await r.json()
        setDireccion(j?.display_name ? String(j.display_name).split(",").slice(0, 3).join(",") : null)
      } catch { /* sin red o bloqueado: se muestra solo la coordenada */ }
    }, 700)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [value?.latitud, value?.longitud]) // eslint-disable-line react-hooks/exhaustive-deps

  const buscar = async () => {
    const q = busqueda.trim()
    if (q.length < 4) return
    // Nominatim pide máximo una consulta por segundo.
    const ahora = Date.now()
    if (ahora - ultimaBusqueda.current < 1100) await new Promise((r) => setTimeout(r, 1100 - (ahora - ultimaBusqueda.current)))
    ultimaBusqueda.current = Date.now()
    setBuscando(true)
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=co&limit=5&q=${encodeURIComponent(q)}`)
      const j = (await r.json()) as ResultadoDireccion[]
      setResultados(j)
    } catch {
      setResultados([])
    } finally {
      setBuscando(false)
    }
  }

  const fijarManual = (latitud: number, longitud: number) => {
    onChange({ latitud, longitud, precision_m: 0, manual: true })
    setEstado("listo")
  }

  const elegirResultado = (r: ResultadoDireccion) => {
    fijarManual(Number(Number(r.lat).toFixed(7)), Number(Number(r.lon).toFixed(7)))
    setResultados(null)
    setBusqueda("")
    setSeguir((n) => n + 1)
  }

  const confiable = value && !value.manual ? esGpsConfiable(value.precision_m) : false

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {titulo}
        </span>
        <div className="flex items-center gap-1.5">
          {value && permitirManual && (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => onChange(null)}>
              <X className="mr-1 h-3.5 w-3.5" /> Quitar
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={capturar} disabled={estado === "capturando"}>
            {estado === "capturando" ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Ubicando…</> : <><LocateFixed className="mr-1.5 h-3.5 w-3.5" /> {value ? "Usar mi ubicación" : "Mi ubicación"}</>}
          </Button>
        </div>
      </div>

      {permitirManual && (
        <div className="relative">
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder="Buscar dirección (Calle 80 # 10-20, Bogotá)…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar() } }}
              />
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={buscar} disabled={buscando || busqueda.trim().length < 4}>
              {buscando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Buscar"}
            </Button>
          </div>
          {resultados && (
            <ul className="absolute z-[1000] mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 text-xs shadow-md">
              {resultados.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">Sin resultados. Prueba con la ciudad al final.</li>}
              {resultados.map((r, i) => (
                <li key={i}>
                  <button type="button" className="w-full rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => elegirResultado(r)}>
                    {r.display_name}
                  </button>
                </li>
              ))}
              <li><button type="button" className="w-full rounded px-2 py-1 text-left text-muted-foreground hover:bg-muted" onClick={() => setResultados(null)}>Cerrar</button></li>
            </ul>
          )}
        </div>
      )}

      <MapaUbicacion
        valor={value ? { latitud: value.latitud, longitud: value.longitud } : null}
        actual={actual}
        onMover={permitirManual ? (p) => fijarManual(p.latitud, p.longitud) : undefined}
        alto={alto}
        seguir={seguir}
      />

      {estado === "capturando" && (
        <p className="text-xs text-muted-foreground">Buscando señal. Al aire libre es más rápido y preciso.</p>
      )}

      {value ? (
        <div className={cn("space-y-1 rounded-lg border p-2.5 text-xs", value.manual ? "bg-muted/40" : confiable ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/60")}>
          <div className="flex flex-wrap items-center gap-1.5">
            {value.manual ? <Hand className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              : confiable ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              : <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />}
            <span className="font-medium">{value.manual ? "Fijada en el mapa" : `GPS · ±${value.precision_m} m`}</span>
            <span className="font-mono text-muted-foreground">{value.latitud.toFixed(5)}, {value.longitud.toFixed(5)}</span>
            <a className="ml-auto text-[11px] text-[var(--chart-1)] hover:underline" href={`https://www.google.com/maps/search/?api=1&query=${value.latitud},${value.longitud}`} target="_blank" rel="noreferrer">
              Ver en Google Maps ↗
            </a>
          </div>
          {direccion && <p className="text-muted-foreground">≈ {direccion}</p>}
          {!value.manual && !confiable && (
            <p className="text-amber-800">
              Precisión baja (más de {GPS_PRECISION_SOSPECHOSA_M} m): probablemente viene de la red y no del GPS.
              {permitirManual ? " Arrastra el pin al sitio exacto o vuelve a intentar al aire libre." : " Si estás frente al cliente, intenta actualizar al aire libre."}
            </p>
          )}
          {permitirManual && <p className="text-muted-foreground">Arrastra el pin o toca el mapa para ajustarlo.</p>}
        </div>
      ) : permitirManual ? (
        <p className="text-xs text-muted-foreground">Toca el mapa para poner el pin, busca la dirección o usa tu ubicación.</p>
      ) : null}

      {estado === "error" && mensajeError && (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {mensajeError}
            <span className="mt-1 block text-muted-foreground">
              {permitirManual ? "Puedes poner el pin en el mapa o buscar la dirección." : "Puedes guardar igualmente, pero quedará sin ubicación."}
            </span>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

export default GpsCapture
