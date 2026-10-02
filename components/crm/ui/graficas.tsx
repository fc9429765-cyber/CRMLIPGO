"use client"

// Gráficas del CRM.
//
// Recharts ya estaba en el árbol y LIPgo lo usa en 28 archivos con seis tipos
// distintos; el CRM solo usaba dos, y cada panel volvía a cablear a mano los
// ejes, la rejilla, el degradado y el tooltip: unas cuarenta líneas repetidas
// por gráfica, que es donde se cuelan las diferencias de estilo.
//
// Aquí se fija ese cableado una vez. Lo que cada panel pasa son los datos y las
// claves; todo lo demás —colores de marca, tipografía de los ejes, formato de
// pesos, rejilla sin líneas verticales— viene dado.
//
// Los colores salen de los tokens del tema, no de literales sueltos, para que
// una gráfica y un KPI del mismo color sigan coincidiendo si el tema cambia.

import type { ReactNode } from "react"
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Legend, Line, LineChart, Pie, PieChart, PolarAngleAxis,
  RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"

/** Paleta de marca. El primer color es el cian de LIPgo. */
export const COLORES = [
  "#0c6b61", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6", "#0ea5e9", "#14b8a6",
] as const

const money = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

/** Abrevia en los ejes: "1.2M" se lee; "1200000" empuja el eje y no se lee. */
const ejeCorto = (v: number) =>
  Math.abs(v) >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : Math.abs(v) >= 1000
      ? `${Math.round(v / 1000)}k`
      : String(v)

/** Estilo del tooltip, idéntico en todas las gráficas. */
const TOOLTIP = {
  contentStyle: {
    backgroundColor: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    fontSize: 12,
  },
  labelStyle: { fontWeight: 600, marginBottom: 2 },
} as const

const EJE = {
  tick: { fontSize: 10, fill: "var(--muted-foreground)" },
  axisLine: false,
  tickLine: false,
} as const

interface BaseProps {
  datos: any[]
  /** Campo del eje horizontal (o de la etiqueta en las circulares). */
  x: string
  alto?: number
  /** true cuando los valores son pesos: cambia el formato de eje y tooltip. */
  moneda?: boolean
  className?: string
}

/** Envoltorio común: alto fijo y contenedor que se adapta al ancho. */
function Marco({ alto = 224, children }: { alto?: number; children: ReactNode }) {
  return (
    <div style={{ height: alto }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as any}
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Área con degradado. Es la gráfica de evolución en el tiempo.
 *
 * El degradado bajo la línea no es decoración: da sensación de volumen y
 * distingue de un vistazo la serie principal de las de apoyo.
 */
export function GraficaArea({
  datos, x, y, etiqueta, color = COLORES[0], alto, moneda, formatoX,
}: BaseProps & {
  y: string
  etiqueta?: string
  color?: string
  formatoX?: (v: any) => string
}) {
  // El id del degradado debe ser único por gráfica: con dos áreas en la misma
  // pantalla y el mismo id, la segunda hereda el degradado de la primera.
  const id = `grad-${y}-${color.replace("#", "")}`

  return (
    <Marco alto={alto}>
      <AreaChart data={datos} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey={x} tickFormatter={formatoX} {...EJE} />
        <YAxis tickFormatter={moneda ? ejeCorto : undefined} {...EJE} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v: number) => [moneda ? money(v) : v.toLocaleString("es-CO"), etiqueta ?? y]}
        />
        <Area type="monotone" dataKey={y} stroke={color} strokeWidth={2} fill={`url(#${id})`} />
      </AreaChart>
    </Marco>
  )
}

/** Barras. Para comparar categorías entre sí (vendedores, productos, zonas). */
export function GraficaBarras({
  datos, x, y, etiqueta, color = COLORES[0], alto, moneda, horizontal, colorear,
}: BaseProps & {
  y: string
  etiqueta?: string
  color?: string
  /** Barras horizontales: obligatorio cuando las etiquetas son nombres largos. */
  horizontal?: boolean
  /** Un color distinto por barra, tomado de la paleta. */
  colorear?: boolean
}) {
  return (
    <Marco alto={alto}>
      <BarChart
        data={datos}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 8, left: horizontal ? 8 : -12, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} stroke="var(--border)" />
        {horizontal ? (
          <>
            <XAxis type="number" tickFormatter={moneda ? ejeCorto : undefined} {...EJE} />
            <YAxis type="category" dataKey={x} width={110} {...EJE} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} {...EJE} />
            <YAxis tickFormatter={moneda ? ejeCorto : undefined} {...EJE} />
          </>
        )}
        <Tooltip
          {...TOOLTIP}
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          formatter={(v: number) => [moneda ? money(v) : v.toLocaleString("es-CO"), etiqueta ?? y]}
        />
        <Bar dataKey={y} fill={color} radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]}>
          {colorear &&
            datos.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
        </Bar>
      </BarChart>
    </Marco>
  )
}

/** Líneas. Para comparar dos o más series en el tiempo. */
export function GraficaLineas({
  datos, x, series, alto, moneda, formatoX,
}: BaseProps & {
  series: { clave: string; etiqueta: string; color?: string }[]
  formatoX?: (v: any) => string
}) {
  return (
    <Marco alto={alto}>
      <LineChart data={datos} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey={x} tickFormatter={formatoX} {...EJE} />
        <YAxis tickFormatter={moneda ? ejeCorto : undefined} {...EJE} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v: number) => (moneda ? money(v) : v.toLocaleString("es-CO"))}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Line
            key={s.clave}
            type="monotone"
            dataKey={s.clave}
            name={s.etiqueta}
            stroke={s.color ?? COLORES[i % COLORES.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </Marco>
  )
}

/**
 * Dónut. Para repartos: cartera por tramo, ventas por categoría.
 *
 * Con agujero y no tarta maciza porque el centro sirve para el total, que es
 * justo el dato que falta cuando se mira un reparto.
 */
export function GraficaDonut({
  datos, x, y, alto = 224, moneda, total, etiquetaTotal,
}: BaseProps & {
  y: string
  /** Texto grande del centro. Si se omite, no se dibuja nada ahí. */
  total?: string
  etiquetaTotal?: string
}) {
  return (
    <div className="relative" style={{ height: alto }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={datos}
            dataKey={y}
            nameKey={x}
            innerRadius="58%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="var(--card)"
            strokeWidth={2}
          >
            {datos.map((_, i) => (
              <Cell key={i} fill={COLORES[i % COLORES.length]} />
            ))}
          </Pie>
          <Tooltip
            {...TOOLTIP}
            formatter={(v: number, n: string) => [moneda ? money(v) : v.toLocaleString("es-CO"), n]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>

      {total && (
        // `pointer-events-none` para que el texto del centro no bloquee el
        // tooltip de los segmentos que quedan debajo.
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-6">
          <span className="text-lg font-bold tabular-nums leading-none">{total}</span>
          {etiquetaTotal && (
            <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {etiquetaTotal}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Barra radial de cumplimiento. Para "meta vs alcanzado" de un vendedor.
 *
 * Se recorta a 100 para dibujar, pero el número del centro muestra el valor
 * real: pasarse de la meta es buena noticia y hay que verla.
 */
export function GraficaCumplimiento({
  porcentaje, etiqueta, alto = 180,
}: {
  porcentaje: number
  etiqueta?: string
  alto?: number
}) {
  const color =
    porcentaje >= 100 ? COLORES[1] : porcentaje >= 70 ? COLORES[2] : COLORES[3]

  return (
    <div className="relative" style={{ height: alto }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={[{ name: etiqueta ?? "Cumplimiento", value: Math.min(100, Math.max(0, porcentaje)) }]}
          innerRadius="68%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={999} fill={color} background />
        </RadialBarChart>
      </ResponsiveContainer>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tabular-nums leading-none" style={{ color }}>
          {Math.round(porcentaje)}%
        </span>
        {etiqueta && (
          <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {etiqueta}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Combinada: barras más una línea sobre el mismo eje temporal.
 *
 * Es la forma de poner juntos un volumen y una tasa —ventas y margen, pedidos y
 * cumplimiento— sin que la escala de uno aplaste al otro.
 */
export function GraficaCombinada({
  datos, x, barra, linea, alto, moneda, formatoX,
}: BaseProps & {
  barra: { clave: string; etiqueta: string; color?: string }
  linea: { clave: string; etiqueta: string; color?: string }
  formatoX?: (v: any) => string
}) {
  return (
    <Marco alto={alto}>
      <ComposedChart data={datos} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey={x} tickFormatter={formatoX} {...EJE} />
        <YAxis yAxisId="izq" tickFormatter={moneda ? ejeCorto : undefined} {...EJE} />
        <YAxis yAxisId="der" orientation="right" {...EJE} />
        <Tooltip {...TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          yAxisId="izq"
          dataKey={barra.clave}
          name={barra.etiqueta}
          fill={barra.color ?? COLORES[0]}
          radius={[6, 6, 0, 0]}
        />
        <Line
          yAxisId="der"
          type="monotone"
          dataKey={linea.clave}
          name={linea.etiqueta}
          stroke={linea.color ?? COLORES[2]}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </Marco>
  )
}
