-- Runway a 12 meses y alertas de caja: el mínimo de meses que elige la
-- empresa, el estado de sus dos alertas, cada aviso con su correo y una foto
-- del runway por semana. Nada de esto mueve dinero ni afirma un saldo del
-- banco: se calcula con el saldo que declara la empresa y lo registrado.

SET search_path TO public;

-- Mínimo de meses -----------------------------------------------------------------
-- Sin fila, el mínimo es de 3 meses. Lo cambian administración y finanzas.

CREATE TABLE cash_runway_settings (
  company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,
  meses_minimos smallint NOT NULL,
  actualizado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_runway_meses CHECK (meses_minimos BETWEEN 1 AND 12)
);

COMMENT ON TABLE cash_runway_settings IS
  'Mínimo de meses de runway: el aviso sale cuando el runway conservador baja de este número. Sin fila: 3.';

CREATE FUNCTION cash_runway_settings_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'configuracion_no_se_borra';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'configuracion_inmutable';
  END IF;
  IF NOT flujo_editor(NEW.company_id) OR NEW.actualizado_por IS DISTINCT FROM app_usuario() THEN
    RAISE EXCEPTION 'sin_permiso_para_flujo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_runway_settings_revisar
BEFORE INSERT OR UPDATE OR DELETE ON cash_runway_settings
FOR EACH ROW EXECUTE FUNCTION cash_runway_settings_revisar();

-- Lo que escribe solo la tarea ---------------------------------------------------
-- Estado, avisos, entregas y fotos: sin persona en el contexto (app_usuario()
-- nulo) y con la empresa en el contexto. Nadie los borra.

CREATE FUNCTION caja_solo_del_sistema()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'alerta_no_se_borra';
  END IF;
  IF app_usuario() IS NOT NULL THEN
    RAISE EXCEPTION 'alerta_solo_del_sistema';
  END IF;
  RETURN NEW;
END;
$$;

-- Estado de las dos alertas por empresa. Solo se escribe cuando cambia.
CREATE TABLE cash_alert_states (
  company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,
  bajo_colchon boolean NOT NULL,
  runway_bajo boolean NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cash_alert_states IS
  'Si la empresa está debajo de su colchón (proyección de 13 semanas) y si su runway conservador está debajo de su mínimo. Un aviso por cada vez que una de las dos se enciende.';

CREATE FUNCTION cash_alert_states_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'alerta_inmutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_alert_states_sistema
BEFORE INSERT OR UPDATE OR DELETE ON cash_alert_states
FOR EACH ROW EXECUTE FUNCTION caja_solo_del_sistema();
CREATE TRIGGER cash_alert_states_revisar
BEFORE UPDATE ON cash_alert_states
FOR EACH ROW EXECUTE FUNCTION cash_alert_states_revisar();

-- Un aviso por cruce: las condiciones que se encendieron en la misma corrida
-- van juntas en un solo correo. Se aparta como «enviando» antes de mandar; una
-- segunda corrida no encuentra nada que apartar.
CREATE TABLE cash_alerts (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  colchon boolean NOT NULL,
  runway boolean NOT NULL,
  -- La semana con faltante de la proyección de 13 semanas, cuando cruzó el colchón.
  faltante_inicio date,
  faltante_saldo_centavos bigint,
  faltante_motivo text,
  colchon_centavos bigint NOT NULL,
  -- El runway conservador en semanas (horizonte = «12 meses o más»), cuando cruzó el mínimo.
  runway_semanas smallint,
  horizonte_semanas smallint NOT NULL,
  meses_minimos smallint NOT NULL,
  estado text NOT NULL,
  destinatarios integer NOT NULL DEFAULT 0,
  intentos smallint NOT NULL DEFAULT 1,
  codigo text,
  detectado_en timestamptz NOT NULL DEFAULT now(),
  intentado_en timestamptz NOT NULL DEFAULT now(),
  terminado_en timestamptz,
  CONSTRAINT cash_alerts_id_empresa UNIQUE (id, company_id),
  CONSTRAINT cash_alerts_alguna CHECK (colchon OR runway),
  CONSTRAINT cash_alerts_faltante CHECK (
    (colchon AND faltante_inicio IS NOT NULL AND faltante_saldo_centavos IS NOT NULL AND faltante_motivo IN ('negativo', 'colchon')
      AND extract(isodow FROM faltante_inicio) = 1)
    OR (NOT colchon AND faltante_inicio IS NULL AND faltante_saldo_centavos IS NULL AND faltante_motivo IS NULL)
  ),
  CONSTRAINT cash_alerts_runway CHECK (
    (runway AND runway_semanas IS NOT NULL AND runway_semanas BETWEEN 0 AND horizonte_semanas)
    OR (NOT runway AND runway_semanas IS NULL)
  ),
  CONSTRAINT cash_alerts_colchon CHECK (colchon_centavos BETWEEN 0 AND 9000000000000000),
  CONSTRAINT cash_alerts_horizonte CHECK (horizonte_semanas BETWEEN 52 AND 56),
  CONSTRAINT cash_alerts_meses CHECK (meses_minimos BETWEEN 1 AND 12),
  CONSTRAINT cash_alerts_estado CHECK (estado IN ('enviando', 'enviado', 'fallido', 'simulado', 'sin_destinatarios', 'descartado')),
  CONSTRAINT cash_alerts_cierre CHECK ((estado = 'enviando') = (terminado_en IS NULL)),
  CONSTRAINT cash_alerts_destinatarios CHECK (destinatarios >= 0),
  CONSTRAINT cash_alerts_intentos CHECK (intentos BETWEEN 1 AND 5),
  CONSTRAINT cash_alerts_codigo CHECK (codigo IS NULL OR codigo ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE INDEX cash_alerts_empresa ON cash_alerts (company_id, detectado_en DESC, id);
CREATE INDEX cash_alerts_reintento ON cash_alerts (company_id, estado, intentado_en) WHERE estado IN ('enviando', 'fallido');

COMMENT ON TABLE cash_alerts IS
  'Aviso de caja: el cruce del colchón, del mínimo de meses o de los dos, con las cifras de ese momento y el estado de su correo. No guarda el correo.';

CREATE FUNCTION cash_alerts_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado NOT IN ('enviando', 'simulado') OR NEW.intentos <> 1 OR NEW.destinatarios <> 0 THEN
      RAISE EXCEPTION 'alerta_no_valida';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.colchon, NEW.runway, NEW.faltante_inicio, NEW.faltante_saldo_centavos, NEW.faltante_motivo,
      NEW.colchon_centavos, NEW.runway_semanas, NEW.horizonte_semanas, NEW.meses_minimos, NEW.detectado_en)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.colchon, OLD.runway, OLD.faltante_inicio, OLD.faltante_saldo_centavos, OLD.faltante_motivo,
      OLD.colchon_centavos, OLD.runway_semanas, OLD.horizonte_semanas, OLD.meses_minimos, OLD.detectado_en)
  THEN
    RAISE EXCEPTION 'alerta_inmutable';
  END IF;
  -- enviando → enviado | fallido | sin_destinatarios; fallido → enviando (otro intento) | descartado.
  IF NOT (
    (OLD.estado = 'enviando' AND NEW.estado IN ('enviado', 'fallido', 'sin_destinatarios') AND NEW.intentos = OLD.intentos)
    OR (OLD.estado = 'fallido' AND NEW.estado = 'enviando' AND NEW.intentos = OLD.intentos + 1)
    OR (OLD.estado = 'fallido' AND NEW.estado = 'descartado' AND NEW.intentos = OLD.intentos)
  ) THEN
    RAISE EXCEPTION 'alerta_ya_cerrada';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_alerts_sistema
BEFORE INSERT OR UPDATE OR DELETE ON cash_alerts
FOR EACH ROW EXECUTE FUNCTION caja_solo_del_sistema();
CREATE TRIGGER cash_alerts_revisar
BEFORE INSERT OR UPDATE ON cash_alerts
FOR EACH ROW EXECUTE FUNCTION cash_alerts_revisar();

-- A quién ya le llegó el aviso. La llave del proveedor dura 24 horas; esta fila
-- no vence. No guarda la dirección.
CREATE TABLE cash_alert_deliveries (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  alert_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  entregado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_alert_deliveries_aviso
    FOREIGN KEY (alert_id, company_id) REFERENCES cash_alerts (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT cash_alert_deliveries_unica UNIQUE (alert_id, user_id)
);

COMMENT ON TABLE cash_alert_deliveries IS
  'A quién ya le llegó un aviso de caja. Lo escribe la tarea; solo inserción.';

CREATE FUNCTION caja_solo_insercion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'registro_no_se_reescribe';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_alert_deliveries_sistema
BEFORE INSERT OR UPDATE OR DELETE ON cash_alert_deliveries
FOR EACH ROW EXECUTE FUNCTION caja_solo_del_sistema();
CREATE TRIGGER cash_alert_deliveries_insercion
BEFORE UPDATE ON cash_alert_deliveries
FOR EACH ROW EXECUTE FUNCTION caja_solo_insercion();

-- Una foto del runway por empresa y semana (lunes, hora de México). La toma la
-- primera corrida de la semana; correr otra vez no crea ni reescribe nada.
CREATE TABLE cash_runway_snapshots (
  id uuid NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  semana date NOT NULL,
  -- Semanas de runway (horizonte = «12 meses o más»).
  semanas_conservador smallint NOT NULL,
  semanas_esperado smallint NOT NULL,
  horizonte_semanas smallint NOT NULL,
  saldo_centavos bigint NOT NULL,
  saldo_al_dia date NOT NULL,
  colchon_centavos bigint NOT NULL,
  meses_minimos smallint NOT NULL,
  tomada_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, semana),
  CONSTRAINT cash_runway_snapshots_lunes CHECK (extract(isodow FROM semana) = 1),
  CONSTRAINT cash_runway_snapshots_horizonte CHECK (horizonte_semanas BETWEEN 52 AND 56),
  CONSTRAINT cash_runway_snapshots_semanas CHECK (
    semanas_conservador BETWEEN 0 AND horizonte_semanas
    AND semanas_esperado BETWEEN semanas_conservador AND horizonte_semanas
  ),
  CONSTRAINT cash_runway_snapshots_saldo CHECK (saldo_centavos BETWEEN 0 AND 9000000000000000 AND saldo_al_dia >= DATE '2000-01-01'),
  CONSTRAINT cash_runway_snapshots_colchon CHECK (colchon_centavos BETWEEN 0 AND 9000000000000000),
  CONSTRAINT cash_runway_snapshots_meses CHECK (meses_minimos BETWEEN 1 AND 12)
);

COMMENT ON TABLE cash_runway_snapshots IS
  'Foto semanal del runway conservador y esperado con el saldo, el colchón y el mínimo de ese momento. Solo inserción.';

CREATE TRIGGER cash_runway_snapshots_sistema
BEFORE INSERT OR UPDATE OR DELETE ON cash_runway_snapshots
FOR EACH ROW EXECUTE FUNCTION caja_solo_del_sistema();
CREATE TRIGGER cash_runway_snapshots_insercion
BEFORE UPDATE ON cash_runway_snapshots
FOR EACH ROW EXECUTE FUNCTION caja_solo_insercion();

-- La puerta de la tarea ---------------------------------------------------------------
-- La tarea (plataforma_tarea, ya autenticada con CRON_SECRET) pide solo los ids
-- de las empresas activas con al menos un saldo declarado. Sin saldo no hay
-- runway, alerta ni foto. Lo demás lo lee empresa por empresa con su contexto.
CREATE FUNCTION empresas_para_alertas_de_caja()
RETURNS TABLE (company_id uuid, operator_id uuid, demostracion boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.operator_id, c.demostracion
  FROM companies c
  WHERE c.estado = 'activa'
    AND c.operator_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM cash_balance_declarations d WHERE d.company_id = c.id)
  ORDER BY c.id
$$;

REVOKE ALL ON FUNCTION empresas_para_alertas_de_caja() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION empresas_para_alertas_de_caja() TO plataforma_tarea;

-- Toda escritura deja su evento en la misma transacción ---------------------------
-- Apartar el correo de un aviso (enviando) no se audita: la transición del
-- estado ya dejó el suyo. Cerrarlo, sí.

CREATE FUNCTION caja_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  esperada text;
  fila_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'cash_runway_settings' THEN
    esperada := 'configurar_runway'; fila_id := NEW.company_id;
  ELSIF TG_TABLE_NAME = 'cash_alert_states' THEN
    esperada := 'estado_alerta_caja'; fila_id := NEW.company_id;
  ELSIF TG_TABLE_NAME = 'cash_alerts' THEN
    IF NEW.estado = 'enviando' THEN RETURN NULL; END IF;
    esperada := 'alerta_caja'; fila_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'cash_alert_deliveries' THEN
    esperada := 'alerta_caja_entregada'; fila_id := NEW.id;
  ELSE
    esperada := 'foto_runway'; fila_id := NEW.id;
  END IF;
  IF NOT bitacora_tiene_evento(NEW.company_id, esperada, TG_TABLE_NAME, fila_id) THEN
    RAISE EXCEPTION 'auditoria_de_flujo_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cash_runway_settings_auditoria
AFTER INSERT OR UPDATE ON cash_runway_settings DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();
CREATE CONSTRAINT TRIGGER cash_alert_states_auditoria
AFTER INSERT OR UPDATE ON cash_alert_states DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();
CREATE CONSTRAINT TRIGGER cash_alerts_auditoria
AFTER INSERT OR UPDATE ON cash_alerts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();
CREATE CONSTRAINT TRIGGER cash_alert_deliveries_auditoria
AFTER INSERT ON cash_alert_deliveries DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();
CREATE CONSTRAINT TRIGGER cash_runway_snapshots_auditoria
AFTER INSERT ON cash_runway_snapshots DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();

-- Permisos mínimos y RLS --------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON cash_runway_settings TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON cash_alert_states TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON cash_alerts TO plataforma_cliente;
GRANT SELECT, INSERT ON cash_alert_deliveries TO plataforma_cliente;
GRANT SELECT, INSERT ON cash_runway_snapshots TO plataforma_cliente;

ALTER TABLE cash_runway_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_alert_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_runway_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_runway_settings_cliente ON cash_runway_settings FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY cash_alert_states_cliente ON cash_alert_states FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY cash_alerts_cliente ON cash_alerts FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY cash_alert_deliveries_cliente ON cash_alert_deliveries FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY cash_runway_snapshots_cliente ON cash_runway_snapshots FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());

ALTER TABLE cash_runway_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_alert_states FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_alert_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_runway_snapshots FORCE ROW LEVEL SECURITY;
