-- ============================================================================
-- 209_crm_usuarios.sql
-- ----------------------------------------------------------------------------
-- USUARIOS PROPIOS DEL CRM, INDEPENDIENTES DE LIPgo.
--
-- EL PROBLEMA: el CRM usaba el mismo Supabase Auth de LIPgo y sus tablas de
-- usuarios (profiles, permisos_usuarios, perfil_acceso_*). Consecuencias:
--   - cualquier usuario de LIPgo entraba al CRM con su misma clave;
--   - un usuario creado desde el CRM quedaba creado en LIPgo, y como las
--     columnas de permiso de LIPgo nacen en `true`, entraba a LIPgo con casi
--     todo habilitado;
--   - eliminar un usuario desde el CRM lo borraba tambien de LIPgo.
--
-- LA CORRECCION: el CRM tiene su propia tabla de usuarios con su propia clave
-- (bcrypt) y sus propias sesiones. Ya no usa Supabase Auth para nada: la
-- sesion es una cookie httpOnly firmada por el CRM (variable CRM_AUTH_SECRET)
-- y cada peticion la contrasta con crm_sesiones. Un usuario de LIPgo no
-- existe para el CRM, y uno del CRM no existe para LIPgo.
--
-- MIGRACION: quienes hoy tienen algun permiso crm_* en `true` se copian a
-- crm_usuarios CON EL MISMO id (asi siguen valiendo los ids ya guardados en
-- pedidos, recaudos, vendedores y la bitacora), su correo, empresa, accesos y
-- permisos del CRM, y una CLAVE TEMPORAL NUEVA que deben cambiar al entrar.
-- La consulta del final devuelve la lista de claves temporales: COPIALA Y
-- ENTREGALA A CADA USUARIO por un canal privado. No se vuelve a mostrar (en la
-- base solo queda el hash); si se pierde, se genera otra desde
-- Configuracion > Gestion de Usuarios > Restablecer contraseña.
--
-- NO SE TOCA NADA DE LIPgo: solo se LEEN profiles, permisos_usuarios,
-- perfil_acceso_empresas, perfil_acceso_owners y auth.users para la copia.
--
-- Idempotente: volver a correrlo no duplica usuarios ni cambia claves de los
-- ya migrados (la lista final solo trae a los que se crearon en esa corrida).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- 1. Usuarios ------------------------------------------------------------------
create table if not exists public.crm_usuarios (
  id                  uuid primary key default gen_random_uuid(),
  usuario             text not null,
  email               text not null,
  nombre              text,
  password_hash       text not null,
  empresa_id          integer not null default 1,
  empresas_acceso     integer[] not null default '{}',
  owners_acceso       text[] not null default '{}',
  -- { "crm_dashboard": true, ... } — mismas claves que las columnas crm_* que
  -- antes vivian en permisos_usuarios. Lo que no esta, es false.
  permisos            jsonb not null default '{}'::jsonb,
  activo              boolean not null default true,
  debe_cambiar_clave  boolean not null default true,
  intentos_fallidos   integer not null default 0,
  bloqueado_hasta     timestamptz,
  ultimo_ingreso      timestamptz,
  clave_cambiada_en   timestamptz,
  origen              text not null default 'crm',
  creado_en           timestamptz not null default now(),
  creado_por          uuid,
  actualizado_en      timestamptz not null default now(),
  constraint crm_usuarios_origen_chk check (origen in ('crm', 'migrado_lipgo'))
);

create unique index if not exists crm_usuarios_email_uk   on public.crm_usuarios (lower(email));
create unique index if not exists crm_usuarios_usuario_uk on public.crm_usuarios (lower(usuario));

comment on table public.crm_usuarios is
  'Usuarios del CRM. Independientes de LIPgo (no usan auth.users ni profiles). Ver scripts/209.';

-- 2. Sesiones ------------------------------------------------------------------
-- La cookie lleva el id de la sesion firmado. Cerrar sesion, cambiar o
-- restablecer la clave, o desactivar al usuario, revoca la fila y la cookie
-- deja de servir aunque su firma siga siendo valida.
create table if not exists public.crm_sesiones (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.crm_usuarios (id) on delete cascade,
  creada_en    timestamptz not null default now(),
  expira_en    timestamptz not null,
  revocada_en  timestamptz,
  ip           text,
  user_agent   text
);

create index if not exists crm_sesiones_usuario_idx on public.crm_sesiones (usuario_id) where revocada_en is null;

-- 3. Cerrado al navegador (mismo criterio que scripts/204) ---------------------
alter table public.crm_usuarios enable row level security;
alter table public.crm_sesiones enable row level security;
revoke all on public.crm_usuarios from anon, authenticated;
revoke all on public.crm_sesiones from anon, authenticated;

-- 4. Migracion de quienes hoy usan el CRM --------------------------------------
with candidatos as materialized (
  select
    p.id,
    coalesce(nullif(trim(p.usuario), ''), split_part(u.email, '@', 1)) as usuario,
    lower(u.email)                                                    as email,
    coalesce(p.empresa_id, 1)                                         as empresa_id,
    (
      select coalesce(jsonb_object_agg(e.key, true), '{}'::jsonb)
        from jsonb_each(to_jsonb(pu)) e
       where e.key like 'crm\_%' and e.value = 'true'::jsonb
    )                                                                 as permisos,
    coalesce((select array_agg(distinct a.empresa_id) from public.perfil_acceso_empresas a where a.profile_id = p.id), '{}') as empresas_acceso,
    coalesce((select array_agg(distinct o.owner)      from public.perfil_acceso_owners  o where o.profile_id = p.id), '{}') as owners_acceso,
    -- 12 caracteres sin simbolos ambiguos para dictar o copiar sin errores.
    translate(substr(encode(extensions.gen_random_bytes(12), 'base64'), 1, 12), '+/=0OIl1', 'abcdefgh') as clave_temporal
  from public.profiles p
  join public.permisos_usuarios pu on pu.usuario_id = p.id
  join auth.users u on u.id = p.id
  where u.email is not null
    and exists (
      select 1 from jsonb_each(to_jsonb(pu)) e
       where e.key like 'crm\_%' and e.value = 'true'::jsonb
    )
),
creados as (
  insert into public.crm_usuarios (
    id, usuario, email, password_hash, empresa_id, empresas_acceso, owners_acceso,
    permisos, activo, debe_cambiar_clave, origen
  )
  select c.id, c.usuario, c.email,
         extensions.crypt(c.clave_temporal, extensions.gen_salt('bf', 10)),
         c.empresa_id, c.empresas_acceso, c.owners_acceso,
         c.permisos, true, true, 'migrado_lipgo'
    from candidatos c
  on conflict do nothing
  returning id
)
select c.usuario, c.email, c.clave_temporal, jsonb_object_keys_count.n as permisos_crm
  from candidatos c
  join creados k on k.id = c.id
  cross join lateral (select count(*) as n from jsonb_object_keys(c.permisos)) jsonb_object_keys_count
 order by c.usuario;

-- ----------------------------------------------------------------------------
-- VERIFICACION
--   select usuario, email, origen, activo, debe_cambiar_clave,
--          (select count(*) from jsonb_object_keys(permisos)) as permisos
--     from public.crm_usuarios order by usuario;
--
-- Si NADIE quedo con el permiso crm_usuarios (administrador), dale ese
-- permiso a quien vaya a administrar:
--   update public.crm_usuarios
--      set permisos = permisos || '{"crm_usuarios": true}'::jsonb
--    where lower(email) = lower('correo@del.admin');
--
-- ROLLBACK (deja al CRM sin usuarios: solo si se vuelve al login de LIPgo)
--   drop table if exists public.crm_sesiones;
--   drop table if exists public.crm_usuarios;
-- ============================================================================
