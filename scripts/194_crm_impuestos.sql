-- ============================================================================
-- 194_crm_impuestos.sql
-- ----------------------------------------------------------------------------
-- Fase 1 del requerimiento INDUPAN: impuesto POR PRODUCTO (PED-11, PED-12).
--
-- Hasta hoy habia un solo IVA para todo el documento (parametro
-- iva.porcentaje_default = 5). El requerimiento pide que cada producto lleve su
-- tarifa: 19 %, 5 %, exento o excluido. Un pedido que mezcla harina (5 %) con
-- un producto al 19 % calculaba mal uno de los dos.
--
-- EXENTO vs EXCLUIDO: los dos dan 0 % en el documento, pero no son lo mismo
-- para la DIAN (el exento genera derecho a devolucion, el excluido no), y SAP
-- los distingue con codigos distintos. Por eso son dos filas y no una.
--
-- La tarifa por defecto sale del parametro vigente: un producto sin impuesto
-- asignado se sigue calculando exactamente igual que antes de este script.
--
-- Por linea se guarda la tarifa y el valor CONGELADOS: si mañana cambia la
-- tarifa de un producto, un pedido ya emitido conserva la suya.
--
-- Aditivo e idempotente.
-- ============================================================================

create table if not exists public.crm_impuestos (
  id          serial primary key,
  idempresa   int  not null default 1,
  codigo      text not null,
  nombre      text not null,
  tipo        text not null check (tipo in ('iva','exento','excluido')),
  tarifa      numeric(6,3) not null check (tarifa >= 0 and tarifa <= 100),
  -- Codigo del impuesto en SAP (TaxCode). Se llena al activar la integracion.
  sap_codigo  text,
  es_default  boolean not null default false,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (idempresa, codigo)
);

-- Un solo impuesto por defecto por empresa.
create unique index if not exists ux_crm_impuesto_default
  on public.crm_impuestos (idempresa) where es_default;

comment on table public.crm_impuestos is
  'Tarifas de impuesto que se asignan a cada producto. La marcada es_default se usa para los productos sin impuesto asignado.';

insert into public.crm_impuestos (idempresa, codigo, nombre, tipo, tarifa, es_default)
select 1, v.codigo, v.nombre, v.tipo, v.tarifa, v.es_default
  from (values
    ('IVA_DEFAULT', 'IVA ' || coalesce((select valor from public.crm_parametros
                                         where idempresa = 1 and clave = 'iva.porcentaje_default'
                                           and vigente_hasta is null limit 1), '5') || ' %',
     'iva',
     coalesce((select valor::numeric from public.crm_parametros
                where idempresa = 1 and clave = 'iva.porcentaje_default'
                  and vigente_hasta is null limit 1), 5),
     true),
    ('IVA_19',   'IVA 19 %', 'iva',      19, false),
    ('EXENTO',   'Exento',   'exento',    0, false),
    ('EXCLUIDO', 'Excluido', 'excluido',  0, false)
  ) as v(codigo, nombre, tipo, tarifa, es_default)
 where not exists (select 1 from public.crm_impuestos i where i.idempresa = 1 and i.codigo = v.codigo);


-- Impuesto del producto. NULL = el impuesto por defecto.
alter table public.productos
  add column if not exists crm_impuesto_id int references public.crm_impuestos(id);

comment on column public.productos.crm_impuesto_id is
  'CRM: impuesto del producto. NULL = el impuesto por defecto (crm_impuestos.es_default). LIPgo no la usa.';


-- Impuesto congelado por linea.
alter table public.crm_cotizacion_detalle
  add column if not exists impuesto_id    int references public.crm_impuestos(id),
  add column if not exists impuesto_pct   numeric(6,3),
  add column if not exists base_impuesto  numeric(14,2),
  add column if not exists impuesto_valor numeric(14,2);

alter table public.crm_pedido_detalle
  add column if not exists impuesto_id    int references public.crm_impuestos(id),
  add column if not exists impuesto_pct   numeric(6,3),
  add column if not exists base_impuesto  numeric(14,2),
  add column if not exists impuesto_valor numeric(14,2);

-- Lineas anteriores: se completan con el IVA de su encabezado, que es con el
-- que se emitieron. (Verificado el 2026-09-26: las tablas estan vacias; esto
-- queda por si el script se corre en otra base.)
update public.crm_cotizacion_detalle d
   set impuesto_pct   = c.iva_pct,
       base_impuesto  = d.subtotal,
       impuesto_valor = round(d.subtotal * c.iva_pct / 100.0, 2)
  from public.crm_cotizaciones c
 where c.id = d.cotizacion_id and d.impuesto_pct is null;

update public.crm_pedido_detalle d
   set impuesto_pct   = p.iva_pct,
       base_impuesto  = d.subtotal,
       impuesto_valor = round(d.subtotal * p.iva_pct / 100.0, 2)
  from public.crm_pedidos p
 where p.id = d.pedido_id and d.impuesto_pct is null;


-- ============================================================================
-- VERIFICACION
-- ============================================================================

-- 1. Cuatro impuestos, uno por defecto con la tarifa del parametro actual
select codigo, nombre, tipo, tarifa, es_default from public.crm_impuestos order by id;

-- 2. Columnas por linea (esperado: 8)
select count(*) as columnas_linea
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('crm_cotizacion_detalle','crm_pedido_detalle')
   and column_name in ('impuesto_id','impuesto_pct','base_impuesto','impuesto_valor');


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
--   alter table public.crm_cotizacion_detalle drop column if exists impuesto_id,
--     drop column if exists impuesto_pct, drop column if exists base_impuesto,
--     drop column if exists impuesto_valor;
--   (igual para crm_pedido_detalle)
--   alter table public.productos drop column if exists crm_impuesto_id;
--   drop table if exists public.crm_impuestos;
-- ============================================================================
