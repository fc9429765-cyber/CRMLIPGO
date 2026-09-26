"use client"

// Barra superior: reloj, selector de empresa, alertas y menu de usuario.
//
// ALERTAS: un icono por dominio, cada uno con su color y su popover. El icono
// solo existe si el usuario tiene el permiso Y hay algo que mostrar: una
// campana con cero es ruido. Todas usan el mismo hook generico
// (hooks/useCrmAlerts.ts) en vez de un hook por dominio como hacia LIPgo.
//
// SELECTOR DE EMPRESA: hoy solo opera la empresa 1, asi que normalmente no se
// ve. Se conserva porque el sistema se construyo multiempresa desde el inicio:
// en cuanto un usuario tenga acceso a dos, el selector aparece solo.

import { useRouter } from "next/navigation"
import {
  Building2, LogOut, User as UserIcon, CalendarClock, UserPlus,
  FileWarning, Wallet, Stamp, Loader2,
  ClipboardCheck,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { ColombiaClock } from "@/components/colombia-clock"
import { useCrmAlerts, type CrmAlerta } from "@/hooks/useCrmAlerts"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { LucideIcon } from "lucide-react"

interface TopBarProps {
  selectedModule?: string | null
  onNavigateModule?: (moduleName: string) => void
}

/** Los cinco dominios de alerta del CRM. Agregar uno es agregar una fila aqui
 *  y su ruta /api/crm/<endpoint>-alerts. */
const DOMINIOS: {
  endpoint: string
  permiso: string | string[]
  titulo: string
  icono: LucideIcon
  color: string
  moduloDestino: string
}[] = [
  { endpoint: "agenda",         permiso: "crm_agenda",                 titulo: "Visitas de hoy",        icono: CalendarClock, color: "text-[var(--chart-1)]", moduloDestino: "Mi Agenda" },
  { endpoint: "prospectos",     permiso: "crm_prospectos",             titulo: "Prospectos sin gestión", icono: UserPlus,      color: "text-[var(--chart-4)]", moduloDestino: "Embudo de Ventas" },
  { endpoint: "cotizaciones",   permiso: "crm_cotizaciones",           titulo: "Cotizaciones por vencer", icono: FileWarning,  color: "text-[var(--chart-3)]", moduloDestino: "Cotizaciones" },
  { endpoint: "cartera",        permiso: "crm_cartera",                titulo: "Cartera vencida",       icono: Wallet,        color: "text-destructive",      moduloDestino: "Cuentas por Cobrar" },
  { endpoint: "pedidos",        permiso: "crm_pedidos",                titulo: "Mis pedidos",           icono: ClipboardCheck, color: "text-[var(--chart-2)]", moduloDestino: "Pedidos CRM" },
  { endpoint: "autorizaciones", permiso: ["crm_autorizar_contabilidad", "crm_autorizar_gerencia"], titulo: "Esperando tu firma",    icono: Stamp,         color: "text-[var(--chart-2)]", moduloDestino: "Autorizar Pedidos" },
]

export function TopBar({ onNavigateModule }: TopBarProps) {
  const router = useRouter()
  const {
    profile, loading, signOut,
    accessibleEmpresas, selectedEmpresaId, selectedEmpresaNombre,
    setSelectedEmpresaId, loadingEmpresas,
  } = useAuth()

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  return (
    <header className="border-b border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-6 sm:py-3">
        {/* Izquierda: reloj, empresa, usuario */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ColombiaClock />

          {profile ? (
            <>
              <span className="text-muted-foreground">·</span>

              {accessibleEmpresas.length > 1 ? (
                <div className="flex items-center gap-1">
                  <Building2 className="h-4 w-4 text-[var(--chart-1)]" aria-hidden="true" />
                  <Select
                    value={selectedEmpresaId?.toString() ?? ""}
                    onValueChange={(v) => setSelectedEmpresaId(parseInt(v, 10))}
                    disabled={loadingEmpresas}
                  >
                    <SelectTrigger className="h-7 w-auto min-w-[130px] text-xs">
                      <SelectValue placeholder="Empresa..." />
                    </SelectTrigger>
                    <SelectContent>
                      {accessibleEmpresas.map((empresa) => (
                        <SelectItem key={empresa.id} value={empresa.id.toString()}>
                          {empresa.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <span className="truncate text-xs font-semibold sm:text-sm">
                  {selectedEmpresaNombre ?? profile.empresa_nombre}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground sm:text-sm">
              {loading ? "Cargando..." : "CRM Comercial"}
            </span>
          )}
        </div>

        {/* Derecha: alertas y usuario */}
        <div className="flex items-center gap-1 sm:gap-2">
          {DOMINIOS.map((d) => (
            <AlertaIcono
              key={d.endpoint}
              {...d}
              empresaId={selectedEmpresaId}
              userId={profile?.id}
              onIr={() => onNavigateModule?.(d.moduloDestino)}
            />
          ))}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Menú de usuario">
                <UserIcon className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate">
                {profile?.usuario ?? "Usuario"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

/** Un icono de alerta con su popover. Se pinta solo si hay permiso y count>0. */
function AlertaIcono({
  endpoint, permiso, titulo, icono: Icono, color,
  empresaId, userId, onIr,
}: {
  endpoint: string
  permiso: string | string[]
  titulo: string
  icono: LucideIcon
  color: string
  empresaId: number | null
  userId?: string
  onIr: () => void
}) {
  const { alerts, count, loading, hasPermission } = useCrmAlerts<CrmAlerta>(
    endpoint, permiso, empresaId, userId,
  )

  if (!hasPermission || count === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={titulo}>
          <Icono className={`h-5 w-5 ${color}`} />
          <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {count > 9 ? "9+" : count}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Icono className={`h-4 w-4 ${color}`} aria-hidden="true" />
            {titulo}
          </span>
          <Badge variant="secondary">{count}</Badge>
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-72 divide-y overflow-y-auto">
            {alerts.map((a, i) => (
              <div key={a.id ?? i} className="px-4 py-2.5 text-sm">
                {a.mensaje}
              </div>
            ))}
          </div>
        )}

        <div className="border-t px-4 py-2">
          <button onClick={onIr} className="text-xs font-medium text-[var(--chart-1)] hover:underline">
            {count > alerts.length
              ? `Ver las ${count} (${count - alerts.length} más)`
              : "Ver todas"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default TopBar
