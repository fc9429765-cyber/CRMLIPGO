"use client"

// Raiz del CRM. Toda la aplicacion vive en "/" y el modulo activo es estado de
// React, no una ruta: es como funcionaba LIPgo y se conserva para no reescribir
// el sidebar, el registry y la navegacion del asistente de una sola vez.
//
// Contrapartida conocida: no hay enlace directo a un modulo ni boton "atras"
// del navegador entre modulos. Si se necesita, la migracion natural es pasar
// selectedGroup/selectedModule a searchParams sin tocar el resto.

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/sidebar"
import { TopBar } from "@/components/top-bar"
import { MainContent } from "@/components/main-content"
import { SplashScreen } from "@/components/splash-screen"
import { LipbotDock } from "@/components/lipbot-dock"
import { HostDialogosGlobales } from "@/components/crm/host-dialogos-globales"
import { groups, type GroupKey } from "@/lib/dashboard-data"
import { useAuth } from "@/components/auth-provider"

export default function CrmPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [selectedGroup, setSelectedGroup] = useState<GroupKey | null>(null)
  const [selectedModule, setSelectedModule] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showSplash, setShowSplash] = useState(false)

  // Navegacion a un modulo por NOMBRE. La usan el asistente de IA y los enlaces
  // internos. Fija tambien el grupo, porque main-content solo pinta un modulo
  // cuando hay grupo seleccionado.
  const navigateToModule = useCallback((moduleName: string) => {
    let destino: GroupKey | null = null
    for (const g of groups) {
      const directo = g.modules?.some((m) => m.name === moduleName)
      const enSubgrupo = g.subgroups?.some((sg) => sg.modules.some((m) => m.name === moduleName))
      if (directo || enSubgrupo) {
        destino = g.key
        break
      }
    }
    setSelectedGroup((prev) => destino ?? prev ?? groups[0]?.key ?? null)
    setSelectedModule(moduleName)
  }, [])

  // Canal de navegacion por evento global, para que cualquier componente
  // profundo pueda mandar al usuario a otro modulo sin pasar props por toda la
  // jerarquia. El destino conserva su PermissionGuard.
  useEffect(() => {
    const handler = (e: Event) => {
      const nombre = (e as CustomEvent).detail
      if (typeof nombre === "string" && nombre) navigateToModule(nombre)
    }
    window.addEventListener("crm:navigate-module", handler)
    // Se mantiene el nombre viejo por compatibilidad con componentes heredados.
    window.addEventListener("lipgo:navigate-module", handler)
    return () => {
      window.removeEventListener("crm:navigate-module", handler)
      window.removeEventListener("lipgo:navigate-module", handler)
    }
  }, [navigateToModule])

  useEffect(() => {
    if (!loading && !user) router.push("/login")
  }, [user, loading, router])

  // El splash solo tras iniciar sesion, no en cada refresco: el formulario de
  // login deja una marca en sessionStorage que aqui se lee y se borra.
  useEffect(() => {
    if (!user) return
    try {
      if (sessionStorage.getItem("lipgo:just-logged-in") === "1") {
        sessionStorage.removeItem("lipgo:just-logged-in")
        setShowSplash(true)
      }
    } catch {
      // sessionStorage bloqueado (modo privado): se omite el splash.
    }
  }, [user])

  if (loading) return <SplashScreen onComplete={() => {}} />
  if (!user) return null

  const tituloGrupo = selectedGroup
    ? groups.find((g) => g.key === selectedGroup)?.title
    : undefined

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}

      <Sidebar
        selectedGroup={selectedGroup}
        selectedModule={selectedModule}
        onSelectGroup={(group) => {
          setSelectedGroup(group)
          setSelectedModule(null)
        }}
        onSelectModule={setSelectedModule}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          selectedModule={selectedModule}
          onNavigateModule={navigateToModule}
        />

        <main className="flex-1 overflow-y-auto">
          <MainContent
            selectedGroup={selectedGroup}
            selectedModule={selectedModule}
            // navigateToModule y no setSelectedModule: fija tambien el grupo.
            // Con solo el modulo, los botones de Inicio no llevaban a ningun
            // lado (sin grupo, la pantalla sigue en Inicio).
            onSelectModule={navigateToModule}
            onSelectGroup={(group) => {
              setSelectedGroup(group)
              setSelectedModule(null)
            }}
          />
        </main>
      </div>

      {/* Dialogos que cualquier modulo puede abrir encima de si mismo
          (la Cuenta 360 de un cliente) sin cambiar de modulo. */}
      <HostDialogosGlobales />

      {/* Asistente flotante. No se muestra en el Inicio ni dentro del propio
          asistente a pantalla completa, para no tener dos superficies del
          mismo chat a la vez. */}
      {selectedModule !== "Asistente IA" && (selectedGroup || selectedModule) && (
        <LipbotDock
          contextLabel={selectedModule ?? tituloGrupo ?? "Inicio"}
          groupKey={selectedGroup ?? undefined}
          onNavigate={navigateToModule}
        />
      )}
    </div>
  )
}
