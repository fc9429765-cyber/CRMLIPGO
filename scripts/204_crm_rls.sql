-- ============================================================================
-- 204_crm_rls.sql
-- ----------------------------------------------------------------------------
-- CIERRE DE ACCESO DIRECTO A LAS TABLAS Y FUNCIONES DEL CRM.
--
-- EL PROBLEMA: la clave anonima de Supabase (NEXT_PUBLIC_SUPABASE_ANON_KEY) va
-- en el navegador de cualquiera que abra la pagina de login. Con ella, SIN
-- iniciar sesion, hoy se puede:
--   - leer todas las tablas crm_* (pedidos, cartera, y crm_parametros con las
--     claves de autorizacion en texto plano), y probablemente escribirlas;
--   - ejecutar las funciones crm_*, incluidas las "security definer" que
--     proyectan pedidos a LIPgo (crm_proyectar_pedido_lipgo) y aprueban o
--     anulan recaudos (crm_aprobar_recaudo, crm_anular_recaudo).
-- Las tablas se crearon sin RLS y Supabase da permisos a anon/authenticated
-- por defecto sobre todo lo que se crea en `public`.
--
-- LA CORRECCION:
--   1. RLS activado en todas las tablas crm_*, SIN politicas. Sin politicas,
--      anon y authenticated no ven ni tocan ninguna fila. El CRM no se entera:
--      todo su acceso a datos va por el servidor con la clave service_role, que
--      salta RLS. Verificado en el codigo: ningun componente del navegador
--      consulta tablas crm_* ni llama funciones crm_*.
--   2. Las vistas crm_* se revocan a anon/authenticated (una vista corre con
--      los permisos de su dueño y saltaria el RLS de las tablas).
--   3. EXECUTE de las funciones crm_* se revoca a public/anon/authenticated y
--      se deja solo a service_role. Los triggers no se afectan: PostgreSQL no
--      revisa EXECUTE al disparar un trigger, y todos los triggers del CRM
--      estan sobre tablas crm_*.
--
-- NO SE TOCAN tablas de LIPgo (permisos_usuarios, profiles, whatsapp_mensajes
-- y demas tambien son legibles con la clave anonima, pero LIPgo podria leerlas
-- desde el navegador; cambiarlas es decision aparte y se prueba en LIPgo).
--
-- DESPUES DE CORRER ESTE SCRIPT: cambiar las dos claves de autorizacion
-- (Cartera y Gerencia) desde Parametros, porque las actuales estuvieron
-- legibles.
--
-- TODO SCRIPT FUTURO que cree una tabla crm_* debe terminar con
--   alter table public.crm_xxx enable row level security;
-- (o volver a correr este, que es idempotente).
-- ============================================================================

-- 1. RLS en todas las tablas crm_*
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'crm\_%'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- 2. Vistas crm_*: fuera del alcance de anon/authenticated
do $$
declare v record;
begin
  for v in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm') and c.relname like 'crm\_%'
  loop
    execute format('revoke all on public.%I from anon, authenticated', v.relname);
    execute format('grant select on public.%I to service_role', v.relname);
  end loop;
end $$;

-- 3. Funciones crm_*: solo service_role
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'crm\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
  end loop;
end $$;


-- ============================================================================
-- VERIFICACION
-- ============================================================================
-- a) Debe devolver 0 filas: tablas crm_* sin RLS
select c.relname as tabla_sin_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'crm\_%'
   and not c.relrowsecurity;

-- b) Debe devolver 0 filas: funciones crm_* que anon puede ejecutar
select p.oid::regprocedure as funcion_abierta_a_anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'crm\_%'
   and has_function_privilege('anon', p.oid, 'execute');

-- c) Debe devolver 0 filas: vistas crm_* legibles por anon
select c.relname as vista_abierta_a_anon
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('v', 'm') and c.relname like 'crm\_%'
   and has_table_privilege('anon', c.oid, 'select');

-- d) Cuantas tablas quedaron protegidas (informativo)
select count(*) as tablas_crm_con_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'crm\_%'
   and c.relrowsecurity;


-- ============================================================================
-- REVERSION (comentada) — reabre el acceso anonimo; no se recomienda.
-- ----------------------------------------------------------------------------
--   alter table public.crm_xxx disable row level security;   -- por tabla
--   grant execute on function public.crm_xxx(...) to anon, authenticated;
-- ============================================================================
