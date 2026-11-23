-- Configuración de las alertas automáticas de Operación.
--
-- Hoy dos trámites abren una alerta operativa solos (operational_alerts, 0021):
--
-- * activacion: registrar un prospecto abre «Revisar activación para el portal».
-- * comision: proponer una comisión abre «Autorizar comisión …».
--
-- Las dos nacían siempre y con responsable fijo: quien hizo el trámite. Esta tabla
-- deja que la Administración de la plataforma, por operador y por tipo, decida si
-- la alerta se abre y a quién se le asigna. Sin fila, todo sigue como antes
-- (prendida y a quien hizo el trámite). Apagar un tipo no toca las alertas que ya
-- existen; las que estén abiertas se siguen cerrando solas al decidir el trámite.
--
-- Cada cambio deja su evento en la bitácora en la misma transacción
-- (alerta_configurada). Las filas no se borran: se apagan.
--
-- Aditiva: una tabla con RLS, sus permisos y sus triggers. No toca datos.

SET LOCAL lock_timeout = '2s';

SET search_path TO public;

CREATE TABLE operational_alert_settings (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  categoria text NOT NULL,
  activa boolean NOT NULL,
  -- Vacío: la alerta se asigna a quien hizo el trámite.
  responsable_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz NOT NULL,
  CONSTRAINT operational_alert_settings_unica UNIQUE (operator_id, categoria),
  CONSTRAINT operational_alert_settings_categoria CHECK (categoria IN ('activacion', 'comision'))
);

COMMENT ON TABLE operational_alert_settings IS
  'Por operador y tipo de alerta automática: si se abre y a quién se asigna. Sin fila: prendida y a quien hizo el trámite.';

CREATE FUNCTION operational_alert_settings_no_se_borra()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'ajuste_no_se_borra';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.categoria IS DISTINCT FROM OLD.categoria THEN
    RAISE EXCEPTION 'ajuste_no_se_reescribe';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operational_alert_settings_antes_de_cambiar
BEFORE UPDATE OR DELETE ON operational_alert_settings
FOR EACH ROW EXECUTE FUNCTION operational_alert_settings_no_se_borra();
CREATE TRIGGER operational_alert_settings_no_truncate
BEFORE TRUNCATE ON operational_alert_settings
FOR EACH STATEMENT EXECUTE FUNCTION operational_alert_settings_no_se_borra();

CREATE FUNCTION operational_alert_settings_exige_rastro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT auth_exige_evento('alerta_configurada', NEW.id) THEN
    RAISE EXCEPTION 'ajuste_sin_auditoria';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER operational_alert_settings_exige_rastro
AFTER INSERT OR UPDATE ON operational_alert_settings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION operational_alert_settings_exige_rastro();

ALTER TABLE operational_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_alert_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY operational_alert_settings_sofipo ON operational_alert_settings
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());

REVOKE ALL ON operational_alert_settings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON operational_alert_settings TO plataforma_sofipo;
