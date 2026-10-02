"use client"

// Area de contenido: decide QUE modulo se pinta.
//
// Antes eran ~200 ternarios anidados sobre selectedModule en 1200 lineas.
// Ahora la decision es una busqueda en MODULE_REGISTRY (lib/module-registry.tsx),
// que ademas carga cada componente por dynamic() y declara su permiso al lado.
//
// La proteccion real sigue siendo doble: PermissionGuard oculta lo que el
// usuario no puede ver, y cada server action vuelve a validar del lado del
// servidor. Lo de aqui es interfaz, no seguridad: un permiso no se hace
// cumplir en el navegador.

import { PermissionGuard } from "@/components/permission-guard"
import { ModulePlaceholder } from "@/components/module-placeholder"
import { ModulesView } from "@/components/modules-view"
import { InicioDashboard } from "@/components/crm/dashboard/inicio-dashboard"
import { ErrorBoundary } from "@/components/error-boundary"
import { getModuleEntry } from "@/lib/module-registry"
import type { GroupKey } from "@/lib/dashboard-data"
import { Aparece } from "@/components/crm/ui/movimiento"

interface MainContentProps {
  selectedGroup: GroupKey | null
  selectedModule: string | null
  onSelectModule: (moduleName: string) => void
  onSelectGroup: (group: GroupKey) => void
}

export function MainContent({
  selectedGroup,
  selectedModule,
  onSelectModule,
  onSelectGroup,
}: MainContentProps) {
  // Inicio: el tablero comercial, con las areas debajo para navegar. Antes
  // era solo la rejilla de areas, que obliga a entrar a un modulo para saber
  // si algo va mal.
  if (!selectedGroup) {
    return (
      <div className="p-4 md:p-6">
        <InicioDashboard onSelectGroup={onSelectGroup} onSelectModule={onSelectModule} />
      </div>
    )
  }

  // Grupo elegido pero sin modulo: la rejilla de modulos del grupo.
  if (!selectedModule) {
    return (
      <div className="p-4 md:p-6">
        <ModulesView selectedGroup={selectedGroup} onSelectModule={onSelectModule} />
      </div>
    )
  }

  const entry = getModuleEntry(selectedModule)

  // Modulo en el menu pero sin componente registrado: normalmente, algo a
  // medio construir. Se avisa en vez de dejar la pantalla en blanco.
  if (!entry) {
    return (
      <div className="p-4 md:p-6">
        <ModulePlaceholder moduleName={selectedModule} />
      </div>
    )
  }

  const Componente = entry.component

  return (
    // key por modulo: si uno revienta, al cambiar de modulo el ErrorBoundary
    // se remonta limpio en vez de arrastrar el error por toda la sesion.
    <ErrorBoundary key={`${selectedGroup}|${selectedModule}`}>
      <div className={entry.fullWidth ? "p-2 md:p-4" : "p-4 md:p-6"}>
        <PermissionGuard moduleName={selectedModule}>
          {/* Cada módulo entra con un leve desplazamiento: se nota el cambio
              sin que el contenido salte. Respeta "reducir animaciones". */}
          <Aparece desde="abajo">
            <Componente onNavigate={onSelectModule} />
          </Aparece>
        </PermissionGuard>
      </div>
    </ErrorBoundary>
  )
}

export default MainContent
