-- ============================================================================
-- 206_crm_prospectos_aprobacion.sql
-- ----------------------------------------------------------------------------
-- Fase 5 del requerimiento INDUPAN: de prospecto a cliente (PRO-01..PRO-05).
--
-- FLUJO
--   1. El vendedor arma el expediente del prospecto: datos y documentos
--      (RUT, camara de comercio, cedula del representante…; la lista es el
--      maestro crm_tipos_documento). Puede compartir un ENLACE para que el
--      propio prospecto suba sus documentos (PRO-05, opcion por defecto).
--   2. Lo envia a Cartera con el cupo y el plazo que propone.
--   3. Cartera aprueba (fijando cupo, plazo, lista y vendedor) o rechaza con
--      motivo. Un rechazado se corrige y se reenvia.
--   4. Al aprobar, crm_convertir_prospecto crea el cliente y su sucursal
--      principal EN LIPGO (misma base, INT-11), pasa los documentos a la
--      carpeta del cliente (PRO-03) y cierra el prospecto como ganado.
--
-- POR QUE UNA FUNCION DE LA BASE: crear el cliente, su sucursal, mover los
-- documentos y marcar el prospecto tiene que ocurrir entero o no ocurrir. Un
-- cliente creado sin su sucursal no puede recibir pedidos; un prospecto que
-- queda "pendiente" con el cliente ya creado se aprobaria dos veces.
--
-- NIT DUPLICADO: en LIPgo el documento se guarda SIN digito de verificacion y
-- ya hay NITs repetidos. Si el NIT existe, la funcion NO crea otro cliente:
-- responde con los clientes encontrados y Cartera decide vincular el
-- prospecto a uno de ellos.
--
-- ENLACE PARA EL PROSPECTO: se guarda solo el HASH del token. Quien lea la
-- base no puede reconstruir el enlace; el enlace caduca y se revoca al
-- aprobar.
--
-- Aditivo e idempotente. Requiere 182 (prospectos), 195 (motivos) y 201
-- (documentos). Aplica la regla del 204: la funcion nueva no se ejecuta con
-- la clave anonima.
-- ============================================================================

alter table public.crm_prospectos
  add column if not exists estado_aprobacion       text not null default 'borrador',
  add column if not exists version                 int  not null default 1,
  add column if not exists cupo_solicitado         numeric(14,2),
  add column if not exists dias_credito_solicitado int,
  add column if not exists solicitado_por          uuid,
  add column if not exists solicitado_nombre       text,
  add column if not exists solicitado_en           timestamptz,
  add column if not exists solicitud_nota          text,
  add column if not exists aprobado_por            uuid,
  add column if not exists aprobado_nombre         text,
  add column if not exists aprobado_en             timestamptz,
  add column if not exists aprobacion_nota         text,
  add column if not exists rechazado_por           uuid,
  add column if not exists rechazado_nombre        text,
  add column if not exists rechazado_en            timestamptz,
  add column if not exists motivo_rechazo_id       int references public.crm_motivos(id),
  add column if not exists motivo_rechazo          text,
  add column if not exists sucursal_id             int,
  add column if not exists sap_estado              text not null default 'no_aplica',
  add column if not exists sap_referencia          text,
  add column if not exists sap_error               text,
  add column if not exists enlace_hash             text,
  add column if not exists enlace_vence            timestamptz,
  add column if not exists enlace_creado_nombre    text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_prospectos_estado_aprobacion_check') then
    alter table public.crm_prospectos add constraint crm_prospectos_estado_aprobacion_check
      check (estado_aprobacion in ('borrador','pendiente_aprobacion','aprobado','rechazado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_prospectos_sap_estado_check') then
    alter table public.crm_prospectos add constraint crm_prospectos_sap_estado_check
      check (sap_estado in ('no_aplica','pendiente','enviado','error'));
  end if;
end $$;

create unique index if not exists ux_crm_prospectos_enlace
  on public.crm_prospectos (enlace_hash) where enlace_hash is not null;
create index if not exists ix_crm_prospectos_aprobacion
  on public.crm_prospectos (idempresa, estado_aprobacion);

-- Los documentos del prospecto pasan a la carpeta del cliente; se conserva de
-- que prospecto vinieron.
alter table public.crm_documentos add column if not exists prospecto_id bigint;
create index if not exists ix_crm_documentos_prospecto on public.crm_documentos (prospecto_id) where prospecto_id is not null;


-- ---------------------------------------------------------------------------
-- NIT sin digito de verificacion, como lo guarda LIPgo.
--   "900.123.456-7" → 900123456 · "9001234567" → 900123456 · "80740512" → 80740512
-- ---------------------------------------------------------------------------
create or replace function public.crm_nit_sin_dv(p_texto text) returns bigint
language sql immutable
as $$
  select case
    when coalesce(p_texto, '') = '' then null
    when position('-' in p_texto) > 0
      then nullif(regexp_replace(split_part(p_texto, '-', 1), '\D', '', 'g'), '')::bigint
    when length(regexp_replace(p_texto, '\D', '', 'g')) = 10 and regexp_replace(p_texto, '\D', '', 'g') ~ '^[89]'
      then left(regexp_replace(p_texto, '\D', '', 'g'), 9)::bigint
    else nullif(regexp_replace(p_texto, '\D', '', 'g'), '')::bigint
  end
$$;


-- ---------------------------------------------------------------------------
-- Aprobar un prospecto: crea (o vincula) el cliente en LIPgo.
-- ---------------------------------------------------------------------------
create or replace function public.crm_convertir_prospecto(
  p_prospecto_id       bigint,
  p_usuario_id         uuid,
  p_usuario_nombre     text,
  p_cupo               numeric,
  p_dias               int,
  p_lista_precio_id    int,
  p_vendedor_id        int,
  p_vincular_cliente_id int default null,
  p_nota               text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p        record;
  v_nit      bigint;
  v_dups     jsonb;
  v_cliente  bigint;
  v_bodega   bigint;
  v_ganada   int;
  v_creado   boolean := false;
  v_intento  int;
begin
  select * into v_p from public.crm_prospectos where id = p_prospecto_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'El prospecto no existe'); end if;
  if v_p.estado_aprobacion <> 'pendiente_aprobacion' then
    return jsonb_build_object('ok', false, 'error', format('El prospecto esta %s: no se puede aprobar', v_p.estado_aprobacion));
  end if;
  if coalesce(p_cupo, 0) < 0 or coalesce(p_dias, 0) < 0 then
    return jsonb_build_object('ok', false, 'error', 'Cupo y plazo no pueden ser negativos');
  end if;

  v_nit := public.crm_nit_sin_dv(v_p.documento);

  if p_vincular_cliente_id is not null then
    -- Vincular a un cliente que ya existe en LIPgo.
    select id into v_cliente from public.clientes where id = p_vincular_cliente_id and id_empresa = v_p.idempresa;
    if v_cliente is null then return jsonb_build_object('ok', false, 'error', 'El cliente a vincular no existe'); end if;
    update public.clientes
       set cupo_credito = coalesce(p_cupo, cupo_credito),
           dias_credito = coalesce(p_dias, dias_credito),
           lista_precio_id = coalesce(p_lista_precio_id, lista_precio_id),
           vendedor_asignado = coalesce(vendedor_asignado, p_vendedor_id)
     where id = v_cliente;
  else
    if v_nit is null then return jsonb_build_object('ok', false, 'error', 'El prospecto no tiene NIT o documento'); end if;
    select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre)) into v_dups
      from public.clientes where id_empresa = v_p.idempresa and documento = v_nit;
    if v_dups is not null then
      return jsonb_build_object('ok', false, 'error', 'nit_existe', 'clientes', v_dups);
    end if;

    -- LIPgo inserta ids explicitos: se toma el siguiente y, si justo en ese
    -- instante LIPgo uso el mismo, se reintenta una vez.
    for v_intento in 1..2 loop
      begin
        v_cliente := public.crm_siguiente_id('clientes', 'id');
        insert into public.clientes
          (id, id_empresa, documento, nombre, correo, personacontacto, celular, activo, correofact,
           cupo_credito, dias_credito, lista_precio_id, latitud, longitud, bloqueado_cartera,
           vendedor_asignado, observaciones_crm)
        values
          (v_cliente, v_p.idempresa, v_nit, upper(trim(v_p.razon_social)), v_p.contacto_email, v_p.contacto_nombre,
           coalesce(v_p.contacto_celular, v_p.contacto_telefono), 'true', v_p.contacto_email,
           coalesce(p_cupo, 0), coalesce(p_dias, 0), p_lista_precio_id, v_p.latitud, v_p.longitud, false,
           coalesce(p_vendedor_id, v_p.vendedor_id), format('Creado desde el prospecto %s', coalesce(v_p.codigo, v_p.id::text)));
        exit;
      exception when unique_violation then
        if v_intento = 2 then raise; end if;
      end;
    end loop;

    for v_intento in 1..2 loop
      begin
        v_bodega := public.crm_siguiente_id('bodegas', 'idbodega');
        insert into public.bodegas
          (idbodega, idempresa, clienteid, nombrebodega, direccion, ciudad, departamento, activo, latitud, longitud)
        values
          (v_bodega, v_p.idempresa, v_cliente, upper(coalesce(nullif(trim(v_p.nombre_comercial), ''), trim(v_p.razon_social))),
           v_p.direccion, v_p.ciudad, v_p.departamento, 'true', v_p.latitud, v_p.longitud);
        exit;
      exception when unique_violation then
        if v_intento = 2 then raise; end if;
      end;
    end loop;
    v_creado := true;
  end if;

  -- Carpeta del cliente (PRO-03)
  update public.crm_documentos
     set entidad = 'cliente', entidad_id = v_cliente, prospecto_id = p_prospecto_id
   where idempresa = v_p.idempresa and entidad = 'prospecto' and entidad_id = p_prospecto_id;

  select id into v_ganada from public.crm_etapas
   where idempresa = v_p.idempresa and es_ganada and activo order by orden limit 1;

  update public.crm_prospectos
     set estado_aprobacion = 'aprobado', aprobado_por = p_usuario_id, aprobado_nombre = p_usuario_nombre,
         aprobado_en = now(), aprobacion_nota = p_nota, cliente_id = v_cliente, convertido_en = now(),
         sucursal_id = v_bodega, etapa_id = coalesce(v_ganada, etapa_id), fecha_cierre = current_date,
         enlace_hash = null, enlace_vence = null
   where id = p_prospecto_id;

  return jsonb_build_object('ok', true, 'cliente_id', v_cliente, 'sucursal_id', v_bodega, 'creado', v_creado);
end $$;

comment on function public.crm_convertir_prospecto(bigint, uuid, text, numeric, int, int, int, int, text) is
  'Aprueba un prospecto: crea el cliente y su sucursal en LIPgo (o lo vincula a uno existente), pasa sus documentos a la carpeta del cliente y lo cierra como ganado. Todo o nada.';

-- Regla del 204: solo el servidor
revoke execute on function public.crm_convertir_prospecto(bigint, uuid, text, numeric, int, int, int, int, text) from public, anon, authenticated;
grant  execute on function public.crm_convertir_prospecto(bigint, uuid, text, numeric, int, int, int, int, text) to service_role;
revoke execute on function public.crm_nit_sin_dv(text) from public, anon, authenticated;
grant  execute on function public.crm_nit_sin_dv(text) to service_role;


-- Parametros
insert into public.crm_parametros
  (idempresa, clave, valor, tipo, grupo, etiqueta, descripcion, editable)
select 1, v.clave, v.valor, v.tipo, v.grupo, v.etiqueta, v.descripcion, true
  from (values
    ('prospecto.exigir_documentos', 'true', 'boolean', 'prospectos', 'Exigir documentos obligatorios',
     'true = no se puede enviar un prospecto a Cartera sin los documentos marcados como obligatorios en Maestros → Tipos de documento.'),
    ('prospecto.enlace_dias', '7', 'number', 'prospectos', 'Validez del enlace para el prospecto (días)',
     'El vendedor puede compartir un enlace para que el prospecto suba sus documentos. Pasado este plazo deja de funcionar.')
  ) as v(clave, valor, tipo, grupo, etiqueta, descripcion)
 where not exists (
   select 1 from public.crm_parametros p where p.idempresa = 1 and p.clave = v.clave and p.vigente_hasta is null);


-- ============================================================================
-- VERIFICACION
-- ============================================================================
select count(*) as columnas_nuevas from information_schema.columns
 where table_schema = 'public' and table_name = 'crm_prospectos'
   and column_name in ('estado_aprobacion','cupo_solicitado','enlace_hash','sucursal_id');     -- 4
select public.crm_nit_sin_dv('900.123.456-7') as a, public.crm_nit_sin_dv('9001234567') as b,
       public.crm_nit_sin_dv('80740512') as c;                                                -- 900123456, 900123456, 80740512
select public.crm_convertir_prospecto(-1, null, 'verificacion', 0, 0, null, null) as respuesta_esperada_error;
-- Debe devolver 0 filas: funciones crm_* abiertas a anon
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'crm\_%' and has_function_privilege('anon', p.oid, 'execute');


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
--   drop function if exists public.crm_convertir_prospecto(bigint, uuid, text, numeric, int, int, int, int, text);
--   drop function if exists public.crm_nit_sin_dv(text);
--   delete from public.crm_parametros where clave in ('prospecto.exigir_documentos','prospecto.enlace_dias');
--   alter table public.crm_documentos drop column if exists prospecto_id;
--   (las columnas de crm_prospectos pueden quedarse: son nullable o con default)
-- ============================================================================
