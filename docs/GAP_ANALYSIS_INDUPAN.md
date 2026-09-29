# Análisis de brechas — Requerimiento INDUPAN (Pedidos, Cartera y Recaudos)

**Fecha:** 26 de septiembre de 2026 · **Base:** CRM LIPGO, commit `251844f` + fase 0
**Documento fuente:** `REQUERIMIENTO_CRM_INDUPAN.md` (notas de reunión con usuarios finales). Conviene guardarlo en esta misma carpeta `docs/` para que los IDs de abajo se puedan rastrear.

Cada requisito del documento se clasifica como:

- ✅ **Existe** — se cumple hoy.
- 🟡 **Parcial** — hay base, falta una parte.
- ❌ **No existe** — hay que construirlo.

La columna **Fase** dice cuándo se cierra, según el plan aprobado (0 a 6).

---

## 1. Hallazgos de la auditoría que cambian el plan

Estos se encontraron consultando la base real (solo lectura) y leyendo el código. Varios son anteriores al requerimiento.

| # | Hallazgo | Impacto | Estado |
|---|---|---|---|
| H1 | La función que proyecta el pedido a LIPgo escribía en `pedidoscabecera.bodega`, **una columna que no existe**. PL/pgSQL no valida columnas al crear la función, así que el script 187 corrió sin error; el primer pedido autorizado habría fallado al viajar a LIPgo. | **Bloqueaba el flujo principal.** No se había notado porque aún no se ha autorizado ningún pedido. | ✅ Corregido — script 190 |
| H2 | LIPgo guarda la sucursal en `medio` y filtra a los usuarios por owner con `empresafactura`. El CRM no llenaba ninguna de las dos. | Los pedidos del CRM no mostrarían la sucursal y serían invisibles para los usuarios de LIPgo filtrados por owner. | ✅ Corregido — script 190 |
| H3 | `productos` **ya tiene** una columna `owner` ("HARINERA INDUPAN", "MOLINOS DEL ATLANTICO"). Molinos existe como owner (`owners.id = 3`) y sus 51 productos están en las empresas 3 y 4 (Cedi Funza y Cedi Medellín). | El maestro de owners del CRM no necesita una columna nueva en productos: mapea el valor que ya existe. | Fase 1 |
| H4 | En LIPgo, `id_empresa` del pedido es el **centro de despacho** y `empresafactura` es el **owner**. Los pedidos de Molinos van con `id_empresa` 3 (225) o 4 (105). | Un pedido de Molinos debe proyectarse con `id_empresa` 3 y su producto validado contra el catálogo de esa empresa. | Fase 2 |
| H5 | `getParam` era una acción invocable desde el navegador **con cualquier clave**, incluidas las claves de autorización de pedidos. Cualquiera con sesión podía leerlas. | Grave: anulaba la doble firma. | ✅ Corregido — fase 0 |
| H6 | Con la clave de fábrica `CAMBIAR`, cualquiera que la conociera podía firmar (está escrita en el script 189). | La doble firma no protegía nada hasta cambiarla. | ✅ Corregido — ahora se rechaza firmar con la clave de fábrica |
| H7 | Casi ninguna acción del servidor validaba permisos, y varias recibían el nombre del usuario desde el navegador. | Cualquiera con sesión podía registrar pagos, cambiar cupos o precios, o actuar como otro usuario. | ✅ Corregido — fase 0, en modo registro |
| H8 | `/api/config-data` respondía sin sesión, leía **cualquier tabla** y confiaba en la empresa que mandaba el navegador. `/api/upload-pdf` no tenía autenticación. | Lectura de tarifas, proveedores y accesos de otros usuarios. | ✅ Corregido — fase 0 |
| H9 | El formulario de venta no envía sucursal ni vendedor: todas las cotizaciones y pedidos quedarían con `vendedor_id` y `bodega_id` nulos. | Un vendedor no vería sus propias cotizaciones al filtrar por vendedor. | 🟡 Vendedor corregido en fase 0 (se toma de la sesión); sucursal en fase 2 |
| H10 | **Ningún vendedor está vinculado a un usuario** (0 de 46) y **ningún cliente tiene vendedor asignado** (0 de 600). | El filtro "cada vendedor ve lo suyo" (RNF-02) no tiene efecto hasta que se hagan esas asignaciones. | Fase 1 (asignación) |
| H11 | La campana de alertas consultaba cinco rutas que nunca se crearon. | No mostraba nada. | ✅ Corregido — fase 0 |
| H12 | Ningún producto de Harinera Indupan tiene precio base (0 de 21). | No se puede cotizar. | Dato pendiente de INDUPAN |
| H13 | Todos los buckets de almacenamiento son públicos. | Los comprobantes de pago no pueden guardarse ahí (RNF-06). | Fase 3 (bucket privado) |
| H14 | `vercel.json` programaba dos cron hacia rutas que no existen. | Errores silenciosos en cada ejecución. | ✅ Corregido — ahora solo el cron de la bandeja de integraciones |

---

## 2. Integración (sección 2 del requerimiento)

| ID | Requisito | Estado | Qué cambia | Fase |
|---|---|---|---|---|
| INT-01 | Toda comunicación con SAP por una sola interfaz | ✅ | `SapGateway` en `lib/integraciones/tipos.ts`; ningún módulo llama a SAP | 0 |
| INT-02 | Implementaciones desactivada, simulada y real | ✅ | `lib/integraciones/sap/gateways.ts`. La real (Service Layer) está codificada e inactiva | 0 |
| INT-03 | Activación por configuración, con interruptor por flujo | ✅ | `SAP_MODE` en variable de entorno + 6 interruptores en Parametrización, todos apagados | 0 |
| INT-04 | Patrón outbox | ✅ | Tabla `crm_integracion_outbox` (script 192) y proceso por lotes con reintentos | 0 |
| INT-05 | Datos maestros locales cuando SAP está apagado, con importación | ❌ | Importación CSV/Excel con simulación previa | 1 |
| INT-06 | Campos `origen` y código SAP por entidad, nunca como PK | 🟡 | En la bandeja sí; en clientes, productos y facturas falta | 1, 3, 6 |
| INT-07 | La interfaz muestra el estado de integración sin bloquear el negocio | 🟡 | Panel de Integraciones listo; los badges en pedidos y recaudos llegan con esos módulos | 2, 3 |
| INT-08 | Log consultable y reintento manual | ✅ | Panel **Configuración → Integraciones**: intentos, request/response, reintentar, descartar | 0 |
| INT-09 | Idempotencia | ✅ | Llave única por envío; el adaptador real además consulta antes de crear | 0 |
| INT-10 | Adaptador de LIPgo | 🟡 | Los pedidos se proyectan directo (misma base). Los recaudos quedan en la bandeja: **LIPgo no tiene "consola de administrador" que los reciba** | 2, 3 |
| INT-11 | ¿Misma base o API? | ✅ | **Misma base**: escritura directa en una sola transacción | — |
| INT-12 | WhatsApp desacoplado | ✅ | `lib/integraciones/whatsapp.ts`, misma cuenta de Meta y plantilla ya aprobada que LIPgo. Apagado por defecto | 0 |
| INT-13 | OCR de comprobantes desacoplado | ❌ | Lector con IA y modo manual | 3 |

## 3. Cuenta del cliente

| ID | Requisito | Estado | Qué cambia | Fase |
|---|---|---|---|---|
| CTA-01 | Cupo, saldo, disponible, vencido, al día, días de mora, %, saldo a favor | 🟡 | Hay cupo y saldo; faltan días de mora por cliente, % al día y saldo a favor | 1 |
| CTA-02 | Límite de crédito local, editable por Cartera o Admin | ✅ | Ahora un vendedor no puede cambiar cupo, plazo ni bloqueo (validado en el servidor) | 0 |
| CTA-03 | Detalle de facturas y pagos desde la cuenta | 🟡 | Existen por separado; falta la vista unificada | 1 |
| CTA-04 | Distinguir vencida de no vencida | ✅ | La vista de aging ya lo hace | — |

## 4. Pedidos

| ID | Requisito | Estado | Qué cambia | Fase |
|---|---|---|---|---|
| PED-01 | Web responsive / móvil para el vendedor | 🟡 | Responsive sí; falta optimizar el flujo de pedido para una mano | 2 |
| PED-02 | Modo offline | ❌ | No en esta etapa, sin cerrarle la puerta (pregunta abierta) | — |
| PED-03 | Ver la cartera del cliente antes de vender | ❌ | Resumen de cartera al abrir el pedido | 2 |
| PED-04 | Sobrecupo calculado en vivo, se permite enviar | ❌ | Hoy el cupo **bloquea**; pasa a marcar el pedido con el valor exacto | 2 |
| PED-05 | Sucursal de entrega | 🟡 | Existe la columna, el formulario no la pide | 2 |
| PED-06 | Catálogo con imagen | 🟡 | Los productos tienen fotos; el formulario de venta no las muestra | 2 |
| PED-07 | Catálogo personalizado por cliente | ❌ | Tabla `crm_catalogo_cliente` | 1 |
| PED-08 | El vendedor solo ve los productos del cliente | ❌ | Filtro en el formulario y en el servidor | 2 |
| PED-09 | Inventario disponible con fecha de actualización | ❌ | Desde `invglobal` de LIPgo | 1 |
| PED-10 | Precio personalizado por línea | ✅ | Ya existe | — |
| PED-11 | Impuestos por producto (19 %, 5 %, exento…) | ❌ | Hoy un solo IVA global; pasa a tarifa por producto | 1 |
| PED-12 | Guardar lista, personalizado, diferencia e impuesto por línea | 🟡 | Faltan tarifa y valor de impuesto por línea | 1 |
| PED-13 | SAP recibe el precio personalizado, no el de lista | ✅ | El adaptador envía `UnitPrice` con el precio aprobado | 0 |
| PED-14 | Descuentos solo desde el panel administrador | ✅ | Listas y descuentos exigen permiso de administración en el servidor | 0 |
| PED-15 | Pedidos INDUPAN y Molinos según owner del producto | 🟡 | El owner existe en productos (H3); falta el maestro y el flujo | 1, 2 |
| PED-16 | INDUPAN → SAP → LIPgo; Molinos → LIPgo y fin | 🟡 | La regla "Molinos nunca a SAP" ya está implementada y probada | 0, 2 |
| PED-17 | ¿Pedidos mixtos? | ❌ | Por defecto no: el pedido toma el owner de la primera línea | 2 |
| PED-18 | Nace en borrador, "Solicitar aprobación" | ❌ | Hoy nace pendiente de autorización | 2 |
| PED-19 | Doble aprobación Cartera → Gerencia | 🟡 | Existe la doble firma, en cualquier orden; pasa a secuencial | 2 |
| PED-20 | Rechazo con motivo obligatorio | ✅ | Ya existe; el motivo pasará a un maestro | 2 |
| PED-21 | Editar y reenviar un rechazado | ❌ | Hoy el rechazo es definitivo | 2 |
| PED-22 | Estados del documento | 🟡 | Se migran los estados con compatibilidad | 2 |
| PED-23 | Al aprobar: LIPgo listo para orden de cargue + SAP en paralelo | 🟡 | LIPgo sí, ya queda listo para cargue; SAP por la bandeja | 2 |
| PED-24 | Historial ("ojito") | 🟡 | Bitácora única `crm_eventos` ya creada; falta la vista | 2 |
| PED-25 | WhatsApp a Jefferson al aprobar | 🟡 | Canal listo; falta el disparo y el maestro de destinatarios | 1, 2 |
| PED-26 | Notificaciones internas | 🟡 | La campana ya funciona (H11); faltan las de aprobado/rechazado | 2 |
| PED-27 | Filtros por fecha, sucursal, mes, año, rango | ❌ | Hoy solo búsqueda y estado, con tope de 300 | 2 |
| PED-28 | Listado con detalle e historial | 🟡 | Falta el detalle | 2 |
| PED-29 | El vendedor ve solo sus pedidos | ✅ | Aplicado en el servidor; efectivo cuando se vinculen vendedores (H10) | 0 |

## 5. Cartera y recaudos

| ID | Requisito | Estado | Qué cambia | Fase |
|---|---|---|---|---|
| CAR-01 | Vendedor en solo lectura | 🟡 | Ya no puede editar facturas (servidor); falta la vista de solo lectura | 0, 3 |
| CAR-02 | Valor real de la cartera y sus facturas | ✅ | Existe | — |
| CAR-03 | Columnas y rango de vencimiento | 🟡 | Faltan fecha documento, días pendientes y saldo vencido por fila | 3 |
| CAR-04 | Detalle de pagos con descuento y saldo final | ❌ | | 3 |
| CAR-05 | Trazabilidad cliente → factura → pago → recibo → comprobante | ❌ | | 3 |
| CAR-06 | Facturas por importación o creación local | ❌ | La cuenta por cobrar se sigue creando desde el pedido (decisión del usuario); la importación completa número y fecha | 1 |
| REC-01..07 | Recaudo con comprobante, aprobación, estados, historial | ❌ | Hoy el pago se aplica al instante, sin aprobación ni comprobante | 3 |
| REC-08..13 | Medio, fecha documento, banco, cuenta destino, valor, soporte | 🟡 | Hay medio y fecha; faltan maestros de bancos y cuentas, y el soporte | 1, 3 |
| REC-14..17 | Un pago a varias facturas, la más vencida primero, saldo a favor | ❌ | Hoy un pago = una factura | 3 |
| REC-18 | Cartera ajusta la distribución antes de aprobar | ❌ | | 3 |
| REC-19 | Descuentos sobre pagos solo desde administración | ❌ | | 3 |
| REC-20..23 | Lectura con IA, rechazo de fotos ilegibles, evidencia | ❌ | | 3 |
| REC-24 | Documento de pago y recibo de caja en PDF | ❌ | | 3 |

## 6. Dashboard, estado de cuenta, prospectos, administración

| ID | Requisito | Estado | Qué cambia | Fase |
|---|---|---|---|---|
| DSH-01 | Dashboard de cartera por cliente | ❌ | | 4 |
| DSH-02 | Consolidado por vendedor, rango y owner | 🟡 | Hay aging general | 4 |
| EDC-01..02 | Estado de cuenta en PDF con formato INDUPAN | ❌ | Plantilla parametrizable hasta tener la oficial | 4 |
| EDC-03 | Recibos de caja y facturas aplicadas | ❌ | | 3 |
| PRO-01..03 | Documentos del prospecto, aprobación de Cartera, carpeta | ❌ | | 5 |
| PRO-04 | Al aprobar: cliente en LIPgo (+ SAP opcional) | ❌ | Hoy no existe la conversión de prospecto a cliente | 5 |
| PRO-05 | ¿Quién registra al prospecto? | ❌ | Por defecto el vendedor, con enlace para que el prospecto suba documentos | 5 |
| ADM-01 | Maestros e importación | 🟡 | Hay productos, vendedores y listas; faltan los demás | 1 |
| ADM-02 | Descuentos solo desde administración | ✅ | | 0 |
| ADM-03 | Configuración de integraciones y monitor | ✅ | Panel de Integraciones + Parametrización | 0 |
| ADM-04 | Auditoría de quién hizo qué | 🟡 | Bitácora `crm_eventos` + auditoría existente; falta cubrir maestros | 1 |
| POR-01..06 | Portal de cliente | ❌ | Solo evaluación, sin implementar | 6 |

## 7. Requisitos no funcionales

| ID | Requisito | Estado | Qué cambia | Fase |
|---|---|---|---|---|
| RNF-01 | Mobile-first para el vendedor | 🟡 | | 2, 3 |
| RNF-02 | Seguridad por rol en el servidor; el vendedor solo accede a sus clientes | 🟡 | Validación en todas las acciones (fase 0) en **modo registro**; se pasa a bloqueo en fase 1, tras vincular vendedores | 0, 1 |
| RNF-03 | Pesos sin decimales en pantalla | ✅ | | — |
| RNF-04 | Zona horaria de Bogotá | ✅ | Se corrigió además un cálculo en UTC al cambiar parámetros | 0 |
| RNF-05 | Cálculos de saldo en el servidor | ✅ | El saldo es una columna calculada por la base | — |
| RNF-06 | Evidencias en almacenamiento privado con URL firmada | ❌ | Todos los buckets son públicos (H13) | 3 |
| RNF-07 | Pruebas automatizadas | 🟡 | Vitest instalado; 17 pruebas de integración (incluye "Molinos nunca a SAP" y "SAP apagado no envía") | 0 → 3 |
| RNF-08 | Datos de demostración | ❌ | | 1 |

---

## 8. Qué quedó hecho en la fase 0

- **Scripts** (por correr en Supabase, en orden): `190_crm_fix_proyeccion_medio.sql`, `191_crm_seguridad_eventos.sql`, `192_crm_integracion.sql`.
- **Seguridad:** `lib/crm-auth.ts`; todas las acciones del CRM validan sesión y permiso en el servidor y toman el usuario de la sesión. Modo `log` (registra y deja pasar) mientras se revisa; la bitácora muestra cada caso como `acceso_denegado_registrado`.
- **8 permisos nuevos**, otorgables desde Gestión de Usuarios.
- **Parámetros secretos:** las claves de autorización ya no salen del servidor, y no se puede firmar con la clave de fábrica.
- **Integraciones:** gateways de SAP (apagado, simulado, real), WhatsApp, bandeja con reintentos, cron cada 5 minutos, panel **Configuración → Integraciones**.
- **Alertas:** las cinco de la campana funcionan, filtradas por vendedor.
- **Pruebas:** `pnpm test`.

## 9. Lo que necesita INDUPAN para avanzar

1. **Correr los scripts 190, 191 y 192** en Supabase.
2. **Cambiar las dos claves de autorización** (Parametrización). Mientras sigan en `CAMBIAR`, el sistema no deja firmar.
3. **Cargar precios base** de los productos (0 de 21 los tienen).
4. **Vincular cada vendedor con su usuario** y **asignar clientes a vendedores** (hoy 0 y 0). Sin esto, el filtro por vendedor no tiene sobre qué actuar.
5. **Configurar `CRON_SECRET`** en Vercel para que corra la bandeja de integraciones.
6. Para WhatsApp: las mismas variables de LIPgo (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) y `WHATSAPP_ENABLED=true` cuando se quiera enviar de verdad. El celular de Jefferson.
7. Las preguntas abiertas de la sección 15 del requerimiento, en especial la plantilla del estado de cuenta y el método de conexión a SAP.

## 10. Estado al cierre de la fase 6 (2026-09-29)

Las secciones anteriores describen la brecha encontrada al inicio. Esto es lo que quedó construido.

| Fase | Scripts | Qué quedó | Probado |
|---|---|---|---|
| 0 | 190–192 | Seguridad en el servidor, bitácora, bandeja de integraciones, alertas | Pruebas unitarias |
| 1 | 193–198 | Owners, impuestos, maestros de cartera, catálogo por cliente, importación con simulación, Cuenta 360 | Pruebas unitarias |
| 2 | 199–200 | Pedido completo: borrador, sobrecupo, doble aprobación Cartera → Gerencia, rechazo y reenvío, historial, proyección a LIPgo con CxC en la misma transacción | Punta a punta contra la base (36/36) |
| 3 | 201–204 | Recaudos con comprobante, IA de comprobantes, aplicación a la factura más vencida, saldo a favor, bandeja de Cartera, documento de pago y recibo de caja, cartera del vendedor en solo lectura | Funciones de la base (10/10); pantallas pendientes de la prueba del usuario |
| 3b | 204 | **Cierre del acceso anónimo** a tablas, vistas y funciones `crm_*` | Verificado con la clave anónima |
| 4 | 205 | Tablero de cartera consolidado, tablero por cliente, estado de cuenta en PDF por owner, compartir por WhatsApp con enlace temporal | PDF generado y revisado |
| 5 | 206 | Expediente del prospecto, enlace público de carga, aprobación que crea cliente y sucursal en LIPgo, NIT repetido → vincular, carpeta de documentos del cliente | Enlace y NIT repetido (17/17); la conversión real en LIPgo, pendiente de autorización |
| 6 | 207 | Traductor CRM → SAP B1 (pedidos, pagos, clientes), mapeos de códigos, prueba de conexión, cierre de estados viejos de pedido, evaluación del portal (`docs/EVALUACION_PORTAL_CLIENTE.md`) | Traductor con pruebas unitarias; sin SAP real para probar |

**Criterios de aceptación (sección 13):**

| # | Criterio | Estado |
|---|---|---|
| 1 | Flujo completo con SAP apagado | Construido; falta la corrida de punta a punta del usuario en pantalla |
| 2 | Con `mock`, los eventos pasan a enviados | Sí; además el simulado muestra el documento SAP que se habría mandado y lo que falta mapear |
| 3 | Pasar a `live` es solo configuración | Sí: variables `SAP_*`, interruptor por flujo y códigos en Mapeos SAP. Lo que falte mapear queda en espera sin gastar intentos |
| 4 | Molinos nunca va a SAP | Sí, con prueba automática |
| 5 | $15M sobre dos facturas de $10M → 10/5 | Sí, con prueba automática y prueba contra la base |
| 6 | Sobrecupo visible y enviable | Sí |
| 7 | El vendedor no edita facturas ni aplica descuentos (API) | Sí en el servidor; se vuelve obligatorio al pasar `seguridad.modo` a `enforce` |
| 8 | Foto ilegible rechazada con motivo | Sí |
| 9 | Historial del pedido rechazado y reenviado | Sí |

**Pendiente:**

- **RNF-08, datos de demostración:** `scripts/seed/demo_crm.sql` y su limpieza `scripts/seed/demo_crm_limpiar.sql`, con candado (`set crm.demo = 'si';`). Como la base es la de LIPgo, los clientes DEMO se ven en LIPgo: correrlo idealmente en una rama de la base, o en producción solo para una demo puntual y limpiar después.
- **`seguridad.modo` sigue en `log`:** pasarlo a `enforce` cuando los vendedores estén vinculados a sus usuarios y los clientes asignados.
- **Tablas de LIPgo legibles sin sesión** (`permisos_usuarios`, `profiles`, `whatsapp_mensajes`): decisión de INDUPAN, probando en LIPgo.
- **Para encender SAP:** `SAP_SL_URL`, `SAP_COMPANY_DB`, `SAP_USER`, `SAP_PASSWORD` en Vercel, crear en SAP el campo de usuario `U_CRM_REF` (evita duplicados), cargar los códigos en Mapeos SAP, códigos SAP de impuestos y cuentas destino en Maestros, probar la conexión, pasar a `mock`, revisar, y luego `live` flujo por flujo.
