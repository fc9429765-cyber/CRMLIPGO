"use client"

// Mi agenda: qué hay que hacer hoy, ordenado por urgencia real.
//
// Lo vencido va PRIMERO. Una visita que debía hacerse ayer y sigue pendiente
// es más urgente que la de esta tarde, y una agenda que las muestra por orden
// cronológico esconde justo lo que hay que atender.

import { useEffect, useState } from "react"
import {
  Loader2, CalendarDays, AlertTriangle, CheckCircle2, Clock, MapPin,
  CalendarClock, XCircle, Plus, Phone, Users, Truck, Wallet,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import {
  getAgendaDelDia, cumplirCita, reprogramarCita, cancelarCita,
  type Cita,
} from "@/lib/crm-agenda-actions"
import { hoyISO, sumarDias, formatearISO } from "@/lib/crm-fechas"
import { GpsCapture, type Ubicacion } from "@/components/crm/prospectos/gps-capture"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { DatePickerField } from "@/components/ui/date-picker-field"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/hooks/use-toast"
import type { LucideIcon } from "lucide-react"
import { AccesosRapidos } from "@/components/crm/ui/accesos-rapidos"

const ICONO_TIPO: Record<string, LucideIcon> = {
  visita: MapPin,
  llamada: Phone,
  reunion: Users,
  entrega: Truck,
  cobro: Wallet,
  otro: CalendarDays,
}

interface Props {
  onNavigate?: (modulo: string) => void
}

export function MiAgenda({ onNavigate }: Props) {
  const { profile, selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [grupos, setGrupos] = useState<{ vencidas: Cita[]; hoy: Cita[]; manana: Cita[]; proximas: Cita[] } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [soloMias, setSoloMias] = useState(true)
  const [cumpliendo, setCumpliendo] = useState<Cita | null>(null)
  const [reprogramando, setReprogramando] = useState<Cita | null>(null)

  const cargar = async () => {
    const res = await getAgendaDelDia(empresaId, soloMias)
    if (res.success && res.data) setGrupos(res.data)
    else toast({ title: "No se pudo cargar", description: res.error, variant: "destructive" })
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, soloMias])

  const cancelar = async (c: Cita) => {
    const res = await cancelarCita(c.id, "Cancelada desde la agenda", empresaId)
    if (!res.success) {
      toast({ title: "No se pudo cancelar", description: res.error, variant: "destructive" })
      return
    }
    toast({ title: "Cita cancelada" })
    cargar()
  }

  if (cargando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const total =
    (grupos?.vencidas.length ?? 0) + (grupos?.hoy.length ?? 0) +
    (grupos?.manana.length ?? 0) + (grupos?.proximas.length ?? 0)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Mi agenda</h1>
            <p className="text-sm text-muted-foreground">{formatearISO(hoyISO())}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="mias" checked={soloMias} onCheckedChange={setSoloMias} />
            <Label htmlFor="mias" className="text-sm">Solo las mías</Label>
          </div>

          <Button variant="outline" size="sm" onClick={() => onNavigate?.("Calendario de Visitas")}>
            <CalendarDays className="mr-1.5 h-4 w-4" />
            Ver calendario
          </Button>
        </div>
      </header>

      {total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 className="h-8 w-8 text-[var(--chart-2)]" />
            <p className="font-medium">Nada pendiente</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              No tienes visitas ni compromisos en los próximos días. Programa el
              seguimiento desde un prospecto.
            </p>
            <Button variant="outline" size="sm" onClick={() => onNavigate?.("Registrar Prospecto")}>
              <Plus className="mr-1.5 h-4 w-4" />
              Ir a prospectos
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {grupos!.vencidas.length > 0 && (
            <Seccion
              titulo="Atrasadas"
              descripcion="Debían hacerse y siguen pendientes"
              icono={AlertTriangle}
              tono="destructive"
              citas={grupos!.vencidas}
              onCumplir={setCumpliendo}
              onReprogramar={setReprogramando}
              onCancelar={cancelar}
            />
          )}

          {grupos!.hoy.length > 0 && (
            <Seccion
              titulo="Hoy"
              icono={Clock}
              tono="primary"
              citas={grupos!.hoy}
              onCumplir={setCumpliendo}
              onReprogramar={setReprogramando}
              onCancelar={cancelar}
            />
          )}

          {grupos!.manana.length > 0 && (
            <Seccion
              titulo="Mañana"
              icono={CalendarClock}
              tono="muted"
              citas={grupos!.manana}
              onCumplir={setCumpliendo}
              onReprogramar={setReprogramando}
              onCancelar={cancelar}
            />
          )}

          {grupos!.proximas.length > 0 && (
            <Seccion
              titulo="Esta semana"
              icono={CalendarDays}
              tono="muted"
              citas={grupos!.proximas}
              onCumplir={setCumpliendo}
              onReprogramar={setReprogramando}
              onCancelar={cancelar}
            />
          )}
        </div>
      )}

      {cumpliendo && (
        <DialogoCumplir
          cita={cumpliendo}
          empresaId={empresaId}
          usuario={profile?.usuario ?? "desconocido"}
          onCerrar={() => setCumpliendo(null)}
          onHecho={() => {
            setCumpliendo(null)
            cargar()
          }}
        />
      )}

      {reprogramando && (
        <DialogoReprogramar
          cita={reprogramando}
          empresaId={empresaId}
          usuario={profile?.usuario ?? "desconocido"}
          onCerrar={() => setReprogramando(null)}
          onHecho={() => {
            setReprogramando(null)
            cargar()
          }}
        />
      )}
    </div>
  )
}

function Seccion({
  titulo, descripcion, icono: Icono, tono, citas, onCumplir, onReprogramar, onCancelar,
}: {
  titulo: string
  descripcion?: string
  icono: LucideIcon
  tono: "destructive" | "primary" | "muted"
  citas: Cita[]
  onCumplir: (c: Cita) => void
  onReprogramar: (c: Cita) => void
  onCancelar: (c: Cita) => void
}) {
  const color =
    tono === "destructive" ? "text-destructive"
      : tono === "primary" ? "text-[var(--chart-1)]"
        : "text-muted-foreground"

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className={`flex items-center gap-1.5 text-sm font-semibold ${color}`}>
          <Icono className="h-4 w-4" aria-hidden="true" />
          {titulo}
        </h2>
        <Badge variant="secondary">{citas.length}</Badge>
        {descripcion && <span className="text-xs text-muted-foreground">{descripcion}</span>}
      </div>

      <div className="space-y-2">
        {citas.map((c) => (
          <TarjetaCita
            key={c.id}
            cita={c}
            urgente={tono === "destructive"}
            onCumplir={() => onCumplir(c)}
            onReprogramar={() => onReprogramar(c)}
            onCancelar={() => onCancelar(c)}
          />
        ))}
      </div>
    </section>
  )
}

function TarjetaCita({
  cita: c, urgente, onCumplir, onReprogramar, onCancelar,
}: {
  cita: Cita
  urgente: boolean
  onCumplir: () => void
  onReprogramar: () => void
  onCancelar: () => void
}) {
  const Icono = ICONO_TIPO[c.tipo] ?? CalendarDays
  const conQuien = c.prospecto_nombre ?? c.cliente_nombre

  return (
    <Card className={urgente ? "border-destructive/40" : undefined}>
      <CardContent className="flex flex-wrap items-start gap-3 p-3.5">
        <span
          className={`mt-0.5 rounded-lg p-2 ${
            urgente ? "bg-destructive/10 text-destructive" : "bg-[var(--chart-1)]/10 text-[var(--chart-1)]"
          }`}
        >
          <Icono className="h-4 w-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium leading-tight">{c.titulo}</p>

          {conQuien && <p className="text-sm text-muted-foreground">{conQuien}</p>}

          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{formatearISO(c.fecha)}</span>
            {c.hora_inicio && <span>· {c.hora_inicio.slice(0, 5)}</span>}
            {c.direccion && (
              <span className="flex items-center gap-0.5 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                {c.direccion}
              </span>
            )}
          </p>

          {c.descripcion && (
            <p className="text-xs text-muted-foreground">{c.descripcion}</p>
          )}
        </div>

        <div className="flex gap-1.5">
          <AccesosRapidos
            variante="menu"
            className="h-8"
            accesos={c.cliente_id ? [
              { cuenta360: c.cliente_id },
              { intencion: { accion: "nueva_venta", clienteId: c.cliente_id } },
              { intencion: { accion: "registrar_pago", clienteId: c.cliente_id } },
              { intencion: { accion: "registrar_actividad", clienteId: c.cliente_id } },
            ] : c.prospecto_id ? [
              { intencion: { accion: "ver_prospecto", prospectoId: c.prospecto_id } },
              { intencion: { accion: "nueva_cotizacion", prospectoId: c.prospecto_id }, etiqueta: "Cotizarle" },
              { intencion: { accion: "registrar_actividad", prospectoId: c.prospecto_id } },
            ] : []}
          />
          <Button size="sm" onClick={onCumplir}>
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            Cumplida
          </Button>
          <Button size="sm" variant="outline" onClick={onReprogramar} aria-label="Reprogramar">
            <CalendarClock className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelar} aria-label="Cancelar">
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DialogoCumplir({
  cita, empresaId, usuario, onCerrar, onHecho,
}: {
  cita: Cita
  empresaId: number
  usuario: string
  onCerrar: () => void
  onHecho: () => void
}) {
  const [notas, setNotas] = useState("")
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null)
  const [guardando, setGuardando] = useState(false)

  const esVisita = cita.tipo === "visita" || cita.tipo === "entrega"

  const guardar = async () => {
    setGuardando(true)
    const res = await cumplirCita(
      cita.id,
      {
        notas: notas.trim() || undefined,
        latitud: ubicacion?.latitud,
        longitud: ubicacion?.longitud,
        precision_m: ubicacion?.precision_m,
      },
      usuario,
      empresaId,
    )
    setGuardando(false)

    if (!res.success) {
      toast({ title: "No se pudo registrar", description: res.error, variant: "destructive" })
      return
    }
    toast({ title: "Cita cumplida", description: "Queda registrada en la bitácora." })
    onHecho()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar cumplimiento</DialogTitle>
          <DialogDescription>
            {cita.titulo}
            {(cita.prospecto_nombre || cita.cliente_nombre) &&
              ` · ${cita.prospecto_nombre ?? cita.cliente_nombre}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-sm">¿Qué pasó?</Label>
            <Textarea
              rows={3}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Qué se habló, qué quedó pendiente…"
            />
          </div>

          {/* GPS solo en visitas: en una llamada no aporta nada. */}
          {esVisita && <GpsCapture value={ubicacion} onChange={setUbicacion} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DialogoReprogramar({
  cita, empresaId, usuario, onCerrar, onHecho,
}: {
  cita: Cita
  empresaId: number
  usuario: string
  onCerrar: () => void
  onHecho: () => void
}) {
  const [fecha, setFecha] = useState(sumarDias(hoyISO(), 1))
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    setGuardando(true)
    const res = await reprogramarCita(cita.id, fecha, motivo.trim() || "Sin motivo", usuario, empresaId)
    setGuardando(false)

    if (!res.success) {
      toast({ title: "No se pudo reprogramar", description: res.error, variant: "destructive" })
      return
    }
    toast({ title: "Reprogramada", description: `Queda para el ${formatearISO(fecha)}` })
    onHecho()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reprogramar</DialogTitle>
          <DialogDescription>{cita.titulo}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-sm">Nueva fecha</Label>
            <DatePickerField value={fecha} onChange={setFecha} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Motivo</Label>
            <Textarea
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="El cliente no estaba, se aplazó…"
            />
          </div>

          <Separator />

          <p className="text-xs text-muted-foreground">
            La cita original queda como reprogramada y se crea una nueva. Así
            se puede ver cuántas veces se ha aplazado una visita.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Reprogramar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default MiAgenda
