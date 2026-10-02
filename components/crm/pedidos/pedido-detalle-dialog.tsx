"use client"

// Detalle de un pedido: qué es, cómo estaba el crédito al enviarlo, quién lo
// tocó y qué se puede hacer con él ahora.
//
// El historial es el "ojito" (PED-24). Tiene que dejar leer de punta a punta
// un pedido rechazado y reenviado (criterio de aceptación 9): quién lo creó,
// quién lo mandó, quién lo frenó y por qué, qué se corrigió, quién lo volvió a
// mandar y quién lo aprobó al final. Por eso cada evento lleva usuario, hora y
// el paso de estado, y no solo un texto suelto.
//
// Las acciones del pie salen de las mismas reglas que aplica el servidor
// (lib/crm-pedidos-estado.ts). La interfaz solo oculta lo que no tiene
// sentido; quien decide sigue siendo el servidor, y su mensaje se muestra tal
// cual si rechaza algo.

import { useCallback, useEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  AlertTriangle, Ban, BadgeCheck, ClipboardList, FilePlus2, History, KeyRound, Loader2, Package, Pencil,
  RotateCcw, Send, ShieldAlert, Truck, XCircle, Wallet, CalendarClock, Scale, CircleDot,
} from "lucide-react"
import {
  getPedido, getHistorialPedido, solicitarAprobacion, anularPedido, enviarPedidoALipgo,
  type EventoPedido,
} from "@/lib/crm-pedidos-actions"
import {
  ESTADO_LABEL, ROL_ETIQUETA, SAP_LABEL, esEditable, puedeSolicitar, puedeAnular,
  type EstadoPedidoV2, type Rol,
} from "@/lib/crm-pedidos-estado"
import { money, type EstadoPedido, type PedidoConDetalle } from "@/lib/crm-pedidos"
import { formatearISO } from "@/lib/crm-fechas"
import { DetalleDialog, FuenteDato } from "@/components/crm/ui/detalle-dialog"
import {
  BadgeEstado, CabeceraTabla, Dato, FilaVacia, MarcoTabla, PieDato, PieResumen, ResumenDatos, Td, Th,
  type TonoEstado,
} from "@/components/crm/ui/modulo"
import { MiniKpi, MiniKpiGrid } from "@/components/crm/ui/mini-kpi"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { ListaEscalonada, ElementoLista } from "@/components/crm/ui/movimiento"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { PedidoEditarDialog } from "./pedido-editar-dialog"
import { AccesosRapidos } from "@/components/crm/ui/accesos-rapidos"
import { EstadoLogisticoPedido } from "@/components/crm/pedidos/estado-logistico"

// ------------------------------------------------------ piezas compartidas
// Viven aquí y no en el panel para que el panel las importe sin crear un
// ciclo (panel → detalle → edición).

/** Tono por estado. Ámbar = espera a alguien; verde = terminó su recorrido. */
export const TONO_ESTADO: Record<EstadoPedido, TonoEstado> = {
  borrador: "neutral",
  pendiente_cartera: "advertencia",
  pendiente_gerencia: "advertencia",
  pendiente_autorizacion: "advertencia",
  autorizado_parcial: "advertencia",
  aprobado: "info",
  autorizado: "info",
  programado_lipgo: "exito",
  enviado_lipgo: "exito",
  rechazado: "peligro",
  anulado: "neutral",
}

export const hayErrorIntegracion = (p: PedidoConDetalle) => !!p.error_lipgo || p.sap_estado === "error"

/**
 * Centros de despacho de LIPgo. Son tres y no cambian; si aparece otro se
 * muestra su id en vez de inventarle nombre.
 */
const CENTRO: Record<number, string> = { 1: "Harinera Indupan", 3: "Cedi Funza", 4: "Cedi Medellín" }
export const nombreCentro = (id: number | null | undefined) => (id ? CENTRO[id] ?? `Centro ${id}` : "—")

const etiquetaEstado = (e: string | null | undefined) =>
  e ? ESTADO_LABEL[e as EstadoPedidoV2] ?? e : "—"

/** Fecha y hora de Bogotá: el servidor corre en UTC y el usuario no. */
export const fechaHora = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("es-CO", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        timeZone: "America/Bogota",
      }).format(new Date(iso))
    : "—"

/** Chips de integración: dónde está el pedido fuera del CRM. */
export function ChipsIntegracion({ pedido: p }: { pedido: PedidoConDetalle }) {
  const sap = p.sap_estado && p.sap_estado !== "no_aplica" ? p.sap_estado : null
  if (!p.idpedido_lipgo && !p.error_lipgo && !sap) return <span className="text-muted-foreground">—</span>
  const chip = "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] font-medium ring-1"
  return (
    <span className="flex flex-wrap gap-1">
      {p.idpedido_lipgo ? (
        <span className={cn(chip, "bg-emerald-50 text-emerald-700 ring-emerald-200")}>
          <Truck className="h-3 w-3" aria-hidden="true" /> LIPgo #{p.idpedido_lipgo}
        </span>
      ) : p.error_lipgo ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(chip, "cursor-help bg-red-50 text-red-700 ring-red-200")}>
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> LIPgo: error
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{p.error_lipgo}</TooltipContent>
        </Tooltip>
      ) : null}
      {sap &&
        (sap === "error" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(chip, "cursor-help bg-red-50 text-red-700 ring-red-200")}>
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {SAP_LABEL[sap]}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{p.sap_error || "SAP rechazó el envío"}</TooltipContent>
          </Tooltip>
        ) : (
          <span
            className={cn(
              chip,
              sap === "enviado" ? "bg-blue-50 text-blue-700 ring-blue-200" : "bg-amber-50 text-amber-700 ring-amber-200",
            )}
          >
            <Send className="h-3 w-3" aria-hidden="true" /> {SAP_LABEL[sap]}
            {sap === "enviado" && p.sap_referencia ? ` ${p.sap_referencia}` : ""}
          </span>
        ))}
    </span>
  )
}

// ------------------------------------------------------------- historial

/** Cómo se pinta cada tipo de evento. El color repite el de los estados. */
const EVENTO: Record<string, { icono: LucideIcon; color: string; titulo: (e: EventoPedido) => string }> = {
  creado: { icono: FilePlus2, color: "bg-slate-100 text-slate-700", titulo: () => "Pedido creado" },
  editado: { icono: Pencil, color: "bg-slate-100 text-slate-700", titulo: () => "Pedido editado" },
  solicitado: { icono: Send, color: "bg-amber-100 text-amber-700", titulo: () => "Enviado a aprobación" },
  reenviado: {
    icono: RotateCcw,
    color: "bg-violet-100 text-violet-700",
    titulo: (e) => `Reenviado a aprobación${e.datos?.version ? ` (versión ${e.datos.version})` : ""}`,
  },
  firmado: {
    icono: BadgeCheck,
    color: "bg-emerald-100 text-emerald-700",
    titulo: (e) => `Aprobado por ${rolDe(e) ?? "un aprobador"}`,
  },
  rechazado: {
    icono: XCircle,
    color: "bg-red-100 text-red-700",
    titulo: (e) => `Rechazado${rolDe(e) ? ` por ${rolDe(e)}` : ""}`,
  },
  anulado: { icono: Ban, color: "bg-slate-200 text-slate-700", titulo: () => "Pedido anulado" },
  programado_lipgo: {
    icono: Truck,
    color: "bg-emerald-100 text-emerald-700",
    titulo: (e) => `Programado en LIPgo${e.datos?.idpedido_lipgo ? ` #${e.datos.idpedido_lipgo}` : ""}`,
  },
  error_lipgo: { icono: AlertTriangle, color: "bg-red-100 text-red-700", titulo: () => "No se pudo programar en LIPgo" },
  clave_incorrecta: {
    icono: KeyRound,
    color: "bg-amber-100 text-amber-800",
    titulo: (e) => `Clave incorrecta${rolDe(e) ? ` de ${rolDe(e)}` : ""}`,
  },
}

function rolDe(e: EventoPedido): string | null {
  const d = e.datos ?? {}
  if (typeof d.rol_etiqueta === "string") return d.rol_etiqueta
  if (typeof d.rol === "string") return ROL_ETIQUETA[d.rol as Rol] ?? d.rol
  return null
}

/** Datos extra que ayudan a leer el evento sin abrir otra pantalla. */
function extrasEvento(e: EventoPedido): string | null {
  const d = e.datos ?? {}
  if (e.tipo === "solicitado" || e.tipo === "reenviado") {
    const partes: string[] = []
    if (d.total != null) partes.push(`Total ${money(Number(d.total))}`)
    if (Number(d.sobrecupo) > 0) partes.push(`sobrecupo ${money(Number(d.sobrecupo))}`)
    if (d.dias_mora != null && Number(d.dias_mora) > 0) partes.push(`${d.dias_mora} días de mora`)
    return partes.join(" · ") || null
  }
  if (e.tipo === "editado") {
    const campos = Array.isArray(d.campos) ? (d.campos as string[]) : []
    const partes: string[] = []
    if (d.lineas != null) partes.push(`${d.lineas} línea(s) de producto`)
    const otros = campos.filter((c) => !["subtotal", "descuento_valor", "iva_pct", "iva_valor", "total", "peso_total", "owner_id"].includes(c))
    if (otros.length) partes.push(`cambió: ${otros.map((c) => c.replace(/_/g, " ")).join(", ")}`)
    return partes.join(" · ") || null
  }
  return null
}

function Historial({ eventos }: { eventos: EventoPedido[] | null }) {
  if (eventos === null) {
    return <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando historial" />
  }
  if (eventos.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">Este pedido todavía no tiene eventos registrados.</p>
  }
  return (
    <ListaEscalonada className="relative">
      {/* La línea vertical une los eventos: se lee como un recorrido, no como
          una lista de avisos sueltos. */}
      <span className="absolute bottom-3 left-[13px] top-3 w-px bg-border" aria-hidden="true" />
      {eventos.map((e) => {
        const def = EVENTO[e.tipo] ?? { icono: CircleDot, color: "bg-muted text-muted-foreground", titulo: () => e.tipo }
        const Icono = def.icono
        const extra = extrasEvento(e)
        const cambiaEstado = e.estado_desde || e.estado_hasta
        return (
          <ElementoLista key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            <span className={cn("relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background", def.color)}>
              <Icono className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-xs font-semibold">{def.titulo(e)}</p>
                <time className="text-[11px] tabular-nums text-muted-foreground" dateTime={e.creado_en}>
                  {fechaHora(e.creado_en)}
                </time>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {e.usuario_nombre ?? "Sistema"}
                {cambiaEstado && (
                  <>
                    {" · "}
                    {etiquetaEstado(e.estado_desde)} → <span className="font-medium text-foreground">{etiquetaEstado(e.estado_hasta)}</span>
                  </>
                )}
              </p>
              {extra && <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{extra}</p>}
              {e.nota && (
                <p
                  className={cn(
                    "mt-1 whitespace-pre-wrap break-words rounded-md border px-2.5 py-1.5 text-xs",
                    e.tipo === "rechazado" || e.tipo === "error_lipgo"
                      ? "border-red-200 bg-red-50/60 text-red-800"
                      : "bg-muted/30",
                  )}
                >
                  {e.nota}
                </p>
              )}
            </div>
          </ElementoLista>
        )
      })}
    </ListaEscalonada>
  )
}

// --------------------------------------------------------------- diálogo

type Pestana = "productos" | "historial"

export function PedidoDetalleDialog({
  pedidoId,
  empresaId,
  onCerrar,
  onCambio,
}: {
  pedidoId: number
  empresaId: number
  onCerrar: () => void
  /** Se llama tras cualquier acción que cambie el pedido, para refrescar la lista. */
  onCambio: () => void
}) {
  const [pedido, setPedido] = useState<PedidoConDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [eventos, setEventos] = useState<EventoPedido[] | null>(null)
  const [pestana, setPestana] = useState<Pestana>("productos")
  const [trabajando, setTrabajando] = useState<null | "solicitar" | "anular" | "lipgo">(null)
  const [editando, setEditando] = useState(false)
  const [anulando, setAnulando] = useState(false)
  const [motivoAnula, setMotivoAnula] = useState("")

  const cargar = useCallback(async () => {
    const [p, h] = await Promise.all([getPedido(pedidoId, empresaId), getHistorialPedido(pedidoId, empresaId)])
    if (p.success && p.data) {
      setPedido(p.data)
      setError(null)
    } else {
      setError(p.error ?? "No se pudo abrir el pedido")
    }
    setEventos(h.success ? h.data ?? [] : [])
  }, [pedidoId, empresaId])

  useEffect(() => {
    cargar()
  }, [cargar])

  const trasCambio = async () => {
    await cargar()
    onCambio()
  }

  const solicitar = async () => {
    if (!pedido) return
    setTrabajando("solicitar")
    const r = await solicitarAprobacion(pedido.id, empresaId)
    setTrabajando(null)
    if (!r.success || !r.data) {
      toast({ title: "No se envió a aprobación", description: r.error, variant: "destructive" })
      return
    }
    const c = r.data.credito
    // El sobrecupo NO frena el pedido (PED-04), pero quien lo envía tiene que
    // saber que Cartera lo va a ver marcado y por cuánto.
    toast(
      c.requiereSobrecupo
        ? {
            title: "Enviado a aprobación con sobrecupo",
            description: `Excede el cupo en ${money(c.sobrecupoValor)}.${c.motivos.length ? ` ${c.motivos.join(". ")}` : ""}`,
          }
        : { title: "Enviado a aprobación", description: "Queda pendiente de Cartera." },
    )
    trasCambio()
  }

  const anular = async () => {
    if (!pedido || !motivoAnula.trim()) return
    setTrabajando("anular")
    const r = await anularPedido(pedido.id, motivoAnula.trim(), empresaId)
    setTrabajando(null)
    if (!r.success) {
      toast({ title: "No se pudo anular", description: r.error, variant: "destructive" })
      return
    }
    setAnulando(false)
    setMotivoAnula("")
    toast({ title: "Pedido anulado" })
    trasCambio()
  }

  const reintentarLipgo = async () => {
    if (!pedido) return
    setTrabajando("lipgo")
    const r = await enviarPedidoALipgo(pedido.id, empresaId)
    setTrabajando(null)
    if (!r.success) {
      // El error queda guardado en el pedido y en el historial: se recarga
      // para que se vea el mensaje nuevo, no el del intento anterior.
      toast({ title: "LIPgo no aceptó el pedido", description: r.error, variant: "destructive" })
    } else {
      toast({ title: "Programado en LIPgo", description: r.data?.mensaje })
    }
    trasCambio()
  }

  const p = pedido
  const aprobado = p?.estado === "aprobado" || p?.estado === "autorizado"
  const puedeReintentar = !!p && aprobado && !!p.error_lipgo && !p.idpedido_lipgo
  const lineas = p?.lineas ?? []
  const sumaImpuesto = lineas.reduce((s, l) => s + (Number(l.impuesto_valor) || 0), 0)

  return (
    <>
      <DetalleDialog
        abierto={!editando}
        onCerrar={onCerrar}
        icono={ClipboardList}
        ancho="tabla"
        titulo={
          p ? (
            <span className="inline-flex items-center gap-2">
              Pedido {p.numero ?? `#${p.id}`}
              {(p.version ?? 1) > 1 && (
                <span className="rounded bg-violet-50 px-1.5 py-px text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
                  v{p.version}
                </span>
              )}
            </span>
          ) : (
            "Pedido"
          )
        }
        subtitulo={p ? <>{p.cliente_nombre ?? `Cliente ${p.cliente_id}`} · {formatearISO(p.fecha)}</> : undefined}
        pie={
          <>
            <Button variant="outline" onClick={onCerrar}>Cerrar</Button>
            {p && puedeAnular(p).ok && (
              <Button
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-50"
                onClick={() => setAnulando(true)}
                disabled={!!trabajando}
              >
                <Ban className="mr-1.5 h-4 w-4" /> Anular
              </Button>
            )}
            {p && esEditable(p.estado) && (
              <Button variant="outline" onClick={() => setEditando(true)} disabled={!!trabajando}>
                <Pencil className="mr-1.5 h-4 w-4" /> Editar
              </Button>
            )}
            {puedeReintentar && (
              <Button onClick={reintentarLipgo} disabled={!!trabajando}>
                {trabajando === "lipgo" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
                Reintentar LIPgo
              </Button>
            )}
            {p && puedeSolicitar(p).ok && (
              <Button onClick={solicitar} disabled={!!trabajando}>
                {trabajando === "solicitar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                {p.estado === "rechazado" ? "Reenviar a aprobación" : "Enviar a aprobación"}
              </Button>
            )}
          </>
        }
      >
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-800">{error}</p>
        ) : !p ? (
          <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-muted-foreground" aria-label="Cargando pedido" />
        ) : (
          <>
            {/* Lo relacionado con este pedido, a un clic y con los datos puestos. */}
            <AccesosRapidos
              accesos={[
                { cuenta360: p.cliente_id, etiqueta: "Cuenta del cliente" },
                p.forma_pago === "credito" && ["aprobado", "programado_lipgo"].includes(p.estado) &&
                  { intencion: { accion: "registrar_pago", clienteId: p.cliente_id } },
                { intencion: { accion: "nueva_venta", clienteId: p.cliente_id }, etiqueta: "Otra venta al cliente" },
                !!p.cotizacion_id && { intencion: { accion: "ver_cotizaciones_cliente", clienteId: p.cliente_id }, etiqueta: "Cotizaciones del cliente" },
                { intencion: { accion: "ver_pedidos_cliente", clienteId: p.cliente_id }, etiqueta: "Pedidos del cliente" },
              ]}
            />
            <EstadoLogisticoPedido idpedidoLipgo={p.idpedido_lipgo} empresaId={empresaId} />
            <ResumenDatos className="md:grid-cols-4 lg:grid-cols-4">
              <Dato etiqueta="Cliente">{p.cliente_nombre}</Dato>
              <Dato etiqueta="Sucursal">{p.sucursal_nombre ?? <span className="text-amber-700">Sin sucursal</span>}</Dato>
              <Dato etiqueta="Owner">{p.owner_nombre}</Dato>
              <Dato etiqueta="Centro de despacho">{nombreCentro(p.idempresa_despacho)}</Dato>
              <Dato etiqueta="Forma de pago">
                {p.forma_pago === "credito" ? `Crédito a ${p.dias_credito} días` : "Contado"}
              </Dato>
              <Dato etiqueta="Vendedor">{p.vendedor_nombre}</Dato>
              <Dato etiqueta="Total" num>{money(p.total)}</Dato>
              <Dato etiqueta="Estado">
                <BadgeEstado tono={TONO_ESTADO[p.estado]}>{ESTADO_LABEL[p.estado]}</BadgeEstado>
              </Dato>
              {p.fecha_programada && <Dato etiqueta="Fecha programada">{formatearISO(p.fecha_programada)}</Dato>}
              {p.orden_compra && <Dato etiqueta="Orden de compra">{p.orden_compra}</Dato>}
              <Dato etiqueta="Integración">
                <ChipsIntegracion pedido={p} />
              </Dato>
            </ResumenDatos>

            {p.estado === "rechazado" && (
              <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-800">
                <p className="flex items-center gap-1.5 font-semibold">
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Rechazado
                  {p.rechazado_nombre ? ` por ${p.rechazado_nombre}` : ""}
                  {p.rechazado_en ? ` · ${fechaHora(p.rechazado_en)}` : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{p.motivo_rechazo || "Sin motivo registrado."}</p>
                <p className="mt-1.5 text-[11px] text-red-700/80">
                  Corrige lo que haga falta con «Editar» y vuelve a enviarlo: saldrá como versión {(p.version ?? 1) + 1}.
                </p>
              </div>
            )}

            {p.error_lipgo && !p.idpedido_lipgo && (
              <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-800">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> No se pudo programar en LIPgo
                </p>
                <p className="mt-0.5 break-words">{p.error_lipgo}</p>
                {aprobado && (
                  <p className="mt-1.5 text-[11px] text-red-700/80">
                    La aprobación sigue en pie. Corrige la causa en LIPgo y pulsa «Reintentar LIPgo».
                  </p>
                )}
              </div>
            )}

            {p.sap_estado === "error" && p.sap_error && (
              <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-800">
                <p className="font-semibold">Error de SAP</p>
                <p className="mt-0.5 break-words">{p.sap_error}</p>
              </div>
            )}

            {/* Foto del crédito al momento de enviar: es lo que vieron Cartera
                y Gerencia al aprobar, aunque la cartera haya cambiado después. */}
            {p.cupo_snapshot != null && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">
                  Crédito al enviar a aprobación{p.solicitado_en ? ` · ${fechaHora(p.solicitado_en)}` : ""}
                  {p.solicitado_nombre ? ` · ${p.solicitado_nombre}` : ""}
                </p>
                <MiniKpiGrid className={p.requiere_sobrecupo ? "sm:grid-cols-5" : undefined}>
                  <MiniKpi etiqueta="Cupo" valor={money(Number(p.cupo_snapshot))} icono={Wallet} />
                  <MiniKpi etiqueta="Saldo" valor={money(Number(p.saldo_snapshot) || 0)} icono={Scale} />
                  <MiniKpi
                    etiqueta="Vencido"
                    valor={money(Number(p.vencido_snapshot) || 0)}
                    icono={AlertTriangle}
                    tono={Number(p.vencido_snapshot) > 0 ? "advertencia" : "neutral"}
                  />
                  <MiniKpi
                    etiqueta="Días de mora"
                    valor={Number(p.dias_mora_snapshot) || 0}
                    icono={CalendarClock}
                    tono={Number(p.dias_mora_snapshot) > 0 ? "advertencia" : "neutral"}
                  />
                  {p.requiere_sobrecupo && (
                    <MiniKpi etiqueta="Sobrecupo" valor={money(Number(p.sobrecupo_valor) || 0)} icono={ShieldAlert} tono="peligro" />
                  )}
                </MiniKpiGrid>
              </div>
            )}

            {(p.auth_contabilidad_en || p.auth_gerencia_en) && (
              <div className="flex flex-wrap gap-2 text-[11px]">
                {[
                  { rol: ROL_ETIQUETA.contabilidad, nombre: p.auth_contabilidad_nombre, en: p.auth_contabilidad_en },
                  { rol: ROL_ETIQUETA.gerencia, nombre: p.auth_gerencia_nombre, en: p.auth_gerencia_en },
                ]
                  .filter((f) => f.en)
                  .map((f) => (
                    <span key={f.rol} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-emerald-800 ring-1 ring-emerald-200">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {f.rol}: {f.nombre ?? "—"} · {fechaHora(f.en)}
                    </span>
                  ))}
              </div>
            )}

            <SubNav<Pestana>
              vistas={[
                { valor: "productos", etiqueta: "Productos", icono: Package, contador: lineas.length },
                { valor: "historial", etiqueta: "Historial", icono: History, contador: eventos?.length },
              ]}
              activa={pestana}
              onCambiar={setPestana}
            />

            {pestana === "productos" ? (
              <div className="space-y-2">
                <MarcoTabla alto="max-h-[360px]">
                  <Table>
                    <TableHeader>
                      <CabeceraTabla>
                        <Th>Producto</Th>
                        <Th align="right">Cantidad</Th>
                        <Th align="right">Precio</Th>
                        <Th align="right">Imp. %</Th>
                        <Th align="right">Subtotal</Th>
                        <Th align="right">Impuesto</Th>
                        <Th align="right">Total</Th>
                      </CabeceraTabla>
                    </TableHeader>
                    <TableBody>
                      {lineas.length === 0 ? (
                        <FilaVacia columnas={7} mensaje="El pedido no tiene productos." />
                      ) : (
                        lineas.map((l) => (
                          <TableRow key={l.id ?? l.linea} className="hover:bg-muted/30">
                            <Td className="max-w-[280px]">
                              <span className="block truncate">{l.producto_nombre}</span>
                              {l.unidad && <span className="text-[10.5px] text-muted-foreground">{l.unidad}</span>}
                            </Td>
                            <Td num>{Number(l.cantidad).toLocaleString("es-CO")}</Td>
                            <Td num>{money(l.precio_unitario)}</Td>
                            <Td num>{l.impuesto_pct != null ? `${Number(l.impuesto_pct).toLocaleString("es-CO")} %` : "—"}</Td>
                            <Td num>{money(l.subtotal)}</Td>
                            <Td num>{money(Number(l.impuesto_valor) || 0)}</Td>
                            <Td num fuerte>{money(l.total_linea)}</Td>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </MarcoTabla>
                {lineas.length > 0 && (
                  <PieResumen>
                    <PieDato etiqueta="Líneas" valor={lineas.length} />
                    <PieDato etiqueta="Subtotal" valor={money(p.subtotal)} />
                    <PieDato etiqueta="Impuesto" valor={money(Number(p.iva_valor) || sumaImpuesto)} />
                    {Number(p.peso_total) > 0 && (
                      <PieDato etiqueta="Peso" valor={`${Number(p.peso_total).toLocaleString("es-CO")} kg`} />
                    )}
                    <PieDato etiqueta="Total" valor={money(p.total)} />
                  </PieResumen>
                )}
                {p.observaciones && (
                  <p className="whitespace-pre-wrap rounded-md border bg-muted/20 p-2.5 text-xs">
                    <span className="font-semibold text-muted-foreground">Observaciones: </span>
                    {p.observaciones}
                  </p>
                )}
              </div>
            ) : (
              <Historial eventos={eventos} />
            )}

            <FuenteDato>
              Fuente: pedido del CRM. El crédito es la foto tomada al enviar a aprobación; el historial registra
              cada paso con su usuario y hora de Bogotá.
            </FuenteDato>
          </>
        )}
      </DetalleDialog>

      {editando && p && (
        <PedidoEditarDialog
          pedido={p}
          empresaId={empresaId}
          onCerrar={() => setEditando(false)}
          onGuardado={async () => {
            setEditando(false)
            await trasCambio()
          }}
        />
      )}

      <AlertDialog open={anulando} onOpenChange={(v) => !v && trabajando !== "anular" && setAnulando(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular el pedido {p?.numero ?? ""}</AlertDialogTitle>
            <AlertDialogDescription>
              Un pedido anulado no se puede recuperar ni volver a enviar. El motivo queda en el historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={motivoAnula}
            onChange={(e) => setMotivoAnula(e.target.value)}
            rows={3}
            className="text-xs"
            placeholder="Por qué se anula (obligatorio)"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trabajando === "anular"}>Cancelar</AlertDialogCancel>
            {/* Botón normal y no AlertDialogAction: la acción cierra el
                diálogo al pulsarla, y si el servidor rechaza la anulación el
                usuario perdería el motivo que escribió. */}
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={anular}
              disabled={trabajando === "anular" || !motivoAnula.trim()}
            >
              {trabajando === "anular" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Anular pedido
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default PedidoDetalleDialog
