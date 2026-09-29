-- ============================================================================
-- seed/demo_crm.sql — DATOS DE DEMOSTRACION (RNF-08). EJECUCION MANUAL.
-- ----------------------------------------------------------------------------
-- ¡OJO! Esta base la comparte LIPgo. Los clientes y sucursales de demo
-- APARECEN EN LIPGO para sus usuarios. Lo ideal es correrlo en una copia o
-- rama de la base (Supabase Branching), no en produccion. Si se corre en
-- produccion, que sea para una demo puntual y luego limpiar con
-- seed/demo_crm_limpiar.sql.
--
-- CANDADO: no hace nada si no se habilita en la MISMA ejecucion:
--     set crm.demo = 'si';
--     -- y a continuacion el resto de este archivo
--
-- QUE CREA (todo marcado DEMO, idempotente: correrlo dos veces no duplica):
--   - 2 clientes con su sucursal: "DEMO PANADERIA ANDINA" (solo INDUPAN) y
--     "DEMO PASTELERIA COSTA" (INDUPAN y Molinos, para ver la separacion por
--     owner en cartera y en el estado de cuenta).
--   - 7 facturas con vencimientos en todos los rangos (al dia, 1–30, 31–60,
--     61–90, >90). Dos de $10.000.000 vencidas del mismo cliente: con un pago
--     de $15.000.000 se ve el criterio 5 (10/5 a la mas vencida).
--   - 2 cuentas destino (una por owner) en Bancolombia.
--   - 1 prospecto en preparacion.
-- NO crea productos: se usan los que ya existen de ambos owners.
-- ============================================================================

do $$
declare
  v_indupan int;
  v_molinos int;
  v_banco   int;
  v_etapa   int;
  v_a       bigint;
  v_b       bigint;
  v_bod     bigint;
  hoy       date := (now() at time zone 'America/Bogota')::date;
begin
  if coalesce(current_setting('crm.demo', true), '') <> 'si' then
    raise exception 'Candado: ejecuta primero  set crm.demo = ''si'';  en la misma ejecucion. Lee el encabezado: los datos de demo se ven en LIPgo.';
  end if;

  select id into v_indupan from public.crm_owners where idempresa = 1 and codigo = 'INDUPAN';
  select id into v_molinos from public.crm_owners where idempresa = 1 and codigo = 'MOLINOS';
  select id into v_banco from public.crm_bancos where idempresa = 1 and nombre ilike '%bancolombia%' order by id limit 1;
  if v_banco is null then select id into v_banco from public.crm_bancos where idempresa = 1 order by id limit 1; end if;
  select id into v_etapa from public.crm_etapas where idempresa = 1 and activo order by orden limit 1;

  -- ------------------------------------------------------------- clientes
  select id into v_a from public.clientes where id_empresa = 1 and nombre = 'DEMO PANADERIA ANDINA';
  if v_a is null then
    v_a := public.crm_siguiente_id('clientes', 'id');
    insert into public.clientes (id, id_empresa, documento, nombre, correo, personacontacto, celular, activo,
                                 cupo_credito, dias_credito, bloqueado_cartera, observaciones_crm)
    values (v_a, 1, 900000901, 'DEMO PANADERIA ANDINA', 'demo.andina@example.com', 'Laura Demo', '3000000901', 'true',
            30000000, 30, false, 'DEMO: datos de demostracion (seed/demo_crm.sql)');
    v_bod := public.crm_siguiente_id('bodegas', 'idbodega');
    insert into public.bodegas (idbodega, idempresa, clienteid, nombrebodega, direccion, ciudad, departamento, activo)
    values (v_bod, 1, v_a, 'DEMO PANADERIA ANDINA - PRINCIPAL', 'Calle 1 # 1-01 (DEMO)', 'Bogotá', 'Cundinamarca', 'true');
  end if;

  select id into v_b from public.clientes where id_empresa = 1 and nombre = 'DEMO PASTELERIA COSTA';
  if v_b is null then
    v_b := public.crm_siguiente_id('clientes', 'id');
    insert into public.clientes (id, id_empresa, documento, nombre, correo, personacontacto, celular, activo,
                                 cupo_credito, dias_credito, bloqueado_cartera, observaciones_crm)
    values (v_b, 1, 900000902, 'DEMO PASTELERIA COSTA', 'demo.costa@example.com', 'Andrés Demo', '3000000902', 'true',
            8000000, 45, false, 'DEMO: datos de demostracion (seed/demo_crm.sql)');
    v_bod := public.crm_siguiente_id('bodegas', 'idbodega');
    insert into public.bodegas (idbodega, idempresa, clienteid, nombrebodega, direccion, ciudad, departamento, activo)
    values (v_bod, 1, v_b, 'DEMO PASTELERIA COSTA - PRINCIPAL', 'Carrera 2 # 2-02 (DEMO)', 'Barranquilla', 'Atlántico', 'true');
  end if;

  -- ------------------------------------------------------------- facturas
  insert into public.crm_cuentas_cobrar
    (idempresa, cliente_id, owner_id, numero_factura, fecha_factura, fecha_vencimiento, valor_original,
     tipo_documento, origen, estado, creado_por, observaciones)
  select 1, f.cliente, f.owner, f.numero, f.venc - f.plazo, f.venc, f.valor, 'factura', 'manual', 'pendiente', 'DEMO',
         'DEMO: datos de demostracion'
    from (values
      -- Andina (INDUPAN): una por rango, y dos de 10M vencidas para el criterio 5
      (v_a, v_indupan, 'DEMO-FE-0001', hoy + 20,  30,  3500000::numeric),
      (v_a, v_indupan, 'DEMO-FE-0002', hoy - 10,  30, 10000000::numeric),
      (v_a, v_indupan, 'DEMO-FE-0003', hoy - 40,  30, 10000000::numeric),
      (v_a, v_indupan, 'DEMO-FE-0004', hoy - 95,  30,  2000000::numeric),
      -- Costa: INDUPAN y Molinos, cada una por su lado
      (v_b, v_indupan, 'DEMO-FE-0005', hoy - 70,  45,  1800000::numeric),
      (v_b, v_molinos, 'DEMO-FM-0001', hoy + 10,  45,  4200000::numeric),
      (v_b, v_molinos, 'DEMO-FM-0002', hoy - 20,  45,  2600000::numeric)
    ) as f(cliente, owner, numero, venc, plazo, valor)
   where not exists (select 1 from public.crm_cuentas_cobrar c where c.idempresa = 1 and c.numero_factura = f.numero);

  -- ------------------------------------------------------- cuentas destino
  insert into public.crm_cuentas_destino (idempresa, alias, banco_id, owner_id, tipo, activo)
  select 1, c.alias, v_banco, c.owner, 'corriente', true
    from (values ('DEMO Bancolombia INDUPAN', v_indupan), ('DEMO Bancolombia Molinos', v_molinos)) as c(alias, owner)
   where v_banco is not null
     and not exists (select 1 from public.crm_cuentas_destino d where d.idempresa = 1 and d.alias = c.alias);

  -- ------------------------------------------------------------- prospecto
  if v_etapa is not null and not exists (select 1 from public.crm_prospectos where idempresa = 1 and razon_social = 'DEMO HORNO DEL VALLE SAS') then
    insert into public.crm_prospectos (idempresa, razon_social, documento, contacto_nombre, contacto_celular,
                                       direccion, ciudad, departamento, etapa_id, valor_estimado, fuente, creado_por, observaciones)
    values (1, 'DEMO HORNO DEL VALLE SAS', '900000903-1', 'Marta Demo', '3000000903',
            'Avenida 3 # 3-03 (DEMO)', 'Cali', 'Valle del Cauca', v_etapa, 12000000, 'referido', 'DEMO',
            'DEMO: datos de demostracion');
  end if;

  raise notice 'Demo lista: clientes % y %.', v_a, v_b;
end $$;


-- ============================================================================
-- VERIFICACION
-- ============================================================================
select id, nombre, cupo_credito, dias_credito from public.clientes where nombre like 'DEMO %' order by id;
select numero_factura, owner_id, fecha_vencimiento, valor_original, saldo from public.crm_cuentas_cobrar
 where numero_factura like 'DEMO-%' order by numero_factura;
