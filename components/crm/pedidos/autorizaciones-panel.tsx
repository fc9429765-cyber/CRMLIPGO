"use client"

// Bandeja de aprobación: los pedidos esperando MI aprobación (PED-19, PED-20).
//
// Solo muestra lo que este usuario puede aprobar de verdad. Si ya dio la otra
// aprobación o creó el pedido, no aparece: verlo y no poder actuar es peor que
// no verlo, porque obliga a descubrir el porqué probando.
//
// El sobrecupo (PED-04) va en rojo en la propia fila y no escondido en el
// detalle: es lo que decide si un pedido se mira con lupa o se aprueba rápido.

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  CheckCircle, Clock, DollarSign, Inbox, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Stamp,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { getPedidosPendientesDeMiFirma } from "@/lib/crm-pedidos-actions"
import { listarMaestro } from "@/lib/crm-maestros-actions"
import { ROL_ETIQUETA, rolesQueFaltan, type ModoAprobacion, type Rol } from "@/lib/crm-pedidos-estado"
import { money, type PedidoConDetalle } from "@/lib/crm-pedidos"
import { AprobacionDialog, fechaHora, type MotivoRechazo } from "@/components/crm/pedidos/aprobacion-dialog"
import { KpiCompacto, KpiEsqueleto, TiraKpi } from "@/components/crm/ui/kpi-compacto"
import {
  BadgeEstado, CabeceraTabla, FilaCargando, FilaVacia, MarcoTabla, SinDatos, Td, Th, filaTabla,
} from "@/components/crm/ui/modulo"
import { SubNav } from "@/components/crm/ui/sub-nav"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export function AutorizacionesPanel() {
  const { selectedEmpresaId } = useAuth()
  const empresaId = selectedEmpresaId ?? 1

  const [pedidos, setPedidos] = useState<PedidoConDetalle[]>([])
  const [misRoles, setMisRoles] = useState<Rol[]>([])
  const [modo, setModo] = useState<ModoAprobacion>("secuencial")
  const [motivos, setMotivos] = useState<MotivoRechazo[]>([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<Rol | null>(null)
  const [abierto, setAbierto] = useState<PedidoConDetalle | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const res = await getPedidosPendientesDeMiFirma(empresaId)
    if (res.success && res.data) {
      setPedidos(res.data.pedidos)
      setMisRoles(res.data.roles)
      setModo(res.data.modo)
    } else {
      toast({ title: "No se pudo cargar la bandeja", description: res.error, variant: "destructive" })
    }
    setCargando(false)
  }, [empresaId])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Los motivos cambian poco: se leen una vez, no en cada recarga.
  useEffect(() => {
    listarMaestro("motivos", empresaId).then((r) => {
      if (!r.success) return
      setMotivos(
        (r.data ?? [])
          .filter((m) => m.tipo === "rechazo_pedido" && m.activo !== false)
          .map((m) => ({ id: m.id, nombre: String(m.nombre ?? ""), exige_nota: m.exige_nota === true })),
      )
    })
  }, [empresaId])

  // Con un solo rol la vista es ese rol; con los dos, la elige la píldora.
  // Cartera va primero porque en secuencial es la que desbloquea a Gerencia.
  const rolActivo: Rol | null = vista && misRoles.includes(vista) ? vista : misRoles[0] ?? null

  const porRol = useMemo(() => {
    const cuenta = { contabilidad: [] as PedidoConDetalle[], gerencia: [] as PedidoConDetalle[] }
    for (const p of pedidos) {
      for (const r of rolesQueFaltan(p, modo)) if (misRoles.includes(r)) cuenta[r].push(p)
    }
    return cuenta
  }, [pedidos, modo, misRoles])

  const visibles = rolActivo ? porRol[rolActivo] : []
  const valorTotal = visibles.reduce((s, p) => s + (Number(p.total) || 0), 0)
  const conSobrecupo = visibles.filter((p) => p.requiere_sobrecupo)
  const valorSobrecupo = conSobrecupo.reduce((s, p) => s + (Number(p.sobrecupo_valor) || 0), 0)

  if (!cargando && !misRoles.length) {
    return (
      <Card>
        <CardContent>
          <SinDatos
            icono={Stamp}
            mensaje="No tienes permisos de aprobación"
            ayuda="Las aprobaciones de Cartera y Gerencia se otorgan desde Configuración → Gestión de Usuarios."
          />
        </CardContent>
      </Card>
    )
  }

  const mostrarFirmaCartera = rolActivo === "gerencia"

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-[var(--chart-1)]/10 p-2 text-[var(--chart-1)]">
            <CheckCircle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Aprobar pedidos</h1>
            <p className="text-sm text-muted-foreground">
              {misRoles.length
                ? <>Apruebas como {misRoles.map((r) => ROL_ETIQUETA[r]).join(" y ")} · </>
                : null}
              {modo === "secuencial" ? "Orden: primero Cartera, luego Gerencia" : "Cualquiera de las dos primero"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={cargar} disabled={cargando}>
          {cargando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Actualizar
        </Button>
      </header>

      {misRoles.length > 1 && (
        <SubNav<Rol>
          vistas={misRoles.map((r) => ({
            valor: r,
            etiqueta: `${ROL_ETIQUETA[r]} (${porRol[r].length})`,
            icono: r === "contabilidad" ? ShieldCheck : Stamp,
          }))}
          activa={rolActivo ?? "contabilidad"}
          onCambiar={setVista}
        />
      )}

      <TiraKpi>
        {cargando && !pedidos.length ? (
          <>
            <KpiEsqueleto />
            <KpiEsqueleto />
            <KpiEsqueleto />
          </>
        ) : (
          <>
            <KpiCompacto
              etiqueta="Pedidos esperando"
              valor={visibles.length}
              detalle={rolActivo ? `Tu aprobación como ${ROL_ETIQUETA[rolActivo]}` : undefined}
              icono={Clock}
              tono={visibles.length ? "warning" : "neutral"}
            />
            <KpiCompacto etiqueta="Valor total" valor={money(valorTotal)} icono={DollarSign} />
            <KpiCompacto
              etiqueta="Con sobrecupo"
              valor={conSobrecupo.length}
              detalle={conSobrecupo.length ? `${money(valorSobrecupo)} por encima del cupo` : "Ninguno excede el cupo"}
              icono={ShieldAlert}
              tono={conSobrecupo.length ? "danger" : "neutral"}
            />
          </>
        )}
      </TiraKpi>

      {/* Escritorio: tabla. */}
      <div className="hidden md:block">
        <MarcoTabla>
          <Table>
            <TableHeader>
              <CabeceraTabla>
                <Th>Pedido</Th>
                <Th>Cliente / sucursal</Th>
                <Th>Vendedor</Th>
                <Th>Owner</Th>
                <Th>Solicitado</Th>
                <Th align="right">Total</Th>
              </CabeceraTabla>
            </TableHeader>
            <TableBody>
              {cargando && !pedidos.length ? (
                <FilaCargando columnas={6} />
              ) : visibles.length === 0 ? (
                <FilaVacia columnas={6} mensaje="No hay pedidos esperando tu aprobación." />
              ) : (
                visibles.map((p) => (
                  <TableRow
                    key={p.id}
                    className={cn(filaTabla, "cursor-pointer", p.requiere_sobrecupo && "bg-red-50/40")}
                    onClick={() => setAbierto(p)}
                  >
                    <Td className="align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{p.numero ?? `#${p.id}`}</span>
                        {(p.version ?? 1) > 1 && <BadgeEstado tono="proceso" className="text-[10px]">Reenvío v{p.version}</BadgeEstado>}
                      </div>
                      {p.requiere_sobrecupo && <ChipSobrecupo valor={p.sobrecupo_valor} className="mt-1" />}
                    </Td>
                    <Td className="max-w-[260px] align-top">
                      <p className="truncate font-medium">{p.cliente_nombre ?? "—"}</p>
                      <p className="truncate text-muted-foreground">{p.sucursal_nombre ?? "Sin sucursal"}</p>
                      {mostrarFirmaCartera && <FirmaCartera pedido={p} />}
                    </Td>
                    <Td className="align-top">{p.vendedor_nombre ?? "—"}</Td>
                    <Td className="align-top">{p.owner_nombre ?? "—"}</Td>
                    <Td className="align-top">
                      <p>{p.solicitado_nombre ?? p.creado_por ?? "—"}</p>
                      <p className="tabular-nums text-muted-foreground">{fechaHora(p.solicitado_en ?? p.creado_en)}</p>
                    </Td>
                    <Td num fuerte className="align-top">{money(p.total)}</Td>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </MarcoTabla>
      </div>

      {/* Móvil: tarjetas. Una tabla de seis columnas en un teléfono obliga a
          desplazar de lado justo para ver el total y el sobrecupo. */}
      <div className="space-y-2 md:hidden">
        {cargando && !pedidos.length ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibles.length === 0 ? (
          <Card>
            <CardContent>
              <SinDatos icono={Inbox} mensaje="No hay pedidos esperando tu aprobación." />
            </CardContent>
          </Card>
        ) : (
          visibles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setAbierto(p)}
              className={cn(
                "w-full rounded-lg border bg-card p-3 text-left text-xs transition-colors hover:bg-muted/30",
                p.requiere_sobrecupo && "border-red-300",
              )}
            >
              {p.requiere_sobrecupo && <ChipSobrecupo valor={p.sobrecupo_valor} className="mb-2" />}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{p.numero ?? `#${p.id}`}</span>
                    {(p.version ?? 1) > 1 && <BadgeEstado tono="proceso" className="text-[10px]">Reenvío v{p.version}</BadgeEstado>}
                  </div>
                  <p className="truncate font-medium">{p.cliente_nombre ?? "—"}</p>
                  <p className="truncate text-muted-foreground">{p.sucursal_nombre ?? "Sin sucursal"}</p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums">{money(p.total)}</p>
              </div>
              <p className="mt-1.5 text-muted-foreground">
                {p.vendedor_nombre ?? "—"} · {p.owner_nombre ?? "—"}
              </p>
              <p className="text-muted-foreground">
                Solicitó {p.solicitado_nombre ?? p.creado_por ?? "—"} · {fechaHora(p.solicitado_en ?? p.creado_en)}
              </p>
              {mostrarFirmaCartera && <FirmaCartera pedido={p} />}
            </button>
          ))
        )}
      </div>

      {abierto && rolActivo && (
        <AprobacionDialog
          // La clave se monta de nuevo por pedido: no se arrastra de uno a otro.
          key={`${abierto.id}-${rolActivo}`}
          pedido={abierto}
          rol={rolActivo}
          modo={modo}
          motivos={motivos}
          empresaId={empresaId}
          onCerrar={() => setAbierto(null)}
          onHecho={() => {
            setAbierto(null)
            cargar()
          }}
        />
      )}
    </div>
  )
}

/** PED-04: el sobrecupo, en rojo y con su valor. */
function ChipSobrecupo({ valor, className }: { valor?: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700",
        className,
      )}
    >
      <ShieldAlert className="h-3 w-3" aria-hidden="true" />
      Sobrecupo {money(Number(valor) || 0)}
    </span>
  )
}

/**
 * Para Gerencia: quién aprobó en Cartera y qué anotó. Es el contexto con el
 * que Gerencia decide, y en secuencial siempre existe.
 */
function FirmaCartera({ pedido: p }: { pedido: PedidoConDetalle }) {
  if (!p.auth_contabilidad_en) return null
  return (
    <div className="mt-1 text-[11px] text-emerald-700">
      <p>
        Aprobado por Cartera: {p.auth_contabilidad_nombre ?? "—"} · {fechaHora(p.auth_contabilidad_en)}
      </p>
      {p.auth_contabilidad_nota && <p className="italic text-muted-foreground">“{p.auth_contabilidad_nota}”</p>}
    </div>
  )
}

export default AutorizacionesPanel
