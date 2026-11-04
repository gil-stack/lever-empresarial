-- Fase 4. Bitácora nueva hacia adelante.
--
-- Cada evento guarda operador, empresa (vacía en actos de plataforma), tipo
-- de actor, actor, superficie, acción, entidad, identificador, motivo,
-- identificador de petición, origen y el cambio con claves permitidas.
-- Nunca guarda secretos, PAN ni contraseñas.
--
-- La regla de «misma transacción» deja de comparar xmin: el evento guarda
-- txid_current() en su columna txid. Dentro de un SAVEPOINT, txid_current()
-- sigue siendo el de la transacción de arriba, así que la regla no se rompe.
--
-- audit_events queda como histórico de solo lectura.

SET search_path TO public;

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  actor_tipo text NOT NULL,
  actor_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  superficie text NOT NULL,
  accion text NOT NULL,
  entidad text NOT NULL,
  identificador uuid,
  motivo text,
  peticion_id uuid,
  origen text,
  cambio jsonb,
  txid bigint NOT NULL DEFAULT txid_current(),
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_empresa_del_operador
    FOREIGN KEY (company_id, operator_id)
    REFERENCES companies (id, operator_id)
    ON DELETE RESTRICT,
  CONSTRAINT audit_log_empresa_con_operador CHECK (company_id IS NULL OR operator_id IS NOT NULL),
  CONSTRAINT audit_log_actor_tipo CHECK (actor_tipo IN ('personal', 'miembro', 'sistema', 'aviso')),
  -- Un intento fallido de entrada no tiene actor: lo registra el sistema.
  CONSTRAINT audit_log_actor_presente CHECK (
    (actor_tipo IN ('personal', 'miembro')) = (actor_id IS NOT NULL)
  ),
  CONSTRAINT audit_log_superficie CHECK (superficie IN ('sofipo', 'cliente', 'telefono', 'sistema')),
  CONSTRAINT audit_log_accion_formato CHECK (accion ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT audit_log_entidad_formato CHECK (entidad ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT audit_log_motivo_formato CHECK (
    motivo IS NULL
    OR (motivo = btrim(motivo) AND char_length(motivo) BETWEEN 1 AND 500 AND motivo !~ '[[:cntrl:]]')
  ),
  CONSTRAINT audit_log_origen_formato CHECK (origen IS NULL OR origen ~ '^[a-z0-9_.:-]{1,80}$'),
  CONSTRAINT audit_log_cambio_objeto CHECK (cambio IS NULL OR jsonb_typeof(cambio) = 'object')
);

CREATE INDEX audit_log_company_idx ON audit_log (company_id, ocurrido_en);
CREATE INDEX audit_log_operator_idx ON audit_log (operator_id, ocurrido_en);
CREATE INDEX audit_log_entidad_idx ON audit_log (entidad, identificador);
CREATE INDEX audit_log_txid_idx ON audit_log (txid);

COMMENT ON TABLE audit_log IS
  'Bitácora. Solo inserción. Una sola función de la aplicación escribe aquí. Sin secretos, PAN ni contraseñas.';
COMMENT ON COLUMN audit_log.actor_tipo IS 'personal del operador, miembro de una empresa, sistema o aviso externo.';
COMMENT ON COLUMN audit_log.superficie IS 'Por dónde entró el acto: sofipo, cliente, telefono o sistema.';
COMMENT ON COLUMN audit_log.txid IS 'Transacción de arriba que escribió el evento. Sostiene la regla de la misma transacción.';
COMMENT ON COLUMN audit_log.origen IS 'Canal del acto, por ejemplo consola o comando. No guarda la IP en claro.';

CREATE FUNCTION audit_log_solo_insercion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log solo acepta inserciones';
END;
$$;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION audit_log_solo_insercion();

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION audit_log_solo_insercion();

CREATE TRIGGER audit_log_no_truncate
BEFORE TRUNCATE ON audit_log
FOR EACH STATEMENT
EXECUTE FUNCTION audit_log_solo_insercion();

-- El histórico ya no recibe filas.
CREATE FUNCTION audit_events_historico()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events es historico: la bitacora vive en audit_log';
END;
$$;

CREATE TRIGGER audit_events_no_insert
BEFORE INSERT ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_historico();

COMMENT ON TABLE audit_events IS
  'Histórico de las fases 1 a 3. Solo lectura. La bitácora vigente es audit_log.';

-- Una sola pregunta para todas las reglas: ¿esta transacción dejó su evento?
-- SECURITY DEFINER para que la regla no dependa de lo que el rol que escribe
-- alcanza a leer.
CREATE FUNCTION bitacora_tiene_evento(
  p_company uuid,
  p_accion text,
  p_entidad text,
  p_identificador uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM audit_log
    WHERE company_id IS NOT DISTINCT FROM p_company
      AND (p_accion IS NULL OR accion = p_accion)
      AND entidad = p_entidad
      AND identificador = p_identificador
      AND (actor_id IS NOT NULL OR actor_tipo = 'sistema')
      AND txid = txid_current()
  );
$$;

COMMENT ON FUNCTION bitacora_tiene_evento(uuid, text, text, uuid) IS
  'Verdadero si la transacción actual dejó el evento. Acción vacía: cualquier acción sobre esa entidad.';

-- Las reglas de las fases 1 a 3 leen ahora la bitácora nueva.

CREATE OR REPLACE FUNCTION companies_exige_auditoria_de_alta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT bitacora_tiene_evento(NEW.id, 'alta_empresa', 'companies', NEW.id) THEN
    RAISE EXCEPTION 'el alta de la empresa exige registrarEvento en la misma transaccion';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cost_centers_exige_auditoria_de_alta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT bitacora_tiene_evento(NEW.company_id, 'alta_centro_costo', 'cost_centers', NEW.id) THEN
    RAISE EXCEPTION 'auditoria_de_persona_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION employees_exige_auditoria_de_alta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT bitacora_tiene_evento(NEW.company_id, 'alta_persona', 'employees', NEW.id) THEN
    RAISE EXCEPTION 'auditoria_de_persona_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION employees_exige_auditoria_de_baja()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.baja_en IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.baja_en IS NOT DISTINCT FROM OLD.baja_en THEN
    RETURN NEW;
  END IF;
  IF NOT bitacora_tiene_evento(NEW.company_id, 'baja_persona', 'employees', NEW.id) THEN
    RAISE EXCEPTION 'auditoria_de_persona_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION suppliers_exige_auditoria_de_alta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT bitacora_tiene_evento(NEW.company_id, 'alta_proveedor', 'suppliers', NEW.id) THEN
    RAISE EXCEPTION 'auditoria_de_proveedor_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION supplier_clabes_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT bitacora_tiene_evento(NEW.company_id, 'clabe_proveedor', 'supplier_clabes', NEW.id) THEN
    RAISE EXCEPTION 'auditoria_de_clabe_ausente';
  END IF;
  RETURN NEW;
END;
$$;

-- Hoy sin rastro, desde aquí con rastro: dar o quitar un rol y cargar la 69-B.

CREATE FUNCTION membership_roles_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fila membership_roles;
BEGIN
  IF TG_OP = 'DELETE' THEN
    fila := OLD;
  ELSE
    fila := NEW;
  END IF;
  IF NOT bitacora_tiene_evento(fila.company_id, NULL, 'membership_roles', fila.user_id) THEN
    RAISE EXCEPTION 'auditoria_de_rol_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER membership_roles_exige_auditoria
AFTER INSERT OR DELETE ON membership_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION membership_roles_exige_auditoria();

CREATE FUNCTION lista_69b_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT bitacora_tiene_evento(NULL, 'cargar_lista_69b', 'lista_69b_snapshots', NEW.id) THEN
    RAISE EXCEPTION 'auditoria_de_lista_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER lista_69b_exige_auditoria
AFTER INSERT ON lista_69b_snapshots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lista_69b_exige_auditoria();

-- Las dos firmas cuentan personas con membresía activa y roles combinables.

CREATE OR REPLACE FUNCTION lotes_prueba_revisar_firmas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  roles_liberador text[];
  roles_solicitante text[];
  autorizados bigint;
  hoy date := (timezone('America/Mexico_City', clock_timestamp()))::date;
BEGIN
  IF NEW.es_prueba IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'dinero_real_fuera' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.liberador_user_id IS NOT NULL OR NEW.liberado_en IS NOT NULL THEN
      RAISE EXCEPTION 'firma_en_un_solo_acto' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.liberador_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'lote_ya_firmado' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.solicitante_user_id IS DISTINCT FROM OLD.solicitante_user_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.solicitado_en IS DISTINCT FROM OLD.solicitado_en
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'entrada_invalida' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.liberador_user_id IS NULL OR NEW.liberado_en IS NULL THEN
      RAISE EXCEPTION 'entrada_invalida' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.solicitante_user_id = NEW.liberador_user_id THEN
      RAISE EXCEPTION 'misma_persona_en_las_dos_firmas' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT array_agg(r.rol) INTO roles_solicitante
  FROM memberships AS m
  JOIN membership_roles AS r ON r.user_id = m.user_id AND r.company_id = m.company_id
  WHERE m.user_id = NEW.solicitante_user_id
    AND m.company_id = NEW.company_id
    AND m.estado = 'activa';

  IF roles_solicitante IS NULL THEN
    RAISE EXCEPTION 'firmante_ajeno' USING ERRCODE = 'P0001';
  END IF;

  IF NOT roles_solicitante && ARRAY['administrador', 'liberador', 'solicitante'] THEN
    IF 'contador' = ANY (roles_solicitante) THEN
      RAISE EXCEPTION 'contador_no_crea_pago' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'sin_permiso_para_solicitar' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM employees
    WHERE user_id = NEW.solicitante_user_id
      AND company_id = NEW.company_id
      AND baja_en IS NOT NULL
      AND baja_en <= hoy
  ) THEN
    RAISE EXCEPTION 'sin_permiso_para_solicitar' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(DISTINCT m.user_id) INTO autorizados
  FROM memberships AS m
  JOIN membership_roles AS r ON r.user_id = m.user_id AND r.company_id = m.company_id
  LEFT JOIN employees AS empleado
    ON empleado.user_id = m.user_id
   AND empleado.company_id = m.company_id
  WHERE m.company_id = NEW.company_id
    AND m.estado = 'activa'
    AND r.rol = 'liberador'
    AND (
      empleado.id IS NULL
      OR empleado.baja_en IS NULL
      OR empleado.baja_en > hoy
    );

  IF autorizados < 2 THEN
    RAISE EXCEPTION 'empresa_no_operable' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(r.rol) INTO roles_liberador
  FROM memberships AS m
  JOIN membership_roles AS r ON r.user_id = m.user_id AND r.company_id = m.company_id
  WHERE m.user_id = NEW.liberador_user_id
    AND m.company_id = NEW.company_id
    AND m.estado = 'activa';

  IF roles_liberador IS NULL THEN
    RAISE EXCEPTION 'firmante_ajeno' USING ERRCODE = 'P0001';
  END IF;

  IF NOT 'liberador' = ANY (roles_liberador) THEN
    IF 'contador' = ANY (roles_liberador) THEN
      RAISE EXCEPTION 'contador_no_libera' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'sin_permiso_para_liberar' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM employees
    WHERE user_id = NEW.liberador_user_id
      AND company_id = NEW.company_id
      AND baja_en IS NOT NULL
      AND baja_en <= hoy
  ) THEN
    RAISE EXCEPTION 'sin_permiso_para_liberar' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- El día de la baja se quita solo el rol de liberador. Si no le queda otro,
-- conserva tarjetahabiente, como antes.
CREATE OR REPLACE FUNCTION employees_quita_liberador()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.baja_en IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date THEN
    RETURN NEW;
  END IF;
  DELETE FROM membership_roles
  WHERE user_id = NEW.user_id
    AND company_id = NEW.company_id
    AND rol = 'liberador';
  IF FOUND AND NOT EXISTS (
    SELECT 1 FROM membership_roles WHERE user_id = NEW.user_id AND company_id = NEW.company_id
  ) THEN
    INSERT INTO membership_roles (user_id, company_id, rol)
    VALUES (NEW.user_id, NEW.company_id, 'tarjetahabiente');
  END IF;
  RETURN NEW;
END;
$$;
