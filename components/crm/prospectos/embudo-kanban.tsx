"use client"

// Embudo de ventas en tablero kanban.
//
// ARRASTRE CON dnd-kit. Antes se usaba la API HTML5 nativa, que tenia dos
// fallos que en este modulo importan mucho:
//
//   - No responde a tactil. El vendedor abre el embudo desde el telefono en la
//     calle, y alli arrastrar era sencillamente imposible.
//   - No es accesible por teclado.
//
// dnd-kit resuelve los dos: el PointerSensor cubre raton y dedo, y el
// KeyboardSensor permite mover una tarjeta con las flechas. El selector de
// etapa de cada tarjeta se conserva de todos modos, porque sigue siendo el
// camino mas rapido cuando se sabe exactamente a donde va.
//
// La tarjeta que se arrastra se pinta en un DragOverlay: sin el, la tarjeta
// original se queda en su sitio y el usuario no ve que esta moviendo nada.

import { useEffect, useMemo, useState } from "react"
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { Loader2, GripVertical, TrendingUp, Users, Target, Filter } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getProspectos, getEtapas, moverEtapa, getResumenEmbudo } from "@/lib/crm-prospectos-actions"
import type { Etapa, ProspectoConEtapa, ResumenEmbudo } from "@/lib/crm-prospectos"
import { KpiCompacto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { AccesosRapidos } from "@/components/crm/ui/accesos-rapidos"

const money = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

export function EmbudoKanban() {
  const { profile, selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [prospectos, setProspectos] = useState<ProspectoConEtapa[]>([])
  const [resumen, setResumen] = useState<ResumenEmbudo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [arrastrando, setArrastrando] = useState<number | null>(null)

  // Se exige recorrer 6px antes de considerar que es un arrastre. Sin esa
  // holgura, cualquier clic sobre el selector de etapa se interpreta como
  // arrastre y el desplegable no llega a abrirse nunca.
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const cargar = async () => {
    const [eRes, pRes, rRes] = await Promise.all([
      getEtapas(empresaId),
      getProspectos(empresaId),
      getResumenEmbudo(empresaId),
    ])
    if (eRes.success) setEtapas(eRes.data ?? [])
    if (pRes.success) setProspectos(pRes.data ?? [])
    if (rRes.success) setResumen(rRes.data ?? null)
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  const porEtapa = useMemo(() => {
    const mapa = new Map<number, ProspectoConEtapa[]>()
    for (const e of etapas) mapa.set(e.id, [])
    for (const p of prospectos) {
      if (mapa.has(p.etapa_id)) mapa.get(p.etapa_id)!.push(p)
    }
    return mapa
  }, [etapas, prospectos])

  // La tarjeta que se esta arrastrando, para pintarla en el overlay.
  const prospectoArrastrado = useMemo(
    () => (arrastrando == null ? null : prospectos.find((p) => p.id === arrastrando) ?? null),
    [arrastrando, prospectos],
  )

  const mover = async (prospectoId: number, etapaDestino: number) => {
    const prospecto = prospectos.find((p) => p.id === prospectoId)
    if (!prospecto || prospecto.etapa_id === etapaDestino) return

    const etapaPrevia = prospecto.etapa_id

    // Optimista: la tarjeta se mueve al instante y se revierte si falla. En un
    // tablero que se arrastra, esperar la respuesta del servidor se siente roto.
    setProspectos((prev) =>
      prev.map((p) => (p.id === prospectoId ? { ...p, etapa_id: etapaDestino } : p)),
    )

    const res = await moverEtapa(prospectoId, etapaDestino, profile?.usuario ?? "desconocido", empresaId)

    if (!res.success) {
      setProspectos((prev) =>
        prev.map((p) => (p.id === prospectoId ? { ...p, etapa_id: etapaPrevia } : p)),
      )
      toast({ title: "No se pudo mover", description: res.error, variant: "destructive" })
      return
    }

    // El resumen se recalcula en el servidor: el ponderado depende de la
    // probabilidad de la etapa nueva.
    getResumenEmbudo(empresaId).then((r) => r.success && setResumen(r.data ?? null))
  }

  if (cargando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <Filter className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Embudo de ventas</h1>
            <p className="text-sm text-muted-foreground">Arrastra una tarjeta para moverla de etapa, o usa el selector de cada una.</p>
          </div>
        </div>
      </header>

      {/* Tira compacta: el embudo de tarjetas es lo que se viene a leer aquí. */}
      {resumen && (
        <TiraKpi>
          <KpiCompacto
            icono={Users}
            etiqueta="Prospectos activos"
            valor={resumen.totalProspectos}
            tono="primary"
          />
          <KpiCompacto
            icono={TrendingUp}
            etiqueta="Valor del embudo"
            valor={money(resumen.valorTotal)}
            tono="primary"
            detalle="Suma de las etapas abiertas"
          />
          <KpiCompacto
            icono={Target}
            etiqueta="Pronóstico ponderado"
            valor={money(resumen.valorPonderado)}
            tono="success"
            detalle="Ajustado por la probabilidad de cada etapa"
          />
        </TiraKpi>
      )}

      {/* Scroll horizontal: con siete etapas no caben en pantalla y apilarlas
          en vertical perdería la lectura de embudo. */}
      <DndContext
        sensors={sensores}
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setArrastrando(Number(e.active.id))}
        onDragCancel={() => setArrastrando(null)}
        onDragEnd={(e: DragEndEvent) => {
          setArrastrando(null)
          const destino = e.over?.id
          if (destino != null) mover(Number(e.active.id), Number(destino))
        }}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {etapas.map((etapa) => (
            <ColumnaEtapa
              key={etapa.id}
              etapa={etapa}
              items={porEtapa.get(etapa.id) ?? []}
              etapas={etapas}
              arrastrando={arrastrando}
              onCambiarEtapa={mover}
            />
          ))}
        </div>

        {/* La tarjeta "fantasma" que sigue al cursor. Se pinta fuera del flujo
            para que no la recorte el scroll horizontal de las columnas. */}
        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18,0.67,0.6,1.22)" }}>
          {prospectoArrastrado && (
            <Card className="w-72 rotate-2 cursor-grabbing shadow-lg ring-2 ring-[var(--chart-1)]/40">
              <CardContent className="space-y-1 p-3">
                <p className="truncate text-sm font-medium">{prospectoArrastrado.razon_social}</p>
                {prospectoArrastrado.valor_estimado > 0 && (
                  <p className="text-sm font-semibold tabular-nums">
                    {money(prospectoArrastrado.valor_estimado)}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

/** Una columna del tablero: es la zona donde se sueltan las tarjetas. */
function ColumnaEtapa({
  etapa, items, etapas, arrastrando, onCambiarEtapa,
}: {
  etapa: Etapa
  items: ProspectoConEtapa[]
  etapas: Etapa[]
  arrastrando: number | null
  onCambiarEtapa: (prospectoId: number, etapaId: number) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id })
  const valor = items.reduce((s, p) => s + Number(p.valor_estimado || 0), 0)

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30 transition-colors ${
        isOver ? "border-[var(--chart-1)] bg-[var(--chart-1)]/5" : ""
      }`}
    >
      <div className="space-y-1 border-b px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: etapa.color ?? "var(--chart-1)" }}
              aria-hidden="true"
            />
            {etapa.nombre}
          </span>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">
          {money(valor)}
          {!etapa.es_ganada && !etapa.es_perdida && ` · ${etapa.probabilidad}%`}
        </p>
      </div>

      <div className="flex-1 space-y-2 p-2">
        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Sin prospectos</p>
        ) : (
          items.map((p) => (
            <TarjetaKanban
              key={p.id}
              prospecto={p}
              etapas={etapas}
              arrastrando={arrastrando === p.id}
              onCambiarEtapa={(destino) => onCambiarEtapa(p.id, destino)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function TarjetaKanban({
  prospecto: p, etapas, arrastrando, onCambiarEtapa,
}: {
  prospecto: ProspectoConEtapa
  etapas: Etapa[]
  arrastrando: boolean
  onCambiarEtapa: (etapaId: number) => void
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: p.id })

  return (
    <Card
      ref={setNodeRef}
      className={arrastrando ? "opacity-40" : undefined}
    >
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start gap-1.5">
          {/* El asa es SOLO la manija, no la tarjeta entera: asi el selector de
              etapa y el texto siguen siendo seleccionables con el raton. */}
          <button
            type="button"
            {...listeners}
            {...attributes}
            aria-label={`Mover ${p.razon_social} de etapa`}
            className="mt-0.5 shrink-0 cursor-grab touch-none rounded text-muted-foreground/40 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.razon_social}</p>
            {p.contacto_nombre && (
              <p className="truncate text-xs text-muted-foreground">{p.contacto_nombre}</p>
            )}
          </div>
          {/* Del embudo a la acción: abrir el expediente, cotizarle, anotar
              la llamada. Ya cliente: su cuenta y venderle. */}
          <AccesosRapidos
            variante="menu"
            titulo="⋯"
            className="h-6 shrink-0 px-1.5"
            accesos={p.cliente_id ? [
              { cuenta360: p.cliente_id },
              { intencion: { accion: "nueva_venta", clienteId: p.cliente_id } },
            ] : [
              { intencion: { accion: "ver_prospecto", prospectoId: p.id } },
              { intencion: { accion: "nueva_cotizacion", prospectoId: p.id }, etiqueta: "Cotizarle" },
              { intencion: { accion: "registrar_actividad", prospectoId: p.id } },
            ]}
          />
        </div>

        {p.valor_estimado > 0 && (
          <p className="text-sm font-semibold tabular-nums">{money(p.valor_estimado)}</p>
        )}

        {p.proxima_fecha && (
          <p className="text-xs text-muted-foreground">Próximo: {p.proxima_fecha}</p>
        )}

        {/* Alternativa al arrastre: en móvil es el único camino, y en
            escritorio es lo que hace la acción accesible por teclado. */}
        <Select value={String(p.etapa_id)} onValueChange={(v) => onCambiarEtapa(Number(v))}>
          <SelectTrigger className="h-7 text-xs" aria-label="Cambiar etapa">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {etapas.map((e) => (
              <SelectItem key={e.id} value={String(e.id)} className="text-xs">
                {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
}

export default EmbudoKanban
