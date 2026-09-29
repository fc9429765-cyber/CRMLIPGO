-- ============================================================================
-- 203_crm_recaudos.sql
-- ----------------------------------------------------------------------------
-- Fase 3 del requerimiento INDUPAN: recaudos con comprobante y aprobacion
-- (REC-01..REC-24).
--
-- EL CAMBIO DE FONDO: hasta hoy un pago se aplicaba al instante, a una sola
-- factura, sin comprobante ni revision. Ahora:
--   1. el vendedor REPORTA un recaudo con su comprobante (queda pendiente);
--   2. el sistema PROPONE como repartirlo entre las facturas, la mas vencida
--      primero (REC-15); el vendedor lo ve, no lo puede cambiar;
--   3. Cartera lo APRUEBA (y puede ajustar el reparto, REC-18) o lo RECHAZA
--      con motivo; un rechazado se corrige y se reenvia;
--   4. solo al aprobar se mueven los saldos (REC-07).
--
-- La aprobacion es una funcion de la base (crm_aprobar_recaudo) y no codigo
-- TypeScript por lo mismo que la proyeccion a LIPgo: aplica a varias facturas,
-- registra descuentos y crea el saldo a favor, y todo eso tiene que ocurrir
-- entero o no ocurrir. Ademas BLOQUEA cada factura antes de tocarla: dos
-- recaudos aprobados a la vez sobre la misma factura no pueden dejarla con
-- saldo negativo.
--
-- Aditivo e idempotente. Requiere 201 y 202.
-- ============================================================================

create table if not exists public.crm_recaudos (
  id                     bigserial primary key,
  idempresa              int  not null default 1,
  numero                 text,
  cliente_id             int  not null,
  owner_id               int  references public.crm_owners(id),
  vendedor_id            int,

  -- Datos del pago (REC-08..REC-12). Sin numero de cuenta ni de documento:
  -- el requerimiento dice que no hacen falta (REC-11).
  fecha_documento        date not null,
  valor                  numeric(14,2) not null check (valor > 0),
  medio_pago_id          int references public.crm_medios_pago(id),
  banco_id               int references public.crm_bancos(id),
  cuenta_destino_id      int references public.crm_cuentas_destino(id),
  referencia             text,
  observaciones          text,

  -- Comprobante y lo que leyo la IA (REC-13, REC-20..REC-23)
  comprobante_id         bigint references public.crm_documentos(id),
  ocr                    jsonb,
  -- Diferencias entre lo digitado y lo leido. Si hay, Cartera lo ve marcado.
  ocr_alertas            text[] not null default '{}',

  estado                 text not null default 'pendiente_aprobacion'
                         check (estado in ('pendiente_aprobacion','aprobado','rechazado','anulado')),
  version                int  not null default 1,

  registrado_por         uuid,
  registrado_nombre      text,
  registrado_en          timestamptz not null default now(),
  aprobado_por           uuid,
  aprobado_nombre        text,
  aprobado_en            timestamptz,
  rechazado_por          uuid,
  rechazado_nombre       text,
  rechazado_en           timestamptz,
  motivo_rechazo_id      int references public.crm_motivos(id),
  motivo_rechazo         text,
  anulado_nombre         text,
  anulado_en             timestamptz,
  motivo_anulacion       text,

  total_aplicado         numeric(14,2) not null default 0,
  saldo_favor_valor      numeric(14,2) not null default 0,

  -- Integraciones: SAP solo para owners que facturan por SAP; LIPgo cuando
  -- tenga donde recibirlos (REC-02, REC-04).
  sap_estado             text not null default 'no_aplica'
                         check (sap_estado in ('no_aplica','pendiente','enviado','error')),
  sap_referencia         text,
  sap_error              text,

  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now()
);

create unique index if not exists ux_crm_recaudos_numero on public.crm_recaudos (idempresa, numero) where numero is not null;
create index if not exists ix_crm_recaudos_estado  on public.crm_recaudos (idempresa, estado, registrado_en desc);
create index if not exists ix_crm_recaudos_cliente on public.crm_recaudos (idempresa, cliente_id);
create index if not exists ix_crm_recaudos_vendedor on public.crm_recaudos (idempresa, vendedor_id);
-- Para detectar el mismo pago reportado dos veces (no unico: dos pagos reales
-- pueden coincidir, y eso lo decide Cartera).
create index if not exists ix_crm_recaudos_duplicado
  on public.crm_recaudos (idempresa, banco_id, fecha_documento, valor) where estado <> 'anulado';

create or replace function public.crm_recaudo_numero() returns trigger
language plpgsql as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.crm_siguiente_consecutivo(new.idempresa, 'recaudo', 'RC');
  end if;
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists trg_crm_recaudo_numero on public.crm_recaudos;
create trigger trg_crm_recaudo_numero before insert or update on public.crm_recaudos
  for each row execute function public.crm_recaudo_numero();


-- Reparto del recaudo entre facturas. Lo propone el sistema al registrar
-- (modo auto); Cartera puede reemplazarlo al aprobar (modo manual).
create table if not exists public.crm_recaudo_aplicaciones (
  id                bigserial primary key,
  idempresa         int  not null default 1,
  recaudo_id        bigint not null references public.crm_recaudos(id) on delete cascade,
  cuenta_cobrar_id  bigint not null references public.crm_cuentas_cobrar(id),
  valor_aplicado    numeric(14,2) not null check (valor_aplicado >= 0),
  valor_descuento   numeric(14,2) not null default 0 check (valor_descuento >= 0),
  saldo_anterior    numeric(14,2),
  saldo_posterior   numeric(14,2),
  orden             int  not null default 1,
  modo              text not null default 'auto' check (modo in ('auto','manual')),
  aplicado          boolean not null default false,
  unique (recaudo_id, cuenta_cobrar_id)
);

create index if not exists ix_crm_recaudo_aplic_cuenta on public.crm_recaudo_aplicaciones (cuenta_cobrar_id);


-- ---------------------------------------------------------------------------
-- APROBAR
-- ---------------------------------------------------------------------------
create or replace function public.crm_aprobar_recaudo(
  p_recaudo_id     bigint,
  p_usuario_id     uuid,
  p_usuario_nombre text,
  p_aplicaciones   jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec      record;
  v_ap       record;
  v_cta      record;
  v_medio    text;
  v_total    numeric(14,2) := 0;
  v_sobra    numeric(14,2);
begin
  select * into v_rec from public.crm_recaudos where id = p_recaudo_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'El recaudo no existe');
  end if;
  if v_rec.estado <> 'pendiente_aprobacion' then
    return jsonb_build_object('ok', false, 'error', format('El recaudo esta %s: no se puede aprobar', v_rec.estado));
  end if;

  -- Reparto ajustado por Cartera (REC-18): reemplaza la propuesta.
  if p_aplicaciones is not null then
    delete from public.crm_recaudo_aplicaciones where recaudo_id = p_recaudo_id;
    insert into public.crm_recaudo_aplicaciones
      (idempresa, recaudo_id, cuenta_cobrar_id, valor_aplicado, valor_descuento, orden, modo)
    select v_rec.idempresa, p_recaudo_id, (a->>'cuenta_cobrar_id')::bigint,
           coalesce((a->>'valor_aplicado')::numeric, 0), coalesce((a->>'valor_descuento')::numeric, 0),
           coalesce((a->>'orden')::int, ord::int), 'manual'
      from jsonb_array_elements(p_aplicaciones) with ordinality as t(a, ord);
  end if;

  select nombre into v_medio from public.crm_medios_pago where id = v_rec.medio_pago_id;

  for v_ap in
    select * from public.crm_recaudo_aplicaciones where recaudo_id = p_recaudo_id order by orden, id
  loop
    -- La factura se BLOQUEA antes de leer su saldo.
    select * into v_cta from public.crm_cuentas_cobrar where id = v_ap.cuenta_cobrar_id for update;

    if v_cta.cliente_id <> v_rec.cliente_id then
      raise exception 'La factura % no es de este cliente', coalesce(v_cta.numero_factura, v_cta.id::text);
    end if;
    if v_rec.owner_id is not null and v_cta.owner_id is not null and v_cta.owner_id <> v_rec.owner_id then
      raise exception 'La factura % es de otro owner: el recaudo solo paga facturas de su owner', coalesce(v_cta.numero_factura, v_cta.id::text);
    end if;
    if v_cta.estado not in ('pendiente','parcial') then
      raise exception 'La factura % ya esta %', coalesce(v_cta.numero_factura, v_cta.id::text), v_cta.estado;
    end if;
    if v_ap.valor_aplicado + v_ap.valor_descuento > v_cta.saldo then
      raise exception 'A la factura % se le aplica % pero su saldo es %',
        coalesce(v_cta.numero_factura, v_cta.id::text), v_ap.valor_aplicado + v_ap.valor_descuento, v_cta.saldo;
    end if;

    if v_ap.valor_aplicado > 0 then
      insert into public.crm_pagos
        (idempresa, cuenta_cobrar_id, fecha_pago, valor, medio_pago, referencia, observacion,
         registrado_por, tipo, recaudo_id)
      values
        (v_rec.idempresa, v_cta.id, v_rec.fecha_documento, v_ap.valor_aplicado, v_medio, v_rec.referencia,
         format('Recaudo %s', v_rec.numero), p_usuario_nombre, 'recaudo', p_recaudo_id);
    end if;
    if v_ap.valor_descuento > 0 then
      insert into public.crm_pagos
        (idempresa, cuenta_cobrar_id, fecha_pago, valor, medio_pago, referencia, observacion,
         registrado_por, tipo, recaudo_id)
      values
        (v_rec.idempresa, v_cta.id, v_rec.fecha_documento, v_ap.valor_descuento, 'descuento', v_rec.referencia,
         format('Descuento sobre recaudo %s', v_rec.numero), p_usuario_nombre, 'descuento', p_recaudo_id);
    end if;

    update public.crm_recaudo_aplicaciones
       set saldo_anterior  = v_cta.saldo,
           saldo_posterior = v_cta.saldo - v_ap.valor_aplicado - v_ap.valor_descuento,
           aplicado        = true
     where id = v_ap.id;

    v_total := v_total + v_ap.valor_aplicado;
  end loop;

  if v_total > v_rec.valor then
    raise exception 'Se aplican % pero el recaudo es de %', v_total, v_rec.valor;
  end if;

  -- Lo que sobra queda a favor del cliente (REC-17).
  v_sobra := v_rec.valor - v_total;
  if v_sobra > 0 then
    insert into public.crm_saldos_favor (idempresa, cliente_id, owner_id, recaudo_id, valor)
    values (v_rec.idempresa, v_rec.cliente_id, v_rec.owner_id, p_recaudo_id, v_sobra);
  end if;

  update public.crm_recaudos
     set estado = 'aprobado', aprobado_por = p_usuario_id, aprobado_nombre = p_usuario_nombre,
         aprobado_en = now(), total_aplicado = v_total, saldo_favor_valor = v_sobra
   where id = p_recaudo_id;

  return jsonb_build_object('ok', true, 'total_aplicado', v_total, 'saldo_favor', v_sobra, 'numero', v_rec.numero);
end $$;

comment on function public.crm_aprobar_recaudo(bigint, uuid, text, jsonb) is
  'Aprueba un recaudo: aplica a las facturas (bloqueandolas), registra descuentos y crea el saldo a favor, en una sola transaccion. Cualquier inconsistencia aborta todo.';


-- ---------------------------------------------------------------------------
-- ANULAR un recaudo ya aprobado: sus pagos se marcan anulados (el trigger
-- devuelve el saldo a las facturas) y su saldo a favor se anula. No se borra
-- nada. Si parte del saldo a favor ya se uso, no se deja anular: primero hay
-- que deshacer lo que se pago con el.
-- ---------------------------------------------------------------------------
create or replace function public.crm_anular_recaudo(
  p_recaudo_id     bigint,
  p_usuario_nombre text,
  p_motivo         text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
begin
  select * into v_rec from public.crm_recaudos where id = p_recaudo_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'El recaudo no existe'); end if;
  if v_rec.estado = 'anulado' then return jsonb_build_object('ok', false, 'error', 'Ya esta anulado'); end if;
  if coalesce(trim(p_motivo), '') = '' then return jsonb_build_object('ok', false, 'error', 'Indica el motivo'); end if;

  if exists (select 1 from public.crm_saldos_favor where recaudo_id = p_recaudo_id and valor_aplicado > 0 and anulado_en is null) then
    return jsonb_build_object('ok', false, 'error', 'Parte de su saldo a favor ya se aplicó: no se puede anular');
  end if;

  update public.crm_pagos
     set anulado_en = now(), anulado_por = p_usuario_nombre, motivo_anulacion = p_motivo
   where recaudo_id = p_recaudo_id and anulado_en is null;

  update public.crm_saldos_favor set anulado_en = now() where recaudo_id = p_recaudo_id and anulado_en is null;

  update public.crm_recaudos
     set estado = 'anulado', anulado_nombre = p_usuario_nombre, anulado_en = now(), motivo_anulacion = p_motivo
   where id = p_recaudo_id;

  return jsonb_build_object('ok', true);
end $$;


-- ============================================================================
-- VERIFICACION
-- ============================================================================
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('crm_recaudos','crm_recaudo_aplicaciones');
select routine_name from information_schema.routines
 where routine_schema = 'public' and routine_name in ('crm_aprobar_recaudo','crm_anular_recaudo');
-- Un recaudo inexistente responde con error controlado
select public.crm_aprobar_recaudo(-1, null, 'verificacion', null) as respuesta_esperada_error;


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
-- Anular los recaudos aprobados antes (con crm_anular_recaudo) para devolver
-- los saldos; luego:
--   drop function if exists public.crm_anular_recaudo(bigint, text, text);
--   drop function if exists public.crm_aprobar_recaudo(bigint, uuid, text, jsonb);
--   drop table if exists public.crm_recaudo_aplicaciones;
--   drop table if exists public.crm_recaudos;
-- ============================================================================
