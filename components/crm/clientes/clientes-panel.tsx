"use client"

// Clientes: datos comerciales, cupo de crédito y lista de precios.
//
// IMPORTANTE: esta pantalla NO edita el maestro de clientes. Nombre, documento
// y datos fiscales los administra el sistema operativo, que comparte la tabla.
// Aquí solo se tocan las columnas comerciales que agregó el CRM, y la server
// action tiene una lista blanca por campo que lo impide aunque se intente.

import { useEffect, useMemo, useState } from "react"
import {
  Loader2, Search, Users, Wallet, Tag, ShieldAlert, MapPin, Pencil, Phone, Mail, ListChecks,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getClientesCrm, getClienteCrm, actualizarDatosComercialesCliente } from "@/lib/crm-catalogos-actions"
import { getListas, type ListaPrecios } from "@/lib/crm-precios-actions"
import { getVendedoresCrm } from "@/lib/crm-catalogos-actions"
import type { ClienteCrm, VendedorCrm } from "@/lib/crm-catalogos"
import { money } from "@/lib/crm-cotizaciones"
import { GpsCapture, type Ubicacion } from "@/components/crm/prospectos/gps-capture"
import { KpiCompacto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { MarcoTabla, FilaCargando, FilaVacia } from "@/components/crm/ui/modulo"
import { Cuenta360Dialog } from "@/components/crm/clientes/cuenta-360-dialog"
import { CatalogoClienteDialog } from "@/components/crm/clientes/catalogo-cliente-dialog"

const SIN_LISTA = "__ninguna__"
const SIN_VENDEDOR = "__ninguno__"

export function ClientesPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [clientes, setClientes] = useState<ClienteCrm[]>([])
  const [listas, setListas] = useState<ListaPrecios[]>([])
  const [vendedores, setVendedores] = useState<VendedorCrm[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState("")
  const [editando, setEditando] = useState<ClienteCrm | null>(null)
  // Consultas del cliente que no editan su ficha: la cuenta (cartera) y el
  // catálogo de productos que se le pueden vender.
  const [cuenta, setCuenta] = useState<ClienteCrm | null>(null)
  const [catalogo, setCatalogo] = useState<ClienteCrm | null>(null)

  const cargar = async () => {
    const [cRes, lRes, vRes] = await Promise.all([
      getClientesCrm(empresaId),
      getListas(empresaId),
      getVendedoresCrm(empresaId),
    ])
    if (cRes.success) setClientes(cRes.data ?? [])
    if (lRes.success) setListas(lRes.data ?? [])
    if (vRes.success) setVendedores(vRes.data ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    if (!t) return clientes
    return clientes.filter((c) =>
      [c.nombre, c.documento, c.personacontacto, c.celular].some((x) => x?.toLowerCase().includes(t)),
    )
  }, [clientes, busqueda])

  const totales = useMemo(
    () => ({
      conCupo: clientes.filter((c) => c.cupo_credito > 0).length,
      bloqueados: clientes.filter((c) => c.bloqueado_cartera).length,
      cupoTotal: clientes.reduce((s, c) => s + c.cupo_credito, 0),
    }),
    [clientes],
  )

  const abrirEdicion = async (c: ClienteCrm) => {
    // Se relee para traer la cartera pendiente, que no viene en el listado.
    const res = await getClienteCrm(c.id, empresaId)
    setEditando(res.success && res.data ? res.data : c)
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <Users className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Clientes</h1>
            <p className="text-sm text-muted-foreground">Cupo de crédito, lista de precios y ubicación. Los datos fiscales se
          administran en el sistema operativo.</p>
          </div>
        </div>
      </header>

      {/* Indicadores compactos: los de módulo, no los del tablero. */}
      <TiraKpi>
        <KpiCompacto etiqueta="Clientes activos" valor={clientes.length} icono={Users} tono="primary" />
        <KpiCompacto
          etiqueta="Cupo otorgado"
          valor={money(totales.cupoTotal)}
          detalle={`${totales.conCupo} con crédito`}
          icono={Wallet}
          tono="primary"
        />
        <KpiCompacto
          etiqueta="Bloqueados"
          valor={totales.bloqueados}
          icono={ShieldAlert}
          tono={totales.bloqueados > 0 ? "danger" : "neutral"}
        />
      </TiraKpi>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar cliente…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* La tabla no desaparece mientras carga: la cabecera se queda en su
          sitio y el aviso de carga ocupa el cuerpo. Cambiar el bloque entero
          por un spinner hace saltar el contenido dos veces en cada consulta. */}
      <Card>
        <MarcoTabla>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-xs font-semibold">Cliente</TableHead>
                <TableHead className="text-xs font-semibold">Contacto</TableHead>
                <TableHead className="text-xs font-semibold">Lista</TableHead>
                <TableHead className="text-xs font-semibold text-right">Cupo</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>

            <TableBody>
              {cargando ? (
                <FilaCargando columnas={5} />
              ) : visibles.length === 0 ? (
                <FilaVacia
                  columnas={5}
                  mensaje={
                    busqueda
                      ? "Ningún cliente coincide con la búsqueda."
                      : "Todavía no hay clientes."
                  }
                />
              ) : (
                visibles.slice(0, 200).map((c) => (
                <TableRow key={c.id} className={c.bloqueado_cartera ? "bg-destructive/5" : undefined}>
                  <TableCell className="text-xs">
                    <p className="max-w-[220px] truncate font-medium">{c.nombre}</p>
                    <div className="flex items-center gap-1.5">
                      {c.documento && (
                        <span className="text-xs text-muted-foreground">{c.documento}</span>
                      )}
                      {c.latitud != null && (
                        <MapPin className="h-3 w-3 text-[var(--chart-2)]" aria-label="Con ubicación" />
                      )}
                      {c.bloqueado_cartera && (
                        <Badge variant="destructive" className="text-[10px]">Bloqueado</Badge>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="text-xs text-muted-foreground">
                    {c.personacontacto && <p className="truncate">{c.personacontacto}</p>}
                    {c.celular && (
                      <p className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {c.celular}
                      </p>
                    )}
                  </TableCell>

                  <TableCell className="text-xs">
                    {c.lista_precio_nombre ? (
                      <Badge variant="outline" className="text-xs">
                        <Tag className="mr-1 h-3 w-3" />
                        {c.lista_precio_nombre}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Precio base</span>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-right tabular-nums">
                    {c.cupo_credito > 0 ? (
                      <>
                        <span className="font-medium">{money(c.cupo_credito)}</span>
                        <p className="text-[11px] text-muted-foreground">{c.dias_credito} días</p>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Solo contado</span>
                    )}
                  </TableCell>

                  <TableCell className="text-xs">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => setCuenta(c)}
                        aria-label="Cuenta 360" title="Cuenta 360"
                      >
                        <Wallet className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => setCatalogo(c)}
                        aria-label="Catálogo" title="Catálogo"
                      >
                        <ListChecks className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => abrirEdicion(c)}
                        aria-label="Editar" title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </MarcoTabla>

        {visibles.length > 200 && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Se muestran 200 de {visibles.length}. Usa la búsqueda para acotar.
          </p>
        )}
      </Card>

      {editando && (
        <EditorCliente
          cliente={editando}
          listas={listas}
          vendedores={vendedores}
          empresaId={empresaId}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            cargar()
          }}
        />
      )}

      {cuenta && (
        <Cuenta360Dialog
          clienteId={cuenta.id}
          empresaId={empresaId}
          abierto
          onCerrar={() => setCuenta(null)}
        />
      )}

      {catalogo && (
        <CatalogoClienteDialog
          clienteId={catalogo.id}
          clienteNombre={catalogo.nombre}
          empresaId={empresaId}
          abierto
          onCerrar={() => setCatalogo(null)}
        />
      )}
    </div>
  )
}

function EditorCliente({
  cliente, listas, vendedores, empresaId, onCerrar, onGuardado,
}: {
  cliente: ClienteCrm
  listas: ListaPrecios[]
  vendedores: VendedorCrm[]
  empresaId: number
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [cupo, setCupo] = useState(String(cliente.cupo_credito))
  const [dias, setDias] = useState(String(cliente.dias_credito))
  const [listaId, setListaId] = useState(cliente.lista_precio_id ? String(cliente.lista_precio_id) : SIN_LISTA)
  const [vendedorId, setVendedorId] = useState(
    cliente.vendedor_asignado ? String(cliente.vendedor_asignado) : SIN_VENDEDOR,
  )
  const [segmento, setSegmento] = useState(cliente.segmento ?? "")
  const [bloqueado, setBloqueado] = useState(cliente.bloqueado_cartera)
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(
    cliente.latitud != null && cliente.longitud != null
      ? { latitud: cliente.latitud, longitud: cliente.longitud, precision_m: 0 }
      : null,
  )
  const [guardando, setGuardando] = useState(false)

  const cupoNum = Number(cupo) || 0
  const pendiente = cliente.cartera_pendiente ?? 0
  const disponible = cupoNum - pendiente

  const guardar = async () => {
    setGuardando(true)
    const res = await actualizarDatosComercialesCliente(
      cliente.id,
      {
        cupo_credito: cupoNum,
        dias_credito: Number(dias) || 0,
        lista_precio_id: listaId === SIN_LISTA ? null : Number(listaId),
        vendedor_asignado: vendedorId === SIN_VENDEDOR ? null : Number(vendedorId),
        segmento: segmento.trim() || null,
        bloqueado_cartera: bloqueado,
        latitud: ubicacion?.latitud ?? null,
        longitud: ubicacion?.longitud ?? null,
      },
      empresaId,
    )
    setGuardando(false)

    if (!res.success) {
      toast({ title: "No se guardó", description: res.error, variant: "destructive" })
      return
    }
    toast({ title: "Cliente actualizado" })
    onGuardado()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cliente.nombre}</DialogTitle>
          <DialogDescription>
            {cliente.documento && `${cliente.documento} · `}
            Datos comerciales
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Crédito</h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm">Cupo</Label>
                <Input type="number" min="0" value={cupo} onChange={(e) => setCupo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Plazo (días)</Label>
                <Input type="number" min="0" value={dias} onChange={(e) => setDias(e.target.value)} />
              </div>
            </div>

            {/* Cuánto le queda: sin esto, el cupo es un número sin contexto. */}
            {cupoNum > 0 && (
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Cupo</p>
                  <p className="font-medium tabular-nums">{money(cupoNum)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Usado</p>
                  <p className="font-medium tabular-nums">{money(pendiente)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Disponible</p>
                  <p className={`font-semibold tabular-nums ${disponible < 0 ? "text-destructive" : "text-[var(--chart-2)]"}`}>
                    {money(disponible)}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">Bloquear ventas a crédito</Label>
                <p className="text-xs text-muted-foreground">
                  Independiente del cupo. Lo usa cartera cuando hay mora grave.
                </p>
              </div>
              <Switch checked={bloqueado} onCheckedChange={setBloqueado} />
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-medium">Comercial</h3>

            <div className="space-y-1.5">
              <Label className="text-sm">Lista de precios</Label>
              <Select value={listaId} onValueChange={setListaId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_LISTA}>Precio base (sin lista)</SelectItem>
                  {listas.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm">Vendedor asignado</Label>
                <Select value={vendedorId} onValueChange={setVendedorId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_VENDEDOR}>Sin asignar</SelectItem>
                    {vendedores.map((v) => (
                      <SelectItem key={v.idvendedor} value={String(v.idvendedor)}>
                        {v.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Segmento</Label>
                <Input
                  value={segmento}
                  onChange={(e) => setSegmento(e.target.value)}
                  placeholder="Mayorista, panadería…"
                />
              </div>
            </div>
          </section>

          <Separator />

          {/* La ubicación alimenta el planificador de rutas. */}
          <GpsCapture value={ubicacion} onChange={setUbicacion} auto={false} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ClientesPanel
