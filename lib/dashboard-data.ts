import {
  LayoutDashboard, CalendarDays, Users, UserPlus, Filter, ClipboardList,
  FileText, ShoppingCart, CheckCircle, Store, Tag, Wallet, Banknote,
  TrendingUp, Route, Sparkles, BarChart3, Package, UserCheck, Settings,
  Lock, History, Percent, type LucideIcon,
  Cable, Database, Upload, PieChart
} from "lucide-react"

export interface Module {
  name: string
  icon: LucideIcon
  // Texto visible opcional en el sidebar. `name` sigue siendo la clave de
  // ruteo y permisos; si `label` existe, se pinta en lugar de `name`.
  label?: string
}

export interface Subgroup {
  title: string
  modules: Module[]
}

export interface Group {
  key: GroupKey
  title: string
  icon: LucideIcon
  modules?: Module[]
  subgroups?: Subgroup[]
}

export type GroupKey =
  | "inicio"
  | "prospectos"
  | "ventas"
  | "clientes"
  | "cartera"
  | "inteligencia"
  | "configuracion"

/**
 * CATALOGO DE MODULOS DEL CRM.
 *
 * `Module.name` es la CLAVE UNICA de todo el sistema. El mismo string es:
 *   1. la llave en MODULE_PERMISSION_MAP (lib/permissions-map.ts),
 *   2. la entrada en MODULE_REGISTRY (lib/module-registry.ts), que decide
 *      que componente se pinta,
 *   3. el texto del sidebar, salvo que se defina `label`.
 *
 * Renombrar un modulo rompe permisos y ruteo a la vez. Si hay que cambiar como
 * se lee en pantalla, usar `label` y dejar `name` quieto.
 */
export const groups: Group[] = [
  {
    key: "inicio",
    title: "Inicio",
    icon: LayoutDashboard,
    modules: [
      { name: "Dashboard Comercial", icon: LayoutDashboard },
      { name: "Mi Agenda", icon: CalendarDays },
    ],
  },
  {
    key: "prospectos",
    title: "Prospectos",
    icon: UserPlus,
    modules: [
      { name: "Registrar Prospecto", icon: UserPlus },
      { name: "Aprobar Prospectos", icon: UserCheck },
      { name: "Embudo de Ventas", icon: Filter },
      { name: "Actividades", icon: ClipboardList },
      { name: "Calendario de Visitas", icon: CalendarDays },
    ],
  },
  {
    key: "ventas",
    title: "Ventas",
    icon: ShoppingCart,
    modules: [
      { name: "Cotizaciones", icon: FileText },
      { name: "Nueva Venta", icon: ShoppingCart },
      { name: "Pedidos CRM", icon: ClipboardList },
      // Bandeja de firmas. Separada de "Pedidos CRM" porque la usa gente
      // distinta (gerencia y contabilidad) y solo para aprobar o rechazar.
      { name: "Autorizar Pedidos", icon: CheckCircle },
    ],
  },
  {
    key: "clientes",
    title: "Clientes",
    icon: Users,
    modules: [
      { name: "Gestión de Clientes", icon: Users },
      { name: "Sucursales", icon: Store },
      { name: "Listas de Precios", icon: Tag },
    ],
  },
  {
    key: "cartera",
    title: "Cartera",
    icon: Wallet,
    modules: [
      { name: "Tablero de Cartera", icon: PieChart },
      { name: "Cuentas por Cobrar", icon: Wallet },
      { name: "Registrar Pago", icon: Banknote },
      { name: "Aprobar Recaudos", icon: CheckCircle },
      { name: "Antigüedad de Cartera", icon: TrendingUp },
      { name: "Comisiones", icon: Percent },
    ],
  },
  {
    key: "inteligencia",
    title: "Inteligencia",
    icon: Sparkles,
    modules: [
      { name: "Rutas Óptimas", icon: Route },
      { name: "Oportunidades de Negocio", icon: TrendingUp },
      { name: "Asistente IA", icon: Sparkles },
      { name: "Reportes", icon: BarChart3 },
    ],
  },
  {
    key: "configuracion",
    title: "Configuración",
    icon: Settings,
    subgroups: [
      {
        title: "Catálogo",
        modules: [
          { name: "Productos", icon: Package },
          { name: "Vendedores", icon: UserCheck },
          { name: "Maestros", icon: Database },
          { name: "Importar datos", icon: Upload },
        ],
      },
      {
        title: "Sistema",
        modules: [
          { name: "Parametrización", icon: Settings },
          { name: "Gestión de Usuarios", icon: Lock },
          { name: "Bitácora de Auditoría", icon: History },
          { name: "Integraciones", icon: Cable },
        ],
      },
    ],
  },
]

// Grupos exentos del filtro de "al menos un modulo protegido permitido".
// Hoy ninguno: en el CRM todos los modulos estan protegidos por permiso.
// Se conserva el mecanismo porque el sidebar lo espera.
export const GRUPOS_SIN_FILTRO_PROTEGIDO: GroupKey[] = []

/**
 * Filtra `groups` contra los permisos del usuario — MISMO criterio que usa
 * components/sidebar.tsx: un modulo se ve si no esta protegido, o si lo esta y
 * el usuario lo tiene; un grupo se descarta si se queda sin modulos visibles,
 * o si no le queda ninguno permitido. Lo usan Inicio (module-cards) y la vista
 * de grupo (modules-view).
 */
export function filterGroupsByPermissions(
  isModuleVisible: (name: string) => boolean,
  permissionsLoaded: boolean,
  allowedModules: Set<string>,
): Group[] {
  return groups
    .map((group) => {
      const filteredSubgroups: Subgroup[] | undefined = group.subgroups
        ?.map((sg) => ({ ...sg, modules: sg.modules.filter((m) => isModuleVisible(m.name)) }))
        .filter((sg) => sg.modules.length > 0)
      const filteredModules: Module[] | undefined = group.modules?.filter((m) => isModuleVisible(m.name))

      const hasVisibleSubgroups = (filteredSubgroups?.length ?? 0) > 0
      const hasVisibleModules = (filteredModules?.length ?? 0) > 0
      if (!hasVisibleSubgroups && !hasVisibleModules) return null

      if (permissionsLoaded && !GRUPOS_SIN_FILTRO_PROTEGIDO.includes(group.key)) {
        const allModulesInGroup = [
          ...(filteredModules ?? []),
          ...((filteredSubgroups ?? []).flatMap((sg) => sg.modules)),
        ]
        const hasAtLeastOneAllowedProtected = allModulesInGroup.some((m) => allowedModules.has(m.name))
        if (!hasAtLeastOneAllowedProtected) return null
      }

      return { ...group, subgroups: filteredSubgroups, modules: filteredModules }
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)
}
