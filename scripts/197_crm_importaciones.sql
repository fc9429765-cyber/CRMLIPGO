  -- ============================================================================
  -- 197_crm_importaciones.sql
  -- ----------------------------------------------------------------------------
  -- Fase 1 del requerimiento INDUPAN: carga de maestros y facturas por archivo
  -- CSV o Excel mientras SAP este apagado (INT-05, ADM-01, CAR-06).
  --
  -- TODA CARGA PASA POR UNA SIMULACION. Se sube el archivo, el sistema dice fila
  -- por fila que haria (crear, actualizar, omitir) y que errores encontro, y
  -- NADA se escribe hasta que alguien pulsa "Aplicar". Un Excel con una columna
  -- corrida puede reescribir 600 clientes: tiene que verse antes.
  --
  -- Cada carga queda registrada con su archivo, su autor y el resultado de cada
  -- fila. Si algo salio mal, se sabe que cambio y cuando.
  --
  -- CARTERA: por decision del usuario, la cuenta por cobrar SE SIGUE creando
  -- desde el pedido aprobado a credito. La importacion de facturas solo:
  --   - completa numero y fecha de factura de una cuenta que ya existe;
  --   - carga SALDOS INICIALES: lo que el cliente ya debia antes del CRM.
  -- Para distinguirlas se agregan `tipo_documento` y `origen`. Una cuenta que
  -- nacio de un pedido NUNCA se crea de nuevo por importacion: seria contarla
  -- dos veces.
  --
  -- Aditivo e idempotente.
  -- ============================================================================

  create table if not exists public.crm_importaciones (
    id             bigserial primary key,
    idempresa      int  not null default 1,
    tipo           text not null check (tipo in ('clientes','productos','catalogo','sucursales',
                                                'vendedores_usuarios','facturas','saldos_iniciales')),
    archivo_nombre text,
    estado         text not null default 'simulada' check (estado in ('simulada','aplicada','fallida','descartada')),
    total_filas    int  not null default 0,
    filas_crear    int  not null default 0,
    filas_actualizar int not null default 0,
    filas_omitir   int  not null default 0,
    filas_error    int  not null default 0,
    creado_por     text,
    creado_en      timestamptz not null default now(),
    aplicado_por   text,
    aplicado_en    timestamptz
  );

  create table if not exists public.crm_importacion_filas (
    id              bigserial primary key,
    idempresa       int  not null default 1,
    importacion_id  bigint not null references public.crm_importaciones(id) on delete cascade,
    fila            int  not null,
    datos           jsonb not null,
    accion          text not null check (accion in ('crear','actualizar','omitir','error')),
    errores         jsonb not null default '[]'::jsonb,
    -- Id de lo que se creo o actualizo, para rastrear el cambio.
    entidad_id      bigint,
    -- Lo que habia antes de actualizar. Permite ver que piso la carga.
    antes           jsonb,
    aplicada        boolean not null default false
  );

  create index if not exists ix_crm_import_filas on public.crm_importacion_filas (importacion_id, fila);
  create index if not exists ix_crm_import_empresa on public.crm_importaciones (idempresa, creado_en desc);

  comment on table public.crm_importaciones is
    'Cada carga de archivo: se simula, se revisa y solo entonces se aplica. Guarda autor, fecha y resultado.';


  -- Origen y tipo de cada documento de cartera.
  alter table public.crm_cuentas_cobrar
    add column if not exists tipo_documento text not null default 'factura',
    add column if not exists origen         text not null default 'pedido',
    add column if not exists importacion_id bigint references public.crm_importaciones(id);

  do $$
  begin
    if not exists (select 1 from pg_constraint where conname = 'crm_cxc_tipo_documento_check') then
      alter table public.crm_cuentas_cobrar
        add constraint crm_cxc_tipo_documento_check
        check (tipo_documento in ('factura','saldo_inicial','nota_debito'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'crm_cxc_origen_check') then
      alter table public.crm_cuentas_cobrar
        add constraint crm_cxc_origen_check
        check (origen in ('pedido','importacion','manual','sap'));
    end if;
  end $$;

  comment on column public.crm_cuentas_cobrar.origen is
    'pedido = nacio al aprobar un pedido a credito. importacion = saldo inicial cargado por archivo. Una cuenta de pedido nunca se vuelve a crear por importacion.';

  -- Una sola cuenta por pedido: es lo que impide contar dos veces una factura
  -- que nacio del pedido y que luego llega en un archivo.
  create unique index if not exists ux_crm_cxc_pedido
    on public.crm_cuentas_cobrar (idempresa, pedido_id)
    where pedido_id is not null and tipo_documento = 'factura';

  -- Un numero de factura no se repite dentro de un owner.
  create unique index if not exists ux_crm_cxc_numero
    on public.crm_cuentas_cobrar (idempresa, coalesce(owner_id, 0), numero_factura)
    where numero_factura is not null and estado <> 'anulada';


  -- ============================================================================
  -- VERIFICACION
  -- ============================================================================
  select table_name from information_schema.tables
  where table_schema = 'public' and table_name in ('crm_importaciones','crm_importacion_filas');

  select column_name, column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'crm_cuentas_cobrar'
    and column_name in ('tipo_documento','origen','importacion_id');


  -- ============================================================================
  -- REVERSION (comentada)
  -- ----------------------------------------------------------------------------
  --   drop index if exists public.ux_crm_cxc_numero;
  --   drop index if exists public.ux_crm_cxc_pedido;
  --   alter table public.crm_cuentas_cobrar drop constraint if exists crm_cxc_origen_check,
  --     drop constraint if exists crm_cxc_tipo_documento_check,
  --     drop column if exists importacion_id, drop column if exists origen,
  --     drop column if exists tipo_documento;
  --   drop table if exists public.crm_importacion_filas;
  --   drop table if exists public.crm_importaciones;
  -- ============================================================================
