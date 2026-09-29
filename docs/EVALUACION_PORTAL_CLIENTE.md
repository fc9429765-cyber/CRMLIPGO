# Evaluación: portal de cliente

Requerimiento INDUPAN, sección 11 (POR-01 a POR-06). **No se construyó**: este documento dice qué implicaría, qué riesgos tiene, qué pasarela usar para PSE y cuánto costaría en tiempo, para decidir si se hace y en qué orden.

## Recomendación en una línea

Hacerlo en tres entregas y **empezar por lo que no mueve dinero ni pedidos**: estado de cuenta en vivo y alertas de pago (bajo riesgo, se apoya en lo que ya existe); luego pagos PSE; y al final pedidos y sucursales creados por el cliente, que cambian el proceso comercial y conviene decidir con calma.

## Qué pide y qué ya existe

| ID | El cliente puede… | Qué hay hoy en el CRM que se reutiliza | Qué falta |
|---|---|---|---|
| POR-04 | Consultar en vivo su estado de cuenta | El cálculo de cartera (misma función del tablero y la Cuenta 360), el estado de cuenta en PDF por empresa, los recibos de caja | Pantalla del cliente y su acceso |
| POR-05 | Recibir alertas de pago | Envío de WhatsApp por la bandeja de salida, con reintentos; rangos de vencimiento en Parametrización | Tarea diaria que detecte vencimientos próximos y vencidos, y una plantilla aprobada por Meta para escribirle al cliente |
| POR-03 | Pagar por PSE | El recaudo ya aplica pagos a la factura más vencida primero, deja el excedente como saldo a favor y genera el recibo de caja | Integración con la pasarela y la confirmación automática del pago |
| POR-01 | Montar sus propios pedidos | Todo el flujo de pedido: catálogo del cliente, precios por lista, impuestos, sobrecupo, aprobación Cartera → Gerencia, paso a LIPgo | Pantalla simplificada y decidir las reglas (ver riesgos) |
| POR-02 | Crear sus sucursales | La creación de sucursales en LIPgo (misma función que usa la aprobación de prospectos) | Pantalla y una revisión por Cartera o Logística antes de que la sucursal reciba despachos |
| POR-06 | Hacer toda la gestión desde el portal | — | Es el resultado de los cinco anteriores |

## Cómo encaja sin rehacer nada

El sistema ya se preparó para esto (lo pedía la sección 11):

- **Permisos:** hoy cada acción del servidor sabe quién pide y qué alcance tiene (todo, o solo lo de un vendedor). Se agrega un alcance más, *cliente*, que filtra todo por el cliente vinculado al usuario. Las acciones que un cliente no debe usar (aprobar, anular, descuentos, integraciones) ya exigen permisos que un cliente nunca tendría.
- **Base de datos:** las tablas del CRM están cerradas al acceso directo desde el navegador (script 204). El portal pasa por el mismo servidor, así que no hay que abrir nada.
- **Nuevo:** una tabla que vincule cada usuario del portal con **un** cliente de LIPgo, creada por Cartera. No se puede deducir del NIT: en LIPgo hay 46 NITs repetidos.
- **Precedente:** el enlace que hoy usa el prospecto para subir documentos (sin usuario, con token que caduca) es el mismo patrón que se usaría para invitar al cliente a crear su acceso.

El portal sería una sección aparte de la aplicación (idealmente un subdominio propio, por ejemplo `clientes.indupan.com`) con su propio menú: el cliente nunca ve la interfaz del CRM.

## Pasarela PSE sugerida

**Wompi** (de Bancolombia), por tres razones:

1. Tiene PSE, tarjetas, Nequi y botón Bancolombia en una sola integración.
2. Confirma cada pago al servidor con una notificación firmada (webhook), que es lo que permite registrar el recaudo sin intervención y sin confiar en lo que diga el navegador.
3. Tiene ambiente de pruebas completo, lo que permite construir y validar sin mover dinero real.

Alternativas equivalentes: **PayU** y **ePayco**. Las tres cobran un porcentaje por transacción más un valor fijo; **las tarifas cambian y deben cotizarse** con cada una antes de decidir. La vinculación comercial (contrato, documentos, cuenta de recaudo) toma varias semanas y conviene iniciarla en paralelo con el desarrollo.

**Cómo entraría un pago:** el cliente elige qué facturas paga → paga en la pasarela → la pasarela confirma al servidor → se crea el recaudo con la referencia de la transacción como comprobante y se aprueba automáticamente (el dinero ya está confirmado por el banco) → se aplica a las facturas elegidas, se genera el recibo de caja y, si el owner factura por SAP, queda en la bandeja hacia SAP como cualquier otro recaudo.

## Riesgos

| Riesgo | Por qué importa | Cómo se mitiga |
|---|---|---|
| Un cliente ve datos de otro | Es el peor error posible en un portal | Vínculo usuario → cliente explícito (no por NIT); filtro en el servidor en cada acción; pruebas automáticas que intenten leer otro cliente |
| Pedidos del cliente saltándose al vendedor | Cambia comisiones, relación comercial y control de precios | Decidir antes: ¿el pedido del portal tiene vendedor y comisión? ¿pasa por la misma aprobación Cartera → Gerencia? Recomendación: sí, entra como pedido pendiente y se aprueba igual |
| Sucursales mal creadas | Un despacho a una dirección inválida cuesta dinero | La sucursal del portal queda pendiente hasta que Cartera o Logística la apruebe |
| Conciliación PSE vs. contabilidad | Un pago confirmado por la pasarela que no aparece en SAP, o al revés | La llave de cada pago es la referencia de la transacción; la bandeja de salida ya evita duplicados; conciliación diaria con el reporte de la pasarela |
| Pago de una factura que ya no existe o cambió | El cliente paga sobre datos viejos | Validar saldos en el servidor al confirmar; lo que sobre queda como saldo a favor (ya existe) |
| Costo de WhatsApp | Meta cobra por conversación iniciada por la empresa | Alertas solo en hitos (por vencer, vencida) y con tope por cliente; correo como alternativa gratuita |
| Soporte | Clientes que olvidan clave o no entienden su cartera | Recuperación de clave por correo; el estado de cuenta en PDF ya explica cada cifra |

## Esfuerzo estimado

Estimado para un desarrollador con el sistema actual como base. Es un orden de magnitud para decidir, no un compromiso: se precisa al detallar cada entrega.

| Entrega | Contenido | Semanas |
|---|---|---|
| 1 | Acceso del cliente (invitación, clave, vínculo con su cuenta), estado de cuenta en vivo, recibos, descarga en PDF, alertas de vencimiento | 3 – 4 |
| 2 | Pagos PSE con Wompi (o la elegida), confirmación automática y conciliación | 3 – 4, más el trámite comercial con la pasarela en paralelo |
| 3 | Pedidos y sucursales desde el portal, con sus aprobaciones | 3 – 4 |
| — | Piloto con 5 a 10 clientes y ajustes | 2 |

**Total: 11 a 14 semanas** si se hacen las tres entregas. Solo la primera ya cubre POR-04 y POR-05.

## Decisiones que INDUPAN tiene que tomar

1. ¿Se hace el portal, y con qué entrega se empieza?
2. Pasarela: cotizar Wompi, PayU y ePayco y elegir una.
3. Pedidos del portal: ¿llevan vendedor y comisión? ¿Pasan por la misma doble aprobación?
4. Sucursales del portal: ¿quién las aprueba antes de que reciban despachos?
5. Alertas: ¿por WhatsApp, por correo o ambos? ¿Con cuántos días de anticipación?
6. ¿Qué clientes participan en el piloto?
