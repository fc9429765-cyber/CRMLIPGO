"use client"

// Cambio de contraseña del usuario del CRM.
//
// Es obligatoria cuando el usuario entra con una clave TEMPORAL (migrado desde
// LIPgo, recien creado o con la clave restablecida por el administrador): el
// middleware no le deja ver nada mas hasta que la cambie. Tambien se puede
// abrir a voluntad desde el menu de usuario.

import { useState } from "react"
import { Eye, EyeOff, KeyRound, Loader2, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { validarClaveNueva } from "@/lib/crm-token"

export default function CambiarClavePage() {
  const [actual, setActual] = useState("")
  const [nueva, setNueva] = useState("")
  const [repetir, setRepetir] = useState("")
  const [ver, setVer] = useState(false)
  const [error, setError] = useState("")
  const [guardando, setGuardando] = useState(false)

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    const invalida = validarClaveNueva(nueva, actual)
    if (invalida) return setError(invalida)
    if (nueva !== repetir) return setError("Las dos contraseñas nuevas no coinciden.")

    setGuardando(true)
    try {
      const res = await fetch("/api/crm-auth/cambiar-clave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        if (res.status === 401) {
          window.location.href = "/login"
          return
        }
        setError(data.error || "No se pudo cambiar la contraseña.")
        setGuardando(false)
        return
      }
      window.location.href = "/"
    } catch {
      setError("No se pudo cambiar la contraseña. Intenta de nuevo.")
      setGuardando(false)
    }
  }

  const salir = async () => {
    await fetch("/api/crm-auth/logout", { method: "POST" }).catch(() => {})
    window.location.href = "/login"
  }

  const tipo = ver ? "text" : "password"

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-xl">
            <KeyRound className="h-5 w-5 text-[#7A5A24]" aria-hidden="true" />
            Crea tu contraseña del CRM
          </CardTitle>
          <CardDescription>
            Es solo para el CRM: no cambia tu clave de LIPgo. Mínimo 10 caracteres, con letras y números.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={enviar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="actual">Contraseña actual o temporal</Label>
              <Input id="actual" type={tipo} autoComplete="current-password" value={actual}
                onChange={(e) => setActual(e.target.value)} required disabled={guardando} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nueva">Contraseña nueva</Label>
              <div className="relative">
                <Input id="nueva" type={tipo} autoComplete="new-password" value={nueva} className="pr-10"
                  onChange={(e) => setNueva(e.target.value)} required disabled={guardando} />
                <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar contraseñas" : "Mostrar contraseñas"}>
                  {ver ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="repetir">Repite la contraseña nueva</Label>
              <Input id="repetir" type={tipo} autoComplete="new-password" value={repetir}
                onChange={(e) => setRepetir(e.target.value)} required disabled={guardando} />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={guardando}>
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
              Guardar y entrar
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={salir} disabled={guardando}>
              <LogOut className="mr-2 h-4 w-4" /> Salir
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
