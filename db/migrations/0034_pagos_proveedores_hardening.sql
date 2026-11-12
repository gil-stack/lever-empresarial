-- Reparación incremental de las tres versiones publicadas de 0022.
-- No se vuelve a ejecutar 0022 ni se reconstruyen tablas con datos.
-- db/migrate.sh ejecuta todo bajo su transacción y candado de migraciones.
-- Las ALTER iniciales mantienen bloqueadas las escrituras de cargos/solicitudes
-- hasta el COMMIT: nadie observa columnas, reglas o saneamiento a medias.
-- Si falta el historial, el runner adelanta esta reparación antes de 0030,
-- que lo necesita. A esa altura 0028 y 0029 ya están aplicadas.

SET search_path TO public;

ALTER TABLE supplier_payables ADD COLUMN IF NOT EXISTS anulado_en timestamptz;
ALTER TABLE supplier_payment_requests ADD COLUMN IF NOT EXISTS client_request_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'supplier_payment_requests'::regclass AND conname = 'supplier_payment_requests_id_empresa') THEN
    ALTER TABLE supplier_payment_requests ADD CONSTRAINT supplier_payment_requests_id_empresa UNIQUE (id, company_id);
  END IF;
  -- La versión original reserva también los UUID de cargos cancelados.
  IF NOT EXISTS (SELECT 1 FROM pg_index
    WHERE indexrelid = 'supplier_payables_cfdi_unico'::regclass
      AND pg_get_expr(indpred, indrelid) LIKE '%anulado_en%') THEN
    DROP INDEX supplier_payables_cfdi_unico;
    CREATE UNIQUE INDEX supplier_payables_cfdi_unico
      ON supplier_payables (company_id, cfdi_uuid) WHERE cfdi_uuid IS NOT NULL AND anulado_en IS NULL;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_payment_requests_idempotencia
  ON supplier_payment_requests (company_id, client_request_id) WHERE client_request_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS supplier_payment_request_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  version integer NOT NULL,
  estado text NOT NULL,
  estado_nuevo text NOT NULL,
  supplier_clabe_id uuid NOT NULL,
  clabe text NOT NULL,
  total_centavos bigint NOT NULL,
  programada_el date NOT NULL,
  solicitado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  solicitado_en timestamptz NOT NULL,
  resuelto_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  resuelto_en timestamptz,
  motivo_resolucion text,
  cerrado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  cerrado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Une la versión cerrada con el evento de bitácora de la misma transacción.
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT supplier_payment_request_history_solicitud
    FOREIGN KEY (request_id, company_id) REFERENCES supplier_payment_requests (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_payment_request_history_estados CHECK (
    estado IN ('por_autorizar', 'listo_para_pagar', 'rechazado', 'cancelado')
    AND estado_nuevo IN ('por_autorizar', 'listo_para_pagar', 'rechazado', 'cancelado')
  )
);

CREATE INDEX IF NOT EXISTS supplier_payment_request_history_solicitud_idx
  ON supplier_payment_request_history (company_id, request_id, cerrado_en);

COMMENT ON TABLE supplier_payment_request_history IS
  'Versiones cerradas de cada solicitud de pago. Solo inserción por trigger; conserva rechazos y autorizaciones retiradas.';

GRANT SELECT ON supplier_payment_request_history TO plataforma_cliente;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON supplier_payment_request_history FROM PUBLIC, plataforma_cliente, plataforma_sofipo;
ALTER TABLE supplier_payment_request_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_request_history FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy
    WHERE polrelid = 'supplier_payment_request_history'::regclass AND polname = 'supplier_payment_request_history_cliente') THEN
    CREATE POLICY supplier_payment_request_history_cliente ON supplier_payment_request_history FOR SELECT TO plataforma_cliente
      USING (company_id = app_empresa());
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION cliente_tiene_rol_operativo(p_company uuid, p_user uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(p_company = app_empresa(), false) AND EXISTS (
    SELECT 1
    FROM memberships m
    JOIN membership_roles r ON r.company_id = m.company_id AND r.user_id = m.user_id
    LEFT JOIN employees e ON e.company_id = m.company_id AND e.user_id = m.user_id
    WHERE m.company_id = p_company AND m.user_id = p_user AND m.estado = 'activa'
      AND r.rol = ANY(p_roles)
      AND (e.id IS NULL OR e.baja_en IS NULL OR e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
  )
$$;

CREATE OR REPLACE FUNCTION cliente_liberadores_operativos(p_company uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(DISTINCT m.user_id)::integer
  FROM memberships m
  JOIN membership_roles r ON r.company_id = m.company_id AND r.user_id = m.user_id
  LEFT JOIN employees e ON e.company_id = m.company_id AND e.user_id = m.user_id
  WHERE p_company = app_empresa() AND m.company_id = p_company AND m.estado = 'activa' AND r.rol = 'liberador'
    AND (e.id IS NULL OR e.baja_en IS NULL OR e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
$$;

CREATE OR REPLACE FUNCTION supplier_payables_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  solicitud supplier_payment_requests%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'cargo_proveedor_no_se_borra';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.creado_por IS DISTINCT FROM app_usuario() OR NEW.anulado_en IS NOT NULL
      OR NOT cliente_tiene_rol_operativo(NEW.company_id, NEW.creado_por, ARRAY['administrador','liberador','solicitante']) THEN
      RAISE EXCEPTION 'sin_permiso_para_solicitar';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.origen IS DISTINCT FROM OLD.origen
    OR NEW.cfdi_uuid IS DISTINCT FROM OLD.cfdi_uuid OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
    OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'cargo_proveedor_inmutable';
  END IF;

  SELECT * INTO solicitud FROM supplier_payment_requests r
  WHERE r.company_id = OLD.company_id AND r.payable_id = OLD.id;

  IF NEW.anulado_en IS DISTINCT FROM OLD.anulado_en THEN
    IF OLD.anulado_en IS NOT NULL OR solicitud.estado IS DISTINCT FROM 'cancelado'
      OR (NEW.serie, NEW.folio, NEW.referencia, NEW.total_centavos, NEW.emitida_el, NEW.vence_el,
          NEW.programada_el, NEW.motivo_excepcion, NEW.actualizado_en)
        IS DISTINCT FROM (OLD.serie, OLD.folio, OLD.referencia, OLD.total_centavos, OLD.emitida_el, OLD.vence_el,
          OLD.programada_el, OLD.motivo_excepcion, OLD.actualizado_en) THEN
      RAISE EXCEPTION 'cargo_proveedor_no_editable';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.anulado_en IS NOT NULL OR solicitud.estado IS DISTINCT FROM 'rechazado'
    OR app_usuario() IS DISTINCT FROM solicitud.solicitado_por
    OR NOT cliente_tiene_rol_operativo(NEW.company_id, app_usuario(), ARRAY['administrador','liberador','solicitante']) THEN
    RAISE EXCEPTION 'cargo_proveedor_no_editable';
  END IF;
  IF OLD.origen = 'cfdi' AND (NEW.total_centavos, NEW.emitida_el, NEW.serie, NEW.folio, NEW.referencia)
    IS DISTINCT FROM (OLD.total_centavos, OLD.emitida_el, OLD.serie, OLD.folio, OLD.referencia) THEN
    RAISE EXCEPTION 'cargo_cfdi_inmutable';
  END IF;
  IF OLD.origen = 'excepcion' AND NEW.total_centavos <> OLD.total_centavos AND NOT EXISTS (
    SELECT 1 FROM supplier_payable_documents d
    WHERE d.company_id = NEW.company_id AND d.payable_id = NEW.id AND d.tipo = 'evidencia'
      AND d.xmin::text::bigint = txid_current() % 4294967296
  ) THEN
    RAISE EXCEPTION 'cargo_sin_evidencia_nueva';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION supplier_payment_requests_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cargo supplier_payables%ROWTYPE;
  proveedor suppliers%ROWTYPE;
  vigente supplier_clabes%ROWTYPE;
  validar_instruccion boolean := false;
  instruccion_igual boolean;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'pago_proveedor_no_se_borra';
  END IF;

  IF TG_OP = 'INSERT' THEN
    validar_instruccion := true;
    IF NEW.estado <> 'por_autorizar' OR NEW.version <> 1 OR NEW.solicitado_por IS DISTINCT FROM app_usuario()
      OR NOT cliente_tiene_rol_operativo(NEW.company_id, NEW.solicitado_por, ARRAY['administrador','liberador','solicitante']) THEN
      RAISE EXCEPTION 'sin_permiso_para_solicitar';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.payable_id IS DISTINCT FROM OLD.payable_id OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
      OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id THEN
      RAISE EXCEPTION 'pago_proveedor_inmutable';
    END IF;
    instruccion_igual := (NEW.solicitado_por, NEW.solicitado_en, NEW.supplier_clabe_id, NEW.clabe,
        NEW.total_centavos, NEW.programada_el)
      IS NOT DISTINCT FROM (OLD.solicitado_por, OLD.solicitado_en, OLD.supplier_clabe_id, OLD.clabe,
        OLD.total_centavos, OLD.programada_el);

    IF OLD.estado = 'por_autorizar' AND NEW.estado IN ('listo_para_pagar', 'rechazado') THEN
      validar_instruccion := NEW.estado = 'listo_para_pagar';
      IF NEW.resuelto_por IS DISTINCT FROM app_usuario() OR NEW.resuelto_por = OLD.solicitado_por
        OR NOT cliente_tiene_rol_operativo(NEW.company_id, NEW.resuelto_por, ARRAY['liberador']) THEN
        RAISE EXCEPTION 'sin_permiso_para_liberar';
      END IF;
      IF NOT instruccion_igual OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'pago_proveedor_inmutable';
      END IF;
    ELSIF OLD.estado IN ('por_autorizar', 'rechazado') AND NEW.estado = 'cancelado' THEN
      IF NEW.resuelto_por IS DISTINCT FROM app_usuario() OR NEW.resuelto_por IS DISTINCT FROM OLD.solicitado_por
        OR NOT cliente_tiene_rol_operativo(NEW.company_id, NEW.resuelto_por, ARRAY['administrador','liberador','solicitante']) THEN
        RAISE EXCEPTION 'cancelacion_no_permitida';
      END IF;
      IF NOT instruccion_igual OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'pago_proveedor_inmutable';
      END IF;
    ELSIF OLD.estado = 'listo_para_pagar' AND NEW.estado = 'cancelado' THEN
      IF NEW.resuelto_por IS DISTINCT FROM app_usuario()
        OR NOT cliente_tiene_rol_operativo(NEW.company_id, NEW.resuelto_por, ARRAY['liberador','administrador']) THEN
        RAISE EXCEPTION 'cancelacion_no_permitida';
      END IF;
      IF NOT instruccion_igual OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'pago_proveedor_inmutable';
      END IF;
    ELSIF OLD.estado = 'listo_para_pagar' AND NEW.estado = 'por_autorizar' THEN
      IF NOT instruccion_igual OR NEW.version IS DISTINCT FROM OLD.version + 1 THEN
        RAISE EXCEPTION 'pago_proveedor_inmutable';
      END IF;
      SELECT * INTO cargo FROM supplier_payables WHERE company_id = NEW.company_id AND id = NEW.payable_id;
      SELECT * INTO proveedor FROM suppliers WHERE company_id = cargo.company_id AND id = cargo.supplier_id;
      SELECT * INTO vigente FROM supplier_clabes
        WHERE company_id = NEW.company_id AND id = NEW.supplier_clabe_id AND vigente_hasta IS NULL;
      -- 0028: la empresa suspendida o la lista de por medio también retiran la
      -- autorización. Eso lo hace solo el sistema (pagos_listos_regresan), nunca el
      -- portal ni el personal: con su rol la lista ni se consulta.
      -- IF anidados: Postgres revisa el permiso de lpb_bloquea_pago al preparar la condición.
      IF vigente.id IS NOT NULL AND proveedor.activo AND proveedor.boton_pago THEN
        IF current_user IN ('plataforma_cliente', 'plataforma_sofipo') THEN
          RAISE EXCEPTION 'pago_proveedor_regreso_sin_causa';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = NEW.company_id AND c.estado IN ('suspendida', 'baja')) THEN
          IF NOT lpb_bloquea_pago(NEW.company_id, proveedor.id) THEN
            RAISE EXCEPTION 'pago_proveedor_regreso_sin_causa';
          END IF;
        END IF;
      END IF;
    ELSIF OLD.estado = 'rechazado' AND NEW.estado = 'por_autorizar' THEN
      validar_instruccion := true;
      IF NEW.solicitado_por IS DISTINCT FROM OLD.solicitado_por
        OR NEW.solicitado_por IS DISTINCT FROM app_usuario()
        OR NOT cliente_tiene_rol_operativo(NEW.company_id, NEW.solicitado_por, ARRAY['administrador','liberador','solicitante'])
        OR NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'sin_permiso_para_solicitar';
      END IF;
    ELSE
      RAISE EXCEPTION 'pago_proveedor_transicion_invalida';
    END IF;
  END IF;

  IF validar_instruccion THEN
    SELECT * INTO cargo FROM supplier_payables
      WHERE company_id = NEW.company_id AND id = NEW.payable_id FOR SHARE;
    SELECT * INTO proveedor FROM suppliers
      WHERE company_id = cargo.company_id AND id = cargo.supplier_id FOR SHARE;
    SELECT * INTO vigente FROM supplier_clabes
      WHERE company_id = NEW.company_id AND id = NEW.supplier_clabe_id AND vigente_hasta IS NULL FOR SHARE;
    IF cargo.id IS NULL OR proveedor.id IS NULL OR vigente.id IS NULL OR cargo.anulado_en IS NOT NULL
      OR NOT proveedor.activo OR NOT proveedor.boton_pago
      OR NEW.total_centavos <> cargo.total_centavos OR NEW.programada_el <> cargo.programada_el
      OR NEW.clabe <> vigente.clabe OR cliente_liberadores_operativos(NEW.company_id) < 2 THEN
      RAISE EXCEPTION 'pago_proveedor_no_autorizable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION supplier_payment_requests_historial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO supplier_payment_request_history (
    company_id, request_id, version, estado, estado_nuevo, supplier_clabe_id, clabe, total_centavos,
    programada_el, solicitado_por, solicitado_en, resuelto_por, resuelto_en, motivo_resolucion, cerrado_por
  ) VALUES (
    OLD.company_id, OLD.id, OLD.version, OLD.estado, NEW.estado, OLD.supplier_clabe_id, OLD.clabe, OLD.total_centavos,
    OLD.programada_el, OLD.solicitado_por, OLD.solicitado_en, OLD.resuelto_por, OLD.resuelto_en, OLD.motivo_resolucion,
    CASE WHEN app_empresa() = OLD.company_id THEN app_usuario() END
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION supplier_payment_requests_anula_cargo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE supplier_payables SET anulado_en = NEW.resuelto_en
  WHERE company_id = NEW.company_id AND id = NEW.payable_id AND anulado_en IS NULL;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pagos_listos_regresan_a_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  motivo text;
  regresado record;
  en_portal boolean := app_empresa() IS NOT DISTINCT FROM NEW.company_id AND app_usuario() IS NOT NULL;
BEGIN
  IF TG_TABLE_NAME = 'supplier_clabes' THEN
    motivo := 'Cambió la CLABE del proveedor. La autorización anterior se retiró.';
  ELSIF NOT NEW.activo THEN
    motivo := 'El proveedor quedó inactivo. La autorización anterior se retiró.';
  ELSE
    motivo := 'El RFC del proveedor aparece en la lista 69-B. La autorización anterior se retiró.';
  END IF;

  FOR regresado IN
    UPDATE supplier_payment_requests AS r
    SET estado = 'por_autorizar', resuelto_por = NULL, resuelto_en = NULL, motivo_resolucion = NULL,
        version = r.version + 1
    FROM supplier_payables AS p
    WHERE p.company_id = r.company_id AND p.id = r.payable_id
      AND r.company_id = NEW.company_id AND r.estado = 'listo_para_pagar'
      AND CASE WHEN TG_TABLE_NAME = 'supplier_clabes' THEN r.supplier_clabe_id = NEW.id ELSE p.supplier_id = NEW.id END
    RETURNING r.id, r.company_id
  LOOP
    INSERT INTO audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, motivo)
    SELECT c.operator_id, regresado.company_id,
      CASE WHEN en_portal THEN 'miembro' ELSE 'sistema' END,
      CASE WHEN en_portal THEN app_usuario() END,
      CASE WHEN en_portal THEN 'cliente' ELSE 'sistema' END,
      'regresar_pago_proveedor', 'supplier_payment_requests', regresado.id, motivo
    FROM companies AS c WHERE c.id = regresado.company_id;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION historial_pago_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'historial_pago_inmutable';
END;
$$;

CREATE OR REPLACE FUNCTION pagos_proveedores_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  esperada text;
  entidad text := TG_TABLE_NAME;
  fila_id uuid;
  empresa uuid;
BEGIN
  IF TG_TABLE_NAME = 'supplier_documents' THEN
    esperada := 'documento_proveedor'; fila_id := NEW.document_id; empresa := NEW.company_id;
  ELSIF TG_TABLE_NAME = 'supplier_payable_documents' THEN
    esperada := 'documento_cargo_proveedor'; fila_id := NEW.document_id; empresa := NEW.company_id;
  ELSIF TG_TABLE_NAME = 'supplier_payables' THEN
    esperada := CASE WHEN TG_OP = 'INSERT' THEN 'crear_cargo_proveedor' ELSE 'editar_cargo_proveedor' END;
    fila_id := NEW.id; empresa := NEW.company_id;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.anulado_en IS DISTINCT FROM OLD.anulado_en THEN
        -- La anulación del cargo la explica la cancelación de su solicitud.
        esperada := 'cancelar_pago_proveedor'; entidad := 'supplier_payment_requests';
        SELECT r.id INTO fila_id FROM supplier_payment_requests r WHERE r.company_id = NEW.company_id AND r.payable_id = NEW.id;
      END IF;
    END IF;
  ELSE
    esperada := CASE
      WHEN TG_OP = 'UPDATE' AND OLD.estado = 'listo_para_pagar' AND NEW.estado = 'por_autorizar' THEN 'regresar_pago_proveedor'
      WHEN TG_OP = 'INSERT' OR NEW.estado = 'por_autorizar' THEN 'solicitar_pago_proveedor'
      WHEN NEW.estado = 'listo_para_pagar' THEN 'autorizar_pago_proveedor'
      WHEN NEW.estado = 'rechazado' THEN 'rechazar_pago_proveedor'
      ELSE 'cancelar_pago_proveedor' END;
    fila_id := NEW.id; empresa := NEW.company_id;
  END IF;
  IF fila_id IS NULL OR NOT bitacora_tiene_evento(empresa, esperada, entidad, fila_id) THEN
    RAISE EXCEPTION 'auditoria_pago_proveedor_ausente';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION cliente_tiene_rol_operativo(uuid, uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION cliente_liberadores_operativos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cliente_tiene_rol_operativo(uuid, uuid, text[]) TO plataforma_cliente;
GRANT EXECUTE ON FUNCTION cliente_liberadores_operativos(uuid) TO plataforma_cliente;

CREATE OR REPLACE TRIGGER supplier_payment_requests_historial
AFTER UPDATE ON supplier_payment_requests
FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado OR OLD.version IS DISTINCT FROM NEW.version)
EXECUTE FUNCTION supplier_payment_requests_historial();

CREATE OR REPLACE TRIGGER supplier_payment_requests_anula_cargo
AFTER UPDATE OF estado ON supplier_payment_requests
FOR EACH ROW WHEN (NEW.estado = 'cancelado' AND OLD.estado IS DISTINCT FROM 'cancelado')
EXECUTE FUNCTION supplier_payment_requests_anula_cargo();

CREATE OR REPLACE TRIGGER supplier_clabes_regresa_pagos_listos
AFTER UPDATE OF vigente_hasta ON supplier_clabes
FOR EACH ROW WHEN (OLD.vigente_hasta IS NULL AND NEW.vigente_hasta IS NOT NULL)
EXECUTE FUNCTION pagos_listos_regresan_a_revision();

CREATE OR REPLACE TRIGGER suppliers_regresa_pagos_listos
AFTER UPDATE OF boton_pago, activo ON suppliers
FOR EACH ROW WHEN ((OLD.boton_pago AND NOT NEW.boton_pago) OR (OLD.activo AND NOT NEW.activo))
EXECUTE FUNCTION pagos_listos_regresan_a_revision();

CREATE OR REPLACE TRIGGER supplier_payment_request_history_no_cambios
BEFORE UPDATE OR DELETE ON supplier_payment_request_history
FOR EACH ROW EXECUTE FUNCTION historial_pago_append_only();

CREATE OR REPLACE TRIGGER supplier_payment_request_history_no_truncate
BEFORE TRUNCATE ON supplier_payment_request_history
FOR EACH STATEMENT EXECUTE FUNCTION historial_pago_append_only();

-- Si 0030 ya estaba aplicada, el historial recién creado recibe también sus
-- reglas de conservación. Si está pendiente, ella misma las agregará después.
DO $$
BEGIN
  IF to_regclass('public.pld_operaciones') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'supplier_payment_request_history'::regclass
      AND tgname = 'supplier_payment_request_history_conservacion') THEN
      CREATE TRIGGER supplier_payment_request_history_conservacion
        BEFORE DELETE ON supplier_payment_request_history FOR EACH ROW EXECUTE FUNCTION conservacion_no_se_borra();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'supplier_payment_request_history'::regclass
      AND tgname = 'supplier_payment_request_history_conservacion_truncate') THEN
      CREATE TRIGGER supplier_payment_request_history_conservacion_truncate
        BEFORE TRUNCATE ON supplier_payment_request_history FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();
    END IF;
  END IF;
END;
$$;

-- No se inventan transiciones pasadas: se conservan las solicitudes y sus
-- resoluciones. Se completa la marca de anulación de los cargos cancelados
-- y se registra esta reparación como acto del sistema en la transacción.
WITH anulados AS (
  UPDATE supplier_payables p SET anulado_en = r.resuelto_en
  FROM supplier_payment_requests r
  WHERE r.company_id = p.company_id AND r.payable_id = p.id
    AND r.estado = 'cancelado' AND p.anulado_en IS NULL
  RETURNING p.company_id, r.id
)
INSERT INTO audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador, motivo)
SELECT c.operator_id, a.company_id, 'sistema', 'sistema', 'cancelar_pago_proveedor',
  'supplier_payment_requests', a.id, '0034: completar la anulación de un cargo cancelado previamente.'
FROM anulados a JOIN companies c ON c.id = a.company_id;

-- Una autorización que ya era inválida antes del despliegue tampoco puede
-- sobrevivir. El mismo trigger de historial conserva su resolución anterior.
WITH regresados AS (
  UPDATE supplier_payment_requests r
  SET estado = 'por_autorizar', resuelto_por = NULL, resuelto_en = NULL,
    motivo_resolucion = NULL, version = r.version + 1
  FROM supplier_payables p, suppliers s, supplier_clabes cl
  WHERE p.company_id = r.company_id AND p.id = r.payable_id
    AND s.company_id = p.company_id AND s.id = p.supplier_id
    AND cl.company_id = r.company_id AND cl.id = r.supplier_clabe_id
    AND r.estado = 'listo_para_pagar'
    AND (cl.vigente_hasta IS NOT NULL OR NOT s.activo OR NOT s.boton_pago)
  RETURNING r.company_id, r.id
)
INSERT INTO audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador, motivo)
SELECT c.operator_id, r.company_id, 'sistema', 'sistema', 'regresar_pago_proveedor',
  'supplier_payment_requests', r.id, '0034: retirar autorización anterior por CLABE cerrada o proveedor bloqueado/inactivo.'
FROM regresados r JOIN companies c ON c.id = r.company_id;
