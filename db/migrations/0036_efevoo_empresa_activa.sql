-- La aprobación regulada también rige las operaciones de Efevoo. La operación
-- se asienta antes de llamar al proveedor: esta guarda cubre servicios,
-- reintentos e inserciones directas de ambos roles de aplicación.
-- Conciliar/resolver operaciones existentes no crea una operación nueva.
CREATE FUNCTION efevoo_exigir_empresa_activa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  estado_empresa text;
BEGIN
  IF NEW.ambiente = 'produccion' AND NEW.tipo <> 'cancelacion' THEN
    -- FOR SHARE espera a cualquier UPDATE de estado ya iniciado y conserva el
    -- bloqueo hasta asentar la operación. Una lectura sin bloqueo vería «activa»
    -- mientras la suspensión aún no confirma. La condición de estado se evalúa
    -- DESPUÉS de esperar; no se filtra en el WHERE.
    -- Definer permite bloquear sin conceder UPDATE de companies al portal.
    -- Se limita a la empresa y los roles autorizados del contexto; el trigger
    -- original conserva la validación de actor y permisos de cada tipo.
    SELECT c.estado INTO estado_empresa FROM companies c
    WHERE c.id = NEW.company_id AND (
      (NEW.actor_tipo = 'personal' AND efevoo_es_administracion(c.operator_id))
      OR (NEW.actor_tipo = 'miembro' AND c.id = app_empresa()
          AND efevoo_miembro_con_rol(c.id, ARRAY['administrador', 'liberador']))
    )
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sin_permiso_para_efevoo';
    END IF;
    IF estado_empresa IS DISTINCT FROM 'activa' THEN
      RAISE EXCEPTION 'empresa_no_activa_efevoo';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION efevoo_exigir_empresa_activa() FROM PUBLIC;

CREATE TRIGGER efevoo_operaciones_empresa_activa
BEFORE INSERT ON efevoo_operaciones
FOR EACH ROW EXECUTE FUNCTION efevoo_exigir_empresa_activa();
