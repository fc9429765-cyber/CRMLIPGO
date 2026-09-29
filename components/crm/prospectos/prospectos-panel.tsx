"use client"

// Registro y listado de prospectos.
//
// El formulario valida DOS VECES: aqui para que el vendedor vea el error al
// instante, y otra vez en la server action. La del navegador es comodidad; la
// que cuenta es la del servidor, porque a una server action se la puede llamar
// sin pasar por esta pantalla.

import { useEffect, useMemo, useState } from "react"
import {
  Loader2, Plus, Search, MapPin, Phone, Mail, Calendar, Trash2, Package, UserPlus } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import {
  getProspectos, getEtapas, crearProspecto,
} from "@/lib/crm-prospectos-actions"
import {
  FUENTES_PROSPECTO, FRECUENCIAS_COMPRA, esGpsConfiable,
  type Etapa, type ProspectoConEtapa, type NuevoProspecto,
} from "@/lib/crm-prospectos"
import { GpsCapture, type Ubicacion } from "./gps-capture"
import { ExpedienteDialog } from "./expediente-dialog"
import { ESTADO_APROBACION_LABEL } from "@/lib/crm-prospectos-aprobacion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { DatePickerField } from "@/components/ui/date-picker-field"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"

interface LineaInteres {
  id: string
  producto_nombre: string
  cantidad: string
  unidad: string
  frecuencia: string
  precio_referencia: string
}

const lineaVacia = (): LineaInteres => ({
  id: crypto.randomUUID(),
  producto_nombre: "",
  cantidad: "",
  unidad: "kg",
  frecuencia: "mensual",
  precio_referencia: "",
})

export function ProspectosPanel() {
  const { profile, selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [prospectos, setProspectos] = useState<ProspectoConEtapa[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState("")
  const [dialogAbierto, setDialogAbierto] = useState(false)
  const [expediente, setExpediente] = useState<number | null>(null)

  const cargar = async () => {
    setCargando(true)
    const [pRes, eRes] = await Promise.all([
      getProspectos(empresaId, { busqueda: busqueda || undefined }),
      getEtapas(empresaId),
    ])
    if (pRes.success) setProspectos(pRes.data ?? [])
    if (eRes.success) setEtapas(eRes.data ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  // Se filtra en memoria mientras se escribe, sin ir al servidor en cada tecla.
  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    if (!t) return prospectos
    return prospectos.filter((p) =>
      [p.razon_social, p.nombre_comercial, p.documento, p.codigo, p.contacto_nombre, p.ciudad]
        .some((c) => c?.toLowerCase().includes(t)),
    )
  }, [prospectos, busqueda])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Prospectos</h1>
            <p className="text-sm text-muted-foreground">{prospectos.length} registrado{prospectos.length === 1 ? "" : "s"}</p>
          </div>
        </div>

        <Dialog open={dialogAbierto} onOpenChange={setDialogAbierto}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8">
              <Plus className="mr-1.5 h-4 w-4" />
              Nuevo prospecto
            </Button>
          </DialogTrigger>
          <FormularioProspecto
            etapas={etapas}
            empresaId={empresaId}
            usuario={profile?.usuario ?? "desconocido"}
            onGuardado={() => {
              setDialogAbierto(false)
              cargar()
            }}
          />
        </Dialog>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, documento o ciudad…"
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
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {busqueda ? "Ningún prospecto coincide con la búsqueda." : "Todavía no hay prospectos registrados."}
            </p>
            {!busqueda && (
              <Button variant="outline" size="sm" onClick={() => setDialogAbierto(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Registrar el primero
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibles.map((p) => (
            <TarjetaProspecto key={p.id} prospecto={p} onAbrir={() => setExpediente(p.id)} />
          ))}
        </div>
      )}

      {expediente !== null && (
        <ExpedienteDialog
          key={expediente}
          prospectoId={expediente}
          empresaId={empresaId}
          modo="vendedor"
          onCerrar={() => setExpediente(null)}
          onCambio={cargar}
        />
      )}
    </div>
  )
}

const TONO_APROBACION: Record<string, string> = {
  pendiente_aprobacion: "border-amber-200 bg-amber-50 text-amber-800",
  aprobado: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rechazado: "border-red-200 bg-red-50 text-red-800",
}

function TarjetaProspecto({ prospecto: p, onAbrir }: { prospecto: ProspectoConEtapa; onAbrir: () => void }) {
  const gpsOk = esGpsConfiable(p.gps_precision_m)
  const estado = p.estado_aprobacion

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onAbrir()}
    >
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{p.razon_social}</p>
            {p.nombre_comercial && (
              <p className="truncate text-xs text-muted-foreground">{p.nombre_comercial}</p>
            )}
          </div>
          {p.etapa && (
            <Badge
              variant="secondary"
              style={p.etapa.color ? { backgroundColor: `${p.etapa.color}22`, color: p.etapa.color } : undefined}
              className="shrink-0"
            >
              {p.etapa.nombre}
            </Badge>
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {p.contacto_nombre && <p className="truncate">{p.contacto_nombre}</p>}
          {p.contacto_celular && (
            <p className="flex items-center gap-1.5">
              <Phone className="h-3 w-3" aria-hidden="true" />
              {p.contacto_celular}
            </p>
          )}
          {p.contacto_email && (
            <p className="flex items-center gap-1.5 truncate">
              <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
              {p.contacto_email}
            </p>
          )}
          {p.ciudad && (
            <p className="flex items-center gap-1.5">
              <MapPin className={`h-3 w-3 ${gpsOk ? "text-[var(--chart-2)]" : ""}`} aria-hidden="true" />
              {p.ciudad}
              {p.latitud != null && (
                <span className="text-[10px]">
                  · GPS {gpsOk ? "confiable" : `±${p.gps_precision_m} m`}
                </span>
              )}
            </p>
          )}
        </div>

        {p.proxima_fecha && (
          <>
            <Separator />
            <p className="flex items-center gap-1.5 text-xs">
              <Calendar className="h-3 w-3 text-[var(--chart-1)]" aria-hidden="true" />
              <span className="font-medium">{p.proxima_accion || "Próximo contacto"}</span>
              <span className="ml-auto text-muted-foreground">{p.proxima_fecha}</span>
            </p>
          </>
        )}

        {estado && estado !== "borrador" && (
          <Badge variant="outline" className={`text-[10px] ${TONO_APROBACION[estado] ?? ""}`}>
            {ESTADO_APROBACION_LABEL[estado]}
          </Badge>
        )}
        {estado === "rechazado" && p.motivo_rechazo && (
          <p className="text-[11px] text-red-700">{p.motivo_rechazo}</p>
        )}

        {p.valor_estimado > 0 && (
          <p className="text-sm font-semibold tabular-nums">
            {p.valor_estimado.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function FormularioProspecto({
  etapas, empresaId, usuario, onGuardado,
}: {
  etapas: Etapa[]
  empresaId: number
  usuario: string
  onGuardado: () => void
}) {
  const [guardando, setGuardando] = useState(false)
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null)
  const [interes, setInteres] = useState<LineaInteres[]>([lineaVacia()])
  const [form, setForm] = useState({
    razon_social: "", nombre_comercial: "", documento: "",
    contacto_nombre: "", contacto_celular: "", contacto_email: "",
    direccion: "", ciudad: "", departamento: "",
    fuente: "", valor_estimado: "",
    proxima_accion: "", proxima_fecha: "",
    observaciones: "",
  })

  const set = (campo: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [campo]: v }))

  const guardar = async () => {
    if (!form.razon_social.trim()) {
      toast({ title: "Falta la razón social", variant: "destructive" })
      return
    }

    setGuardando(true)

    const entrada: NuevoProspecto = {
      razon_social: form.razon_social.trim(),
      nombre_comercial: form.nombre_comercial.trim() || null,
      documento: form.documento.trim() || null,
      contacto_nombre: form.contacto_nombre.trim() || null,
      contacto_celular: form.contacto_celular.trim() || null,
      contacto_email: form.contacto_email.trim() || null,
      direccion: form.direccion.trim() || null,
      ciudad: form.ciudad.trim() || null,
      departamento: form.departamento.trim() || null,
      fuente: form.fuente || null,
      valor_estimado: Number(form.valor_estimado) || 0,
      proxima_accion: form.proxima_accion.trim() || null,
      proxima_fecha: form.proxima_fecha || null,
      observaciones: form.observaciones.trim() || null,
      latitud: ubicacion?.latitud ?? null,
      longitud: ubicacion?.longitud ?? null,
      gps_precision_m: ubicacion?.precision_m ?? null,
      interes: interes
        .filter((l) => l.producto_nombre.trim())
        .map((l) => ({
          producto_id: null,
          producto_nombre: l.producto_nombre.trim(),
          cantidad: Number(l.cantidad) || null,
          unidad: l.unidad || null,
          frecuencia: l.frecuencia || null,
          precio_referencia: Number(l.precio_referencia) || null,
          observacion: null,
        })),
    }

    const res = await crearProspecto(entrada, usuario, empresaId)
    setGuardando(false)

    if (!res.success) {
      toast({ title: "No se guardó", description: res.error, variant: "destructive" })
      return
    }

    toast({
      title: "Prospecto registrado",
      description: `${res.data?.codigo ?? ""} · ${entrada.razon_social}`,
    })
    onGuardado()
  }

  return (
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Nuevo prospecto</DialogTitle>
      </DialogHeader>

      <div className="space-y-5 py-2">
        {/* La ubicación va arriba: se pide el permiso apenas se abre, para que
            el GPS tenga tiempo de fijar mientras se llena el formulario. */}
        <GpsCapture value={ubicacion} onChange={setUbicacion} />

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Identificación</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Razón social *" value={form.razon_social} onChange={set("razon_social")} />
            <Campo label="Nombre comercial" value={form.nombre_comercial} onChange={set("nombre_comercial")} />
            <Campo label="NIT o cédula" value={form.documento} onChange={set("documento")} />
            <div className="space-y-1.5">
              <Label className="text-sm">¿Cómo llegó?</Label>
              <Select value={form.fuente} onValueChange={set("fuente")}>
                <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                <SelectContent>
                  {FUENTES_PROSPECTO.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Contacto</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Persona de contacto" value={form.contacto_nombre} onChange={set("contacto_nombre")} />
            <Campo label="Celular" value={form.contacto_celular} onChange={set("contacto_celular")} />
            <Campo label="Correo" type="email" value={form.contacto_email} onChange={set("contacto_email")} />
            <Campo label="Ciudad" value={form.ciudad} onChange={set("ciudad")} />
            <div className="sm:col-span-2">
              <Campo label="Dirección" value={form.direccion} onChange={set("direccion")} />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <Package className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Qué le interesa comprar
            </h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => setInteres((l) => [...l, lineaVacia()])}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Agregar
            </Button>
          </div>

          {interes.map((linea, i) => (
            <div key={linea.id} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-12 sm:col-span-4">
                <Input
                  placeholder="Producto"
                  value={linea.producto_nombre}
                  onChange={(e) =>
                    setInteres((l) => l.map((x) => (x.id === linea.id ? { ...x, producto_nombre: e.target.value } : x)))
                  }
                />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <Input
                  type="number" placeholder="Cant."
                  value={linea.cantidad}
                  onChange={(e) =>
                    setInteres((l) => l.map((x) => (x.id === linea.id ? { ...x, cantidad: e.target.value } : x)))
                  }
                />
              </div>
              <div className="col-span-4 sm:col-span-3">
                <Select
                  value={linea.frecuencia}
                  onValueChange={(v) =>
                    setInteres((l) => l.map((x) => (x.id === linea.id ? { ...x, frecuencia: v } : x)))
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FRECUENCIAS_COMPRA.map((f) => (
                      <SelectItem key={f.valor} value={f.valor}>{f.etiqueta}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3 sm:col-span-2">
                <Input
                  type="number" placeholder="$ hoy"
                  value={linea.precio_referencia}
                  onChange={(e) =>
                    setInteres((l) => l.map((x) => (x.id === linea.id ? { ...x, precio_referencia: e.target.value } : x)))
                  }
                />
              </div>
              <div className="col-span-1">
                <Button
                  type="button" variant="ghost" size="icon"
                  disabled={interes.length === 1}
                  onClick={() => setInteres((l) => l.filter((x) => x.id !== linea.id))}
                  aria-label="Quitar línea"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            «$ hoy» es lo que paga actualmente a su proveedor: es el dato más útil para armar la propuesta.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Seguimiento</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              label="Valor estimado del negocio" type="number"
              value={form.valor_estimado} onChange={set("valor_estimado")}
            />
            <div className="space-y-1.5">
              <Label className="text-sm">Próximo contacto</Label>
              <DatePickerField value={form.proxima_fecha} onChange={set("proxima_fecha")} />
            </div>
            <div className="sm:col-span-2">
              <Campo
                label="¿Qué hay que hacer?" value={form.proxima_accion}
                onChange={set("proxima_accion")}
                placeholder="Llevar muestra, enviar cotización…"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Observaciones</Label>
            <Textarea
              rows={2} value={form.observaciones}
              onChange={(e) => set("observaciones")(e.target.value)}
            />
          </div>
        </section>
      </div>

      <DialogFooter>
        <Button onClick={guardar} disabled={guardando}>
          {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Guardar prospecto
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function Campo({
  label, value, onChange, type = "text", placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export default ProspectosPanel
