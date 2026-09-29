-- ============================================================================
-- 201_crm_documentos.sql
-- ----------------------------------------------------------------------------
-- Fase 3 del requerimiento INDUPAN: evidencia documental en almacenamiento
-- PRIVADO (REC-13, REC-23, RNF-06; y la base para PRO-01..03 de la fase 5).
--
-- POR QUE UN BUCKET NUEVO: todos los buckets de esta base son publicos
-- (verificado el 2026-09-26). En uno publico, cualquiera con la URL ve el
-- archivo, sin sesion. Un comprobante de consignacion tiene numeros de cuenta,
-- valores y nombres: no puede quedar asi. `crm-privado` no es publico y no
-- tiene politicas para usuarios anonimos ni autenticados: solo el servidor lo
-- lee, y entrega al navegador URLs FIRMADAS que caducan en minutos.
--
-- DUPLICADOS: cada archivo guarda su huella (sha256). Un indice unico impide
-- reportar el MISMO comprobante en dos recaudos distintos, que es la forma mas
-- sencilla de cobrar dos veces el mismo pago.
--
-- Aditivo e idempotente.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-privado', 'crm-privado', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false,  -- si alguien lo volvio publico, se corrige
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


create table if not exists public.crm_tipos_documento (
  id          serial primary key,
  idempresa   int  not null default 1,
  entidad     text not null check (entidad in ('recaudo','prospecto','cliente')),
  codigo      text not null,
  nombre      text not null,
  obligatorio boolean not null default false,
  ayuda       text,
  activo      boolean not null default true,
  orden       int  not null default 0,
  unique (idempresa, entidad, codigo)
);

comment on table public.crm_tipos_documento is
  'Que documentos se piden en cada caso. Configurable: la lista de documentos obligatorios de un prospecto (PRO-01) se ajusta aqui, no en el codigo.';

insert into public.crm_tipos_documento (idempresa, entidad, codigo, nombre, obligatorio, ayuda, orden)
select 1, v.entidad, v.codigo, v.nombre, v.obligatorio, v.ayuda, v.orden
  from (values
    ('recaudo',   'COMPROBANTE',     'Comprobante de pago',               true,  'Foto o PDF de la consignación, transferencia o recibo.', 1),
    ('prospecto', 'RUT',             'RUT',                               true,  null, 1),
    ('prospecto', 'CAMARA',          'Cámara de comercio',                true,  'Con vigencia no mayor a 30 días.', 2),
    ('prospecto', 'CEDULA_REP',      'Cédula del representante legal',    true,  null, 3),
    ('prospecto', 'CERT_BANCARIA',   'Certificación bancaria',            false, null, 4),
    ('prospecto', 'REFERENCIAS',     'Referencias comerciales',           false, null, 5),
    ('cliente',   'OTRO',            'Otro documento',                    false, null, 9)
  ) as v(entidad, codigo, nombre, obligatorio, ayuda, orden)
 where not exists (
   select 1 from public.crm_tipos_documento t
    where t.idempresa = 1 and t.entidad = v.entidad and t.codigo = v.codigo);


create table if not exists public.crm_documentos (
  id                bigserial primary key,
  idempresa         int  not null default 1,
  entidad           text not null check (entidad in ('recaudo','prospecto','cliente')),
  entidad_id        bigint not null,
  tipo_documento_id int  references public.crm_tipos_documento(id),
  bucket            text not null default 'crm-privado',
  storage_path      text not null,
  nombre_archivo    text,
  mime              text,
  tamano            int,
  sha256            text not null,
  -- Lo que leyo la IA del documento, tal cual (REC-23: la evidencia
  -- digitalizada queda consultable en todo momento).
  ocr_resultado     jsonb,
  estado            text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  subido_por        uuid,
  subido_nombre     text,
  subido_en         timestamptz not null default now(),
  revisado_por      uuid,
  revisado_nombre   text,
  revisado_en       timestamptz,
  nota              text,
  unique (bucket, storage_path)
);

create index if not exists ix_crm_documentos_entidad
  on public.crm_documentos (idempresa, entidad, entidad_id);

-- El mismo comprobante no puede sustentar dos recaudos.
create unique index if not exists ux_crm_documentos_recaudo_sha
  on public.crm_documentos (idempresa, sha256)
  where entidad = 'recaudo';

comment on table public.crm_documentos is
  'Documentos del CRM (comprobantes, RUT, camara de comercio...). El archivo vive en el bucket privado crm-privado; se ve solo con URL firmada.';


insert into public.crm_parametros
  (idempresa, clave, valor, tipo, grupo, etiqueta, descripcion, editable)
select 1, v.clave, v.valor, v.tipo, v.grupo, v.etiqueta, v.descripcion, true
  from (values
    ('documentos.url_minutos', '10', 'number', 'documentos', 'Validez de los enlaces a documentos (minutos)',
     'Los comprobantes se abren con un enlace temporal. Pasado este tiempo el enlace deja de funcionar y hay que volver a abrirlo desde el CRM.'),
    ('ia.lectura_comprobantes', 'true', 'boolean', 'documentos', 'Leer comprobantes con IA',
     'true = al subir la foto del comprobante, la IA extrae fecha, valor, banco y referencia, y rechaza fotos ilegibles. false = se digita todo a mano.'),
    ('ia.modelo_ocr', 'claude-sonnet-5', 'string', 'documentos', 'Modelo de IA para comprobantes',
     'Modelo de Anthropic que lee los comprobantes.')
  ) as v(clave, valor, tipo, grupo, etiqueta, descripcion)
 where not exists (
   select 1 from public.crm_parametros p where p.idempresa = 1 and p.clave = v.clave and p.vigente_hasta is null);


-- ============================================================================
-- VERIFICACION
-- ============================================================================

-- 1. El bucket existe y NO es publico (esperado: crm-privado | false)
select id, public from storage.buckets where id = 'crm-privado';

-- 2. Tipos de documento sembrados (esperado: 7)
select count(*) as tipos_documento from public.crm_tipos_documento;


-- ============================================================================
-- REVERSION (comentada)
-- ----------------------------------------------------------------------------
-- Borrar el bucket NO borra los archivos de forma segura; vaciarlo primero.
--   drop table if exists public.crm_documentos;
--   drop table if exists public.crm_tipos_documento;
--   delete from public.crm_parametros where clave in ('documentos.url_minutos','ia.lectura_comprobantes','ia.modelo_ocr');
-- ============================================================================
