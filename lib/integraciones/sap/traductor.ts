// Traduccion de los eventos del CRM a documentos de SAP Business One (INT-03).
//
// PURO: recibe el evento tal como quedo en la bandeja y los codigos SAP ya
// leidos, y devuelve el cuerpo para Service Layer o la lista EXACTA de lo que
// falta ("Producto #6 HARINA X sin ItemCode"). Asi se prueba sin SAP y sin
// base, y el panel puede decir que mapear antes de encender SAP.
//
// SE TRADUCE AL ENVIAR, NO AL ENCOLAR: un pedido que se encolo hoy sin el
// codigo de su producto sale solo el dia en que alguien agrega ese codigo en
// Mapeos SAP. Si se tradujera al encolar, habria que volver a encolarlo.
//
// PED-13: la linea del pedido viaja con el precio APROBADO (UnitPrice), no
// con el de lista.

export type EntidadMapeo = "cliente" | "sucursal" | "producto" | "vendedor" | "centro" | "factura" | "condicion_pago"

export const ETIQUETA_ENTIDAD_MAPEO: Record<EntidadMapeo, { nombre: string; campoSap: string }> = {
  cliente: { nombre: "Cliente", campoSap: "CardCode" },
  sucursal: { nombre: "Sucursal", campoSap: "ShipToCode" },
  producto: { nombre: "Producto", campoSap: "ItemCode" },
  vendedor: { nombre: "Vendedor", campoSap: "SalesPersonCode" },
  centro: { nombre: "Centro de despacho", campoSap: "WarehouseCode" },
  factura: { nombre: "Factura", campoSap: "DocEntry" },
  condicion_pago: { nombre: "Condición de pago (días)", campoSap: "PayTermsGrpCode" },
}

export interface ContextoSap {
  /** Codigos SAP por "entidad:id". */
  codigos: Record<string, string>
  impuestos: { id: number; tarifa: number; nombre: string; sap_codigo: string | null }[]
  medios: Record<number, { codigo: string; nombre: string }>
  cuentas: Record<number, { alias: string; sap_cuenta: string | null }>
  /** Prefijo del CardCode de un cliente nuevo: "C" + NIT. */
  prefijoCliente: string
}

export type Traduccion =
  | { ok: true; endpoint: string; cuerpo: Record<string, unknown>; avisos: string[] }
  | { ok: false; faltantes: string[]; avisos: string[] }

export const clave = (entidad: EntidadMapeo, id: number | string | null | undefined) => `${entidad}:${id}`
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

/** Los ids que un evento necesita mapear, para leerlos de la base de una vez. */
export function necesidades(operacion: string, payload: Record<string, any>): { entidad: EntidadMapeo; id: number }[] {
  const out: { entidad: EntidadMapeo; id: number }[] = []
  const add = (entidad: EntidadMapeo, id: unknown) => { if (id != null && id !== "") out.push({ entidad, id: Number(id) }) }
  if (operacion === "crear_pedido") {
    const p = payload.pedido ?? {}
    add("cliente", p.cliente_id); add("sucursal", p.sucursal_id); add("vendedor", p.vendedor_id); add("centro", p.centro_id)
    if (p.forma_pago === "credito") add("condicion_pago", p.dias_credito ?? 0)
    for (const l of payload.lineas ?? []) add("producto", l.producto_id)
  } else if (operacion === "crear_recaudo") {
    add("cliente", payload.recaudo?.cliente_id)
    for (const a of payload.aplicaciones ?? []) add("factura", a.cuenta_cobrar_id)
  } else if (operacion === "crear_cliente") {
    add("cliente", payload.cliente?.id_lipgo)
    add("condicion_pago", payload.cliente?.dias_credito ?? 0)
  }
  return out
}

function codigoImpuesto(ctx: ContextoSap, l: { impuesto_id?: number | null; impuesto_pct?: number | null }) {
  const imp = (l.impuesto_id != null ? ctx.impuestos.find((i) => i.id === l.impuesto_id) : undefined)
    ?? ctx.impuestos.find((i) => Number(i.tarifa) === Number(l.impuesto_pct ?? 0) && i.sap_codigo)
    ?? ctx.impuestos.find((i) => Number(i.tarifa) === Number(l.impuesto_pct ?? 0))
  return { imp, codigo: imp?.sap_codigo ?? null }
}

export function traducirPedido(payload: Record<string, any>, ctx: ContextoSap): Traduccion {
  const p = payload.pedido ?? {}
  const faltantes: string[] = []
  const avisos: string[] = []
  const cod = (e: EntidadMapeo, id: unknown) => (id == null ? undefined : ctx.codigos[clave(e, id as number)])

  const cardCode = cod("cliente", p.cliente_id)
  if (!cardCode) faltantes.push(`Cliente #${p.cliente_id} ${p.cliente ?? ""} sin CardCode`.trim())
  const almacen = cod("centro", p.centro_id)
  if (p.centro_id != null && !almacen) avisos.push(`Centro de despacho ${p.centro_id} sin WarehouseCode: SAP usará la bodega por defecto del artículo`)

  const lineas = (payload.lineas ?? []).map((l: Record<string, any>) => {
    const item = cod("producto", l.producto_id)
    if (!item) faltantes.push(`Producto #${l.producto_id} ${l.producto ?? ""} sin ItemCode`.trim())
    const { imp, codigo } = codigoImpuesto(ctx, l)
    if (!codigo) faltantes.push(`${imp ? `Impuesto ${imp.nombre}` : `Impuesto del ${Number(l.impuesto_pct ?? 0)} %`} sin código SAP (Maestros → Impuestos)`)
    return {
      ItemCode: item ?? null,
      ItemDescription: l.producto ?? undefined,
      Quantity: Number(l.cantidad) || 0,
      UnitPrice: r2(l.precio_unitario),
      TaxCode: codigo ?? null,
      ...(almacen ? { WarehouseCode: almacen } : {}),
    }
  })
  if (!lineas.length) faltantes.push("El pedido no tiene líneas")

  const vendedor = cod("vendedor", p.vendedor_id)
  if (p.vendedor_id != null && !vendedor) avisos.push(`Vendedor #${p.vendedor_id} sin SalesPersonCode: va sin vendedor`)
  const sucursal = cod("sucursal", p.sucursal_id)
  if (p.sucursal_id != null && !sucursal) avisos.push(`Sucursal #${p.sucursal_id} sin ShipToCode: SAP usará la dirección principal`)
  const condicion = p.forma_pago === "credito" ? cod("condicion_pago", p.dias_credito ?? 0) : undefined
  if (p.forma_pago === "credito" && !condicion) avisos.push(`Sin condición de pago SAP para ${p.dias_credito ?? 0} días: se usa la del cliente`)

  // Faltantes sin repetir: diez lineas del mismo producto sin codigo son un solo pendiente.
  const unicos = [...new Set(faltantes)]
  if (unicos.length) return { ok: false, faltantes: unicos, avisos }
  return {
    ok: true,
    endpoint: "Orders",
    avisos,
    cuerpo: {
      CardCode: cardCode,
      NumAtCard: p.numero ?? undefined,
      DocDate: p.fecha,
      DocDueDate: p.fecha_programada ?? p.fecha,
      Comments: [`CRM ${p.numero ?? ""}`.trim(), p.idpedido_lipgo ? `LIPgo ${p.idpedido_lipgo}` : null].filter(Boolean).join(" · "),
      ...(vendedor ? { SalesPersonCode: Number(vendedor) || vendedor } : {}),
      ...(sucursal ? { ShipToCode: sucursal } : {}),
      ...(condicion ? { PaymentGroupCode: Number(condicion) || condicion } : {}),
      DocumentLines: lineas,
    },
  }
}

export function traducirRecaudo(payload: Record<string, any>, ctx: ContextoSap): Traduccion {
  const r = payload.recaudo ?? {}
  const faltantes: string[] = []
  const avisos: string[] = []
  const cardCode = ctx.codigos[clave("cliente", r.cliente_id)]
  if (!cardCode) faltantes.push(`Cliente #${r.cliente_id} ${r.cliente ?? ""} sin CardCode`.trim())

  const facturas = (payload.aplicaciones ?? []).map((a: Record<string, any>) => {
    const docEntry = ctx.codigos[clave("factura", a.cuenta_cobrar_id)]
    if (!docEntry) faltantes.push(`Factura ${a.numero_factura ?? `CxC ${a.cuenta_cobrar_id}`} sin DocEntry de SAP`)
    return { DocEntry: Number(docEntry) || docEntry || null, SumApplied: r2(a.valor), InvoiceType: "it_Invoice" }
  })
  if (!facturas.length) avisos.push("Sin facturas aplicadas: entra a SAP como pago a cuenta")

  const medio = r.medio_pago_id != null ? ctx.medios[r.medio_pago_id] : undefined
  const efectivo = medio?.codigo === "efectivo"
  const cuenta = r.cuenta_destino_id != null ? ctx.cuentas[r.cuenta_destino_id] : undefined
  if (!cuenta?.sap_cuenta) {
    faltantes.push(cuenta ? `Cuenta destino "${cuenta.alias}" sin cuenta SAP (Maestros → Cuentas destino)` : "El recaudo no tiene cuenta destino: SAP necesita la cuenta contable")
  }

  const unicos = [...new Set(faltantes)]
  if (unicos.length) return { ok: false, faltantes: unicos, avisos }
  const valor = r2(r.valor)
  return {
    ok: true,
    endpoint: "IncomingPayments",
    avisos,
    cuerpo: {
      CardCode: cardCode,
      DocDate: r.fecha,
      CounterReference: r.numero ?? undefined,
      Remarks: `Recaudo CRM ${r.numero ?? ""}`.trim(),
      ...(efectivo
        ? { CashSum: valor, CashAccount: cuenta!.sap_cuenta }
        : { TransferSum: valor, TransferAccount: cuenta!.sap_cuenta, TransferDate: r.fecha, TransferReference: r.referencia ?? undefined }),
      PaymentInvoices: facturas,
    },
  }
}

export function traducirCliente(payload: Record<string, any>, ctx: ContextoSap): Traduccion {
  const c = payload.cliente ?? {}
  const faltantes: string[] = []
  const avisos: string[] = []
  if (!c.nit) faltantes.push("El cliente no tiene NIT")
  if (!c.nombre) faltantes.push("El cliente no tiene nombre")
  const existente = ctx.codigos[clave("cliente", c.id_lipgo)]
  const cardCode = existente ?? (c.nit ? `${ctx.prefijoCliente}${c.nit}` : null)
  if (!existente && cardCode) avisos.push(`CardCode nuevo: ${cardCode}`)
  const condicion = ctx.codigos[clave("condicion_pago", c.dias_credito ?? 0)]
  if (!condicion) avisos.push(`Sin condición de pago SAP para ${c.dias_credito ?? 0} días`)
  if (faltantes.length) return { ok: false, faltantes, avisos }
  return {
    ok: true,
    endpoint: "BusinessPartners",
    avisos,
    cuerpo: {
      CardCode: cardCode,
      CardName: c.nombre,
      CardType: "cCustomer",
      FederalTaxID: String(c.nit),
      Phone1: c.celular ?? undefined,
      EmailAddress: c.correo ?? undefined,
      ContactPerson: c.contacto ?? undefined,
      CreditLimit: r2(c.cupo),
      ...(condicion ? { PayTermsGrpCode: Number(condicion) || condicion } : {}),
      BPAddresses: c.direccion
        ? [{ AddressName: "PRINCIPAL", AddressType: "bo_ShipTo", Street: c.direccion, City: c.ciudad ?? undefined, County: c.departamento ?? undefined }]
        : [],
    },
  }
}

export function traducir(operacion: string, payload: Record<string, any>, ctx: ContextoSap): Traduccion {
  switch (operacion) {
    case "crear_pedido": return traducirPedido(payload, ctx)
    case "crear_recaudo": return traducirRecaudo(payload, ctx)
    case "crear_cliente": return traducirCliente(payload, ctx)
    default: return { ok: false, faltantes: [`Operación SAP desconocida: "${operacion}"`], avisos: [] }
  }
}
