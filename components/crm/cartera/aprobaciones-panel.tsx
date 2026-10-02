"use client"

// Torre de control de aprobaciones (Cartera → Aprobaciones).
//
// Todo lo que el personal administrativo tiene que aprobar, en una sola
// lista y del más antiguo al más reciente: pedidos esperando su firma,
// recaudos por aprobar y prospectos por volver clientes con sus documentos.
// Lo que pasó de las horas configuradas se marca en rojo.
//
// Cada fila se abre con el MISMO diálogo de su módulo (aprobación de pedido,
// detalle de recaudo, expediente del prospecto): las reglas no cambian por
// aprobar desde aquí. Al decidir, la lista se recarga sola.

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle, CheckCircle2, Clock, FolderOpen, Inbox, Loader2, Receipt, RefreshCw, Search, Send, ShieldCheck, Wallet,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import {
  getBandejaAprobaciones, type BandejaAprobaciones, type ItemAprobacion, type TipoAprobacion,
} from "@/lib/crm-aprobaciones-actions"
import { getPermisosRecaudo, type PermisosRecaudo } from "@/lib/crm-recaudos-actions"
import { listarMaestro } from "@/lib/crm-maestros-actions"
import { abrirCuenta360 } from "@/lib/crm-navegacion"
import { AprobacionDialog, type MotivoRechazo } from "@/components/crm/pedidos/aprobacion-dialog"
import { RecaudoDetalleDialog } from "@/components/crm/recaudos/recaudo-detalle-dialog"
import { useMaestrosRecaudo } from "@/components/crm/recaudos/comun"
import { ExpedienteDialog } from "@/components/crm/prospectos/expediente-dialog"
import { KpiCompacto, KpiEsqueleto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import { BadgeEstado, CabeceraTabla, FilaCargando, FilaVacia, MarcoTabla, SinDatos, Td, Th, filaTabla, type TonoEstado } from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { FuenteDato } from "@/components/crm/ui/detalle-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type Vista = "todo" | TipoAprobacion

const TIPO: Record<TipoAprobacion, { etiqueta: string; icono: typeof Send; tono: TonoEstado }> = {
  pedido: { etiqueta: "Pedido", icono: Send, tono: "info" },
  recaudo: { etiqueta: "Recaudo", icono: Receipt, tono: "exito" },
  prospecto: { etiqueta: "Cliente nuevo", icono: FolderOpen, tono: "proceso" },
}

const pesos = (n: number | null) => (n == null ? "—" : "$ " + Math.round(n).toLocaleString("es-CO"))

/** "3 h", "2 d 4 h": cuánto lleva esperando. */
function espera(iso: string | null, ahora: number): { texto: string; horas: number } {
  if (!iso) return { texto: "—", horas: 0 }
  const horas = Math.max(0, (ahora - Date.parse(iso)) / 3_600_000)
  if (horas < 1) return { texto: `${Math.max(1, Math.round(horas * 60))} min`, horas }
  if (horas < 24) return { texto: `${Math.floor(horas)} h`, horas }
  const d = Math.floor(horas / 24)
  const h = Math.floor(horas % 24)
  return { texto: h ? `${d} d ${h} h` : `${d} d`, horas }
}

export function AprobacionesPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1
  const maestros = useMaestrosRecaudo(empresaId)

  const [bandeja, setBandeja] = useState<BandejaAprobaciones | null>(null)
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<Vista>("todo")
  const [texto, setTexto] = useState("")
  const [abierto, setAbierto] = useState<ItemAprobacion | null>(null)
  const [permisosRecaudo, setPermisosRecaudo] = useState<PermisosRecaudo | null>(null)
  const [motivosPedido, setMotivosPedido] = useState<MotivoRechazo[]>([])
  const [ahora, setAhora] = useState(() => Date.now())

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await getBandejaAprobaciones(empresaId)
    if (r.success && r.data) setBandeja(r.data)
    else toast({ title: "No se pudo cargar la bandeja", description: r.error, variant: "destructive" })
    setAhora(Date.now())
    setCargando(false)
  }, [empresaId])

  useEffect(() => { cargar() }, [cargar])

  // Se refresca sola cada minuto mientras la pestaña está a la vista y no hay
  // un diálogo abierto (recargar debajo de una decisión a medias confunde).
  useEffect(() => {
    if (abierto) return
    const t = setInterval(() => { if (document.visibilityState === "visible") cargar() }, 60_000)
    return () => clearInterval(t)
  }, [cargar, abierto])

  useEffect(() => {
    getPermisosRecaudo().then((r) => r.success && r.data && setPermisosRecaudo(r.data))
    listarMaestro("motivos", empresaId).then((r) => {
      if (!r.success) return
      setMotivosPedido((r.data ?? [])
        .filter((m) => m.tipo === "rechazo_pedido" && m.activo !== false)
        .map((m) => ({ id: m.id, nombre: String(m.nombre ?? ""), exige_nota: m.exige_nota === true })))
    })
  }, [empresaId])

  const items = bandeja?.items ?? []
  const horasAlerta = bandeja?.horasAlerta ?? 24
  const conEspera = useMemo(() => items.map((i) => ({ ...i, espera: espera(i.solicitadoEn, ahora) })), [items, ahora])

  const visibles = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return conEspera
      .filter((i) => vista === "todo" || i.tipo === vista)
      .filter((i) => !t || [i.referencia, i.titulo, i.subtitulo, i.solicitadoPor].some((x) => x?.toLowerCase().includes(t)))
      // Lo vencido arriba; dentro de cada grupo, lo más antiguo primero.
      .sort((a, b) => Number(b.espera.horas > horasAlerta) - Number(a.espera.horas > horasAlerta) || b.espera.horas - a.espera.horas)
  }, [conEspera, vista, texto, horasAlerta])

  const resumen = useMemo(() => {
    const de = (t: TipoAprobacion) => items.filter((i) => i.tipo === t)
    const valor = (l: ItemAprobacion[]) => l.reduce((s, i) => s + (i.valor ?? 0), 0)
    return {
      pedidos: de("pedido"), recaudos: de("recaudo"), prospectos: de("prospecto"),
      valorPedidos: valor(de("pedido")), valorRecaudos: valor(de("recaudo")),
      sobrecupo: de("pedido").filter((i) => i.senales.some((s) => s.texto.startsWith("Sobrecupo"))).length,
      alertasRecaudo: de("recaudo").filter((i) => i.senales.some((s) => s.tono === "advertencia")).length,
      vencidos: conEspera.filter((i) => i.espera.horas > horasAlerta).length,
    }
  }, [items, conEspera, horasAlerta])

  const puede = bandeja?.puede
  const nada = puede && !puede.pedidos.length && !puede.recaudos && !puede.prospectos
  const sinPermiso = bandeja?.sinPermiso ?? { recaudos: 0, prospectos: 0 }
  // Hay cosas esperando que este usuario no puede ver: se dice, con el
  // permiso que falta, en vez de mostrar una bandeja vacía.
  const avisoPermisos = [
    sinPermiso.recaudos ? `${sinPermiso.recaudos} recaudo${sinPermiso.recaudos === 1 ? "" : "s"} (permiso "Aprobar Recaudos")` : null,
    sinPermiso.prospectos ? `${sinPermiso.prospectos} cliente${sinPermiso.prospectos === 1 ? "" : "s"} nuevo${sinPermiso.prospectos === 1 ? "" : "s"} (permiso "Aprobar Prospectos")` : null,
  ].filter(Boolean) as string[]
  const textoAviso = avisoPermisos.length
    ? `Hay ${avisoPermisos.join(" y ")} esperando aprobación que no ves porque a tu usuario le falta ese permiso. Se otorga en Configuración → Gestión de Usuarios.`
    : null
  if (nada) {
    return (
      <Card><CardContent>
        <SinDatos icono={ShieldCheck} mensaje="No tienes aprobaciones a cargo"
          ayuda={textoAviso ?? "Esta bandeja reúne las aprobaciones de Cartera y Gerencia: pedidos, recaudos y clientes nuevos. Los permisos se otorgan en Gestión de Usuarios."} />
      </CardContent></Card>
    )
  }

  const pedidoAbierto = abierto?.tipo === "pedido" ? bandeja?.pedidos.find((p) => p.id === abierto.id) ?? null : null
  const cerrarYRecargar = () => { setAbierto(null); cargar() }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Aprobaciones</h1>
            <p className="text-sm text-muted-foreground">
              Todo lo que espera tu decisión, lo más antiguo primero
              {puede?.pedidos.length ? ` · firmas como ${puede.pedidos.map((r) => (r === "contabilidad" ? "Cartera" : "Gerencia")).join(" y ")}` : ""}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={cargar} disabled={cargando}>
          {cargando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Actualizar
        </Button>
      </header>

      {textoAviso && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{textoAviso}</span>
        </div>
      )}

      <TiraKpi>
        {!bandeja ? (<><KpiEsqueleto /><KpiEsqueleto /><KpiEsqueleto /><KpiEsqueleto /></>) : (
          <>
            <KpiCompacto
              etiqueta="Por decidir" valor={items.length} icono={Inbox}
              detalle={resumen.vencidos ? `${resumen.vencidos} con más de ${horasAlerta} h` : "Nada atrasado"}
              tono={resumen.vencidos ? "danger" : items.length ? "warning" : "success"}
              onClick={() => setVista("todo")}
            />
            {!!puede?.pedidos.length && (
              <KpiCompacto
                etiqueta="Pedidos" valor={resumen.pedidos.length} icono={Send}
                detalle={`${pesos(resumen.valorPedidos)}${resumen.sobrecupo ? ` · ${resumen.sobrecupo} con sobrecupo` : ""}`}
                tono={resumen.sobrecupo ? "danger" : resumen.pedidos.length ? "warning" : "neutral"}
                onClick={() => setVista("pedido")}
              />
            )}
            {puede?.recaudos && (
              <KpiCompacto
                etiqueta="Recaudos" valor={resumen.recaudos.length} icono={Receipt}
                detalle={`${pesos(resumen.valorRecaudos)}${resumen.alertasRecaudo ? ` · ${resumen.alertasRecaudo} con alertas` : ""}`}
                tono={resumen.alertasRecaudo ? "danger" : resumen.recaudos.length ? "warning" : "neutral"}
                onClick={() => setVista("recaudo")}
              />
            )}
            {puede?.prospectos && (
              <KpiCompacto
                etiqueta="Clientes nuevos" valor={resumen.prospectos.length} icono={FolderOpen}
                detalle="Expedientes y documentos"
                tono={resumen.prospectos.length ? "warning" : "neutral"}
                onClick={() => setVista("prospecto")}
              />
            )}
          </>
        )}
      </TiraKpi>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubNav<Vista>
          vistas={[
            { valor: "todo", etiqueta: "Todo", icono: Inbox, contador: items.length || undefined },
            ...(puede?.pedidos.length ? [{ valor: "pedido" as Vista, etiqueta: "Pedidos", icono: Send, contador: resumen.pedidos.length || undefined }] : []),
            ...(puede?.recaudos ? [{ valor: "recaudo" as Vista, etiqueta: "Recaudos", icono: Receipt, contador: resumen.recaudos.length || undefined }] : []),
            ...(puede?.prospectos ? [{ valor: "prospecto" as Vista, etiqueta: "Clientes nuevos", icono: FolderOpen, contador: resumen.prospectos.length || undefined }] : []),
          ]}
          activa={vista}
          onCambiar={setVista}
        />
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" placeholder="Cliente, número, vendedor…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
      </div>

      {/* Escritorio */}
      <div className="hidden md:block">
        <MarcoTabla>
          <Table>
            <TableHeader>
              <CabeceraTabla>
                <Th>Qué</Th>
                <Th>Cliente</Th>
                <Th>A revisar</Th>
                <Th>Solicitó</Th>
                <Th align="right">Espera</Th>
                <Th align="right">Valor</Th>
                <Th> </Th>
              </CabeceraTabla>
            </TableHeader>
            <TableBody>
              {cargando && !bandeja ? <FilaCargando columnas={7} /> : visibles.length === 0 ? (
                <FilaVacia columnas={7} mensaje={items.length ? "Nada coincide con el filtro." : "Todo al día: no hay nada esperando tu aprobación."} />
              ) : visibles.map((i) => {
                const t = TIPO[i.tipo]
                const tarde = i.espera.horas > horasAlerta
                return (
                  <TableRow key={i.clave} className={cn(filaTabla, "cursor-pointer", tarde && "bg-red-50/50")} onClick={() => setAbierto(i)}>
                    <Td className="align-top">
                      <BadgeEstado tono={t.tono} icono={t.icono} className="text-[10px]">{t.etiqueta}</BadgeEstado>
                      <p className="mt-1 font-semibold">{i.referencia}</p>
                    </Td>
                    <Td className="max-w-[260px] align-top">
                      <p className="truncate font-medium">{i.titulo}</p>
                      {i.subtitulo && <p className="truncate text-muted-foreground">{i.subtitulo}</p>}
                    </Td>
                    <Td className="max-w-[240px] align-top">
                      {i.senales.length ? (
                        <div className="flex flex-wrap gap-1">
                          {i.senales.map((s) => (
                            <BadgeEstado key={s.texto} tono={s.tono} className="text-[10px]">{s.texto}</BadgeEstado>
                          ))}
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </Td>
                    <Td className="align-top">{i.solicitadoPor ?? "—"}</Td>
                    <Td num className={cn("align-top", tarde && "font-semibold text-red-700")}>
                      {tarde && <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />}
                      {i.espera.texto}
                    </Td>
                    <Td num fuerte className="align-top">{pesos(i.valor)}</Td>
                    <Td className="align-top">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {i.clienteId && (
                          <Button variant="ghost" size="sm" className="h-7 px-1.5" title="Cuenta del cliente" onClick={() => abrirCuenta360(i.clienteId!)}>
                            <Wallet className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button size="sm" className="h-7 text-xs" onClick={() => setAbierto(i)}>Revisar</Button>
                      </div>
                    </Td>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </MarcoTabla>
      </div>

      {/* Móvil */}
      <div className="space-y-2 md:hidden">
        {cargando && !bandeja ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : visibles.length === 0 ? (
          <Card><CardContent><SinDatos icono={CheckCircle2} mensaje={items.length ? "Nada coincide con el filtro." : "Todo al día"} /></CardContent></Card>
        ) : visibles.map((i) => {
          const t = TIPO[i.tipo]
          const tarde = i.espera.horas > horasAlerta
          return (
            <button key={i.clave} type="button" onClick={() => setAbierto(i)}
              className={cn("w-full rounded-lg border bg-card p-3 text-left text-xs hover:bg-muted/30", tarde && "border-red-300")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <BadgeEstado tono={t.tono} className="text-[10px]">{t.etiqueta}</BadgeEstado>
                  <p className="mt-1 truncate font-semibold">{i.titulo}</p>
                  <p className="text-muted-foreground">{i.referencia}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">{pesos(i.valor)}</p>
                  <p className={cn("flex items-center justify-end gap-1", tarde ? "font-semibold text-red-700" : "text-muted-foreground")}>
                    <Clock className="h-3 w-3" /> {i.espera.texto}
                  </p>
                </div>
              </div>
              {i.senales.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {i.senales.map((s) => <BadgeEstado key={s.texto} tono={s.tono} className="text-[10px]">{s.texto}</BadgeEstado>)}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {bandeja && (
        <FuenteDato>
          Se marca en rojo lo que lleva más de {horasAlerta} h esperando (Parametrización → Aprobaciones). Cada decisión
          aplica las mismas reglas de su módulo. Se actualiza sola cada minuto.
        </FuenteDato>
      )}

      {/* ------------------------------------------------ el diálogo de cada tipo */}
      {abierto?.tipo === "pedido" && pedidoAbierto && abierto.rol && bandeja && (
        <AprobacionDialog
          key={abierto.clave}
          pedido={pedidoAbierto}
          rol={abierto.rol}
          modo={bandeja.modo}
          motivos={motivosPedido}
          empresaId={empresaId}
          onCerrar={() => setAbierto(null)}
          onHecho={cerrarYRecargar}
        />
      )}
      {abierto?.tipo === "recaudo" && permisosRecaudo && (
        <RecaudoDetalleDialog
          key={abierto.clave}
          recaudoId={abierto.id}
          empresaId={empresaId}
          permisos={permisosRecaudo}
          maestros={maestros}
          onCerrar={() => setAbierto(null)}
          onCambio={cargar}
        />
      )}
      {abierto?.tipo === "prospecto" && (
        <ExpedienteDialog
          key={abierto.clave}
          prospectoId={abierto.id}
          empresaId={empresaId}
          modo="cartera"
          onCerrar={() => setAbierto(null)}
          onCambio={cargar}
        />
      )}
    </div>
  )
}

export default AprobacionesPanel
