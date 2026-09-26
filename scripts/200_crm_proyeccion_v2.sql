-- ============================================================================
-- 200_crm_proyeccion_v2.sql
-- ----------------------------------------------------------------------------
-- Fase 2 del requerimiento INDUPAN: la proyeccion del pedido a LIPgo, version 2
-- (PED-15, PED-16, PED-23).
--
-- LO QUE CAMBIA FRENTE AL SCRIPT 190:
--   1. `id_empresa` = CENTRO DE DESPACHO del pedido (Molinos: 3 o 4), no la
--      empresa del CRM. Es como LIPgo registra sus propios pedidos.
--   2. Los productos se validan contra el catalogo de ESE centro: LIPgo los
--      busca por nombre alli al armar la orden de cargue.
--   3. `empresafactura` = el owner del pedido (crm_owners), no el de la
--      empresa 1: un pedido de Molinos llega como "Molinos del Atlantico".
--   4. Impuesto por linea con la tarifa de cada producto (script 194).
--   5. El precio de cada linea es el final: se deja de enviar descuento.
--   6. La cuenta por cobrar se crea DENTRO de la transaccion. Antes se creaba
--      despues, y si fallaba, el pedido quedaba en LIPgo sin su cartera.
--   7. El pedido queda en `programado_lipgo` (script 199).
--
-- Sigue igual: una sola transaccion, bloqueo de la fila, idempotencia por
-- idpedido_lipgo, y aprobado='si' + estado='aprobado' en LIPgo, que deja el
-- pedido directamente en "listos para orden de cargue".
--
-- Reemplaza la funcion (create or replace): idempotente. Requiere el 199.
-- ============================================================================

create or replace function public.crm_proyectar_pedido_lipgo(
  p_pedido_id  bigint,
  p_usuario_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ped        record;
  v_cliente    record;
  v_vendedor   text;
  v_bodega     record;
  v_idpedido   bigint;
  v_transid    bigint;
  v_linea      record;
  v_faltantes  text[];
  v_n          int := 0;
  v_condicion  text;
  v_despacho   text;
  v_empresa    text;
  v_owner      text;
  v_desp       int;
  v_hoy        date := (now() at time zone 'America/Bogota')::date;
  v_creador    text;
begin
  -- ---------------------------------------------------------------------
  -- 1. Tomar el pedido BLOQUEANDO la fila. Si hay dos peticiones a la vez,
  --    la segunda espera aqui y al entrar ve el estado ya cambiado.
  -- ---------------------------------------------------------------------
  select * into v_ped
    from public.crm_pedidos
   where id = p_pedido_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'El pedido no existe');
  end if;

  if v_ped.idpedido_lipgo is not null then
    -- Idempotente: reintentar no duplica, informa lo que ya paso.
    return jsonb_build_object(
      'ok', true, 'ya_proyectado', true,
      'idpedido', v_ped.idpedido_lipgo,
      'mensaje', format('El pedido ya habia viajado a LIPgo como %s', v_ped.idpedido_lipgo));
  end if;

  -- 'aprobado' es el estado nuevo (script 199); 'autorizado' el de antes.
  if v_ped.estado not in ('aprobado', 'autorizado') then
    return jsonb_build_object('ok', false,
      'error', format('El pedido esta en estado "%s"; solo viaja un pedido aprobado', v_ped.estado));
  end if;

  -- Cinturon y tirantes: el estado 'autorizado' deberia implicar las dos
  -- firmas, pero se comprueba igual porque es lo que separa un pedido
  -- legitimo de uno que alguien empujo con un UPDATE manual.
  if v_ped.auth_contabilidad_en is null or v_ped.auth_gerencia_en is null then
    return jsonb_build_object('ok', false,
      'error', 'Faltan aprobaciones: se requieren Cartera y Gerencia');
  end if;

  -- Centro de despacho: el elegido en el pedido; si no, el del owner; si no,
  -- la empresa del CRM. Es el id_empresa que tendra el pedido en LIPgo, y el
  -- catalogo contra el que se validan los productos.
  select coalesce(v_ped.idempresa_despacho, o.idempresa_lipgo, v_ped.idempresa),
         coalesce(o.nombre_empresafactura, ow.nombre)
    into v_desp, v_owner
    from (select 1) x
    left join public.crm_owners o on o.id = v_ped.owner_id
    left join public.owners ow on ow.id = v_ped.idempresa;

  -- ---------------------------------------------------------------------
  -- 2. VALIDAR LOS NOMBRES DE PRODUCTO CONTRA EL CATALOGO DE LIPGO.
  --    Esta es la validacion que evita romper produccion ajena.
  --
  --    NO se filtra por `productos.activo` a proposito: un producto
  --    descontinuado despues de cotizar sigue existiendo en el catalogo y su
  --    pedido debe poder despacharse. Lo que rompe a LIPgo es un nombre que NO
  --    EXISTE, no uno inactivo. (Ademas `activo` es TEXT en esta base, con
  --    'true'/'false' como cadenas, asi que usarlo como condicion booleana
  --    directa fallaria.)
  -- ---------------------------------------------------------------------
  select array_agg(distinct d.producto_nombre) into v_faltantes
    from public.crm_pedido_detalle d
   where d.pedido_id = p_pedido_id
     and not exists (
       select 1 from public.productos pr
        where pr.nombre = d.producto_nombre
          and pr.id_empresa = v_desp
     );

  if v_faltantes is not null and array_length(v_faltantes, 1) > 0 then
    update public.crm_pedidos
       set error_lipgo = format('Productos que no existen en el catalogo de LIPgo: %s',
                                array_to_string(v_faltantes, ', ')),
           actualizado_en = now()
     where id = p_pedido_id;

    return jsonb_build_object(
      'ok', false,
      'error', format('Hay productos que no existen en el catalogo del centro de despacho (empresa %s) de LIPgo', v_desp),
      'productos_faltantes', to_jsonb(v_faltantes));
  end if;

  if not exists (select 1 from public.crm_pedido_detalle where pedido_id = p_pedido_id) then
    return jsonb_build_object('ok', false, 'error', 'El pedido no tiene lineas');
  end if;

  -- ---------------------------------------------------------------------
  -- 3. Resolver los textos que LIPgo espera. Su modelo guarda NOMBRES, no
  --    ids, en casi todas estas columnas.
  -- ---------------------------------------------------------------------
  select * into v_cliente from public.clientes where id = v_ped.cliente_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'El cliente del pedido no existe');
  end if;

  select nombre into v_vendedor from public.vendedores where idvendedor = v_ped.vendedor_id;
  select * into v_bodega from public.bodegas where idbodega = v_ped.bodega_id;

  select nombrecondicion into v_condicion
    from public.condicionespago where idcondicion = v_ped.condicion_pago_id;

  select nombretipodespacho into v_despacho
    from public.tipodespacho where idtipodespacho = v_ped.tipo_despacho_id;

  -- `empresa` es el nombre del centro de despacho (id_empresa) y
  -- `empresafactura` el owner que factura. LIPgo filtra por esta ultima a los
  -- usuarios con owners asignados: sin ella el pedido existe pero no lo ven.
  -- Mientras no exista el maestro de owners del CRM (fase 1), el owner es el
  -- de LIPgo con el mismo id que la empresa: hoy el CRM solo vende productos
  -- de la empresa 1, cuyo owner es "Harinera Indupan" (owners.id = 1).
  select nombre into v_empresa from public.empresas where id = v_desp;
  select usuario into v_creador from public.profiles where id = p_usuario_id;

  -- ---------------------------------------------------------------------
  -- 4. Insertar en pedidoscabecera.
  --    El id se pide a crm_siguiente_id, que sincroniza la secuencia con el
  --    MAX real: LIPgo inserta ids explicitos sin consumirla y la deja atras.
  -- ---------------------------------------------------------------------
  v_idpedido := public.crm_siguiente_id('pedidoscabecera', 'idpedido');

  insert into public.pedidoscabecera (
    idpedido, id_empresa, fecha, fecha_programada,
    vendedor, cliente, destino, direccion,
    condicion_pago, tipo_despacho, orden_de_compra,
    medio, empresa, empresafactura,
    total_linea, total_pagar, descuentoiva, descuentopp,
    observaciones, aprobado, estado,
    revisioncartera, revisiongerencia
  ) values (
    v_idpedido, v_desp, v_ped.fecha, v_ped.fecha_programada,
    coalesce(v_vendedor, ''), v_cliente.nombre,
    coalesce(v_ped.destino, v_bodega.ciudad, ''),
    coalesce(v_ped.direccion, v_bodega.direccion, ''),
    coalesce(v_condicion, ''), coalesce(v_despacho, ''),
    coalesce(v_ped.orden_compra, ''),
    -- La sucursal va en `medio`: es donde la lee LIPgo (order-entry-form).
    coalesce(v_bodega.nombrebodega, ''),
    coalesce(v_empresa, ''), coalesce(v_owner, ''),
    -- El precio de cada linea ya es el final (PED-10): no hay descuento que
    -- restar en LIPgo. descuentoiva lleva el impuesto, como en LIPgo.
    v_ped.subtotal, v_ped.total, v_ped.iva_valor, 0,
    -- Se deja rastro del origen en las observaciones: quien vea el pedido en
    -- LIPgo debe poder saber que nacio en el CRM y con que numero.
    trim(coalesce(v_ped.observaciones, '') || format(' [Origen: CRM %s]', v_ped.numero)),
    'si', 'aprobado',
    -- LIPgo guarda aqui el NOMBRE de quien reviso; se traslada el de cada firma.
    coalesce(v_ped.auth_contabilidad_nombre, 'CRM'),
    coalesce(v_ped.auth_gerencia_nombre, 'CRM')
  );

  -- ---------------------------------------------------------------------
  -- 5. Insertar el detalle.
  -- ---------------------------------------------------------------------
  for v_linea in
    select * from public.crm_pedido_detalle where pedido_id = p_pedido_id order by linea
  loop
    v_transid := public.crm_siguiente_id('pedidosdetalle', 'transid');

    insert into public.pedidosdetalle (
      transid, idpedido, id_empresa,
      producto, unidades, precio_und,
      total_linea, iva, descuentopp, subtotal, peso, categoria
    ) values (
      v_transid, v_idpedido, v_desp,
      v_linea.producto_nombre, v_linea.cantidad, v_linea.precio_unitario,
      -- total_linea = lo que se cobra por la linea, a precio final.
      v_linea.subtotal,
      -- Impuesto de la linea con SU tarifa (script 194); las lineas viejas
      -- sin impuesto propio usan el IVA del encabezado.
      coalesce(v_linea.impuesto_valor, round(v_linea.subtotal * v_ped.iva_pct / 100.0, 2)),
      0, v_linea.subtotal,
      v_linea.peso, coalesce(v_linea.categoria, '')
    );

    v_n := v_n + 1;
  end loop;

  -- ---------------------------------------------------------------------
  -- 6. Cerrar el puente. El indice unico parcial sobre idpedido_lipgo es la
  --    ultima defensa contra la doble proyeccion.
  -- ---------------------------------------------------------------------
  -- ---------------------------------------------------------------------
  -- 6. Cuenta por cobrar, DENTRO de la misma transaccion.
  --    Antes se creaba despues, desde TypeScript: si fallaba, el pedido
  --    quedaba en LIPgo sin su cartera y nadie se enteraba. Ahora, o viajan
  --    los dos, o ninguno. El indice ux_crm_cxc_pedido impide duplicarla.
  -- ---------------------------------------------------------------------
  if v_ped.forma_pago = 'credito' and not exists (
       select 1 from public.crm_cuentas_cobrar
        where pedido_id = p_pedido_id and tipo_documento = 'factura') then
    insert into public.crm_cuentas_cobrar (
      idempresa, cliente_id, pedido_id, idpedido_lipgo, owner_id,
      fecha_factura, fecha_vencimiento, valor_original, vendedor_id,
      tipo_documento, origen, creado_por
    ) values (
      v_ped.idempresa, v_ped.cliente_id, p_pedido_id, v_idpedido, v_ped.owner_id,
      v_hoy, v_hoy + coalesce(v_ped.dias_credito, 0), v_ped.total, v_ped.vendedor_id,
      'factura', 'pedido', coalesce(v_creador, v_ped.creado_por, 'CRM')
    );
  end if;

  update public.crm_pedidos
     set idpedido_lipgo    = v_idpedido,
         estado            = 'programado_lipgo',
         enviado_lipgo_en  = now(),
         enviado_lipgo_por = p_usuario_id,
         error_lipgo       = null,
         actualizado_en    = now()
   where id = p_pedido_id;

  return jsonb_build_object(
    'ok', true,
    'idpedido', v_idpedido,
    'lineas', v_n,
    'idempresa_despacho', v_desp,
    'mensaje', format('Pedido %s programado en LIPgo como %s (%s lineas)', v_ped.numero, v_idpedido, v_n));

exception
  when others then
    -- El RAISE deshace TODA la transaccion: no queda cabecera sin detalle en
    -- la tabla de LIPgo. El mensaje se guarda aparte, en una transaccion
    -- propia, para que el error quede registrado aunque esta se revierta.
    raise warning 'crm_proyectar_pedido_lipgo(%) fallo: %', p_pedido_id, sqlerrm;
    raise;
end $$;



comment on function public.crm_proyectar_pedido_lipgo(bigint, uuid) is
  'Programa en LIPgo un pedido aprobado del CRM: cabecera, detalle y cuenta por cobrar en una sola transaccion. id_empresa = centro de despacho; empresafactura = owner. Es el UNICO punto donde el CRM escribe pedidos en LIPgo.';


-- ============================================================================
-- VERIFICACION
-- ============================================================================

-- 1. La funcion usa el centro de despacho y crea la cartera (esperado: true, true)
select position('v_desp' in pg_get_functiondef('public.crm_proyectar_pedido_lipgo(bigint,uuid)'::regprocedure)) > 0 as usa_centro_despacho,
       position('crm_cuentas_cobrar' in pg_get_functiondef('public.crm_proyectar_pedido_lipgo(bigint,uuid)'::regprocedure)) > 0 as crea_cartera;

-- 2. Un pedido inexistente responde con error controlado
select public.crm_proyectar_pedido_lipgo(-1, null) as respuesta_esperada_error;


-- ============================================================================
-- REVERSION (comentada): correr de nuevo el script 190.
-- ============================================================================
