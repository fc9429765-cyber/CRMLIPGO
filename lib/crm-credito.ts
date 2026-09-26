// Evaluacion de credito al armar un pedido (PED-03, PED-04).
//
// Sin "use server": la usan el formulario (en vivo, mientras el vendedor arma
// el pedido) y el servidor (al solicitar aprobacion, que es la que queda).
//
// EL CAMBIO DE FONDO FRENTE A LA VERSION ANTERIOR: antes el cupo BLOQUEABA el
// pedido. El requerimiento pide lo contrario (PED-04): calcular el sobrecupo
// exacto, mostrarlo, y DEJAR enviar el pedido, marcado, para que Cartera y
// Gerencia decidan con el dato delante. El modo se elige con el parametro
// `credito.modo_cupo` (sobrecupo | bloquear).
//
// Lo que sigue bloqueando siempre, porque es una decision ya tomada por
// cartera y no un calculo: el cliente marcado como bloqueado.

export type ModoCupo = "sobrecupo" | "bloquear"

export interface EntradaCredito {
  formaPago: "contado" | "credito"
  cupo: number
  /** Saldo abierto del cliente (cartera). */
  saldo: number
  vencido: number
  diasMora: number
  bloqueado: boolean
  totalPedido: number
  modo: ModoCupo
  /** Parametros de mora: si bloquea y desde cuantos dias. */
  bloquearPorMora: boolean
  diasMoraBloqueo: number
}

export interface ResultadoCredito {
  /** false = no se puede enviar a aprobacion. */
  permitido: boolean
  disponibleAntes: number
  disponibleDespues: number
  requiereSobrecupo: boolean
  /** Cuanto excede el cupo si se aprueba. 0 si no excede. */
  sobrecupoValor: number
  /** Explicaciones para el vendedor y para quien aprueba. */
  motivos: string[]
}

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const cop = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

export function evaluarCredito(e: EntradaCredito): ResultadoCredito {
  const disponibleAntes = redondear(e.cupo - e.saldo)
  const motivos: string[] = []

  // De contado no compromete cupo.
  if (e.formaPago === "contado") {
    return {
      permitido: !e.bloqueado,
      disponibleAntes,
      disponibleDespues: disponibleAntes,
      requiereSobrecupo: false,
      sobrecupoValor: 0,
      motivos: e.bloqueado ? ["El cliente está bloqueado por cartera"] : [],
    }
  }

  const disponibleDespues = redondear(disponibleAntes - e.totalPedido)
  const sobrecupoValor = disponibleDespues < 0 ? redondear(-disponibleDespues) : 0
  let permitido = true

  if (e.bloqueado) {
    permitido = false
    motivos.push("El cliente está bloqueado por cartera")
  }
  if (e.bloquearPorMora && e.diasMora > e.diasMoraBloqueo) {
    // En modo sobrecupo la mora tambien se informa y no bloquea: la decision
    // es de quien aprueba. En modo bloquear, bloquea.
    motivos.push(`Tiene facturas con ${e.diasMora} días de mora (${cop(e.vencido)} vencido)`)
    if (e.modo === "bloquear") permitido = false
  }
  if (sobrecupoValor > 0) {
    motivos.push(
      e.cupo <= 0
        ? `El cliente no tiene cupo de crédito: todo el pedido (${cop(sobrecupoValor)}) queda en sobrecupo`
        : `Excede el cupo en ${cop(sobrecupoValor)}`,
    )
    if (e.modo === "bloquear") permitido = false
  }

  return {
    permitido,
    disponibleAntes,
    disponibleDespues,
    requiereSobrecupo: sobrecupoValor > 0,
    sobrecupoValor,
    motivos,
  }
}
