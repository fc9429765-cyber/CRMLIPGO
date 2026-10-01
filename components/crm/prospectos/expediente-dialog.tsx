"use client"

// Expediente del prospecto: documentos, enlace de carga, envío a Cartera y,
// para Cartera, la aprobación que lo vuelve cliente (PRO-01..PRO-05).
//
// Una sola pantalla para los dos lados, como el detalle del recaudo: el
// vendedor y Cartera miran el mismo expediente, con lo que cada uno puede
// hacer. Lo que falta para poder enviarlo se dice arriba y con nombre: un
// botón deshabilitado sin explicación obliga a adivinar.

import { useCallback, useEffect, useState } from "react"
import {
  AlertTriangle, Camera, CheckCircle, Copy, Eye, FileCheck2, FileUp, FileX2, FolderOpen, History, Link2, Loader2,
  MessageCircle, Send, Trash2, UserCheck, XCircle,
} from "lucide-react"
import {
  aprobarProspecto, crearEnlaceCarga, eliminarDocumentoProspecto, getExpediente, getHistorialProspecto, getUrlDocumento,
  rechazarProspecto, revisarDocumento, revocarEnlaceCarga, solicitarAprobacionProspecto, subirDocumentoProspecto,
  type EventoProspecto, type Expediente,
} from "@/lib/crm-prospectos-aprobacion-actions"
import { actualizarProspecto } from "@/lib/crm-prospectos-actions"
import { getListas } from "@/lib/crm-precios-actions"
import { getVendedoresCrm } from "@/lib/crm-catalogos-actions"
import { listarMaestro } from "@/lib/crm-maestros-actions"
import { ESTADO_APROBACION_LABEL, type DocumentoExpediente, type EstadoAprobacionProspecto } from "@/lib/crm-prospectos-aprobacion"
import { prepararArchivo, TIPOS_ACEPTADOS } from "@/lib/archivo-cliente"
import { DetalleDialog, FuenteDato } from "@/components/crm/ui/detalle-dialog"
import { BadgeEstado, Dato, ResumenDatos, type TonoEstado } from "@/components/crm/ui/modulo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { AccesosRapidos } from "@/components/crm/ui/accesos-rapidos"

const pesos = (n: number | null | undefined) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO")
const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"
const soloDigitos = (t: string) => t.replace(/\D/g, "")

const TONO_ESTADO: Record<EstadoAprobacionProspecto, TonoEstado> = {
  borrador: "neutral", pendiente_aprobacion: "advertencia", aprobado: "exito", rechazado: "peligro",
}
const TONO_DOC: Record<DocumentoExpediente["estado"], [TonoEstado, string]> = {
  pendiente: ["neutral", "Por revisar"], aprobado: ["exito", "Válido"], rechazado: ["peligro", "Rechazado"],
}

export function ExpedienteDialog({
  prospectoId, empresaId, modo, onCerrar, onCambio,
}: {
  prospectoId: number
  empresaId: number
  /** "cartera" muestra la revisión de documentos y la aprobación. */
  modo: "vendedor" | "cartera"
  onCerrar: () => void
  onCambio?: () => void
}) {
  const [exp, setExp] = useState<Expediente | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historial, setHistorial] = useState<EventoProspecto[] | null>(null)

  const cargar = useCallback(async () => {
    const [r, h] = await Promise.all([getExpediente(prospectoId, empresaId), getHistorialProspecto(prospectoId, empresaId)])
    if (!r.success || !r.data) { setError(r.error ?? "No encontrado"); return }
    setExp(r.data)
    setHistorial(h.success ? h.data ?? [] : [])
  }, [prospectoId, empresaId])

  useEffect(() => { cargar() }, [cargar])

  const cambiado = async () => {
    await cargar()
    onCambio?.()
  }

  const p = exp?.prospecto
  return (
    <DetalleDialog
      abierto
      onCerrar={onCerrar}
      icono={FolderOpen}
      ancho="tabla"
      titulo={p ? p.razon_social : "Expediente"}
      subtitulo={p ? [p.codigo, p.documento ? `NIT ${p.documento}` : "Sin NIT", p.ciudad].filter(Boolean).join(" · ") : undefined}
    >
      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : !exp || !p ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* Antes de ser cliente: cotizarle y dejar constancia del contacto.
              Ya cliente: su cuenta y venderle. */}
          {modo === "vendedor" && (
            <AccesosRapidos
              accesos={p.cliente_id ? [
                { cuenta360: p.cliente_id, etiqueta: "Cuenta del cliente" },
                { intencion: { accion: "nueva_venta", clienteId: p.cliente_id }, etiqueta: "Primera venta" },
              ] : [
                { intencion: { accion: "nueva_cotizacion", prospectoId: p.id }, etiqueta: "Cotizarle" },
                { intencion: { accion: "registrar_actividad", prospectoId: p.id } },
              ]}
            />
          )}
          {modo === "cartera" && p.cliente_id && (
            <AccesosRapidos accesos={[{ cuenta360: p.cliente_id, etiqueta: "Cuenta del cliente creado" }]} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <BadgeEstado tono={TONO_ESTADO[p.estado_aprobacion]}>{ESTADO_APROBACION_LABEL[p.estado_aprobacion]}</BadgeEstado>
            {(p.version ?? 1) > 1 && <span className="text-[11px] text-muted-foreground">Reenvío v{p.version}</span>}
            {p.sap_estado !== "no_aplica" && <BadgeEstado tono="proceso" className="text-[10px]">SAP {p.sap_estado}</BadgeEstado>}
          </div>

          {p.estado_aprobacion === "rechazado" && p.motivo_rechazo && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
              <span className="font-semibold">Rechazado por {p.rechazado_nombre ?? "Cartera"}:</span> {p.motivo_rechazo}
              {modo === "vendedor" && <p className="mt-1">Corrige lo indicado y vuelve a enviarlo.</p>}
            </div>
          )}
          {p.estado_aprobacion === "aprobado" && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
              <span className="font-semibold">Cliente #{p.cliente_id}</span> creado en LIPgo
              {p.sucursal_id ? ` con la sucursal #${p.sucursal_id}` : ""} · aprobado por {p.aprobado_nombre} el {fechaHora(p.aprobado_en)}.
              Sus documentos quedaron en la carpeta del cliente.
            </div>
          )}
          {exp.clientesMismoNit.length > 0 && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                Ese NIT ya existe en LIPgo: {exp.clientesMismoNit.map((c) => `${c.nombre} (#${c.id})`).join(", ")}.
                {modo === "cartera" ? " Al aprobar, elige si se vincula a uno de ellos." : " Cartera decidirá si se vincula al existente."}
              </div>
            </div>
          )}

          <DatosProspecto exp={exp} empresaId={empresaId} onGuardado={cambiado} />
          <Checklist exp={exp} empresaId={empresaId} modo={modo} onCambio={cambiado} />
          {modo === "vendedor" && exp.puedeEditar && <EnlaceCarga exp={exp} empresaId={empresaId} onCambio={cambiado} />}
          {modo === "vendedor" && exp.puedeEditar && <EnviarACartera exp={exp} empresaId={empresaId} onEnviado={cambiado} />}
          {p.estado_aprobacion !== "borrador" && p.solicitado_en && (
            <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
              <p>
                <span className="font-semibold">Solicitud:</span> cupo {pesos(p.cupo_solicitado)} a {p.dias_credito_solicitado ?? 0} días ·
                enviada por {p.solicitado_nombre} el {fechaHora(p.solicitado_en)}
              </p>
              {p.solicitud_nota && <p className="mt-0.5 italic text-muted-foreground">“{p.solicitud_nota}”</p>}
            </div>
          )}
          {modo === "cartera" && exp.puedeAprobar && p.estado_aprobacion === "pendiente_aprobacion" && (
            <DecisionCartera exp={exp} empresaId={empresaId} onDecidido={cambiado} />
          )}

          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><History className="h-3.5 w-3.5" /> Historial</p>
            {historial === null ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : historial.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin eventos.</p>
            ) : (
              <ol className="space-y-1.5 border-l pl-3">
                {historial.map((e) => (
                  <li key={e.id} className="text-xs">
                    <span className="font-medium">{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}</span>
                    <span className="text-muted-foreground"> · {e.usuario_nombre ?? "—"} · {fechaHora(e.creado_en)}</span>
                    {e.nota && <p className="text-muted-foreground">{e.nota}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <FuenteDato>Los documentos se guardan en almacenamiento privado y se abren con enlaces que caducan.</FuenteDato>
        </>
      )}
    </DetalleDialog>
  )
}

const ETIQUETA_EVENTO: Record<string, string> = {
  documento_subido: "Documento subido", documento_eliminado: "Documento eliminado",
  documento_aprobado: "Documento validado", documento_rechazado: "Documento rechazado", documento_pendiente: "Documento por revisar",
  enlace_creado: "Enlace de carga generado", enlace_revocado: "Enlace de carga anulado",
  enviado_a_cartera: "Enviado a Cartera", reenviado: "Corregido y reenviado", aprobado: "Aprobado", rechazado: "Rechazado",
}

// ------------------------------------------------------------------- datos

function DatosProspecto({ exp, empresaId, onGuardado }: { exp: Expediente; empresaId: number; onGuardado: () => void }) {
  const p = exp.prospecto
  const faltan = exp.evaluacion.datosFaltantes
  const [editando, setEditando] = useState(false)
  const [v, setV] = useState({
    documento: p.documento ?? "", direccion: p.direccion ?? "", ciudad: p.ciudad ?? "", departamento: p.departamento ?? "",
    contacto_nombre: p.contacto_nombre ?? "", contacto_celular: p.contacto_celular ?? "", contacto_email: p.contacto_email ?? "",
  })
  const [guardando, setGuardando] = useState(false)
  const guardar = async () => {
    setGuardando(true)
    const r = await actualizarProspecto(p.id, v as never, empresaId)
    setGuardando(false)
    if (!r.success) { toast({ title: "No se guardó", description: r.error, variant: "destructive" }); return }
    setEditando(false)
    onGuardado()
  }

  if (editando) {
    const campo = (k: keyof typeof v, et: string) => (
      <div className="space-y-1">
        <Label className="text-xs">{et}</Label>
        <Input className="h-8 text-xs" value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />
      </div>
    )
    return (
      <div className="space-y-2 rounded-md border p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {campo("documento", "NIT o documento (con o sin DV)")}
          {campo("direccion", "Dirección de entrega")}
          {campo("ciudad", "Ciudad")}
          {campo("departamento", "Departamento")}
          {campo("contacto_nombre", "Contacto")}
          {campo("contacto_celular", "Celular")}
          {campo("contacto_email", "Correo")}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditando(false)}>Cancelar</Button>
          <Button size="sm" className="h-8" onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Guardar
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <ResumenDatos className="md:grid-cols-3 lg:grid-cols-3">
        <Dato etiqueta="NIT / documento">{p.documento}</Dato>
        <Dato etiqueta="Dirección">{p.direccion}</Dato>
        <Dato etiqueta="Ciudad">{[p.ciudad, p.departamento].filter(Boolean).join(", ") || null}</Dato>
        <Dato etiqueta="Contacto">{p.contacto_nombre}</Dato>
        <Dato etiqueta="Celular">{p.contacto_celular ?? p.contacto_telefono}</Dato>
        <Dato etiqueta="Correo">{p.contacto_email}</Dato>
      </ResumenDatos>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {faltan.length > 0 ? <p className="text-xs text-red-700">Faltan datos: {faltan.join(", ")}.</p> : <span />}
        {exp.puedeEditar && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditando(true)}>Completar datos</Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- checklist

function Checklist({ exp, empresaId, modo, onCambio }: { exp: Expediente; empresaId: number; modo: "vendedor" | "cartera"; onCambio: () => void }) {
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [revisando, setRevisando] = useState<number | null>(null)
  const [notaRechazo, setNotaRechazo] = useState("")
  const revisa = modo === "cartera" && exp.puedeAprobar && exp.prospecto.estado_aprobacion === "pendiente_aprobacion"

  const subir = async (codigo: string, original: File | null) => {
    if (!original) return
    const prep = await prepararArchivo(original)
    if ("error" in prep) { toast({ title: "No se puede subir", description: prep.error, variant: "destructive" }); return }
    setSubiendo(codigo)
    const fd = new FormData()
    fd.append("prospecto_id", String(exp.prospecto.id))
    fd.append("tipo_codigo", codigo)
    fd.append("archivo", prep.archivo)
    const r = await subirDocumentoProspecto(fd, empresaId)
    setSubiendo(null)
    if (!r.success) { toast({ title: "No se subió", description: r.error, variant: "destructive" }); return }
    onCambio()
  }

  const ver = async (id: number) => {
    const ventana = window.open("", "_blank")
    const r = await getUrlDocumento(id, empresaId)
    if (!r.success || !r.data) { ventana?.close(); toast({ title: "No se pudo abrir", description: r.error, variant: "destructive" }); return }
    if (ventana) ventana.location.href = r.data.url
  }
  const borrar = async (id: number) => {
    const r = await eliminarDocumentoProspecto(id, empresaId)
    if (!r.success) { toast({ title: "No se borró", description: r.error, variant: "destructive" }); return }
    onCambio()
  }
  const marcar = async (id: number, estado: "aprobado" | "rechazado") => {
    const r = await revisarDocumento(id, estado, estado === "rechazado" ? notaRechazo : null, empresaId)
    if (!r.success) { toast({ title: "No se guardó", description: r.error, variant: "destructive" }); return }
    setRevisando(null)
    setNotaRechazo("")
    onCambio()
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground">Documentos</p>
      {exp.evaluacion.checklist.length === 0 && (
        <p className="text-xs text-muted-foreground">No hay tipos de documento configurados (Maestros → Tipos de documento).</p>
      )}
      <ul className="divide-y rounded-md border">
        {exp.evaluacion.checklist.map((item) => (
          <li key={item.tipo.id} className="space-y-1.5 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {item.cumplido
                    ? <CheckCircle className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />
                    : <XCircle className={cn("mr-1 inline h-3.5 w-3.5", item.tipo.obligatorio ? "text-red-500" : "text-muted-foreground/50")} />}
                  {item.tipo.nombre}
                  {item.tipo.obligatorio ? <span className="ml-1 text-red-600">*</span> : <span className="ml-1 text-[11px] font-normal text-muted-foreground">(opcional)</span>}
                </p>
                {item.tipo.ayuda && <p className="text-[11px] text-muted-foreground">{item.tipo.ayuda}</p>}
              </div>
              {exp.puedeEditar && modo === "vendedor" && (
                <div className="flex gap-1.5">
                  <label className={cn("inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted", subiendo && "pointer-events-none opacity-50")}>
                    <Camera className="h-3.5 w-3.5" /> Foto
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={(e) => { subir(item.tipo.codigo, e.target.files?.[0] ?? null); e.target.value = "" }} />
                  </label>
                  <label className={cn("inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted", subiendo && "pointer-events-none opacity-50")}>
                    {subiendo === item.tipo.codigo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} Archivo
                    <input type="file" accept={TIPOS_ACEPTADOS} className="hidden"
                      onChange={(e) => { subir(item.tipo.codigo, e.target.files?.[0] ?? null); e.target.value = "" }} />
                  </label>
                </div>
              )}
            </div>
            {item.documentos.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 rounded bg-muted/30 px-2 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate">{d.nombre_archivo ?? "archivo"}</span>
                <span className="text-muted-foreground">{d.subido_nombre} · {fechaHora(d.subido_en)}</span>
                <BadgeEstado tono={TONO_DOC[d.estado][0]} className="text-[10px]">{TONO_DOC[d.estado][1]}</BadgeEstado>
                <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => ver(d.id)} title="Ver"><Eye className="h-3.5 w-3.5" /></Button>
                {exp.puedeEditar && modo === "vendedor" && d.estado !== "aprobado" && (
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground" onClick={() => borrar(d.id)} title="Borrar"><Trash2 className="h-3.5 w-3.5" /></Button>
                )}
                {revisa && (
                  <>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-emerald-700" onClick={() => marcar(d.id, "aprobado")} title="Válido"><FileCheck2 className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-red-700" onClick={() => setRevisando(revisando === d.id ? null : d.id)} title="Rechazar"><FileX2 className="h-3.5 w-3.5" /></Button>
                  </>
                )}
                {d.nota && <p className="w-full text-[11px] text-red-700">{d.nota}</p>}
                {revisando === d.id && (
                  <div className="flex w-full gap-1.5">
                    <Input className="h-7 text-xs" placeholder="Qué tiene mal (ej. vencido, ilegible)" value={notaRechazo} onChange={(e) => setNotaRechazo(e.target.value)} />
                    <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={!notaRechazo.trim()} onClick={() => marcar(d.id, "rechazado")}>Rechazar</Button>
                  </div>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ----------------------------------------------------------- enlace de carga

function EnlaceCarga({ exp, empresaId, onCambio }: { exp: Expediente; empresaId: number; onCambio: () => void }) {
  const [enlace, setEnlace] = useState<{ url: string; celular: string | null; vence: string } | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const p = exp.prospecto
  const generar = async () => {
    setTrabajando(true)
    const r = await crearEnlaceCarga(p.id, empresaId)
    setTrabajando(false)
    if (!r.success || !r.data) { toast({ title: "No se generó el enlace", description: r.error, variant: "destructive" }); return }
    setEnlace({ url: `${window.location.origin}/carga/${r.data.token}`, celular: r.data.celular, vence: r.data.vence })
    onCambio()
  }
  const revocar = async () => {
    await revocarEnlaceCarga(p.id, empresaId)
    setEnlace(null)
    onCambio()
  }
  const vence = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long" })
  const mensaje = enlace
    ? `Hola${p.contacto_nombre ? ` ${p.contacto_nombre.split(" ")[0]}` : ""}, para crear su cuenta como cliente por favor suba aquí sus documentos (RUT, cámara de comercio, cédula del representante): ${enlace.url}\nEl enlace funciona hasta el ${vence(enlace.vence)}.`
    : ""

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold"><Link2 className="h-3.5 w-3.5" /> Que el cliente suba sus documentos</p>
          <p className="text-[11px] text-muted-foreground">
            {exp.enlaceActivo && !enlace
              ? `Hay un enlace activo hasta el ${vence(p.enlace_vence!)}. Genera uno nuevo para volver a enviarlo (el anterior deja de servir).`
              : "Envíale un enlace: los documentos llegan directo a este expediente."}
          </p>
        </div>
        <div className="flex gap-1.5">
          {exp.enlaceActivo && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={revocar}>Anular enlace</Button>}
          <Button variant="outline" size="sm" className="h-8" onClick={generar} disabled={trabajando}>
            {trabajando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
            {exp.enlaceActivo ? "Nuevo enlace" : "Generar enlace"}
          </Button>
        </div>
      </div>
      {enlace && (
        <div className="flex flex-wrap items-center gap-2">
          <Input readOnly className="h-8 flex-1 text-xs" value={enlace.url} onFocus={(e) => e.target.select()} />
          <Button size="sm" variant="ghost" className="h-8" onClick={() => navigator.clipboard.writeText(mensaje).then(() => toast({ title: "Mensaje copiado" }))}>
            <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
          </Button>
          <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" asChild>
            <a href={`https://wa.me/${enlace.celular ?? ""}?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer">
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> WhatsApp
            </a>
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------- envio a cartera

function EnviarACartera({ exp, empresaId, onEnviado }: { exp: Expediente; empresaId: number; onEnviado: () => void }) {
  const p = exp.prospecto
  const [cupo, setCupo] = useState(p.cupo_solicitado ? String(Math.round(p.cupo_solicitado)) : "")
  const [dias, setDias] = useState(p.dias_credito_solicitado != null ? String(p.dias_credito_solicitado) : "30")
  const [nota, setNota] = useState("")
  const [enviando, setEnviando] = useState(false)
  const faltan = [...exp.evaluacion.datosFaltantes, ...exp.evaluacion.documentosFaltantes]
  const enviar = async () => {
    setEnviando(true)
    const r = await solicitarAprobacionProspecto(p.id, { cupo: Number(cupo) || 0, dias: Number(dias) || 0, nota }, empresaId)
    setEnviando(false)
    if (!r.success) { toast({ title: "No se envió", description: r.error, variant: "destructive" }); return }
    toast({ title: "Enviado a Cartera", description: "Te avisaremos cuando lo revisen." })
    onEnviado()
  }
  return (
    <div className="space-y-2 rounded-md border border-[var(--chart-1)]/30 bg-[var(--chart-1)]/5 p-3">
      <p className="text-xs font-semibold">Enviar a Cartera para crearlo como cliente</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Cupo solicitado</Label>
          <Input inputMode="numeric" className="h-8 text-right text-xs tabular-nums" value={cupo ? Number(cupo).toLocaleString("es-CO") : ""}
            onChange={(e) => setCupo(soloDigitos(e.target.value))} placeholder="0 = contado" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Días de crédito</Label>
          <Input inputMode="numeric" className="h-8 text-xs" value={dias} onChange={(e) => setDias(soloDigitos(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nota para Cartera</Label>
          <Input className="h-8 text-xs" value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-xs", faltan.length ? "text-red-700" : "text-emerald-700")}>
          {faltan.length ? `Falta: ${faltan.join(", ")}` : "Expediente completo"}
        </p>
        <Button size="sm" className="h-8" onClick={enviar} disabled={enviando || faltan.length > 0}>
          {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
          {p.estado_aprobacion === "rechazado" ? "Reenviar a Cartera" : "Enviar a Cartera"}
        </Button>
      </div>
    </div>
  )
}

// --------------------------------------------------------- decision de cartera

function DecisionCartera({ exp, empresaId, onDecidido }: { exp: Expediente; empresaId: number; onDecidido: () => void }) {
  const p = exp.prospecto
  const [cupo, setCupo] = useState(String(Math.round(Number(p.cupo_solicitado) || 0)))
  const [dias, setDias] = useState(String(p.dias_credito_solicitado ?? 0))
  const [lista, setLista] = useState<string>("")
  const [vendedor, setVendedor] = useState<string>(p.vendedor_id ? String(p.vendedor_id) : "")
  const [vincular, setVincular] = useState<string>("")
  const [dups, setDups] = useState(exp.clientesMismoNit)
  const [nota, setNota] = useState("")
  const [rechazando, setRechazando] = useState(false)
  const [motivoId, setMotivoId] = useState("")
  const [trabajando, setTrabajando] = useState(false)
  const [listas, setListas] = useState<{ id: number; nombre: string }[]>([])
  const [vendedores, setVendedores] = useState<{ id: number; nombre: string }[]>([])
  const [motivos, setMotivos] = useState<{ id: number; nombre: string; exige_nota: boolean }[]>([])

  useEffect(() => {
    getListas(empresaId).then((r) => r.success && setListas((r.data ?? []).map((l) => ({ id: l.id, nombre: l.nombre }))))
    getVendedoresCrm(empresaId).then((r) => r.success && setVendedores((r.data ?? []).filter((v) => v.activo).map((v) => ({ id: v.idvendedor, nombre: v.nombre }))))
    listarMaestro("motivos", empresaId).then((r) => r.success && setMotivos((r.data ?? [])
      .filter((m) => m.tipo === "rechazo_prospecto" && m.activo !== false)
      .map((m) => ({ id: m.id, nombre: String(m.nombre), exige_nota: m.exige_nota === true }))))
  }, [empresaId])

  if (exp.esSolicitante) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
        Tú enviaste este prospecto a Cartera: la aprobación debe darla otra persona.
      </p>
    )
  }

  const aprobar = async () => {
    setTrabajando(true)
    const r = await aprobarProspecto(p.id, {
      cupo: Number(cupo) || 0, dias: Number(dias) || 0, listaPrecioId: lista ? Number(lista) : null,
      vendedorId: vendedor ? Number(vendedor) : null, vincularClienteId: vincular && vincular !== "nuevo" ? Number(vincular) : null, nota,
    }, empresaId)
    setTrabajando(false)
    if (!r.success) {
      if (r.clientesMismoNit?.length) setDups(r.clientesMismoNit)
      toast({ title: "No se aprobó", description: r.error, variant: "destructive" })
      return
    }
    toast({
      title: r.data?.creado ? `Cliente #${r.data.clienteId} creado en LIPgo` : `Vinculado al cliente #${r.data?.clienteId}`,
      description: r.data?.sucursalId ? `Con la sucursal #${r.data.sucursalId}` : undefined,
    })
    onDecidido()
  }
  const motivo = motivos.find((m) => String(m.id) === motivoId)
  const rechazar = async () => {
    setTrabajando(true)
    const r = await rechazarProspecto(p.id, motivo ? motivo.id : null, nota, empresaId)
    setTrabajando(false)
    if (!r.success) { toast({ title: "No se rechazó", description: r.error, variant: "destructive" }); return }
    toast({ title: "Prospecto rechazado", description: "El vendedor puede corregirlo y reenviarlo." })
    onDecidido()
  }
  const faltaVincular = dups.length > 0 && !vincular

  return (
    <div className="space-y-3 rounded-md border border-[var(--chart-1)]/30 bg-[var(--chart-1)]/5 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold"><UserCheck className="h-4 w-4" /> Decisión de Cartera</p>
      {!rechazando ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Cupo aprobado</Label>
              <Input inputMode="numeric" className="h-8 text-right text-xs tabular-nums" value={Number(cupo || 0).toLocaleString("es-CO")} onChange={(e) => setCupo(soloDigitos(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Días de crédito</Label>
              <Input inputMode="numeric" className="h-8 text-xs" value={dias} onChange={(e) => setDias(soloDigitos(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Lista de precios</Label>
              <Select value={lista} onValueChange={setLista}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin lista (precio base)" /></SelectTrigger>
                <SelectContent>{listas.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Vendedor asignado</Label>
              <Select value={vendedor} onValueChange={setVendedor}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Elige…" /></SelectTrigger>
                <SelectContent>{vendedores.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {dups.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">El NIT ya existe en LIPgo: ¿qué hacer?</Label>
              <Select value={vincular} onValueChange={setVincular}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Elige el cliente existente" /></SelectTrigger>
                <SelectContent>
                  {dups.map((c) => <SelectItem key={c.id} value={String(c.id)}>Vincular a {c.nombre} (#{c.id})</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                No se crea un cliente repetido: se actualizan cupo, plazo y lista del existente y los documentos pasan a su carpeta.
              </p>
            </div>
          )}
          <Textarea rows={2} className="text-xs" placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" className="h-8 border-red-200 text-red-700 hover:bg-red-50" onClick={() => { setRechazando(true); setNota("") }}>
              <XCircle className="mr-1.5 h-3.5 w-3.5" /> Rechazar
            </Button>
            <Button size="sm" className="h-8" onClick={aprobar} disabled={trabajando || faltaVincular || exp.evaluacion.documentosFaltantes.length > 0}>
              {trabajando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-1.5 h-3.5 w-3.5" />}
              {dups.length ? "Aprobar y vincular" : "Aprobar y crear cliente en LIPgo"}
            </Button>
          </div>
          {exp.evaluacion.documentosFaltantes.length > 0 && (
            <p className="text-right text-[11px] text-red-700">Faltan documentos válidos: {exp.evaluacion.documentosFaltantes.join(", ")}. Recházalo para que el vendedor los complete.</p>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <Select value={motivoId} onValueChange={setMotivoId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Motivo" /></SelectTrigger>
            <SelectContent>{motivos.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nombre}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea rows={2} className="text-xs" placeholder="Qué debe corregir el vendedor" value={nota} onChange={(e) => setNota(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setRechazando(false)}>Cancelar</Button>
            <Button variant="destructive" size="sm" className="h-8" onClick={rechazar}
              disabled={trabajando || !(motivo ? !motivo.exige_nota || nota.trim() : nota.trim())}>
              {trabajando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Rechazar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ExpedienteDialog
