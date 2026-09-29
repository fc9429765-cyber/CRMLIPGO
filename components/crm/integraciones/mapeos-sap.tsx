"use client"

// Mapeos SAP y prueba de conexión (INT-03, INT-06).
//
// Arriba, lo que responde "¿estamos listos para encender SAP?": la prueba de
// conexión y lo que falta mapear para que salga lo que ya está en la bandeja.
// Abajo, la tabla para poner cada código. Mientras SAP esté en disabled o
// mock, nada de esto envía nada: se puede preparar con calma.

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Loader2, PlugZap, Search, Sparkles, TriangleAlert } from "lucide-react"
import {
  aplicarSugeridos, getPendientesMapeo, guardarMapeo, listarMapeos, probarConexionSap, type FilaMapeo, type PendienteMapeo,
} from "@/lib/crm-sap-mapeo-actions"
import { ETIQUETA_ENTIDAD_MAPEO, type EntidadMapeo } from "@/lib/integraciones/sap/traductor"
import { CabeceraTabla, FilaCargando, FilaVacia, MarcoTabla, Td, Th } from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const ENTIDADES: EntidadMapeo[] = ["cliente", "producto", "factura", "centro", "vendedor", "sucursal", "condicion_pago"]

export function MapeosSap({ empresaId }: { empresaId: number }) {
  const [prueba, setPrueba] = useState<{ ok: boolean; ms: number; detalle: string; modo: string } | null>(null)
  const [probando, setProbando] = useState(false)
  const [pend, setPend] = useState<{ eventos: number; listos: number; pendientes: PendienteMapeo[] } | null>(null)
  const [entidad, setEntidad] = useState<EntidadMapeo>("cliente")
  const [texto, setTexto] = useState("")
  const [soloSin, setSoloSin] = useState(false)
  const [datos, setDatos] = useState<{ filas: FilaMapeo[]; total: number; mapeados: number } | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargarPendientes = useCallback(async () => {
    const r = await getPendientesMapeo(empresaId)
    if (r.success && r.data) setPend(r.data)
  }, [empresaId])

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await listarMapeos(entidad, texto, soloSin, empresaId)
    if (r.success && r.data) setDatos(r.data)
    else toast({ title: "No se pudieron cargar los mapeos", description: r.error, variant: "destructive" })
    setCargando(false)
  }, [entidad, texto, soloSin, empresaId])

  useEffect(() => { cargarPendientes() }, [cargarPendientes])
  useEffect(() => {
    const t = setTimeout(cargar, texto ? 350 : 0)
    return () => clearTimeout(t)
  }, [cargar, texto])

  const probar = async () => {
    setProbando(true)
    const r = await probarConexionSap()
    setProbando(false)
    if (r.success && r.data) setPrueba(r.data)
    else toast({ title: "No se pudo probar", description: r.error, variant: "destructive" })
  }

  const guardar = async (f: FilaMapeo, codigo: string) => {
    if ((f.codigoSap ?? "") === codigo.trim()) return
    const r = await guardarMapeo(entidad, f.entidadId, codigo, empresaId)
    if (!r.success) { toast({ title: "No se guardó", description: r.error, variant: "destructive" }); return }
    setDatos((d) => d && { ...d, filas: d.filas.map((x) => (x.entidadId === f.entidadId ? { ...x, codigoSap: codigo.trim() || null } : x)) })
    cargarPendientes()
  }

  const sugeridos = async () => {
    if (entidad !== "producto" && entidad !== "cliente") return
    const r = await aplicarSugeridos(entidad, empresaId)
    if (!r.success) { toast({ title: "No se aplicaron", description: r.error, variant: "destructive" }); return }
    toast({ title: `${r.data?.aplicados ?? 0} códigos sugeridos aplicados`, description: "Revísalos contra SAP antes de encender el flujo." })
    cargar()
    cargarPendientes()
  }

  const def = ETIQUETA_ENTIDAD_MAPEO[entidad]
  const conSugerido = datos?.filas.some((f) => f.sugerido && !f.codigoSap)

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------- ¿listos para SAP? */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Conexión con SAP (Service Layer)</p>
            <Button size="sm" variant="outline" className="h-8" onClick={probar} disabled={probando}>
              {probando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" />}
              Probar conexión
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Inicia sesión y lee un cliente, sin crear nada. Se puede probar con SAP apagado: es lo que hay que confirmar antes de encenderlo.
          </p>
          {prueba && (
            <p className={cn("flex items-start gap-1.5 rounded-md p-2 text-xs", prueba.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>
              {prueba.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{prueba.detalle}{prueba.ms ? ` · ${prueba.ms} ms` : ""} · modo actual: {prueba.modo}</span>
            </p>
          )}
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-semibold">Qué falta para enviar lo que está en la bandeja</p>
          {!pend ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : pend.eventos === 0 ? (
            <p className="text-xs text-muted-foreground">No hay envíos a SAP pendientes.</p>
          ) : (
            <>
              <p className="text-xs">
                {pend.listos} de {pend.eventos} envíos ya tienen todos sus códigos.
              </p>
              {pend.pendientes.length > 0 && (
                <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-red-800">
                  {pend.pendientes.map((p) => (
                    <li key={p.faltante}>• {p.faltante}{p.eventos > 1 ? ` (${p.eventos} envíos)` : ""}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------------- tabla */}
      <SubNav<EntidadMapeo>
        vistas={ENTIDADES.map((e) => ({ valor: e, etiqueta: ETIQUETA_ENTIDAD_MAPEO[e].nombre }))}
        activa={entidad}
        onCambiar={(e) => { setEntidad(e); setTexto(""); setDatos(null) }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" placeholder="Buscar…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={soloSin} onCheckedChange={setSoloSin} /> Solo sin código
        </label>
        {datos && <span className="text-xs text-muted-foreground">{datos.mapeados} de {datos.total} con {def.campoSap}</span>}
        {conSugerido && (
          <Button size="sm" variant="outline" className="ml-auto h-8 text-xs" onClick={sugeridos}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {entidad === "producto" ? "Usar el código de LIPgo en los vacíos" : "Usar prefijo + NIT en los vacíos"}
          </Button>
        )}
      </div>

      <MarcoTabla alto="max-h-[520px]">
        <Table>
          <TableHeader>
            <CabeceraTabla>
              <Th>{def.nombre}</Th>
              <Th>Detalle</Th>
              <Th>{def.campoSap} en SAP</Th>
            </CabeceraTabla>
          </TableHeader>
          <TableBody>
            {cargando && !datos ? <FilaCargando columnas={3} /> : !datos?.filas.length ? (
              <FilaVacia columnas={3} mensaje="No hay filas con este filtro." />
            ) : datos.filas.slice(0, 500).map((f) => (
              <TableRow key={f.entidadId} className="hover:bg-muted/30">
                <Td className="max-w-[260px]"><span className="block truncate font-medium">{f.nombre}</span></Td>
                <Td className="max-w-[300px] text-muted-foreground"><span className="block truncate">{f.detalle ?? "—"}</span></Td>
                <Td>
                  <Input
                    key={`${entidad}-${f.entidadId}-${f.codigoSap ?? ""}`}
                    defaultValue={f.codigoSap ?? ""}
                    placeholder={f.sugerido ? `Sugerido: ${f.sugerido}` : "Sin código"}
                    className={cn("h-7 w-44 font-mono text-xs", !f.codigoSap && "border-dashed")}
                    onBlur={(e) => guardar(f, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                </Td>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </MarcoTabla>
      {datos && datos.filas.length > 500 && (
        <p className="text-xs text-muted-foreground">Se muestran 500 de {datos.filas.length}. Usa el buscador para llegar a los demás.</p>
      )}
    </div>
  )
}

export default MapeosSap
