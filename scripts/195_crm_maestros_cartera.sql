-- ============================================================================
-- 195_crm_maestros_cartera.sql
-- ----------------------------------------------------------------------------
-- Fase 1 del requerimiento INDUPAN: los maestros que necesitan los recaudos,
-- los rechazos y los avisos (ADM-01, REC-08, REC-10, REC-11, PED-20, PED-25).
--
-- Hoy los medios de pago son una lista escrita en el codigo, no hay bancos ni
-- cuentas, y los motivos de rechazo son texto libre. Un maestro permite que
-- cartera los administre sin programador, y que los informes agrupen por
-- motivo en vez de por la forma en que cada quien lo escribio.
--
-- CUENTA DESTINO: el requerimiento dice que NO hace falta el numero de cuenta
-- (REC-11). Se identifica por alias y banco. El numero queda como campo
-- opcional, para la conciliacion y para SAP.
--
-- DESTINATARIOS: quien recibe cada aviso por WhatsApp (por ejemplo, Jefferson
-- cuando se aprueba un pedido). Tabla y no parametro porque un evento puede
-- tener varios destinatarios, y cada uno puede limitarse a un owner.
--
-- Aditivo e idempotente.
-- ============================================================================

create table if not exists public.crm_bancos (
  id          serial primary key,
  idempresa   int  not null default 1,
  codigo      text not null,
  nombre      text not null,
  sap_codigo  text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (idempresa, codigo)
);

create table if not exists public.crm_cuentas_destino (
  id          serial primary key,
  idempresa   int  not null default 1,
  alias       text not null,
  banco_id    int  not null references public.crm_bancos(id),
  owner_id    int  references public.crm_owners(id),
  tipo        text check (tipo in ('ahorros','corriente','recaudo','otra')),
  numero      text,
  sap_cuenta  text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (idempresa, alias)
);

comment on column public.crm_cuentas_destino.numero is
  'Opcional. El vendedor elige la cuenta por su alias; el numero solo sirve para conciliar y para SAP.';

create table if not exists public.crm_medios_pago (
  id                     serial primary key,
  idempresa              int  not null default 1,
  codigo                 text not null,
  nombre                 text not null,
  requiere_banco         boolean not null default true,
  requiere_comprobante   boolean not null default true,
  sap_codigo             text,
  activo                 boolean not null default true,
  orden                  int  not null default 0,
  creado_en              timestamptz not null default now(),
  unique (idempresa, codigo)
);

create table if not exists public.crm_motivos (
  id          serial primary key,
  idempresa   int  not null default 1,
  tipo        text not null check (tipo in ('rechazo_pedido','rechazo_recaudo','rechazo_prospecto','anulacion')),
  codigo      text not null,
  nombre      text not null,
  -- Si true, al elegirlo hay que escribir ademas una explicacion.
  exige_nota  boolean not null default false,
  activo      boolean not null default true,
  orden       int  not null default 0,
  creado_en   timestamptz not null default now(),
  unique (idempresa, tipo, codigo)
);

create table if not exists public.crm_notificacion_destinatarios (
  id          serial primary key,
  idempresa   int  not null default 1,
  evento      text not null check (evento in ('pedido_aprobado','pedido_rechazado','recaudo_registrado','prospecto_pendiente')),
  nombre      text not null,
  celular     text not null,
  -- Si se indica, solo recibe los avisos de ese owner.
  owner_id    int  references public.crm_owners(id),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  -- nulls not distinct: sin esto, dos filas con owner_id nulo no chocan y se
  -- podria registrar dos veces al mismo destinatario para el mismo evento.
  unique nulls not distinct (idempresa, evento, celular, owner_id)
);

comment on table public.crm_notificacion_destinatarios is
  'Quien recibe cada aviso por WhatsApp. El requerimiento nombra a Jefferson para pedido_aprobado; se registra aqui con su celular.';


-- ---------------------------------------------------------------------------
-- SEMILLAS
-- ---------------------------------------------------------------------------
insert into public.crm_bancos (idempresa, codigo, nombre)
select 1, v.codigo, v.nombre
  from (values
    ('BANCOLOMBIA', 'Bancolombia'), ('DAVIVIENDA', 'Davivienda'), ('BOGOTA', 'Banco de Bogotá'),
    ('BBVA', 'BBVA Colombia'), ('OCCIDENTE', 'Banco de Occidente'), ('POPULAR', 'Banco Popular'),
    ('AVVILLAS', 'Banco AV Villas'), ('CAJASOCIAL', 'Banco Caja Social'),
    ('COLPATRIA', 'Scotiabank Colpatria'), ('ITAU', 'Itaú'), ('AGRARIO', 'Banco Agrario'),
    ('GNB', 'Banco GNB Sudameris'), ('BANCOOMEVA', 'Bancoomeva'), ('FALABELLA', 'Banco Falabella'),
    ('NEQUI', 'Nequi'), ('DAVIPLATA', 'Daviplata')
  ) as v(codigo, nombre)
 where not exists (select 1 from public.crm_bancos b where b.idempresa = 1 and b.codigo = v.codigo);

-- Los mismos medios que estaban escritos en lib/crm-cartera.ts, ahora
-- administrables.
insert into public.crm_medios_pago (idempresa, codigo, nombre, requiere_banco, requiere_comprobante, orden)
select 1, v.codigo, v.nombre, v.banco, v.comprobante, v.orden
  from (values
    ('transferencia', 'Transferencia',  true,  true,  1),
    ('consignacion',  'Consignación',   true,  true,  2),
    ('efectivo',      'Efectivo',       false, false, 3),
    ('cheque',        'Cheque',         true,  true,  4),
    ('otro',          'Otro',           false, true,  9)
  ) as v(codigo, nombre, banco, comprobante, orden)
 where not exists (select 1 from public.crm_medios_pago m where m.idempresa = 1 and m.codigo = v.codigo);

insert into public.crm_motivos (idempresa, tipo, codigo, nombre, exige_nota, orden)
select 1, v.tipo, v.codigo, v.nombre, v.nota, v.orden
  from (values
    ('rechazo_pedido',    'CARTERA_VENCIDA', 'Cliente con cartera vencida',        false, 1),
    ('rechazo_pedido',    'SOBRECUPO',       'Excede el cupo de crédito',          false, 2),
    ('rechazo_pedido',    'PRECIO',          'Precio o descuento no autorizado',   false, 3),
    ('rechazo_pedido',    'DATOS',           'Datos incompletos o errados',        true,  4),
    ('rechazo_pedido',    'OTRO',            'Otro motivo',                        true,  9),
    ('rechazo_recaudo',   'COMPROBANTE',     'Comprobante ilegible o no válido',   false, 1),
    ('rechazo_recaudo',   'NO_CONSIGNADO',   'El dinero no aparece en la cuenta',  false, 2),
    ('rechazo_recaudo',   'VALOR',           'El valor no coincide',               false, 3),
    ('rechazo_recaudo',   'DUPLICADO',       'Recaudo ya registrado',              false, 4),
    ('rechazo_recaudo',   'OTRO',            'Otro motivo',                        true,  9),
    ('rechazo_prospecto', 'DOCUMENTOS',      'Documentos incompletos',             false, 1),
    ('rechazo_prospecto', 'RIESGO',          'No cumple la política de crédito',   false, 2),
    ('rechazo_prospecto', 'OTRO',            'Otro motivo',                        true,  9),
    ('anulacion',         'ERROR',           'Registrado por error',               false, 1),
    ('anulacion',         'OTRO',            'Otro motivo',                        true,  9)
  ) as v(tipo, codigo, nombre, nota, orden)
 where not exists (
   select 1 from public.crm_motivos m where m.idempresa = 1 and m.tipo = v.tipo and m.codigo = v.codigo);


-- ============================================================================
-- VERIFICACION
-- ============================================================================
select 'bancos' as maestro, count(*) from public.crm_bancos
union all select 'medios de pago', count(*) from public.crm_medios_pago
union all select 'motivos', count(*) from public.crm_motivos
union all select 'cuentas destino (se cargan a mano)', count(*) from public.crm_cuentas_destino
union all select 'destinatarios (se cargan a mano)', count(*) from public.crm_notificacion_destinatarios;


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
--   drop table if exists public.crm_notificacion_destinatarios;
--   drop table if exists public.crm_motivos;
--   drop table if exists public.crm_medios_pago;
--   drop table if exists public.crm_cuentas_destino;
--   drop table if exists public.crm_bancos;
-- ============================================================================
