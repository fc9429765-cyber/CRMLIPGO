-- ============================================================================
-- seed/demo_crm_limpiar.sql — BORRA LOS DATOS DE DEMOSTRACION
-- ----------------------------------------------------------------------------
-- Quita todo lo que creo seed/demo_crm.sql y lo que se haya hecho sobre los
-- clientes DEMO durante la demo (pedidos, recaudos, pagos, documentos).
--
-- CANDADO, igual que el seed:
--     set crm.demo = 'si';
--
-- LO QUE NO BORRA:
--   - Pedidos ya pasados a LIPgo. Si durante la demo se aprobo un pedido de un
--     cliente DEMO, ese pedido existe en LIPgo y debe anularse alli. En ese
--     caso el cliente y su sucursal NO se borran: se desactivan, para no dejar
--     un pedido de LIPgo apuntando a un cliente inexistente. El script lista
--     esos pedidos.
--   - Los ARCHIVOS del bucket privado (comprobantes, documentos): SQL solo
--     borra sus filas. Si hubo archivos, borrarlos desde Storage → crm-privado
--     (las rutas empiezan por 1/recaudo/…, 1/cliente/…, 1/prospecto/…).
-- ============================================================================

do $$
declare
  v_clientes bigint[];
  v_cuentas  bigint[];
  v_recaudos bigint[];
  v_pedidos  bigint[];
  v_lipgo    bigint[];
  v_prosp    bigint[];
begin
  if coalesce(current_setting('crm.demo', true), '') <> 'si' then
    raise exception 'Candado: ejecuta primero  set crm.demo = ''si'';  en la misma ejecucion.';
  end if;

  select array_agg(id) into v_clientes from public.clientes
   where id_empresa = 1 and nombre in ('DEMO PANADERIA ANDINA', 'DEMO PASTELERIA COSTA');
  select array_agg(id) into v_prosp from public.crm_prospectos
   where idempresa = 1 and razon_social like 'DEMO %';

  if v_clientes is not null then
    select array_agg(id) into v_cuentas  from public.crm_cuentas_cobrar where cliente_id = any(v_clientes);
    select array_agg(id) into v_recaudos from public.crm_recaudos      where cliente_id = any(v_clientes);
    select array_agg(id), array_agg(idpedido_lipgo) filter (where idpedido_lipgo is not null)
      into v_pedidos, v_lipgo from public.crm_pedidos where cliente_id = any(v_clientes);

    -- Recaudos y su rastro
    delete from public.crm_integracion_outbox where entidad = 'recaudo' and entidad_id = any(coalesce(v_recaudos, '{}'));
    delete from public.crm_eventos where entidad = 'recaudo' and entidad_id = any(coalesce(v_recaudos, '{}'));
    delete from public.crm_documentos where entidad = 'recaudo' and entidad_id = any(coalesce(v_recaudos, '{}'));
    delete from public.crm_saldos_favor where cliente_id = any(v_clientes);
    delete from public.crm_pagos where cuenta_cobrar_id = any(coalesce(v_cuentas, '{}'));
    delete from public.crm_recaudo_aplicaciones where recaudo_id = any(coalesce(v_recaudos, '{}'));
    delete from public.crm_recaudos where id = any(coalesce(v_recaudos, '{}'));

    -- Comisiones y cartera
    delete from public.crm_comisiones where cuenta_cobrar_id = any(coalesce(v_cuentas, '{}'));
    delete from public.crm_cuentas_cobrar where id = any(coalesce(v_cuentas, '{}'));

    -- Pedidos del CRM (los de LIPgo se anulan en LIPgo)
    delete from public.crm_integracion_outbox where entidad = 'pedido' and entidad_id = any(coalesce(v_pedidos, '{}'));
    delete from public.crm_eventos where entidad = 'pedido' and entidad_id = any(coalesce(v_pedidos, '{}'));
    delete from public.crm_pedido_detalle where pedido_id = any(coalesce(v_pedidos, '{}'));
    delete from public.crm_pedidos where id = any(coalesce(v_pedidos, '{}'));

    -- Documentos, catalogo, mapeos y eventos del cliente
    delete from public.crm_documentos where entidad = 'cliente' and entidad_id = any(v_clientes);
    delete from public.crm_catalogo_cliente where cliente_id = any(v_clientes);
    delete from public.crm_sap_mapeo where entidad = 'cliente' and entidad_id = any(v_clientes);
    delete from public.crm_eventos where entidad = 'cliente' and entidad_id = any(v_clientes);

    if v_lipgo is null then
      delete from public.bodegas where clienteid = any(v_clientes);
      delete from public.clientes where id = any(v_clientes);
      raise notice 'Clientes y sucursales DEMO borrados.';
    else
      update public.bodegas set activo = 'false' where clienteid = any(v_clientes);
      update public.clientes set activo = 'false' where id = any(v_clientes);
      raise notice 'Hubo pedidos DEMO en LIPgo (%): anúlalos en LIPgo. Clientes y sucursales DEMO quedaron DESACTIVADOS, no borrados.', v_lipgo;
    end if;
  end if;

  -- Prospectos DEMO (los que no llegaron a cliente)
  if v_prosp is not null then
    delete from public.crm_documentos where entidad = 'prospecto' and entidad_id = any(v_prosp);
    delete from public.crm_eventos where entidad = 'prospecto' and entidad_id = any(v_prosp);
    delete from public.crm_prospecto_interes where prospecto_id = any(v_prosp);
    delete from public.crm_actividades where prospecto_id = any(v_prosp);
    delete from public.crm_prospectos where id = any(v_prosp);
  end if;

  delete from public.crm_cuentas_destino where idempresa = 1 and alias like 'DEMO %'
     and not exists (select 1 from public.crm_recaudos r where r.cuenta_destino_id = crm_cuentas_destino.id);
end $$;


-- ============================================================================
-- VERIFICACION: todo en cero (o clientes desactivados si hubo pedidos en LIPgo)
-- ============================================================================
select (select count(*) from public.clientes where nombre like 'DEMO %' and activo = 'true') as clientes_demo_activos,
       (select count(*) from public.crm_cuentas_cobrar where numero_factura like 'DEMO-%')   as facturas_demo,
       (select count(*) from public.crm_prospectos where razon_social like 'DEMO %')          as prospectos_demo,
       (select count(*) from public.crm_cuentas_destino where alias like 'DEMO %')            as cuentas_demo;
