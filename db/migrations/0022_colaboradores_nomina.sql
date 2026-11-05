-- Personas: áreas, presupuestos, nómina neta y preparación de lotes.
-- Este módulo no emite tarjetas ni dispersa dinero.

SET search_path TO public;

ALTER TABLE cost_centers
  ADD COLUMN presupuesto_mensual_centavos bigint,
  ADD COLUMN es_tesoreria boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT cost_centers_presupuesto_no_negativo
    CHECK (presupuesto_mensual_centavos IS NULL OR presupuesto_mensual_centavos >= 0);

ALTER TABLE employees
  ADD COLUMN presupuesto_mensual_centavos bigint,
  ADD COLUMN alta_llave uuid,
  ADD CONSTRAINT employees_presupuesto_no_negativo
    CHECK (presupuesto_mensual_centavos IS NULL OR presupuesto_mensual_centavos >= 0);

ALTER TABLE employees ALTER COLUMN clabe DROP NOT NULL;
ALTER TABLE employees DROP CONSTRAINT employees_clabe_validada;
ALTER TABLE employees
  ADD CONSTRAINT employees_clabe_validada CHECK (
    (clabe IS NULL AND clabe_digito_valido IS FALSE)
    OR (
      clabe ~ '^[0-9]{18}$'
      AND clabe_digito_valido IS TRUE
      AND clabe_digito_371(clabe)
    )
  );

CREATE UNIQUE INDEX employees_alta_llave_por_empresa
  ON employees (company_id, alta_llave) WHERE alta_llave IS NOT NULL;
CREATE INDEX employees_directorio ON employees (company_id, baja_en, nombre, id);

COMMENT ON COLUMN employees.presupuesto_mensual_centavos IS
  'Bolsa mensual de gasto de la persona, separada de su nómina. NULL: todavía no asignada.';
COMMENT ON COLUMN employees.alta_llave IS
  'Llave de idempotencia elegida por el cliente para que un reintento no duplique el alta.';
COMMENT ON COLUMN employees.clabe IS
  'Destino externo opcional cuando la nómina usa tarjeta. Nunca es un PAN.';

CREATE TABLE employee_payroll_profiles (
  employee_id uuid NOT NULL,
  company_id uuid NOT NULL,
  neto_centavos bigint NOT NULL CHECK (neto_centavos > 0),
  frecuencia text NOT NULL CHECK (frecuencia IN ('semanal', 'quincenal', 'mensual')),
  proximo_pago_en date NOT NULL,
  ancla_dia smallint NOT NULL CHECK (ancla_dia BETWEEN 1 AND 31),
  destino text NOT NULL CHECK (destino IN ('clabe', 'tarjeta')),
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id),
  FOREIGN KEY (employee_id, company_id)
    REFERENCES employees (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT employee_payroll_empresa CHECK (company_id IS NOT NULL)
);

CREATE INDEX employee_payroll_calendario
  ON employee_payroll_profiles (company_id, activa, proximo_pago_en, employee_id);

COMMENT ON TABLE employee_payroll_profiles IS
  'Configuración vigente de nómina neta. Los lotes guardan su propio snapshot; preparar no dispersa.';

CREATE TABLE employee_card_requests (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'cancelada')),
  solicitada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  solicitada_en timestamptz NOT NULL DEFAULT now(),
  cancelada_en timestamptz,
  FOREIGN KEY (employee_id, company_id)
    REFERENCES employees (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT employee_card_cancelacion CHECK (
    (estado = 'pendiente' AND cancelada_en IS NULL)
    OR (estado = 'cancelada' AND cancelada_en IS NOT NULL)
  )
);

CREATE UNIQUE INDEX employee_card_pendiente
  ON employee_card_requests (company_id, employee_id) WHERE estado = 'pendiente';
CREATE INDEX employee_card_empresa ON employee_card_requests (company_id, employee_id, estado);

COMMENT ON TABLE employee_card_requests IS
  'Solicitud interna de tarjeta de nómina. No afirma emisión por un proveedor externo.';

CREATE TABLE payroll_batches (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  fecha_pago date NOT NULL,
  estado text NOT NULL DEFAULT 'preparada' CHECK (estado = 'preparada'),
  total_centavos bigint NOT NULL CHECK (total_centavos >= 0),
  preparada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  preparada_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, fecha_pago),
  UNIQUE (id, company_id)
);

CREATE INDEX payroll_batches_empresa ON payroll_batches (company_id, fecha_pago DESC, id);

COMMENT ON TABLE payroll_batches IS
  'Lote administrativo inmutable preparado para revisión. No es una orden bancaria ni una dispersión.';

CREATE TABLE payroll_batch_items (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  nombre_snapshot text NOT NULL,
  neto_centavos bigint NOT NULL CHECK (neto_centavos > 0),
  destino text NOT NULL CHECK (destino IN ('clabe', 'tarjeta')),
  clabe_snapshot text,
  destino_estado text NOT NULL CHECK (destino_estado IN ('listo', 'pendiente')),
  FOREIGN KEY (batch_id, company_id)
    REFERENCES payroll_batches (id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (employee_id, company_id)
    REFERENCES employees (id, company_id) ON DELETE RESTRICT,
  UNIQUE (batch_id, employee_id),
  CONSTRAINT payroll_batch_clabe_valida CHECK (
    clabe_snapshot IS NULL OR clabe_digito_371(clabe_snapshot)
  ),
  CONSTRAINT payroll_batch_destino_coherente CHECK (
    (destino = 'clabe' AND clabe_snapshot IS NOT NULL AND destino_estado = 'listo')
    OR (destino = 'tarjeta' AND clabe_snapshot IS NULL)
  )
);

CREATE INDEX payroll_batch_items_empresa
  ON payroll_batch_items (company_id, batch_id, employee_id);

COMMENT ON TABLE payroll_batch_items IS
  'Snapshot inmutable de cada persona, importe y destino al preparar el lote.';

-- Ediciones del maestro: empresa e identidad enlazada no cambian; el resto exige auditoría.
DROP TRIGGER employees_solo_cambia_la_baja ON employees;
DROP FUNCTION employees_solo_cambia_la_baja();

CREATE FUNCTION employees_cambios_permitidos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.alta_llave IS DISTINCT FROM OLD.alta_llave
  THEN
    RAISE EXCEPTION 'persona_identidad_inmutable';
  END IF;
  IF NEW.baja_en IS DISTINCT FROM OLD.baja_en THEN
    RETURN NEW;
  END IF;
  IF NEW.nombre IS DISTINCT FROM OLD.nombre
    OR NEW.alta_en IS DISTINCT FROM OLD.alta_en
    OR NEW.jefe_id IS DISTINCT FROM OLD.jefe_id
    OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id
    OR NEW.clabe IS DISTINCT FROM OLD.clabe
    OR NEW.clabe_digito_valido IS DISTINCT FROM OLD.clabe_digito_valido
    OR NEW.presupuesto_mensual_centavos IS DISTINCT FROM OLD.presupuesto_mensual_centavos
  THEN
    IF NOT bitacora_tiene_evento(NEW.company_id, 'editar_persona', 'employees', NEW.id) THEN
      RAISE EXCEPTION 'auditoria_de_edicion_persona_ausente';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER employees_cambios_permitidos
BEFORE UPDATE ON employees
FOR EACH ROW
EXECUTE FUNCTION employees_cambios_permitidos();

CREATE FUNCTION cost_centers_cambios_auditados()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'area_empresa_inmutable';
  END IF;
  IF NEW.nombre IS DISTINCT FROM OLD.nombre
    OR NEW.presupuesto_mensual_centavos IS DISTINCT FROM OLD.presupuesto_mensual_centavos
    OR NEW.es_tesoreria IS DISTINCT FROM OLD.es_tesoreria
  THEN
    IF NOT bitacora_tiene_evento(NEW.company_id, 'editar_area', 'cost_centers', NEW.id) THEN
      RAISE EXCEPTION 'auditoria_de_area_ausente';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cost_centers_cambios_auditados
BEFORE UPDATE ON cost_centers
FOR EACH ROW
EXECUTE FUNCTION cost_centers_cambios_auditados();

CREATE FUNCTION payroll_profile_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fila employee_payroll_profiles;
BEGIN
  IF TG_OP = 'DELETE' THEN fila := OLD; ELSE fila := NEW; END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1 FROM payroll_batches
    WHERE company_id = NEW.company_id AND fecha_pago = NEW.proximo_pago_en
  ) THEN
    RAISE EXCEPTION 'fecha_ya_preparada';
  END IF;
  IF NOT bitacora_tiene_evento(fila.company_id, NULL, 'employee_payroll_profiles', fila.employee_id) THEN
    RAISE EXCEPTION 'auditoria_de_nomina_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER payroll_profile_exige_auditoria
AFTER INSERT OR UPDATE OR DELETE ON employee_payroll_profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION payroll_profile_exige_auditoria();

CREATE FUNCTION card_request_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fila employee_card_requests;
BEGIN
  IF TG_OP = 'DELETE' THEN fila := OLD; ELSE fila := NEW; END IF;
  IF NOT bitacora_tiene_evento(fila.company_id, NULL, 'employee_card_requests', fila.id) THEN
    RAISE EXCEPTION 'auditoria_de_tarjeta_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER card_request_exige_auditoria
AFTER INSERT OR UPDATE OR DELETE ON employee_card_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION card_request_exige_auditoria();

CREATE FUNCTION payroll_batch_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.preparada_por IS DISTINCT FROM app_usuario() OR NOT EXISTS (
    SELECT 1
    FROM memberships m
    JOIN membership_roles r ON r.user_id = m.user_id AND r.company_id = m.company_id
    LEFT JOIN employees e ON e.user_id = m.user_id AND e.company_id = m.company_id
    WHERE m.user_id = NEW.preparada_por AND m.company_id = NEW.company_id
      AND m.estado = 'activa' AND r.rol IN ('administrador', 'liberador', 'solicitante')
      AND (e.id IS NULL OR e.baja_en IS NULL OR e.baja_en > NEW.fecha_pago)
  ) THEN
    RAISE EXCEPTION 'sin_permiso_para_preparar_nomina';
  END IF;
  IF NOT bitacora_tiene_evento(NEW.company_id, 'preparar_nomina', 'payroll_batches', NEW.id) THEN
    RAISE EXCEPTION 'auditoria_de_lote_nomina_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER payroll_batch_exige_auditoria
AFTER INSERT ON payroll_batches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION payroll_batch_exige_auditoria();

CREATE FUNCTION payroll_batch_item_exige_lote_auditado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  esperado bigint;
BEGIN
  IF NOT bitacora_tiene_evento(NEW.company_id, 'preparar_nomina', 'payroll_batches', NEW.batch_id) THEN
    RAISE EXCEPTION 'auditoria_de_lote_nomina_ausente';
  END IF;
  SELECT total_centavos INTO esperado FROM payroll_batches WHERE id = NEW.batch_id;
  IF esperado IS DISTINCT FROM (
    SELECT sum(neto_centavos) FROM payroll_batch_items WHERE batch_id = NEW.batch_id
  ) THEN
    RAISE EXCEPTION 'total_de_lote_no_coincide';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER payroll_batch_item_exige_lote_auditado
AFTER INSERT ON payroll_batch_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION payroll_batch_item_exige_lote_auditado();

CREATE FUNCTION payroll_lote_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'lote_de_nomina_inmutable';
END;
$$;

CREATE TRIGGER payroll_batches_inmutable
BEFORE UPDATE OR DELETE ON payroll_batches
FOR EACH ROW EXECUTE FUNCTION payroll_lote_inmutable();
CREATE TRIGGER payroll_batch_items_inmutable
BEFORE UPDATE OR DELETE ON payroll_batch_items
FOR EACH ROW EXECUTE FUNCTION payroll_lote_inmutable();

-- La baja efectiva cierra también las sesiones de otra persona. La función
-- no recibe empresa del llamador: la toma del contexto RLS y exige su evento.
CREATE FUNCTION desprovisionar_miembro(p_company uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  empleado uuid;
BEGIN
  IF p_company IS DISTINCT FROM app_empresa() THEN
    RAISE EXCEPTION 'empresa_de_otra_cuenta';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM memberships m
    JOIN membership_roles r ON r.user_id = m.user_id AND r.company_id = m.company_id
    WHERE m.user_id = app_usuario() AND m.company_id = p_company
      AND m.estado = 'activa' AND r.rol = 'administrador'
  ) THEN
    RAISE EXCEPTION 'sin_permiso';
  END IF;
  SELECT id INTO empleado FROM employees
  WHERE company_id = p_company AND user_id = p_user
    AND baja_en <= (timezone('America/Mexico_City', clock_timestamp()))::date;
  IF empleado IS NULL THEN RAISE EXCEPTION 'baja_no_efectiva'; END IF;
  IF NOT bitacora_tiene_evento(p_company, 'desprovisionar_persona', 'employees', empleado) THEN
    RAISE EXCEPTION 'auditoria_de_baja_ausente';
  END IF;
  UPDATE memberships SET estado = 'suspendida' WHERE company_id = p_company AND user_id = p_user;
  UPDATE invitations
  SET revocada_en = now()
  WHERE company_id = p_company AND user_id = p_user
    AND usada_en IS NULL AND revocada_en IS NULL;
  DELETE FROM sessions WHERE user_id = p_user;
END;
$$;

REVOKE ALL ON FUNCTION desprovisionar_miembro(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION desprovisionar_miembro(uuid, uuid) TO plataforma_cliente;

GRANT SELECT, INSERT, UPDATE ON cost_centers TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON employee_payroll_profiles TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON employee_card_requests TO plataforma_cliente;
GRANT SELECT, INSERT ON payroll_batches, payroll_batch_items TO plataforma_cliente;

ALTER TABLE employee_payroll_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_card_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_payroll_cliente ON employee_payroll_profiles FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY employee_card_cliente ON employee_card_requests FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY payroll_batches_cliente ON payroll_batches FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY payroll_batch_items_cliente ON payroll_batch_items FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());

ALTER TABLE employee_payroll_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE employee_card_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll_batch_items FORCE ROW LEVEL SECURITY;
