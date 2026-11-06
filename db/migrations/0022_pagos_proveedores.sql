-- Cuentas por pagar de proveedores. Prepara y autoriza; no envía dinero.
-- La factura/excepción y su autorización son entidades distintas. Una CLABE
-- cambia por versión y una instrucción lista conserva su instantánea.

SET search_path TO public;

ALTER TABLE suppliers
  ADD COLUMN nombre_comercial text,
  ADD COLUMN contacto_correo text,
  ADD COLUMN dias_credito integer NOT NULL DEFAULT 30,
  ADD COLUMN activo boolean NOT NULL DEFAULT true;

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_nombre_comercial CHECK (
    nombre_comercial IS NULL OR (
      nombre_comercial = btrim(nombre_comercial)
      AND char_length(nombre_comercial) BETWEEN 1 AND 180
      AND nombre_comercial !~ '[[:cntrl:]]'
    )
  ),
  ADD CONSTRAINT suppliers_contacto_correo CHECK (
    contacto_correo IS NULL OR contacto_correo ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  ADD CONSTRAINT suppliers_dias_credito CHECK (dias_credito BETWEEN 0 AND 365);

ALTER TABLE documents ADD CONSTRAINT documents_id_empresa UNIQUE (id, company_id);
ALTER TABLE supplier_clabes ADD CONSTRAINT supplier_clabes_id_empresa UNIQUE (id, company_id);

CREATE TABLE supplier_documents (
  document_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL,
  tipo text NOT NULL,
  vigente_desde date,
  vigente_hasta date,
  creado_en timestamptz NOT NULL,
  PRIMARY KEY (document_id, company_id),
  CONSTRAINT supplier_documents_documento
    FOREIGN KEY (document_id, company_id) REFERENCES documents (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_documents_proveedor
    FOREIGN KEY (supplier_id, company_id) REFERENCES suppliers (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_documents_tipo CHECK (tipo IN ('contrato', 'anexo', 'otro')),
  CONSTRAINT supplier_documents_vigencia CHECK (
    vigente_hasta IS NULL OR vigente_desde IS NULL OR vigente_hasta >= vigente_desde
  )
);

CREATE INDEX supplier_documents_proveedor_idx ON supplier_documents (company_id, supplier_id, creado_en);

COMMENT ON TABLE supplier_documents IS
  'Contratos y anexos privados del proveedor. La relación no se reescribe ni se borra.';

CREATE TABLE supplier_payables (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL,
  origen text NOT NULL,
  cfdi_uuid text,
  serie text,
  folio text,
  referencia text NOT NULL,
  total_centavos bigint NOT NULL,
  moneda text NOT NULL DEFAULT 'MXN',
  emitida_el date NOT NULL,
  vence_el date NOT NULL,
  programada_el date NOT NULL,
  motivo_excepcion text,
  creado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL,
  actualizado_en timestamptz NOT NULL,
  -- Se llena cuando su solicitud queda cancelada. Un CFDI anulado libera su UUID.
  anulado_en timestamptz,
  CONSTRAINT supplier_payables_proveedor
    FOREIGN KEY (supplier_id, company_id) REFERENCES suppliers (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_payables_origen CHECK (origen IN ('cfdi', 'excepcion')),
  CONSTRAINT supplier_payables_uuid CHECK (
    (origen = 'cfdi' AND cfdi_uuid ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' AND motivo_excepcion IS NULL)
    OR (origen = 'excepcion' AND cfdi_uuid IS NULL AND motivo_excepcion IS NOT NULL)
  ),
  CONSTRAINT supplier_payables_referencia CHECK (
    referencia = btrim(referencia) AND char_length(referencia) BETWEEN 1 AND 120 AND referencia !~ '[[:cntrl:]]'
  ),
  CONSTRAINT supplier_payables_serie_folio CHECK (
    (serie IS NULL OR (serie = btrim(serie) AND char_length(serie) BETWEEN 1 AND 40 AND serie !~ '[[:cntrl:]]'))
    AND (folio IS NULL OR (folio = btrim(folio) AND char_length(folio) BETWEEN 1 AND 40 AND folio !~ '[[:cntrl:]]'))
  ),
  CONSTRAINT supplier_payables_total CHECK (total_centavos > 0 AND total_centavos <= 9000000000000000),
  CONSTRAINT supplier_payables_mxn CHECK (moneda = 'MXN'),
  CONSTRAINT supplier_payables_fechas CHECK (vence_el >= emitida_el),
  CONSTRAINT supplier_payables_motivo CHECK (
    motivo_excepcion IS NULL OR (
      motivo_excepcion = btrim(motivo_excepcion)
      AND char_length(motivo_excepcion) BETWEEN 10 AND 500
      AND motivo_excepcion !~ '[[:cntrl:]]'
    )
  )
);

ALTER TABLE supplier_payables ADD CONSTRAINT supplier_payables_id_empresa UNIQUE (id, company_id);

CREATE UNIQUE INDEX supplier_payables_cfdi_unico
  ON supplier_payables (company_id, cfdi_uuid) WHERE cfdi_uuid IS NOT NULL AND anulado_en IS NULL;
CREATE INDEX supplier_payables_agenda_idx
  ON supplier_payables (company_id, programada_el, vence_el, supplier_id);
CREATE INDEX supplier_payables_proveedor_idx
  ON supplier_payables (company_id, supplier_id, creado_en);

COMMENT ON TABLE supplier_payables IS
  'Factura CFDI u obligación excepcional. MXN en centavos enteros. No es un movimiento bancario.';

CREATE TABLE supplier_payable_documents (
  document_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  payable_id uuid NOT NULL,
  tipo text NOT NULL,
  creado_en timestamptz NOT NULL,
  PRIMARY KEY (document_id, company_id),
  CONSTRAINT supplier_payable_documents_documento
    FOREIGN KEY (document_id, company_id) REFERENCES documents (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_payable_documents_cargo
    FOREIGN KEY (payable_id, company_id) REFERENCES supplier_payables (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_payable_documents_tipo CHECK (tipo IN ('xml', 'pdf', 'evidencia'))
);

CREATE INDEX supplier_payable_documents_cargo_idx
  ON supplier_payable_documents (company_id, payable_id, creado_en);

CREATE TABLE supplier_payment_requests (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  payable_id uuid NOT NULL,
  supplier_clabe_id uuid NOT NULL,
  clabe text NOT NULL,
  total_centavos bigint NOT NULL,
  programada_el date NOT NULL,
  estado text NOT NULL DEFAULT 'por_autorizar',
  solicitado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  solicitado_en timestamptz NOT NULL,
  resuelto_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  resuelto_en timestamptz,
  motivo_resolucion text,
  version integer NOT NULL DEFAULT 1,
  client_request_id uuid,
  creado_en timestamptz NOT NULL,
  CONSTRAINT supplier_payment_requests_cargo
    FOREIGN KEY (payable_id, company_id) REFERENCES supplier_payables (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_payment_requests_clabe
    FOREIGN KEY (supplier_clabe_id, company_id) REFERENCES supplier_clabes (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT supplier_payment_requests_estado CHECK (
    estado IN ('por_autorizar', 'listo_para_pagar', 'rechazado', 'cancelado')
  ),
  CONSTRAINT supplier_payment_requests_clabe_valida CHECK (clabe ~ '^[0-9]{18}$' AND clabe_digito_371(clabe)),
  CONSTRAINT supplier_payment_requests_total CHECK (total_centavos > 0),
  CONSTRAINT supplier_payment_requests_personas CHECK (
    resuelto_por IS NULL OR resuelto_por <> solicitado_por OR estado = 'cancelado'
  ),
  CONSTRAINT supplier_payment_requests_resolucion CHECK (
    (estado = 'por_autorizar' AND resuelto_por IS NULL AND resuelto_en IS NULL AND motivo_resolucion IS NULL)
    OR (estado IN ('listo_para_pagar', 'rechazado', 'cancelado') AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL)
  ),
  CONSTRAINT supplier_payment_requests_motivo CHECK (
    (estado IN ('rechazado', 'cancelado') AND motivo_resolucion IS NOT NULL AND char_length(btrim(motivo_resolucion)) BETWEEN 5 AND 500)
    OR (estado IN ('por_autorizar', 'listo_para_pagar') AND motivo_resolucion IS NULL)
  ),
  CONSTRAINT supplier_payment_requests_version CHECK (version > 0)
);

ALTER TABLE supplier_payment_requests ADD CONSTRAINT supplier_payment_requests_id_empresa UNIQUE (id, company_id);

CREATE UNIQUE INDEX supplier_payment_requests_una_por_cargo ON supplier_payment_requests (payable_id);
CREATE UNIQUE INDEX supplier_payment_requests_idempotencia
  ON supplier_payment_requests (company_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX supplier_payment_requests_bandeja_idx
  ON supplier_payment_requests (company_id, estado, programada_el, solicitado_en);

COMMENT ON TABLE supplier_payment_requests IS
  'Solicitud y autorización de una obligación. Listo para pagar no significa enviado ni pagado.';

-- Cada transición deja la versión que se cerró: quién resolvió, por qué y qué
-- instrucción tenía. La escribe un trigger; nadie la reescribe ni la borra.
CREATE TABLE supplier_payment_request_history (
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

CREATE INDEX supplier_payment_request_history_solicitud_idx
  ON supplier_payment_request_history (company_id, request_id, cerrado_en);

COMMENT ON TABLE supplier_payment_request_history IS
  'Versiones cerradas de cada solicitud de pago. Solo inserción por trigger; conserva rechazos y autorizaciones retiradas.';

-- Lecturas de rol dentro de triggers. La baja efectiva quita la capacidad.
-- Solo responden por la empresa del contexto: con otra empresa dicen que no.
CREATE FUNCTION cliente_tiene_rol_operativo(p_company uuid, p_user uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
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

CREATE FUNCTION cliente_liberadores_operativos(p_company uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(DISTINCT m.user_id)::integer
  FROM memberships m
  JOIN membership_roles r ON r.company_id = m.company_id AND r.user_id = m.user_id
  LEFT JOIN employees e ON e.company_id = m.company_id AND e.user_id = m.user_id
  WHERE p_company = app_empresa() AND m.company_id = p_company AND m.estado = 'activa' AND r.rol = 'liberador'
    AND (e.id IS NULL OR e.baja_en IS NULL OR e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
$$;

REVOKE ALL ON FUNCTION cliente_tiene_rol_operativo(uuid, uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION cliente_liberadores_operativos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cliente_tiene_rol_operativo(uuid, uuid, text[]) TO plataforma_cliente;
GRANT EXECUTE ON FUNCTION cliente_liberadores_operativos(uuid) TO plataforma_cliente;

-- El cargo solo cambia por dos caminos: la corrección de quien lo solicitó
-- mientras su solicitud está rechazada, o la anulación cuando la solicitud se
-- cancela. Un CFDI no cambia sus datos fiscales; una excepción no sube ni baja
-- de importe sin evidencia nueva ligada en la misma transacción.
CREATE FUNCTION supplier_payables_revisar()
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

CREATE TRIGGER supplier_payables_antes
BEFORE INSERT OR UPDATE OR DELETE ON supplier_payables
FOR EACH ROW EXECUTE FUNCTION supplier_payables_revisar();
CREATE TRIGGER supplier_payables_no_truncate
BEFORE TRUNCATE ON supplier_payables
FOR EACH STATEMENT EXECUTE FUNCTION supplier_payables_revisar();

-- Máquina de estados de la solicitud. Cada transición dice quién la hace y qué
-- puede cambiar. La instrucción (CLABE, importe, fecha, solicitante) solo se
-- renueva al volver a solicitar tras un rechazo.
--
--   por_autorizar    -> listo_para_pagar  liberador distinto de quien solicitó
--   por_autorizar    -> rechazado         liberador distinto de quien solicitó
--   por_autorizar    -> cancelado         quien solicitó
--   rechazado        -> por_autorizar     quien solicitó, con versión nueva
--   rechazado        -> cancelado         quien solicitó
--   listo_para_pagar -> cancelado         liberador o administrador, con motivo
--   listo_para_pagar -> por_autorizar     solo si la instrucción ya no vale:
--                                         la CLABE dejó de estar vigente o el
--                                         proveedor quedó bloqueado (69-B o baja)
--
-- Al autorizar, el proveedor, la CLABE y el cargo se leen FOR SHARE: la
-- relectura 69-B y el cambio de CLABE actualizan esas filas y esperan a que
-- la autorización termine (o la autorización espera y ve el bloqueo).
CREATE FUNCTION supplier_payment_requests_revisar()
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
      IF vigente.id IS NOT NULL AND proveedor.activo AND proveedor.boton_pago THEN
        RAISE EXCEPTION 'pago_proveedor_regreso_sin_causa';
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

CREATE TRIGGER supplier_payment_requests_antes
BEFORE INSERT OR UPDATE OR DELETE ON supplier_payment_requests
FOR EACH ROW EXECUTE FUNCTION supplier_payment_requests_revisar();
CREATE TRIGGER supplier_payment_requests_no_truncate
BEFORE TRUNCATE ON supplier_payment_requests
FOR EACH STATEMENT EXECUTE FUNCTION supplier_payment_requests_revisar();

-- La versión que se cierra queda en el historial. Corre como dueña porque el
-- portal no escribe el historial directamente; quien cierra es la persona del
-- contexto de la empresa, o nadie si fue el sistema (relectura 69-B).
CREATE FUNCTION supplier_payment_requests_historial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE TRIGGER supplier_payment_requests_historial
AFTER UPDATE ON supplier_payment_requests
FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado OR OLD.version IS DISTINCT FROM NEW.version)
EXECUTE FUNCTION supplier_payment_requests_historial();

-- Una solicitud cancelada anula su cargo: el UUID del CFDI queda libre para
-- capturarse de nuevo y el cargo anulado se conserva.
CREATE FUNCTION supplier_payment_requests_anula_cargo()
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

CREATE TRIGGER supplier_payment_requests_anula_cargo
AFTER UPDATE OF estado ON supplier_payment_requests
FOR EACH ROW WHEN (NEW.estado = 'cancelado' AND OLD.estado IS DISTINCT FROM 'cancelado')
EXECUTE FUNCTION supplier_payment_requests_anula_cargo();

-- Un pago listo para pagar no conserva una autorización que ya no vale. Al
-- cerrar la CLABE que tenía su instrucción, o al bloquearse el proveedor (la
-- relectura 69-B o una baja), regresa a revisión en la MISMA transacción y deja
-- su evento en la bitácora. Corre como quien hizo el cambio: en el portal, la
-- persona de la empresa; en la relectura 69-B, el sistema.
CREATE FUNCTION pagos_listos_regresan_a_revision()
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

CREATE TRIGGER supplier_clabes_regresa_pagos_listos
AFTER UPDATE OF vigente_hasta ON supplier_clabes
FOR EACH ROW WHEN (OLD.vigente_hasta IS NULL AND NEW.vigente_hasta IS NOT NULL)
EXECUTE FUNCTION pagos_listos_regresan_a_revision();

CREATE TRIGGER suppliers_regresa_pagos_listos
AFTER UPDATE OF boton_pago, activo ON suppliers
FOR EACH ROW WHEN ((OLD.boton_pago AND NOT NEW.boton_pago) OR (OLD.activo AND NOT NEW.activo))
EXECUTE FUNCTION pagos_listos_regresan_a_revision();

CREATE FUNCTION documentos_relacionados_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'documento_relacionado_inmutable';
END;
$$;

CREATE TRIGGER supplier_documents_no_cambios
BEFORE UPDATE OR DELETE ON supplier_documents
FOR EACH ROW EXECUTE FUNCTION documentos_relacionados_append_only();
CREATE TRIGGER supplier_payable_documents_no_cambios
BEFORE UPDATE OR DELETE ON supplier_payable_documents
FOR EACH ROW EXECUTE FUNCTION documentos_relacionados_append_only();

CREATE FUNCTION historial_pago_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'historial_pago_inmutable';
END;
$$;

CREATE TRIGGER supplier_payment_request_history_no_cambios
BEFORE UPDATE OR DELETE ON supplier_payment_request_history
FOR EACH ROW EXECUTE FUNCTION historial_pago_append_only();
CREATE TRIGGER supplier_payment_request_history_no_truncate
BEFORE TRUNCATE ON supplier_payment_request_history
FOR EACH STATEMENT EXECUTE FUNCTION historial_pago_append_only();

-- Toda escritura deja su evento en la misma transacción.
CREATE FUNCTION pagos_proveedores_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE CONSTRAINT TRIGGER supplier_documents_auditoria
AFTER INSERT ON supplier_documents DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pagos_proveedores_exige_auditoria();
CREATE CONSTRAINT TRIGGER supplier_payable_documents_auditoria
AFTER INSERT ON supplier_payable_documents DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pagos_proveedores_exige_auditoria();
CREATE CONSTRAINT TRIGGER supplier_payables_auditoria
AFTER INSERT OR UPDATE ON supplier_payables DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pagos_proveedores_exige_auditoria();
CREATE CONSTRAINT TRIGGER supplier_payment_requests_auditoria
AFTER INSERT OR UPDATE ON supplier_payment_requests DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pagos_proveedores_exige_auditoria();

-- Aislamiento y permisos mínimos -------------------------------------------------
GRANT SELECT, INSERT ON supplier_documents, supplier_payable_documents TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON supplier_payables, supplier_payment_requests TO plataforma_cliente;
GRANT SELECT ON supplier_payment_request_history TO plataforma_cliente;

ALTER TABLE supplier_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payable_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_request_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_documents_cliente ON supplier_documents FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY supplier_payables_cliente ON supplier_payables FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY supplier_payable_documents_cliente ON supplier_payable_documents FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY supplier_payment_requests_cliente ON supplier_payment_requests FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY supplier_payment_request_history_cliente ON supplier_payment_request_history FOR SELECT TO plataforma_cliente
  USING (company_id = app_empresa());

ALTER TABLE supplier_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_payables FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_payable_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_request_history FORCE ROW LEVEL SECURITY;
