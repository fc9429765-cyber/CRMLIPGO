"use client"

// Formulario de cotización, en el diálogo del panel de Cotizaciones.
//
// El cuerpo vive en formulario-venta.tsx y lo comparte con la venta directa:
// cliente o prospecto, cartera, sucursal, owner y centro, catálogo, líneas y
// crédito en vivo. Aquí solo queda la acción propia de la cotización.
//
// Lo que se manda son INTENCIONES (producto, cantidad, precio). Precio de
// lista, impuesto por producto, owner y totales los calcula crearCotizacion en
// el servidor (RNF-05). La versión anterior mandaba totales y un descuento que
// el cálculo volvía a restar sobre el precio ya rebajado: cobraba de menos.
// Por eso ya no hay campo de descuento ni totales en lo que se envía.

import { useState } from "react"
import { FileText, Loader2 } from "lucide-react"
import { crearCotizacion } from "@/lib/crm-cotizaciones-actions"
import type { TipoVenta } from "@/lib/crm-cotizaciones"
import { Button } from "@/components/ui/button"
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/hooks/use-toast"
import { FormularioVenta, type EstadoEnvio } from "./formulario-venta"

export function CotizacionForm({
  empresaId, usuario, onGuardado, tipoVenta = "cotizacion", inicial,
}: {
  /** Cliente o prospecto ya elegido al llegar desde otro módulo. */
  inicial?: { clienteId?: number | null; prospectoId?: number | null }
  empresaId: number
  usuario: string
  /** Recibe el id de lo creado, para que quien llame pueda seguir el flujo. */
  onGuardado: (cotizacionId?: number) => void
  /** Se conserva por compatibilidad. La venta directa ya no pasa por aquí:
   *  tiene su propia página con "Guardar borrador" y "Enviar a aprobación". */
  tipoVenta?: TipoVenta
}) {
  const [guardando, setGuardando] = useState(false)

  const guardar = async ({ entrada }: EstadoEnvio) => {
    if (!entrada) return
    setGuardando(true)
    const res = await crearCotizacion(entrada, usuario, empresaId)
    setGuardando(false)

    if (!res.success) {
      // El servidor es la autoridad: su mensaje dice exactamente qué regla no
      // se cumplió (producto fuera del centro, fuera del catálogo…).
      toast({ title: "No se guardó", description: res.error, variant: "destructive" })
      return
    }

    if (tipoVenta === "cotizacion") {
      toast({
        title: "Cotización creada",
        description: [res.data?.numero, res.data?.requiere_autorizacion_descuento && "marcada para revisión de precios"]
          .filter(Boolean)
          .join(" · "),
      })
    }
    onGuardado(res.data?.id)
  }

  return (
    <DialogContent className="max-h-[92vh] w-full max-w-4xl overflow-y-auto pb-0">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-[var(--chart-1)]" aria-hidden="true" />
          {tipoVenta === "directa" ? "Nueva venta" : "Nueva cotización"}
        </DialogTitle>
        <DialogDescription className="text-xs">
          Totales, impuestos y precio de lista los confirma el servidor al guardar.
        </DialogDescription>
      </DialogHeader>

      <FormularioVenta
        empresaId={empresaId}
        modo={tipoVenta}
        inicial={inicial}
        pie={(estado) => (
          <Button
            className="h-8"
            onClick={() => guardar(estado)}
            disabled={guardando || !estado.entrada || estado.bloqueoCredito}
          >
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {tipoVenta === "directa" ? "Registrar venta" : "Guardar cotización"}
          </Button>
        )}
      />
    </DialogContent>
  )
}

export default CotizacionForm
