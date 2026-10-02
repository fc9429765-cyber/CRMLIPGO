"use client"

// PORTAL DE ÁREA (segundo nivel): lo que se ve tras elegir un área del menú.
// Calcado del rediseño de LIPgo (components/modules-view.tsx):
//   1. Encabezado con contexto vivo: empresa, fecha y cuántas pantallas.
//   2. Las PANTALLAS como mosaicos que hablan: color del área, para qué sirve
//      (lib/modulos-info.ts), sus capacidades como chips, un distintivo con
//      los pendientes que el radar encontró para esa pantalla, y la estrella
//      de favorito que la sube a "Continuar donde ibas".
//
// Solo muestra lo que el usuario puede abrir (mismo filtro que el menú).

import { useMemo, type CSSProperties } from "react"
import { ArrowLeft, ArrowRight, Star } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { useNavegacionPersonal } from "@/hooks/use-navegacion-personal"
import { filterGroupsByPermissions, type GroupKey, type Module } from "@/lib/dashboard-data"
import { infoDeModulo } from "@/lib/modulos-info"
import { pendientesPorModulo, useRadar, type PendienteModulo } from "@/lib/radar-cliente"
import { TINTE_AREA } from "@/components/module-cards"

interface ModulesViewProps {
  selectedGroup: GroupKey
  onSelectModule: (moduleName: string) => void
  onBack?: () => void
}

function fechaLarga(): string {
  const f = new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" })
  return f.charAt(0).toUpperCase() + f.slice(1)
}

function Mosaico({
  modulo, tinte, pendiente, favorito, onFavorito, onSelect,
}: {
  modulo: Module
  tinte: string
  pendiente?: PendienteModulo
  favorito: boolean
  onFavorito: () => void
  onSelect: () => void
}) {
  const Icono = modulo.icon
  const info = infoDeModulo(modulo.name)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect() } }}
      className="mosaico group"
      style={{ "--tint": tinte } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span className="mos-ico"><Icono className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="mos-title">{modulo.label ?? modulo.name}</h3>
            <button
              type="button"
              aria-label={favorito ? "Quitar de favoritos" : "Marcar como favorito"}
              title={favorito ? "Quitar de favoritos" : "Marcar como favorito"}
              onClick={(e) => { e.stopPropagation(); onFavorito() }}
              className={`mos-star ${favorito ? "is-fav" : ""}`}
            >
              <Star className="h-4 w-4" />
            </button>
          </div>
          {info.descripcion && <p className="mos-desc">{info.descripcion}</p>}
        </div>
      </div>

      {info.chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {info.chips.map((c) => <span key={c} className="mos-tab">{c}</span>)}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        {pendiente && pendiente.cantidad > 0 ? (
          <span className={`mos-badge ${pendiente.alto ? "is-alto" : "is-medio"}`} title={pendiente.texto}>
            <span className="mos-dot" />
            {pendiente.cantidad} pendiente{pendiente.cantidad === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-[10.5px] text-muted-foreground/70">Sin pendientes</span>
        )}
        <span className="mos-enter">Abrir <ArrowRight className="h-3.5 w-3.5" /></span>
      </div>
    </div>
  )
}

export function ModulesView({ selectedGroup, onSelectModule, onBack }: ModulesViewProps) {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const { allowedModules, loaded, isModuleVisible } = useModulePermissions()
  const { esFavorito, toggleFavorito } = useNavegacionPersonal()
  const { datos: radar } = useRadar(selectedEmpresaId ?? 1)
  const pendientes = useMemo(() => pendientesPorModulo(radar), [radar])

  const grupo = useMemo(
    () => filterGroupsByPermissions(isModuleVisible, loaded, new Set(allowedModules)).find((g) => g.key === selectedGroup),
    [selectedGroup, isModuleVisible, loaded, allowedModules],
  )

  if (!grupo) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-muted-foreground">No tienes acceso a los módulos de esta sección.</p>
        {onBack && (
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent">
            <ArrowLeft className="h-4 w-4" /> Volver
          </button>
        )}
      </div>
    )
  }

  const IconoGrupo = grupo.icon
  const tinte = TINTE_AREA[selectedGroup] ?? TINTE_AREA.configuracion
  const secciones = grupo.subgroups?.length
    ? grupo.subgroups.map((sg) => ({ titulo: sg.title as string | null, modulos: sg.modules }))
    : [{ titulo: null as string | null, modulos: grupo.modules ?? [] }]
  const total = secciones.reduce((n, s) => n + s.modulos.length, 0)
  const pendArea = secciones.flatMap((s) => s.modulos).reduce((n, m) => n + (pendientes[m.name]?.cantidad ?? 0), 0)

  return (
    <div className="space-y-5" style={{ "--tint": tinte } as CSSProperties}>
      <style>{`
        .mosaico{ position:relative; display:flex; flex-direction:column; border-radius:16px; background:var(--card,#fff);
          border:1px solid #e7edf4; padding:14px 14px 12px; text-align:left; cursor:pointer; overflow:hidden; outline:none;
          transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
        .mosaico::before{ content:""; position:absolute; inset:0; border-radius:16px; padding:1.2px; pointer-events:none;
          background:linear-gradient(135deg, color-mix(in srgb, var(--tint) 68%, transparent), transparent 60%);
          -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude;
          opacity:0; transition:opacity .16s; }
        .mosaico:hover, .mosaico:focus-visible{ transform:translateY(-2px); border-color:transparent;
          box-shadow:0 12px 26px color-mix(in srgb, var(--tint) 22%, transparent), 0 4px 10px rgba(20,42,68,.05); }
        .mosaico:hover::before, .mosaico:focus-visible::before{ opacity:1; }
        .mos-ico{ width:40px; height:40px; flex:none; border-radius:12px; display:flex; align-items:center; justify-content:center;
          background:color-mix(in srgb, var(--tint) 14%, #fff); color:var(--tint);
          box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--tint) 22%, transparent); transition:transform .16s, background .16s, color .16s; }
        .mosaico:hover .mos-ico{ transform:scale(1.06); color:#fff; background:linear-gradient(135deg, var(--tint), color-mix(in srgb, var(--tint) 62%, #000)); }
        .mos-title{ font-size:14.5px; font-weight:800; line-height:1.15; color:#132a44; letter-spacing:-.01em; }
        .mos-desc{ margin-top:3px; font-size:11.5px; line-height:1.35; color:#5f7390; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .mos-star{ flex:none; color:#c9d3df; border-radius:8px; padding:2px; transition:color .15s, transform .15s; }
        .mos-star:hover{ color:#f59e0b; transform:scale(1.1); }
        .mos-star.is-fav{ color:#f59e0b; } .mos-star.is-fav svg{ fill:#f59e0b; }
        .mos-tab{ display:inline-flex; align-items:center; gap:4px; border-radius:999px; border:1px solid #e7edf4; background:#f6f9fc;
          padding:3px 9px; font-size:11px; font-weight:600; color:#3d5168; }
        .mos-badge{ display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:3px 9px 3px 7px; font-size:11px; font-weight:700; }
        .mos-badge.is-medio{ background:#fffbeb; color:#92400e; border:1px solid #fcd34d; }
        .mos-badge.is-alto{ background:#fef2f2; color:#991b1b; border:1px solid #fca5a5; }
        .mos-dot{ width:7px; height:7px; border-radius:999px; background:currentColor; }
        .mos-enter{ display:inline-flex; align-items:center; gap:3px; font-size:11.5px; font-weight:800; color:var(--tint);
          opacity:0; transform:translateX(-6px); transition:opacity .16s, transform .16s; }
        .mosaico:hover .mos-enter, .mosaico:focus-visible .mos-enter{ opacity:1; transform:none; }
        @media (prefers-reduced-motion:reduce){ .mosaico, .mosaico *{ transition:none !important; } .mosaico:hover{ transform:none } }
      `}</style>

      {/* Encabezado con contexto vivo */}
      <div className="flex flex-wrap items-start gap-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Volver"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <span
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${tinte} 15%, #fff)`, color: tinte, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tinte} 22%, transparent)` }}
        >
          <IconoGrupo className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight text-foreground sm:text-2xl">{grupo.title}</h1>
          <p className="text-[13px] text-muted-foreground">
            {selectedEmpresaNombre ?? "Harinera Indupan"} · {fechaLarga()} · {total} pantalla{total === 1 ? "" : "s"}
            {pendArea > 0 && <span className="font-semibold text-red-700"> · {pendArea} pendiente{pendArea === 1 ? "" : "s"} hoy</span>}
          </p>
        </div>
      </div>

      {secciones.map((seccion, i) => (
        <section key={seccion.titulo ?? i} className="space-y-3">
          {seccion.titulo && <h3 className="text-sm font-medium text-muted-foreground">{seccion.titulo}</h3>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {seccion.modulos.map((modulo) => (
              <Mosaico
                key={modulo.name}
                modulo={modulo}
                tinte={tinte}
                pendiente={pendientes[modulo.name]}
                favorito={esFavorito(modulo.name)}
                onFavorito={() => toggleFavorito(modulo.name)}
                onSelect={() => onSelectModule(modulo.name)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default ModulesView
