// Definicion de los maestros administrables (ADM-01).
//
// Sin "use server": la usan la pantalla (para dibujar la tabla y el
// formulario) y el servidor (para saber que columnas se pueden escribir). Una
// sola definicion por maestro: si una columna no esta aqui, el servidor no la
// escribe aunque el navegador la mande.

export type TipoCampoMaestro =
  | "texto" | "texto_largo" | "numero" | "booleano" | "select" | "lista_texto" | "lista_numero" | "color" | "imagen"

export interface CampoMaestro {
  clave: string
  etiqueta: string
  tipo: TipoCampoMaestro
  obligatorio?: boolean
  ayuda?: string
  /** Para `select`: opciones fijas, o el maestro del que salen. */
  opciones?: { valor: string; etiqueta: string }[]
  referencia?: MaestroId
  /** Se muestra en la tabla (ademas de en el formulario). */
  enTabla?: boolean
  /** Solo se escribe al crear; despues no se edita (p. ej. el codigo). */
  soloAlCrear?: boolean
}

export type MaestroId =
  | "owners" | "impuestos" | "bancos" | "cuentas_destino" | "medios_pago" | "motivos" | "destinatarios"
  | "tipos_documento"

export interface DefinicionMaestro {
  id: MaestroId
  tabla: string
  titulo: string
  singular: string
  descripcion: string
  /** Columna que se muestra al referenciar este maestro desde otro. */
  columnaNombre: string
  orden: string
  campos: CampoMaestro[]
}

export const MAESTROS: Record<MaestroId, DefinicionMaestro> = {
  owners: {
    id: "owners",
    tabla: "crm_owners",
    titulo: "Owners",
    singular: "owner",
    descripcion:
      "Dueño comercial del producto. Decide el flujo del pedido: a qué centro de LIPgo va, con qué empresa se factura y si pasa por SAP.",
    columnaNombre: "nombre",
    orden: "id",
    campos: [
      { clave: "codigo", etiqueta: "Código", tipo: "texto", obligatorio: true, enTabla: true, soloAlCrear: true },
      { clave: "nombre", etiqueta: "Nombre", tipo: "texto", obligatorio: true, enTabla: true },
      { clave: "nombre_empresafactura", etiqueta: "Empresa que factura (LIPgo)", tipo: "texto", obligatorio: true, enTabla: true,
        ayuda: "Se escribe tal cual en el pedido de LIPgo. LIPgo filtra por él a los usuarios con owners asignados." },
      { clave: "idempresa_lipgo", etiqueta: "Centro de despacho en LIPgo (id empresa)", tipo: "numero", obligatorio: true, enTabla: true,
        ayuda: "1 = Harinera Indupan, 3 = Cedi Funza, 4 = Cedi Medellín." },
      { clave: "alias_producto", etiqueta: "Textos del owner en productos", tipo: "lista_texto",
        ayuda: "Valores de la columna owner de productos que pertenecen a este owner, separados por coma." },
      { clave: "idempresas_origen", etiqueta: "Empresas de sus productos", tipo: "lista_numero",
        ayuda: "Para productos que no traen owner escrito. Separadas por coma." },
      { clave: "envia_sap", etiqueta: "Factura por SAP", tipo: "booleano", enTabla: true,
        ayuda: "Solo los owners con esto activo envían pedidos y recaudos a SAP. Molinos va apagado." },
      { clave: "color", etiqueta: "Color", tipo: "color",
        ayuda: "También es el color del estado de cuenta y del recibo de caja." },
      // Membrete del estado de cuenta y del recibo de caja (script 205, EDC-02).
      { clave: "nit", etiqueta: "NIT (membrete)", tipo: "texto" },
      { clave: "logo_url", etiqueta: "Logo (membrete)", tipo: "imagen",
        ayuda: "PNG o JPG. Se usa en el estado de cuenta." },
      { clave: "direccion", etiqueta: "Dirección (membrete)", tipo: "texto" },
      { clave: "telefono", etiqueta: "Teléfono (membrete)", tipo: "texto" },
      { clave: "correo", etiqueta: "Correo (membrete)", tipo: "texto" },
      { clave: "pie_documento", etiqueta: "Texto legal del pie", tipo: "texto_largo",
        ayuda: "Aparece al pie del estado de cuenta. Hasta tres líneas." },
      { clave: "activo", etiqueta: "Activo", tipo: "booleano", enTabla: true },
    ],
  },
  impuestos: {
    id: "impuestos",
    tabla: "crm_impuestos",
    titulo: "Impuestos",
    singular: "impuesto",
    descripcion: "Tarifas que se asignan a cada producto. La marcada por defecto aplica a los productos sin impuesto asignado.",
    columnaNombre: "nombre",
    orden: "id",
    campos: [
      { clave: "codigo", etiqueta: "Código", tipo: "texto", obligatorio: true, enTabla: true, soloAlCrear: true },
      { clave: "nombre", etiqueta: "Nombre", tipo: "texto", obligatorio: true, enTabla: true },
      { clave: "tipo", etiqueta: "Tipo", tipo: "select", obligatorio: true, enTabla: true,
        opciones: [
          { valor: "iva", etiqueta: "IVA" },
          { valor: "exento", etiqueta: "Exento" },
          { valor: "excluido", etiqueta: "Excluido" },
        ],
        ayuda: "Exento y excluido dan 0 %, pero no son lo mismo para la DIAN ni para SAP." },
      { clave: "tarifa", etiqueta: "Tarifa %", tipo: "numero", obligatorio: true, enTabla: true },
      { clave: "sap_codigo", etiqueta: "Código en SAP", tipo: "texto" },
      { clave: "es_default", etiqueta: "Por defecto", tipo: "booleano", enTabla: true },
      { clave: "activo", etiqueta: "Activo", tipo: "booleano", enTabla: true },
    ],
  },
  bancos: {
    id: "bancos",
    tabla: "crm_bancos",
    titulo: "Bancos",
    singular: "banco",
    descripcion: "Bancos que el vendedor elige al reportar un recaudo.",
    columnaNombre: "nombre",
    orden: "nombre",
    campos: [
      { clave: "codigo", etiqueta: "Código", tipo: "texto", obligatorio: true, enTabla: true, soloAlCrear: true },
      { clave: "nombre", etiqueta: "Nombre", tipo: "texto", obligatorio: true, enTabla: true },
      { clave: "sap_codigo", etiqueta: "Código en SAP", tipo: "texto" },
      { clave: "activo", etiqueta: "Activo", tipo: "booleano", enTabla: true },
    ],
  },
  cuentas_destino: {
    id: "cuentas_destino",
    tabla: "crm_cuentas_destino",
    titulo: "Cuentas destino",
    singular: "cuenta",
    descripcion: "Cuentas de la empresa donde entra el dinero. El vendedor las elige por su alias; el número es opcional.",
    columnaNombre: "alias",
    orden: "alias",
    campos: [
      { clave: "alias", etiqueta: "Alias", tipo: "texto", obligatorio: true, enTabla: true,
        ayuda: "Como la reconoce el vendedor, p. ej. «Bancolombia recaudo INDUPAN»." },
      { clave: "banco_id", etiqueta: "Banco", tipo: "select", referencia: "bancos", obligatorio: true, enTabla: true },
      { clave: "owner_id", etiqueta: "Owner", tipo: "select", referencia: "owners", enTabla: true },
      { clave: "tipo", etiqueta: "Tipo", tipo: "select",
        opciones: [
          { valor: "ahorros", etiqueta: "Ahorros" },
          { valor: "corriente", etiqueta: "Corriente" },
          { valor: "recaudo", etiqueta: "Recaudo" },
          { valor: "otra", etiqueta: "Otra" },
        ] },
      { clave: "numero", etiqueta: "Número (opcional)", tipo: "texto" },
      { clave: "sap_cuenta", etiqueta: "Cuenta en SAP", tipo: "texto" },
      { clave: "activo", etiqueta: "Activo", tipo: "booleano", enTabla: true },
    ],
  },
  medios_pago: {
    id: "medios_pago",
    tabla: "crm_medios_pago",
    titulo: "Medios de pago",
    singular: "medio de pago",
    descripcion: "Cómo paga el cliente. Cada medio dice si exige banco y comprobante.",
    columnaNombre: "nombre",
    orden: "orden",
    campos: [
      { clave: "codigo", etiqueta: "Código", tipo: "texto", obligatorio: true, enTabla: true, soloAlCrear: true },
      { clave: "nombre", etiqueta: "Nombre", tipo: "texto", obligatorio: true, enTabla: true },
      { clave: "requiere_banco", etiqueta: "Exige banco", tipo: "booleano", enTabla: true },
      { clave: "requiere_comprobante", etiqueta: "Exige comprobante", tipo: "booleano", enTabla: true },
      { clave: "sap_codigo", etiqueta: "Código en SAP", tipo: "texto" },
      { clave: "orden", etiqueta: "Orden", tipo: "numero" },
      { clave: "activo", etiqueta: "Activo", tipo: "booleano", enTabla: true },
    ],
  },
  motivos: {
    id: "motivos",
    tabla: "crm_motivos",
    titulo: "Motivos",
    singular: "motivo",
    descripcion: "Motivos de rechazo de pedidos, recaudos y prospectos. Con un maestro, los informes agrupan por motivo.",
    columnaNombre: "nombre",
    orden: "orden",
    campos: [
      { clave: "tipo", etiqueta: "Para", tipo: "select", obligatorio: true, enTabla: true, soloAlCrear: true,
        opciones: [
          { valor: "rechazo_pedido", etiqueta: "Rechazo de pedido" },
          { valor: "rechazo_recaudo", etiqueta: "Rechazo de recaudo" },
          { valor: "rechazo_prospecto", etiqueta: "Rechazo de prospecto" },
          { valor: "anulacion", etiqueta: "Anulación" },
        ] },
      { clave: "codigo", etiqueta: "Código", tipo: "texto", obligatorio: true, soloAlCrear: true },
      { clave: "nombre", etiqueta: "Motivo", tipo: "texto", obligatorio: true, enTabla: true },
      { clave: "exige_nota", etiqueta: "Exige explicación", tipo: "booleano", enTabla: true },
      { clave: "orden", etiqueta: "Orden", tipo: "numero" },
      { clave: "activo", etiqueta: "Activo", tipo: "booleano", enTabla: true },
    ],
  },
  destinatarios: {
    id: "destinatarios",
    tabla: "crm_notificacion_destinatarios",
    titulo: "Avisos por WhatsApp",
    singular: "destinatario",
    descripcion: "Quién recibe cada aviso. Por ejemplo, el responsable de programación cuando se aprueba un pedido.",
    columnaNombre: "nombre",
    orden: "evento",
    campos: [
      { clave: "evento", etiqueta: "Aviso", tipo: "select", obligatorio: true, enTabla: true,
        opciones: [
          { valor: "pedido_aprobado", etiqueta: "Pedido aprobado" },
          { valor: "pedido_rechazado", etiqueta: "Pedido rechazado" },
          { valor: "recaudo_registrado", etiqueta: "Recaudo registrado" },
          { valor: "prospecto_pendiente", etiqueta: "Prospecto por aprobar" },
        ] },
      { clave: "nombre", etiqueta: "Nombre", tipo: "texto", obligatorio: true, enTabla: true },
      { clave: "celular", etiqueta: "Celular", tipo: "texto", obligatorio: true, enTabla: true,
        ayuda: "Móvil colombiano, con o sin +57." },
      { clave: "owner_id", etiqueta: "Solo del owner", tipo: "select", referencia: "owners", enTabla: true,
        ayuda: "Vacío = recibe los avisos de todos los owners." },
      { clave: "activo", etiqueta: "Activo", tipo: "booleano", enTabla: true },
    ],
  },
  tipos_documento: {
    id: "tipos_documento",
    tabla: "crm_tipos_documento",
    titulo: "Tipos de documento",
    singular: "tipo de documento",
    descripcion:
      "Qué documentos se piden a un prospecto antes de volverlo cliente (PRO-01), y cuáles son obligatorios para enviarlo a Cartera.",
    columnaNombre: "nombre",
    orden: "orden",
    campos: [
      { clave: "entidad", etiqueta: "Para", tipo: "select", obligatorio: true, enTabla: true, soloAlCrear: true,
        opciones: [
          { valor: "prospecto", etiqueta: "Prospecto" },
          { valor: "cliente", etiqueta: "Cliente" },
          { valor: "recaudo", etiqueta: "Recaudo" },
        ] },
      { clave: "codigo", etiqueta: "Código", tipo: "texto", obligatorio: true, soloAlCrear: true },
      { clave: "nombre", etiqueta: "Documento", tipo: "texto", obligatorio: true, enTabla: true },
      { clave: "obligatorio", etiqueta: "Obligatorio", tipo: "booleano", enTabla: true,
        ayuda: "Sin él no se puede enviar el prospecto a Cartera (si el parámetro de exigir documentos está activo)." },
      { clave: "ayuda", etiqueta: "Indicación para quien lo sube", tipo: "texto" },
      { clave: "orden", etiqueta: "Orden", tipo: "numero" },
      { clave: "activo", etiqueta: "Activo", tipo: "booleano", enTabla: true },
    ],
  },
}

export const ORDEN_MAESTROS: MaestroId[] = [
  "owners", "impuestos", "bancos", "cuentas_destino", "medios_pago", "motivos", "destinatarios", "tipos_documento",
]
