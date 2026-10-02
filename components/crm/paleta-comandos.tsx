"use client"

// Paleta de comandos (Ctrl+K / ⌘K): ir a cualquier módulo o a cualquier
// cliente escribiendo tres letras.
//
// Un CRM se usa cien veces al día; abrir el menú, buscar el grupo y luego el
// módulo cuesta tres clics cada vez. Aquí: Ctrl+K, "pan", Enter, y ya está en
// la cuenta de "PANADERÍA ANDINA" — o en "Nueva venta" con ese cliente puesto.
//
// Los módulos salen del mismo menú (lib/dashboard-data) y solo los visibles
// para el usuario. Los clientes se cargan la primera vez que se abre y pasan
// por el mismo filtro de alcance que todo lo demás (getClientesCrm).

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Banknote, ClipboardList, FileText, Receipt, Search, Send, ShoppingCart, UserPlus, Wallet, type LucideIcon,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { groups } from "@/lib/dashboard-data"
import { getClientesCrm } from "@/lib/crm-catalogos-actions"
import type { ClienteCrm } from "@/lib/crm-catalogos"
import { abrirCuenta360, irA, irAModulo, useModuloVisible, type Intencion } from "@/lib/crm-navegacion"
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface AccionCliente { etiqueta: string; icono: LucideIcon; hacer: (c: ClienteCrm) => void; modulo?: string }

const ACCIONES_CLIENTE: AccionCliente[] = [
  { etiqueta: "Cuenta 360", icono: Wallet, hacer: (c) => abrirCuenta360(c.id) },
  { etiqueta: "Nueva venta", icono: ShoppingCart, modulo: "Nueva Venta", hacer: (c) => irA({ accion: "nueva_venta", clienteId: c.id }) },
  { etiqueta: "Cotizar", icono: FileText, modulo: "Cotizaciones", hacer: (c) => irA({ accion: "nueva_cotizacion", clienteId: c.id }) },
  { etiqueta: "Registrar pago", icono: Banknote, modulo: "Registrar Pago", hacer: (c) => irA({ accion: "registrar_pago", clienteId: c.id }) },
  { etiqueta: "Ver pedidos", icono: Send, modulo: "Pedidos CRM", hacer: (c) => irA({ accion: "ver_pedidos_cliente", clienteId: c.id }) },
  { etiqueta: "Ver cartera", icono: Receipt, modulo: "Cuentas por Cobrar", hacer: (c) => irA({ accion: "ver_cartera_cliente", clienteId: c.id, nombre: c.nombre }) },
  { etiqueta: "Registrar actividad", icono: ClipboardList, modulo: "Actividades", hacer: (c) => irA({ accion: "registrar_actividad", clienteId: c.id }) },
]

const ATAJOS: { etiqueta: string; icono: LucideIcon; modulo: string; intencion?: Intencion }[] = [
  { etiqueta: "Nueva venta", icono: ShoppingCart, modulo: "Nueva Venta" },
  { etiqueta: "Nueva cotización", icono: FileText, modulo: "Cotizaciones", intencion: { accion: "nueva_cotizacion" } },
  { etiqueta: "Registrar pago", icono: Banknote, modulo: "Registrar Pago" },
  { etiqueta: "Registrar prospecto", icono: UserPlus, modulo: "Registrar Prospecto" },
]

export function PaletaComandos({ className }: { className?: string }) {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1
  const visible = useModuloVisible()
  const [abierta, setAbierta] = useState(false)
  const [clientes, setClientes] = useState<ClienteCrm[] | null>(null)
  const [cliente, setCliente] = useState<ClienteCrm | null>(null)
  const [texto, setTexto] = useState("")

  // Ctrl+K / ⌘K en cualquier parte. Esc la cierra (lo hace el diálogo).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setAbierta((v) => !v)
      }
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [])

  useEffect(() => {
    if (!abierta) { setCliente(null); setTexto(""); return }
    if (clientes === null) getClientesCrm(empresaId).then((r) => setClientes(r.success ? r.data ?? [] : []))
  }, [abierta, clientes, empresaId])

  const modulos = useMemo(
    () => groups.flatMap((g) => [...(g.modules ?? []), ...(g.subgroups?.flatMap((s) => s.modules) ?? [])].map((m) => ({ ...m, grupo: g.title })))
      .filter((m) => visible(m.name)),
    [visible],
  )

  const cerrarY = useCallback((f: () => void) => { setAbierta(false); f() }, [])

  // Con pocas letras los 600 clientes no caben: se muestran los 8 que mejor
  // coinciden (cmdk ya ordena por coincidencia; aquí solo se acota).
  const clientesVisibles = useMemo(() => {
    if (!clientes) return []
    const t = texto.trim().toLowerCase()
    if (!t) return clientes.slice(0, 6)
    return clientes.filter((c) => c.nombre.toLowerCase().includes(t) || (c.documento ?? "").includes(t)).slice(0, 8)
  }, [clientes, texto])

  return (
    <>
      <Button
        variant="outline" size="sm"
        className={cn("h-8 justify-start gap-2 text-xs text-muted-foreground sm:w-56", className)}
        onClick={() => setAbierta(true)}
        aria-label="Buscar módulo o cliente (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Buscar módulo o cliente…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </Button>

      <CommandDialog open={abierta} onOpenChange={setAbierta} title="Buscar" description="Módulos, clientes y acciones" className="sm:max-w-xl">
        <Command shouldFilter={!cliente}>
          <CommandInput
            placeholder={cliente ? `¿Qué hacer con ${cliente.nombre}?` : "Módulo, cliente o NIT…"}
            value={texto}
            onValueChange={setTexto}
            onKeyDown={(e) => { if (e.key === "Backspace" && cliente && !texto) setCliente(null) }}
          />
          <CommandList className="max-h-[60vh]">
            {cliente ? (
              <CommandGroup heading={cliente.nombre}>
                {ACCIONES_CLIENTE.filter((a) => !a.modulo || visible(a.modulo)).map((a) => (
                  <CommandItem key={a.etiqueta} value={a.etiqueta} onSelect={() => cerrarY(() => a.hacer(cliente))}>
                    <a.icono className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" /> {a.etiqueta}
                  </CommandItem>
                ))}
                <CommandItem value="volver" onSelect={() => setCliente(null)} className="text-muted-foreground">← Otro cliente o módulo</CommandItem>
              </CommandGroup>
            ) : (
              <>
                <CommandEmpty>Nada coincide.</CommandEmpty>
                {clientesVisibles.length > 0 && (
                  <CommandGroup heading="Clientes">
                    {clientesVisibles.map((c) => (
                      <CommandItem key={`c-${c.id}`} value={`cliente ${c.nombre} ${c.documento ?? ""}`} onSelect={() => { setCliente(c); setTexto("") }}>
                        <span className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--chart-1)]/15 text-[10px] font-bold text-[var(--chart-1)]">
                          {c.nombre.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{c.nombre}</span>
                        {c.bloqueado_cartera && <span className="ml-2 rounded bg-red-100 px-1.5 text-[10px] text-red-700">Bloqueado</span>}
                        {c.documento && <span className="ml-2 text-[11px] text-muted-foreground">{c.documento}</span>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandSeparator />
                <CommandGroup heading="Acciones">
                  {ATAJOS.filter((a) => visible(a.modulo)).map((a) => (
                    <CommandItem key={a.etiqueta} value={`accion ${a.etiqueta}`} onSelect={() => cerrarY(() => (a.intencion ? irA(a.intencion) : irAModulo(a.modulo)))}>
                      <a.icono className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" /> {a.etiqueta}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Módulos">
                  {modulos.map((m) => (
                    <CommandItem key={m.name} value={`modulo ${m.name} ${m.grupo}`} onSelect={() => cerrarY(() => irAModulo(m.name))}>
                      <m.icon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="flex-1">{m.name}</span>
                      <span className="text-[11px] text-muted-foreground">{m.grupo}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

export default PaletaComandos
