"use client"

// Diálogos que se abren desde cualquier módulo sin cambiar de módulo.
//
// Hoy, la Cuenta 360: desde un pedido, un recaudo o una aprobación se mira la
// cuenta del cliente y se vuelve exactamente a donde se estaba. Se abre con
// abrirCuenta360(id) de lib/crm-navegacion.ts.

import { useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Cuenta360Dialog } from "@/components/crm/clientes/cuenta-360-dialog"

export function HostDialogosGlobales() {
  const { selectedEmpresaId } = useAuth()
  const [clienteId, setClienteId] = useState<number | null>(null)

  useEffect(() => {
    const abrir = (e: Event) => {
      const id = Number((e as CustomEvent).detail)
      if (Number.isFinite(id) && id > 0) setClienteId(id)
    }
    // Al navegar a otro módulo (p. ej. "Nueva venta" desde la cuenta), la
    // cuenta se cierra: si no, quedaría tapando el módulo al que se fue.
    const cerrar = () => setClienteId(null)
    window.addEventListener("crm:cuenta360", abrir)
    window.addEventListener("crm:navigate-module", cerrar)
    return () => {
      window.removeEventListener("crm:cuenta360", abrir)
      window.removeEventListener("crm:navigate-module", cerrar)
    }
  }, [])

  if (clienteId === null) return null
  return (
    <Cuenta360Dialog
      key={clienteId}
      clienteId={clienteId}
      empresaId={selectedEmpresaId ?? 1}
      abierto
      onCerrar={() => setClienteId(null)}
    />
  )
}

export default HostDialogosGlobales
