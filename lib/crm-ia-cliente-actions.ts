"use server"

// Análisis del cliente con IA: lectura comercial y de cobro en lenguaje
// claro, con tres acciones recomendadas.
//
// LA IA NO VE LA BASE: recibe un resumen armado aquí (cuenta, señales
// deterministas, últimos pedidos, recaudos y actividades) y devuelve una
// lectura con estructura fija. Las cifras que menciona salen de ese resumen;
// si inventara una, la ficha de al lado la desmentiría. Por eso el prompt le
// prohíbe citar números que no estén en los datos.
//
// Permisos: los mismos de ver la cuenta (getCuenta360 los valida) y el
// alcance del vendedor. Sin ANTHROPIC_API_KEY, se dice y no se bloquea nada.

import { generateText, Output } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { z } from "zod"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { mensajeError } from "@/lib/crm-auth"
import { leerParam, leerParamNumber } from "@/lib/crm-parametros-server"
import { PARAM } from "@/lib/crm-parametros"
import { hoyISO } from "@/lib/crm-fechas"
import { getCuenta360 } from "@/lib/crm-cuenta-actions"
import { senalesCliente } from "@/lib/crm-senales-cliente"

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

const esquema = z.object({
  resumen: z.string().describe("Dos o tres frases: situación comercial y de cartera del cliente, en español neutro y sin tecnicismos"),
  riesgo: z.enum(["bajo", "medio", "alto"]).describe("Riesgo de cartera: alto si hay vencido con mora relevante o bloqueo; medio si está cerca del cupo o con facturas por vencer; bajo si está al día"),
  acciones: z.array(z.object({
    titulo: z.string().describe("Acción concreta, en imperativo, máximo 8 palabras"),
    porque: z.string().describe("Una frase con el dato que la justifica"),
  })).min(1).max(3),
  oportunidad: z.string().nullable().describe("Si hay una oportunidad de venta visible en los datos (producto que repite, compra que bajó, cupo libre), una frase; si no, null"),
})

export type AnalisisCliente = z.infer<typeof esquema> & { modelo: string; generadoEl: string }

const SISTEMA = `Eres el analista comercial de una empresa colombiana de harinas que vende a panaderías y distribuidores. Lees los datos de un cliente y le dices al vendedor o a Cartera, en español claro y directo, cómo está el cliente y qué hacer.

Reglas:
- Usa ÚNICAMENTE las cifras que aparecen en los datos. No inventes montos, fechas ni productos. Si un dato no está, no lo menciones.
- Pesos colombianos con punto de miles (1.500.000). Sin decimales.
- Sé concreto y breve. Nada de "se recomienda considerar": di "Llámalo hoy para cobrar la factura FE-10 de $2.000.000".
- Prioriza: primero lo que impide vender (bloqueo, vencido), luego cobrar, luego vender.
- No repitas las señales tal cual: interprétalas.`

export async function analizarClienteIA(clienteId: number, empresaId = 1): Promise<ActionResult<AnalisisCliente>> {
  try {
    const cuenta = await getCuenta360(clienteId, empresaId)
    if (!cuenta.success || !cuenta.data) return { success: false, error: cuenta.error ?? "No se pudo leer la cuenta" }
    if (!process.env.ANTHROPIC_API_KEY) return { success: false, error: "El análisis con IA no está configurado (falta ANTHROPIC_API_KEY)." }

    const db = await getSupabaseAdmin()
    const hoy = hoyISO()
    const [modelo, diasAviso, { data: pedidos }, { data: recaudos }, { data: actividades }] = await Promise.all([
      leerParam(PARAM.IA_MODELO_ANALISIS, empresaId),
      leerParamNumber(PARAM.CARTERA_ALERTA_VENCIMIENTO, empresaId, 5),
      db.from("crm_pedidos").select("numero, fecha, total, estado, forma_pago").eq("idempresa", empresaId).eq("cliente_id", clienteId).order("fecha", { ascending: false }).limit(10),
      db.from("crm_recaudos").select("numero, fecha_documento, valor, estado").eq("idempresa", empresaId).eq("cliente_id", clienteId).order("fecha_documento", { ascending: false }).limit(6),
      db.from("crm_actividades").select("tipo, asunto, resultado, fecha_hora").eq("idempresa", empresaId).eq("cliente_id", clienteId).order("fecha_hora", { ascending: false }).limit(5),
    ])
    const d = cuenta.data
    const senales = senalesCliente({ cliente: d.cliente, cuenta: d.cuenta, facturas: d.facturas }, hoy, diasAviso, 6)
    const pesos = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-CO")

    // Productos que más repite (de los pedidos del CRM), para la oportunidad.
    const { data: idsPed } = await db.from("crm_pedidos").select("id").eq("idempresa", empresaId).eq("cliente_id", clienteId).order("fecha", { ascending: false }).limit(10)
    const { data: lineas } = idsPed?.length
      ? await db.from("crm_pedido_detalle").select("producto_nombre, cantidad, pedido_id").in("pedido_id", idsPed.map((p) => p.id))
      : { data: [] }
    const porProducto = new Map<string, number>()
    for (const l of lineas ?? []) porProducto.set(String(l.producto_nombre), (porProducto.get(String(l.producto_nombre)) ?? 0) + Number(l.cantidad))
    const topProductos = [...porProducto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

    const datos = [
      `Fecha de hoy: ${hoy}`,
      `Cliente: ${d.cliente.nombre} (NIT ${d.cliente.documento ?? "n/d"}). Vendedor: ${d.cliente.vendedor_nombre ?? "sin asignar"}. ${d.cliente.bloqueado_cartera ? "BLOQUEADO POR CARTERA." : ""}`,
      `Cupo: $${pesos(d.cuenta.cupo)} · plazo ${d.cliente.dias_credito} días · saldo total $${pesos(d.cuenta.saldo)} · disponible $${pesos(d.cuenta.disponible)} · vencido $${pesos(d.cuenta.vencido)} (${d.cuenta.facturasVencidas} facturas, ${d.cuenta.diasMora} días de mora máx.) · por vencer $${pesos(d.cuenta.alDia)} · saldo a favor $${pesos(d.cuenta.saldoFavor)}`,
      d.porOwner.length > 1 ? `Por empresa: ${d.porOwner.map((o) => `${o.ownerNombre} debe $${pesos(o.cuenta.saldo)} (vencido $${pesos(o.cuenta.vencido)})`).join("; ")}` : "",
      `Facturas abiertas: ${d.facturas.filter((f) => f.saldo > 0).slice(0, 12).map((f) => `${f.numero_factura ?? f.pedido_numero ?? "s/n"} vence ${f.fecha_vencimiento} saldo $${pesos(f.saldo)}`).join("; ") || "ninguna"}`,
      `Señales calculadas: ${senales.map((s) => `[${s.tono}] ${s.texto}`).join("; ")}`,
      `Últimos pedidos (CRM): ${(pedidos ?? []).map((p) => `${p.numero} ${p.fecha} $${pesos(Number(p.total))} ${p.estado} ${p.forma_pago}`).join("; ") || "ninguno en el CRM"}`,
      topProductos.length ? `Productos que más pide: ${topProductos.map(([n, c]) => `${n} (${pesos(c)} und)`).join("; ")}` : "",
      `Últimos recaudos: ${(recaudos ?? []).map((r) => `${r.numero} ${r.fecha_documento} $${pesos(Number(r.valor))} ${r.estado}`).join("; ") || "ninguno"}`,
      `Últimas actividades: ${(actividades ?? []).map((a) => `${String(a.fecha_hora).slice(0, 10)} ${a.tipo}: ${a.asunto}${a.resultado ? ` (${a.resultado})` : ""}`).join("; ") || "ninguna"}`,
    ].filter(Boolean).join("\n")

    const r = await generateText({
      model: anthropic(modelo || "claude-sonnet-5"),
      output: Output.object({ schema: esquema }),
      system: SISTEMA,
      prompt: `Datos del cliente:\n${datos}\n\nEntrega el análisis.`,
      temperature: 0.2,
      maxRetries: 1,
    })
    if (!r.output) return { success: false, error: "La IA no devolvió el análisis" }
    return { success: true, data: { ...r.output, modelo: modelo || "claude-sonnet-5", generadoEl: new Date().toISOString() } }
  } catch (err) {
    return { success: false, error: mensajeError(err) }
  }
}
