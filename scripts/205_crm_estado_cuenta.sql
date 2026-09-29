-- ============================================================================
-- 205_crm_estado_cuenta.sql
-- ----------------------------------------------------------------------------
-- Fase 4 del requerimiento INDUPAN: tablero de cartera y estado de cuenta
-- (DSH-01, DSH-02, EDC-01..EDC-03).
--
-- EL MEMBRETE ES DEL OWNER. El estado de cuenta lo emite quien cobra: una
-- factura de Molinos del Atlantico no puede salir con el logo y el NIT de
-- Harinera Indupan. Por eso NIT, logo, direccion, contacto y el texto legal
-- del pie viven en crm_owners, editables desde Maestros, y no en el codigo.
-- Es la plantilla parametrizable que pide EDC-02 mientras INDUPAN entrega su
-- formato oficial.
--
-- El estado de cuenta que se COMPARTE se guarda en el bucket privado como
-- documento del cliente; el enlace que recibe el cliente caduca.
--
-- Aditivo e idempotente. Requiere 193 (owners) y 201 (documentos).
-- No crea tablas ni funciones: el RLS del 204 sigue cubriendo todo.
-- ============================================================================

alter table public.crm_owners
  add column if not exists nit            text,
  add column if not exists logo_url       text,
  add column if not exists direccion      text,
  add column if not exists telefono       text,
  add column if not exists correo         text,
  add column if not exists pie_documento  text;

comment on column public.crm_owners.logo_url is
  'Logo del membrete (estado de cuenta, recibo de caja). Debe estar en el Storage del proyecto: el servidor no descarga imagenes de otros dominios.';
comment on column public.crm_owners.pie_documento is
  'Texto legal al pie del estado de cuenta y del recibo de caja.';

-- Tipo de documento para los estados de cuenta compartidos
insert into public.crm_tipos_documento (idempresa, entidad, codigo, nombre, obligatorio, ayuda, orden)
select 1, 'cliente', 'ESTADO_CUENTA', 'Estado de cuenta', false, 'Generado desde el CRM al compartirlo con el cliente.', 5
 where not exists (
   select 1 from public.crm_tipos_documento where idempresa = 1 and entidad = 'cliente' and codigo = 'ESTADO_CUENTA');

-- Parametros
insert into public.crm_parametros
  (idempresa, clave, valor, tipo, grupo, etiqueta, descripcion, editable)
select 1, v.clave, v.valor, v.tipo, v.grupo, v.etiqueta, v.descripcion, true
  from (values
    ('estado_cuenta.dias_movimientos', '90', 'number', 'cartera', 'Estado de cuenta: días de movimientos',
     'Cuántos días hacia atrás se listan abonos y notas en el estado de cuenta. Las facturas abiertas salen siempre, sin importar su fecha.'),
    ('estado_cuenta.enlace_dias', '7', 'number', 'cartera', 'Estado de cuenta: validez del enlace (días)',
     'Al compartir el estado de cuenta por WhatsApp se envía un enlace temporal. Pasado este plazo deja de abrir.'),
    ('estado_cuenta.nota', 'Si ya realizó el pago, por favor haga caso omiso de este estado de cuenta y envíenos el soporte.', 'string', 'cartera',
     'Estado de cuenta: nota al cliente', 'Texto que aparece al final del estado de cuenta, antes del pie legal del owner.')
  ) as v(clave, valor, tipo, grupo, etiqueta, descripcion)
 where not exists (
   select 1 from public.crm_parametros p where p.idempresa = 1 and p.clave = v.clave and p.vigente_hasta is null);


-- ============================================================================
-- VERIFICACION
-- ============================================================================
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'crm_owners'
   and column_name in ('nit','logo_url','direccion','telefono','correo','pie_documento');   -- 6 filas
select codigo from public.crm_tipos_documento where entidad = 'cliente' and codigo = 'ESTADO_CUENTA';
select clave, valor from public.crm_parametros where clave like 'estado_cuenta.%' and vigente_hasta is null;


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
--   delete from public.crm_parametros where clave like 'estado_cuenta.%';
--   delete from public.crm_tipos_documento where entidad = 'cliente' and codigo = 'ESTADO_CUENTA';
--   alter table public.crm_owners drop column if exists nit, drop column if exists logo_url,
--     drop column if exists direccion, drop column if exists telefono, drop column if exists correo,
--     drop column if exists pie_documento;
-- ============================================================================
