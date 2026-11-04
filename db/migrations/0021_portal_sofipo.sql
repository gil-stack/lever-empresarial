-- Fase 5A. Originación operativa del portal SOFIPO.
--
-- Activar significa operativa para el portal. No es KYB, PLD, riesgo ni una
-- autorización para mover dinero. Este archivo configura reglas; no crea cargos,
-- devengos, facturas, conciliación ni movimientos SPEI.

SET search_path TO public;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Solicitud y decisión de activación ------------------------------------------

CREATE TABLE company_activation_requests (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  decided_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  decided_at timestamptz,
  motivo text,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT company_activation_request_company
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT company_activation_requests_estado CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  CONSTRAINT company_activation_requests_otra_persona CHECK (
    decided_by IS NULL OR decided_by <> requested_by
  ),
  CONSTRAINT company_activation_requests_motivo CHECK (
    motivo IS NULL OR (
      motivo = btrim(motivo) AND char_length(motivo) BETWEEN 1 AND 500 AND motivo !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT company_activation_requests_forma CHECK (
    (estado = 'pendiente' AND decided_by IS NULL AND decided_at IS NULL)
    OR (estado IN ('aprobada', 'rechazada') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX company_activation_requests_una_pendiente
  ON company_activation_requests (company_id) WHERE estado = 'pendiente';
CREATE INDEX company_activation_requests_operator_idx
  ON company_activation_requests (operator_id, requested_at);

COMMENT ON TABLE company_activation_requests IS
  'Una persona pide la activación para el portal y otra decide. No acredita KYB, PLD ni operación de dinero.';

CREATE FUNCTION company_activation_requests_transicion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'activacion_no_se_borra';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'activacion_no_se_reescribe';
  END IF;
  IF OLD.estado <> 'pendiente' OR NEW.estado NOT IN ('aprobada', 'rechazada') THEN
    RAISE EXCEPTION 'activacion_transicion_invalida';
  END IF;
  IF NEW.decided_by = OLD.requested_by THEN
    RAISE EXCEPTION 'misma_persona_en_activacion';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_activation_requests_antes_de_cerrar
BEFORE UPDATE OR DELETE ON company_activation_requests
FOR EACH ROW EXECUTE FUNCTION company_activation_requests_transicion();

CREATE TRIGGER company_activation_requests_no_truncate
BEFORE TRUNCATE ON company_activation_requests
FOR EACH STATEMENT EXECUTE FUNCTION company_activation_requests_transicion();

-- Historial de estados de la empresa ------------------------------------------

CREATE TABLE company_state_history (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  estado_anterior text,
  estado_nuevo text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_id uuid REFERENCES company_activation_requests (id) ON DELETE RESTRICT,
  ocurrido_en timestamptz NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT company_state_history_company
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT company_state_history_estados CHECK (
    (estado_anterior IS NULL AND estado_nuevo = 'prospecto' AND request_id IS NULL)
    OR (estado_anterior = 'prospecto' AND estado_nuevo = 'en_alta' AND request_id IS NOT NULL)
    OR (estado_anterior = 'en_alta' AND estado_nuevo IN ('activa', 'prospecto') AND request_id IS NOT NULL)
  )
);

CREATE INDEX company_state_history_company_idx ON company_state_history (company_id, ocurrido_en);

COMMENT ON TABLE company_state_history IS
  'Historial append-only del alta para el portal: prospecto, en_alta y activa; el rechazo vuelve a prospecto.';

CREATE FUNCTION company_state_history_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'historial_estado_no_se_reescribe';
END;
$$;

CREATE TRIGGER company_state_history_no_update
BEFORE UPDATE OR DELETE ON company_state_history
FOR EACH ROW EXECUTE FUNCTION company_state_history_append_only();
CREATE TRIGGER company_state_history_no_truncate
BEFORE TRUNCATE ON company_state_history
FOR EACH STATEMENT EXECUTE FUNCTION company_state_history_append_only();

CREATE FUNCTION companies_transicion_operativa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.estado = 'prospecto' AND NEW.estado = 'en_alta')
    OR (OLD.estado = 'en_alta' AND NEW.estado IN ('activa', 'prospecto'))
  ) THEN
    RAISE EXCEPTION 'estado_operativo_transicion_invalida';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_transicion_operativa
BEFORE UPDATE OF estado ON companies
FOR EACH ROW EXECUTE FUNCTION companies_transicion_operativa();

CREATE FUNCTION companies_exige_origen_operativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accion text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.estado = 'prospecto' THEN
    IF NOT EXISTS (
      SELECT 1 FROM company_state_history h
      WHERE h.company_id = NEW.id AND h.estado_anterior IS NULL
        AND h.estado_nuevo = 'prospecto' AND h.actor_id = app_usuario()
        AND h.txid = txid_current()
    ) OR NOT auth_exige_evento('prospecto_registrado', NEW.id) THEN
      RAISE EXCEPTION 'prospecto_sin_origen_transaccional';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    accion := CASE NEW.estado
      WHEN 'en_alta' THEN 'activacion_solicitada'
      WHEN 'activa' THEN 'activacion_aprobada'
      ELSE 'activacion_rechazada'
    END;
    IF NOT EXISTS (
      SELECT 1 FROM company_state_history h
      JOIN company_activation_requests r ON r.id = h.request_id
      WHERE h.company_id = NEW.id
        AND h.estado_anterior = OLD.estado AND h.estado_nuevo = NEW.estado
        AND h.actor_id = app_usuario() AND h.txid = txid_current()
        AND r.estado = CASE NEW.estado WHEN 'activa' THEN 'aprobada' WHEN 'prospecto' THEN 'rechazada' ELSE 'pendiente' END
    ) OR NOT EXISTS (
      SELECT 1 FROM company_state_history h
      WHERE h.company_id = NEW.id AND h.estado_anterior = OLD.estado
        AND h.estado_nuevo = NEW.estado AND h.txid = txid_current()
        AND auth_exige_evento(accion, h.request_id)
    ) THEN
      RAISE EXCEPTION 'estado_operativo_sin_transaccion';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER companies_exige_origen_operativo
AFTER INSERT OR UPDATE OF estado ON companies
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION companies_exige_origen_operativo();

CREATE FUNCTION company_activation_requests_exige_rastro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accion text;
  estado_esperado text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    accion := 'activacion_solicitada';
    estado_esperado := 'en_alta';
  ELSIF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NULL;
  ELSE
    accion := CASE NEW.estado WHEN 'aprobada' THEN 'activacion_aprobada' ELSE 'activacion_rechazada' END;
    estado_esperado := CASE NEW.estado WHEN 'aprobada' THEN 'activa' ELSE 'prospecto' END;
  END IF;
  IF NOT auth_exige_evento(accion, NEW.id) THEN
    RAISE EXCEPTION 'activacion_sin_auditoria';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = NEW.company_id AND c.operator_id = NEW.operator_id AND c.estado = estado_esperado
  ) THEN
    RAISE EXCEPTION 'activacion_sin_efecto';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER company_activation_requests_exige_rastro
AFTER INSERT OR UPDATE ON company_activation_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION company_activation_requests_exige_rastro();

-- Entregas de invitaciones, sin tokens ni cuerpos de correo -------------------

CREATE TABLE invitation_deliveries (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  invitation_id uuid NOT NULL REFERENCES invitations (id) ON DELETE RESTRICT,
  registrada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrada_en timestamptz NOT NULL,
  estado text NOT NULL,
  detalle text,
  CONSTRAINT invitation_deliveries_company
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT invitation_deliveries_invitation_unica UNIQUE (invitation_id),
  CONSTRAINT invitation_deliveries_estado CHECK (estado IN ('omitida_desarrollo', 'enviada', 'fallida')),
  CONSTRAINT invitation_deliveries_detalle CHECK (
    detalle IS NULL OR (detalle = btrim(detalle) AND char_length(detalle) BETWEEN 1 AND 120 AND detalle !~ '[[:cntrl:]]')
  )
);

CREATE INDEX invitation_deliveries_company_idx ON invitation_deliveries (company_id, registrada_en);

COMMENT ON TABLE invitation_deliveries IS
  'Resultado honesto de cada intento de entrega. Nunca guarda token, enlace, contraseña ni contenido del correo.';

CREATE FUNCTION invitation_deliveries_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'entrega_invitacion_no_se_reescribe';
END;
$$;

CREATE TRIGGER invitation_deliveries_no_update
BEFORE UPDATE OR DELETE ON invitation_deliveries
FOR EACH ROW EXECUTE FUNCTION invitation_deliveries_append_only();
CREATE TRIGGER invitation_deliveries_no_truncate
BEFORE TRUNCATE ON invitation_deliveries
FOR EACH STATEMENT EXECUTE FUNCTION invitation_deliveries_append_only();

CREATE FUNCTION invitation_deliveries_exige_rastro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT auth_exige_evento('invitacion_entrega_registrada', NEW.id) THEN
    RAISE EXCEPTION 'entrega_sin_auditoria';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER invitation_deliveries_exige_rastro
AFTER INSERT ON invitation_deliveries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION invitation_deliveries_exige_rastro();

-- Alertas operativas -----------------------------------------------------------

CREATE TABLE operational_alerts (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  categoria text NOT NULL,
  titulo text NOT NULL,
  detalle text NOT NULL,
  responsable_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'abierta',
  cerrada_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  cerrada_en timestamptz,
  motivo_cierre text,
  CONSTRAINT operational_alerts_company
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT operational_alerts_categoria CHECK (categoria IN ('activacion', 'invitacion', 'comision', 'operativa')),
  CONSTRAINT operational_alerts_titulo CHECK (
    titulo = btrim(titulo) AND char_length(titulo) BETWEEN 1 AND 160 AND titulo !~ '[[:cntrl:]]'
  ),
  CONSTRAINT operational_alerts_detalle CHECK (
    detalle = btrim(detalle) AND char_length(detalle) BETWEEN 1 AND 500 AND detalle !~ '[[:cntrl:]]'
  ),
  CONSTRAINT operational_alerts_estado CHECK (estado IN ('abierta', 'cerrada')),
  CONSTRAINT operational_alerts_cierre CHECK (
    (estado = 'abierta' AND cerrada_por IS NULL AND cerrada_en IS NULL AND motivo_cierre IS NULL)
    OR (estado = 'cerrada' AND cerrada_por IS NOT NULL AND cerrada_en IS NOT NULL
      AND motivo_cierre = btrim(motivo_cierre)
      AND char_length(motivo_cierre) BETWEEN 1 AND 500 AND motivo_cierre !~ '[[:cntrl:]]')
  )
);

CREATE INDEX operational_alerts_operator_idx ON operational_alerts (operator_id, estado, creada_en);
CREATE INDEX operational_alerts_company_idx ON operational_alerts (company_id, estado, creada_en);

CREATE FUNCTION operational_alerts_solo_avanza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'alerta_no_se_borra';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.categoria IS DISTINCT FROM OLD.categoria
    OR NEW.titulo IS DISTINCT FROM OLD.titulo
    OR NEW.detalle IS DISTINCT FROM OLD.detalle
    OR NEW.creada_por IS DISTINCT FROM OLD.creada_por
    OR NEW.creada_en IS DISTINCT FROM OLD.creada_en THEN
    RAISE EXCEPTION 'alerta_no_se_reescribe';
  END IF;
  IF OLD.estado = 'cerrada' THEN
    RAISE EXCEPTION 'alerta_ya_cerrada';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operational_alerts_antes_de_avanzar
BEFORE UPDATE OR DELETE ON operational_alerts
FOR EACH ROW EXECUTE FUNCTION operational_alerts_solo_avanza();
CREATE TRIGGER operational_alerts_no_truncate
BEFORE TRUNCATE ON operational_alerts
FOR EACH STATEMENT EXECUTE FUNCTION operational_alerts_solo_avanza();

CREATE FUNCTION operational_alerts_exige_rastro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT auth_exige_evento('alerta_creada', NEW.id) THEN
    RAISE EXCEPTION 'alerta_sin_auditoria';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.responsable_id IS DISTINCT FROM OLD.responsable_id
      AND NOT auth_exige_evento('alerta_asignada', NEW.id) THEN
      RAISE EXCEPTION 'alerta_sin_auditoria';
    END IF;
    IF NEW.estado = 'cerrada' AND OLD.estado = 'abierta'
      AND NOT auth_exige_evento('alerta_cerrada', NEW.id) THEN
      RAISE EXCEPTION 'alerta_sin_auditoria';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER operational_alerts_exige_rastro
AFTER INSERT OR UPDATE ON operational_alerts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION operational_alerts_exige_rastro();

-- Comisiones configuradas, versionadas y con doble autorización ---------------

CREATE TABLE company_commissions (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  tipo text NOT NULL,
  valor bigint NOT NULL,
  moneda text,
  vigente_desde date NOT NULL,
  vigente_hasta date,
  estado text NOT NULL DEFAULT 'pendiente',
  solicitada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  solicitada_en timestamptz NOT NULL,
  decidida_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  decidida_en timestamptz,
  motivo text,
  CONSTRAINT company_commissions_company
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT company_commissions_tipo CHECK (tipo IN ('fondeo', 'spei')),
  CONSTRAINT company_commissions_dinero_entero CHECK (
    (tipo = 'fondeo' AND moneda IS NULL AND valor BETWEEN 0 AND 10000)
    OR (tipo = 'spei' AND moneda = 'MXN' AND valor BETWEEN 0 AND 9007199254740991)
  ),
  CONSTRAINT company_commissions_estado CHECK (estado IN ('pendiente', 'vigente', 'rechazada', 'cerrada')),
  CONSTRAINT company_commissions_otra_persona CHECK (
    decidida_por IS NULL OR decidida_por <> solicitada_por
  ),
  CONSTRAINT company_commissions_vigencia CHECK (
    vigente_hasta IS NULL OR vigente_hasta >= vigente_desde
  ),
  CONSTRAINT company_commissions_motivo CHECK (
    motivo IS NULL OR (motivo = btrim(motivo) AND char_length(motivo) BETWEEN 1 AND 500 AND motivo !~ '[[:cntrl:]]')
  ),
  CONSTRAINT company_commissions_forma CHECK (
    (estado = 'pendiente' AND decidida_por IS NULL AND decidida_en IS NULL AND vigente_hasta IS NULL)
    OR (estado = 'vigente' AND decidida_por IS NOT NULL AND decidida_en IS NOT NULL AND vigente_hasta IS NULL)
    OR (estado = 'rechazada' AND decidida_por IS NOT NULL AND decidida_en IS NOT NULL AND vigente_hasta IS NULL)
    OR (estado = 'cerrada' AND decidida_por IS NOT NULL AND decidida_en IS NOT NULL AND vigente_hasta IS NOT NULL)
  ),
  CONSTRAINT company_commissions_sin_solape EXCLUDE USING gist (
    company_id WITH =,
    tipo WITH =,
    daterange(vigente_desde, vigente_hasta, '[]') WITH &&
  ) WHERE (estado IN ('vigente', 'cerrada'))
);

CREATE UNIQUE INDEX company_commissions_una_pendiente
  ON company_commissions (company_id, tipo) WHERE estado = 'pendiente';
CREATE INDEX company_commissions_company_idx
  ON company_commissions (company_id, tipo, vigente_desde);

COMMENT ON TABLE company_commissions IS
  'Configuración comercial, no cargos. fondeo: basis points enteros; spei: centavos MXN enteros. Dos personas y vigencias sin solape.';
COMMENT ON COLUMN company_commissions.valor IS
  'Entero. Basis points para fondeo; centavos MXN para spei. Nunca un importe calculado ni un cargo.';

CREATE FUNCTION company_commissions_solo_avanza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'comision_no_se_borra';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.tipo IS DISTINCT FROM OLD.tipo
    OR NEW.valor IS DISTINCT FROM OLD.valor
    OR NEW.moneda IS DISTINCT FROM OLD.moneda
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.solicitada_por IS DISTINCT FROM OLD.solicitada_por
    OR NEW.solicitada_en IS DISTINCT FROM OLD.solicitada_en THEN
    RAISE EXCEPTION 'comision_no_se_reescribe';
  END IF;
  IF OLD.estado = 'pendiente' THEN
    IF NEW.estado NOT IN ('vigente', 'rechazada') OR NEW.decidida_por = OLD.solicitada_por THEN
      RAISE EXCEPTION 'comision_transicion_invalida';
    END IF;
  ELSIF OLD.estado = 'vigente' THEN
    IF NEW.estado <> 'cerrada' OR NEW.vigente_hasta IS NULL
      OR NEW.decidida_por IS DISTINCT FROM OLD.decidida_por
      OR NEW.decidida_en IS DISTINCT FROM OLD.decidida_en THEN
      RAISE EXCEPTION 'comision_transicion_invalida';
    END IF;
  ELSE
    RAISE EXCEPTION 'comision_ya_cerrada';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_commissions_antes_de_avanzar
BEFORE UPDATE OR DELETE ON company_commissions
FOR EACH ROW EXECUTE FUNCTION company_commissions_solo_avanza();
CREATE TRIGGER company_commissions_no_truncate
BEFORE TRUNCATE ON company_commissions
FOR EACH STATEMENT EXECUTE FUNCTION company_commissions_solo_avanza();

CREATE FUNCTION company_commissions_exige_rastro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accion text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    accion := 'comision_solicitada';
  ELSIF NEW.estado = OLD.estado THEN
    RETURN NULL;
  ELSE
    accion := CASE NEW.estado
      WHEN 'vigente' THEN 'comision_aprobada'
      WHEN 'rechazada' THEN 'comision_rechazada'
      ELSE 'comision_cerrada'
    END;
  END IF;
  IF NOT auth_exige_evento(accion, NEW.id) THEN
    RAISE EXCEPTION 'comision_sin_auditoria';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER company_commissions_exige_rastro
AFTER INSERT OR UPDATE ON company_commissions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION company_commissions_exige_rastro();

-- El personal puede mostrar nombres de sus compañeros y de los administradores
-- de empresas de su operador. Sigue sin ver usuarios de otros operadores.
CREATE POLICY users_sofipo_operacion ON users FOR SELECT TO plataforma_sofipo
USING (
  app_operador() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM platform_staff s
      WHERE s.user_id = users.id AND s.operator_id = app_operador()
    ) OR EXISTS (
      SELECT 1 FROM memberships m
      JOIN companies c ON c.id = m.company_id
      WHERE m.user_id = users.id AND c.operator_id = app_operador()
    )
  )
);

-- RLS, incluida la segunda pared para el dueño --------------------------------

ALTER TABLE company_activation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_state_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_commissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE company_activation_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE company_state_history FORCE ROW LEVEL SECURITY;
ALTER TABLE invitation_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE company_commissions FORCE ROW LEVEL SECURITY;

CREATE POLICY company_activation_requests_sofipo ON company_activation_requests
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY company_state_history_sofipo ON company_state_history
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY invitation_deliveries_sofipo ON invitation_deliveries
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY operational_alerts_sofipo ON operational_alerts
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY company_commissions_sofipo ON company_commissions
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());

GRANT SELECT, INSERT, UPDATE ON company_activation_requests TO plataforma_sofipo;
GRANT SELECT, INSERT ON company_state_history TO plataforma_sofipo;
GRANT SELECT, INSERT ON invitation_deliveries TO plataforma_sofipo;
GRANT SELECT, INSERT, UPDATE ON operational_alerts TO plataforma_sofipo;
GRANT SELECT, INSERT, UPDATE ON company_commissions TO plataforma_sofipo;

REVOKE DELETE, TRUNCATE ON company_activation_requests, company_state_history,
  invitation_deliveries, operational_alerts, company_commissions FROM PUBLIC;
