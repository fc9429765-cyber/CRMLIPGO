-- ============================================================================
-- 193_crm_owners.sql
-- ----------------------------------------------------------------------------
-- Fase 1 del requerimiento INDUPAN: el OWNER decide el flujo del pedido
-- (PED-15, PED-16). INDUPAN: doble aprobacion → SAP → LIPgo. Molinos: doble
-- aprobacion → LIPgo, y ahi termina.
--
-- LO QUE YA EXISTIA Y SE RESPETA (verificado en la base el 2026-09-26):
--   - `owners` (LIPgo): id 1 "Harinera Indupan", id 3 "Molinos del Atlantico".
--   - `productos.owner` (texto): "HARINERA INDUPAN" en la empresa 1,
--     "MOLINOS DEL ATLANTICO" en las empresas 3 y 4. 14 productos sin owner.
--   - En `pedidoscabecera`, `empresafactura` lleva el nombre del owner e
--     `id_empresa` el centro de despacho: Molinos despacha desde 3 (Cedi
--     Funza) y 4 (Cedi Medellin).
--
-- POR ESO NO SE AGREGA UNA COLUMNA DE OWNER A `productos`: ya tiene una. Este
-- maestro solo dice, para cada owner del CRM, que textos de `productos.owner`
-- le corresponden, en que empresas estan sus productos (para los que no tienen
-- owner escrito), a que centro de LIPgo se proyectan sus pedidos, con que
-- nombre va `empresafactura`, y si factura por SAP.
--
-- Nada de esto esta en el codigo: agregar un owner es un INSERT.
--
-- Aditivo e idempotente.
-- ============================================================================

create table if not exists public.crm_owners (
  id                    serial primary key,
  idempresa             int  not null default 1,
  codigo                text not null,
  nombre                text not null,
  -- Enlace al owner de LIPgo. Opcional: el CRM no escribe en `owners`.
  owner_lipgo_id        int,
  -- Valor que se escribe en pedidoscabecera.empresafactura. LIPgo filtra por
  -- el a los usuarios con owners asignados.
  nombre_empresafactura text not null,
  -- Textos de productos.owner que pertenecen a este owner (se comparan en
  -- mayusculas y sin espacios extremos).
  alias_producto        text[] not null default '{}',
  -- Empresas de LIPgo donde estan sus productos. Resuelve los que no traen
  -- owner escrito.
  idempresas_origen     int[]  not null default '{}',
  -- Centro de despacho por defecto al proyectar el pedido a LIPgo.
  idempresa_lipgo       int  not null,
  -- INDUPAN factura por SAP; Molinos no. Ningun interruptor de SAP puede hacer
  -- que un owner con false llegue a SAP.
  envia_sap             boolean not null default false,
  color                 text,
  activo                boolean not null default true,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  unique (idempresa, codigo)
);

comment on table public.crm_owners is
  'Owners comerciales (INDUPAN, Molinos). El owner del producto decide el flujo del pedido: a que centro de LIPgo se proyecta, con que empresafactura y si pasa por SAP.';
comment on column public.crm_owners.envia_sap is
  'Solo los owners con true generan envios a SAP. Molinos va en false: sus pedidos terminan en LIPgo.';

insert into public.crm_owners
  (idempresa, codigo, nombre, owner_lipgo_id, nombre_empresafactura,
   alias_producto, idempresas_origen, idempresa_lipgo, envia_sap, color)
values
  (1, 'INDUPAN', 'Harinera Indupan', 1, 'Harinera Indupan',
   '{"HARINERA INDUPAN","INDUPAN"}', '{1,6}', 1, true, '#4f63c4'),
  (1, 'MOLINOS', 'Molinos del Atlántico', 3, 'Molinos del Atlántico',
   '{"MOLINOS DEL ATLANTICO","MOLINOS DEL ATLÁNTICO"}', '{3,4}', 3, false, '#1f8fb0')
on conflict (idempresa, codigo) do nothing;


-- ---------------------------------------------------------------------------
-- Owner de un producto. Primero por el texto de productos.owner; si no trae,
-- por la empresa donde esta creado. Devuelve null si no encaja con ninguno.
-- ---------------------------------------------------------------------------
-- p_producto_id es bigint porque productos.id lo es. Con int, Postgres no
-- encuentra la funcion al pasarle una columna de productos.
create or replace function public.crm_owner_de_producto(p_producto_id bigint, p_idempresa int default 1)
returns int
language sql
stable
as $$
  with p as (
    select upper(trim(coalesce(owner, ''))) as owner_txt, id_empresa
      from public.productos where id = p_producto_id
  )
  select o.id
    from public.crm_owners o, p
   where o.idempresa = p_idempresa and o.activo
     and (p.owner_txt = any (select upper(trim(a)) from unnest(o.alias_producto) a)
          or (p.owner_txt = '' and p.id_empresa = any (o.idempresas_origen)))
   order by (p.owner_txt <> '') desc, o.id
   limit 1
$$;

comment on function public.crm_owner_de_producto(bigint, int) is
  'Owner de un producto: por productos.owner y, si esta vacio, por la empresa donde esta creado.';


-- ---------------------------------------------------------------------------
-- El owner viaja con cada documento: un pedido pertenece a UN owner (PED-17),
-- y la cartera se separa por owner.
-- ---------------------------------------------------------------------------
alter table public.crm_cotizaciones   add column if not exists owner_id int references public.crm_owners(id);
alter table public.crm_pedidos        add column if not exists owner_id int references public.crm_owners(id);
alter table public.crm_cuentas_cobrar add column if not exists owner_id int references public.crm_owners(id);

create index if not exists ix_crm_cot_owner on public.crm_cotizaciones   (idempresa, owner_id);
create index if not exists ix_crm_ped_owner on public.crm_pedidos        (idempresa, owner_id);
create index if not exists ix_crm_cxc_owner on public.crm_cuentas_cobrar (idempresa, owner_id);


-- ============================================================================
-- VERIFICACION
-- ============================================================================

-- 1. Los dos owners sembrados (esperado: INDUPAN envia_sap=true, MOLINOS false)
select codigo, nombre_empresafactura, idempresa_lipgo, envia_sap from public.crm_owners order by id;

-- 2. Reparto de productos por owner (esperado: ningun producto de las
--    empresas 1, 3 y 4 sin owner)
select o.codigo, count(*) as productos
  from public.productos pr
  left join public.crm_owners o on o.id = public.crm_owner_de_producto(pr.id)
 where pr.id_empresa in (1, 3, 4, 6)
 group by o.codigo
 order by o.codigo nulls last;


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
--   alter table public.crm_cotizaciones   drop column if exists owner_id;
--   alter table public.crm_pedidos        drop column if exists owner_id;
--   alter table public.crm_cuentas_cobrar drop column if exists owner_id;
--   drop function if exists public.crm_owner_de_producto(bigint, int);
--   drop table if exists public.crm_owners;
-- ============================================================================
