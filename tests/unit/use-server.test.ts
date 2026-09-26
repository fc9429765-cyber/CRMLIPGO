// Guardia: un archivo "use server" solo puede exportar funciones async.
//
// Next.js falla EN TIEMPO DE EJECUCION si uno exporta una constante, un objeto
// o una clase, y el fallo no se queda en ese archivo: tumba todas las acciones
// del servidor a la vez. Ya paso una vez en este proyecto. `tsc` no lo detecta;
// esta prueba si.

import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n)
    if (statSync(r).isDirectory()) return n === "node_modules" || n.startsWith(".") ? [] : archivos(r)
    return /\.(ts|tsx)$/.test(n) ? [r] : []
  })
}

const conDirectiva = ["lib", "app", "components"]
  .flatMap((d) => archivos(d))
  .filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")))

describe('archivos "use server"', () => {
  it("hay archivos que revisar", () => {
    expect(conDirectiva.length).toBeGreaterThan(10)
  })

  it.each(conDirectiva)("%s solo exporta funciones async y tipos", (f) => {
    const prohibidos = readFileSync(f, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^export\s+(const|let|var|class|enum|\{|default\s+(?!async\s+function))/.test(l))
    expect(prohibidos).toEqual([])
  })
})
