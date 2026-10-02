"use client"

// Pantalla de Inicio: un tablero, no un menú.
//
// Antes era solo la rejilla de áreas, que obliga a entrar a un módulo para
// saber si algo va mal. Ahora lo primero que se ve es el estado del negocio y
// lo que requiere acción hoy; las áreas quedan debajo, para navegar.
//
// Sigue el patrón del Dashboard Gerencia de LIPgo: encabezado ejecutivo con
// reloj en vivo, fila de KPIs con glow de color, y paneles con cabecera de
// icono. Auto-refresco cada 60 s conservando lo que ya está en pantalla.

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Loader2, TrendingUp, Target, FileText, Wallet, CalendarClock, Stamp,
  UserX, ArrowRight, Users, ShoppingCart, AlertTriangle, Activity,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getDashboardComercial, type DashboardComercial } from "@/lib/crm-dashboard-actions"
import { money } from "@/lib/crm-cotizaciones"
import { KpiCompacto } from "@/components/crm/ui/kpi-compacto"
import { PanelCard } from "@/components/crm/ui/panel-card"
import { GraficaArea } from "@/components/crm/ui/graficas"
import { Aparece, ListaEscalonada, ElementoLista } from "@/components/crm/ui/movimiento"
import { SaludoHero } from "@/components/crm/ui/saludo-hero"
import { ModuleCards } from "@/components/module-cards"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { toast } from "@/hooks/use-toast"
import type { GroupKey } from "@/lib/dashboard-data"
import type { LucideIcon } from "lucide-react"
import { RadarPanel } from "@/components/crm/dashboard/radar-panel"
import { LipAiAssistant } from "@/components/lip-ai-assistant"
import { ContinuarReciente } from "@/components/continuar-reciente"
import { pendientesPorArea, useRadar } from "@/lib/radar-cliente"

const REFRESCO_MS = 60_000

interface Props {
  onSelectGroup: (group: GroupKey) => void
  onSelectModule?: (modulo: string) => void
}

export function InicioDashboard({ onSelectGroup, onSelectModule }: Props) {
  const { selectedEmpresaId, selectedEmpresaNombre, profile } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [datos, setDatos] = useState<DashboardComercial | null>(null)
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const montado = useRef(true)
  // Pendientes por área para el punto rojo de las tarjetas (misma consulta que el radar).
  const { datos: radar } = useRadar(empresaId)
  const pendientesArea = pendientesPorArea(radar)

  const cargar = useCallback(
    async (silencioso: boolean) => {
      if (silencioso) setRefrescando(true)

      const res = await getDashboardComercial(empresaId)
      if (!montado.current) return

      if (res.success && res.data) setDatos(res.data)
      else if (!silencioso) {
        toast({ title: "No se pudo cargar el tablero", description: res.error, variant: "destructive" })
      }

      setCargando(false)
      setRefrescando(false)
    },
    [empresaId],
  )

  useEffect(() => {
    montado.current = true
    cargar(false)
    const id = setInterval(() => cargar(true), REFRESCO_MS)
    return () => {
      montado.current = false
      clearInterval(id)
    }
  }, [cargar])

  if (cargando) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Cargando el tablero…</p>
      </div>
    )
  }

  const d = datos

  return (
    <div className="space-y-5">
      {/* La banda de bienvenida va primero, igual que en LIPgo: es lo que hace
          que al entrar se reconozca la misma casa. */}
      <SaludoHero nombre={profile?.nombre ?? undefined} empresa={selectedEmpresaNombre ?? undefined} />

      {/* ===== El asistente, protagonista del Inicio (como LIPbot en LIPgo):
          consulta datos reales, lleva al módulo y ejecuta acciones, todo
          gobernado por los permisos del usuario. ===== */}
      <section>
        <div className="mb-2.5">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-primary">
            <span aria-hidden="true">✨</span> La inteligencia del CRM
          </span>
          <p className="mt-1 max-w-[62ch] text-[13px] text-muted-foreground">
            Pregunta en lenguaje natural: te da <span className="font-semibold text-foreground">datos exactos</span> de clientes,
            pedidos y cartera, te <span className="font-semibold text-foreground">lleva al módulo</span> y{" "}
            <span className="font-semibold text-foreground">ejecuta acciones</span> por ti — todo gobernado por tus permisos.
          </p>
        </div>
        <LipAiAssistant
          variant="bar"
          empresaLabel={selectedEmpresaNombre}
          onNavigate={(m) => onSelectModule?.(m)}
          onOpenGroup={(k) => onSelectGroup(k as GroupKey)}
          onOpen={() => onSelectModule?.("Asistente IA")}
        />
        <div className="mt-2.5 flex flex-wrap gap-2">
          {[["🔎", "Consulta", "datos reales"], ["🧭", "Navega", "a cualquier módulo"], ["⚡", "Ejecuta", "acciones por ti"]].map(([e, b, t]) => (
            <span key={b} className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1 text-[11.5px] font-semibold text-foreground">
              <span aria-hidden="true">{e}</span> <span><b className="font-extrabold">{b}</b> {t}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Lo que pide acción HOY, antes que las cifras del mes: el radar
          reúne despachos, cartera, aprobaciones y agenda, y lleva a cada
          asunto con los datos puestos. */}
      <RadarPanel />

      {/* Recientes y favoritos del usuario */}
      <ContinuarReciente onNavigate={(m) => onSelectModule?.(m)} />

      {/* Las áreas: para entrar. El punto rojo dice dónde hay pendientes. */}
      <ModuleCards onSelectGroup={onSelectGroup} onSelectModule={onSelectModule} pendientes={pendientesArea} />

      {/* Indicadores compactos tambien en el tablero.
          La tarjeta ejecutiva de LIPgo mide unos 145px de alto: es la del
          tablero de gerencia, pensada para pantalla colgada en pared. En el
          Inicio del CRM el usuario quiere leer las cuatro cifras de un vistazo
          y bajar a lo que pide accion, y el doble de alto solo empuja el resto
          fuera de la pantalla. Ademas es la misma tarjeta que usan los
          modulos, asi que el sistema entero queda coherente.

          Escalonado: entran una tras otra, lo que guia la mirada de izquierda
          a derecha en vez de soltarlas de golpe. */}
      <ListaEscalonada
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}
      >
        <ElementoLista>
          <KpiCompacto
            icono={TrendingUp}
            etiqueta="Ventas del mes"
            valor={money(d?.ventas.mes ?? 0)}
            detalle="vs. mes anterior"
            tono="primary"
          />
        </ElementoLista>
        <ElementoLista>
          <KpiCompacto
            icono={Target}
            etiqueta="Pronóstico del embudo"
            valor={money(d?.embudo.valorPonderado ?? 0)}
            detalle={`${d?.embudo.prospectos ?? 0} prospectos activos`}
            tono="primary"
          />
        </ElementoLista>
        <ElementoLista>
          <KpiCompacto
            icono={FileText}
            etiqueta="Tasa de cierre"
            valor={`${(d?.cotizaciones.tasaConversion ?? 0).toFixed(1)}%`}
            detalle="Cotizaciones ganadas"
            tono={(d?.cotizaciones.tasaConversion ?? 0) >= 40 ? "success" : "warning"}
            onClick={() => onSelectModule?.("Cotizaciones")}
          />
        </ElementoLista>
        <ElementoLista>
          <KpiCompacto
            icono={Wallet}
            etiqueta="Cartera vencida"
            valor={money(d?.cartera.vencida ?? 0)}
            detalle={`${d?.cartera.porcentajeVencido ?? 0}% del total`}
            // Rojo en cuanto hay algo vencido: que suba es mala noticia y el
            // color debe decirlo sin que haya que leer la cifra.
            tono={(d?.cartera.vencida ?? 0) > 0 ? "danger" : "success"}
            onClick={() => onSelectModule?.("Antigüedad de Cartera")}
          />
        </ElementoLista>
      </ListaEscalonada>

      <div className="grid gap-4 lg:grid-cols-3">
        <PanelCard
          title="Ventas del mes"
          subtitle={`${d?.ventas.pedidos ?? 0} pedidos · ticket promedio ${money(d?.ventas.ticketPromedio ?? 0)}`}
          icon={<Activity className="h-5 w-5" />}
          accent="primary"
          className="lg:col-span-2"
        >
          <GraficaArea
            datos={d?.ventasPorDia ?? []}
            x="fecha"
            y="valor"
            etiqueta="Ventas"
            alto={224}
            moneda
            formatoX={(f: string) => f.slice(8)}
          />
        </PanelCard>

        <PanelCard
          title="Embudo comercial"
          subtitle={`${money(d?.embudo.valorTotal ?? 0)} en juego`}
          icon={<Target className="h-5 w-5" />}
          accent="info"
          headerRight={
            <button
              onClick={() => onSelectModule?.("Embudo de Ventas")}
              className="flex items-center gap-0.5 text-xs font-medium text-[#0c6b61] hover:underline"
            >
              Ver <ArrowRight className="h-3 w-3" />
            </button>
          }
        >
          {!d?.embudo.porEtapa.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Sin prospectos en el embudo.
            </p>
          ) : (
            <div className="space-y-2.5">
              {d.embudo.porEtapa.map((e) => {
                const pct = d.embudo.valorTotal > 0 ? (e.valor / d.embudo.valorTotal) * 100 : 0
                return (
                  <div key={e.nombre} className="space-y-1">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: e.color ?? "#0f7b6f" }}
                        />
                        {e.nombre}
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          {e.cantidad}
                        </Badge>
                      </span>
                      <span className="tabular-nums text-muted-foreground">{money(e.valor)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: e.color ?? "#0f7b6f" }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </PanelCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PanelCard
          title="Equipo comercial"
          subtitle="Ventas del mes contra su meta"
          icon={<Users className="h-5 w-5" />}
          accent="success"
          headerRight={
            <button
              onClick={() => onSelectModule?.("Vendedores")}
              className="flex items-center gap-0.5 text-xs font-medium text-[#0c6b61] hover:underline"
            >
              Ver <ArrowRight className="h-3 w-3" />
            </button>
          }
        >
          {!d?.topVendedores.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sin ventas registradas este mes.
            </p>
          ) : (
            <div className="space-y-3">
              {d.topVendedores.map((v) => (
                <div key={v.nombre} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="truncate font-medium">{v.nombre}</span>
                    <span className="tabular-nums">{money(v.ventas)}</span>
                  </div>
                  {v.meta > 0 && (
                    <div className="flex items-center gap-2">
                      <Progress value={Math.min(v.cumplimiento, 100)} className="h-1.5 flex-1" />
                      <span
                        className={`w-12 text-right text-xs font-semibold tabular-nums ${
                          v.cumplimiento >= 100 ? "text-emerald-600"
                            : v.cumplimiento >= 70 ? "text-amber-600"
                              : "text-rose-600"
                        }`}
                      >
                        {v.cumplimiento}%
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard
          title="Estado del negocio"
          subtitle="Resumen del día"
          icon={<ShoppingCart className="h-5 w-5" />}
          accent="warning"
        >
          <div className="grid grid-cols-2 gap-3">
            <Dato
              etiqueta="Cotizaciones abiertas"
              valor={String(d?.cotizaciones.abiertas ?? 0)}
              sub={money(d?.cotizaciones.valorAbierto ?? 0)}
              onClick={() => onSelectModule?.("Cotizaciones")}
            />
            <Dato
              etiqueta="Por cobrar"
              valor={money(d?.cartera.pendiente ?? 0)}
              sub={`${d?.cartera.clientesEnMora ?? 0} cliente(s) en mora`}
              onClick={() => onSelectModule?.("Cuentas por Cobrar")}
            />
            <Dato
              etiqueta="Visitas hoy"
              valor={String(d?.agenda.hoy ?? 0)}
              sub={`${d?.agenda.semana ?? 0} esta semana`}
              onClick={() => onSelectModule?.("Mi Agenda")}
            />
            <Dato
              etiqueta="Pedidos del mes"
              valor={String(d?.ventas.pedidos ?? 0)}
              sub={`Ticket ${money(d?.ventas.ticketPromedio ?? 0)}`}
              onClick={() => onSelectModule?.("Pedidos CRM")}
            />
          </div>
        </PanelCard>
      </div>

    </div>
  )
}

function Pendiente({
  icono: Icono, texto, tono, onClick,
}: {
  icono: LucideIcon
  texto: string
  tono: "primary" | "warning" | "danger"
  onClick?: () => void
}) {
  const estilo =
    tono === "danger" ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
      : tono === "warning" ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
        : "border-[#0f7b6f]/40 bg-[#0f7b6f]/10 text-[#0c6b61] hover:bg-[#0f7b6f]/20"

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${estilo}`}
    >
      <Icono className="h-4 w-4 shrink-0" aria-hidden="true" />
      {texto}
      <ArrowRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
    </button>
  )
}

function Dato({
  etiqueta, valor, sub, onClick,
}: {
  etiqueta: string
  valor: string
  sub?: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/50"
    >
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="mt-0.5 font-bold tabular-nums text-foreground">{valor}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </button>
  )
}

export default InicioDashboard
