-- ============================================================================
-- 210_crm_catalogo_favoritos.sql
-- ----------------------------------------------------------------------------
-- EL CATALOGO DEL CLIENTE PASA A SER SU LISTA DE FAVORITOS.
--
-- Antes, si un cliente tenia catalogo asignado, solo se le podian vender esos
-- productos. Ahora, con `catalogo.modo = todos` (el valor de fabrica), esos
-- productos salen ARRIBA como favoritos al crear la venta y debajo, en un
-- acordeon, estan todos los demas para buscar y vender cualquiera.
--
-- `restringido` conserva el comportamiento estricto: solo se vende lo del
-- catalogo, y a un cliente sin catalogo no se le vende.
--
-- Este script SOLO cambia el texto que se ve en Parametrizacion. No cambia el
-- valor del parametro. Idempotente.
-- ============================================================================

update public.crm_parametros
   set etiqueta    = 'Catálogo del cliente',
       descripcion = 'todos = el catálogo del cliente son sus favoritos: salen primero al vender, pero se le puede vender cualquier producto. restringido = solo se le venden los productos de su catálogo, y sin catálogo no se le puede vender.'
 where clave = 'catalogo.modo'
   and vigente_hasta is null;

-- VERIFICACION
--   select idempresa, valor, etiqueta, descripcion from public.crm_parametros
--    where clave = 'catalogo.modo' and vigente_hasta is null;
--
-- Si algun ambiente tiene 'restringido' y se quiere el comportamiento nuevo,
-- se cambia desde Configuracion > Parametrizacion (queda en el historial).
