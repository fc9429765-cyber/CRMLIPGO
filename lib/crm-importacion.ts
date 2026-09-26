// Importacion por archivo: definicion de cada tipo y lectura de valores.
//
// Sin "use server": logica pura. El navegador lee el Excel y manda las filas;
// el servidor las valida con ESTAS funciones, decide que haria con cada una y
// guarda la simulacion. Las pruebas cubren lo que mas falla en archivos
// reales: numeros con puntos de miles, fechas como numero de serie de Excel,
// encabezados con tildes o mayusculas.

export type TipoImportacion =
  | "clientes" | "productos" | "catalogo" | "sucursales"
  | "vendedores_usuarios" | "facturas" | "saldos_iniciales"

export type TipoCampo = "texto" | "numero" | "fecha" | "booleano"

export interface CampoImportacion {
  clave: string
  etiqueta: string
  tipo: TipoCampo
  obligatorio?: boolean
  ayuda?: string
}

export interface DefinicionImportacion {
  tipo: TipoImportacion
  titulo: string
  descripcion: string
  /** Permiso adicional al de importar. */
  permiso: string
  campos: CampoImportacion[]
}

export const IMPORTACIONES: Record<TipoImportacion, DefinicionImportacion> = {
  clientes: {
    tipo: "clientes",
    titulo: "Clientes",
    descripcion: "Crea clientes nuevos o actualiza sus datos comerciales. Se identifican por el NIT o documento.",
    permiso: "crm_clientes",
    campos: [
      { clave: "documento", etiqueta: "NIT / documento", tipo: "texto", obligatorio: true,
        ayuda: "Con o sin dígito de verificación. Si el NIT está repetido en LIPgo, agrega la columna Id cliente." },
      { clave: "id_cliente", etiqueta: "Id cliente", tipo: "numero", ayuda: "Opcional. Resuelve NIT repetidos." },
      { clave: "nombre", etiqueta: "Nombre", tipo: "texto", ayuda: "Obligatorio para crear un cliente nuevo." },
      { clave: "correo", etiqueta: "Correo", tipo: "texto" },
      { clave: "celular", etiqueta: "Celular", tipo: "texto" },
      { clave: "cupo_credito", etiqueta: "Cupo de crédito", tipo: "numero" },
      { clave: "dias_credito", etiqueta: "Días de crédito", tipo: "numero" },
      { clave: "vendedor", etiqueta: "Vendedor", tipo: "texto", ayuda: "Nombre exacto o id del vendedor." },
      { clave: "lista_precio", etiqueta: "Lista de precios", tipo: "texto", ayuda: "Nombre de la lista." },
      { clave: "segmento", etiqueta: "Segmento", tipo: "texto" },
      { clave: "bloqueado_cartera", etiqueta: "Bloqueado por cartera", tipo: "booleano" },
    ],
  },
  productos: {
    tipo: "productos",
    titulo: "Productos",
    descripcion: "Actualiza precio base, descripción comercial e impuesto. No crea productos: esos se crean en LIPgo.",
    permiso: "crm_productos",
    campos: [
      { clave: "codigo", etiqueta: "Código", tipo: "texto", obligatorio: true },
      { clave: "precio_base", etiqueta: "Precio base", tipo: "numero" },
      { clave: "descripcion_comercial", etiqueta: "Descripción comercial", tipo: "texto" },
      { clave: "impuesto", etiqueta: "Impuesto", tipo: "texto", ayuda: "Código: IVA_DEFAULT, IVA_19, EXENTO, EXCLUIDO." },
    ],
  },
  catalogo: {
    tipo: "catalogo",
    titulo: "Catálogo por cliente",
    descripcion: "Asigna a cada cliente los productos que se le pueden vender.",
    permiso: "crm_clientes",
    campos: [
      { clave: "documento", etiqueta: "NIT del cliente", tipo: "texto", obligatorio: true },
      { clave: "id_cliente", etiqueta: "Id cliente", tipo: "numero", ayuda: "Opcional. Resuelve NIT repetidos." },
      { clave: "codigo", etiqueta: "Código del producto", tipo: "texto", obligatorio: true },
      { clave: "quitar", etiqueta: "Quitar", tipo: "booleano", ayuda: "Sí para retirar el producto del catálogo." },
    ],
  },
  sucursales: {
    tipo: "sucursales",
    titulo: "Sucursales",
    descripcion: "Crea o actualiza las sucursales de entrega de cada cliente.",
    permiso: "crm_clientes",
    campos: [
      { clave: "documento", etiqueta: "NIT del cliente", tipo: "texto", obligatorio: true },
      { clave: "id_cliente", etiqueta: "Id cliente", tipo: "numero", ayuda: "Opcional. Resuelve NIT repetidos." },
      { clave: "nombre", etiqueta: "Nombre de la sucursal", tipo: "texto", obligatorio: true },
      { clave: "direccion", etiqueta: "Dirección", tipo: "texto" },
      { clave: "ciudad", etiqueta: "Ciudad", tipo: "texto" },
      { clave: "departamento", etiqueta: "Departamento", tipo: "texto" },
    ],
  },
  vendedores_usuarios: {
    tipo: "vendedores_usuarios",
    titulo: "Vendedores y usuarios",
    descripcion: "Vincula cada vendedor con su usuario de acceso. Sin este vínculo el vendedor ve la información de todos.",
    permiso: "crm_vendedores",
    campos: [
      { clave: "vendedor", etiqueta: "Vendedor", tipo: "texto", obligatorio: true, ayuda: "Nombre exacto o id." },
      { clave: "usuario", etiqueta: "Usuario o correo", tipo: "texto", obligatorio: true },
    ],
  },
  facturas: {
    tipo: "facturas",
    titulo: "Números de factura",
    descripcion: "Completa número y fechas de factura de cuentas que ya existen en el CRM. No crea deuda nueva.",
    permiso: "crm_recaudos_aprobar",
    campos: [
      { clave: "pedido", etiqueta: "Pedido", tipo: "texto", obligatorio: true, ayuda: "Número del CRM (CRM-…) o número del pedido en LIPgo." },
      { clave: "numero_factura", etiqueta: "Número de factura", tipo: "texto", obligatorio: true },
      { clave: "fecha_factura", etiqueta: "Fecha de factura", tipo: "fecha" },
      { clave: "fecha_vencimiento", etiqueta: "Fecha de vencimiento", tipo: "fecha" },
    ],
  },
  saldos_iniciales: {
    tipo: "saldos_iniciales",
    titulo: "Saldos iniciales de cartera",
    descripcion: "Lo que cada cliente ya debía antes de usar el CRM. Si el número de factura ya existe, la fila se omite.",
    permiso: "crm_recaudos_aprobar",
    campos: [
      { clave: "documento", etiqueta: "NIT del cliente", tipo: "texto", obligatorio: true },
      { clave: "id_cliente", etiqueta: "Id cliente", tipo: "numero", ayuda: "Opcional. Resuelve NIT repetidos." },
      { clave: "owner", etiqueta: "Owner", tipo: "texto", obligatorio: true, ayuda: "INDUPAN o MOLINOS." },
      { clave: "numero_factura", etiqueta: "Número de factura", tipo: "texto", obligatorio: true },
      { clave: "fecha_factura", etiqueta: "Fecha de factura", tipo: "fecha", obligatorio: true },
      { clave: "fecha_vencimiento", etiqueta: "Fecha de vencimiento", tipo: "fecha", obligatorio: true },
      { clave: "saldo", etiqueta: "Saldo pendiente", tipo: "numero", obligatorio: true },
      { clave: "vendedor", etiqueta: "Vendedor", tipo: "texto" },
    ],
  },
}

// ------------------------------------------------------------ normalizacion

/** "Días de Crédito " → "dias_de_credito". Asi un encabezado con tildes,
 *  mayusculas o espacios de sobra se reconoce igual. */
export function normalizarEncabezado(h: string): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/** Encabezado del archivo → clave del campo. Acepta la clave o la etiqueta. */
export function mapearEncabezados(encabezados: string[], def: DefinicionImportacion): Record<string, string> {
  const porNombre = new Map<string, string>()
  for (const c of def.campos) {
    porNombre.set(normalizarEncabezado(c.clave), c.clave)
    porNombre.set(normalizarEncabezado(c.etiqueta), c.clave)
  }
  const mapa: Record<string, string> = {}
  for (const h of encabezados) {
    const clave = porNombre.get(normalizarEncabezado(h))
    if (clave) mapa[h] = clave
  }
  return mapa
}

/**
 * Numero escrito como sea que venga de un Excel colombiano:
 *   1.234.567  → 1234567      (puntos de miles)
 *   1.234.567,5 → 1234567.5   (coma decimal)
 *   1234567.50 → 1234567.5    (punto decimal)
 *   $ 1.234.567 → 1234567
 * Devuelve null si no es un numero.
 */
export function leerNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  let t = String(v ?? "").trim().replace(/[$\s]/g, "")
  if (!t) return null
  const tienePunto = t.includes(".")
  const tieneComa = t.includes(",")
  if (tienePunto && tieneComa) {
    // El ultimo separador es el decimal.
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".")
    else t = t.replace(/,/g, "")
  } else if (tieneComa) {
    // Solo comas: decimal si hay 1-2 digitos detras de la ultima; si no, miles.
    t = /,\d{1,2}$/.test(t) ? t.replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "") : t.replace(/,/g, "")
  } else if (tienePunto) {
    // Solo puntos: miles si hay mas de uno o si detras del ultimo hay 3 digitos.
    const partes = t.split(".")
    if (partes.length > 2 || partes[partes.length - 1].length === 3) t = t.replace(/\./g, "")
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Fecha a ISO (AAAA-MM-DD). Acepta:
 *   2026-09-30, 30/09/2026, 30-09-2026, y el numero de serie de Excel (46295).
 * Las fechas se leen como DIA/MES/AÑO, que es como se escriben en Colombia.
 */
export function leerFecha(v: unknown): string | null {
  if (v == null || v === "") return null
  if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    // Serie de Excel: dias desde el 30/12/1899.
    const serie = Math.floor(Number(v))
    if (serie < 1 || serie > 80000) return null
    const d = new Date(Date.UTC(1899, 11, 30) + serie * 86_400_000)
    return d.toISOString().slice(0, 10)
  }
  const t = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  let a: number, mes: number, dia: number
  if (m) {
    a = +m[1]; mes = +m[2]; dia = +m[3]
  } else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t)
    if (!m) return null
    dia = +m[1]; mes = +m[2]; a = +m[3]
  }
  const f = new Date(Date.UTC(a, mes - 1, dia))
  // Rechaza 31/02 y similares, que Date convierte en silencio al mes siguiente.
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null
  return f.toISOString().slice(0, 10)
}

export function leerBooleano(v: unknown): boolean | null {
  if (typeof v === "boolean") return v
  const t = normalizarEncabezado(String(v ?? ""))
  if (!t) return null
  if (["si", "s", "true", "1", "x", "yes"].includes(t)) return true
  if (["no", "n", "false", "0"].includes(t)) return false
  return null
}

export interface FilaLeida {
  valores: Record<string, string | number | boolean | null>
  errores: string[]
}

/**
 * Lee una fila del archivo segun la definicion: convierte cada valor a su tipo
 * y reporta lo que falta o no se entiende. NO consulta la base: si el cliente
 * existe o no lo decide el servidor despues.
 */
export function leerFila(
  cruda: Record<string, unknown>,
  mapa: Record<string, string>,
  def: DefinicionImportacion,
): FilaLeida {
  const porClave: Record<string, unknown> = {}
  for (const [h, v] of Object.entries(cruda)) {
    const clave = mapa[h]
    if (clave) porClave[clave] = v
  }

  const valores: FilaLeida["valores"] = {}
  const errores: string[] = []

  for (const c of def.campos) {
    const bruto = porClave[c.clave]
    const vacio = bruto == null || String(bruto).trim() === ""
    if (vacio) {
      if (c.obligatorio) errores.push(`Falta ${c.etiqueta}`)
      continue
    }
    let v: string | number | boolean | null
    if (c.tipo === "numero") v = leerNumero(bruto)
    else if (c.tipo === "fecha") v = leerFecha(bruto)
    else if (c.tipo === "booleano") v = leerBooleano(bruto)
    else v = String(bruto).trim()

    if (v === null) errores.push(`${c.etiqueta}: "${String(bruto)}" no es un${c.tipo === "fecha" ? "a fecha válida" : c.tipo === "numero" ? " número válido" : " valor válido"}`)
    else valores[c.clave] = v
  }

  if (def.tipo === "saldos_iniciales" && typeof valores.saldo === "number" && valores.saldo <= 0) {
    errores.push("El saldo debe ser mayor que cero")
  }
  if (
    typeof valores.fecha_factura === "string" && typeof valores.fecha_vencimiento === "string" &&
    valores.fecha_vencimiento < valores.fecha_factura
  ) {
    errores.push("La fecha de vencimiento es anterior a la de factura")
  }
  return { valores, errores }
}

/**
 * Formas en que un NIT del archivo puede estar guardado en LIPgo.
 *
 * En la base el documento es un NUMERO SIN digito de verificacion (verificado
 * el 2026-09-26: 9 digitos en su mayoria). En un archivo suele venir como
 * "900.123.456-7" o "9001234567". Se prueba con todo el numero y, si trae el
 * digito de verificacion, tambien sin el. El servidor busca todos los
 * candidatos y, si mas de un cliente coincide, lo reporta como ambiguo en vez
 * de elegir uno.
 */
export function candidatosDocumento(d: string | number | null | undefined): string[] {
  const original = String(d ?? "").trim()
  const digitos = original.replace(/\D/g, "")
  if (!digitos) return []
  const c = new Set<string>([digitos.replace(/^0+/, "") || digitos])
  // Con guion: lo que va antes es el NIT sin digito de verificacion.
  const antesGuion = original.split("-")[0].replace(/\D/g, "")
  if (original.includes("-") && antesGuion) c.add(antesGuion.replace(/^0+/, ""))
  // 10 digitos que empiezan por 8 o 9: NIT de empresa con el DV pegado.
  if (!original.includes("-") && digitos.length === 10 && /^[89]/.test(digitos)) c.add(digitos.slice(0, 9))
  return [...c]
}
