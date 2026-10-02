"use client"

// El radar (lib/crm-logistica-actions.ts) lo usan tres pantallas a la vez en
// Inicio: el panel del radar, las tarjetas de áreas (punto rojo con
// pendientes) y los mosaicos de cada área. Aquí se consulta UNA vez y se
// comparte, con una memoria corta: tres consultas iguales en el mismo segundo
// son dos de más, y el dato no cambia en 90 segundos.

import { useCallback, useEffect, useState } from "react"
import { getRadar, type Radar } from "@/lib/crm-logistica-actions"
import { groups, type GroupKey } from "@/lib/dashboard-data"

const TTL_MS = 90_000
const EVENTO = "crm:radar-actualizado"

let cache: { empresaId: number; datos: Radar; en: number } | null = null
let enVuelo: Promise<Radar | null> | null = null

export async function obtenerRadar(empresaId: number, forzar = false): Promise<Radar | null> {
  if (!forzar && cache && cache.empresaId === empresaId && Date.now() - cache.en < TTL_MS) return cache.datos
  if (enVuelo) return enVuelo
  enVuelo = getRadar(empresaId)
    .then((r) => {
      const d = r.success && r.data ? r.data : null
      if (d) {
        cache = { empresaId, datos: d, en: Date.now() }
        window.dispatchEvent(new CustomEvent(EVENTO))
      }
      return d
    })
    .finally(() => { enVuelo = null })
  return enVuelo
}

export function useRadar(empresaId: number) {
  const [datos, setDatos] = useState<Radar | null>(() => (cache?.empresaId === empresaId ? cache.datos : null))
  const [cargando, setCargando] = useState(!datos)

  const recargar = useCallback(async (forzar = true) => {
    setCargando(true)
    const d = await obtenerRadar(empresaId, forzar)
    setDatos(d)
    setCargando(false)
  }, [empresaId])

  useEffect(() => {
    recargar(false)
    const onCambio = () => { if (cache?.empresaId === empresaId) setDatos(cache.datos) }
    window.addEventListener(EVENTO, onCambio)
    return () => window.removeEventListener(EVENTO, onCambio)
  }, [empresaId, recargar])

  return { datos, cargando, recargar }
}

export interface PendienteModulo {
  cantidad: number
  /** true si alguno de los grupos que apuntan a este módulo está en rojo. */
  alto: boolean
  texto: string
}

/** Pendientes por módulo: cada grupo del radar sabe a qué módulo lleva. */
export function pendientesPorModulo(r: Radar | null): Record<string, PendienteModulo> {
  const out: Record<string, PendienteModulo> = {}
  for (const g of r?.grupos ?? []) {
    const p = out[g.modulo] ?? { cantidad: 0, alto: false, texto: "" }
    p.cantidad += g.cantidad
    p.alto = p.alto || g.tono === "peligro"
    p.texto = p.texto ? `${p.texto} · ${g.cantidad} ${g.titulo.toLowerCase()}` : `${g.cantidad} ${g.titulo.toLowerCase()}`
    out[g.modulo] = p
  }
  return out
}

/** Pendientes por área, sumando los de sus módulos. */
export function pendientesPorArea(r: Radar | null): Record<string, PendienteModulo> {
  const porModulo = pendientesPorModulo(r)
  const out: Record<string, PendienteModulo> = {}
  for (const g of groups) {
    const modulos = [...(g.modules ?? []), ...(g.subgroups?.flatMap((s) => s.modules) ?? [])]
    for (const m of modulos) {
      const p = porModulo[m.name]
      if (!p) continue
      const a = out[g.key] ?? { cantidad: 0, alto: false, texto: "" }
      a.cantidad += p.cantidad
      a.alto = a.alto || p.alto
      a.texto = a.texto ? `${a.texto} · ${p.texto}` : p.texto
      out[g.key as GroupKey] = a
    }
  }
  return out
}
