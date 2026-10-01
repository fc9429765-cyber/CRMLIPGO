// La tabla compartida con filas de verdad.
//
// El error "getVisibleCells is not a function" (TanStack v9: ese metodo solo
// existe con columnVisibilityFeature) no aparecia con la tabla vacia, que es
// como se probo al principio. Esta prueba la dibuja con datos.

import { describe, expect, it } from "vitest"
import { renderToString } from "react-dom/server"
import type { ColumnDef } from "@tanstack/react-table"
import { TablaDatos } from "@/components/crm/ui/tabla-datos"

interface Fila { cliente: string; saldo: number }

const columnas: ColumnDef<any, any>[] = [
  { accessorKey: "cliente", header: "Cliente" },
  { accessorKey: "saldo", header: "Saldo", cell: ({ getValue }) => `$ ${Number(getValue()).toLocaleString("es-CO")}` },
]

describe("TablaDatos", () => {
  it("dibuja las filas y sus celdas", () => {
    const html = renderToString(
      <TablaDatos<Fila> datos={[{ cliente: "PANADERIA A", saldo: 945000 }, { cliente: "PASTELERIA B", saldo: 10 }]} columnas={columnas} />,
    )
    expect(html).toContain("PANADERIA A")
    expect(html).toContain("PASTELERIA B")
    expect(html).toContain("945.000")
  })

  it("vacia, muestra el mensaje", () => {
    expect(renderToString(<TablaDatos<Fila> datos={[]} columnas={columnas} mensajeVacio="Nada por cobrar" />)).toContain("Nada por cobrar")
  })
})
