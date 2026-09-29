"use client"

// Botones del estado de cuenta (EDC-01): descargar el PDF o compartirlo.
//
// Compartir no manda nada por su cuenta: abre WhatsApp en el teléfono o el
// computador del vendedor con el mensaje y el enlace ya escritos. Así sale del
// número del vendedor, que es el que el cliente conoce, y no depende de que
// Meta apruebe una plantilla nueva. El enlace caduca (estado_cuenta.enlace_dias).

import { useState } from "react"
import { Copy, FileDown, Loader2, MessageCircle } from "lucide-react"
import { compartirEstadoCuenta, generarEstadoCuenta } from "@/lib/crm-estado-cuenta-pdf"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"

export function EstadoCuentaAcciones({
  clienteId, empresaId, owners,
}: {
  clienteId: number
  empresaId: number
  /** Owners a los que el cliente debe. Con más de uno se elige. */
  owners: { id: number; nombre: string }[]
}) {
  const [ownerId, setOwnerId] = useState<string>(owners.length === 1 ? String(owners[0].id) : "")
  const [trabajando, setTrabajando] = useState<null | "pdf" | "compartir">(null)
  const [enlace, setEnlace] = useState<{ url: string; mensaje: string; venceEl: string } | null>(null)
  const falta = owners.length > 1 && !ownerId
  const opciones = { ownerId: ownerId ? Number(ownerId) : null }

  const descargar = async () => {
    setTrabajando("pdf")
    const r = await generarEstadoCuenta(clienteId, opciones, empresaId)
    setTrabajando(null)
    if (!r.success || !r.base64) {
      toast({ title: "No se generó el estado de cuenta", description: r.error, variant: "destructive" })
      return
    }
    const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
    const a = document.createElement("a")
    a.href = url
    a.download = r.nombreArchivo ?? "estado-cuenta.pdf"
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const compartir = async () => {
    // La pestaña de WhatsApp se abre ANTES de esperar al servidor: si se abre
    // después, el navegador la bloquea como ventana emergente.
    const ventana = window.open("", "_blank")
    setTrabajando("compartir")
    const r = await compartirEstadoCuenta(clienteId, opciones, empresaId)
    setTrabajando(null)
    if (!r.success || !r.data) {
      ventana?.close()
      toast({ title: "No se pudo compartir", description: r.error, variant: "destructive" })
      return
    }
    setEnlace(r.data)
    const wa = `https://wa.me/${r.data.celular ?? ""}?text=${encodeURIComponent(r.data.mensaje)}`
    if (ventana) ventana.location.href = wa
    if (!r.data.celular) {
      toast({ title: "El cliente no tiene un celular válido", description: "Elige el contacto en WhatsApp o copia el enlace." })
    }
  }

  const copiar = async () => {
    if (!enlace) return
    try {
      await navigator.clipboard.writeText(enlace.mensaje)
      toast({ title: "Mensaje copiado" })
    } catch {
      toast({ title: "No se pudo copiar", description: enlace.url })
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold">Estado de cuenta</p>
        <div className="flex flex-wrap items-center gap-2">
          {owners.length > 1 && (
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="¿De qué empresa?" /></SelectTrigger>
              <SelectContent>
                {owners.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" className="h-8" onClick={descargar} disabled={falta || trabajando !== null}>
            {trabajando === "pdf" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
            PDF
          </Button>
          <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={compartir} disabled={falta || trabajando !== null}>
            {trabajando === "compartir" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="mr-1.5 h-3.5 w-3.5" />}
            WhatsApp
          </Button>
        </div>
      </div>
      {enlace && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>Enlace generado; abre hasta el {enlace.venceEl}.</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={copiar}>
            <Copy className="mr-1 h-3 w-3" /> Copiar mensaje
          </Button>
        </div>
      )}
    </div>
  )
}

export default EstadoCuentaAcciones
