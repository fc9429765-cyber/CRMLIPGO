-- ============================================================================
-- 207_crm_sap_mapeo.sql
-- ----------------------------------------------------------------------------
-- Fase 6 del requerimiento INDUPAN: SAP listo para encender (INT-03, INT-06).
--
-- MAPEO DE CODIGOS. SAP no conoce los ids del CRM ni de LIPgo: un pedido en
-- SAP lleva CardCode (cliente), ItemCode (producto), WarehouseCode (bodega),
-- un pago lleva el DocEntry de la factura que paga. Esta tabla guarda esa
-- equivalencia. Nunca se usa el codigo de SAP como llave del CRM (INT-06): si
-- SAP cambia un codigo, se corrige aqui y nada mas se rompe.
--
-- Lo que ya tiene su codigo SAP en su propio maestro no se repite aqui:
-- impuestos (crm_impuestos.sap_codigo), medios de pago (sap_codigo), cuentas
-- destino (sap_cuenta) y bancos (sap_codigo).
--
-- CIERRE DE ESTADOS DE PEDIDO: el script 199 dejo un CHECK que aceptaba los
-- estados viejos mientras se migraban. Si ya no queda ningun pedido en un
-- estado viejo, se quita; si queda alguno, no se toca y se avisa.
--
-- Aditivo e idempotente. Aplica la regla del 204 (RLS en la tabla nueva).
-- ============================================================================

create table if not exists public.crm_sap_mapeo (
  id              bigserial primary key,
  idempresa       int  not null default 1,
  entidad         text not null check (entidad in (
                    'cliente',        -- clientes.id            → CardCode
                    'sucursal',       -- bodegas.idbodega       → ShipToCode (nombre de la direccion en SAP)
                    'producto',       -- productos.id           → ItemCode
                    'vendedor',       -- vendedores.idvendedor  → SalesPersonCode
                    'centro',         -- centro de despacho (empresa de LIPgo) → WarehouseCode
                    'factura',        -- crm_cuentas_cobrar.id  → DocEntry de la factura en SAP
                    'condicion_pago'  -- dias de credito        → PayTermsGrpCode
                  )),
  entidad_id      bigint not null,
  codigo_sap      text not null,
  descripcion     text,
  actualizado_por text,
  actualizado_en  timestamptz not null default now(),
  unique (idempresa, entidad, entidad_id)
);

create index if not exists ix_crm_sap_mapeo_codigo on public.crm_sap_mapeo (idempresa, entidad, codigo_sap);

comment on table public.crm_sap_mapeo is
  'Equivalencia id del CRM/LIPgo ↔ codigo de SAP. Solo la usa el traductor al enviar; nunca es llave del CRM (INT-06).';

-- Regla del 204
alter table public.crm_sap_mapeo enable row level security;
revoke all on public.crm_sap_mapeo from anon, authenticated;


-- Prefijo del CardCode de los clientes que el CRM crea en SAP ("C" + NIT).
insert into public.crm_parametros (idempresa, clave, valor, tipo, grupo, etiqueta, descripcion, editable)
select 1, 'integracion.sap.prefijo_cliente', 'C', 'string', 'integracion', 'SAP: prefijo del código de cliente nuevo',
       'Un cliente aprobado desde prospecto se crea en SAP con este prefijo seguido del NIT, salvo que ya tenga su CardCode en Mapeos SAP.',
       true
 where not exists (select 1 from public.crm_parametros where idempresa = 1 and clave = 'integracion.sap.prefijo_cliente' and vigente_hasta is null);


-- ---------------------------------------------------------------------------
-- Cierre de los estados viejos de pedido (solo si no queda ninguno)
-- ---------------------------------------------------------------------------
do $$
declare v_viejos int;
begin
  select count(*) into v_viejos from public.crm_pedidos
   where estado in ('pendiente_autorizacion','autorizado_parcial','autorizado','enviado_lipgo');
  if v_viejos = 0 then
    alter table public.crm_pedidos drop constraint if exists crm_pedidos_estado_check;
    alter table public.crm_pedidos add constraint crm_pedidos_estado_check
      check (estado in ('borrador','pendiente_cartera','pendiente_gerencia','aprobado','programado_lipgo','rechazado','anulado'));
    raise notice 'Estados viejos de pedido retirados del CHECK.';
  else
    raise notice 'Quedan % pedidos en estados viejos: el CHECK no se toca.', v_viejos;
  end if;
end $$;


-- ============================================================================
-- VERIFICACION
-- ============================================================================
select count(*) as tabla_mapeo from information_schema.tables
 where table_schema = 'public' and table_name = 'crm_sap_mapeo';                          -- 1
select relrowsecurity as rls_activo from pg_class where relname = 'crm_sap_mapeo';         -- true
select pg_get_constraintdef(oid) as check_estados from pg_constraint where conname = 'crm_pedidos_estado_check';


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
--   drop table if exists public.crm_sap_mapeo;
--   (para volver a aceptar los estados viejos, correr de nuevo la seccion 2 del 199)
-- ============================================================================
