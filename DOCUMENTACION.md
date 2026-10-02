# LIPGO CRM — Qué hace hoy el sistema

**Estado a 30 de septiembre de 2026** · rama `main` · scripts de base de datos 181 a 207 ejecutados (208 por correr) · 147 pruebas automáticas

Este documento describe **lo que está construido**, no lo que se planeó. Donde algo está a medias, sin probar o esperando un dato que solo ustedes pueden cargar, se dice explícitamente.

El detalle técnico de cada requisito del documento de INDUPAN (IDs PED, REC, CAR…) está en `docs/GAP_ANALYSIS_INDUPAN.md`.

---

## 1. Qué es

Un CRM comercial para vender el producto de las plantas de INDUPAN y de Molinos del Atlántico. Cubre el recorrido completo:

```
Prospecto ─→ Expediente con documentos ─→ Cartera lo aprueba ─→ Cliente en LIPgo
                                                                     │
Cotización ─→ Pedido ─→ Cartera ─→ Gerencia ─→ LIPgo lo despacha ←───┘
                                        │
                        Cuenta por cobrar (con su owner)
                                        │
        Vendedor reporta el pago con foto ─→ Cartera lo aprueba ─→ Saldos, recibo de caja, comisión
                                        │
                              SAP (cuando se encienda)
```

Nace de LIPgo, el ERP operativo que ya usa la empresa: se le quitó lo operativo (báscula, picking, nómina, producción) y se construyó encima la parte comercial.

### La relación con LIPgo

Las dos aplicaciones **comparten la misma base de datos**, a propósito:

- El CRM **lee** los maestros de LIPgo: clientes, productos, bodegas.
- Cuando un pedido queda aprobado, el CRM lo **escribe** en las tablas de pedidos de LIPgo con la sucursal, la empresa que factura y el centro de despacho correctos, y LIPgo lo despacha con su proceso de siempre.
- Cuando Cartera aprueba un prospecto, el CRM **crea el cliente y su sucursal en LIPgo**.
- Son **dos aplicaciones distintas en dos direcciones web**. A las tablas de LIPgo solo se les agregaron columnas: no se borró ni renombró nada.

### INDUPAN y Molinos del Atlántico

Cada producto tiene su **owner** (quien lo vende y lo factura). Un pedido no mezcla owners; la cartera, los recaudos y el estado de cuenta se separan por owner, porque son dos empresas con NIT distinto. Molinos **nunca** va a SAP.

---

## 2. Los 33 módulos

### Inicio
| Módulo | Qué hace |
|---|---|
| **Dashboard Comercial** | Ventas del mes, pronóstico del embudo, tasa de cierre y cartera vencida. |
| **Mi Agenda** | Los compromisos del vendedor: qué visita hoy, qué tiene atrasado. |

### Prospectos
| Módulo | Qué hace |
|---|---|
| **Registrar Prospecto** | Alta con **mapa de ubicación** (GPS, pin arrastrable o búsqueda por dirección) y productos de interés. Al pulsar un prospecto se abre su **expediente**: documentos, datos que faltan, enlace para que el prospecto suba sus documentos, y envío a Cartera. |
| **Aprobar Prospectos** | Bandeja de Cartera. Revisa documentos, fija cupo, plazo, lista y vendedor, y al aprobar **crea el cliente en LIPgo**. Avisa si el NIT ya existe. |
| **Embudo de Ventas** | Kanban de 7 etapas. Se arrastra la tarjeta para cambiar de etapa. |
| **Actividades** | Bitácora de llamadas, visitas y correos, con GPS. |
| **Calendario de Visitas** | Vista de mes con los compromisos programados. |

### Ventas
| Módulo | Qué hace |
|---|---|
| **Cotizaciones** | Emisión con vigencia parametrizable, PDF, versiones y conversión a pedido. |
| **Nueva Venta** | Pedido directo. Muestra primero la cartera del cliente, exige sucursal, filtra el catálogo por cliente y owner con su stock, calcula el impuesto por producto y **muestra el sobrecupo con su valor exacto sin bloquear**. Se guarda como borrador o se envía a aprobación. |
| **Pedidos CRM** | Listado con filtros (fecha, sucursal, estado, cliente, vendedor, owner, sobrecupo) y el historial completo de cada pedido. |
| **Autorizar Pedidos** | Bandeja de aprobación: primero Cartera, luego Gerencia. Ver sección 3. |

### Clientes
| Módulo | Qué hace |
|---|---|
| **Gestión de Clientes** | Datos comerciales, cupo, plazo, lista de precios, bloqueo por cartera y **ubicación en el mapa**. Vista **Lista** o **Mapa** con todos los clientes y sucursales ubicados, filtro por vendedor, búsqueda y "Cómo llegar" (abre Google Maps con la ruta). Desde aquí se abre la **Cuenta 360** (sección 3) y el catálogo propio del cliente. |
| **Sucursales** | Puntos de entrega. Cada una se **ubica en el mapa** (GPS, pin o dirección) y se ve en el mapa de clientes. |
| **Listas de Precios** | Precio fijo por producto **o** porcentaje de descuento. |

### Cartera
| Módulo | Qué hace |
|---|---|
| **Aprobaciones** | **Torre de control** de Cartera y Gerencia: en una sola lista, del más antiguo al más reciente, los pedidos esperando su firma, los recaudos por aprobar y los clientes nuevos (prospectos) con sus documentos por revisar. Lo que lleva más de 24 h (parametrizable) se marca en rojo. Cada pendiente se abre con el mismo diálogo de su módulo. Se actualiza sola cada minuto. |
| **Tablero de Cartera** | Cartera total, por vencer, vencida por rango, mora, recaudo por mes y saldo a favor. Filtros por vendedor, empresa y rango; cortes por cliente, vendedor y empresa. |
| **Cuentas por Cobrar** | Facturas abiertas con fecha de contabilización, vencimiento, días, abonado, saldo vencido y rango. Al pulsar una factura se ven sus abonos y de qué recaudo salió cada uno. El vendedor la ve **solo en lectura**. |
| **Registrar Pago** | El vendedor reporta un pago desde el celular: foto del comprobante, datos prellenados por IA, reparto propuesto entre facturas. Ver sección 3. |
| **Aprobar Recaudos** | Bandeja de Cartera: comprobante, alertas de la IA, reparto ajustable, aprobar, rechazar o anular. |
| **Antigüedad de Cartera** | Aging por tramos y a quién cobrar primero. |
| **Comisiones** | Liquidación por vendedor y período. |

### Inteligencia
| Módulo | Qué hace |
|---|---|
| **Rutas Óptimas** | Orden de visita más corto a partir del GPS de los clientes. |
| **Oportunidades de Negocio** | Quién bajó volumen, quién dejó de comprar, qué venderle a quién. |
| **Asistente IA** | Consulta en lenguaje natural sobre los datos del CRM. |
| **Reportes** | Informes comerciales. |

### Configuración
| Módulo | Qué hace |
|---|---|
| **Productos** | Lo comercial: fotos, descripción, precio base, owner e impuesto. |
| **Vendedores** | Zona, meta, comisión, desempeño, y el usuario con el que entra al CRM. |
| **Parametrización** | Las 49 reglas del negocio (sección 4). |
| **Maestros** | Owners (con el membrete del estado de cuenta), impuestos, bancos, cuentas destino, medios de pago, motivos de rechazo, destinatarios de WhatsApp y tipos de documento. |
| **Importar datos** | Carga desde Excel/CSV de clientes, sucursales, productos, catálogos, vínculo vendedor–usuario, números de factura, saldos iniciales y **notas crédito**. Todo pasa primero por una simulación que muestra qué se crea, qué cambia y qué tiene error. |
| **Integraciones** | La bandeja de lo que sale hacia SAP, WhatsApp y LIPgo, y los **mapeos y la prueba de conexión con SAP** (sección 5). |
| **Gestión de Usuarios** | Alta de usuarios, contraseñas y permisos por módulo. |
| **Bitácora de Auditoría** | Registro de quién hizo qué. |

---

## 3. Los cuatro flujos principales

### Pedido

`Borrador → Cartera → Gerencia → Aprobado → Programado en LIPgo`

- El orden Cartera → Gerencia es **secuencial** (parametrizable a paralelo).
- Cada aprobación pide la **clave del área** y además el **permiso del rol**; quien aprueba queda identificado por su sesión.
- **La misma persona no aprueba dos veces, y nadie aprueba lo que creó.**
- Un pedido **rechazado** (con motivo) vuelve al vendedor, que lo corrige y lo reenvía. El historial muestra cada paso con usuario, fecha y motivo.
- Al aprobarse: se escribe en LIPgo **y se crea la cuenta por cobrar en la misma transacción** (o todo o nada); si el owner factura por SAP queda en la bandeja hacia SAP; se avisa por WhatsApp a los destinatarios configurados.
- Doble clic no duplica: la base de datos impide que el mismo pedido entre dos veces.

### Recaudo (pago de un cliente)

1. El vendedor toma la **foto del comprobante**. La IA lee valor, fecha, banco y referencia y prellena el formulario. **Una foto ilegible se rechaza en el acto, con el motivo**, para tomarla de nuevo allí mismo. El mismo comprobante no se puede reportar dos veces.
2. El sistema **propone** el reparto: **la factura más vencida primero**; lo que sobra queda como **saldo a favor**. Los saldos todavía no cambian.
3. Si lo digitado no coincide con lo que leyó la IA (por ejemplo un cero de más), el recaudo llega a Cartera **marcado en ámbar**.
4. **Cartera aprueba** (puede ajustar el reparto; los descuentos solo quien tiene ese permiso) o **rechaza con motivo**; el vendedor corrige y reenvía. Quien registró no puede aprobar.
5. Al aprobar se mueven los saldos, se genera el **recibo de caja** en PDF y se causan las comisiones "por recaudo". Anular un recaudo aprobado **devuelve los saldos**.

Ejemplo verificado: un pago de $15.000.000 sobre dos facturas vencidas de $10.000.000 queda aplicado $10.000.000 a la más vencida y $5.000.000 a la otra.

### Prospecto a cliente

1. El vendedor arma el **expediente**: RUT, cámara de comercio, cédula del representante… (la lista y cuáles son obligatorios se configuran en Maestros).
2. Puede enviarle al prospecto un **enlace por WhatsApp** para que suba sus documentos desde el celular, sin usuario. El enlace caduca y deja de servir al enviar a Cartera.
3. Con el expediente completo, lo envía a Cartera con el cupo y plazo que propone.
4. **Cartera aprueba** fijando cupo, plazo, lista y vendedor, o rechaza con motivo. Al aprobar se crean **el cliente y su sucursal en LIPgo** y los documentos pasan a la carpeta del cliente. Si el NIT ya existe en LIPgo, no se crea otro: se vincula al existente.

### Cuenta 360 y estado de cuenta

Desde cualquier cliente se abre su **Cuenta 360**: cupo, saldo, disponible o sobrecupo, vencido, al día, días de mora, porcentajes, saldo a favor, la cartera separada por owner, gráficas de antigüedad y de recaudo de 12 meses, y pestañas de facturas, pagos, **recibos de caja** (reimprimibles) y **documentos**.

El **estado de cuenta** sale en PDF con el membrete del owner (logo, NIT, dirección, texto legal, editables en Maestros → Owners). Se descarga o se **envía por WhatsApp** con un enlace que caduca a los días configurados. Si el cliente debe a las dos empresas, se genera uno por empresa.

### Mapas y ubicación

- **Mapa dentro de la aplicación** al registrar un prospecto, editar un cliente o ubicar una sucursal: muestra dónde está el usuario (punto azul con su radio de precisión), permite **poner el pin con un clic o arrastrarlo**, y **buscar por dirección** cuando no se está en el sitio. Debajo se ve la dirección aproximada del pin y un enlace para abrirlo en Google Maps.
- **Un pin puesto a mano no es evidencia de presencia**: queda marcado como "fijada en el mapa", sin precisión de GPS. En las visitas (Actividades y Mi Agenda) el pin **no se puede mover**: ahí la ubicación es prueba de que se estuvo en el sitio.
- **Mapa de clientes y sucursales** (Gestión de Clientes → Mapa): pin azul cliente, verde sucursal, rojo cliente bloqueado. Cada pin abre su cuenta, una venta nueva o "Cómo llegar". Cuenta cuántos faltan por ubicar. Un vendedor ve solo los suyos.
- El mapa es **OpenStreetMap (Leaflet)**, el mismo del módulo de Rutas: no necesita clave ni tiene costo. Incrustar Google Maps exigiría una clave con facturación de Google; "Cómo llegar" y "Ver en Google Maps" abren Google Maps sin ella.

### Ficha del cliente, radar y buscador

- **Ficha del cliente.** Al elegir un cliente en Nueva Venta, en Cotizar o en Registrar Pago aparece su ficha: semáforo (al día, poco cupo, vencido, bloqueado), barra de cupo usado y disponible, saldo, vencido con días de mora, por vencer, saldo a favor, facturas abiertas, la cartera separada por empresa, y **señales** de lo que conviene hacer antes ("$2.000.000 vencidos: cobrar antes de vender", "2 facturas vencen esta semana", "tiene saldo a favor"). Es la misma ficha en la Cuenta 360.
- **Análisis con IA** (Cuenta 360 → "Analizar este cliente"): una lectura en tres frases, el riesgo y hasta tres acciones concretas, redactadas por la IA **solo con las cifras del CRM**. Se pide a propósito, no se carga sola.
- **Radar en Inicio.** Qué necesita atención hoy, lo rojo primero: pedidos programados en LIPgo que no han salido (con los días de atraso), pedidos con stock insuficiente en el centro de despacho, aprobados que no pasaron a LIPgo, lo que espera tu aprobación, cartera vencida y por vencer, cotizaciones que vencen, recaudos y pedidos rechazados por corregir, visitas atrasadas y envíos con error. Cada fila lleva al sitio exacto. Se refresca sola.
- **Estado logístico del pedido.** En el detalle del pedido se ve dónde va en LIPgo: programado, en orden de cargue (con número, vehículo y transporte) o entregado, sin abrir LIPgo.
- **Buscador Ctrl+K.** Desde cualquier pantalla: escribir tres letras y abrir un módulo, o un cliente y lo siguiente con él (su cuenta, venderle, cotizarle, cobrarle, sus pedidos, su cartera).

### Accesos directos entre módulos

Desde donde se esté, lo siguiente que se hace con un cliente o un prospecto está a un clic y **lleva los datos**: no hay que buscar al cliente otra vez.

| Desde | Lleva a |
|---|---|
| Cuenta 360 de un cliente | Nueva venta, cotizar, registrar pago, ver sus pedidos, ver su cartera, registrar actividad — con el cliente ya elegido |
| Gestión de Clientes (menú "Ir a…" de cada fila) | Lo mismo |
| Prospecto (expediente, embudo, agenda) | Cotizarle, registrar actividad; ya aprobado: su cuenta y la primera venta |
| Cotización | **Aceptada: convertir en pedido** en un paso, y abre el pedido creado; ver el pedido; cuenta del cliente |
| Pedido | Cuenta del cliente, registrar pago, otra venta al cliente, sus otros pedidos |
| Factura, recaudo, aprobación | Cuenta del cliente, registrar pago, el pedido de origen, sus facturas |
| Mi Agenda | Desde la cita: venderle, cobrarle, cotizarle, registrar la actividad |

La **Cuenta 360 se abre encima** del módulo donde se esté (un pedido, una aprobación) y al cerrarla se vuelve al mismo punto. Solo aparecen los accesos a módulos que el usuario puede abrir.

---

## 4. Nada está escrito en el código

Hay **49 parámetros** que se cambian desde Configuración → Parametrización, y los maestros de la sección 2. Algunos de los que más se usan:

| Grupo | Ejemplos |
|---|---|
| **Pedidos** | Orden de aprobación (secuencial o paralelo) · las 2 claves · si se proyecta a LIPgo al aprobar |
| **Crédito** | Sobrecupo: permitir y marcar, o bloquear |
| **Cartera** | Los 3 cortes de los rangos de vencimiento · nota y días del estado de cuenta · validez del enlace |
| **Documentos** | Si la IA lee los comprobantes · modelo de IA para comprobantes y para el análisis del cliente · validez de los enlaces a comprobantes |
| **Prospectos** | Si se exigen los documentos obligatorios · validez del enlace para el prospecto |
| **Integraciones** | Un interruptor por cada flujo hacia SAP · reintentos · prefijo del código de cliente en SAP |
| **Seguridad** | Modo de validación de permisos (ver sección 6) |

**Los parámetros tienen vigencia:** cambiar la comisión hoy no reescribe la liquidación del mes pasado.

---

## 5. Integraciones

Todo lo que sale hacia otro sistema pasa por una **bandeja de salida** (Configuración → Integraciones) con reintentos automáticos cada 5 minutos. Ningún proceso del negocio espera a que algo salga: si SAP o WhatsApp fallan, el pedido o el recaudo siguen su curso y el envío queda pendiente.

| Sistema | Estado |
|---|---|
| **LIPgo — pedidos y clientes** | Funcionando: escritura directa en la base compartida. |
| **LIPgo — recaudos** | En espera: LIPgo todavía no tiene dónde recibirlos. Quedan anotados en la bandeja. |
| **WhatsApp** | Con la misma cuenta y plantilla de LIPgo. Apagado (solo registra) hasta configurar las variables. |
| **SAP Business One** | **Construido y apagado.** |

**SAP necesita tres llaves para enviar algo:** la conexión encendida (`SAP_MODE`), el interruptor de ese flujo, y que el owner facture por SAP. Con SAP apagado, los envíos de INDUPAN se acumulan como pendientes y salen al encenderlo.

Para encenderlo, en **Integraciones → Mapeos y conexión SAP**:
- **Probar conexión** inicia sesión en SAP y lee un cliente, sin crear nada.
- **Qué falta para enviar** traduce lo que está en la bandeja con los códigos actuales y lista lo que falta mapear (por ejemplo "Producto #6 sin ItemCode").
- La tabla de **códigos SAP** de clientes, productos, facturas, centros, vendedores, sucursales y condiciones de pago, con un botón que llena los vacíos desde LIPgo.

En modo real, un envío al que le falta un código **espera sin gastar intentos**; al agregar el código sale solo.

---

## 6. Seguridad

- **Cada acción se valida en el servidor**, no solo ocultando botones: sesión, permiso, y que el usuario pueda ver ese cliente.
- **El vendedor ve solo lo suyo:** sus clientes, sus pedidos, su cartera y sus recaudos. Requiere que cada vendedor esté vinculado a su usuario y los clientes asignados (ver sección 8).
- **Modo de validación:** hoy está en **registro** (`log`): si alguien intenta algo sin permiso, queda en la bitácora pero se deja pasar, para no bloquear a nadie mientras se asignan permisos. Hay que pasarlo a **`enforce`** cuando todo esté asignado. Aprobar pedidos, recaudos y prospectos exige el permiso siempre, en cualquier modo.
- **La base de datos no se puede leer ni escribir desde fuera del CRM:** las tablas y funciones del CRM están cerradas a la clave pública.
- **Comprobantes y documentos** van a un almacenamiento privado y se abren con enlaces que caducan.
- **30 permisos** independientes, otorgables en Gestión de Usuarios.

---

## 7. Lo que hay debajo

- **38 tablas** con prefijo `crm_`. A las tablas compartidas con LIPgo solo se les agregaron columnas.
- **Scripts de base de datos** en `scripts/`, numerados **181 a 208**; el 208 (horas de alerta de la torre de aprobaciones) está por correr.
- Las operaciones que tienen que ocurrir enteras o no ocurrir son **funciones de la base de datos** con bloqueo de filas: pasar un pedido a LIPgo con su cuenta por cobrar, aprobar y anular un recaudo, convertir un prospecto en cliente.
- **147 pruebas automáticas** (`pnpm test`): reparto de pagos, sobrecupo, estados de pedidos, INDUPAN vs. Molinos, SAP apagado y simulado, traducción a SAP, expediente del prospecto, rangos de cartera.
- **Multiempresa:** todas las tablas llevan la empresa; los consecutivos y los parámetros son por empresa.
- **Datos de demostración:** `scripts/seed/demo_crm.sql` y su limpieza, con candado. Como la base es la de LIPgo, los clientes de demo se verían allá: correrlos en una copia de la base, o solo para una demo puntual.

---

## 8. Antes de empezar a usarlo

### Imprescindible 🔴

1. **Cambiar las dos claves de aprobación** (Parametrización → pedidos). Hoy tienen valores temporales de las pruebas.
2. **Cargar los precios base** de los productos (Configuración → Productos). A hoy **ningún producto tiene precio base**, y sin él no se puede cotizar ni vender.
3. **Vincular cada vendedor con su usuario y asignarle sus clientes** (Importar datos → Vendedores y usuarios; Gestión de Clientes). Sin esto, los vendedores ven todo y el filtro por vendedor no actúa.
4. **En Vercel**, las variables `ANTHROPIC_API_KEY` (lectura de comprobantes con IA) y `CRON_SECRET` (bandeja de salida).
5. **Anular en LIPgo el pedido de prueba #12008** (cliente "PRUEBA CRM - NO DESPACHAR").

### Para operar Cartera

6. **Cuentas destino** (Maestros): las cuentas bancarias donde los clientes consignan, por empresa.
7. **Membrete de cada owner** (Maestros → Owners): NIT, logo, dirección, texto legal.
8. **Destinatarios de WhatsApp** (Maestros): quién recibe el aviso de pedido aprobado, recaudo registrado y prospecto por aprobar.

### Después

9. Pasar `seguridad.modo` a **`enforce`**.
10. Decidir qué hacer con tres tablas de LIPgo que todavía se pueden leer sin sesión (`permisos_usuarios`, `profiles`, `whatsapp_mensajes`). Cambiarlas exige probar antes en LIPgo.

---

## 9. Lo que no está hecho

- **Portal de cliente:** solo la evaluación, como pedía el requerimiento. Alcance, riesgos, pasarela PSE sugerida y esfuerzo en `docs/EVALUACION_PORTAL_CLIENTE.md`.
- **Modo sin conexión para el vendedor en carretera:** pregunta abierta del requerimiento; no se construyó.
- **Estado de cuenta por correo:** se descarga o se envía por WhatsApp; no por correo.
- **Plantilla oficial del estado de cuenta:** se usa una plantilla configurable mientras INDUPAN entrega la suya.
- **SAP no se ha probado contra un SAP real**, porque no hay uno conectado. El traductor está cubierto por pruebas.
- **El análisis con IA del cliente no se ha probado con un cliente real** (necesita una sesión y la clave de Anthropic en Vercel); usa el mismo mecanismo que la lectura de comprobantes, que sí funciona.
- **Sin probar de punta a punta en pantalla:** los recaudos, el tablero de cartera y el expediente del prospecto se probaron en la base de datos, pero falta el recorrido de un usuario real. La conversión de prospecto en cliente dentro de LIPgo no se ha ejecutado todavía (escribe en producción).

---

## 10. Qué revisar antes de dar por bueno el sistema

Un recorrido que prueba lo importante. Se necesitan **dos usuarios** (quien registra no puede aprobar).

**Pedido**
1. Crear un pedido a un cliente que supere su cupo: debe mostrar el **sobrecupo con su valor exacto** y dejar enviarlo.
2. Aprobarlo como Cartera; intentar aprobarlo también como Gerencia **con el mismo usuario**: debe rechazarlo.
3. Rechazarlo como Gerencia con motivo, corregirlo y reenviarlo. El historial debe mostrar todo.
4. Aprobarlo y **abrirlo en LIPgo**: debe estar con su sucursal y la empresa que factura.

**Recaudo**

5. Registrar un pago de $15.000.000 con foto, a un cliente con dos facturas de $10.000.000 vencidas: la propuesta debe ser $10.000.000 a la más vencida y $5.000.000 a la otra.
6. Subir una foto borrosa: debe rechazarla con el motivo.
7. Aprobarlo con el otro usuario y ver el **recibo de caja** y los saldos actualizados en Cuentas por Cobrar.

**Prospecto**

8. Crear un prospecto, enviarle el enlace, subir los documentos desde el celular y enviarlo a Cartera.
9. Aprobarlo con el otro usuario: el cliente debe aparecer en LIPgo con su sucursal.

**Cartera**

10. Abrir el Tablero de Cartera, filtrar por un vendedor y abrir la Cuenta 360 de un cliente.
11. Descargar su estado de cuenta y enviarlo por WhatsApp.
12. Cambiar un corte de los rangos en Parametrización y comprobar que la clasificación cambia sola.

---

## 11. Dónde está todo

- **Código:** `github.com/gerenciageneral-spec/CRMLIPGO`, rama `main`. Vercel publica cada cambio.
- **Base de datos:** la misma de LIPgo (Supabase).
- **Scripts de base de datos:** `scripts/`, 181 a 207, ejecutados. Datos de demostración en `scripts/seed/`.
- **Requerimiento y su estado:** `docs/GAP_ANALYSIS_INDUPAN.md`.
- **Portal de cliente:** `docs/EVALUACION_PORTAL_CLIENTE.md`.
- **Guía visual para desarrolladores:** `components/crm/ui/README.md`.

> ⚠️ **El repositorio sigue siendo público.** Contiene el código del CRM y los commits heredados de LIPgo, con datos de nómina, facturación y nombres de clientes reales. Conviene pasarlo a privado.
