-- ============================================================================
-- 199_crm_pedidos_flujo.sql
-- ----------------------------------------------------------------------------
-- Fase 2 del requerimiento INDUPAN: el ciclo de vida completo del pedido
-- (PED-03..05, PED-15..24).
--
-- ESTADOS NUEVOS (PED-22):
--   borrador → pendiente_cartera → pendiente_gerencia → aprobado → programado_lipgo
--   rechazado → (edicion) → pendiente_cartera ;  anulado
-- SAP no es un estado: para INDUPAN va en paralelo con LIPgo y puede estar
-- apagado. Va en su propia columna `sap_estado`.
--
-- COMPATIBILIDAD: la restriccion nueva acepta los estados viejos y los nuevos,
-- y las filas se migran. Asi el codigo nuevo y el viejo pueden convivir
-- durante el despliegue. Un script posterior quitara los estados viejos cuando
-- se verifique que no queda ninguna fila con ellos. (Verificado el 2026-09-26:
-- crm_pedidos esta vacia, pero el script no lo asume.)
--
-- CENTRO DE DESPACHO: en LIPgo, `id_empresa` del pedido es el centro que
-- despacha, y LIPgo busca cada producto POR NOMBRE en ese centro. Cada owner
-- declara desde que centros despacha (INDUPAN: 1; Molinos: 3 Cedi Funza y 4
-- Cedi Medellin), el pedido guarda cual se eligio, y el vendedor solo ve los
-- productos que existen en ese centro. Asi un pedido nunca llega a LIPgo con
-- un producto que el centro no reconoce.
--
-- SOBRECUPO (PED-04): ya no bloquea. Se guarda el valor exacto y una foto de
-- la cartera del cliente al momento de enviar, para que quien aprueba vea lo
-- mismo que vio el vendedor.
--
-- Aditivo e idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Centros de despacho por owner
-- ---------------------------------------------------------------------------
alter table public.crm_owners
  add column if not exists idempresas_despacho int[] not null default '{}';

comment on column public.crm_owners.idempresas_despacho is
  'Centros de LIPgo (id_empresa) desde los que se despachan los pedidos de este owner. El pedido solo admite productos que existan en el centro elegido.';

update public.crm_owners set idempresas_despacho = '{1}'
 where codigo = 'INDUPAN' and idempresas_despacho = '{}';
update public.crm_owners set idempresas_despacho = '{3,4}'
 where codigo = 'MOLINOS' and idempresas_despacho = '{}';


-- ---------------------------------------------------------------------------
-- 2. Estados
-- ---------------------------------------------------------------------------
alter table public.crm_pedidos drop constraint if exists crm_pedidos_estado_check;
alter table public.crm_pedidos
  add constraint crm_pedidos_estado_check
  check (estado in (
    -- nuevos
    'borrador','pendiente_cartera','pendiente_gerencia','aprobado','programado_lipgo','rechazado','anulado',
    -- de la version anterior, mientras se migra
    'pendiente_autorizacion','autorizado_parcial','autorizado','enviado_lipgo'
  ));

-- Migracion determinista de filas existentes.
update public.crm_pedidos set estado = 'pendiente_cartera'
 where estado in ('pendiente_autorizacion','autorizado_parcial') and auth_contabilidad_en is null;
update public.crm_pedidos set estado = 'pendiente_gerencia'
 where estado in ('pendiente_autorizacion','autorizado_parcial') and auth_contabilidad_en is not null;
update public.crm_pedidos set estado = 'aprobado'
 where estado = 'autorizado' and idpedido_lipgo is null;
update public.crm_pedidos set estado = 'programado_lipgo'
 where estado in ('autorizado','enviado_lipgo') and idpedido_lipgo is not null;

drop index if exists public.ix_crm_ped_pendientes;
create index if not exists ix_crm_ped_pendientes
  on public.crm_pedidos (idempresa, estado)
  where estado in ('pendiente_cartera','pendiente_gerencia');


-- ---------------------------------------------------------------------------
-- 3. Columnas nuevas del pedido
-- ---------------------------------------------------------------------------
alter table public.crm_pedidos
  add column if not exists idempresa_despacho  int,
  add column if not exists requiere_sobrecupo  boolean not null default false,
  add column if not exists sobrecupo_valor     numeric(14,2) not null default 0,
  -- Foto de la cartera al momento de solicitar aprobacion.
  add column if not exists cupo_snapshot       numeric(14,2),
  add column if not exists saldo_snapshot      numeric(14,2),
  add column if not exists vencido_snapshot    numeric(14,2),
  add column if not exists dias_mora_snapshot  int,
  add column if not exists solicitado_por      uuid,
  add column if not exists solicitado_nombre   text,
  add column if not exists solicitado_en       timestamptz,
  -- Sube cada vez que un pedido rechazado se corrige y se reenvia. Entra en
  -- la llave de idempotencia de SAP: la version corregida es otro envio.
  add column if not exists version             int not null default 1,
  add column if not exists motivo_rechazo_id   int references public.crm_motivos(id),
  add column if not exists sap_estado          text not null default 'no_aplica',
  add column if not exists sap_referencia      text,
  add column if not exists sap_error           text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_pedidos_sap_estado_check') then
    alter table public.crm_pedidos add constraint crm_pedidos_sap_estado_check
      check (sap_estado in ('no_aplica','pendiente','enviado','error'));
  end if;
end $$;

comment on column public.crm_pedidos.sobrecupo_valor is
  'Cuanto excede el cupo del cliente si se aprueba. Se calcula al solicitar aprobacion y lo ven Cartera y Gerencia (PED-04).';
comment on column public.crm_pedidos.sap_estado is
  'Estado del envio a SAP, independiente del estado del pedido: para INDUPAN, SAP y LIPgo van en paralelo (PED-23).';

alter table public.crm_cotizaciones
  add column if not exists idempresa_despacho int;


-- ---------------------------------------------------------------------------
-- 4. Parametros del flujo
-- ---------------------------------------------------------------------------
insert into public.crm_parametros
  (idempresa, clave, valor, tipo, grupo, etiqueta, descripcion, editable)
select 1, v.clave, v.valor, 'string', v.grupo, v.etiqueta, v.descripcion, true
  from (values
    ('pedido.aprobacion_modo', 'secuencial', 'pedidos', 'Orden de las aprobaciones',
     'secuencial = primero Cartera y luego Gerencia. paralelo = cualquiera de las dos primero.'),
    ('credito.modo_cupo', 'sobrecupo', 'credito', 'Si el pedido excede el cupo',
     'sobrecupo = se permite enviarlo, marcado con el valor exacto, y deciden Cartera y Gerencia. bloquear = no se puede enviar.'),
    ('pedido.proyectar_al_aprobar', 'true', 'pedidos', 'Programar en LIPgo al aprobar',
     'true = al dar la última aprobación, el pedido queda en LIPgo listo para orden de cargue. false = hay que enviarlo a mano.')
  ) as v(clave, valor, grupo, etiqueta, descripcion)
 where not exists (
   select 1 from public.crm_parametros p where p.idempresa = 1 and p.clave = v.clave and p.vigente_hasta is null);

-- La primera firma se llama Cartera (decision del usuario). La clave y la
-- columna conservan el nombre historico; se cambia lo que se ve.
update public.crm_parametros
   set etiqueta = 'Clave de aprobación — Cartera',
       descripcion = 'La pide el sistema al dar la primera aprobación del pedido. Compartida por el área; quien aprueba queda igualmente identificado por su sesión.'
 where clave = 'pedido.clave_contabilidad' and vigente_hasta is null;
update public.crm_parametros
   set etiqueta = 'Clave de aprobación — Gerencia'
 where clave = 'pedido.clave_gerencia' and vigente_hasta is null;


-- ============================================================================
-- VERIFICACION
-- ============================================================================

-- 1. Centros de despacho (esperado: INDUPAN {1}, MOLINOS {3,4})
select codigo, idempresas_despacho from public.crm_owners order by id;

-- 2. Ningun pedido con estado viejo (esperado: 0)
select count(*) as pedidos_con_estado_viejo from public.crm_pedidos
 where estado in ('pendiente_autorizacion','autorizado_parcial','autorizado','enviado_lipgo');

-- 3. Parametros (esperado: 3)
select clave, valor from public.crm_parametros
 where clave in ('pedido.aprobacion_modo','credito.modo_cupo','pedido.proyectar_al_aprobar') and vigente_hasta is null;


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
-- Los estados nuevos no caben en la restriccion vieja: revertir exige primero
-- devolver cada fila a su estado anterior (el inverso de la seccion 2).
--   alter table public.crm_pedidos drop column if exists sap_error, ... (seccion 3)
--   alter table public.crm_owners drop column if exists idempresas_despacho;
-- ============================================================================
