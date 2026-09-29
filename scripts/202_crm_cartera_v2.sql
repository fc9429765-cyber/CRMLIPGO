-- ============================================================================
-- 202_crm_cartera_v2.sql
-- ----------------------------------------------------------------------------
-- Fase 3 del requerimiento INDUPAN: la cartera preparada para recaudos.
--
-- 1. `crm_pagos` sigue siendo la capa que MUEVE el saldo (el trigger del 185
--    suma los pagos de cada factura). Lo que cambia:
--      - cada pago dice que es: recaudo, descuento (REC-19), nota credito,
--        ajuste, o legacy (lo anterior a este script);
--      - cada pago sabe de que recaudo viene (trazabilidad, CAR-05);
--      - ANULAR YA NO BORRA. Antes, anular un pago era un DELETE: el dinero
--        "desaparecia" sin rastro de quien, cuando ni por que. Ahora se marca
--        anulado_en y el trigger deja de sumarlo.
--
-- 2. `crm_saldos_favor`: lo que el cliente pago de mas (REC-17). Queda a su
--    favor, visible en su cuenta, hasta que se aplique.
--
-- Aditivo e idempotente.
-- ============================================================================

alter table public.crm_pagos
  add column if not exists tipo             text not null default 'legacy',
  add column if not exists recaudo_id       bigint,
  add column if not exists anulado_en       timestamptz,
  add column if not exists anulado_por      text,
  add column if not exists motivo_anulacion text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_pagos_tipo_check') then
    alter table public.crm_pagos add constraint crm_pagos_tipo_check
      check (tipo in ('recaudo','descuento','nota_credito','ajuste','legacy'));
  end if;
end $$;

create index if not exists ix_crm_pagos_recaudo on public.crm_pagos (recaudo_id) where recaudo_id is not null;

comment on column public.crm_pagos.anulado_en is
  'Un pago anulado no se borra: se marca aqui y deja de sumar al saldo. Asi queda quien lo anulo, cuando y por que.';


-- El trigger suma solo lo no anulado.
create or replace function public.crm_recalcular_cxc() returns trigger
language plpgsql
as $$
declare
  v_cuenta bigint;
  v_total  numeric(14,2);
  v_orig   numeric(14,2);
begin
  v_cuenta := coalesce(new.cuenta_cobrar_id, old.cuenta_cobrar_id);

  select coalesce(sum(valor), 0) into v_total
    from public.crm_pagos
   where cuenta_cobrar_id = v_cuenta and anulado_en is null;

  select valor_original into v_orig
    from public.crm_cuentas_cobrar where id = v_cuenta;

  update public.crm_cuentas_cobrar
     set valor_abonado  = v_total,
         estado = case
                    when estado in ('anulada','incobrable') then estado  -- no resucitar
                    when v_total >= v_orig then 'pagada'
                    when v_total > 0       then 'parcial'
                    else 'pendiente'
                  end,
         actualizado_en = now()
   where id = v_cuenta;

  return null;
end $$;


create table if not exists public.crm_saldos_favor (
  id              bigserial primary key,
  idempresa       int  not null default 1,
  cliente_id      int  not null,
  owner_id        int  references public.crm_owners(id),
  recaudo_id      bigint,
  valor           numeric(14,2) not null check (valor > 0),
  valor_aplicado  numeric(14,2) not null default 0 check (valor_aplicado >= 0),
  saldo           numeric(14,2) generated always as (valor - valor_aplicado) stored,
  anulado_en      timestamptz,
  creado_en       timestamptz not null default now(),
  check (valor_aplicado <= valor)
);

create index if not exists ix_crm_saldos_favor_cliente
  on public.crm_saldos_favor (idempresa, cliente_id) where anulado_en is null;

comment on table public.crm_saldos_favor is
  'Lo que un cliente pago de mas (REC-17). Queda a su favor, visible en su cuenta, hasta que se aplique a una factura nueva.';


-- ============================================================================
-- VERIFICACION
-- ============================================================================

-- 1. Columnas nuevas de pagos (esperado: 5)
select count(*) as columnas_pagos from information_schema.columns
 where table_schema = 'public' and table_name = 'crm_pagos'
   and column_name in ('tipo','recaudo_id','anulado_en','anulado_por','motivo_anulacion');

-- 2. El trigger ignora pagos anulados (esperado: true)
select position('anulado_en is null' in pg_get_functiondef('public.crm_recalcular_cxc()'::regprocedure)) > 0
       as ignora_anulados;


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
--   drop table if exists public.crm_saldos_favor;
--   (volver a correr la funcion del script 185)
--   alter table public.crm_pagos drop column if exists tipo, drop column if exists recaudo_id,
--     drop column if exists anulado_en, drop column if exists anulado_por, drop column if exists motivo_anulacion;
-- ============================================================================
