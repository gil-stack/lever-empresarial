-- Flujo de caja: saldo declarado, cobros esperados, obligaciones recurrentes,
-- colchón, área del proveedor y correo semanal. Nada de esto mueve dinero ni
-- afirma un saldo del banco: el saldo lo declara la empresa, con fecha y autor.

SET search_path TO public;

-- Las tablas nuevas apuntan al área con la empresa en la llave, como el resto.
ALTER TABLE cost_centers ADD CONSTRAINT cost_centers_id_empresa UNIQUE (id, company_id);

-- Quién edita el flujo: administración y finanzas vigentes de la empresa del
-- contexto. La aplicación lo exige con cliente.flujo.editar; la base, aquí.
CREATE FUNCTION flujo_editor(p_company uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT app_usuario() IS NOT NULL
    AND cliente_tiene_rol_operativo(p_company, app_usuario(), ARRAY['administrador', 'finanzas'])
$$;

REVOKE ALL ON FUNCTION flujo_editor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flujo_editor(uuid) TO plataforma_cliente;

-- Área del proveedor --------------------------------------------------------------
-- Opcional. Sirve para sumar sus pagos al presupuesto del área.

ALTER TABLE suppliers ADD COLUMN cost_center_id uuid;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_area
  FOREIGN KEY (cost_center_id, company_id) REFERENCES cost_centers (id, company_id) ON DELETE RESTRICT;
CREATE INDEX suppliers_area_idx ON suppliers (company_id, cost_center_id) WHERE cost_center_id IS NOT NULL;

COMMENT ON COLUMN suppliers.cost_center_id IS
  'Área a la que se cargan los pagos del proveedor en Presupuestos. Vacío: sin área.';

-- Cambiar el área después del alta es de administración o finanzas y deja su evento.
CREATE FUNCTION suppliers_area_auditada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT flujo_editor(NEW.company_id) THEN
    RAISE EXCEPTION 'sin_permiso_para_flujo';
  END IF;
  IF NOT bitacora_tiene_evento(NEW.company_id, 'asignar_area_proveedor', 'suppliers', NEW.id) THEN
    RAISE EXCEPTION 'auditoria_de_area_proveedor_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER suppliers_area_auditada
AFTER UPDATE OF cost_center_id ON suppliers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.cost_center_id IS DISTINCT FROM NEW.cost_center_id)
EXECUTE FUNCTION suppliers_area_auditada();

-- Saldo declarado -----------------------------------------------------------------
-- Cada declaración es una fila nueva: el historial no se pisa ni se borra.

CREATE TABLE cash_balance_declarations (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  saldo_centavos bigint NOT NULL,
  al_dia date NOT NULL,
  declarado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  declarado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_balance_saldo CHECK (saldo_centavos BETWEEN 0 AND 9000000000000000),
  CONSTRAINT cash_balance_fecha CHECK (al_dia >= DATE '2000-01-01')
);

CREATE INDEX cash_balance_declarations_ultimo
  ON cash_balance_declarations (company_id, al_dia DESC, declarado_en DESC, id);

COMMENT ON TABLE cash_balance_declarations IS
  'Saldo en bancos que declara una persona autorizada. No es un saldo confirmado por el banco. Solo inserción.';

CREATE FUNCTION cash_balance_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'saldo_declarado_no_se_pisa';
  END IF;
  IF NEW.declarado_por IS DISTINCT FROM app_usuario() OR NOT flujo_editor(NEW.company_id) THEN
    RAISE EXCEPTION 'sin_permiso_para_flujo';
  END IF;
  IF NEW.al_dia > (timezone('America/Mexico_City', clock_timestamp()))::date THEN
    RAISE EXCEPTION 'saldo_con_fecha_futura';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_balance_revisar
BEFORE INSERT OR UPDATE OR DELETE ON cash_balance_declarations
FOR EACH ROW EXECUTE FUNCTION cash_balance_revisar();

-- Cobros esperados ----------------------------------------------------------------
-- esperado -> cobrado (con fecha real) o cancelado (con motivo). Vencido no es
-- un estado: es un cobro esperado cuya fecha probable ya pasó.

CREATE TABLE expected_collections (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  origen text NOT NULL,
  cliente_nombre text NOT NULL,
  cliente_rfc text,
  concepto text NOT NULL,
  monto_centavos bigint NOT NULL,
  fecha_probable date NOT NULL,
  referencia text,
  cfdi_uuid text,
  estado text NOT NULL DEFAULT 'esperado',
  cobrado_el date,
  motivo_cancelacion text,
  creado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  resuelto_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  resuelto_en timestamptz,
  CONSTRAINT expected_collections_origen CHECK (origen IN ('manual', 'cfdi')),
  CONSTRAINT expected_collections_cliente CHECK (
    cliente_nombre = btrim(cliente_nombre) AND char_length(cliente_nombre) BETWEEN 1 AND 254
    AND cliente_nombre !~ '[[:cntrl:]]'
  ),
  CONSTRAINT expected_collections_rfc CHECK (
    cliente_rfc IS NULL OR cliente_rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'
  ),
  CONSTRAINT expected_collections_concepto CHECK (
    concepto = btrim(concepto) AND char_length(concepto) BETWEEN 1 AND 200 AND concepto !~ '[[:cntrl:]]'
  ),
  CONSTRAINT expected_collections_referencia CHECK (
    referencia IS NULL OR (referencia = btrim(referencia) AND char_length(referencia) BETWEEN 1 AND 120 AND referencia !~ '[[:cntrl:]]')
  ),
  CONSTRAINT expected_collections_monto CHECK (monto_centavos > 0 AND monto_centavos <= 9000000000000000),
  CONSTRAINT expected_collections_fecha CHECK (fecha_probable >= DATE '2000-01-01'),
  CONSTRAINT expected_collections_cfdi CHECK (
    (origen = 'cfdi' AND cfdi_uuid ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$')
    OR (origen = 'manual' AND cfdi_uuid IS NULL)
  ),
  CONSTRAINT expected_collections_estado CHECK (
    (estado = 'esperado' AND cobrado_el IS NULL AND motivo_cancelacion IS NULL AND resuelto_por IS NULL AND resuelto_en IS NULL)
    OR (estado = 'cobrado' AND cobrado_el IS NOT NULL AND motivo_cancelacion IS NULL AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL)
    OR (estado = 'cancelado' AND cobrado_el IS NULL AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL
        AND motivo_cancelacion = btrim(motivo_cancelacion) AND char_length(motivo_cancelacion) BETWEEN 5 AND 500
        AND motivo_cancelacion !~ '[[:cntrl:]]')
  )
);

-- Una factura emitida se registra una vez mientras su cobro siga vivo.
CREATE UNIQUE INDEX expected_collections_cfdi_unico
  ON expected_collections (company_id, cfdi_uuid) WHERE cfdi_uuid IS NOT NULL AND estado <> 'cancelado';
CREATE INDEX expected_collections_agenda
  ON expected_collections (company_id, estado, fecha_probable, id);

COMMENT ON TABLE expected_collections IS
  'Dinero que la empresa espera cobrar. Lo registra la empresa; no es un abono confirmado.';

CREATE FUNCTION expected_collections_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cobro_no_se_borra';
  END IF;
  IF NOT flujo_editor(NEW.company_id) THEN
    RAISE EXCEPTION 'sin_permiso_para_flujo';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.creado_por IS DISTINCT FROM app_usuario() OR NEW.estado <> 'esperado' THEN
      RAISE EXCEPTION 'cobro_no_valido';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.origen, NEW.cliente_nombre, NEW.cliente_rfc, NEW.concepto, NEW.monto_centavos,
      NEW.fecha_probable, NEW.referencia, NEW.cfdi_uuid, NEW.creado_por, NEW.creado_en)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.origen, OLD.cliente_nombre, OLD.cliente_rfc, OLD.concepto, OLD.monto_centavos,
      OLD.fecha_probable, OLD.referencia, OLD.cfdi_uuid, OLD.creado_por, OLD.creado_en)
  THEN
    RAISE EXCEPTION 'cobro_inmutable';
  END IF;
  IF OLD.estado <> 'esperado' OR NEW.estado NOT IN ('cobrado', 'cancelado')
    OR NEW.resuelto_por IS DISTINCT FROM app_usuario()
  THEN
    RAISE EXCEPTION 'cobro_ya_resuelto';
  END IF;
  IF NEW.estado = 'cobrado' AND NEW.cobrado_el > (timezone('America/Mexico_City', clock_timestamp()))::date THEN
    RAISE EXCEPTION 'cobro_con_fecha_futura';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expected_collections_revisar
BEFORE INSERT OR UPDATE OR DELETE ON expected_collections
FOR EACH ROW EXECUTE FUNCTION expected_collections_revisar();

-- Obligaciones recurrentes --------------------------------------------------------
-- Renta, software, seguros o impuestos con el monto que captura la empresa. La
-- plataforma no calcula impuestos. Desactivar una obligación la saca del flujo.

CREATE TABLE recurring_obligations (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  concepto text NOT NULL,
  monto_centavos bigint NOT NULL,
  frecuencia text NOT NULL,
  proxima_fecha date NOT NULL,
  ancla_dia smallint NOT NULL,
  cost_center_id uuid,
  activa boolean NOT NULL DEFAULT true,
  creado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_obligations_area
    FOREIGN KEY (cost_center_id, company_id) REFERENCES cost_centers (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT recurring_obligations_concepto CHECK (
    concepto = btrim(concepto) AND char_length(concepto) BETWEEN 1 AND 120 AND concepto !~ '[[:cntrl:]]'
  ),
  CONSTRAINT recurring_obligations_monto CHECK (monto_centavos > 0 AND monto_centavos <= 9000000000000000),
  CONSTRAINT recurring_obligations_frecuencia CHECK (frecuencia IN ('semanal', 'mensual', 'bimestral', 'trimestral', 'anual')),
  CONSTRAINT recurring_obligations_ancla CHECK (ancla_dia BETWEEN 1 AND 31),
  CONSTRAINT recurring_obligations_fecha CHECK (proxima_fecha >= DATE '2000-01-01')
);

CREATE INDEX recurring_obligations_empresa
  ON recurring_obligations (company_id, activa, proxima_fecha, id);

COMMENT ON TABLE recurring_obligations IS
  'Salida que se repite con la frecuencia y el monto que captura la empresa. proxima_fecha es la base del calendario.';

CREATE FUNCTION recurring_obligations_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'obligacion_no_se_borra';
  END IF;
  IF NOT flujo_editor(NEW.company_id) OR NEW.actualizado_por IS DISTINCT FROM app_usuario() THEN
    RAISE EXCEPTION 'sin_permiso_para_flujo';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.creado_por IS DISTINCT FROM app_usuario() OR NOT NEW.activa THEN
      RAISE EXCEPTION 'obligacion_no_valida';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.creado_por, NEW.creado_en)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.creado_por, OLD.creado_en)
  THEN
    RAISE EXCEPTION 'obligacion_inmutable';
  END IF;
  IF NOT OLD.activa THEN
    RAISE EXCEPTION 'obligacion_inactiva';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recurring_obligations_revisar
BEFORE INSERT OR UPDATE OR DELETE ON recurring_obligations
FOR EACH ROW EXECUTE FUNCTION recurring_obligations_revisar();

-- Colchón de la empresa -----------------------------------------------------------

CREATE TABLE cash_flow_settings (
  company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,
  colchon_centavos bigint NOT NULL,
  actualizado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_flow_colchon CHECK (colchon_centavos BETWEEN 0 AND 9000000000000000)
);

COMMENT ON TABLE cash_flow_settings IS
  'Colchón: la alerta de faltante avisa cuando el saldo proyectado queda por debajo de este monto.';

CREATE FUNCTION cash_flow_settings_revisar()
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

CREATE TRIGGER cash_flow_settings_revisar
BEFORE INSERT OR UPDATE OR DELETE ON cash_flow_settings
FOR EACH ROW EXECUTE FUNCTION cash_flow_settings_revisar();

-- Correo semanal ------------------------------------------------------------------
-- Preferencia por persona. Sin fila, administración y finanzas lo reciben y
-- contaduría no. Cada quien cambia solo la suya.

CREATE TABLE weekly_digest_preferences (
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  activo boolean NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

COMMENT ON TABLE weekly_digest_preferences IS
  'Quién recibe el resumen del lunes. Sin fila: administración y finanzas sí, contaduría no.';

CREATE FUNCTION weekly_digest_preferences_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'preferencia_no_se_borra';
  END IF;
  IF NEW.user_id IS DISTINCT FROM app_usuario()
    OR (TG_OP = 'UPDATE' AND (NEW.company_id, NEW.user_id) IS DISTINCT FROM (OLD.company_id, OLD.user_id))
    OR NOT cliente_tiene_rol_operativo(NEW.company_id, app_usuario(), ARRAY['administrador', 'finanzas', 'contador'])
  THEN
    RAISE EXCEPTION 'sin_permiso_para_flujo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER weekly_digest_preferences_revisar
BEFORE INSERT OR UPDATE OR DELETE ON weekly_digest_preferences
FOR EACH ROW EXECUTE FUNCTION weekly_digest_preferences_revisar();

-- Un envío por empresa y semana. La tarea lo aparta antes de mandar: una
-- segunda llamada en la misma semana no encuentra nada que apartar. Solo un
-- envío fallido se puede volver a intentar.
CREATE TABLE weekly_digest_sends (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  semana date NOT NULL,
  estado text NOT NULL,
  destinatarios integer NOT NULL DEFAULT 0,
  codigo text,
  intentado_en timestamptz NOT NULL DEFAULT now(),
  terminado_en timestamptz,
  CONSTRAINT weekly_digest_sends_unico UNIQUE (company_id, semana),
  CONSTRAINT weekly_digest_sends_lunes CHECK (extract(isodow FROM semana) = 1),
  CONSTRAINT weekly_digest_sends_estado CHECK (estado IN ('enviando', 'enviado', 'fallido')),
  CONSTRAINT weekly_digest_sends_destinatarios CHECK (destinatarios >= 0),
  CONSTRAINT weekly_digest_sends_codigo CHECK (codigo IS NULL OR codigo ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT weekly_digest_sends_cierre CHECK ((estado = 'enviando') = (terminado_en IS NULL))
);

COMMENT ON TABLE weekly_digest_sends IS
  'Registro del correo semanal: uno por empresa y semana (lunes en hora de México). Lo escribe la tarea, no una persona.';

CREATE FUNCTION weekly_digest_sends_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'envio_no_se_borra';
  END IF;
  IF app_usuario() IS NOT NULL THEN
    RAISE EXCEPTION 'envio_solo_del_sistema';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'enviando' THEN RAISE EXCEPTION 'envio_no_valido'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.semana) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.semana)
    OR NOT (
      (OLD.estado = 'enviando' AND NEW.estado IN ('enviado', 'fallido'))
      OR (OLD.estado = 'fallido' AND NEW.estado = 'enviando')
    )
  THEN
    RAISE EXCEPTION 'envio_ya_cerrado';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER weekly_digest_sends_revisar
BEFORE INSERT OR UPDATE OR DELETE ON weekly_digest_sends
FOR EACH ROW EXECUTE FUNCTION weekly_digest_sends_revisar();

-- Rol de las tareas programadas. Solo lo usa la tarea del correo semanal, ya
-- autenticada con CRON_SECRET, y solo para pedir los ids de abajo. No lee
-- tablas: si falta el contexto en una ruta del portal (entrar, recuperar,
-- invitación), plataforma_cliente recibe 42501 en lugar de la lista.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_tarea') THEN
    CREATE ROLE plataforma_tarea NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END;
$$;

COMMENT ON ROLE plataforma_tarea IS
  'Tareas programadas (cron con CRON_SECRET). Sin BYPASSRLS ni tablas: solo ejecuta empresas_con_correo_semanal().';

-- Como 0018 y 0020 con plataforma_cliente y plataforma_sofipo: quien migra y la
-- conexión de la aplicación pueden bajar a este rol, sin heredar sus permisos.
GRANT plataforma_tarea TO CURRENT_USER;
GRANT plataforma_tarea TO plataforma_app;
GRANT USAGE ON SCHEMA public TO plataforma_tarea;

-- La única puerta sin empresa: los ids de las empresas con alguien que debe
-- recibir el correo. Solo plataforma_tarea la ejecuta. Lo demás se lee después,
-- empresa por empresa, con su contexto y RLS normal.
CREATE FUNCTION empresas_con_correo_semanal()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT m.company_id
  FROM memberships m
  JOIN companies c ON c.id = m.company_id
  JOIN membership_roles r ON r.company_id = m.company_id AND r.user_id = m.user_id
  LEFT JOIN employees e ON e.company_id = m.company_id AND e.user_id = m.user_id
  LEFT JOIN weekly_digest_preferences p ON p.company_id = m.company_id AND p.user_id = m.user_id
  WHERE c.estado = 'activa'
    AND m.estado = 'activa'
    AND r.rol IN ('administrador', 'finanzas', 'contador')
    AND (e.id IS NULL OR e.baja_en IS NULL OR e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
    AND coalesce(p.activo, r.rol IN ('administrador', 'finanzas'))
$$;

REVOKE ALL ON FUNCTION empresas_con_correo_semanal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION empresas_con_correo_semanal() TO plataforma_tarea;

-- Toda escritura deja su evento en la misma transacción -------------------------

CREATE FUNCTION flujo_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  esperada text;
  fila_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'cash_balance_declarations' THEN
    esperada := 'declarar_saldo'; fila_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'expected_collections' THEN
    esperada := CASE WHEN TG_OP = 'INSERT' THEN 'registrar_cobro'
                     WHEN NEW.estado = 'cobrado' THEN 'cobrar_cobro'
                     ELSE 'cancelar_cobro' END;
    fila_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'recurring_obligations' THEN
    esperada := CASE WHEN TG_OP = 'INSERT' THEN 'registrar_obligacion'
                     WHEN NOT NEW.activa THEN 'desactivar_obligacion'
                     ELSE 'editar_obligacion' END;
    fila_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'cash_flow_settings' THEN
    esperada := 'configurar_colchon'; fila_id := NEW.company_id;
  ELSIF TG_TABLE_NAME = 'weekly_digest_preferences' THEN
    esperada := 'preferencia_correo_semanal'; fila_id := NEW.user_id;
  ELSE
    -- weekly_digest_sends: apartar no se audita; cerrar el envío, sí.
    IF NEW.estado = 'enviando' THEN RETURN NULL; END IF;
    esperada := 'correo_semanal'; fila_id := NEW.id;
  END IF;
  IF NOT bitacora_tiene_evento(NEW.company_id, esperada, TG_TABLE_NAME, fila_id) THEN
    RAISE EXCEPTION 'auditoria_de_flujo_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cash_balance_auditoria
AFTER INSERT ON cash_balance_declarations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION flujo_exige_auditoria();
CREATE CONSTRAINT TRIGGER expected_collections_auditoria
AFTER INSERT OR UPDATE ON expected_collections DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION flujo_exige_auditoria();
CREATE CONSTRAINT TRIGGER recurring_obligations_auditoria
AFTER INSERT OR UPDATE ON recurring_obligations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION flujo_exige_auditoria();
CREATE CONSTRAINT TRIGGER cash_flow_settings_auditoria
AFTER INSERT OR UPDATE ON cash_flow_settings DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION flujo_exige_auditoria();
CREATE CONSTRAINT TRIGGER weekly_digest_preferences_auditoria
AFTER INSERT OR UPDATE ON weekly_digest_preferences DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION flujo_exige_auditoria();
CREATE CONSTRAINT TRIGGER weekly_digest_sends_auditoria
AFTER INSERT OR UPDATE ON weekly_digest_sends DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION flujo_exige_auditoria();

-- Lectura del flujo: no hace falta otro índice sobre tablas existentes. Medido con
-- 1,000 cuentas por pagar de la empresa y 20,000 de otra (docs/evidencia/flujo-de-caja):
-- los pagos por fecha usan supplier_payables_agenda_idx (company_id, programada_el, ...)
-- de 0022 y los lotes de nómina, payroll_batches_empresa (company_id, fecha_pago).

-- Permisos mínimos y RLS --------------------------------------------------------
GRANT SELECT, INSERT ON cash_balance_declarations TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON expected_collections TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON recurring_obligations TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON cash_flow_settings TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON weekly_digest_preferences TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON weekly_digest_sends TO plataforma_cliente;

ALTER TABLE cash_balance_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE expected_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_digest_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_digest_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_balance_declarations_cliente ON cash_balance_declarations FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY expected_collections_cliente ON expected_collections FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY recurring_obligations_cliente ON recurring_obligations FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY cash_flow_settings_cliente ON cash_flow_settings FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY weekly_digest_preferences_cliente ON weekly_digest_preferences FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY weekly_digest_sends_cliente ON weekly_digest_sends FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());

ALTER TABLE cash_balance_declarations FORCE ROW LEVEL SECURITY;
ALTER TABLE expected_collections FORCE ROW LEVEL SECURITY;
ALTER TABLE recurring_obligations FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_flow_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE weekly_digest_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE weekly_digest_sends FORCE ROW LEVEL SECURITY;
