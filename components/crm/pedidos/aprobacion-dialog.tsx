"use client"

// Diálogo de aprobación de un pedido (PED-19, PED-20, PED-04).
//
// Todo lo que quien aprueba necesita para decidir está en una sola pantalla,
// en el orden en que lo mira: primero si el pedido rompe el cupo, luego cómo
// estaba la cartera del cliente al enviarlo frente a cómo está HOY, luego qué
// se pide, y al final la decisión. Si tuviera que abrir la cuenta del cliente
// en otra pestaña para comparar, en la práctica no compararía.

import { useEffect, useState } from "react"
import {
  AlertTriangle, CheckCircle, ChevronDown, History, Loader2, ShieldAlert, ShieldCheck, XCircle,
} from "lucide-react"
import { autorizarPedido, rechazarPedido, getHistorialPedido, type EventoPedido } from "@/lib/crm-pedidos-actions"
import { getCuenta360, type Cuenta360 } from "@/lib/crm-cuenta-actions"
import { ROL_ETIQUETA, type ModoAprobacion, type Rol } from "@/lib/crm-pedidos-estado"
import { money, type PedidoConDetalle } from "@/lib/crm-pedidos"
import { formatearISO } from "@/lib/crm-fechas"
import { DetalleDialog, FuenteDato } from "@/components/crm/ui/detalle-dialog"
import {
  BadgeEstado, CabeceraTabla, Dato, FilaVacia, MarcoTabla, PieDato, PieResumen, ResumenDatos, Td, Th, filaTabla,
} from "@/components/crm/ui/modulo"
import { MiniKpi, MiniKpiGrid } from "@/components/crm/ui/mini-kpi"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { AccesosRapidos } from "@/components/crm/ui/accesos-rapidos"

export interface MotivoRechazo {
  id: number
  nombre: string
  exige_nota: boolean
}

/** Fecha y hora en Colombia. Las marcas de tiempo llegan en UTC. */
export const fechaHora = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("es-CO", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota",
      }).format(new Date(iso))
    : "—"

const num = (v: unknown) => (v == null || v === "" ? null : Number(v))

// Valor centinela del selector: Radix no admite un ítem con valor vacío.
const SIN_MOTIVO = "ninguno"

export function AprobacionDialog({
  pedido: p, rol, modo, motivos, empresaId, onCerrar, onHecho,
}: {
  pedido: PedidoConDetalle
  /** Rol con el que se decide: el de la vista activa de la bandeja. */
  rol: Rol
  modo: ModoAprobacion
  motivos: MotivoRechazo[]
  empresaId: number
  onCerrar: () => void
  /** Tras aprobar o rechazar: la bandeja se recarga. */
  onHecho: () => void
}) {
  const [decision, setDecision] = useState<"aprobar" | "rechazar">("aprobar")
  // La clave vive solo mientras el diálogo está abierto: el panel lo monta de
  // nuevo por pedido, así que no queda cargada para el siguiente sin pedirla.
  const [clave, setClave] = useState("")
  const [nota, setNota] = useState("")
  const [motivoId, setMotivoId] = useState<string>(SIN_MOTIVO)
  const [trabajando, setTrabajando] = useState(false)

  const [cuenta, setCuenta] = useState<Cuenta360 | null>(null)
  const [errorCuenta, setErrorCuenta] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getCuenta360(p.cliente_id, empresaId).then((r) => {
      if (!vivo) return
      if (r.success && r.data) setCuenta(r.data)
      else setErrorCuenta(r.error ?? "No se pudo leer la cartera actual")
    })
    return () => { vivo = false }
  }, [p.cliente_id, empresaId])

  const motivo = motivos.find((m) => String(m.id) === motivoId) ?? null
  // Sin motivo del maestro, la nota ES el motivo; con uno que exige
  // explicación, también es obligatoria. El servidor valida lo mismo.
  const notaObligatoria = decision === "rechazar" && (!motivo || motivo.exige_nota)

  const puedeEnviar =
    decision === "aprobar" ? !!clave : !notaObligatoria || !!nota.trim()

  const aprobar = async () => {
    if (!clave || trabajando) return
    setTrabajando(true)
    const r = await autorizarPedido(p.id, rol, clave, nota.trim() || undefined, empresaId)
    setTrabajando(false)
    if (!r.success) {
      // El error del servidor va tal cual: "Clave incorrecta", "Primero debe
      // aprobar Cartera", "las dos deben ser de personas distintas"… Reescribirlo
      // aquí solo añadiría una traducción que se desactualiza.
      toast({ title: "No se pudo aprobar", description: r.error, variant: "destructive" })
      setClave("")
      return
    }
    const lipgo = r.data?.lipgo
    if (lipgo && !lipgo.ok) {
      // Aprobado SÍ quedó: lo que falló es la programación. Se dice en ámbar y
      // no en rojo para que nadie vuelva a aprobarlo creyendo que no pasó.
      toast({
        title: "Aprobado, pero no se pudo programar en LIPgo",
        description: `${lipgo.mensaje}. El pedido queda aprobado; se reintenta desde Pedidos.`,
        className: "border-amber-300 bg-amber-50 text-amber-900",
        duration: 15000,
      })
    } else if (lipgo) {
      toast({ title: p.numero ? `Pedido ${p.numero} aprobado` : "Pedido aprobado", description: lipgo.mensaje })
    } else {
      const otro: Rol = rol === "contabilidad" ? "gerencia" : "contabilidad"
      toast({
        title: `Aprobado como ${ROL_ETIQUETA[rol]}`,
        description: `Falta la aprobación de ${ROL_ETIQUETA[otro]}.`,
      })
    }
    onHecho()
  }

  const rechazar = async () => {
    if (trabajando || (notaObligatoria && !nota.trim())) return
    setTrabajando(true)
    const r = await rechazarPedido(p.id, rol, nota.trim(), empresaId, motivo?.id ?? null)
    setTrabajando(false)
    if (!r.success) {
      toast({ title: "No se pudo rechazar", description: r.error, variant: "destructive" })
      return
    }
    toast({ title: p.numero ? `Pedido ${p.numero} rechazado` : "Pedido rechazado", description: "Vuelve al vendedor con el motivo." })
    onHecho()
  }

  const sobrecupo = !!p.requiere_sobrecupo

  return (
    <DetalleDialog
      abierto
      onCerrar={onCerrar}
      icono={CheckCircle}
      ancho="tabla"
      titulo={
        <span className="flex items-center gap-2">
          {p.numero ?? `Pedido ${p.id}`}
          {(p.version ?? 1) > 1 && <BadgeEstado tono="proceso">Reenvío v{p.version}</BadgeEstado>}
        </span>
      }
      subtitulo={`${p.cliente_nombre ?? "—"} · Aprobando como ${ROL_ETIQUETA[rol]}`}
      pie={
        <>
          <Button variant="ghost" onClick={onCerrar} disabled={trabajando}>Cerrar</Button>
          {decision === "aprobar" ? (
            <Button onClick={aprobar} disabled={!puedeEnviar || trabajando}>
              {trabajando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1.5 h-4 w-4" />}
              Aprobar como {ROL_ETIQUETA[rol]}
            </Button>
          ) : (
            <Button variant="destructive" onClick={rechazar} disabled={!puedeEnviar || trabajando}>
              {trabajando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
              Rechazar pedido
            </Button>
          )}
        </>
      }
    >
      <AccesosRapidos
        accesos={[
          { cuenta360: p.cliente_id, etiqueta: "Cuenta completa del cliente" },
          { intencion: { accion: "ver_pedidos_cliente", clienteId: p.cliente_id }, etiqueta: "Sus otros pedidos" },
        ]}
      />

      {/* PED-04: el sobrecupo es lo primero que debe ver quien aprueba. */}
      {sobrecupo && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="text-xs">
            <p className="font-semibold">
              Este pedido excede el cupo del cliente en {money(Number(p.sobrecupo_valor) || 0)}
            </p>
            <p>Aprobarlo es autorizar el sobrecupo.</p>
          </div>
        </div>
      )}

      <ResumenDatos className="lg:grid-cols-4">
        <Dato etiqueta="Cliente">{p.cliente_nombre}</Dato>
        <Dato etiqueta="Sucursal">{p.sucursal_nombre}</Dato>
        <Dato etiqueta="Vendedor">{p.vendedor_nombre}</Dato>
        <Dato etiqueta="Owner">{p.owner_nombre}</Dato>
        <Dato etiqueta="Total" num>{money(p.total)}</Dato>
        <Dato etiqueta="Forma de pago">
          {p.forma_pago === "credito" ? `Crédito ${p.dias_credito} días` : "Contado"}
        </Dato>
        <Dato etiqueta="Entrega programada">{formatearISO(p.fecha_programada) || "—"}</Dato>
        <Dato etiqueta="Solicitado">
          {p.solicitado_nombre ?? p.creado_por ?? "—"} · {fechaHora(p.solicitado_en ?? p.creado_en)}
        </Dato>
      </ResumenDatos>

      {p.auth_contabilidad_en && (
        <FirmaPrevia rol="contabilidad" nombre={p.auth_contabilidad_nombre} en={p.auth_contabilidad_en} nota={p.auth_contabilidad_nota} />
      )}
      {p.auth_gerencia_en && (
        <FirmaPrevia rol="gerencia" nombre={p.auth_gerencia_nombre} en={p.auth_gerencia_en} nota={p.auth_gerencia_nota} />
      )}

      <BloqueCredito pedido={p} cuenta={cuenta} error={errorCuenta} />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Líneas</h3>
        <MarcoTabla alto="max-h-[320px]">
          <Table>
            <TableHeader>
              <CabeceraTabla>
                <Th>Producto</Th>
                <Th align="right">Cant.</Th>
                <Th align="right">Lista</Th>
                <Th align="right">Precio</Th>
                <Th align="right">Dcto.</Th>
                <Th align="right">Subtotal</Th>
              </CabeceraTabla>
            </TableHeader>
            <TableBody>
              {(p.lineas ?? []).length === 0 ? (
                <FilaVacia columnas={6} mensaje="El pedido no tiene líneas." />
              ) : (
                (p.lineas ?? []).map((l) => {
                  const lista = num(l.precio_lista)
                  // Un precio por debajo de lista es justo lo que quien aprueba
                  // debe poder ver sin hacer la resta de cabeza.
                  const bajoLista = lista != null && Number(l.precio_unitario) < lista
                  return (
                    <TableRow key={l.linea} className={filaTabla}>
                      <Td className="max-w-[260px] truncate">{l.producto_nombre}</Td>
                      <Td num>
                        {Number(l.cantidad).toLocaleString("es-CO")}
                        {l.unidad && <span className="ml-1 text-muted-foreground">{l.unidad}</span>}
                      </Td>
                      <Td num className="text-muted-foreground">{lista != null ? money(lista) : "—"}</Td>
                      <Td num className={cn(bajoLista && "text-amber-700")}>{money(l.precio_unitario)}</Td>
                      <Td num>{Number(l.descuento_pct) > 0 ? `${Number(l.descuento_pct)}%` : "—"}</Td>
                      <Td num fuerte>{money(l.subtotal)}</Td>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </MarcoTabla>
        <PieResumen>
          <PieDato etiqueta="Líneas" valor={(p.lineas ?? []).length} />
          <PieDato etiqueta="Subtotal" valor={money(p.subtotal)} />
          <PieDato etiqueta="IVA" valor={money(p.iva_valor)} />
          <PieDato etiqueta="Total" valor={money(p.total)} />
        </PieResumen>
        {p.observaciones && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs">
            <span className="font-medium text-muted-foreground">Observaciones: </span>
            {p.observaciones}
          </p>
        )}
      </section>

      <Historial pedidoId={p.id} empresaId={empresaId} />

      {/* Decisión */}
      <section className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Decisión como {ROL_ETIQUETA[rol]}</h3>
          <div role="radiogroup" aria-label="Decisión" className="inline-flex rounded-md border p-0.5">
            {(["aprobar", "rechazar"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={decision === d}
                onClick={() => setDecision(d)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition-colors",
                  decision === d
                    ? d === "aprobar" ? "bg-emerald-600 text-white" : "bg-destructive text-white"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {d === "aprobar" ? "Aprobar" : "Rechazar"}
              </button>
            ))}
          </div>
        </div>

        {decision === "aprobar" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="clave-rol" className="text-xs">Clave de {ROL_ETIQUETA[rol]}</Label>
              <Input
                id="clave-rol"
                type="password"
                autoComplete="off"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && clave && aprobar()}
                className="h-8 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                La clave es del área, pero queda registrado que fuiste tú quien aprobó.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nota-aprobar" className="text-xs">Nota (opcional)</Label>
              <Textarea
                id="nota-aprobar"
                rows={2}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder={modo === "secuencial" && rol === "contabilidad" ? "Lo verá Gerencia al aprobar…" : "Queda en el historial…"}
                className="text-xs"
              />
            </div>
          </div>
        ) : (
          // Rechazar NO pide clave, a propósito: frenar algo dudoso debe ser
          // más fácil que aprobarlo. Una clave aquí solo haría que, ante la
          // duda, alguien lo dejara pasar para no ir a buscarla.
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo</Label>
              <Select value={motivoId} onValueChange={setMotivoId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Elige un motivo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_MOTIVO} className="text-xs">Otro (explicar en la nota)</SelectItem>
                  {motivos.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)} className="text-xs">{m.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Con motivo del maestro, los informes pueden agrupar por qué se rechaza.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nota-rechazo" className="text-xs">
                Explicación{notaObligatoria ? " *" : " (opcional)"}
              </Label>
              <Textarea
                id="nota-rechazo"
                rows={3}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Qué debe corregir el vendedor…"
                className="text-xs"
              />
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                Lo verá quien envió el pedido; podrá corregirlo y reenviarlo.
              </p>
            </div>
          </div>
        )}
      </section>
    </DetalleDialog>
  )
}

/** La aprobación que ya dio el otro rol, con su nota: es contexto para esta. */
function FirmaPrevia({
  rol, nombre, en, nota,
}: { rol: Rol; nombre: string | null; en: string; nota: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p>
          <span className="font-semibold">Aprobado por {ROL_ETIQUETA[rol]}:</span> {nombre ?? "—"} · {fechaHora(en)}
        </p>
        {nota && <p className="mt-0.5 italic">“{nota}”</p>}
      </div>
    </div>
  )
}

/**
 * Cartera al enviar frente a cartera hoy.
 *
 * El snapshot es lo que vio el sistema cuando el vendedor pidió aprobación;
 * entre eso y este momento pueden pasar días. Si en ese tiempo el cliente dejó
 * vencer facturas, quien aprueba tiene que enterarse aquí, no después.
 */
function BloqueCredito({
  pedido: p, cuenta, error,
}: { pedido: PedidoConDetalle; cuenta: Cuenta360 | null; error: string | null }) {
  const snap = {
    cupo: num(p.cupo_snapshot),
    saldo: num(p.saldo_snapshot),
    vencido: num(p.vencido_snapshot),
    mora: num(p.dias_mora_snapshot),
  }
  const hoy = cuenta?.cuenta

  // `peorSi`: en qué dirección el cambio es mala noticia.
  const filas: { etiqueta: string; antes: number | null; ahora: number | null; peorSi: "sube" | "baja"; dias?: boolean }[] = [
    { etiqueta: "Cupo", antes: snap.cupo, ahora: hoy?.cupo ?? null, peorSi: "baja" },
    { etiqueta: "Saldo", antes: snap.saldo, ahora: hoy?.saldo ?? null, peorSi: "sube" },
    { etiqueta: "Vencido", antes: snap.vencido, ahora: hoy?.vencido ?? null, peorSi: "sube" },
    { etiqueta: "Días de mora", antes: snap.mora, ahora: hoy?.diasMora ?? null, peorSi: "sube", dias: true },
  ]
  const empeoro = (f: (typeof filas)[number]) =>
    f.antes != null && f.ahora != null &&
    (f.peorSi === "sube" ? f.ahora > f.antes : f.ahora < f.antes)
  const hayEmpeoro = filas.some(empeoro)
  const fmt = (v: number | null, dias?: boolean) =>
    v == null ? "—" : dias ? `${v.toLocaleString("es-CO")} d` : money(v)

  const disponibleHoy = hoy ? hoy.disponible : null
  const trasPedido = disponibleHoy != null ? disponibleHoy - Number(p.total) : null

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Crédito del cliente</h3>
        <div className="flex flex-wrap gap-1.5">
          {cuenta?.cliente.bloqueado_cartera && <BadgeEstado tono="peligro" icono={ShieldAlert}>Bloqueado por cartera</BadgeEstado>}
          {hayEmpeoro && <BadgeEstado tono="peligro" icono={AlertTriangle}>Empeoró desde el envío</BadgeEstado>}
        </div>
      </div>

      {hoy && (
        <MiniKpiGrid>
          <MiniKpi etiqueta="Total del pedido" valor={money(p.total)} />
          <MiniKpi etiqueta="Disponible hoy" valor={money(hoy.disponible)} tono={hoy.disponible < 0 ? "peligro" : "neutral"} />
          <MiniKpi
            etiqueta="Queda tras el pedido"
            valor={money(trasPedido ?? 0)}
            tono={(trasPedido ?? 0) < 0 ? "peligro" : "exito"}
          />
          <MiniKpi etiqueta="Vencido hoy" valor={money(hoy.vencido)} tono={hoy.vencido > 0 ? "advertencia" : "neutral"} />
        </MiniKpiGrid>
      )}

      <MarcoTabla alto="none">
        <Table>
          <TableHeader>
            <CabeceraTabla>
              <Th>Concepto</Th>
              <Th align="right">Al enviar{p.solicitado_en ? ` (${fechaHora(p.solicitado_en)})` : ""}</Th>
              <Th align="right">Hoy</Th>
            </CabeceraTabla>
          </TableHeader>
          <TableBody>
            {filas.map((f) => {
              const mal = empeoro(f)
              return (
                <TableRow key={f.etiqueta} className={cn(filaTabla, mal && "bg-red-50/60")}>
                  <Td>{f.etiqueta}</Td>
                  <Td num className="text-muted-foreground">{fmt(f.antes, f.dias)}</Td>
                  <Td num fuerte className={cn(mal && "text-red-700")}>
                    {cuenta ? fmt(f.ahora, f.dias) : error ? "—" : <Loader2 className="ml-auto h-3 w-3 animate-spin" />}
                    {mal && <span className="sr-only"> (empeoró)</span>}
                  </Td>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </MarcoTabla>

      {error ? (
        <p className="text-xs text-amber-700">No se pudo leer la cartera actual: {error}</p>
      ) : (
        <FuenteDato>
          «Al enviar» es la foto que guardó el sistema cuando se pidió la aprobación
          {snap.cupo == null ? " (este pedido se envió antes de que existiera la foto)" : ""}. «Hoy» sale de las
          cuentas por cobrar del cliente, sumando todos los owners.
        </FuenteDato>
      )}
    </section>
  )
}

const EVENTO: Record<string, string> = {
  creado: "Creado",
  editado: "Editado",
  solicitado: "Enviado a aprobación",
  reenviado: "Reenviado a aprobación",
  firmado: "Aprobado",
  rechazado: "Rechazado",
  clave_incorrecta: "Intento con clave incorrecta",
  programado_lipgo: "Programado en LIPgo",
  error_lipgo: "Error al programar en LIPgo",
  anulado: "Anulado",
}

const TONO_PUNTO: Record<string, string> = {
  firmado: "bg-emerald-500",
  programado_lipgo: "bg-emerald-500",
  rechazado: "bg-red-500",
  error_lipgo: "bg-red-500",
  clave_incorrecta: "bg-amber-500",
  anulado: "bg-slate-400",
}

/**
 * Historial plegado: casi nunca hace falta, pero en un reenvío es donde se lee
 * por qué lo rechazaron la vez anterior. Se consulta al abrirlo, no antes.
 */
function Historial({ pedidoId, empresaId }: { pedidoId: number; empresaId: number }) {
  const [abierto, setAbierto] = useState(false)
  const [eventos, setEventos] = useState<EventoPedido[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto || eventos) return
    getHistorialPedido(pedidoId, empresaId).then((r) => {
      if (r.success) setEventos(r.data ?? [])
      else setError(r.error ?? "No se pudo leer el historial")
    })
  }, [abierto, eventos, pedidoId, empresaId])

  return (
    <Collapsible open={abierto} onOpenChange={setAbierto} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-semibold hover:bg-muted/30">
        <span className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Historial
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", abierto && "rotate-180")} aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2">
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : !eventos ? (
          <Loader2 className="mx-auto my-2 h-4 w-4 animate-spin text-muted-foreground" />
        ) : eventos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin eventos registrados.</p>
        ) : (
          <ol className="space-y-2">
            {eventos.map((e) => {
              const rolEt = typeof e.datos?.rol_etiqueta === "string" ? e.datos.rol_etiqueta : null
              return (
                <li key={e.id} className="flex gap-2 text-xs">
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", TONO_PUNTO[e.tipo] ?? "bg-[#0f7b6f]")} />
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium">
                        {EVENTO[e.tipo] ?? e.tipo.replace(/_/g, " ")}
                        {rolEt ? ` · ${rolEt}` : ""}
                      </span>
                      <span className="text-muted-foreground"> — {e.usuario_nombre ?? "Sistema"} · {fechaHora(e.creado_en)}</span>
                    </p>
                    {e.nota && <p className="text-muted-foreground">{e.nota}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export default AprobacionDialog
