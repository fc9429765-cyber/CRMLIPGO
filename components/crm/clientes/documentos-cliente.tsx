"use client"

// Carpeta de documentos del cliente (PRO-03): lo que trajo como prospecto
// (RUT, cámara de comercio…), los estados de cuenta que se le compartieron y
// lo que se suba después.

import { useCallback, useEffect, useState } from "react"
import { Eye, FileUp, Loader2 } from "lucide-react"
import { getDocumentosCliente, getUrlDocumento, subirDocumentoCliente, type DocumentoCliente } from "@/lib/crm-prospectos-aprobacion-actions"
import { prepararArchivo, TIPOS_ACEPTADOS } from "@/lib/archivo-cliente"
import { CabeceraTabla, FilaVacia, MarcoTabla, Td, Th } from "@/components/crm/ui/modulo"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", year: "numeric" })

export function DocumentosCliente({ clienteId, empresaId, onConteo }: { clienteId: number; empresaId: number; onConteo?: (n: number) => void }) {
  const [docs, setDocs] = useState<DocumentoCliente[] | null>(null)
  const [subiendo, setSubiendo] = useState(false)

  const cargar = useCallback(async () => {
    const r = await getDocumentosCliente(clienteId, empresaId)
    const lista = r.success ? r.data ?? [] : []
    setDocs(lista)
    onConteo?.(lista.length)
  }, [clienteId, empresaId, onConteo])

  useEffect(() => { cargar() }, [cargar])

  const ver = async (id: number) => {
    const ventana = window.open("", "_blank")
    const r = await getUrlDocumento(id, empresaId)
    if (!r.success || !r.data) { ventana?.close(); toast({ title: "No se pudo abrir", description: r.error, variant: "destructive" }); return }
    if (ventana) ventana.location.href = r.data.url
  }

  const subir = async (original: File | null) => {
    if (!original) return
    const prep = await prepararArchivo(original)
    if ("error" in prep) { toast({ title: "No se puede subir", description: prep.error, variant: "destructive" }); return }
    setSubiendo(true)
    const fd = new FormData()
    fd.append("cliente_id", String(clienteId))
    fd.append("tipo_codigo", "OTRO")
    fd.append("archivo", prep.archivo)
    const r = await subirDocumentoCliente(fd, empresaId)
    setSubiendo(false)
    if (!r.success) { toast({ title: "No se subió", description: r.error, variant: "destructive" }); return }
    cargar()
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs hover:bg-muted ${subiendo ? "pointer-events-none opacity-50" : ""}`}>
          {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} Agregar documento
          <input type="file" accept={TIPOS_ACEPTADOS} className="hidden" onChange={(e) => { subir(e.target.files?.[0] ?? null); e.target.value = "" }} />
        </label>
      </div>
      <MarcoTabla alto="max-h-[320px]">
        <Table className="text-xs">
          <TableHeader>
            <CabeceraTabla>
              <Th>Documento</Th>
              <Th>Archivo</Th>
              <Th>Subido</Th>
              <Th>Origen</Th>
              <Th> </Th>
            </CabeceraTabla>
          </TableHeader>
          <TableBody>
            {docs === null ? <FilaVacia columnas={5} mensaje="Cargando…" /> : docs.length === 0 ? (
              <FilaVacia columnas={5} mensaje="El cliente no tiene documentos." />
            ) : docs.map((d) => (
              <TableRow key={d.id} className="hover:bg-muted/30">
                <Td className="font-medium">{d.tipo_nombre ?? "Otro"}</Td>
                <Td className="max-w-[200px] truncate">{d.nombre_archivo ?? "—"}</Td>
                <Td className="whitespace-nowrap">{d.subido_nombre ?? "—"} · {fecha(d.subido_en)}</Td>
                <Td>{d.prospecto_id ? "Expediente de prospecto" : "Cliente"}</Td>
                <Td><Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => ver(d.id)} title="Ver"><Eye className="h-3.5 w-3.5" /></Button></Td>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </MarcoTabla>
    </div>
  )
}

export default DocumentosCliente
