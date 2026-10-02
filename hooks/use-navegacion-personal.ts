"use client"

// Favoritos y recientes de navegación, POR USUARIO, en el navegador.
// Comodidad personal (no es estado de negocio): localStorage con clave por
// usuario; todas las instancias del hook se sincronizan por un evento propio
// (y por `storage` entre pestañas). Se guardan nombres de módulo; quien los
// muestra debe filtrar por permiso y por existencia en el menú.
//
// Mismo mecanismo que LIPgo (hooks/use-navegacion-personal.ts): así un usuario
// que trabaja en los dos sistemas encuentra "Continuar donde ibas" igual.

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"

const EVENTO = "crm:nav-personal-cambio"
const MAX_RECIENTES = 10

export interface VisitaReciente {
  modulo: string
  ts: number
}

function leer<T>(clave: string, porDefecto: T): T {
  try {
    const raw = localStorage.getItem(clave)
    return raw ? (JSON.parse(raw) as T) : porDefecto
  } catch {
    return porDefecto
  }
}
function escribir(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor))
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: clave }))
  } catch {
    /* sin almacenamiento (modo privado): no pasa nada */
  }
}

export function useNavegacionPersonal() {
  const { profile, user } = useAuth()
  const uid = profile?.id ?? user?.id ?? "anon"
  const kFav = `crm:nav:favoritos:${uid}`
  const kRec = `crm:nav:recientes:${uid}`

  const [favoritos, setFavoritos] = useState<string[]>([])
  const [recientes, setRecientes] = useState<VisitaReciente[]>([])

  const recargar = useCallback(() => {
    setFavoritos(leer<string[]>(kFav, []))
    setRecientes(leer<VisitaReciente[]>(kRec, []))
  }, [kFav, kRec])

  useEffect(() => {
    recargar()
    const onCambio = () => recargar()
    window.addEventListener(EVENTO, onCambio)
    window.addEventListener("storage", onCambio)
    return () => {
      window.removeEventListener(EVENTO, onCambio)
      window.removeEventListener("storage", onCambio)
    }
  }, [recargar])

  const esFavorito = useCallback((m: string) => favoritos.includes(m), [favoritos])

  const toggleFavorito = useCallback(
    (m: string) => {
      const actual = leer<string[]>(kFav, [])
      escribir(kFav, actual.includes(m) ? actual.filter((x) => x !== m) : [...actual, m])
    },
    [kFav],
  )

  const registrarVisita = useCallback(
    (m: string) => {
      if (!m) return
      const actual = leer<VisitaReciente[]>(kRec, [])
      escribir(kRec, [{ modulo: m, ts: Date.now() }, ...actual.filter((x) => x.modulo !== m)].slice(0, MAX_RECIENTES))
    },
    [kRec],
  )

  return { favoritos, recientes, esFavorito, toggleFavorito, registrarVisita }
}
