-- Réplica de la parte de empresa suspendida de db/migrations/0028_alta_regulada.sql
-- del PR #59 (rama feat/ola-r-alta-regulada, commit ebfb52a): la función y el
-- DO que la pega a las tablas que existen. Solo la usa
-- tests/esquema/empresa-suspendida.test.ts mientras la 0028 no está en la rama;
-- cuando está, la prueba usa la de verdad y esta réplica deja de leerse.
-- Empresa suspendida: la consola queda en solo lectura. Toda escritura del
-- portal del cliente sobre sus tablas se rechaza (75ª fr. I: se suspende todo
-- acto, operación o servicio). La bitácora sigue recibiendo eventos.
CREATE FUNCTION bloqueo_empresa_suspendida()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  empresa uuid;
  estado_empresa text;
BEGIN
  IF current_user <> 'plataforma_cliente' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    empresa := OLD.company_id;
  ELSE
    empresa := NEW.company_id;
  END IF;
  SELECT c.estado INTO estado_empresa FROM companies c WHERE c.id = empresa;
  IF estado_empresa IN ('suspendida', 'baja') THEN
    RAISE EXCEPTION 'empresa_suspendida';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tabla text;
BEGIN
  FOR tabla IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.role_table_grants g
      ON g.table_schema = c.table_schema AND g.table_name = c.table_name
     AND g.grantee = 'plataforma_cliente' AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND c.table_name <> 'audit_log'
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'CREATE TRIGGER bloqueo_empresa_suspendida BEFORE INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION bloqueo_empresa_suspendida()',
      tabla
    );
  END LOOP;
END;
$$;

