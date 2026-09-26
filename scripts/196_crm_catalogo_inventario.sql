-- ============================================================================
-- 196_crm_catalogo_inventario.sql
-- ----------------------------------------------------------------------------
-- Fase 1 del requerimiento INDUPAN: catalogo por cliente e inventario visible
-- para el vendedor (PED-07, PED-08, PED-09).
--
-- CATALOGO: cada cliente puede tener su lista de productos. Al venderle, el
-- vendedor solo ve esos. El parametro `catalogo.modo` decide que pasa con un
-- cliente SIN catalogo asignado:
--   todos       → ve todo el catalogo (por defecto: no cambia nada de hoy);
--   restringido → no puede venderle nada hasta que le asignen productos.
--
-- INVENTARIO: se lee de `invglobal` de LIPgo, que ya es lo que usa su pantalla
-- de ordenes de cargue. Se cruza por idproducto = productos.id (verificado el
-- 2026-09-26: es el cruce que mas filas acierta; por codigo o por nombre falla
-- mas). El stock viene por sede de despacho (idempresa), asi que la vista da el
-- total y el desglose por sede.
--
-- Aditivo e idempotente.
-- ============================================================================

create table if not exists public.crm_catalogo_cliente (
  id           bigserial primary key,
  idempresa    int  not null default 1,
  cliente_id   int  not null,
  producto_id  bigint not null,   -- productos.id es bigint
  orden        int  not null default 0,
  activo       boolean not null default true,
  creado_por   text,
  creado_en    timestamptz not null default now(),
  unique (idempresa, cliente_id, producto_id)
);

create index if not exists ix_crm_catalogo_cliente
  on public.crm_catalogo_cliente (idempresa, cliente_id) where activo;

comment on table public.crm_catalogo_cliente is
  'Productos que se le pueden vender a cada cliente (PED-07). Sin filas para un cliente, manda el parametro catalogo.modo.';


-- Stock por producto con desglose por sede. Solo lectura: el CRM no mueve
-- inventario, eso es de LIPgo.
create or replace view public.crm_inventario_producto as
select i.idproducto                         as producto_id,
       sum(coalesce(i.stock_disp, 0))        as stock_disponible,
       sum(coalesce(i.stock_res, 0))         as stock_reservado,
       sum(coalesce(i.stock_global, 0))      as stock_global,
       jsonb_agg(jsonb_build_object(
         'idempresa', i.idempresa,
         'sede', coalesce(e.nombre, i.idempresa::text),
         'disponible', coalesce(i.stock_disp, 0)
       ) order by i.idempresa)              as por_sede
  from public.invglobal i
  left join public.empresas e on e.id = i.idempresa
 group by i.idproducto;

comment on view public.crm_inventario_producto is
  'Inventario de LIPgo (invglobal) agrupado por producto, con desglose por sede de despacho. Solo lectura.';


insert into public.crm_parametros
  (idempresa, clave, valor, tipo, grupo, etiqueta, descripcion, editable)
select 1, v.clave, v.valor, v.tipo, v.grupo, v.etiqueta, v.descripcion, true
  from (values
    ('catalogo.modo', 'todos', 'string', 'catalogo', 'Clientes sin catálogo asignado',
     'todos = pueden comprar cualquier producto. restringido = no se les puede vender hasta asignarles productos.'),
    ('inventario.mostrar_al_vendedor', 'true', 'boolean', 'catalogo', 'Mostrar inventario al vendedor',
     'Si está apagado, el vendedor no ve las existencias al armar el pedido.')
  ) as v(clave, valor, tipo, grupo, etiqueta, descripcion)
 where not exists (
   select 1 from public.crm_parametros p
    where p.idempresa = 1 and p.clave = v.clave and p.vigente_hasta is null);


-- ============================================================================
-- VERIFICACION
-- ============================================================================

-- 1. La vista responde y cruza con productos (esperado: > 0)
select count(*) as productos_con_inventario
  from public.crm_inventario_producto ip
  join public.productos p on p.id = ip.producto_id;

-- 2. Parametros (esperado: 2)
select clave, valor from public.crm_parametros
 where clave in ('catalogo.modo','inventario.mostrar_al_vendedor') and vigente_hasta is null;


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
--   drop view if exists public.crm_inventario_producto;
--   drop table if exists public.crm_catalogo_cliente;
--   delete from public.crm_parametros where clave in ('catalogo.modo','inventario.mostrar_al_vendedor');
-- ============================================================================
