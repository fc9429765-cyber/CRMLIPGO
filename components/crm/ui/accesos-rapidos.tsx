"use client"

// Accesos directos entre módulos (lib/crm-navegacion.ts).
//
// Un mismo componente en dos formas:
//   - "botones": una tira de botones pequeños, para el encabezado de un
//     detalle (Cuenta 360, pedido, expediente).
//   - "menu": un solo botón "Ir a…" con la lista, para las filas de una tabla,
//     donde siete botones por fila no caben.
//
// Solo aparecen los accesos a módulos que el usuario puede abrir: ofrecer un
// botón que lleva a una pantalla vacía es peor que no ofrecerlo.

import type { LucideIcon } from "lucide-react"
import {
  Banknote, ClipboardList, FileText, FolderOpen, MapPin, Receipt, Send, ShoppingCart, Users, Wallet,
} from "lucide-react"
import { abrirCuenta360, irA, MODULO_DE, useModuloVisible, type Intencion } from "@/lib/crm-navegacion"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/** Un acceso: navegar con una intención, o abrir la Cuenta 360 encima. */
export type Acceso =
  | { intencion: Intencion; etiqueta?: string }
  | { cuenta360: number; etiqueta?: string }

const PRESENTACION: Record<Intencion["accion"] | "cuenta360", { etiqueta: string; icono: LucideIcon }> = {
  cuenta360: { etiqueta: "Cuenta 360", icono: Wallet },
  nueva_venta: { etiqueta: "Nueva venta", icono: ShoppingCart },
  nueva_cotizacion: { etiqueta: "Cotizar", icono: FileText },
  registrar_pago: { etiqueta: "Registrar pago", icono: Banknote },
  ver_cartera_cliente: { etiqueta: "Ver cartera", icono: Receipt },
  ver_pedidos_cliente: { etiqueta: "Ver pedidos", icono: Send },
  ver_pedido: { etiqueta: "Ver pedido", icono: Send },
  ver_cotizaciones_cliente: { etiqueta: "Ver cotizaciones", icono: FileText },
  ver_prospecto: { etiqueta: "Ver expediente", icono: FolderOpen },
  registrar_actividad: { etiqueta: "Registrar actividad", icono: ClipboardList },
  ver_clientes: { etiqueta: "Ver cliente", icono: Users },
  ver_mapa_clientes: { etiqueta: "Ver en el mapa", icono: MapPin },
}

function clave(a: Acceso) {
  return "cuenta360" in a ? "cuenta360" : a.intencion.accion
}

function ejecutar(a: Acceso) {
  if ("cuenta360" in a) abrirCuenta360(a.cuenta360)
  else irA(a.intencion)
}

export function AccesosRapidos({
  accesos, variante = "botones", className, titulo = "Ir a…",
}: {
  /** Los nulos y falsos se ignoran, para armar la lista con condiciones. */
  accesos: (Acceso | null | false | undefined)[]
  variante?: "botones" | "menu"
  className?: string
  titulo?: string
}) {
  const visible = useModuloVisible()
  const lista = accesos.filter((a): a is Acceso => !!a)
    .filter((a) => "cuenta360" in a || visible(MODULO_DE[a.intencion.accion]))
  if (!lista.length) return null

  if (variante === "menu") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost" size="sm" className={cn("h-7 px-2 text-xs", className)}
            // La fila de la tabla suele abrir un detalle al hacer clic: el menú no debe dispararlo.
            onClick={(e) => e.stopPropagation()}
          >
            {titulo}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Llevar a</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {lista.map((a) => {
            const p = PRESENTACION[clave(a)]
            const Icono = p.icono
            return (
              <DropdownMenuItem key={clave(a)} className="text-xs" onSelect={() => ejecutar(a)}>
                <Icono className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                {a.etiqueta ?? p.etiqueta}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {lista.map((a) => {
        const p = PRESENTACION[clave(a)]
        const Icono = p.icono
        return (
          <Button key={clave(a)} variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => ejecutar(a)}>
            <Icono className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {a.etiqueta ?? p.etiqueta}
          </Button>
        )
      })}
    </div>
  )
}

/** Los accesos de siempre para un cliente. */
export function accesosCliente(clienteId: number, opciones: { sinCuenta?: boolean } = {}): Acceso[] {
  return [
    !opciones.sinCuenta && { cuenta360: clienteId },
    { intencion: { accion: "nueva_venta", clienteId } },
    { intencion: { accion: "nueva_cotizacion", clienteId } },
    { intencion: { accion: "registrar_pago", clienteId } },
    { intencion: { accion: "ver_pedidos_cliente", clienteId } },
    { intencion: { accion: "ver_cartera_cliente", clienteId } },
    { intencion: { accion: "registrar_actividad", clienteId } },
    { intencion: { accion: "ver_mapa_clientes", clienteId } },
  ].filter(Boolean) as Acceso[]
}

export default AccesosRapidos
