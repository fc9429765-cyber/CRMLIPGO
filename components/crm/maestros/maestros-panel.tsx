"use client"

// Maestros: las tablas de las que dependen las reglas comerciales (ADM-01).
//
// La pantalla no conoce ningún maestro en particular: todo sale de
// lib/crm-maestros.ts. Pinta una píldora por maestro, una columna por campo con
// `enTabla` y un control por campo en el formulario. Así, añadir un maestro es
// añadir su definición allí, sin tocar esta pantalla — y el servidor valida
// contra esa misma definición, de modo que lo que se ve y lo que se guarda no
// pueden desalinearse.
//
// No hay botón de borrar, a propósito: el servidor nunca borra. Un banco con
// recaudos que lo referencian rompería el historial; se desactiva con el
// interruptor «Activo» y deja de ofrecerse en los selectores.

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Database, Loader2, Plus } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import {
  MAESTROS, ORDEN_MAESTROS, type CampoMaestro, type DefinicionMaestro, type MaestroId,
} from "@/lib/crm-maestros"
import { guardarMaestro, listarMaestro, opcionesMaestro, type FilaMaestro } from "@/lib/crm-maestros-actions"
import { TablaDatos } from "@/components/crm/ui/tabla-datos"
import { DetalleDialog } from "@/components/crm/ui/detalle-dialog"
import { BadgeEstado } from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type Opcion = { valor: string; etiqueta: string }

// Radix Select no admite un ítem con valor vacío: el «ninguno» necesita un
// centinela que se traduce a null antes de enviarlo.
const NINGUNO = "__ninguno__"

const HEX = /^#[0-9a-f]{6}$/i

/** Maestros referenciados desde los campos de una definición. */
const referenciasDe = (def: DefinicionMaestro) =>
  Array.from(new Set(def.campos.map((c) => c.referencia).filter((r): r is MaestroId => !!r)))

const esLista = (c: CampoMaestro) => c.tipo === "lista_texto" || c.tipo === "lista_numero"

export function MaestrosPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [activo, setActivo] = useState<MaestroId>(ORDEN_MAESTROS[0])
  // Filas por maestro. Se cargan todos al entrar: son tablas pequeñas y así las
  // píldoras muestran su contador sin tener que visitarlas una a una.
  const [filas, setFilas] = useState<Partial<Record<MaestroId, FilaMaestro[]>>>({})
  // Opciones de los maestros referenciados (id -> nombre), para mostrar el
  // nombre del banco en vez de su id y para los selectores del formulario.
  const [opciones, setOpciones] = useState<Partial<Record<MaestroId, Opcion[]>>>({})
  const [editando, setEditando] = useState<{ fila: FilaMaestro | null } | null>(null)

  const def = MAESTROS[activo]

  const cargarMaestro = useCallback(
    async (id: MaestroId) => {
      const r = await listarMaestro(id, empresaId)
      if (r.success) setFilas((prev) => ({ ...prev, [id]: r.data ?? [] }))
      else {
        setFilas((prev) => ({ ...prev, [id]: prev[id] ?? [] }))
        toast({ title: `No se pudo cargar ${MAESTROS[id].titulo.toLowerCase()}`, description: r.error, variant: "destructive" })
      }
    },
    [empresaId],
  )

  const cargarOpciones = useCallback(
    async (id: MaestroId) => {
      const r = await opcionesMaestro(id, empresaId)
      if (r.success) setOpciones((prev) => ({ ...prev, [id]: r.data ?? [] }))
    },
    [empresaId],
  )

  // Al cambiar de empresa se empieza de cero: las filas de otra empresa no
  // deben verse ni un instante.
  useEffect(() => {
    setFilas({})
    setOpciones({})
    ORDEN_MAESTROS.forEach((id) => cargarMaestro(id))
  }, [cargarMaestro])

  // Opciones de las referencias del maestro visible, una sola vez por maestro.
  useEffect(() => {
    referenciasDe(def).forEach((ref) => {
      if (!opciones[ref]) cargarOpciones(ref)
    })
  }, [def, opciones, cargarOpciones])

  const datos = filas[activo] ?? []
  const cargando = filas[activo] === undefined

  const columnas = useMemo<ColumnDef<any, any>[]>(
    () =>
      def.campos
        .filter((c) => c.enTabla)
        .map((c): ColumnDef<any, any> => ({
          id: c.clave,
          header: c.etiqueta,
          // El valor ordenable es el mostrado (nombre del banco, etiqueta de la
          // opción), salvo en números, que ordenan por su valor real.
          accessorFn: (f: FilaMaestro) => valorOrdenable(c, f[c.clave], opciones),
          cell: ({ row }) => <Celda campo={c} valor={(row.original as FilaMaestro)[c.clave]} opciones={opciones} />,
        })),
    [def, opciones],
  )

  const guardado = (id: MaestroId) => {
    setEditando(null)
    cargarMaestro(id)
    // Si otro maestro lo referencia, sus opciones cambiaron (nombre nuevo,
    // desactivado…): se vuelven a pedir cuando haga falta.
    setOpciones((prev) => {
      const { [id]: _, ...resto } = prev
      return resto
    })
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <Database className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Maestros</h1>
            <p className="text-sm text-muted-foreground">
              Las tablas de las que dependen las reglas comerciales: owners, impuestos, bancos, medios de pago y avisos.
            </p>
          </div>
        </div>
        <Button size="sm" className="h-8" onClick={() => setEditando({ fila: null })}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Nuevo {def.singular}
        </Button>
      </header>

      <div className="space-y-2">
        <SubNav<MaestroId>
          vistas={ORDEN_MAESTROS.map((id) => ({
            valor: id,
            etiqueta: MAESTROS[id].titulo,
            contador: filas[id]?.length,
          }))}
          activa={activo}
          onCambiar={setActivo}
        />
        <p className="text-xs text-muted-foreground">{def.descripcion}</p>
      </div>

      <TablaDatos
        key={activo}
        datos={datos}
        columnas={columnas}
        cargando={cargando}
        placeholderBusqueda={`Buscar en ${def.titulo.toLowerCase()}…`}
        mensajeVacio={`Todavía no hay ${def.titulo.toLowerCase()}. Crea el primero con «Nuevo ${def.singular}».`}
        onFila={(f: FilaMaestro) => setEditando({ fila: f })}
        claseFila={(f: FilaMaestro) => (f.activo === false ? "opacity-60" : undefined)}
      />

      {editando && (
        <FormularioMaestro
          key={`${activo}-${editando.fila?.id ?? "nuevo"}`}
          def={def}
          fila={editando.fila}
          empresaId={empresaId}
          opciones={opciones}
          onCerrar={() => setEditando(null)}
          onGuardado={() => guardado(def.id)}
        />
      )}
    </div>
  )
}

function etiquetaSelect(c: CampoMaestro, v: unknown, opciones: Partial<Record<MaestroId, Opcion[]>>) {
  if (v == null || v === "") return ""
  const lista = c.referencia ? opciones[c.referencia] : c.opciones
  // Un referenciado inactivo no viene en las opciones: se muestra su id antes
  // que dejar la celda en blanco, que parecería "sin asignar".
  return lista?.find((o) => o.valor === String(v))?.etiqueta ?? (c.referencia ? `#${v}` : String(v))
}

function valorOrdenable(c: CampoMaestro, v: unknown, opciones: Partial<Record<MaestroId, Opcion[]>>) {
  switch (c.tipo) {
    case "numero":
      return v == null || v === "" ? null : Number(v)
    case "booleano":
      return v === true ? 1 : 0
    case "select":
      return etiquetaSelect(c, v, opciones)
    case "lista_texto":
    case "lista_numero":
      return Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v)
    default:
      return v == null ? "" : String(v)
  }
}

function Celda({
  campo: c, valor: v, opciones,
}: {
  campo: CampoMaestro
  valor: unknown
  opciones: Partial<Record<MaestroId, Opcion[]>>
}) {
  const vacio = <span className="text-muted-foreground">—</span>
  switch (c.tipo) {
    case "booleano":
      return v === true ? <BadgeEstado tono="exito">Sí</BadgeEstado> : <BadgeEstado tono="neutral">No</BadgeEstado>
    case "numero":
      return (
        <div className="text-right tabular-nums">
          {v == null || v === "" ? "—" : Number(v).toLocaleString("es-CO")}
        </div>
      )
    case "select": {
      const e = etiquetaSelect(c, v, opciones)
      return e ? <span>{e}</span> : vacio
    }
    case "lista_texto":
    case "lista_numero": {
      const t = Array.isArray(v) ? v.join(", ") : ""
      return t ? <span>{t}</span> : vacio
    }
    case "color":
      return v ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: String(v) }} aria-hidden="true" />
          <span className="font-mono">{String(v)}</span>
        </span>
      ) : (
        vacio
      )
    default:
      return v == null || v === "" ? vacio : <span>{String(v)}</span>
  }
}

/** Valores iniciales del formulario: los de la fila, o los de un registro nuevo. */
function valoresIniciales(def: DefinicionMaestro, fila: FilaMaestro | null): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  for (const c of def.campos) {
    const actual = fila?.[c.clave]
    if (c.tipo === "booleano") v[c.clave] = fila ? actual === true : c.clave === "activo"
    // Las listas se editan como texto separado por comas; el servidor las parte.
    else if (esLista(c)) v[c.clave] = Array.isArray(actual) ? actual.join(", ") : ""
    else v[c.clave] = actual == null ? "" : String(actual)
  }
  return v
}

function FormularioMaestro({
  def, fila, empresaId, opciones, onCerrar, onGuardado,
}: {
  def: DefinicionMaestro
  fila: FilaMaestro | null
  empresaId: number
  opciones: Partial<Record<MaestroId, Opcion[]>>
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [valores, setValores] = useState<Record<string, unknown>>(() => valoresIniciales(def, fila))
  const [guardando, setGuardando] = useState(false)

  const poner = (clave: string, v: unknown) => setValores((prev) => ({ ...prev, [clave]: v }))

  const guardar = async () => {
    setGuardando(true)
    // Los campos soloAlCrear no se mandan al editar: el servidor los ignoraría
    // igual, pero así queda claro que no cambian.
    const envio: Record<string, unknown> = {}
    for (const c of def.campos) {
      if (fila && c.soloAlCrear) continue
      const v = valores[c.clave]
      envio[c.clave] = v === NINGUNO ? null : v
    }
    const r = await guardarMaestro(def.id, envio, fila?.id, empresaId)
    setGuardando(false)
    if (!r.success) {
      // El diálogo sigue abierto: el mensaje del servidor dice qué corregir.
      toast({ title: "No se pudo guardar", description: r.error, variant: "destructive" })
      return
    }
    toast({ title: "Guardado" })
    onGuardado()
  }

  const nombre = fila ? String(fila[def.columnaNombre] ?? `#${fila.id}`) : null

  return (
    <DetalleDialog
      abierto
      onCerrar={onCerrar}
      icono={Database}
      titulo={fila ? `Editar ${def.singular}` : `Nuevo ${def.singular}`}
      subtitulo={nombre ? `${def.titulo} · ${nombre}` : def.titulo}
      ancho="normal"
      pie={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {def.campos.map((c) => (
          <Campo
            key={c.clave}
            campo={c}
            valor={valores[c.clave]}
            bloqueado={!!fila && !!c.soloAlCrear}
            opciones={c.referencia ? opciones[c.referencia] : c.opciones}
            onCambio={(v) => poner(c.clave, v)}
          />
        ))}
      </div>
    </DetalleDialog>
  )
}

function Campo({
  campo: c, valor, bloqueado, opciones, onCambio,
}: {
  campo: CampoMaestro
  valor: unknown
  bloqueado: boolean
  opciones?: Opcion[]
  onCambio: (v: unknown) => void
}) {
  const id = `maestro-${c.clave}`
  const texto = valor == null ? "" : String(valor)
  const claseInput = cn("h-9", bloqueado && "bg-muted")

  let control: React.ReactNode
  switch (c.tipo) {
    case "booleano":
      control = (
        <div className="flex h-9 items-center gap-2">
          <Switch id={id} checked={valor === true} onCheckedChange={(v) => onCambio(v)} disabled={bloqueado} />
          <Label htmlFor={id} className="text-sm font-normal">{valor === true ? "Sí" : "No"}</Label>
        </div>
      )
      break
    case "select": {
      const lista = opciones ?? []
      // Un referenciado inactivo no está en las opciones; se añade para que el
      // selector no aparezca vacío y el valor no se pierda al guardar.
      const huerfano = c.referencia && texto && !lista.some((o) => o.valor === texto)
      control = (
        <Select
          value={texto || (c.obligatorio ? undefined : NINGUNO)}
          onValueChange={(v) => onCambio(v)}
          disabled={bloqueado || (!!c.referencia && !opciones)}
        >
          <SelectTrigger id={id} className={cn("h-9 w-full", bloqueado && "bg-muted")}>
            <SelectValue placeholder={c.referencia && !opciones ? "Cargando…" : "Selecciona…"} />
          </SelectTrigger>
          <SelectContent>
            {!c.obligatorio && <SelectItem value={NINGUNO}>— Ninguno —</SelectItem>}
            {huerfano && <SelectItem value={texto}>#{texto} (inactivo)</SelectItem>}
            {lista.map((o) => (
              <SelectItem key={o.valor} value={o.valor}>{o.etiqueta}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
      break
    }
    case "color":
      control = (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${c.etiqueta} (selector)`}
            value={HEX.test(texto) ? texto : "#000000"}
            onChange={(e) => onCambio(e.target.value)}
            disabled={bloqueado}
            className="h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-background p-1 disabled:cursor-not-allowed"
          />
          <Input id={id} value={texto} onChange={(e) => onCambio(e.target.value)} placeholder="#1f77b4" disabled={bloqueado} className={cn(claseInput, "font-mono")} />
        </div>
      )
      break
    case "texto_largo":
      control = (
        <Textarea id={id} rows={3} value={texto} onChange={(e) => onCambio(e.target.value)} disabled={bloqueado} className="text-sm" />
      )
      break
    case "imagen":
      control = <CampoImagen id={id} valor={texto} bloqueado={bloqueado} onCambio={onCambio} />
      break
    case "numero":
      control = (
        <Input id={id} type="number" inputMode="decimal" value={texto} onChange={(e) => onCambio(e.target.value)} disabled={bloqueado} className={cn(claseInput, "tabular-nums")} />
      )
      break
    case "lista_texto":
    case "lista_numero":
      control = (
        <Input
          id={id}
          value={texto}
          onChange={(e) => onCambio(e.target.value)}
          placeholder={c.tipo === "lista_numero" ? "1, 3, 4" : "Separados por coma"}
          disabled={bloqueado}
          className={claseInput}
        />
      )
      break
    default:
      control = <Input id={id} value={texto} onChange={(e) => onCambio(e.target.value)} disabled={bloqueado} className={claseInput} />
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {c.etiqueta}
        {c.obligatorio && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
      </Label>
      {control}
      {c.ayuda && <p className="text-[11px] leading-relaxed text-muted-foreground">{c.ayuda}</p>}
      {bloqueado && <p className="text-[11px] text-muted-foreground">Solo se define al crear.</p>}
    </div>
  )
}

/**
 * Imagen de un maestro (el logo del owner). Se sube a la carpeta "logos" del
 * Storage del proyecto: el generador del estado de cuenta solo descarga
 * imagenes de ahi, asi que pegar una URL de otro sitio no funcionaria.
 */
function CampoImagen({
  id, valor, bloqueado, onCambio,
}: {
  id: string
  valor: string
  bloqueado: boolean
  onCambio: (v: unknown) => void
}) {
  const [subiendo, setSubiendo] = useState(false)
  const subir = async (f: File | null) => {
    if (!f) return
    setSubiendo(true)
    const fd = new FormData()
    fd.append("file", f)
    fd.append("carpeta", "logos")
    fd.append("referencia", "owner")
    try {
      const r = await fetch("/api/crm/upload-imagen", { method: "POST", body: fd })
      const j = (await r.json()) as { success: boolean; url?: string; error?: string }
      if (!j.success || !j.url) throw new Error(j.error ?? "No se pudo subir")
      onCambio(j.url)
    } catch (err) {
      toast({ title: "No se subió la imagen", description: err instanceof Error ? err.message : undefined, variant: "destructive" })
    } finally {
      setSubiendo(false)
    }
  }
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
        {valor ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={valor} alt="Logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-muted-foreground">Sin logo</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className={cn("inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs hover:bg-muted", (bloqueado || subiendo) && "pointer-events-none opacity-50")}>
          {subiendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {valor ? "Cambiar imagen" : "Subir imagen"}
        </label>
        <input id={id} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => subir(e.target.files?.[0] ?? null)} disabled={bloqueado || subiendo} />
        {valor && !bloqueado && (
          <button type="button" className="text-left text-[11px] text-muted-foreground hover:underline" onClick={() => onCambio("")}>Quitar</button>
        )}
      </div>
    </div>
  )
}

export default MaestrosPanel
