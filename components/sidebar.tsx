"use client"

import {
  Home,
  FileText,
  Search,
  LayoutDashboard,
  Settings,
  Menu,
  X,
  ChevronDown,
  Users,
  Wallet,
  BadgeCheck,
} from "lucide-react"
import Image from "next/image"
import type { GroupKey, Module, Subgroup } from "@/lib/dashboard-data"
import { groups, GRUPOS_SIN_FILTRO_PROTEGIDO } from "@/lib/dashboard-data"
import { useState, useEffect, useMemo, type CSSProperties } from "react"

interface SidebarProps {
  selectedGroup: GroupKey | null
  selectedModule: string | null
  onSelectGroup: (group: GroupKey | null) => void
  onSelectModule: (module: string | null) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

interface UserModulesResponse {
  protectedModules: string[]
  allowedModules: string[]
}


/**
 * Glifo del heroe segun el grupo activo, para que la cabecera del menu hable
 * el idioma de la seccion. Solo presentacion: el color lo hereda por CSS
 * (var(--hero)) desde el contenedor. Sin grupo (Inicio) muestra el glifo de
 * marca.
 */
function HeroActor({ groupKey }: { groupKey: GroupKey | null }) {
  switch (groupKey) {
    case "prospectos": // persona con senal de contacto
      return (
        <>
          <circle cx="11" cy="4" r="2.7" className="hero-light" />
          <path d="M11 7 c-3 0-5 2-5 5 v3 h10 v-3 c0-3-2-5-5-5 z" className="hero-light" />
          <circle cx="16.5" cy="4.5" r="1.8" className="hero-accent" />
        </>
      )
    case "ventas": // carrito
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4 h2.6 l2 8 h8.6 l2-6 h-11.8" className="hero-lightstroke" strokeWidth="1.6" />
          <circle cx="9" cy="14.6" r="1.5" className="hero-accent" fill="currentColor" />
          <circle cx="15.6" cy="14.6" r="1.5" className="hero-accent" fill="currentColor" />
        </g>
      )
    case "clientes": // dos personas
      return (
        <>
          <circle cx="8" cy="5" r="2.4" className="hero-light" />
          <path d="M8 7.8 c-2.6 0-4.4 1.8-4.4 4.4 v2.6 h8.8 v-2.6 c0-2.6-1.8-4.4-4.4-4.4 z" className="hero-light" />
          <circle cx="15" cy="6.2" r="2" className="hero-accent" />
          <path d="M15 8.6 c-2.1 0-3.6 1.5-3.6 3.6 v2.6 h7.2 v-2.6 c0-2.1-1.5-3.6-3.6-3.6 z" className="hero-accent" />
        </>
      )
    case "cartera": // billetera con moneda
      return (
        <>
          <rect x="4" y="5.5" width="14" height="10" rx="2" className="hero-light" />
          <path d="M4 8.6 h14" className="hero-lightstroke" strokeWidth="1.1" />
          <circle cx="14.6" cy="11.4" r="1.5" className="hero-accent" />
        </>
      )
    case "inteligencia": // chispa
      return (
        <>
          <path d="M11 2 l1.9 5.1 5.1 1.9 -5.1 1.9 -1.9 5.1 -1.9-5.1 -5.1-1.9 5.1-1.9 z" className="hero-light" />
          <circle cx="11" cy="9" r="1.6" className="hero-accent" />
        </>
      )
    case "configuracion": // controles
      return (
        <g strokeLinecap="round">
          <line x1="4" y1="5" x2="18" y2="5" className="hero-lightstroke" strokeWidth="1.5" />
          <line x1="4" y1="9" x2="18" y2="9" className="hero-lightstroke" strokeWidth="1.5" />
          <line x1="4" y1="13" x2="18" y2="13" className="hero-lightstroke" strokeWidth="1.5" />
          <circle cx="9" cy="5" r="2" className="hero-accent" />
          <circle cx="14" cy="9" r="2" className="hero-accent" />
          <circle cx="7" cy="13" r="2" className="hero-accent" />
        </g>
      )
    case "inicio":
    default: // grafico ascendente: la marca del CRM
      return (
        <>
          <path d="M4 14 l4-4 3 3 5-6" fill="none" className="hero-lightstroke" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16" cy="7" r="2" className="hero-accent" />
        </>
      )
  }
}

export function Sidebar({
  selectedGroup,
  selectedModule,
  onSelectGroup,
  onSelectModule,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<GroupKey>>(new Set())
  const [expandedSubgroups, setExpandedSubgroups] = useState<Set<string>>(new Set())
  // Texto del buscador de modulos del menu lateral.
  const [moduleSearch, setModuleSearch] = useState("")

  // Permisos del usuario para filtrar el menu. Se cargan una sola vez al
  // montar el sidebar y se mantienen en memoria. Hasta que se reciba la
  // respuesta `permissionsLoaded` queda en false: durante esa ventana no
  // se aplica filtro (se muestran todos los grupos), evitando que el menu
  // aparezca vacio en el primer render. Como adicional barrera, el
  // `PermissionGuard` que envuelve cada modulo bloquea cualquier acceso
  // que se cuele por un click rapido durante esos milisegundos.
  const [protectedModules, setProtectedModules] = useState<Set<string>>(new Set())
  const [allowedModules, setAllowedModules] = useState<Set<string>>(new Set())
  const [permissionsLoaded, setPermissionsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadPermissions = async () => {
      try {
        // `no-store` obligatorio: sin esto el navegador puede servir una
        // respuesta cacheada y un permiso recién otorgado NO aparece en el
        // menú hasta un refresco fuerte. Mismo criterio que ya usan
        // useAsistenciaAlerts / useOperacionesDiaAlerts contra este endpoint.
        const res = await fetch("/api/user-modules", { method: "GET", cache: "no-store" })
        if (!res.ok) {
          console.error("[v0] Sidebar: failed to fetch user-modules:", res.status)
          if (!cancelled) setPermissionsLoaded(true)
          return
        }
        const data = (await res.json()) as UserModulesResponse
        if (cancelled) return
        setProtectedModules(new Set(data.protectedModules))
        setAllowedModules(new Set(data.allowedModules))
        setPermissionsLoaded(true)
      } catch (error) {
        console.error("[v0] Sidebar: error loading permissions:", error)
        if (!cancelled) setPermissionsLoaded(true)
      }
    }
    loadPermissions()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Decide si un modulo concreto debe verse en el menu.
   *  - Antes de cargar los permisos: se muestra (estado neutro).
   *  - Si el modulo NO esta protegido (no aparece en protectedModules):
   *    se muestra siempre.
   *  - Si esta protegido: se muestra solo si esta en allowedModules.
   */
  const isModuleVisible = (moduleName: string): boolean => {
    if (!permissionsLoaded) return true
    if (!protectedModules.has(moduleName)) return true
    return allowedModules.has(moduleName)
  }

  useEffect(() => {
    if (selectedGroup && selectedModule) {
      // When a module is selected, ensure only its group is expanded
      setExpandedGroups(new Set([selectedGroup]))
    }
  }, [selectedGroup, selectedModule])

  const toggleGroup = (key: GroupKey) => {
    const newExpanded = new Set<GroupKey>()
    if (!expandedGroups.has(key)) {
      newExpanded.add(key)
    }
    setExpandedGroups(newExpanded)
  }

  const toggleSubgroup = (groupKey: GroupKey, subgroupTitle: string) => {
    const key = `${groupKey}-${subgroupTitle}`
    const newExpanded = new Set(expandedSubgroups)
    if (newExpanded.has(key)) {
      newExpanded.delete(key)
    } else {
      newExpanded.add(key)
    }
    setExpandedSubgroups(newExpanded)
  }

  /**
   * Construye la lista efectiva de grupos a renderizar tras aplicar el
   * filtro de permisos. La logica:
   *   - En cada subgrupo se filtran sus modulos. Si queda vacio, el
   *     subgrupo se descarta.
   *   - En los modulos directos del grupo se aplica el mismo filtro.
   *   - Si el grupo se queda sin subgrupos visibles ni modulos directos,
   *     se descarta entero (no aparece en el sidebar).
   *
   * Memoizado por `permissionsLoaded` y los sets para no recomputar en
   * cada render mientras el usuario hace clicks.
   */
  const visibleGroups = useMemo(() => {
    return groups
      .map((group) => {
        const filteredSubgroups: Subgroup[] | undefined = group.subgroups
          ?.map((sg) => ({
            ...sg,
            modules: sg.modules.filter((m: Module) => isModuleVisible(m.name)),
          }))
          .filter((sg) => sg.modules.length > 0)

        const filteredModules: Module[] | undefined = group.modules?.filter(
          (m) => isModuleVisible(m.name),
        )

        const hasVisibleSubgroups = (filteredSubgroups?.length ?? 0) > 0
        const hasVisibleModules = (filteredModules?.length ?? 0) > 0
        if (!hasVisibleSubgroups && !hasVisibleModules) return null

        // Regla adicional: ocultar el GRUPO completo cuando el usuario
        // no tiene permiso sobre NINGUN modulo protegido del grupo.
        // Antes el grupo se mostraba si quedaba siquiera un modulo
        // visible (incluyendo modulos no protegidos como "Ingresos MP",
        // "Saldos de empaque", "Gestion de Colaboradores", etc.) lo
        // que dejaba ver categorias enteras a usuarios sin acceso real
        // a su contenido. Esta verificacion exige que al menos UN
        // modulo protegido permitido viva en el grupo. Mientras los
        // permisos aun no terminan de cargar, no aplicamos este filtro
        // (`permissionsLoaded` false) para evitar parpadeos.
        // Grupos exentos del filtro de "al menos un modulo protegido
        // permitido". En el CRM no hay ninguno: todos los modulos estan
        // protegidos por permiso.
        //
        // La lista se importa de dashboard-data.ts en vez de repetirse aqui.
        // Antes estaba duplicada en los dos archivos y agregar un grupo exigia
        // acordarse de tocar ambos, que es la clase de detalle que se olvida.
        if (permissionsLoaded && !GRUPOS_SIN_FILTRO_PROTEGIDO.includes(group.key)) {
          const allModulesInGroup = [
            ...(filteredModules ?? []),
            ...((filteredSubgroups ?? []).flatMap((sg) => sg.modules)),
          ]
          const hasAtLeastOneAllowedProtected = allModulesInGroup.some((m) =>
            allowedModules.has(m.name),
          )
          if (!hasAtLeastOneAllowedProtected) return null
        }

        return {
          ...group,
          subgroups: filteredSubgroups,
          modules: filteredModules,
        }
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoaded, allowedModules, protectedModules])

  // Items del menu lateral, en el orden del flujo comercial: primero lo que
  // se mira a diario, luego la venta, el cliente, el cobro, y al final lo que
  // se configura una vez.
  //
  // OJO: `key` debe coincidir con el `key` de un grupo de lib/dashboard-data.ts.
  // Un item cuyo key no exista alli se filtra y NO APARECE: fue justo lo que
  // paso al heredar este archivo de LIPgo, que listaba sus grupos operativos
  // ("despachos", "inventarios", "rrhh", "sst"...) y dejaba el menu con solo
  // "Inicio", porque ninguno existe ya.
  const allMenuItems = [
    { key: null, label: "Inicio", icon: Home },
    { key: "inicio" as GroupKey, label: "Tablero", icon: LayoutDashboard },
    { key: "prospectos" as GroupKey, label: "Prospectos", icon: Users },
    { key: "ventas" as GroupKey, label: "Ventas", icon: FileText },
    { key: "clientes" as GroupKey, label: "Clientes", icon: Users },
    { key: "cartera" as GroupKey, label: "Cartera", icon: Wallet },
    { key: "inteligencia" as GroupKey, label: "Inteligencia", icon: BadgeCheck },
    { key: "configuracion" as GroupKey, label: "Configuración", icon: Settings },
  ]

  // Filtra los items del menu superior para ocultar los grupos cuyos
  // modulos quedaron todos sin permiso. "Inicio" (key === null) siempre
  // se muestra: no es un grupo de modulos.
  const menuItems = allMenuItems.filter((item) => {
    if (item.key === null) return true
    return visibleGroups.some((g) => g.key === item.key)
  })

  // REORG visual (estilo Odoo): color de dominio por grupo para los íconos.
  // Color de dominio por grupo, para el icono y el heroe de la cabecera.
  //
  // Son los MISMOS que usan las tarjetas de Inicio (components/module-cards),
  // aclarados para que se lean sobre el fondo oscuro del menu: que cartera sea
  // verde aqui y alla es lo que permite reconocer el area sin leer su nombre.
  const GROUP_TINT: Record<string, string> = {
    inicio: "#3b9eff",        // azul
    prospectos: "#a855f7",    // violeta
    ventas: "#fb923c",        // naranja
    clientes: "#22d3ee",      // cian
    cartera: "#34d399",       // verde
    inteligencia: "#f472b6",  // magenta
    configuracion: "#94a3b8", // gris
  }

  // Color del héroe = tinte del área activa (o cian de marca en Inicio). Alimenta
  // rutas, hub, glow y el actor temático vía la variable CSS --hero.
  const heroAccent = (selectedGroup ? GROUP_TINT[selectedGroup] : undefined) ?? "#2fd4b6"

  // Lista plana de todos los modulos visibles, con su grupo, etiqueta del
  // grupo, subgrupo (si aplica) e icono. Sirve para el buscador.
  const allModulesFlat = useMemo(() => {
    const groupLabelByKey = new Map(allMenuItems.map((i) => [i.key, i.label]))
    const result: {
      groupKey: GroupKey
      groupLabel: string
      subgroupTitle?: string
      name: string
      label: string
      icon: Module["icon"]
    }[] = []
    for (const g of visibleGroups) {
      const groupLabel = (groupLabelByKey.get(g.key) as string) ?? g.title
      const pushModule = (m: Module, subgroupTitle?: string) => {
        result.push({
          groupKey: g.key,
          groupLabel,
          subgroupTitle,
          name: m.name,
          label: m.label ?? m.name,
          icon: m.icon,
        })
      }
      g.subgroups?.forEach((sg) => sg.modules.forEach((m) => pushModule(m, sg.title)))
      g.modules?.forEach((m) => pushModule(m))
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleGroups])

  const normalizedSearch = moduleSearch.trim().toLowerCase()
  const searchResults =
    normalizedSearch.length > 0
      ? allModulesFlat.filter(
          (m) =>
            m.label.toLowerCase().includes(normalizedSearch) ||
            m.name.toLowerCase().includes(normalizedSearch) ||
            m.groupLabel.toLowerCase().includes(normalizedSearch) ||
            (m.subgroupTitle?.toLowerCase().includes(normalizedSearch) ?? false),
        )
      : []

  // Al elegir un modulo desde el buscador: navega, expande su grupo y limpia.
  const handleSelectFromSearch = (groupKey: GroupKey, moduleName: string) => {
    onSelectGroup(groupKey)
    onSelectModule(moduleName)
    setExpandedGroups(new Set([groupKey]))
    setModuleSearch("")
  }

  return (
    <>
      {/* Rediseño "Torre de Control" (2026-07-03): re-skin OSCURO premium del
          sidebar redefiniendo las variables de tema SOLO dentro de .lipgo-sb
          (no cambia el resto de la app), + hero animado de logística. No toca
          permisos ni rutas. */}
      <style>{`
        .lipgo-sb{
          --card:#0b3b35; --card-foreground:#ffffff; --foreground:#ffffff;
          --background:#0d4740; --muted-foreground:#cfe8e2;
          --accent:#155a51; --accent-foreground:#ffffff;
          --border:#1d5e55; --input:#1d5e55; --primary:#2fd4b6; --ring:#2fd4b6;
          background-image:linear-gradient(180deg,#0b3b35,#072c27);
        }
        /* Letras del menú en BLANCO con alto contraste (peticion de diseño). */
        .lipgo-sb nav button span{ color:#ffffff; }
        .lipgo-sb nav button{ color:#eaf4ff; }
        .lipgo-sb .bg-primary{ box-shadow:0 0 12px rgba(47,212,182,.65); }
        .lipgo-hero-bg{ background:
          radial-gradient(120% 90% at 82% 0%, color-mix(in srgb, var(--hero,#2fd4b6) 34%, transparent), transparent 58%),
          radial-gradient(95% 85% at 0% 100%, rgba(20,110,95,.42), transparent 55%);
          transition: background .5s ease; }
        .lipgo-tag{ font:600 10px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:.14em; text-transform:uppercase; color:#8fe8d2; display:flex; align-items:center; gap:6px; }
        .lipgo-live{ width:6px; height:6px; border-radius:50%; background:#37f5a0; box-shadow:0 0 8px #37f5a0; }
        .lipgo-logo-mark{ width:30px; height:30px; border-radius:9px; background:linear-gradient(135deg,#0a4f46,#2fd4b6); display:flex; align-items:center; justify-content:center; font:800 15px/1 sans-serif; color:#fff; box-shadow:0 0 14px rgba(47,212,182,.5); }
        .lipgo-word{ font:800 19px/1 sans-serif; letter-spacing:-.02em; color:#fff; }
        .lipgo-tile{ display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:8px; background:#124a43; border:1px solid #1f6359; flex:none; }
        .lipgo-route{ stroke: color-mix(in srgb, var(--hero,#7fe0cc) 58%, transparent); stroke-width:1.6; fill:none; stroke-linecap:round; stroke-dasharray:5 6; transition: stroke .5s ease; }
        .lipgo-route.b{ stroke: color-mix(in srgb, var(--hero,#7fe0cc) 26%, transparent); }
        .lipgo-node{ fill:#cff7ef; } .lipgo-node.hub{ fill: var(--hero,#2fd4b6); transition: fill .5s ease; }
        /* Actor temático del héroe (adaptativo por módulo). El color viene de --hero. */
        .hero-light{ fill:#dff7f1; } .hero-accent{ fill: var(--hero,#2fd4b6); }
        .hero-lightstroke{ stroke:#dff7f1; } .hero-accent-stroke{ stroke: var(--hero,#2fd4b6); }
        .lipgo-sect{ font:700 9.5px/1 sans-serif; letter-spacing:.16em; text-transform:uppercase; color:#6f9a92; padding:13px 14px 5px; }
        @media (prefers-reduced-motion: no-preference){
          .lipgo-route{ animation: lipgo-flow 1.1s linear infinite; }
          .lipgo-actor{ animation: lipgo-run 6s ease-in-out infinite, lipgo-fadein .5s ease-out; }
          .lipgo-gear{ transform-box: fill-box; transform-origin: center; animation: lipgo-spin 3.4s linear infinite; }
          .lipgo-hub-ring{ animation: lipgo-ring 2.8s ease-out infinite; }
          .lipgo-live{ animation: lipgo-blink 1.8s ease-in-out infinite; }
        }
        @keyframes lipgo-flow{ to{ stroke-dashoffset:-22; } }
        @keyframes lipgo-run{ 0%{transform:translateX(4px)} 50%{transform:translateX(150px)} 100%{transform:translateX(4px)} }
        @keyframes lipgo-spin{ to{ transform: rotate(360deg); } }
        @keyframes lipgo-fadein{ from{ opacity:0 } to{ opacity:1 } }
        @keyframes lipgo-ring{ 0%{ r:3; opacity:.85 } 100%{ r:15; opacity:0 } }
        @keyframes lipgo-blink{ 0%,100%{opacity:1} 50%{opacity:.35} }
      `}</style>

      {/* Desktop Sidebar */}
      <aside
        className={`lipgo-sb hidden md:flex flex-col h-screen border-r border-border z-20 transition-all duration-300 ${collapsed ? "w-16 lg:w-20" : "w-56 lg:w-64"}`}
      >
        {/* Hero de marca — Torre de Control (red de operación animada) */}
        <div
          className={`relative flex-shrink-0 overflow-hidden border-b border-border ${collapsed ? "h-16 lg:h-20" : "h-32"}`}
          style={{ "--hero": heroAccent } as CSSProperties}
        >
          {!collapsed && (
            <>
              <div className="lipgo-hero-bg absolute inset-0" aria-hidden="true" />
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 264 128" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                <path className="lipgo-route b" d="M-10 40 C 60 40, 90 96, 170 96 S 260 60, 280 62" />
                <path className="lipgo-route" d="M-10 92 C 70 92, 95 44, 165 44 S 250 74, 280 30" />
                <circle className="lipgo-node hub" cx="165" cy="44" r="3.4" />
                <circle className="lipgo-hub-ring hero-accent-stroke" cx="165" cy="44" r="3" fill="none" strokeWidth="1.3" />
                <circle className="lipgo-node" cx="34" cy="86" r="2.6" />
                <circle className="lipgo-node" cx="238" cy="52" r="2.6" />
                <g transform="translate(0,72)">
                  {/* Actor adaptativo: cambia de glifo y color según el módulo activo.
                      key fuerza el remount para reproducir el fundido de entrada. */}
                  <g className="lipgo-actor" key={selectedGroup ?? "home"}>
                    <HeroActor groupKey={selectedGroup} />
                  </g>
                </g>
              </svg>
            </>
          )}
          <button
            onClick={onToggleCollapse}
            className="absolute right-2 top-2 z-10 rounded-lg p-1.5 transition-colors hover:bg-white/10"
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          >
            {collapsed ? (
              <Menu className="h-4 w-4 text-white/70" />
            ) : (
              <X className="h-4 w-4 text-white/70" />
            )}
          </button>
          {collapsed ? (
            <div className="flex h-full items-center justify-center">
              <div className="lipgo-logo-mark">L</div>
            </div>
          ) : (
            <button
              onClick={() => {
                onSelectGroup(null)
                onSelectModule(null)
              }}
              className="absolute bottom-3 left-4 z-10 flex flex-col items-start gap-1.5 text-left"
            >
              <span className="flex items-center gap-2.5">
                <span className="lipgo-logo-mark">L</span>
                <span className="lipgo-word">LIPGO</span>
              </span>
              <span className="lipgo-tag">
                <span className="lipgo-live" />
                CRM · Gestión comercial
              </span>
            </button>
          )}
        </div>

        {/* Buscador de modulos (solo visible cuando el sidebar esta expandido) */}
        {!collapsed && (
          <div className="px-2 lg:px-4 pt-2 lg:pt-4 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={moduleSearch}
                onChange={(e) => setModuleSearch(e.target.value)}
                placeholder="Buscar módulo..."
                aria-label="Buscar módulo"
                className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {moduleSearch && (
                <button
                  onClick={() => setModuleSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Limpiar búsqueda"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Module/Subgroup list - shown when expanded */}
        <nav className="flex-1 space-y-0.5 lg:space-y-1 p-2 lg:p-4 overflow-y-auto overflow-x-hidden">
          {/* Resultados del buscador: lista plana de modulos coincidentes */}
          {!collapsed && normalizedSearch.length > 0 ? (
            searchResults.length > 0 ? (
              searchResults.map((m) => {
                const ModuleIcon = m.icon
                const isModuleActive = selectedModule === m.name && selectedGroup === m.groupKey
                return (
                  <button
                    key={`${m.groupKey}-${m.name}`}
                    onClick={() => handleSelectFromSearch(m.groupKey, m.name)}
                    className={`
                      flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-xs
                      transition-all duration-200
                      ${
                        isModuleActive
                          ? "text-foreground bg-accent/70 font-medium"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      }
                    `}
                  >
                    <span className="flex items-center gap-2">
                      <ModuleIcon className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="text-left">{m.label}</span>
                    </span>
                    <span className="pl-5 text-[10px] text-muted-foreground/70">
                      {m.groupLabel}
                      {m.subgroupTitle ? ` · ${m.subgroupTitle}` : ""}
                    </span>
                  </button>
                )
              })
            ) : (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No se encontraron módulos
              </p>
            )
          ) : (
            menuItems.map((item) => {
            const Icon = item.icon
            const isGroupActive = selectedGroup === item.key
            const isExpanded = item.key ? expandedGroups.has(item.key) : false
            const group = item.key ? visibleGroups.find((g) => g.key === item.key) : null

            // Inicio button (no accordion)
            if (!item.key) {
              return (
                <button
                  key={item.label}
                  onClick={() => {
                    onSelectGroup(null)
                    onSelectModule(null)
                  }}
                  className={`
                    flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium
                    transition-all duration-200 relative
                    ${
                      isGroupActive
                        ? "text-foreground bg-accent"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }
                    ${collapsed ? "justify-center" : ""}
                  `}
                  title={collapsed ? item.label : undefined}
                >
                  {isGroupActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                  )}
                  <span className="lipgo-tile" style={{ color: "#9fcfc6" }}>
                    <Icon className="h-[15px] w-[15px]" />
                  </span>
                  {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </button>
              )
            }

            // Group accordion buttons
            return (
              <div key={item.label} className="space-y-1">
                <button
                  onClick={() => {
                    if (!collapsed) {
                      onSelectGroup(item.key!)
                      onSelectModule(null)
                      toggleGroup(item.key!)
                    }
                  }}
                  className={`
                    flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium
                    transition-all duration-200 relative
                    ${
                      isGroupActive
                        ? "text-foreground bg-accent"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }
                    ${collapsed ? "justify-center" : "justify-between"}
                  `}
                  title={collapsed ? item.label : undefined}
                >
                  <div className="flex items-center gap-3">
                    {isGroupActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                    )}
                    <span className="lipgo-tile" style={{ color: GROUP_TINT[item.key!] ?? "#9fcfc6" }}>
                      <Icon className="h-[15px] w-[15px]" />
                    </span>
                    {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                  </div>
                  {!collapsed && (
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                    />
                  )}
                </button>

                {/* Module/Subgroup list - shown when expanded */}
                <div
                  className={`
                    ml-4 space-y-1 border-l border-border pl-2
                    overflow-hidden transition-all duration-300 ease-in-out
                    ${!collapsed && isExpanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"}
                  `}
                >
                  {!collapsed && group && (
                    <>
                      {group.subgroups
                        ? // Render subgroups
                          group.subgroups.map((subgroup) => {
                            const subgroupKey = `${item.key}-${subgroup.title}`
                            const isSubgroupExpanded = expandedSubgroups.has(subgroupKey)

                            return (
                              <div key={subgroup.title} className="space-y-1">
                                <button
                                  onClick={() => toggleSubgroup(item.key!, subgroup.title)}
                                  className={`
                                  flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium
                                  transition-all duration-200 justify-between
                                  text-muted-foreground hover:bg-accent/50 hover:text-foreground
                                `}
                                >
                                  <span className="text-left whitespace-nowrap">{subgroup.title}</span>
                                  <ChevronDown
                                    className={`h-3 w-3 transition-transform duration-200 flex-shrink-0 ${isSubgroupExpanded ? "rotate-180" : ""}`}
                                  />
                                </button>

                                {/* Subgroup modules */}
                                <div
                                  className={`
                                  ml-3 space-y-1 border-l border-border pl-2
                                  overflow-hidden transition-all duration-300 ease-in-out
                                  ${isSubgroupExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}
                                `}
                                >
                                  {subgroup.modules.map((module) => {
                                    const ModuleIcon = module.icon
                                    const isModuleActive = selectedModule === module.name && selectedGroup === item.key

                                    return (
                                      <button
                                        key={module.name}
                                        onClick={() => {
                                          onSelectGroup(item.key!)
                                          onSelectModule(module.name)
                                        }}
                                        className={`
                                        flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs
                                        transition-all duration-200
                                        ${
                                          isModuleActive
                                            ? "text-foreground bg-accent/70 font-medium"
                                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                        }
                                      `}
                                      >
                                        <ModuleIcon className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="text-left whitespace-nowrap overflow-hidden text-ellipsis">
                                          {module.label ?? module.name}
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })
                        : // Render direct modules (for groups without subgroups)
                          group.modules?.map((module) => {
                            const ModuleIcon = module.icon
                            const isModuleActive = selectedModule === module.name && selectedGroup === item.key

                            return (
                              <button
                                key={module.name}
                                onClick={() => {
                                  onSelectGroup(item.key!)
                                  onSelectModule(module.name)
                                }}
                                className={`
                                flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs
                                transition-all duration-200
                                ${
                                  isModuleActive
                                    ? "text-foreground bg-accent/70 font-medium"
                                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                }
                              `}
                              >
                                <ModuleIcon className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="text-left whitespace-nowrap overflow-hidden text-ellipsis">
                                  {module.label ?? module.name}
                                </span>
                              </button>
                            )
                          })}
                    </>
                  )}
                </div>
              </div>
            )
            })
          )}
        </nav>
      </aside>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 safe-area-pb">
        <nav className="flex items-center justify-around px-1 py-1.5">
          {menuItems.slice(0, 5).map((item) => {
            const Icon = item.icon
            const isActive = selectedGroup === item.key

            return (
              <button
                key={item.label}
                onClick={() => {
                  onSelectGroup(item.key)
                  onSelectModule(null)
                }}
                className={`
                  flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg min-w-0
                  transition-colors
                  ${isActive ? "text-primary" : "text-muted-foreground"}
                `}
              >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                <span className="text-[9px] sm:text-[10px] font-medium truncate max-w-[60px]">{item.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </>
  )
}
