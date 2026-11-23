-- Clientes de prueba: un alta rápida para probar el portal y las tarjetas mientras
-- el procesador está en su ambiente de pruebas.
--
-- El alta regulada (0028) no cambia: desde la aplicación una empresa nace prospecto
-- y llega a activa con expediente, dictamen, riesgo y la decisión de otra persona.
-- Un cliente de prueba es otra cosa y queda marcado para siempre (de_prueba): nace
-- activo por la única puerta de abajo, que pide el rol de Administración de la
-- plataforma y deja su evento en la bitácora en la misma transacción. Que la puerta
-- solo se ofrezca con el procesador en pruebas lo decide el servidor (la base no
-- conoce las llaves); la base garantiza quién, la marca y el rastro.
--
-- No se borran (la bitácora y las llaves foráneas los sostienen): se archivan. Un
-- cliente archivado sale de las listas de Operación y su gente ya no entra a él.

SET search_path TO public;

ALTER TABLE companies
  ADD COLUMN de_prueba boolean NOT NULL DEFAULT false,
  ADD COLUMN archivada_en timestamptz,
  ADD CONSTRAINT companies_prueba_no_es_demostracion CHECK (NOT (de_prueba AND demostracion)),
  ADD CONSTRAINT companies_solo_prueba_se_archiva CHECK (archivada_en IS NULL OR de_prueba);

COMMENT ON COLUMN companies.de_prueba IS
  'Cliente de prueba del alta rápida (0050): nació activo sin el alta regulada. La marca no se quita.';
COMMENT ON COLUMN companies.archivada_en IS
  'Cuándo se archivó el cliente de prueba. Archivado: fuera de las listas y sin acceso de su gente.';

-- Ni la marca ni el archivo se escriben desde la aplicación: solo por las puertas de abajo.
CREATE FUNCTION companies_prueba_por_su_puerta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user IN ('plataforma_sofipo', 'plataforma_cliente', 'plataforma_tarea', 'plataforma_app')
      AND (NEW.de_prueba OR NEW.archivada_en IS NOT NULL) THEN
      RAISE EXCEPTION 'cliente_de_prueba_por_su_puerta';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.de_prueba AND NOT NEW.de_prueba THEN
    RAISE EXCEPTION 'cliente_de_prueba_no_se_desmarca';
  END IF;
  IF OLD.archivada_en IS NOT NULL AND NEW.archivada_en IS DISTINCT FROM OLD.archivada_en THEN
    RAISE EXCEPTION 'cliente_de_prueba_ya_archivado';
  END IF;
  IF current_user IN ('plataforma_sofipo', 'plataforma_cliente', 'plataforma_tarea', 'plataforma_app')
    AND (NEW.de_prueba IS DISTINCT FROM OLD.de_prueba OR NEW.archivada_en IS DISTINCT FROM OLD.archivada_en) THEN
    RAISE EXCEPTION 'cliente_de_prueba_por_su_puerta';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_prueba_por_su_puerta
BEFORE INSERT OR UPDATE OF de_prueba, archivada_en ON companies
FOR EACH ROW EXECUTE FUNCTION companies_prueba_por_su_puerta();

-- La puerta del alta rápida. Corre con la dueña: el cliente nace activo y marcado.
CREATE FUNCTION cliente_de_prueba_alta(
  p_id uuid,
  p_rfc text,
  p_razon_social text,
  p_codigo_postal text,
  p_regimen text,
  p_uso_cfdi text,
  p_contacto_nombre text,
  p_contacto_correo text,
  p_peticion uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  operador uuid := app_operador();
  persona uuid := app_usuario();
BEGIN
  IF operador IS NULL OR persona IS NULL
    OR NOT personal_tiene_rol(operador, persona, ARRAY['administracion_plataforma']) THEN
    RAISE EXCEPTION 'sin_permiso_cliente_de_prueba';
  END IF;
  IF EXISTS (SELECT 1 FROM companies c WHERE c.rfc = p_rfc) THEN
    RAISE EXCEPTION 'rfc_duplicado';
  END IF;
  -- El personal de Operación no entra al portal de clientes: su invitación no le serviría.
  IF EXISTS (
    SELECT 1 FROM users u JOIN platform_staff s ON s.user_id = u.id WHERE u.correo = p_contacto_correo
  ) THEN
    RAISE EXCEPTION 'correo_es_de_personal';
  END IF;
  INSERT INTO companies (
    id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at, operator_id, estado,
    demostracion, de_prueba, originada_por, contacto_nombre, contacto_correo
  ) VALUES (
    p_id, p_rfc, p_razon_social, p_codigo_postal, p_regimen, p_uso_cfdi, now(), operador, 'activa',
    false, true, persona, p_contacto_nombre, p_contacto_correo
  );
  INSERT INTO audit_log (
    operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, peticion_id, origen, cambio
  ) VALUES
    (operador, p_id, 'personal', persona, 'sofipo', 'alta_empresa', 'companies', p_id, p_peticion, 'operacion',
      jsonb_build_object('demostracion', false, 'de_prueba', true)),
    (operador, p_id, 'personal', persona, 'sofipo', 'cliente_prueba_creado', 'companies', p_id, p_peticion, 'operacion', NULL);
  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION cliente_de_prueba_alta(uuid, text, text, text, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cliente_de_prueba_alta(uuid, text, text, text, text, text, text, text, uuid) TO plataforma_sofipo;

-- Archivar: solo un cliente de prueba del mismo operador, una vez, con su evento.
CREATE FUNCTION cliente_de_prueba_archivar(p_company uuid, p_peticion uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  operador uuid := app_operador();
  persona uuid := app_usuario();
  empresa companies%ROWTYPE;
BEGIN
  IF operador IS NULL OR persona IS NULL
    OR NOT personal_tiene_rol(operador, persona, ARRAY['administracion_plataforma']) THEN
    RAISE EXCEPTION 'sin_permiso_cliente_de_prueba';
  END IF;
  SELECT * INTO empresa FROM companies c WHERE c.id = p_company AND c.operator_id = operador FOR UPDATE;
  IF empresa.id IS NULL OR NOT empresa.de_prueba THEN
    RAISE EXCEPTION 'no_es_cliente_de_prueba';
  END IF;
  IF empresa.archivada_en IS NOT NULL THEN
    RAISE EXCEPTION 'cliente_de_prueba_ya_archivado';
  END IF;
  UPDATE companies SET archivada_en = now() WHERE id = p_company;
  INSERT INTO audit_log (
    operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, peticion_id, origen
  ) VALUES (operador, p_company, 'personal', persona, 'sofipo', 'cliente_prueba_archivado', 'companies', p_company, p_peticion, 'operacion');
END;
$$;

REVOKE ALL ON FUNCTION cliente_de_prueba_archivar(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cliente_de_prueba_archivar(uuid, uuid) TO plataforma_sofipo;
