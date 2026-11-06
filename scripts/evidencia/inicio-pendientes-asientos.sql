-- Asientos de prueba para scripts/evidencia/inicio-pendientes.mjs.
-- Solo para una base local desechable. Uso:
--   psql "$DUENO_URL" -v empresa=<uuid> -v ON_ERROR_STOP=1 -f scripts/evidencia/inicio-pendientes-asientos.sql
-- Incluye un cargo el 31 de octubre a las 20:00 en hora de México (ya es
-- 1 de noviembre en UTC): debe contar en octubre, no en las categorías de
-- noviembre.
with d as (select codigo, id from drawers where company_id = :'empresa')
insert into postings (company_id, drawer_id, centavos, motivo, ocurrido_en)
select :'empresa', d.id, v.centavos, v.motivo, v.ocurrido::timestamptz
from (values
  ('proveedores', 21500000, 'Cobro flete Monterrey', '2026-06-10 12:00-06'),
  ('proveedores', -9800000, 'Diésel junio', '2026-06-15 12:00-06'),
  ('nomina', -6100000, 'Nómina junio', '2026-06-30 10:00-06'),
  ('proveedores', 19800000, 'Cobro flete Bajío', '2026-07-08 12:00-06'),
  ('nomina', -6100000, 'Nómina julio', '2026-07-31 10:00-06'),
  ('impuestos', -1200000, 'ISR julio', '2026-07-17 10:00-06'),
  ('proveedores', 23400000, 'Cobro flete Querétaro', '2026-08-12 12:00-06'),
  ('proveedores', -11200000, 'Mantenimiento de unidades', '2026-08-20 12:00-06'),
  ('nomina', -6100000, 'Nómina agosto', '2026-08-31 10:00-06'),
  ('proveedores', 17600000, 'Cobro flete Puebla', '2026-09-09 12:00-06'),
  ('nomina', -6100000, 'Nómina septiembre', '2026-09-30 10:00-06'),
  ('proveedores', 20900000, 'Cobro flete Guadalajara', '2026-10-07 12:00-06'),
  ('proveedores', -8700000, 'Llantas octubre', '2026-10-21 12:00-06'),
  ('nomina', -6100000, 'Nómina octubre', '2026-10-30 10:00-06'),
  ('viaticos', -325000, 'Viáticos cierre de octubre', '2026-10-31 20:00-06'),
  ('nomina', -6100000, 'Nómina noviembre (anticipo)', '2026-11-01 10:00-06'),
  ('proveedores', 18000000, 'Cobro flete León', '2026-11-02 12:00-06'),
  ('proveedores', -4250000, 'Diésel noviembre', '2026-11-03 12:00-06'),
  ('impuestos', -830000, 'IVA octubre', '2026-11-04 10:00-06')
) as v(codigo, centavos, motivo, ocurrido)
join d on d.codigo = v.codigo;
