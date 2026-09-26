"use client"

// Nombre del modulo -> componente que lo pinta.
//
// REEMPLAZA los ~200 ternarios anidados que tenia components/main-content.tsx.
// Aquello obligaba a tocar un archivo de 1200 lineas para agregar un modulo,
// cargaba los 200 componentes en el bundle inicial, y dejaba el permiso
// declarado en un archivo distinto del componente.
//
// Con el registry: agregar un modulo es una linea, cada componente entra por
// dynamic() y solo se descarga cuando alguien lo abre, y el permiso queda
// escrito al lado del componente que protege.
//
// LA REGLA QUE NO SE PUEDE ROMPER: la llave de este objeto debe ser IDENTICA
// al `Module.name` de lib/dashboard-data.ts y a la llave de
// MODULE_PERMISSION_MAP. Son el mismo string en tres sitios; si se separan, el
// modulo aparece en el menu y al abrirlo no pinta nada.

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import { Loader2 } from "lucide-react"
import type { UserPermissions } from "@/lib/permissions-map"

export interface ModuleEntry {
  component: ComponentType<any>
  /** Columna de permisos_usuarios que habilita el modulo. */
  permission: keyof UserPermissions
  /** true = ocupa todo el ancho (tableros, kanban, mapas). */
  fullWidth?: boolean
}

/** Placeholder mientras se descarga el chunk del modulo. */
function Cargando() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

export const MODULE_REGISTRY: Record<string, ModuleEntry> = {
  // ---------------------------------------------------------------- Inicio
  "Dashboard Comercial": {
    component: dynamic(() => import("@/components/crm/dashboard/dashboard-comercial"), { loading: Cargando }),
    permission: "crm_dashboard",
    fullWidth: true,
  },
  "Mi Agenda": {
    component: dynamic(() => import("@/components/crm/agenda/mi-agenda"), { loading: Cargando }),
    permission: "crm_agenda",
  },

  // ------------------------------------------------------------ Prospectos
  "Registrar Prospecto": {
    component: dynamic(() => import("@/components/crm/prospectos/prospectos-panel"), { loading: Cargando }),
    permission: "crm_prospectos",
  },
  "Embudo de Ventas": {
    component: dynamic(() => import("@/components/crm/prospectos/embudo-kanban"), { loading: Cargando }),
    permission: "crm_embudo",
    fullWidth: true,
  },
  "Actividades": {
    component: dynamic(() => import("@/components/crm/prospectos/actividades-panel"), { loading: Cargando }),
    permission: "crm_actividades",
  },
  "Calendario de Visitas": {
    component: dynamic(() => import("@/components/crm/agenda/calendario-visitas"), { loading: Cargando }),
    permission: "crm_agenda",
    fullWidth: true,
  },

  // ---------------------------------------------------------------- Ventas
  "Cotizaciones": {
    component: dynamic(() => import("@/components/crm/cotizaciones/cotizaciones-panel"), { loading: Cargando }),
    permission: "crm_cotizaciones",
  },
  "Nueva Venta": {
    component: dynamic(() => import("@/components/crm/cotizaciones/venta-directa"), { loading: Cargando }),
    permission: "crm_pedidos",
  },
  "Pedidos CRM": {
    component: dynamic(() => import("@/components/crm/pedidos/pedidos-panel"), { loading: Cargando }),
    permission: "crm_pedidos",
  },
  "Autorizar Pedidos": {
    component: dynamic(() => import("@/components/crm/pedidos/autorizaciones-panel"), { loading: Cargando }),
    permission: "crm_autorizar_contabilidad",
  },

  // -------------------------------------------------------------- Clientes
  "Gestión de Clientes": {
    component: dynamic(() => import("@/components/crm/clientes/clientes-panel"), { loading: Cargando }),
    permission: "crm_clientes",
  },
  "Sucursales": {
    component: dynamic(() => import("@/components/crm/clientes/sucursales-panel"), { loading: Cargando }),
    permission: "crm_clientes",
  },
  "Listas de Precios": {
    component: dynamic(() => import("@/components/crm/precios/listas-panel"), { loading: Cargando }),
    permission: "crm_listas_precios",
  },

  // --------------------------------------------------------------- Cartera
  "Cuentas por Cobrar": {
    component: dynamic(() => import("@/components/crm/cartera/cxc-panel"), { loading: Cargando }),
    permission: "crm_cartera",
  },
  "Registrar Pago": {
    component: dynamic(() => import("@/components/crm/cartera/pagos-panel"), { loading: Cargando }),
    permission: "crm_pagos",
  },
  "Antigüedad de Cartera": {
    component: dynamic(() => import("@/components/crm/cartera/aging-panel"), { loading: Cargando }),
    permission: "crm_cartera",
    fullWidth: true,
  },
  "Comisiones": {
    component: dynamic(() => import("@/components/crm/cartera/comisiones-panel"), { loading: Cargando }),
    permission: "crm_comisiones",
  },

  // ---------------------------------------------------------- Inteligencia
  "Rutas Óptimas": {
    // ssr:false OBLIGATORIO: Leaflet toca `window` al importarse y revienta el
    // render del servidor. Es el mismo motivo por el que el visor de
    // ubicaciones de LIPgo ya se montaba asi.
    component: dynamic(() => import("@/components/crm/rutas/rutas-panel"), { ssr: false, loading: Cargando }),
    permission: "crm_ia_rutas",
    fullWidth: true,
  },
  "Oportunidades de Negocio": {
    component: dynamic(() => import("@/components/crm/inteligencia/oportunidades-panel"), { loading: Cargando }),
    permission: "crm_ia_oportunidades",
    fullWidth: true,
  },
  "Asistente IA": {
    component: dynamic(() => import("@/components/lip-ai-assistant"), { loading: Cargando }),
    permission: "crm_dashboard",
    fullWidth: true,
  },
  "Reportes": {
    component: dynamic(() => import("@/components/crm/reportes/reportes-panel"), { loading: Cargando }),
    permission: "crm_reportes",
    fullWidth: true,
  },

  // --------------------------------------------------------- Configuracion
  "Productos": {
    component: dynamic(() => import("@/components/crm/productos/productos-panel"), { loading: Cargando }),
    permission: "crm_productos",
  },
  "Vendedores": {
    component: dynamic(() => import("@/components/crm/vendedores/vendedores-panel"), { loading: Cargando }),
    permission: "crm_vendedores",
  },
  "Parametrización": {
    component: dynamic(() => import("@/components/crm/parametros/parametros-panel"), { loading: Cargando }),
    permission: "crm_parametros",
  },
  "Gestión de Usuarios": {
    component: dynamic(() => import("@/components/configuration/user-permissions-management"), { loading: Cargando }),
    permission: "crm_usuarios",
    fullWidth: true,
  },
  "Bitácora de Auditoría": {
    component: dynamic(() => import("@/components/configuration/bitacora-auditoria"), { loading: Cargando }),
    permission: "crm_auditoria",
    fullWidth: true,
  },
  "Maestros": {
    component: dynamic(() => import("@/components/crm/maestros/maestros-panel"), { loading: Cargando }),
    permission: "crm_maestros_admin",
  },
  "Importar datos": {
    component: dynamic(() => import("@/components/crm/importar/importar-panel"), { loading: Cargando }),
    permission: "crm_importar",
    fullWidth: true,
  },
  "Integraciones": {
    component: dynamic(() => import("@/components/crm/integraciones/integraciones-panel"), { loading: Cargando }),
    permission: "crm_integraciones_admin",
  },
}

/** Entrada del modulo, o undefined si no esta registrado. */
export function getModuleEntry(moduleName: string | null): ModuleEntry | undefined {
  if (!moduleName) return undefined
  return MODULE_REGISTRY[moduleName]
}
