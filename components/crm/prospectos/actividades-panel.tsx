"use client"

// Bitacora de gestion comercial: lo que ya se hizo con cada prospecto.
//
// Es HISTORICO: se agrega, no se edita ni se borra. Una bitacora que se puede
// reescribir no sirve para responder "que se le dijo a este cliente y cuando".
//
// La visita captura GPS igual que el registro del prospecto, y por el mismo
// motivo: sin coordenada y sin precision, "visita realizada" es solo una
// afirmacion.

import { useEffect, useMemo, useState } from "react"
import {
  Loader2, Plus, Phone, Mail, MessageSquare, Users, FileText, MapPin, Search, ClipboardList } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getActividades, registrarActividad, getProspectos } from "@/lib/crm-prospectos-actions"
import {
  TIPOS_ACTIVIDAD, RESULTADOS_ACTIVIDAD, esGpsConfiable,
  type Actividad, type TipoActividad, type ProspectoConEtapa,
} from "@/lib/crm-prospectos"
import { GpsCapture, type Ubicacion } from "./gps-capture"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { getClientesCrm } from "@/lib/crm-catalogos-actions"
import type { ClienteCrm } from "@/lib/crm-catalogos"
import { useIntencion } from "@/lib/crm-navegacion"

const ICONO: Record<TipoActividad, typeof Phone> = {
  llamada: Phone,
  visita: MapPin,
  correo: Mail,
  whatsapp: MessageSquare,
  reunion: Users,
  nota: FileText,
}

export function ActividadesPanel() {
  const { profile, selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [actividades, setActividades] = useState<Actividad[]>([])
  const [prospectos, setProspectos] = useState<ProspectoConEtapa[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState("")
  const [dialogAbierto, setDialogAbierto] = useState(false)
  const [clientes, setClientes] = useState<ClienteCrm[]>([])
  // Llegando desde un cliente o un prospecto: el formulario ya lo trae elegido.
  const [inicial, setInicial] = useState<{ clienteId?: number; prospectoId?: number } | undefined>(undefined)
  useIntencion(["registrar_actividad"], (i) => {
    setInicial({ clienteId: i.clienteId, prospectoId: i.prospectoId })
    setDialogAbierto(true)
  })

  const cargar = async () => {
    const [aRes, pRes, cRes] = await Promise.all([
      getActividades(empresaId, { limite: 200 }),
      getProspectos(empresaId),
      getClientesCrm(empresaId),
    ])
    if (aRes.success) setActividades(aRes.data ?? [])
    if (pRes.success) setProspectos(pRes.data ?? [])
    if (cRes.success) setClientes(cRes.data ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  // Nombre del prospecto por id, para no repetir la búsqueda en cada fila.
  const nombrePorId = useMemo(
    () => new Map(prospectos.map((p) => [p.id, p.razon_social])),
    [prospectos],
  )
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c.nombre])), [clientes])

  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    if (!t) return actividades
    return actividades.filter((a) =>
      [a.asunto, a.detalle, a.usuario, a.prospecto_id ? nombrePorId.get(a.prospecto_id) : "", a.cliente_id ? clientePorId.get(a.cliente_id) : ""]
        .some((c) => c?.toLowerCase().includes(t)),
    )
  }, [actividades, busqueda, nombrePorId, clientePorId])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Actividades</h1>
            <p className="text-sm text-muted-foreground">Todo lo que se ha hecho con cada prospecto y cliente, en orden</p>
          </div>
        </div>

        <Dialog open={dialogAbierto} onOpenChange={(v) => { setDialogAbierto(v); if (!v) setInicial(undefined) }}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8">
              <Plus className="mr-1.5 h-4 w-4" />
              Registrar actividad
            </Button>
          </DialogTrigger>
          <FormularioActividad
            key={`${inicial?.clienteId ?? ""}-${inicial?.prospectoId ?? ""}`}
            prospectos={prospectos}
            clientes={clientes}
            inicial={inicial}
            empresaId={empresaId}
            usuario={profile?.usuario ?? "desconocido"}
            onGuardado={() => {
              setDialogAbierto(false)
              setInicial(undefined)
              cargar()
            }}
          />
        </Dialog>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar en la bitácora…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9"
        />
      </div>

      {cargando ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visibles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {busqueda ? "Nada coincide con la búsqueda." : "Todavía no hay actividades registradas."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibles.map((a) => {
            const Icono = ICONO[a.tipo as TipoActividad] ?? FileText
            const gpsOk = esGpsConfiable(a.gps_precision_m)

            return (
              <Card key={a.id}>
                <CardContent className="flex gap-3 p-3.5">
                  <span className="mt-0.5 h-fit rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
                    <Icono className="h-4 w-4" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{a.asunto}</span>
                      {a.resultado && (
                        <Badge variant="outline" className="text-[10px]">
                          {RESULTADOS_ACTIVIDAD.find((r) => r.valor === a.resultado)?.etiqueta ?? a.resultado}
                        </Badge>
                      )}
                      {a.latitud != null && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${gpsOk ? "border-[var(--chart-2)] text-[var(--chart-2)]" : ""}`}
                        >
                          <MapPin className="mr-0.5 h-2.5 w-2.5" />
                          {gpsOk ? "En sitio" : `±${a.gps_precision_m} m`}
                        </Badge>
                      )}
                    </div>

                    {a.prospecto_id && nombrePorId.has(a.prospecto_id) && (
                      <p className="text-xs font-medium text-muted-foreground">
                        {nombrePorId.get(a.prospecto_id)}
                      </p>
                    )}
                    {a.cliente_id && clientePorId.has(a.cliente_id) && (
                      <p className="text-xs font-medium text-muted-foreground">
                        Cliente: {clientePorId.get(a.cliente_id)}
                      </p>
                    )}

                    {a.detalle && <p className="text-xs text-muted-foreground">{a.detalle}</p>}

                    <p className="text-[11px] text-muted-foreground/80">
                      {new Date(a.fecha_hora).toLocaleString("es-CO", {
                        timeZone: "America/Bogota",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {a.usuario && ` · ${a.usuario}`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FormularioActividad({
  prospectos, clientes, inicial, empresaId, usuario, onGuardado,
}: {
  prospectos: ProspectoConEtapa[]
  clientes: ClienteCrm[]
  inicial?: { clienteId?: number; prospectoId?: number }
  empresaId: number
  usuario: string
  onGuardado: () => void
}) {
  const [guardando, setGuardando] = useState(false)
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null)
  // Con un prospecto (embudo) o con un cliente (seguimiento, visita de cobro).
  const [para, setPara] = useState<"prospecto" | "cliente">(inicial?.clienteId ? "cliente" : "prospecto")
  const [form, setForm] = useState({
    prospecto_id: inicial?.prospectoId ? String(inicial.prospectoId) : "",
    cliente_id: inicial?.clienteId ? String(inicial.clienteId) : "",
    tipo: "visita" as TipoActividad,
    asunto: "",
    detalle: "",
    resultado: "exitoso",
    duracion_min: "",
  })

  const esVisita = form.tipo === "visita"

  const guardar = async () => {
    if (para === "prospecto" ? !form.prospecto_id : !form.cliente_id) {
      toast({ title: para === "prospecto" ? "Elige el prospecto" : "Elige el cliente", variant: "destructive" })
      return
    }
    if (!form.asunto.trim()) {
      toast({ title: "Falta el asunto", variant: "destructive" })
      return
    }

    setGuardando(true)
    const res = await registrarActividad(
      {
        prospecto_id: para === "prospecto" ? Number(form.prospecto_id) : null,
        cliente_id: para === "cliente" ? Number(form.cliente_id) : null,
        idempresa: empresaId,
        tipo: form.tipo,
        asunto: form.asunto.trim(),
        detalle: form.detalle.trim() || null,
        resultado: form.resultado || null,
        fecha_hora: new Date().toISOString(),
        duracion_min: Number(form.duracion_min) || null,
        latitud: ubicacion?.latitud ?? null,
        longitud: ubicacion?.longitud ?? null,
        gps_precision_m: ubicacion?.precision_m ?? null,
        vendedor_id: null,
        usuario,
        adjunto_url: null,
      },
      empresaId,
    )
    setGuardando(false)

    if (!res.success) {
      toast({ title: "No se guardó", description: res.error, variant: "destructive" })
      return
    }

    toast({ title: "Actividad registrada" })
    onGuardado()
  }

  return (
    <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Registrar actividad</DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-sm">{para === "prospecto" ? "Prospecto" : "Cliente"} *</Label>
            <div className="flex gap-1">
              {(["prospecto", "cliente"] as const).map((t) => (
                <Button key={t} type="button" size="sm" variant={para === t ? "default" : "outline"} className="h-6 px-2 text-[11px]" onClick={() => setPara(t)}>
                  {t === "prospecto" ? "Prospecto" : "Cliente"}
                </Button>
              ))}
            </div>
          </div>
          {para === "prospecto" ? (
            <Select value={form.prospecto_id} onValueChange={(v) => setForm((f) => ({ ...f, prospecto_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
              <SelectContent>
                {prospectos.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.razon_social}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select value={form.cliente_id} onValueChange={(v) => setForm((f) => ({ ...f, cliente_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
              <SelectContent>
                {clientes.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Tipo</Label>
            <Select
              value={form.tipo}
              onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as TipoActividad }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_ACTIVIDAD.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>{t.etiqueta}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Resultado</Label>
            <Select
              value={form.resultado}
              onValueChange={(v) => setForm((f) => ({ ...f, resultado: v }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESULTADOS_ACTIVIDAD.map((r) => (
                  <SelectItem key={r.valor} value={r.valor}>{r.etiqueta}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Asunto *</Label>
          <Input
            value={form.asunto}
            placeholder="Presentación de productos, seguimiento de cotización…"
            onChange={(e) => setForm((f) => ({ ...f, asunto: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Detalle</Label>
          <Textarea
            rows={3}
            value={form.detalle}
            placeholder="Qué se habló, qué quedó pendiente…"
            onChange={(e) => setForm((f) => ({ ...f, detalle: e.target.value }))}
          />
        </div>

        {/* El GPS solo aparece en visitas: en una llamada no aporta nada y
            pedir permiso de ubicación sin motivo erosiona la confianza. */}
        {esVisita && <GpsCapture value={ubicacion} onChange={setUbicacion} permitirManual={false} titulo="Ubicación de la visita" alto={220} />}
      </div>

      <DialogFooter>
        <Button onClick={guardar} disabled={guardando}>
          {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export default ActividadesPanel
