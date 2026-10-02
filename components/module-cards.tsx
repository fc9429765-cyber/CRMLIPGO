"use client"

// Tarjetas de "Áreas" en el Inicio: una por área del CRM. Calcadas de las
// de LIPgo (components/module-cards.tsx): icono en caja tintada, nombre, y
// debajo cuántas pantallas tiene o —si el radar encontró algo— un distintivo
// rojo con los pendientes del área. El punto en el distintivo es lo que
// permite ver de reojo dónde hay trabajo sin leer siete tarjetas.
//
// UN SOLO tinte por área, no un degradado: el icono nace pastel sobre blanco
// y solo se rellena de color al pasar por encima.

import type { CSSProperties } from "react"
import { ArrowRight } from "lucide-react"
import { groups, filterGroupsByPermissions } from "@/lib/dashboard-data"
import type { GroupKey } from "@/lib/dashboard-data"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import type { PendienteModulo } from "@/lib/radar-cliente"

interface ModuleCardsProps {
  onSelectGroup: (group: GroupKey) => void
  onSelectModule?: (module: string) => void
  /** Pendientes por área (lib/radar-cliente.ts). Sin ellos, solo cuenta pantallas. */
  pendientes?: Record<string, PendienteModulo>
}

/** Color por área. Los mismos tonos de la paleta de LIPgo, reasignados a las
 *  áreas del CRM. También los usan el portal de cada área y los recientes. */
export const TINTE_AREA: Record<string, string> = {
  inicio: "#4f63c4",
  prospectos: "#7b57c9",
  ventas: "#c56a2a",
  clientes: "#1f8fb0",
  cartera: "#2f9b64",
  inteligencia: "#c65893",
  configuracion: "#6b7683",
}

function contarModulos(group: (typeof groups)[number]): number {
  return (group.modules?.length ?? 0) + (group.subgroups?.reduce((n, sg) => n + sg.modules.length, 0) ?? 0)
}

export function ModuleCards({ onSelectGroup, pendientes = {} }: ModuleCardsProps) {
  const { loaded, allowedModules, isModuleVisible } = useModulePermissions()
  const visibleGroups = filterGroupsByPermissions(isModuleVisible, loaded, allowedModules)

  return (
    <div>
      <style>{`
        .apps-grid{ --r:18px; }
        .app-tile{ position:relative; display:flex; flex-direction:column; gap:12px; border-radius:var(--r);
          background:var(--card,#fff); border:1px solid #e7edf4; padding:16px; text-align:left; cursor:pointer; overflow:hidden;
          transition:transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
        .app-tile::after{ content:""; position:absolute; top:-40%; right:-30%; width:140px; height:140px; border-radius:50%;
          background:radial-gradient(closest-side, color-mix(in srgb, var(--tint) 28%, transparent), transparent);
          opacity:.35; transition:opacity .25s, transform .25s; pointer-events:none; }
        .app-tile::before{ content:""; position:absolute; inset:0; border-radius:var(--r); padding:1.3px; pointer-events:none;
          background:linear-gradient(135deg, color-mix(in srgb, var(--tint) 70%, transparent), transparent 62%);
          -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude;
          opacity:0; transition:opacity .2s; }
        .app-tile:hover, .app-tile:focus-visible{ transform:translateY(-3px); border-color:transparent; outline:none;
          box-shadow:0 18px 38px color-mix(in srgb, var(--tint) 26%, transparent), 0 6px 14px rgba(20,42,68,.06); }
        .app-tile:hover::before, .app-tile:focus-visible::before{ opacity:1; }
        .app-tile:hover::after{ opacity:.6; transform:scale(1.15); }
        .app-ico{ position:relative; z-index:1; width:46px; height:46px; border-radius:14px; display:flex; align-items:center; justify-content:center;
          background:color-mix(in srgb, var(--tint) 14%, #fff); color:var(--tint); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--tint) 22%, transparent);
          transition:transform .2s, background .2s, color .2s, box-shadow .2s; }
        .app-tile:hover .app-ico{ transform:scale(1.06) rotate(-3deg); color:#fff;
          background:linear-gradient(135deg, var(--tint), color-mix(in srgb, var(--tint) 62%, #000));
          box-shadow:0 10px 22px color-mix(in srgb, var(--tint) 42%, transparent); }
        .app-name{ position:relative; z-index:1; font-size:15px; font-weight:800; line-height:1.15; color:#132a44; letter-spacing:-.01em; }
        .app-foot{ position:relative; z-index:1; display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:22px; }
        .app-count{ font-size:11.5px; color:#7387a0; font-weight:500; }
        .app-pend{ display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:3px 9px 3px 7px; font-size:11px; font-weight:700;
          background:#fef2f2; color:#991b1b; border:1px solid #fca5a5; max-width:100%; }
        .app-pend.is-medio{ background:#fffbeb; color:#92400e; border-color:#fcd34d; }
        .app-pend .dot{ width:7px; height:7px; border-radius:999px; background:currentColor; flex:none; }
        .app-enter{ display:inline-flex; align-items:center; gap:3px; font-size:11.5px; font-weight:800; color:var(--tint);
          opacity:0; transform:translateX(-6px); transition:opacity .2s, transform .2s; flex:none; }
        .app-tile:hover .app-enter{ opacity:1; transform:none; }
        @keyframes app-in{ from{ opacity:0; transform:translateY(10px) } to{ opacity:1; transform:none } }
        .app-tile{ animation:app-in .38s both; }
        @media (prefers-reduced-motion:reduce){ .app-tile, .app-tile *{ transition:none !important; animation:none !important; } .app-tile:hover{ transform:none } .app-tile:hover .app-ico{ transform:none } }
      `}</style>

      <div className="mb-3 flex items-baseline gap-2 sm:mb-5">
        <h2 className="text-sm font-extrabold tracking-tight text-foreground sm:text-lg">Áreas</h2>
        <span className="text-xs text-muted-foreground">· elige una para entrar · el punto marca dónde hay pendientes hoy</span>
      </div>

      <div className="apps-grid grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {visibleGroups.map((group, i) => {
          const Icono = group.icon
          const tinte = TINTE_AREA[group.key] ?? "#5b6b7f"
          const pantallas = contarModulos(group)
          const pend = pendientes[group.key]
          return (
            <button
              key={group.key}
              onClick={() => onSelectGroup(group.key as GroupKey)}
              className="app-tile"
              style={{ "--tint": tinte, animationDelay: `${i * 55}ms` } as CSSProperties}
            >
              <span className="app-ico"><Icono className="h-[22px] w-[22px]" aria-hidden="true" /></span>
              <span className="app-name">{group.title}</span>
              <span className="app-foot">
                {pend && pend.cantidad > 0 ? (
                  <span className={`app-pend ${pend.alto ? "" : "is-medio"}`} title={pend.texto}>
                    <span className="dot" />
                    {pend.cantidad} pendiente{pend.cantidad === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="app-count">{pantallas} pantalla{pantallas === 1 ? "" : "s"}</span>
                )}
                <span className="app-enter">Entrar <ArrowRight className="h-3.5 w-3.5" /></span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
