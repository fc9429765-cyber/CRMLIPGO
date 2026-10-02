-- ============================================================================
-- 208_crm_aprobaciones.sql
-- ----------------------------------------------------------------------------
-- Torre de control de aprobaciones (Cartera → Aprobaciones).
--
-- Solo un parametro: desde cuantas horas de espera un pendiente se marca en
-- rojo. La torre no tiene tablas propias: lee los pedidos, recaudos y
-- prospectos pendientes de donde ya estan, y cada decision la toma la misma
-- accion de siempre (con sus permisos y reglas).
--
-- Aditivo e idempotente.
-- ============================================================================

insert into public.crm_parametros (idempresa, clave, valor, tipo, grupo, etiqueta, descripcion, editable)
select 1, 'aprobaciones.horas_alerta', '24', 'number', 'pedidos', 'Aprobaciones: horas de espera para alertar',
       'En la torre de aprobaciones, un pedido, recaudo o prospecto que lleva más de estas horas esperando se marca en rojo y sube al principio.',
       true
 where not exists (select 1 from public.crm_parametros where idempresa = 1 and clave = 'aprobaciones.horas_alerta' and vigente_hasta is null);

-- Modelo de IA para el analisis del cliente (Cuenta 360 → "Analizar con IA")
insert into public.crm_parametros (idempresa, clave, valor, tipo, grupo, etiqueta, descripcion, editable)
select 1, 'ia.modelo_analisis', 'claude-sonnet-5', 'string', 'documentos', 'Modelo de IA para el análisis del cliente',
       'Modelo de Anthropic que redacta la lectura comercial y de cartera de un cliente en la Cuenta 360. Solo usa las cifras del CRM.',
       true
 where not exists (select 1 from public.crm_parametros where idempresa = 1 and clave = 'ia.modelo_analisis' and vigente_hasta is null);

-- ============================================================================
-- VERIFICACION
-- ============================================================================
select clave, valor from public.crm_parametros where clave in ('aprobaciones.horas_alerta','ia.modelo_analisis') and vigente_hasta is null;

-- REVERSION (comentada)
--   delete from public.crm_parametros where clave in ('aprobaciones.horas_alerta','ia.modelo_analisis');
