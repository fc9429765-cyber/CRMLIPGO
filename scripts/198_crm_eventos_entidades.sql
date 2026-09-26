-- ============================================================================
-- 198_crm_eventos_entidades.sql
-- ----------------------------------------------------------------------------
-- Amplia las entidades que acepta la bitacora `crm_eventos` (script 191).
--
-- La fase 1 registra cambios en maestros (owners, impuestos, bancos...),
-- productos, vendedores y catalogos. La lista original no los tenia, y
-- anotarlos como "cliente" habria dejado una auditoria que miente sobre que
-- se cambio. Se agregan las entidades que faltan.
--
-- Idempotente: quita la restriccion y la vuelve a crear con la lista completa.
-- ============================================================================

alter table public.crm_eventos drop constraint if exists crm_eventos_entidad_check;

alter table public.crm_eventos
  add constraint crm_eventos_entidad_check
  check (entidad in ('pedido','cotizacion','recaudo','cuenta','prospecto',
                     'cliente','documento','integracion','seguridad','importacion',
                     'maestro','producto','vendedor','catalogo'));


-- ============================================================================
-- VERIFICACION (esperado: la lista incluye maestro, producto, vendedor, catalogo)
-- ============================================================================
select pg_get_constraintdef(oid) as restriccion
  from pg_constraint where conname = 'crm_eventos_entidad_check';


-- ============================================================================
-- REVERSION (comentada): volver a la lista del script 191. Falla si ya hay
-- eventos con las entidades nuevas.
-- ============================================================================
