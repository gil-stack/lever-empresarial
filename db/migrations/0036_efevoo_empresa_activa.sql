-- La aprobación regulada también rige las operaciones de Efevoo. La operación
-- se asienta antes de llamar al proveedor: esta guarda cubre servicios,
-- reintentos e inserciones directas de ambos roles de aplicación.
-- Conciliar/resolver operaciones existentes no crea una operación nueva.
CREATE FUNCTION efevoo_exigir_empresa_activa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.ambiente = 'produccion' AND NEW.tipo <> 'cancelacion' AND NOT EXISTS (
    SELECT 1 FROM companies c WHERE c.id = NEW.company_id AND c.estado = 'activa'
  ) THEN
    RAISE EXCEPTION 'empresa_no_activa_efevoo';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION efevoo_exigir_empresa_activa() FROM PUBLIC;

CREATE TRIGGER efevoo_operaciones_empresa_activa
BEFORE INSERT ON efevoo_operaciones
FOR EACH ROW EXECUTE FUNCTION efevoo_exigir_empresa_activa();
