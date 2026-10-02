"use client"

// "Continuar donde ibas" (Inicio): las últimas pantallas abiertas y las
// favoritas del usuario, como chips. Solo muestra lo que el usuario puede ver.
// Calcado de LIPgo para que las dos aplicaciones se usen igual.

import { Clock, Star } from "lucide-react"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { useNavegacionPersonal } from "@/hooks/use-navegacion-personal"
import { groups } from "@/lib/dashboard-data"
import { TINTE_AREA } from "@/components/module-cards"

function grupoDe(modulo: string) {
  for (const g of groups) {
    const m = [...(g.modules ?? []), ...(g.subgroups?.flatMap((s) => s.modules) ?? [])].find((x) => x.name === modulo)
    if (m) return { grupo: g, modulo: m }
  }
  return null
}

export function ContinuarReciente({ onNavigate }: { onNavigate: (modulo: string) => void }) {
  const { isModuleVisible } = useModulePermissions()
  const { recientes, favoritos } = useNavegacionPersonal()

  const visible = (m: string) => grupoDe(m) !== null && isModuleVisible(m)
  const rec = recientes.map((r) => r.modulo).filter(visible).slice(0, 4)
  const fav = favoritos.filter(visible).filter((m) => !rec.includes(m)).slice(0, 4)
  if (rec.length === 0 && fav.length === 0) return null

  const Chip = ({ m, icono }: { m: string; icono: "reciente" | "favorito" }) => {
    const e = grupoDe(m)!
    const Icon = e.modulo.icon
    const tint = TINTE_AREA[e.grupo.key] ?? "#5b6b7f"
    return (
      <button
        type="button"
        onClick={() => onNavigate(m)}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card py-1 pl-1.5 pr-3 text-xs shadow-sm transition-colors hover:bg-accent"
        title={`${e.grupo.title} › ${e.modulo.label ?? m}`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${tint} 14%, #fff)`, color: tint }}>
          {Icon ? <Icon className="h-3.5 w-3.5" /> : icono === "favorito" ? <Star className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
        </span>
        <span className="truncate font-medium text-foreground">{e.modulo.label ?? m}</span>
        <span className="hidden truncate text-[10.5px] text-muted-foreground sm:inline">· {e.grupo.title}</span>
        {icono === "favorito" && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
      </button>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-extrabold tracking-tight text-foreground">Continuar donde ibas</h2>
        <span className="text-xs text-muted-foreground">· recientes y favoritos · Ctrl K para buscar</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {rec.map((m) => <Chip key={`r:${m}`} m={m} icono="reciente" />)}
        {fav.map((m) => <Chip key={`f:${m}`} m={m} icono="favorito" />)}
      </div>
    </div>
  )
}

export default ContinuarReciente
