"use client"

// Formulario de recaudo: registrar uno nuevo o corregir uno rechazado.
//
// Pensado para el teléfono, donde el vendedor está frente al cliente: una sola
// columna y en el orden en que ocurre la cosa. Primero el cliente, luego la
// FOTO (la IA prellena lo que alcanza a leer, REC-20), luego se confirman los
// datos y al final se ve cómo quedaría repartido el pago antes de enviarlo.
//
// La foto mala se rechaza aquí mismo, con el motivo (REC-21): es más barato
// tomarla otra vez ahora que descubrirlo cuando Cartera la rechace días
// después y el vendedor ya no esté donde el cliente.

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Camera, CheckCircle, ChevronsUpDown, Loader2, ScanLine, Send, TriangleAlert, Upload, X,
} from "lucide-react"
import {
  analizarComprobante, corregirRecaudo, proponerAplicacion, registrarRecaudo, type CarteraParaRecaudo,
} from "@/lib/crm-recaudos-actions"
import type { Distribucion } from "@/lib/crm-cartera-aplicacion"
import { compararConComprobante, type RecaudoConDetalle } from "@/lib/crm-recaudos"
import type { LecturaComprobante } from "@/lib/integraciones/ocr"
import type { ClienteCrm } from "@/lib/crm-catalogos"
import { hoyISO } from "@/lib/crm-fechas"
import { compressImageIfNeeded } from "@/lib/image-compress"
import { AlertasRecaudo, TablaAplicaciones, cop, type MaestrosRecaudo } from "@/components/crm/recaudos/comun"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type EstadoLectura =
  | { tipo: "nada" }
  | { tipo: "leyendo" }
  | { tipo: "ok"; lectura: LecturaComprobante }
  | { tipo: "mala"; motivo: string }
  | { tipo: "apagada"; motivo?: string }

const soloDigitos = (t: string) => t.replace(/\D/g, "")
const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()

export function RecaudoForm({
  empresaId, maestros, clientes, corrigiendo, onHecho, onCancelar,
}: {
  empresaId: number
  maestros: MaestrosRecaudo
  /** Clientes visibles para el usuario. No se usa al corregir. */
  clientes: ClienteCrm[]
  /** Si viene, se corrige este recaudo rechazado en vez de crear uno. */
  corrigiendo?: RecaudoConDetalle | null
  onHecho: (r: { id: number | null; numero: string | null; alertas: string[] }) => void
  onCancelar?: () => void
}) {
  const r0 = corrigiendo ?? null
  const [clienteId, setClienteId] = useState<number | null>(r0?.cliente_id ?? null)
  const [ownerId, setOwnerId] = useState<number | null>(r0?.owner_id ?? null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [lectura, setLectura] = useState<EstadoLectura>(
    r0?.ocr ? { tipo: "ok", lectura: r0.ocr } : { tipo: "nada" },
  )
  const [duplicado, setDuplicado] = useState<string | null>(null)
  const [medioId, setMedioId] = useState<string>(r0?.medio_pago_id ? String(r0.medio_pago_id) : "")
  const [bancoId, setBancoId] = useState<string>(r0?.banco_id ? String(r0.banco_id) : "")
  const [cuentaId, setCuentaId] = useState<string>(r0?.cuenta_destino_id ? String(r0.cuenta_destino_id) : "")
  const [fecha, setFecha] = useState(r0?.fecha_documento ?? hoyISO())
  const [valor, setValor] = useState(r0 ? String(Math.round(Number(r0.valor))) : "")
  const [referencia, setReferencia] = useState(r0?.referencia ?? "")
  const [observaciones, setObservaciones] = useState(r0?.observaciones ?? "")
  const [cartera, setCartera] = useState<(CarteraParaRecaudo & { distribucion: Distribucion }) | null>(null)
  const [cargandoCartera, setCargandoCartera] = useState(false)
  const [buscador, setBuscador] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const inputArchivo = useRef<HTMLInputElement>(null)
  const inputCamara = useRef<HTMLInputElement>(null)

  const cliente = clientes.find((c) => c.id === clienteId) ?? null
  const medio = maestros.medios.find((m) => String(m.id) === medioId) ?? null
  const banco = maestros.bancos.find((b) => String(b.id) === bancoId) ?? null
  const monto = Number(valor) || 0

  // Owners con facturas abiertas: si hay más de uno, el pago tiene que decir
  // de cuál es. Aplicar un pago de INDUPAN a una factura de Molinos descuadra
  // las dos carteras.
  const [ownersCliente, setOwnersCliente] = useState<number[]>([])
  useEffect(() => {
    if (!clienteId) { setOwnersCliente([]); return }
    proponerAplicacion(clienteId, null, 0, empresaId).then((r) => {
      if (!r.success || !r.data) return
      const ids = [...new Set(r.data.facturas.map((f) => f.owner_id).filter((o): o is number => o != null))]
      setOwnersCliente(ids)
      if (ids.length === 1 && !ownerId) setOwnerId(ids[0])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, empresaId])

  // Vista previa del reparto: se recalcula al cambiar cliente, owner o valor.
  useEffect(() => {
    if (!clienteId) { setCartera(null); return }
    if (ownersCliente.length > 1 && !ownerId) { setCartera(null); return }
    setCargandoCartera(true)
    const t = setTimeout(() => {
      proponerAplicacion(clienteId, ownerId, monto, empresaId).then((r) => {
        setCargandoCartera(false)
        if (r.success && r.data) setCartera(r.data)
      })
    }, 350)
    return () => clearTimeout(t)
  }, [clienteId, ownerId, monto, ownersCliente.length, empresaId])

  // Cuentas destino: las del owner (o sin owner) y, si ya hay banco, las de ese banco.
  const cuentas = useMemo(
    () => maestros.cuentas.filter((c) =>
      (!ownerId || !c.owner_id || c.owner_id === ownerId) && (!bancoId || !c.banco_id || String(c.banco_id) === bancoId)),
    [maestros.cuentas, ownerId, bancoId],
  )
  useEffect(() => {
    if (cuentaId && !cuentas.some((c) => String(c.id) === cuentaId)) setCuentaId("")
  }, [cuentas, cuentaId])

  const lecturaOk = lectura.tipo === "ok" ? lectura.lectura : null
  const alertas = useMemo(
    () => (monto > 0 && fecha
      ? compararConComprobante({ valor: monto, fecha_documento: fecha, banco_nombre: banco?.nombre, referencia }, lecturaOk)
      : []),
    [monto, fecha, banco?.nombre, referencia, lecturaOk],
  )

  const elegirArchivo = async (original: File | null) => {
    setDuplicado(null)
    if (!original) return
    // Una foto de celular pesa 5-12 MB y Vercel corta el envio en ~4.5 MB: se
    // reduce a 1600 px, que sigue siendo legible para Cartera y para la IA.
    const f = await compressImageIfNeeded(original)
    if (f.size > 4 * 1024 * 1024) {
      toast({ title: "El archivo es muy pesado", description: "Máximo 4 MB. Si es un PDF, envíalo más liviano o toma una foto.", variant: "destructive" })
      return
    }
    setArchivo(f)
    setLectura({ tipo: "leyendo" })
    const fd = new FormData()
    fd.append("archivo", f)
    const r = await analizarComprobante(fd, empresaId)
    if (!r.success || !r.data) {
      setLectura({ tipo: "apagada", motivo: r.error })
      return
    }
    if (r.data.duplicado) {
      setDuplicado(`Este comprobante ya está en el recaudo ${r.data.duplicado.numero} (${r.data.duplicado.estado}).`)
    }
    if (!r.data.disponible || !r.data.lectura) {
      setLectura({ tipo: "apagada", motivo: r.data.motivo })
      return
    }
    const l = r.data.lectura
    if (!l.legible || !l.es_comprobante) {
      setLectura({
        tipo: "mala",
        motivo: !l.legible ? l.motivo_ilegible ?? "No se alcanza a leer el comprobante" : "La imagen no parece un comprobante de pago",
      })
      return
    }
    setLectura({ tipo: "ok", lectura: l })
    // Prellena solo lo que el vendedor no haya escrito ya: lo digitado manda.
    if (l.valor != null && !valor) setValor(String(Math.round(l.valor)))
    if (l.fecha && l.fecha <= hoyISO()) setFecha(l.fecha)
    if (l.referencia && !referencia) setReferencia(l.referencia)
    if (l.banco && !bancoId) {
      const b = sinTildes(l.banco).replace(/[^A-Z0-9]/g, "")
      const hit = maestros.bancos.find((x) => {
        const n = sinTildes(x.nombre).replace(/[^A-Z0-9]/g, "")
        return n && (b.includes(n) || n.includes(b))
      })
      if (hit) setBancoId(String(hit.id))
    }
  }

  const quitarArchivo = () => {
    setArchivo(null)
    setDuplicado(null)
    setLectura(r0?.ocr ? { tipo: "ok", lectura: r0.ocr } : { tipo: "nada" })
    if (inputArchivo.current) inputArchivo.current.value = ""
    if (inputCamara.current) inputCamara.current.value = ""
  }

  const exigeComprobante = medio?.requiere_comprobante ?? true
  const tieneComprobante = !!archivo || !!r0?.comprobante_id
  let pendiente: string | null = null
  if (!clienteId) pendiente = "Elige el cliente"
  else if (ownersCliente.length > 1 && !ownerId) pendiente = "Indica de qué empresa es el pago"
  else if (exigeComprobante && !tieneComprobante) pendiente = "Adjunta la foto del comprobante"
  else if (lectura.tipo === "mala") pendiente = "Toma de nuevo la foto"
  else if (lectura.tipo === "leyendo") pendiente = "Leyendo el comprobante…"
  else if (duplicado) pendiente = "Ese comprobante ya fue reportado"
  else if (!medioId) pendiente = "Elige el medio de pago"
  else if (medio?.requiere_banco && !bancoId) pendiente = `${medio.nombre} exige el banco`
  else if (!fecha) pendiente = "Indica la fecha del pago"
  else if (monto <= 0) pendiente = "Indica el valor"

  const enviar = async () => {
    if (pendiente) return
    setEnviando(true)
    const fd = new FormData()
    fd.append("cliente_id", String(clienteId))
    if (ownerId) fd.append("owner_id", String(ownerId))
    fd.append("fecha_documento", fecha)
    fd.append("valor", String(monto))
    fd.append("medio_pago_id", medioId)
    if (bancoId) fd.append("banco_id", bancoId)
    if (cuentaId) fd.append("cuenta_destino_id", cuentaId)
    if (referencia.trim()) fd.append("referencia", referencia.trim())
    if (observaciones.trim()) fd.append("observaciones", observaciones.trim())
    if (archivo) fd.append("archivo", archivo)

    if (r0) {
      const r = await corregirRecaudo(r0.id, fd, empresaId)
      setEnviando(false)
      if (!r.success) {
        toast({ title: "No se reenvió", description: r.error, variant: "destructive" })
        return
      }
      onHecho({ id: r0.id, numero: r0.numero, alertas: r.data?.alertas ?? [] })
      return
    }
    const r = await registrarRecaudo(fd, empresaId)
    setEnviando(false)
    if (!r.success || !r.data) {
      toast({ title: "No se registró el recaudo", description: r.error, variant: "destructive" })
      return
    }
    onHecho({ id: r.data.recaudo.id, numero: r.data.recaudo.numero, alertas: r.data.alertas })
  }

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ Cliente */}
      <section className="space-y-2">
        <Label className="text-sm">Cliente</Label>
        {r0 ? (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">{r0.cliente_nombre ?? `#${r0.cliente_id}`}</p>
        ) : (
          <Popover open={buscador} onOpenChange={setBuscador}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="h-10 w-full justify-between font-normal">
                <span className="truncate">{cliente?.nombre ?? "Buscar cliente…"}</span>
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Nombre o NIT…" />
                <CommandList>
                  <CommandEmpty>Ninguno coincide.</CommandEmpty>
                  <CommandGroup>
                    {clientes.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${c.nombre} ${c.documento ?? ""}`}
                        onSelect={() => { setClienteId(c.id); setOwnerId(null); setBuscador(false) }}
                      >
                        <span className="truncate">{c.nombre}</span>
                        {c.documento && <span className="ml-auto text-[11px] text-muted-foreground">{c.documento}</span>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}

        {ownersCliente.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">El cliente debe a varias empresas: ¿a cuál le pagó?</Label>
            <Select value={ownerId ? String(ownerId) : ""} onValueChange={(v) => setOwnerId(Number(v))}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Empresa" /></SelectTrigger>
              <SelectContent>
                {maestros.owners.filter((o) => ownersCliente.includes(o.id)).map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {cartera && (
          <p className="text-xs text-muted-foreground">
            Debe {cop(cartera.facturas.reduce((s, f) => s + f.saldo, 0))} en {cartera.facturas.length} factura
            {cartera.facturas.length === 1 ? "" : "s"}
            {cartera.facturas.some((f) => f.dias_vencido > 0) && (
              <span className="text-red-600">
                {" "}· {cop(cartera.facturas.filter((f) => f.dias_vencido > 0).reduce((s, f) => s + f.saldo, 0))} vencido
              </span>
            )}
            {cartera.saldoFavor > 0 && <> · saldo a favor {cop(cartera.saldoFavor)}</>}
          </p>
        )}
      </section>

      {/* -------------------------------------------------------- Comprobante */}
      <section className="space-y-2">
        <Label className="text-sm">Comprobante {exigeComprobante ? "" : "(opcional)"}</Label>
        {/* Dos entradas: la cámara abre directo la cámara trasera en el
            teléfono; la otra deja elegir una foto o PDF ya guardado. */}
        <input
          ref={inputCamara} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
        />
        <input
          ref={inputArchivo} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
          onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
        />
        {!archivo ? (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-12" onClick={() => inputCamara.current?.click()}>
              <Camera className="mr-2 h-4 w-4" /> Tomar foto
            </Button>
            <Button type="button" variant="outline" className="h-12" onClick={() => inputArchivo.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Subir archivo
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
            <span className="truncate">{archivo.name}</span>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={quitarArchivo}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {r0?.comprobante_id && !archivo && (
          <p className="text-xs text-muted-foreground">Se conserva el comprobante anterior. Adjunta otro solo si Cartera lo pidió.</p>
        )}

        {lectura.tipo === "leyendo" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo el comprobante…
          </p>
        )}
        {lectura.tipo === "ok" && archivo && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700">
            <ScanLine className="h-3.5 w-3.5" /> Comprobante leído. Revisa que los datos coincidan.
          </p>
        )}
        {lectura.tipo === "mala" && (
          <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-800">
            <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert className="h-3.5 w-3.5" /> Toma de nuevo la foto</p>
            <p>{lectura.motivo}</p>
          </div>
        )}
        {lectura.tipo === "apagada" && archivo && (
          <p className="text-xs text-muted-foreground">
            {lectura.motivo ?? "La lectura automática no está disponible"}: digita los datos del comprobante.
          </p>
        )}
        {duplicado && <p className="rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-800">{duplicado}</p>}
      </section>

      {/* -------------------------------------------------------------- Datos */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-sm">Medio de pago</Label>
          <Select value={medioId} onValueChange={setMedioId}>
            <SelectTrigger className="h-10"><SelectValue placeholder="Elige…" /></SelectTrigger>
            <SelectContent>
              {maestros.medios.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Valor pagado</Label>
          <Input
            inputMode="numeric"
            className="h-10 text-right font-semibold tabular-nums"
            value={valor ? Number(valor).toLocaleString("es-CO") : ""}
            onChange={(e) => setValor(soloDigitos(e.target.value))}
            placeholder="0"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Fecha del pago</Label>
          <DatePickerField value={fecha} onChange={setFecha} maxDate={hoyISO()} className="h-10 w-full" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Banco {medio?.requiere_banco ? "" : "(si aplica)"}</Label>
          <Select value={bancoId} onValueChange={setBancoId}>
            <SelectTrigger className="h-10"><SelectValue placeholder="Elige…" /></SelectTrigger>
            <SelectContent>
              {maestros.bancos.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Cuenta donde quedó el dinero</Label>
          <Select value={cuentaId} onValueChange={setCuentaId}>
            <SelectTrigger className="h-10"><SelectValue placeholder={cuentas.length ? "Elige…" : "Sin cuentas configuradas"} /></SelectTrigger>
            <SelectContent>
              {cuentas.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Referencia (si la tiene)</Label>
          <Input className="h-10" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-sm">Observaciones</Label>
          <Textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </div>
      </section>

      <AlertasRecaudo alertas={alertas} />

      {/* ------------------------------------------------------ Reparto propuesto */}
      {clienteId && monto > 0 && (
        <section className={cn("space-y-1.5 transition-opacity", cargandoCartera && "opacity-60")}>
          {cartera ? (
            <TablaAplicaciones
              titulo="Así se aplicaría (la factura más vencida primero)"
              aplicaciones={cartera.distribucion.aplicaciones.map((a) => ({
                ...a,
                numero_factura: a.numero,
                fecha_vencimiento: cartera.facturas.find((f) => f.id === a.cuenta_cobrar_id)?.fecha_vencimiento ?? null,
              }))}
              saldoFavor={cartera.distribucion.saldoFavor}
            />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <p className="text-[11px] text-muted-foreground">
            Es una propuesta: los saldos cambian cuando Cartera aprueba el recaudo, y puede ajustar el reparto.
          </p>
        </section>
      )}

      {/* --------------------------------------------------------------- Enviar */}
      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t bg-background/95 px-1 pt-3 pb-1 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className={cn("text-xs", pendiente ? "text-muted-foreground" : "text-emerald-700")}>
          {pendiente ?? (
            <span className="flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5" /> Listo para enviar a Cartera</span>
          )}
        </p>
        <div className="flex gap-2">
          {onCancelar && <Button variant="ghost" onClick={onCancelar} disabled={enviando}>Cancelar</Button>}
          <Button className="h-10 flex-1 sm:flex-none" onClick={enviar} disabled={!!pendiente || enviando}>
            {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {r0 ? "Reenviar a Cartera" : `Registrar ${monto > 0 ? cop(monto) : "recaudo"}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default RecaudoForm
