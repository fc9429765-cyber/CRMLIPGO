"use client"

// Venta directa: el caso en que el cliente ya decidió y no hace falta cotizar.
//
// El formulario va EN LA PÁGINA y no en un diálogo (PED-01): el vendedor lo
// abre en el teléfono, de pie en la tienda del cliente, y un diálogo sobre una
// pantalla pequeña es un recuadro con dos barras de desplazamiento. La barra
// de acciones queda fija abajo, al alcance del pulgar.
//
// Por dentro crea la cotización con tipo_venta='directa' y la convierte en
// pedido de inmediato, en vez de mantener un segundo formulario casi idéntico.
// Dos salidas:
//   - "Guardar borrador": el pedido queda en borrador para revisarlo después.
//   - "Enviar a aprobación": el mismo paso y además lo manda a aprobar. Si hay
//     sobrecupo no se bloquea (PED-04): el servidor lo marca y lo informa.
// Saltarse la cotización no es saltarse el control: el pedido pasa por las
// mismas aprobaciones.

import { useState } from "react"
import { Info, Loader2, Save, Send, ShoppingCart } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { convertirEnPedido, crearCotizacion } from "@/lib/crm-cotizaciones-actions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/hooks/use-toast"
import { FormularioVenta, type EstadoEnvio } from "./formulario-venta"
import { useIntencion } from "@/lib/crm-navegacion"
import { BandaFormulario } from "@/components/crm/ui/banda-formulario"

interface Props {
  onNavigate?: (modulo: string) => void
}

type Accion = "borrador" | "enviar"

export function VentaDirecta({ onNavigate }: Props) {
  const { profile, selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1
  const usuario = profile?.usuario ?? "desconocido"
  const [enCurso, setEnCurso] = useState<Accion | null>(null)
  // Cambiar la clave vuelve a montar el formulario limpio tras guardar.
  const [version, setVersion] = useState(0)
  // Llegando desde la cuenta de un cliente, un pedido o una aprobación: el
  // cliente ya viene elegido y el formulario se monta de nuevo con él.
  const [inicial, setInicial] = useState<{ clienteId: number } | undefined>(undefined)
  useIntencion(["nueva_venta"], (i) => {
    setInicial({ clienteId: i.clienteId })
    setVersion((v) => v + 1)
  })

  const registrar = async ({ entrada }: EstadoEnvio, accion: Accion) => {
    if (!entrada) return
    setEnCurso(accion)
    try {
      const cot = await crearCotizacion({ ...entrada, tipo_venta: "directa" }, usuario, empresaId)
      if (!cot.success || !cot.data) {
        // El servidor es la autoridad: su mensaje dice qué regla falló.
        toast({ title: "No se registró la venta", description: cot.error, variant: "destructive" })
        return
      }

      const ped = await convertirEnPedido(cot.data.id, usuario, empresaId, { solicitar: accion === "enviar" })
      if (!ped.success || !ped.data) {
        // La cotización sí quedó creada: se dice dónde está para no perder el trabajo.
        toast({
          title: "La venta quedó como cotización",
          description: `${ped.error ?? "No se generó el pedido"}. Puedes convertirla desde Cotizaciones (${cot.data.numero ?? ""}).`,
          variant: "destructive",
        })
        onNavigate?.("Cotizaciones")
        return
      }

      const { numero, solicitud } = ped.data
      if (accion === "enviar" && solicitud) {
        // El mensaje del servidor trae el valor del sobrecupo cuando lo hay.
        toast({
          title: solicitud.ok ? `Pedido ${numero} enviado` : `Pedido ${numero} quedó en borrador`,
          description: solicitud.mensaje,
          variant: solicitud.ok ? undefined : "destructive",
        })
      } else {
        toast({
          title: `Pedido ${numero} guardado en borrador`,
          description: "Envíalo a aprobación desde Pedidos cuando esté listo.",
        })
      }
      setInicial(undefined)
      setVersion((v) => v + 1)
      onNavigate?.("Pedidos CRM")
    } finally {
      setEnCurso(null)
    }
  }

  return (
    <div className="space-y-4">
      <BandaFormulario
        titulo="Nueva venta"
        subtitulo="Elige el cliente, revisa su cartera y arma el pedido. Los campos marcados con (*) son obligatorios."
      />

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Genera el pedido de una vez. Aun así pasa por aprobación antes de viajar a LIPgo; si deja al
          cliente en sobrecupo se puede enviar igual y lo deciden Cartera y Gerencia.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="p-3 sm:p-5">
          <FormularioVenta
            key={version}
            empresaId={empresaId}
            modo="directa"
            inicial={inicial}
            pie={(estado) => {
              const deshabilitado = enCurso != null || !estado.entrada || estado.bloqueoCredito
              return (
                <>
                  <Button
                    variant="outline" className="h-8"
                    disabled={deshabilitado}
                    onClick={() => registrar(estado, "borrador")}
                  >
                    {enCurso === "borrador"
                      ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                      : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                    Guardar borrador
                  </Button>
                  <Button
                    className="h-8"
                    disabled={deshabilitado}
                    onClick={() => registrar(estado, "enviar")}
                  >
                    {enCurso === "enviar"
                      ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                      : <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                    Enviar a aprobación
                  </Button>
                </>
              )
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}

export default VentaDirecta
