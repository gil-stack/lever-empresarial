-- Ola R1. Alta regulada de empresas.
--
-- Fuente normativa: Disposiciones de carácter general a que se refiere el
-- artículo 124 de la Ley de Ahorro y Crédito Popular (SOFIPO), compilado
-- oficial de la UIF con la última reforma publicada en el DOF el 09/09/2021.
-- Cada regla de abajo cita su disposición («4ª fr. II», «75ª», …).
--
-- Qué hace este archivo:
--   1. Roles del personal de la SOFIPO: originación, aprobación, cumplimiento
--      y auditoría, con la incompatibilidad de la 50ª guardada en la base.
--   2. Expediente de persona moral versionado (4ª fr. II): datos, documentos
--      con SHA-256, estructura accionaria en cadena, propietarios reales
--      calculados y dictamen de Cumplimiento sobre una versión concreta.
--   3. Grado de riesgo al alta y periódico (23ª, 27ª, 30ª).
--   4. Lista de Personas Bloqueadas (73ª-77ª): cargas versionadas, cotejo al
--      alta y al operar, coincidencias exactas y posibles.
--   5. Suspensión y reactivación con doble firma; la suspensión por la lista
--      es inmediata (75ª fr. I) y reactivar exige dictamen (77ª).
--   6. Candado de activación en la base.
--   7. Descarga de documentos que deja su evento en la bitácora.
--   8. Conservación (61ª): nada de esto se borra.
--
-- Lever no transmite reportes a la UIF ni a la CNBV. El reporte de 24 horas
-- (75ª fr. II) lo presenta el oficial de cumplimiento por su vía; aquí queda
-- el plazo, el folio y la fecha que él registra.

SET search_path TO public;

-- 0. Utilidades ----------------------------------------------------------------

CREATE FUNCTION hoy_mexico()
RETURNS date
LANGUAGE sql
STABLE
AS $$ SELECT (now() AT TIME ZONE 'America/Mexico_City')::date $$;

COMMENT ON FUNCTION hoy_mexico() IS 'Fecha calendario en la Ciudad de México. Vigencias y revisiones se miden con ella.';

CREATE FUNCTION texto_regulado(p_texto text, p_maximo integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_texto IS NULL OR (
    p_texto = btrim(p_texto) AND char_length(p_texto) BETWEEN 1 AND p_maximo AND p_texto !~ '[[:cntrl:]]'
  )
$$;

-- unaccent es extensión confiable: la dueña de la base la instala sin superusuario.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- unaccent() es STABLE porque busca su diccionario en el search_path. Con el
-- diccionario explícito el resultado ya no depende de la sesión y sirve en una
-- columna generada.
CREATE FUNCTION lpb_sin_acentos(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, p_texto) $$;

-- Nombre comparable: sin acentos (también ø, å, ł…), mayúsculas, sin puntuación y
-- con las palabras en orden. Punto, coma y apóstrofo se quitan sin dejar espacio
-- para que «S.A. de C.V.» empate con «SA DE CV»; lo demás separa palabras.
-- El orden de las palabras va en COLLATE "C" para no depender del locale.
CREATE FUNCTION lpb_normalizar(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT nullif(array_to_string(ARRAY(
    SELECT palabra
    FROM unnest(string_to_array(btrim(regexp_replace(regexp_replace(
      upper(lpb_sin_acentos(coalesce(p_nombre, ''))),
      '[.,'']', '', 'g'), '[^A-Z0-9]+', ' ', 'g')), ' ')) AS palabra
    WHERE palabra <> ''
    ORDER BY palabra COLLATE "C"
  ), ' '), '')
$$;

COMMENT ON FUNCTION lpb_normalizar(text) IS
  'Nombre para cotejar contra la Lista de Personas Bloqueadas. Igualdad de nombre normalizado es solo «posible coincidencia».';

-- ¿El operador por el que se pregunta es el del contexto? La aplicación solo
-- pregunta por el suyo: el del personal (app.operator_id) o, en el portal, el de
-- su empresa. Sin contexto, no. La dueña de la base (migraciones y comandos) no
-- tiene contexto y entra con el mismo rol dueño de estas funciones. Responde false,
-- nunca NULL: «IF NOT personal_tiene_rol(...)» con NULL no lanzaría la excepción.
CREATE FUNCTION operador_del_contexto(p_operador uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    session_user = current_user
      OR p_operador = app_operador()
      OR (app_operador() IS NULL AND p_operador = (SELECT c.operator_id FROM companies c WHERE c.id = app_empresa())),
    false
  )
$$;

REVOKE ALL ON FUNCTION operador_del_contexto(uuid) FROM PUBLIC;

-- ¿La persona del personal tiene alguno de estos roles en su operador?
CREATE FUNCTION personal_tiene_rol(p_operador uuid, p_user uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT operador_del_contexto(p_operador) AND EXISTS (
    SELECT 1
    FROM platform_staff s
    JOIN platform_staff_roles r ON r.operator_id = s.operator_id AND r.user_id = s.user_id
    WHERE s.operator_id = p_operador AND s.user_id = p_user AND s.estado = 'activo' AND r.rol = ANY (p_roles)
  )
$$;

REVOKE ALL ON FUNCTION personal_tiene_rol(uuid, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_tiene_rol(uuid, uuid, text[]) TO plataforma_sofipo;

-- REPEATABLE READ: quien decide con la foto del inicio de su transacción tiene
-- que chocar con quien ya cambió lo que decide. FOR UPDATE no alcanza: una fila
-- que la otra transacción solo bloqueó no la aborta. Un UPDATE sin cambio sí
-- («could not serialize access due to concurrent update»); en READ COMMITTED
-- solo espera. La 50ª escribe así la fila de la persona antes de leer sus roles.
CREATE FUNCTION personal_bloquear_fila(p_operador uuid, p_user uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE platform_staff SET estado = estado WHERE operator_id = p_operador AND user_id = p_user
$$;

REVOKE ALL ON FUNCTION personal_bloquear_fila(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_bloquear_fila(uuid, uuid) TO plataforma_sofipo;

-- ¿El registro de esta persona en el personal nace en esta transacción? Invitada
-- y con alta_en de ahora (now() es el inicio de la transacción; nadie reescribe
-- alta_en). xmin no sirve: personal_bloquear_fila también lo renueva.
CREATE FUNCTION personal_nace_en_esta_transaccion(p_operador uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_staff s
    WHERE s.operator_id = p_operador AND s.user_id = p_user AND s.estado = 'invitado' AND s.alta_en = now()
  )
$$;

REVOKE ALL ON FUNCTION personal_nace_en_esta_transaccion(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_nace_en_esta_transaccion(uuid, uuid) TO plataforma_sofipo;

-- El evento de un rol: misma acción, persona, operador, sin empresa, la entidad
-- del catálogo y el rol en «cambio», en esta transacción. El alta del personal
-- nombra sus roles en un solo evento (entidad platform_staff).
CREATE FUNCTION personal_rol_tiene_evento(p_accion text, p_operador uuid, p_user uuid, p_rol text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM audit_log a
    WHERE a.accion = p_accion AND a.identificador = p_user AND a.operator_id = p_operador
      AND a.company_id IS NULL AND a.txid = txid_current()
      AND a.entidad = CASE p_accion WHEN 'alta_personal' THEN 'platform_staff' ELSE 'platform_staff_roles' END
      AND CASE p_accion
            WHEN 'alta_personal' THEN p_rol = ANY (string_to_array(a.cambio ->> 'rol', ','))
            ELSE a.cambio ->> 'rol' = p_rol
          END
  )
$$;

REVOKE ALL ON FUNCTION personal_rol_tiene_evento(text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_rol_tiene_evento(text, uuid, uuid, text) TO plataforma_sofipo;

-- 61ª: el expediente y sus constancias se conservan. Nada se borra ni se trunca.
CREATE FUNCTION conservacion_no_se_borra()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'conservacion_no_se_borra';
END;
$$;

-- 1. Roles del personal ----------------------------------------------------------

ALTER TABLE platform_staff_roles DROP CONSTRAINT platform_staff_roles_conocido;
ALTER TABLE platform_staff_roles ADD CONSTRAINT platform_staff_roles_conocido CHECK (
  rol IN ('administracion_plataforma', 'originacion', 'aprobacion', 'cumplimiento', 'auditoria')
);

COMMENT ON TABLE platform_staff_roles IS
  'Roles del personal del operador. administracion_plataforma: lista 69-B, precio, personal e invitaciones. '
  'originacion: prospectos y expediente. aprobacion: decide activaciones y suspensiones. '
  'cumplimiento: dictamen, riesgo y Lista de Personas Bloqueadas. auditoria: solo lectura.';

-- 50ª: el oficial de cumplimiento es independiente de las áreas que promueven
-- o gestionan productos (originación) y en ningún caso recae en quien tiene
-- funciones de auditoría interna. Nadie se da ni se quita un rol a sí mismo.
CREATE FUNCTION platform_staff_roles_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  fila platform_staff_roles%ROWTYPE;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'rol_personal_no_se_trunca';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'rol_personal_no_se_reescribe';
  END IF;
  IF TG_OP = 'DELETE' THEN
    fila := OLD;
  ELSE
    fila := NEW;
  END IF;

  -- Dos asignaciones simultáneas a la misma persona no se cruzan.
  PERFORM pg_advisory_xact_lock(hashtextextended('platform_staff_roles:' || fila.operator_id::text || ':' || fila.user_id::text, 0));

  IF current_user = 'plataforma_sofipo' THEN
    IF app_usuario() IS NULL THEN
      -- Solo el alta del personal que hace el sistema desde la variable retirada:
      -- Administración para una persona cuyo registro nace en esta transacción.
      IF TG_OP <> 'INSERT' OR fila.rol <> 'administracion_plataforma'
        OR NOT personal_nace_en_esta_transaccion(fila.operator_id, fila.user_id) THEN
        RAISE EXCEPTION 'sin_permiso_roles';
      END IF;
    ELSE
      IF fila.user_id = app_usuario() THEN
        RAISE EXCEPTION 'rol_propio';
      END IF;
      IF NOT personal_tiene_rol(fila.operator_id, app_usuario(), ARRAY['administracion_plataforma']) THEN
        RAISE EXCEPTION 'sin_permiso_roles';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM personal_bloquear_fila(NEW.operator_id, NEW.user_id);
    IF NEW.rol = 'cumplimiento' AND EXISTS (
      SELECT 1 FROM platform_staff_roles r
      WHERE r.operator_id = NEW.operator_id AND r.user_id = NEW.user_id AND r.rol IN ('auditoria', 'originacion')
    ) THEN
      RAISE EXCEPTION 'roles_incompatibles';
    END IF;
    IF NEW.rol IN ('auditoria', 'originacion') AND EXISTS (
      SELECT 1 FROM platform_staff_roles r
      WHERE r.operator_id = NEW.operator_id AND r.user_id = NEW.user_id AND r.rol = 'cumplimiento'
    ) THEN
      RAISE EXCEPTION 'roles_incompatibles';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER platform_staff_roles_revisar
BEFORE INSERT OR UPDATE OR DELETE ON platform_staff_roles
FOR EACH ROW EXECUTE FUNCTION platform_staff_roles_revisar();
CREATE TRIGGER platform_staff_roles_no_truncate
BEFORE TRUNCATE ON platform_staff_roles
FOR EACH STATEMENT EXECUTE FUNCTION platform_staff_roles_revisar();

-- La transacción que asigna o quita un rol deja su evento: uno por rol, con el
-- rol en «cambio». El evento del alta solo cubre a quien nace en esta transacción.
CREATE FUNCTION platform_staff_roles_exige_evento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'plataforma_sofipo' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' AND NOT (
    personal_rol_tiene_evento('rol_personal_asignado', NEW.operator_id, NEW.user_id, NEW.rol)
    OR (
      personal_rol_tiene_evento('alta_personal', NEW.operator_id, NEW.user_id, NEW.rol)
      AND personal_nace_en_esta_transaccion(NEW.operator_id, NEW.user_id)
    )
  ) THEN
    RAISE EXCEPTION 'rol_personal_sin_auditoria';
  END IF;
  IF TG_OP = 'DELETE' AND NOT personal_rol_tiene_evento('rol_personal_retirado', OLD.operator_id, OLD.user_id, OLD.rol) THEN
    RAISE EXCEPTION 'rol_personal_sin_auditoria';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER platform_staff_roles_exige_evento
AFTER INSERT OR DELETE ON platform_staff_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION platform_staff_roles_exige_evento();

GRANT DELETE ON platform_staff_roles TO plataforma_sofipo;

-- Antes de esta ola todo el personal era Administración, y las políticas de la
-- 0018 dan escritura al rol del personal sin mirar su rol. Ahora hay roles de solo
-- lectura (Auditoría) y de otras áreas: el personal, la 69-B, el precio y las
-- invitaciones y membresías que emite el personal los escribe solo Administración,
-- como en capacidades.ts. Nadie cambia su propio registro del personal, salvo
-- quien acepta su invitación (invitado → activo, con la invitación cerrada en esta
-- misma transacción). Sin usuario solo entra el alta que hace el sistema desde la
-- variable retirada: registro del personal e invitación nuevos.
CREATE FUNCTION personal_solo_administracion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'plataforma_sofipo' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  -- Los IF van anidados por tabla y operación: PL/pgSQL prepara cada campo de NEW
  -- y OLD que nombra una condición, aunque el AND no llegue a evaluarlo.
  IF TG_TABLE_NAME = 'platform_staff' AND TG_OP <> 'INSERT' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.operator_id IS DISTINCT FROM OLD.operator_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.alta_en IS DISTINCT FROM OLD.alta_en THEN
        RAISE EXCEPTION 'personal_no_se_reescribe';
      END IF;
    END IF;
    IF OLD.user_id = app_usuario() THEN
      IF TG_OP = 'UPDATE' THEN
        IF OLD.estado = 'invitado' AND NEW.estado = 'activo' AND EXISTS (
          SELECT 1 FROM invitations i
          WHERE i.operator_id = OLD.operator_id AND i.user_id = OLD.user_id AND i.company_id IS NULL
            AND i.usada_en IS NOT NULL AND i.xmin = pg_current_xact_id()::xid
        ) THEN
          RETURN NEW;
        END IF;
      END IF;
      RAISE EXCEPTION 'personal_propio';
    END IF;
  END IF;
  -- Quien acepta su invitación del personal la cierra él mismo.
  IF TG_TABLE_NAME = 'invitations' AND TG_OP = 'UPDATE' THEN
    IF OLD.user_id = app_usuario() AND OLD.company_id IS NULL AND OLD.usada_en IS NULL
      AND NEW.usada_en IS NOT NULL AND NEW.revocada_en IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  IF app_usuario() IS NULL THEN
    IF TG_OP = 'INSERT' AND TG_TABLE_NAME IN ('platform_staff', 'invitations') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'sin_rol_de_administracion';
  END IF;
  IF NOT personal_tiene_rol(app_operador(), app_usuario(), ARRAY['administracion_plataforma']) THEN
    RAISE EXCEPTION 'sin_rol_de_administracion';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER personal_solo_administracion
BEFORE INSERT OR UPDATE OR DELETE ON platform_staff
FOR EACH ROW EXECUTE FUNCTION personal_solo_administracion();
CREATE TRIGGER personal_solo_administracion
BEFORE INSERT ON lista_69b_snapshots
FOR EACH ROW EXECUTE FUNCTION personal_solo_administracion();
CREATE TRIGGER personal_solo_administracion
BEFORE INSERT ON lista_69b_rows
FOR EACH ROW EXECUTE FUNCTION personal_solo_administracion();
CREATE TRIGGER personal_solo_administracion
BEFORE INSERT OR UPDATE ON platform_pricing
FOR EACH ROW EXECUTE FUNCTION personal_solo_administracion();
CREATE TRIGGER personal_solo_administracion
BEFORE INSERT OR UPDATE ON invitations
FOR EACH ROW EXECUTE FUNCTION personal_solo_administracion();
CREATE TRIGGER personal_solo_administracion
BEFORE INSERT OR UPDATE OR DELETE ON memberships
FOR EACH ROW EXECUTE FUNCTION personal_solo_administracion();
CREATE TRIGGER personal_solo_administracion
BEFORE INSERT OR UPDATE OR DELETE ON membership_roles
FOR EACH ROW EXECUTE FUNCTION personal_solo_administracion();

-- Roles iniciales por comando (`scripts/plataforma.ts personal:rol`). Cuando
-- nadie más del personal administra al personal, la pantalla no alcanza: nadie
-- se da un rol a sí mismo. Esta puerta la ejecuta solo la dueña de la base (la
-- conexión directa de las migraciones), nunca la aplicación: no se otorga a
-- ningún rol. Deja el evento en la bitácora en la misma transacción, la 50ª
-- sigue valiendo (platform_staff_roles_revisar corre igual) y no deja al
-- personal sin administración.
CREATE FUNCTION personal_rol_por_comando(p_correo text, p_rol text, p_quitar boolean, p_motivo text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  persona platform_staff%ROWTYPE;
  cambiados integer;
BEGIN
  IF p_motivo IS NULL OR NOT texto_regulado(p_motivo, 500) OR char_length(p_motivo) < 10 THEN
    RAISE EXCEPTION 'motivo_invalido';
  END IF;
  IF p_quitar IS NULL OR p_rol IS NULL THEN
    RAISE EXCEPTION 'rol_invalido';
  END IF;
  IF (SELECT count(*) FROM platform_staff s JOIN users u ON u.id = s.user_id
      WHERE lower(u.correo) = lower(btrim(p_correo)) AND s.estado = 'activo') <> 1 THEN
    RAISE EXCEPTION 'persona_ausente';
  END IF;
  SELECT s.* INTO persona FROM platform_staff s JOIN users u ON u.id = s.user_id
  WHERE lower(u.correo) = lower(btrim(p_correo)) AND s.estado = 'activo';
  PERFORM pg_advisory_xact_lock(hashtextextended('platform_staff_roles:' || persona.operator_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM platform_staff s
    JOIN platform_staff_roles r ON r.operator_id = s.operator_id AND r.user_id = s.user_id
    WHERE s.operator_id = persona.operator_id AND s.user_id <> persona.user_id
      AND s.estado = 'activo' AND r.rol = 'administracion_plataforma'
  ) THEN
    RAISE EXCEPTION 'rol_por_pantalla';
  END IF;
  IF p_quitar AND p_rol = 'administracion_plataforma' THEN
    RAISE EXCEPTION 'personal_sin_administracion';
  END IF;
  IF p_quitar THEN
    DELETE FROM platform_staff_roles
    WHERE operator_id = persona.operator_id AND user_id = persona.user_id AND rol = p_rol;
  ELSE
    INSERT INTO platform_staff_roles (operator_id, user_id, rol)
    VALUES (persona.operator_id, persona.user_id, p_rol)
    ON CONFLICT ON CONSTRAINT platform_staff_roles_pkey DO NOTHING;
  END IF;
  GET DIAGNOSTICS cambiados = ROW_COUNT;
  IF cambiados = 0 THEN
    RETURN false;
  END IF;
  INSERT INTO audit_log (
    operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, motivo, origen, cambio
  ) VALUES (
    persona.operator_id, NULL, 'sistema', NULL, 'sistema',
    CASE WHEN p_quitar THEN 'rol_personal_retirado' ELSE 'rol_personal_asignado' END,
    'platform_staff_roles', persona.user_id, p_motivo, 'comando',
    -- Quién lo corrió lo dice la base, no el motivo escrito a mano.
    jsonb_build_object('rol', p_rol, 'ejecutado_por', session_user)
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION personal_rol_por_comando(text, text, boolean, text) FROM PUBLIC;

-- 2. Expediente de persona moral ----------------------------------------------

-- Cada envío es una versión nueva. El borrador se edita; la enviada no cambia.
CREATE TABLE kyb_versiones (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  numero integer NOT NULL,
  estado text NOT NULL DEFAULT 'borrador',
  -- 4ª fr. II a): datos de la persona moral.
  razon_social text,
  giro text,
  nacionalidad text,
  rfc text,
  serie_efirma text,
  domicilio_calle text,
  domicilio_exterior text,
  domicilio_interior text,
  domicilio_colonia text,
  domicilio_municipio text,
  domicilio_entidad text,
  domicilio_codigo_postal text,
  domicilio_pais text,
  telefono text,
  correo text,
  fecha_constitucion date,
  -- Perfil transaccional declarado: alimenta el grado de riesgo (23ª-1).
  volumen_mensual_centavos bigint,
  creada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL,
  enviada_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  enviada_en timestamptz,
  enviada_txid bigint,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT kyb_versiones_company
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT kyb_versiones_numero_unico UNIQUE (company_id, numero),
  CONSTRAINT kyb_versiones_id_company UNIQUE (id, company_id),
  CONSTRAINT kyb_versiones_numero CHECK (numero >= 1),
  CONSTRAINT kyb_versiones_estado CHECK (estado IN ('borrador', 'enviada')),
  CONSTRAINT kyb_versiones_textos CHECK (
    texto_regulado(razon_social, 300) AND texto_regulado(giro, 200) AND texto_regulado(nacionalidad, 80)
    AND texto_regulado(domicilio_calle, 200) AND texto_regulado(domicilio_exterior, 40)
    AND texto_regulado(domicilio_interior, 40) AND texto_regulado(domicilio_colonia, 120)
    AND texto_regulado(domicilio_municipio, 120) AND texto_regulado(domicilio_entidad, 80)
    AND texto_regulado(domicilio_pais, 80)
  ),
  CONSTRAINT kyb_versiones_rfc CHECK (rfc IS NULL OR rfc ~ '^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$'),
  -- Número de serie del certificado de e.firma: 20 dígitos.
  CONSTRAINT kyb_versiones_serie CHECK (serie_efirma IS NULL OR serie_efirma ~ '^[0-9]{20}$'),
  CONSTRAINT kyb_versiones_cp CHECK (domicilio_codigo_postal IS NULL OR domicilio_codigo_postal ~ '^[0-9]{5}$'),
  CONSTRAINT kyb_versiones_telefono CHECK (telefono IS NULL OR telefono ~ '^[0-9]{10,15}$'),
  CONSTRAINT kyb_versiones_correo CHECK (
    correo IS NULL OR (char_length(correo) <= 254 AND correo ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$')
  ),
  CONSTRAINT kyb_versiones_volumen CHECK (
    volumen_mensual_centavos IS NULL OR volumen_mensual_centavos BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT kyb_versiones_forma CHECK (
    (estado = 'borrador' AND enviada_por IS NULL AND enviada_en IS NULL AND enviada_txid IS NULL)
    OR (
      estado = 'enviada' AND enviada_por IS NOT NULL AND enviada_en IS NOT NULL AND enviada_txid IS NOT NULL
      AND razon_social IS NOT NULL AND giro IS NOT NULL AND nacionalidad IS NOT NULL AND rfc IS NOT NULL
      AND serie_efirma IS NOT NULL AND domicilio_calle IS NOT NULL AND domicilio_exterior IS NOT NULL
      AND domicilio_colonia IS NOT NULL AND domicilio_municipio IS NOT NULL AND domicilio_entidad IS NOT NULL
      AND domicilio_codigo_postal IS NOT NULL AND domicilio_pais IS NOT NULL AND telefono IS NOT NULL
      AND correo IS NOT NULL AND fecha_constitucion IS NOT NULL AND volumen_mensual_centavos IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX kyb_versiones_un_borrador ON kyb_versiones (company_id) WHERE estado = 'borrador';
CREATE INDEX kyb_versiones_operator_idx ON kyb_versiones (operator_id, company_id, numero);

COMMENT ON TABLE kyb_versiones IS
  'Expediente de identificación de la persona moral (4ª fr. II). Cada envío es una versión; la enviada no cambia.';

-- Documentos: el archivo vive en Blob privado; aquí su huella y su vigencia.
CREATE TABLE kyb_documentos (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  tipo text NOT NULL,
  representante_clave uuid,
  nombre_archivo text NOT NULL,
  tipo_contenido text NOT NULL,
  tamano_bytes integer NOT NULL,
  sha256 text NOT NULL,
  clave_blob text NOT NULL,
  emitido_el date,
  vigente_hasta date,
  detalle text,
  cargado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  cargado_en timestamptz NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT kyb_documentos_company
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT kyb_documentos_id_company UNIQUE (id, company_id),
  -- 4ª fr. II b) y c).
  CONSTRAINT kyb_documentos_tipo CHECK (tipo IN (
    'acta_constitutiva', 'poder', 'identificacion_representante', 'comprobante_domicilio',
    'constancia_situacion_fiscal', 'certificado_efirma', 'declaracion_propietarios', 'estructura_corporativa'
  )),
  CONSTRAINT kyb_documentos_representante CHECK (
    (tipo = 'identificacion_representante' AND representante_clave IS NOT NULL)
    OR (tipo = 'poder')
    OR (tipo NOT IN ('identificacion_representante', 'poder') AND representante_clave IS NULL)
  ),
  CONSTRAINT kyb_documentos_contenido CHECK (tipo_contenido IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT kyb_documentos_tamano CHECK (tamano_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT kyb_documentos_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT kyb_documentos_textos CHECK (
    texto_regulado(nombre_archivo, 200) AND texto_regulado(clave_blob, 512) AND texto_regulado(detalle, 300)
  ),
  -- 4ª fr. I b) iii, aplicable a la fr. II b): comprobante con antigüedad no mayor a tres meses.
  CONSTRAINT kyb_documentos_comprobante CHECK (
    tipo <> 'comprobante_domicilio'
    OR (emitido_el IS NOT NULL AND vigente_hasta = (emitido_el + interval '3 months')::date)
  ),
  -- 4ª fr. II b): identificación vigente de cada representante.
  CONSTRAINT kyb_documentos_identificacion CHECK (tipo <> 'identificacion_representante' OR vigente_hasta IS NOT NULL),
  -- Acta inscrita en el Registro Público de Comercio: se anota el folio o «en trámite».
  CONSTRAINT kyb_documentos_acta CHECK (tipo <> 'acta_constitutiva' OR detalle IS NOT NULL),
  CONSTRAINT kyb_documentos_vigencia CHECK (vigente_hasta IS NULL OR emitido_el IS NULL OR vigente_hasta >= emitido_el)
);

CREATE INDEX kyb_documentos_company_idx ON kyb_documentos (company_id, tipo, cargado_en);

COMMENT ON TABLE kyb_documentos IS
  'Documentos del expediente. Solo inserción. El archivo vive en Blob privado y nunca se borra (61ª).';
COMMENT ON COLUMN kyb_documentos.clave_blob IS
  'Ruta del archivo en Blob privado. El personal no la lee directo: la entrega kyb_documento_para_descarga, que deja el evento.';

CREATE TABLE kyb_version_documentos (
  version_id uuid NOT NULL,
  documento_id uuid NOT NULL,
  company_id uuid NOT NULL,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  vinculado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyb_version_documentos_pkey PRIMARY KEY (version_id, documento_id),
  CONSTRAINT kyb_version_documentos_version
    FOREIGN KEY (version_id, company_id) REFERENCES kyb_versiones (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT kyb_version_documentos_documento
    FOREIGN KEY (documento_id, company_id) REFERENCES kyb_documentos (id, company_id) ON DELETE RESTRICT
);

COMMENT ON TABLE kyb_version_documentos IS
  'Qué documentos integran cada versión. Una versión nueva hereda los de la anterior; vale el último de cada tipo.';

-- Administradores, consejeros y apoderados. La clave sigue a la persona entre versiones.
CREATE TABLE kyb_representantes (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL,
  company_id uuid NOT NULL,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  clave uuid NOT NULL,
  nombre text NOT NULL,
  rfc text,
  curp text,
  cargo text NOT NULL,
  es_administrador boolean NOT NULL,
  designado_por text,
  pep text NOT NULL DEFAULT 'no',
  creado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL,
  retirado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  retirado_en timestamptz,
  CONSTRAINT kyb_representantes_version
    FOREIGN KEY (version_id, company_id) REFERENCES kyb_versiones (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT kyb_representantes_clave UNIQUE (version_id, clave),
  CONSTRAINT kyb_representantes_cargo CHECK (cargo IN ('administrador_unico', 'consejero', 'director_general', 'apoderado')),
  CONSTRAINT kyb_representantes_pep CHECK (pep IN ('no', 'nacional', 'extranjera')),
  CONSTRAINT kyb_representantes_textos CHECK (
    nombre IS NOT NULL AND texto_regulado(nombre, 200) AND texto_regulado(designado_por, 300)
  ),
  CONSTRAINT kyb_representantes_rfc CHECK (rfc IS NULL OR rfc ~ '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT kyb_representantes_curp CHECK (curp IS NULL OR curp ~ '^[A-Z]{4}[0-9]{6}[HMX][A-Z]{5}[A-Z0-9][0-9]$'),
  CONSTRAINT kyb_representantes_retiro CHECK ((retirado_en IS NULL) = (retirado_por IS NULL))
);

COMMENT ON COLUMN kyb_representantes.pep IS
  'Persona políticamente expuesta DECLARADA por el cliente. Lever no consulta una lista de PEP.';
COMMENT ON COLUMN kyb_representantes.designado_por IS
  '4ª fr. II c): si el administrador es una persona moral, la razón social que designó a esta persona física.';

-- Estructura accionaria en cadena: padre_clave vacío es socio directo de la empresa.
CREATE TABLE kyb_accionistas (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL,
  company_id uuid NOT NULL,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  clave uuid NOT NULL,
  padre_clave uuid,
  tipo_persona text NOT NULL,
  nombre text NOT NULL,
  rfc text,
  curp text,
  nacionalidad text,
  capital_bp integer NOT NULL,
  votos_bp integer NOT NULL,
  control_otros_medios boolean NOT NULL DEFAULT false,
  pep text NOT NULL DEFAULT 'no',
  creado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL,
  retirado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  retirado_en timestamptz,
  CONSTRAINT kyb_accionistas_version
    FOREIGN KEY (version_id, company_id) REFERENCES kyb_versiones (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT kyb_accionistas_clave UNIQUE (version_id, clave),
  CONSTRAINT kyb_accionistas_tipo CHECK (tipo_persona IN ('fisica', 'moral')),
  CONSTRAINT kyb_accionistas_pep CHECK (pep IN ('no', 'nacional', 'extranjera')),
  CONSTRAINT kyb_accionistas_textos CHECK (texto_regulado(nombre, 300) AND texto_regulado(nacionalidad, 80)),
  CONSTRAINT kyb_accionistas_rfc CHECK (
    rfc IS NULL
    OR (tipo_persona = 'moral' AND rfc ~ '^[A-Z&Ñ]{3}[0-9]{6}[A-Z0-9]{3}$')
    OR (tipo_persona = 'fisica' AND rfc ~ '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$')
  ),
  CONSTRAINT kyb_accionistas_curp CHECK (
    curp IS NULL OR (tipo_persona = 'fisica' AND curp ~ '^[A-Z]{4}[0-9]{6}[HMX][A-Z]{5}[A-Z0-9][0-9]$')
  ),
  CONSTRAINT kyb_accionistas_moral CHECK (tipo_persona = 'fisica' OR (pep = 'no' AND NOT control_otros_medios)),
  -- Puntos base: 10000 = 100 %. Sin flotantes.
  CONSTRAINT kyb_accionistas_participacion CHECK (
    capital_bp BETWEEN 0 AND 10000 AND votos_bp BETWEEN 0 AND 10000
    AND (capital_bp > 0 OR votos_bp > 0 OR control_otros_medios)
  ),
  CONSTRAINT kyb_accionistas_retiro CHECK ((retirado_en IS NULL) = (retirado_por IS NULL))
);

CREATE INDEX kyb_accionistas_padre_idx ON kyb_accionistas (version_id, padre_clave);

COMMENT ON TABLE kyb_accionistas IS
  'Estructura accionaria (4ª fr. II c). Las personas morales se desglosan hasta llegar a personas físicas.';
COMMENT ON COLUMN kyb_accionistas.control_otros_medios IS
  '2ª fr. VII: la persona impone decisiones o dirige la administración de su padre (o de la empresa) por otros medios.';

-- Propietarios reales calculados al enviar. Solo los escribe el envío.
CREATE TABLE kyb_beneficiarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  company_id uuid NOT NULL,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  clave uuid NOT NULL,
  nombre text NOT NULL,
  rfc text,
  curp text,
  pep text NOT NULL,
  capital_pct numeric(7, 4) NOT NULL,
  votos_pct numeric(7, 4) NOT NULL,
  votos_controlados_pct numeric(7, 4) NOT NULL,
  motivo text NOT NULL,
  capas integer NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT kyb_beneficiarios_version
    FOREIGN KEY (version_id, company_id) REFERENCES kyb_versiones (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT kyb_beneficiarios_clave UNIQUE (version_id, clave),
  CONSTRAINT kyb_beneficiarios_motivo CHECK (motivo IN ('control', 'otros_medios', 'capital', 'votos', 'administrador'))
);

COMMENT ON TABLE kyb_beneficiarios IS
  'Propietarios reales (2ª fr. XXXIII y 4ª fr. II c): ≥ 25 % del capital o de los votos, directo o indirecto, '
  'o control; si no hay, los administradores.';

-- Dictamen de Cumplimiento sobre una versión enviada.
CREATE TABLE kyb_dictamenes (
  id uuid PRIMARY KEY,
  version_id uuid NOT NULL,
  company_id uuid NOT NULL,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  resultado text NOT NULL,
  motivo text,
  dictaminado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  dictaminado_en timestamptz NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT kyb_dictamenes_version
    FOREIGN KEY (version_id, company_id) REFERENCES kyb_versiones (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT kyb_dictamenes_una_por_version UNIQUE (version_id),
  CONSTRAINT kyb_dictamenes_resultado CHECK (resultado IN ('aprobado', 'observado', 'rechazado')),
  CONSTRAINT kyb_dictamenes_motivo CHECK (
    texto_regulado(motivo, 1000) AND (resultado = 'aprobado' OR motivo IS NOT NULL)
  )
);

COMMENT ON TABLE kyb_dictamenes IS
  '23ª: Cumplimiento verifica que el expediente esté completo. Aprobado, observado (con motivo) o rechazado (con motivo).';

-- Documentos vigentes de una versión: el último de cada tipo (y de cada representante).
CREATE FUNCTION kyb_documentos_de_version(p_version uuid)
RETURNS TABLE (documento_id uuid, tipo text, representante_clave uuid, vigente_hasta date, cargado_en timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT ON (d.tipo, d.representante_clave)
         d.id, d.tipo, d.representante_clave, d.vigente_hasta, d.cargado_en
  FROM kyb_version_documentos vd
  JOIN kyb_documentos d ON d.id = vd.documento_id
  WHERE vd.version_id = p_version
  ORDER BY d.tipo, d.representante_clave, d.cargado_en DESC, d.id DESC
$$;

-- La cadena está completa cuando los socios directos suman el 100 % y cada
-- persona moral se desglosa también al 100 %. Se exige la cadena entera para
-- no perder a quien suma participaciones por varios caminos (4ª fr. II c).
CREATE FUNCTION kyb_estructura_completa(p_version uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT sum(a.capital_bp) = 10000 AND sum(a.votos_bp) = 10000
    FROM kyb_accionistas a
    WHERE a.version_id = p_version AND a.retirado_en IS NULL AND a.padre_clave IS NULL
  ), false)
  AND NOT EXISTS (
    SELECT 1
    FROM kyb_accionistas m
    WHERE m.version_id = p_version AND m.retirado_en IS NULL AND m.tipo_persona = 'moral'
      AND coalesce((
        SELECT sum(h.capital_bp) = 10000 AND sum(h.votos_bp) = 10000
        FROM kyb_accionistas h
        WHERE h.version_id = p_version AND h.retirado_en IS NULL AND h.padre_clave = m.clave
      ), false) IS NOT TRUE
  )
$$;

-- Propietarios reales de una versión (borrador o enviada).
--   capital y votos efectivos: suma, por cada camino, del producto de las participaciones.
--   votos controlados: los votos que el primer eslabón tiene en la empresa, cuando
--     cada eslabón de abajo controla al de arriba (> 50 % de votos u otros medios).
--   Umbral: ≥ 25 % de capital o de votos, > 50 % de votos controlados, u otros medios
--   (2ª fr. VII y 4ª fr. II c). Sin nadie: los administradores.
CREATE FUNCTION kyb_calcular_beneficiarios(p_version uuid)
RETURNS TABLE (
  clave uuid, nombre text, rfc text, curp text, pep text,
  capital_pct numeric, votos_pct numeric, votos_controlados_pct numeric, motivo text, capas integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE cadena AS (
    SELECT a.clave, a.tipo_persona,
           a.capital_bp::numeric / 10000 AS capital,
           a.votos_bp::numeric / 10000 AS votos,
           a.votos_bp::numeric / 10000 AS votos_primera,
           a.control_otros_medios AS otros_primera,
           true AS controla_cadena,
           1 AS capa,
           ARRAY[a.clave] AS camino
    FROM kyb_accionistas a
    WHERE a.version_id = p_version AND a.retirado_en IS NULL AND a.padre_clave IS NULL
    UNION ALL
    SELECT h.clave, h.tipo_persona,
           c.capital * h.capital_bp / 10000,
           c.votos * h.votos_bp / 10000,
           c.votos_primera,
           c.otros_primera,
           c.controla_cadena AND (h.votos_bp > 5000 OR h.control_otros_medios),
           c.capa + 1,
           c.camino || h.clave
    FROM cadena c
    JOIN kyb_accionistas h
      ON h.version_id = p_version AND h.retirado_en IS NULL AND h.padre_clave = c.clave
    WHERE c.tipo_persona = 'moral' AND NOT h.clave = ANY (c.camino) AND c.capa < 10
  ),
  fisicas AS (
    -- La misma persona por varios caminos suma por su CURP (el envío la exige).
    SELECT coalesce(a.curp, a.clave::text) AS persona,
           (array_agg(a.clave ORDER BY a.clave::text))[1] AS clave,
           (array_agg(a.nombre ORDER BY a.clave::text))[1] AS nombre,
           max(a.rfc) AS rfc,
           max(a.curp) AS curp,
           CASE WHEN bool_or(a.pep = 'extranjera') THEN 'extranjera'
                WHEN bool_or(a.pep = 'nacional') THEN 'nacional'
                ELSE 'no' END AS pep,
           sum(c.capital) AS capital,
           sum(c.votos) AS votos,
           sum(CASE WHEN c.controla_cadena THEN c.votos_primera ELSE 0 END) AS votos_controlados,
           bool_or(c.controla_cadena AND c.otros_primera) AS otros,
           max(c.capa) AS capas
    FROM cadena c
    JOIN kyb_accionistas a ON a.version_id = p_version AND a.clave = c.clave
    WHERE c.tipo_persona = 'fisica'
    GROUP BY 1
  ),
  calificados AS (
    SELECT f.*,
           CASE
             WHEN f.votos_controlados > 0.5 THEN 'control'
             WHEN f.otros THEN 'otros_medios'
             WHEN f.capital >= 0.25 THEN 'capital'
             WHEN f.votos >= 0.25 THEN 'votos'
           END AS motivo
    FROM fisicas f
  )
  SELECT q.clave, q.nombre, q.rfc, q.curp, q.pep,
         round(q.capital * 100, 4), round(q.votos * 100, 4), round(least(q.votos_controlados, 1) * 100, 4),
         q.motivo, q.capas
  FROM calificados q
  WHERE q.motivo IS NOT NULL
  UNION ALL
  SELECT r.clave, r.nombre, r.rfc, r.curp, r.pep, 0::numeric, 0::numeric, 0::numeric, 'administrador', 0
  FROM kyb_representantes r
  WHERE r.version_id = p_version AND r.retirado_en IS NULL AND r.es_administrador
    AND NOT EXISTS (SELECT 1 FROM calificados q WHERE q.motivo IS NOT NULL)
$$;

COMMENT ON FUNCTION kyb_calcular_beneficiarios(uuid) IS
  'Propietarios reales: ≥ 25 % del capital o votos directo o indirecto, control o, en su defecto, los administradores.';

-- Lo que el envío exige. Cada falta tiene su código.
CREATE FUNCTION kyb_exigir_completo(p_version kyb_versiones)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  requerido text;
  vigente record;
  rep record;
BEGIN
  IF p_version.rfc IS DISTINCT FROM (SELECT c.rfc FROM companies c WHERE c.id = p_version.company_id) THEN
    RAISE EXCEPTION 'expediente_rfc_distinto';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM kyb_representantes r WHERE r.version_id = p_version.id AND r.retirado_en IS NULL
  ) THEN
    RAISE EXCEPTION 'expediente_sin_representante';
  END IF;
  -- 4ª fr. II a): nombre de los administradores.
  IF NOT EXISTS (
    SELECT 1 FROM kyb_representantes r
    WHERE r.version_id = p_version.id AND r.retirado_en IS NULL AND r.es_administrador
  ) THEN
    RAISE EXCEPTION 'expediente_sin_administrador';
  END IF;
  -- 4ª fr. II b): acta, cédula fiscal, constancia de e.firma, comprobante de domicilio;
  -- 4ª fr. II c): declaración escrita del representante sobre los propietarios reales.
  FOREACH requerido IN ARRAY ARRAY[
    'acta_constitutiva', 'constancia_situacion_fiscal', 'certificado_efirma',
    'comprobante_domicilio', 'declaracion_propietarios'
  ] LOOP
    SELECT * INTO vigente FROM kyb_documentos_de_version(p_version.id) d WHERE d.tipo = requerido;
    IF vigente.documento_id IS NULL THEN
      RAISE EXCEPTION 'expediente_falta_documento';
    END IF;
    IF vigente.vigente_hasta IS NOT NULL AND vigente.vigente_hasta < hoy_mexico() THEN
      RAISE EXCEPTION 'expediente_documento_vencido';
    END IF;
  END LOOP;
  -- 4ª fr. II b): identificación vigente de cada representante.
  FOR rep IN
    SELECT r.clave FROM kyb_representantes r WHERE r.version_id = p_version.id AND r.retirado_en IS NULL
  LOOP
    SELECT * INTO vigente FROM kyb_documentos_de_version(p_version.id) d
    WHERE d.tipo = 'identificacion_representante' AND d.representante_clave = rep.clave;
    IF vigente.documento_id IS NULL THEN
      RAISE EXCEPTION 'expediente_falta_documento';
    END IF;
    IF vigente.vigente_hasta < hoy_mexico() THEN
      RAISE EXCEPTION 'expediente_documento_vencido';
    END IF;
  END LOOP;
  -- 4ª fr. II c): una persona que suma por dos caminos con identificadores
  -- distintos se partiría en dos y quedaría bajo el umbral. Toda persona física
  -- lleva CURP y toda moral su RFC.
  IF EXISTS (
    SELECT 1 FROM kyb_accionistas a
    WHERE a.version_id = p_version.id AND a.retirado_en IS NULL AND a.tipo_persona = 'fisica' AND a.curp IS NULL
  ) THEN
    RAISE EXCEPTION 'expediente_accionista_sin_curp';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kyb_accionistas a
    WHERE a.version_id = p_version.id AND a.retirado_en IS NULL AND a.tipo_persona = 'moral' AND a.rfc IS NULL
  ) THEN
    RAISE EXCEPTION 'expediente_accionista_sin_rfc';
  END IF;
  -- El cálculo de propietarios y la herencia de versión llegan a la capa 10.
  -- Una cadena más larga dejaría fuera a quien está al final.
  IF EXISTS (
    WITH RECURSIVE arbol AS (
      SELECT a.clave, 1 AS capa
      FROM kyb_accionistas a
      WHERE a.version_id = p_version.id AND a.retirado_en IS NULL AND a.padre_clave IS NULL
      UNION ALL
      SELECT h.clave, arbol.capa + 1
      FROM arbol
      JOIN kyb_accionistas h ON h.version_id = p_version.id AND h.retirado_en IS NULL AND h.padre_clave = arbol.clave
      WHERE arbol.capa <= 10
    )
    SELECT 1 FROM arbol WHERE arbol.capa > 10
  ) THEN
    RAISE EXCEPTION 'expediente_estructura_muy_profunda';
  END IF;
  IF NOT kyb_estructura_completa(p_version.id) THEN
    RAISE EXCEPTION 'expediente_estructura_incompleta';
  END IF;
END;
$$;

-- ¿Algún documento vigente de la versión ya venció hoy?
CREATE FUNCTION kyb_documento_vencido(p_version uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM kyb_documentos_de_version(p_version) d
    WHERE d.vigente_hasta IS NOT NULL AND d.vigente_hasta < hoy_mexico()
      AND (
        d.representante_clave IS NULL
        OR EXISTS (
          SELECT 1 FROM kyb_representantes r
          WHERE r.version_id = p_version AND r.clave = d.representante_clave AND r.retirado_en IS NULL
        )
      )
  )
$$;

CREATE FUNCTION kyb_versiones_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ultimo integer;
  previa kyb_versiones%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'conservacion_no_se_borra';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('kyb:' || NEW.company_id::text, 0));
    -- Doble envío simultáneo: quien esperó el candado ya ve la versión del otro. Con el
    -- mismo formulario responde la llave primaria (la aplicación lo repite y sale como el
    -- primero); con otro, ya hay un borrador.
    IF EXISTS (SELECT 1 FROM kyb_versiones v WHERE v.id = NEW.id) THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM kyb_versiones v WHERE v.company_id = NEW.company_id AND v.estado = 'borrador') THEN
      RAISE EXCEPTION 'expediente_con_borrador';
    END IF;
    IF NEW.estado <> 'borrador' OR NEW.enviada_por IS NOT NULL THEN
      RAISE EXCEPTION 'expediente_nace_borrador';
    END IF;
    IF current_user = 'plataforma_sofipo' AND (
      NEW.creada_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.creada_por, ARRAY['originacion'])
    ) THEN
      RAISE EXCEPTION 'sin_rol_para_expediente';
    END IF;
    IF EXISTS (SELECT 1 FROM companies c WHERE c.id = NEW.company_id AND c.estado = 'baja') THEN
      RAISE EXCEPTION 'cliente_de_baja';
    END IF;
    SELECT max(v.numero) INTO ultimo FROM kyb_versiones v WHERE v.company_id = NEW.company_id;
    IF NEW.numero <> coalesce(ultimo, 0) + 1 THEN
      RAISE EXCEPTION 'expediente_numero_invalido';
    END IF;
    IF ultimo IS NOT NULL THEN
      SELECT * INTO previa FROM kyb_versiones v WHERE v.company_id = NEW.company_id AND v.numero = ultimo;
      -- Una versión enviada espera su dictamen antes de abrir otra.
      IF NOT EXISTS (SELECT 1 FROM kyb_dictamenes d WHERE d.version_id = previa.id) THEN
        RAISE EXCEPTION 'expediente_en_revision';
      END IF;
      -- La versión nueva parte de los datos de la anterior.
      NEW.razon_social := coalesce(NEW.razon_social, previa.razon_social);
      NEW.giro := coalesce(NEW.giro, previa.giro);
      NEW.nacionalidad := coalesce(NEW.nacionalidad, previa.nacionalidad);
      NEW.rfc := coalesce(NEW.rfc, previa.rfc);
      NEW.serie_efirma := coalesce(NEW.serie_efirma, previa.serie_efirma);
      NEW.domicilio_calle := coalesce(NEW.domicilio_calle, previa.domicilio_calle);
      NEW.domicilio_exterior := coalesce(NEW.domicilio_exterior, previa.domicilio_exterior);
      NEW.domicilio_interior := coalesce(NEW.domicilio_interior, previa.domicilio_interior);
      NEW.domicilio_colonia := coalesce(NEW.domicilio_colonia, previa.domicilio_colonia);
      NEW.domicilio_municipio := coalesce(NEW.domicilio_municipio, previa.domicilio_municipio);
      NEW.domicilio_entidad := coalesce(NEW.domicilio_entidad, previa.domicilio_entidad);
      NEW.domicilio_codigo_postal := coalesce(NEW.domicilio_codigo_postal, previa.domicilio_codigo_postal);
      NEW.domicilio_pais := coalesce(NEW.domicilio_pais, previa.domicilio_pais);
      NEW.telefono := coalesce(NEW.telefono, previa.telefono);
      NEW.correo := coalesce(NEW.correo, previa.correo);
      NEW.fecha_constitucion := coalesce(NEW.fecha_constitucion, previa.fecha_constitucion);
      NEW.volumen_mensual_centavos := coalesce(NEW.volumen_mensual_centavos, previa.volumen_mensual_centavos);
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.estado = 'enviada' THEN
    RAISE EXCEPTION 'expediente_enviado_inmutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.numero IS DISTINCT FROM OLD.numero
    OR NEW.creada_por IS DISTINCT FROM OLD.creada_por OR NEW.creada_en IS DISTINCT FROM OLD.creada_en
    OR NEW.txid IS DISTINCT FROM OLD.txid THEN
    RAISE EXCEPTION 'expediente_no_se_reescribe';
  END IF;
  IF current_user = 'plataforma_sofipo'
    AND NOT personal_tiene_rol(NEW.operator_id, app_usuario(), ARRAY['originacion']) THEN
    RAISE EXCEPTION 'sin_rol_para_expediente';
  END IF;
  IF NEW.estado = 'enviada' THEN
    IF current_user = 'plataforma_sofipo' AND NEW.enviada_por IS DISTINCT FROM app_usuario() THEN
      RAISE EXCEPTION 'sin_rol_para_expediente';
    END IF;
    NEW.enviada_txid := txid_current();
    PERFORM kyb_exigir_completo(NEW);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kyb_versiones_revisar
BEFORE INSERT OR UPDATE OR DELETE ON kyb_versiones
FOR EACH ROW EXECUTE FUNCTION kyb_versiones_revisar();
CREATE TRIGGER kyb_versiones_no_truncate
BEFORE TRUNCATE ON kyb_versiones
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

CREATE FUNCTION kyb_documentos_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'documento_expediente_inmutable';
  END IF;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.cargado_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.cargado_por, ARRAY['originacion']) THEN
      RAISE EXCEPTION 'sin_rol_para_expediente';
    END IF;
    IF NEW.emitido_el IS NOT NULL AND NEW.emitido_el > hoy_mexico() THEN
      RAISE EXCEPTION 'documento_fecha_futura';
    END IF;
  END IF;
  IF NEW.representante_clave IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM kyb_representantes r
    JOIN kyb_versiones v ON v.id = r.version_id
    WHERE v.company_id = NEW.company_id AND r.clave = NEW.representante_clave
  ) THEN
    RAISE EXCEPTION 'documento_sin_representante';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kyb_documentos_revisar
BEFORE INSERT OR UPDATE OR DELETE ON kyb_documentos
FOR EACH ROW EXECUTE FUNCTION kyb_documentos_revisar();
CREATE TRIGGER kyb_documentos_no_truncate
BEFORE TRUNCATE ON kyb_documentos
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

-- Vincular documentos, representantes o accionistas solo a un borrador.
CREATE FUNCTION kyb_solo_en_borrador()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  estado_version text;
  padre kyb_accionistas%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'conservacion_no_se_borra';
  END IF;
  SELECT v.estado INTO estado_version FROM kyb_versiones v WHERE v.id = NEW.version_id;
  IF estado_version IS DISTINCT FROM 'borrador' THEN
    RAISE EXCEPTION 'expediente_enviado_inmutable';
  END IF;

  IF TG_TABLE_NAME = 'kyb_version_documentos' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'expediente_no_se_reescribe';
    END IF;
    RETURN NEW;
  END IF;

  -- Representantes y accionistas: se agregan o se retiran; no se reescriben.
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - 'retirado_en' - 'retirado_por' IS DISTINCT FROM to_jsonb(OLD) - 'retirado_en' - 'retirado_por'
      OR OLD.retirado_en IS NOT NULL OR NEW.retirado_en IS NULL THEN
      RAISE EXCEPTION 'expediente_no_se_reescribe';
    END IF;
    IF current_user = 'plataforma_sofipo' AND (
      NEW.retirado_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(NEW.operator_id, app_usuario(), ARRAY['originacion'])
    ) THEN
      RAISE EXCEPTION 'sin_rol_para_expediente';
    END IF;
    IF TG_TABLE_NAME = 'kyb_accionistas' AND EXISTS (
      SELECT 1 FROM kyb_accionistas h
      WHERE h.version_id = NEW.version_id AND h.padre_clave = NEW.clave AND h.retirado_en IS NULL
    ) THEN
      RAISE EXCEPTION 'accionista_con_desglose';
    END IF;
    RETURN NEW;
  END IF;

  IF current_user = 'plataforma_sofipo' AND (
    NEW.creado_por IS DISTINCT FROM app_usuario()
    OR NOT personal_tiene_rol(NEW.operator_id, app_usuario(), ARRAY['originacion'])
  ) THEN
    RAISE EXCEPTION 'sin_rol_para_expediente';
  END IF;
  -- PL/pgSQL resuelve NEW.campo aunque la condición previa sea falsa: el padre se lee del JSON de la fila.
  IF TG_TABLE_NAME = 'kyb_accionistas' AND to_jsonb(NEW) ->> 'padre_clave' IS NOT NULL THEN
    SELECT * INTO padre FROM kyb_accionistas a
    WHERE a.version_id = NEW.version_id AND a.clave = (to_jsonb(NEW) ->> 'padre_clave')::uuid AND a.retirado_en IS NULL;
    IF padre.id IS NULL OR padre.tipo_persona <> 'moral' THEN
      RAISE EXCEPTION 'accionista_padre_invalido';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kyb_version_documentos_revisar
BEFORE INSERT OR UPDATE OR DELETE ON kyb_version_documentos
FOR EACH ROW EXECUTE FUNCTION kyb_solo_en_borrador();
CREATE TRIGGER kyb_representantes_revisar
BEFORE INSERT OR UPDATE OR DELETE ON kyb_representantes
FOR EACH ROW EXECUTE FUNCTION kyb_solo_en_borrador();
CREATE TRIGGER kyb_accionistas_revisar
BEFORE INSERT OR UPDATE OR DELETE ON kyb_accionistas
FOR EACH ROW EXECUTE FUNCTION kyb_solo_en_borrador();
CREATE TRIGGER kyb_version_documentos_no_truncate
BEFORE TRUNCATE ON kyb_version_documentos
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();
CREATE TRIGGER kyb_representantes_no_truncate
BEFORE TRUNCATE ON kyb_representantes
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();
CREATE TRIGGER kyb_accionistas_no_truncate
BEFORE TRUNCATE ON kyb_accionistas
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

-- Una versión nueva hereda representantes, accionistas y documentos de la anterior.
CREATE FUNCTION kyb_versiones_heredar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previa uuid;
BEGIN
  IF NEW.numero = 1 THEN
    RETURN NULL;
  END IF;
  SELECT v.id INTO previa FROM kyb_versiones v WHERE v.company_id = NEW.company_id AND v.numero = NEW.numero - 1;
  INSERT INTO kyb_representantes (
    id, version_id, company_id, operator_id, clave, nombre, rfc, curp, cargo, es_administrador,
    designado_por, pep, creado_por, creado_en
  )
  SELECT gen_random_uuid(), NEW.id, r.company_id, r.operator_id, r.clave, r.nombre, r.rfc, r.curp, r.cargo,
         r.es_administrador, r.designado_por, r.pep, NEW.creada_por, NEW.creada_en
  FROM kyb_representantes r
  WHERE r.version_id = previa AND r.retirado_en IS NULL;
  -- Padres antes que hijos: el trigger exige que el padre exista.
  INSERT INTO kyb_accionistas (
    id, version_id, company_id, operator_id, clave, padre_clave, tipo_persona, nombre, rfc, curp,
    nacionalidad, capital_bp, votos_bp, control_otros_medios, pep, creado_por, creado_en
  )
  WITH RECURSIVE arbol AS (
    SELECT a.*, 1 AS nivel FROM kyb_accionistas a
    WHERE a.version_id = previa AND a.retirado_en IS NULL AND a.padre_clave IS NULL
    UNION ALL
    SELECT h.*, arbol.nivel + 1 FROM kyb_accionistas h
    JOIN arbol ON h.version_id = previa AND h.retirado_en IS NULL AND h.padre_clave = arbol.clave
    WHERE arbol.nivel < 10
  )
  SELECT gen_random_uuid(), NEW.id, x.company_id, x.operator_id, x.clave, x.padre_clave, x.tipo_persona,
         x.nombre, x.rfc, x.curp, x.nacionalidad, x.capital_bp, x.votos_bp, x.control_otros_medios, x.pep,
         NEW.creada_por, NEW.creada_en
  FROM arbol x
  ORDER BY x.nivel;
  INSERT INTO kyb_version_documentos (version_id, documento_id, company_id, operator_id)
  SELECT NEW.id, vd.documento_id, vd.company_id, vd.operator_id
  FROM kyb_version_documentos vd
  WHERE vd.version_id = previa;
  RETURN NULL;
END;
$$;

CREATE TRIGGER kyb_versiones_heredar
AFTER INSERT ON kyb_versiones
FOR EACH ROW EXECUTE FUNCTION kyb_versiones_heredar();

CREATE FUNCTION kyb_beneficiarios_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'expediente_no_se_reescribe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM kyb_versiones v
    WHERE v.id = NEW.version_id AND v.estado = 'enviada' AND v.enviada_txid = txid_current()
  ) THEN
    RAISE EXCEPTION 'beneficiarios_solo_al_enviar';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kyb_beneficiarios_revisar
BEFORE INSERT OR UPDATE OR DELETE ON kyb_beneficiarios
FOR EACH ROW EXECUTE FUNCTION kyb_beneficiarios_revisar();
CREATE TRIGGER kyb_beneficiarios_no_truncate
BEFORE TRUNCATE ON kyb_beneficiarios
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

CREATE FUNCTION kyb_dictamenes_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  version kyb_versiones%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'dictamen_inmutable';
  END IF;
  SELECT * INTO version FROM kyb_versiones v WHERE v.id = NEW.version_id;
  IF version.estado IS DISTINCT FROM 'enviada' THEN
    RAISE EXCEPTION 'dictamen_sobre_borrador';
  END IF;
  -- Quien envía no dictamina su propio expediente.
  IF NEW.dictaminado_por = version.enviada_por THEN
    RAISE EXCEPTION 'misma_persona_en_dictamen';
  END IF;
  IF current_user = 'plataforma_sofipo' AND (
    NEW.dictaminado_por IS DISTINCT FROM app_usuario()
    OR NOT personal_tiene_rol(NEW.operator_id, NEW.dictaminado_por, ARRAY['cumplimiento'])
  ) THEN
    RAISE EXCEPTION 'sin_rol_para_dictaminar';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kyb_dictamenes_revisar
BEFORE INSERT OR UPDATE OR DELETE ON kyb_dictamenes
FOR EACH ROW EXECUTE FUNCTION kyb_dictamenes_revisar();
CREATE TRIGGER kyb_dictamenes_no_truncate
BEFORE TRUNCATE ON kyb_dictamenes
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

-- 3. Grado de riesgo -----------------------------------------------------------

CREATE TABLE kyb_calificaciones_riesgo (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  version_id uuid NOT NULL,
  tipo text NOT NULL,
  factores jsonb NOT NULL,
  puntaje integer NOT NULL,
  grado text NOT NULL,
  pep_extranjera boolean NOT NULL,
  coincidencia_exacta boolean NOT NULL,
  calificada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  calificada_el date NOT NULL,
  calificada_en timestamptz NOT NULL,
  revisar_antes_de date NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT kyb_calificaciones_riesgo_version
    FOREIGN KEY (version_id, company_id) REFERENCES kyb_versiones (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT kyb_calificaciones_riesgo_tipo CHECK (tipo IN ('alta', 'periodica')),
  CONSTRAINT kyb_calificaciones_riesgo_factores CHECK (jsonb_typeof(factores) = 'object'),
  CONSTRAINT kyb_calificaciones_riesgo_puntaje CHECK (puntaje BETWEEN 0 AND 100),
  -- 27ª: al menos tres grados para personas morales.
  CONSTRAINT kyb_calificaciones_riesgo_grado CHECK (grado IN ('bajo', 'medio', 'alto')),
  -- 27ª: al menos dos evaluaciones por año calendario.
  CONSTRAINT kyb_calificaciones_riesgo_revision CHECK (revisar_antes_de = (calificada_el + interval '6 months')::date),
  -- 30ª: PEP extranjera, grado alto como mínimo.
  CONSTRAINT kyb_calificaciones_riesgo_pep CHECK (NOT pep_extranjera OR grado = 'alto'),
  CONSTRAINT kyb_calificaciones_riesgo_lpb CHECK (NOT coincidencia_exacta OR grado = 'alto'),
  -- Misma tabla de cortes que src/dominio/operacion/riesgo.ts: ≤ 3 bajo, 4-7 medio, ≥ 8 alto.
  CONSTRAINT kyb_calificaciones_riesgo_corte CHECK (
    grado = CASE WHEN puntaje >= 8 THEN 'alto' WHEN puntaje >= 4 THEN 'medio' ELSE 'bajo' END
    OR (grado = 'alto' AND (pep_extranjera OR coincidencia_exacta))
  )
);

CREATE INDEX kyb_calificaciones_riesgo_company_idx ON kyb_calificaciones_riesgo (company_id, calificada_en DESC);
CREATE INDEX kyb_calificaciones_riesgo_revision_idx ON kyb_calificaciones_riesgo (operator_id, revisar_antes_de);

COMMENT ON TABLE kyb_calificaciones_riesgo IS
  'Grado de riesgo al alta y periódico (23ª-1, 27ª). Solo inserción. La revisión vencida se calcula al leer.';

CREATE FUNCTION kyb_calificaciones_riesgo_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  vigente uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'calificacion_inmutable';
  END IF;
  SELECT v.id INTO vigente FROM kyb_versiones v
  WHERE v.company_id = NEW.company_id AND v.estado = 'enviada'
  ORDER BY v.numero DESC LIMIT 1;
  IF vigente IS NULL OR vigente <> NEW.version_id THEN
    RAISE EXCEPTION 'calificacion_sobre_version_vieja';
  END IF;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.calificada_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.calificada_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_calificar';
    END IF;
    IF NEW.calificada_el <> hoy_mexico() THEN
      RAISE EXCEPTION 'calificacion_fecha_invalida';
    END IF;
  END IF;
  -- La base no confía en la aplicación para lo que obliga a grado alto.
  NEW.pep_extranjera := EXISTS (
    SELECT 1 FROM kyb_representantes r WHERE r.version_id = NEW.version_id AND r.retirado_en IS NULL AND r.pep = 'extranjera'
  ) OR EXISTS (
    SELECT 1 FROM kyb_accionistas a WHERE a.version_id = NEW.version_id AND a.retirado_en IS NULL AND a.pep = 'extranjera'
  ) OR EXISTS (
    SELECT 1 FROM kyb_beneficiarios b WHERE b.version_id = NEW.version_id AND b.pep = 'extranjera'
  );
  NEW.coincidencia_exacta := EXISTS (
    SELECT 1 FROM lpb_coincidencias c
    WHERE c.company_id = NEW.company_id AND c.sujeto_tipo <> 'contraparte'
      AND c.estado IN ('pendiente', 'confirmada') AND (c.tipo = 'exacta' OR c.estado = 'confirmada')
  );
  IF (NEW.pep_extranjera OR NEW.coincidencia_exacta) AND NEW.grado <> 'alto' THEN
    RAISE EXCEPTION 'riesgo_debe_ser_alto';
  END IF;
  NEW.tipo := CASE WHEN EXISTS (
    SELECT 1 FROM kyb_calificaciones_riesgo k WHERE k.company_id = NEW.company_id
  ) THEN 'periodica' ELSE 'alta' END;
  RETURN NEW;
END;
$$;

-- 4. Lista de Personas Bloqueadas ---------------------------------------------

-- 74ª y 75ª: la lista la notifica la UIF a la entidad. Cada carga es la lista
-- completa en vigor a esa fecha; la vigente es la última.
CREATE TABLE lpb_cargas (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  nombre_archivo text NOT NULL,
  sha256 text NOT NULL,
  filas integer NOT NULL,
  cargada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  cargada_en timestamptz NOT NULL,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT lpb_cargas_id_operador UNIQUE (id, operator_id),
  CONSTRAINT lpb_cargas_archivo_unico UNIQUE (operator_id, sha256),
  CONSTRAINT lpb_cargas_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT lpb_cargas_filas CHECK (filas BETWEEN 1 AND 50000),
  CONSTRAINT lpb_cargas_nombre CHECK (texto_regulado(nombre_archivo, 200))
);

CREATE INDEX lpb_cargas_operador_idx ON lpb_cargas (operator_id, cargada_en DESC);

CREATE TABLE lpb_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carga_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  nombre text NOT NULL,
  nombre_normalizado text GENERATED ALWAYS AS (lpb_normalizar(nombre)) STORED,
  rfc text,
  curp text,
  tipo text NOT NULL,
  fecha_publicacion date,
  CONSTRAINT lpb_personas_carga
    FOREIGN KEY (carga_id, operator_id) REFERENCES lpb_cargas (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT lpb_personas_nombre CHECK (texto_regulado(nombre, 300)),
  CONSTRAINT lpb_personas_tipo CHECK (tipo IN ('fisica', 'moral')),
  CONSTRAINT lpb_personas_rfc CHECK (rfc IS NULL OR rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT lpb_personas_curp CHECK (curp IS NULL OR curp ~ '^[A-Z]{4}[0-9]{6}[HMX][A-Z]{5}[A-Z0-9][0-9]$')
);

CREATE INDEX lpb_personas_rfc_idx ON lpb_personas (carga_id, rfc) WHERE rfc IS NOT NULL;
CREATE INDEX lpb_personas_curp_idx ON lpb_personas (carga_id, curp) WHERE curp IS NOT NULL;
CREATE INDEX lpb_personas_nombre_idx ON lpb_personas (carga_id, nombre_normalizado);

COMMENT ON TABLE lpb_personas IS
  'Renglones de una carga: nombre, RFC, CURP, tipo y fecha. Solo inserción.';

CREATE FUNCTION lpb_carga_vigente(p_operador uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id FROM lpb_cargas c
  WHERE c.operator_id = p_operador AND operador_del_contexto(p_operador)
  ORDER BY c.cargada_en DESC, c.id DESC LIMIT 1
$$;

CREATE TABLE lpb_coincidencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  sujeto_tipo text NOT NULL,
  sujeto_clave uuid NOT NULL,
  sujeto_nombre text NOT NULL,
  sujeto_rfc text,
  sujeto_curp text,
  lista text NOT NULL,
  carga_id uuid REFERENCES lpb_cargas (id) ON DELETE RESTRICT,
  lpb_persona_id uuid REFERENCES lpb_personas (id) ON DELETE RESTRICT,
  snapshot_69b_id uuid REFERENCES lista_69b_snapshots (id) ON DELETE RESTRICT,
  tipo text NOT NULL,
  coincide_por text NOT NULL,
  valor_coincidente text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  detectada_en timestamptz NOT NULL,
  plazo_reporte_hasta timestamptz,
  resuelta_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  resuelta_en timestamptz,
  motivo_resolucion text,
  reporte_folio text,
  reporte_presentado_el date,
  aviso_cliente_el date,
  reporte_registrado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  reporte_registrado_en timestamptz,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT lpb_coincidencias_company
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT lpb_coincidencias_sujeto CHECK (
    sujeto_tipo IN ('empresa', 'representante', 'accionista', 'beneficiario', 'contraparte')
  ),
  CONSTRAINT lpb_coincidencias_lista CHECK (
    (lista = 'lpb' AND carga_id IS NOT NULL AND lpb_persona_id IS NOT NULL AND snapshot_69b_id IS NULL)
    OR (lista = '69b' AND snapshot_69b_id IS NOT NULL AND carga_id IS NULL AND lpb_persona_id IS NULL AND coincide_por = 'rfc')
  ),
  -- RFC o CURP exacto es coincidencia; el nombre solo es «posible coincidencia».
  CONSTRAINT lpb_coincidencias_tipo CHECK (
    (tipo = 'exacta' AND coincide_por IN ('rfc', 'curp')) OR (tipo = 'posible' AND coincide_por = 'nombre')
  ),
  CONSTRAINT lpb_coincidencias_estado CHECK (estado IN ('pendiente', 'confirmada', 'falso_positivo', 'fuera_de_lista')),
  -- 75ª fr. II: reporte dentro de 24 horas desde la coincidencia (o desde que se confirma la posible).
  CONSTRAINT lpb_coincidencias_plazo CHECK (
    (tipo = 'exacta' AND plazo_reporte_hasta = detectada_en + interval '24 hours')
    OR (tipo = 'posible' AND estado = 'confirmada' AND plazo_reporte_hasta = resuelta_en + interval '24 hours')
    OR (tipo = 'posible' AND estado <> 'confirmada' AND plazo_reporte_hasta IS NULL)
  ),
  CONSTRAINT lpb_coincidencias_resolucion CHECK (
    (estado = 'pendiente' AND resuelta_por IS NULL AND resuelta_en IS NULL AND motivo_resolucion IS NULL)
    OR (estado <> 'pendiente' AND resuelta_por IS NOT NULL AND resuelta_en IS NOT NULL AND motivo_resolucion IS NOT NULL)
  ),
  CONSTRAINT lpb_coincidencias_textos CHECK (
    texto_regulado(sujeto_nombre, 300) AND texto_regulado(motivo_resolucion, 1000) AND texto_regulado(reporte_folio, 80)
  ),
  CONSTRAINT lpb_coincidencias_reporte CHECK (
    (reporte_folio IS NULL AND reporte_presentado_el IS NULL AND reporte_registrado_por IS NULL AND reporte_registrado_en IS NULL)
    OR (reporte_folio IS NOT NULL AND reporte_presentado_el IS NOT NULL AND reporte_registrado_por IS NOT NULL
      AND reporte_registrado_en IS NOT NULL AND estado IN ('confirmada', 'fuera_de_lista'))
  ),
  CONSTRAINT lpb_coincidencias_aviso CHECK (aviso_cliente_el IS NULL OR reporte_folio IS NOT NULL)
);

-- Un solo caso abierto por sujeto, lista y valor. Uno cerrado no impide otro:
-- quien vuelve a aparecer en una carga nueva reabre su caso (lpb_cotejar_empresa).
CREATE UNIQUE INDEX lpb_coincidencias_abierta_unica
  ON lpb_coincidencias (company_id, sujeto_tipo, sujeto_clave, lista, coincide_por, valor_coincidente)
  WHERE estado IN ('pendiente', 'confirmada');
CREATE INDEX lpb_coincidencias_sujeto_idx
  ON lpb_coincidencias (company_id, sujeto_tipo, sujeto_clave, lista, coincide_por, valor_coincidente);
CREATE INDEX lpb_coincidencias_company_idx ON lpb_coincidencias (company_id, estado);
CREATE INDEX lpb_coincidencias_operador_idx ON lpb_coincidencias (operator_id, estado, detectada_en);

COMMENT ON TABLE lpb_coincidencias IS
  'Coincidencias con la Lista de Personas Bloqueadas o con los definitivos del 69-B (74ª fr. VII). '
  'Una posible coincidencia nunca se descarta sola: la resuelve Cumplimiento con motivo. Lever no transmite a la UIF.';
COMMENT ON COLUMN lpb_coincidencias.reporte_folio IS
  'Folio del reporte de Operación Inusual que Cumplimiento presentó por su vía (75ª fr. II). Lever no lo transmite.';
COMMENT ON COLUMN lpb_coincidencias.aviso_cliente_el IS
  '75ª-76ª: fecha del aviso por escrito al cliente con los 10 días hábiles para acudir a la autoridad.';

-- Coincidencias de la lista que siguen abiertas (pendientes o confirmadas).
CREATE FUNCTION lpb_coincidencias_abiertas(p_company uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM lpb_coincidencias c
    WHERE c.company_id = p_company AND c.sujeto_tipo <> 'contraparte' AND c.estado IN ('pendiente', 'confirmada')
      -- El personal solo pregunta por empresas de su operador; sin contexto, por ninguna.
      AND operador_del_contexto(c.operator_id)
  )
$$;

CREATE FUNCTION lpb_personas_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'lista_inmutable';
  END IF;
  -- Los renglones entran en la misma transacción que su carga.
  IF NOT EXISTS (SELECT 1 FROM lpb_cargas c WHERE c.id = NEW.carga_id AND c.txid = txid_current()) THEN
    RAISE EXCEPTION 'lista_inmutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lpb_personas_revisar
BEFORE INSERT OR UPDATE OR DELETE ON lpb_personas
FOR EACH ROW EXECUTE FUNCTION lpb_personas_revisar();
CREATE TRIGGER lpb_personas_no_truncate
BEFORE TRUNCATE ON lpb_personas
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

CREATE FUNCTION lpb_cargas_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'lista_inmutable';
  END IF;
  IF current_user = 'plataforma_sofipo' AND (
    NEW.cargada_por IS DISTINCT FROM app_usuario()
    OR NOT personal_tiene_rol(NEW.operator_id, NEW.cargada_por, ARRAY['cumplimiento'])
  ) THEN
    RAISE EXCEPTION 'sin_rol_para_lpb';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lpb_cargas_revisar
BEFORE INSERT OR UPDATE OR DELETE ON lpb_cargas
FOR EACH ROW EXECUTE FUNCTION lpb_cargas_revisar();
CREATE TRIGGER lpb_cargas_no_truncate
BEFORE TRUNCATE ON lpb_cargas
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

-- 5. Suspensión y reactivación -------------------------------------------------

CREATE TABLE company_suspensions (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  tipo text NOT NULL,
  origen text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  motivo text NOT NULL,
  solicitada_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  solicitada_en timestamptz NOT NULL,
  decidida_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  decidida_en timestamptz,
  motivo_decision text,
  coincidencia_id uuid REFERENCES lpb_coincidencias (id) ON DELETE RESTRICT,
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT company_suspensions_company
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT company_suspensions_tipo CHECK (tipo IN ('suspension', 'reactivacion')),
  CONSTRAINT company_suspensions_origen CHECK (origen IN ('manual', 'lpb')),
  CONSTRAINT company_suspensions_estado CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  CONSTRAINT company_suspensions_textos CHECK (texto_regulado(motivo, 500) AND texto_regulado(motivo_decision, 500)),
  -- 75ª fr. I: la coincidencia suspende de inmediato, sin firma.
  CONSTRAINT company_suspensions_lpb CHECK (
    origen = 'manual'
    OR (tipo = 'suspension' AND estado = 'aprobada' AND solicitada_por IS NULL AND decidida_por IS NULL
      AND decidida_en IS NULL AND coincidencia_id IS NOT NULL)
  ),
  CONSTRAINT company_suspensions_manual CHECK (
    origen = 'lpb'
    OR (
      solicitada_por IS NOT NULL AND coincidencia_id IS NULL
      AND (estado = 'pendiente') = (decidida_por IS NULL AND decidida_en IS NULL)
    )
  ),
  -- Doble firma: quien pide no decide.
  CONSTRAINT company_suspensions_otra_persona CHECK (decidida_por IS NULL OR decidida_por <> solicitada_por),
  CONSTRAINT company_suspensions_rechazo CHECK (estado <> 'rechazada' OR motivo_decision IS NOT NULL)
);

CREATE UNIQUE INDEX company_suspensions_una_pendiente ON company_suspensions (company_id) WHERE estado = 'pendiente';
CREATE INDEX company_suspensions_operador_idx ON company_suspensions (operator_id, estado, solicitada_en);

COMMENT ON TABLE company_suspensions IS
  'Suspensiones y reactivaciones. Manual: una persona pide y otra con rol de aprobación decide. '
  'Por la lista: inmediata y del sistema (75ª fr. I).';

CREATE FUNCTION company_suspensions_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  estado_empresa text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'conservacion_no_se_borra';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('estado_empresa:' || NEW.company_id::text, 0));
    IF NEW.origen = 'lpb' THEN
      IF current_user IN ('plataforma_sofipo', 'plataforma_cliente') THEN
        RAISE EXCEPTION 'suspension_lpb_solo_sistema';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.estado <> 'pendiente' THEN
      RAISE EXCEPTION 'suspension_nace_pendiente';
    END IF;
    IF current_user = 'plataforma_sofipo' AND (
      NEW.solicitada_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.solicitada_por, ARRAY['originacion', 'cumplimiento'])
    ) THEN
      RAISE EXCEPTION 'sin_rol_para_suspender';
    END IF;
    SELECT c.estado INTO estado_empresa FROM companies c WHERE c.id = NEW.company_id;
    IF NEW.tipo = 'suspension' AND estado_empresa <> 'activa' THEN
      RAISE EXCEPTION 'suspension_no_aplica';
    END IF;
    IF NEW.tipo = 'reactivacion' THEN
      IF estado_empresa <> 'suspendida' THEN
        RAISE EXCEPTION 'reactivacion_no_aplica';
      END IF;
      -- 77ª: se reanuda cuando la persona sale de la lista o se dictamina falso positivo.
      IF lpb_coincidencias_abiertas(NEW.company_id) THEN
        RAISE EXCEPTION 'reactivacion_con_coincidencia_lpb';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.tipo IS DISTINCT FROM OLD.tipo
    OR NEW.origen IS DISTINCT FROM OLD.origen OR NEW.motivo IS DISTINCT FROM OLD.motivo
    OR NEW.solicitada_por IS DISTINCT FROM OLD.solicitada_por OR NEW.solicitada_en IS DISTINCT FROM OLD.solicitada_en
    OR NEW.coincidencia_id IS DISTINCT FROM OLD.coincidencia_id OR NEW.txid IS DISTINCT FROM OLD.txid THEN
    RAISE EXCEPTION 'suspension_no_se_reescribe';
  END IF;
  IF OLD.estado <> 'pendiente' OR NEW.estado NOT IN ('aprobada', 'rechazada') THEN
    RAISE EXCEPTION 'suspension_transicion_invalida';
  END IF;
  IF NEW.decidida_por = OLD.solicitada_por THEN
    RAISE EXCEPTION 'misma_persona_en_suspension';
  END IF;
  IF current_user = 'plataforma_sofipo' AND (
    NEW.decidida_por IS DISTINCT FROM app_usuario()
    OR NOT personal_tiene_rol(NEW.operator_id, NEW.decidida_por, ARRAY['aprobacion'])
  ) THEN
    RAISE EXCEPTION 'sin_rol_para_aprobar';
  END IF;
  -- REPEATABLE READ: la decisión escribe la fila de la empresa antes de leer los
  -- casos abiertos; si un cotejo ya la escribió después de su foto, aborta.
  UPDATE companies SET estado = estado WHERE id = NEW.company_id;
  IF NEW.estado = 'aprobada' AND NEW.tipo = 'reactivacion' AND lpb_coincidencias_abiertas(NEW.company_id) THEN
    RAISE EXCEPTION 'reactivacion_con_coincidencia_lpb';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_suspensions_revisar
BEFORE INSERT OR UPDATE OR DELETE ON company_suspensions
FOR EACH ROW EXECUTE FUNCTION company_suspensions_revisar();
CREATE TRIGGER company_suspensions_no_truncate
BEFORE TRUNCATE ON company_suspensions
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

-- La decisión aprobada deja a la empresa en el estado que dice, en la misma transacción.
CREATE FUNCTION company_suspensions_exige_efecto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'aprobada' AND NOT EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = NEW.company_id
      AND c.estado = CASE NEW.tipo WHEN 'suspension' THEN 'suspendida' ELSE 'activa' END
  ) THEN
    RAISE EXCEPTION 'suspension_sin_efecto';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER company_suspensions_exige_efecto
AFTER INSERT OR UPDATE ON company_suspensions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION company_suspensions_exige_efecto();

-- El historial admite suspender y reactivar. El sistema suspende sin actor.
ALTER TABLE company_state_history ADD COLUMN suspension_id uuid REFERENCES company_suspensions (id) ON DELETE RESTRICT;
ALTER TABLE company_state_history ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE company_state_history DROP CONSTRAINT company_state_history_estados;
ALTER TABLE company_state_history ADD CONSTRAINT company_state_history_estados CHECK (
  (estado_anterior IS NULL AND estado_nuevo = 'prospecto' AND request_id IS NULL AND suspension_id IS NULL AND actor_id IS NOT NULL)
  OR (estado_anterior = 'prospecto' AND estado_nuevo = 'en_alta' AND request_id IS NOT NULL AND suspension_id IS NULL AND actor_id IS NOT NULL)
  OR (estado_anterior = 'en_alta' AND estado_nuevo IN ('activa', 'prospecto') AND request_id IS NOT NULL
    AND suspension_id IS NULL AND actor_id IS NOT NULL)
  OR (estado_anterior = 'activa' AND estado_nuevo = 'suspendida' AND request_id IS NULL AND suspension_id IS NOT NULL)
  OR (estado_anterior = 'suspendida' AND estado_nuevo = 'activa' AND request_id IS NULL AND suspension_id IS NOT NULL
    AND actor_id IS NOT NULL)
);

COMMENT ON TABLE company_state_history IS
  'Historial append-only: prospecto, en_alta, activa; el rechazo vuelve a prospecto; suspender y reactivar. '
  'Sin actor solo cuando el sistema suspende por la Lista de Personas Bloqueadas.';

CREATE OR REPLACE FUNCTION companies_transicion_operativa()
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
    OR (OLD.estado = 'activa' AND NEW.estado = 'suspendida')
    OR (OLD.estado = 'suspendida' AND NEW.estado = 'activa')
  ) THEN
    RAISE EXCEPTION 'estado_operativo_transicion_invalida';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION companies_exige_origen_operativo()
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
    ) OR NOT bitacora_tiene_evento(NEW.id, 'prospecto_registrado', 'companies', NEW.id) THEN
      RAISE EXCEPTION 'prospecto_sin_origen_transaccional';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado
    AND (OLD.estado = 'suspendida' OR NEW.estado = 'suspendida') THEN
    IF NOT EXISTS (
      SELECT 1 FROM company_state_history h
      JOIN company_suspensions s ON s.id = h.suspension_id
      WHERE h.company_id = NEW.id AND s.company_id = NEW.id
        AND h.estado_anterior = OLD.estado AND h.estado_nuevo = NEW.estado AND h.txid = txid_current()
        AND s.estado = 'aprobada'
        AND s.tipo = CASE NEW.estado WHEN 'suspendida' THEN 'suspension' ELSE 'reactivacion' END
        AND (
          (s.origen = 'lpb' AND h.actor_id IS NULL
            AND bitacora_tiene_evento(NEW.id, 'empresa_suspendida_lpb', 'company_suspensions', s.id))
          OR (
            s.origen = 'manual' AND h.actor_id = app_usuario() AND h.actor_id = s.decidida_por
            AND bitacora_tiene_evento(NEW.id, s.tipo || '_aprobada', 'company_suspensions', s.id)
          )
        )
    ) THEN
      RAISE EXCEPTION 'estado_operativo_sin_transaccion';
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
        AND bitacora_tiene_evento(NEW.id, accion, 'company_activation_requests', h.request_id)
    ) THEN
      RAISE EXCEPTION 'estado_operativo_sin_transaccion';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Suspensión por la lista: inmediata, del sistema, con su evento.
CREATE FUNCTION lpb_suspender(p_company uuid, p_coincidencia uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  empresa companies%ROWTYPE;
  suspension uuid := gen_random_uuid();
  ahora timestamptz := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('estado_empresa:' || p_company::text, 0));
  SELECT * INTO empresa FROM companies c WHERE c.id = p_company FOR UPDATE;
  IF empresa.estado IS DISTINCT FROM 'activa' THEN
    RETURN;
  END IF;
  INSERT INTO company_suspensions (
    id, operator_id, company_id, tipo, origen, estado, motivo, solicitada_en, coincidencia_id
  ) VALUES (
    suspension, empresa.operator_id, empresa.id, 'suspension', 'lpb', 'aprobada',
    'Coincidencia con la Lista de Personas Bloqueadas', ahora, p_coincidencia
  );
  INSERT INTO audit_log (
    operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen, ocurrido_en
  ) VALUES (
    empresa.operator_id, empresa.id, 'sistema', NULL, 'sistema', 'empresa_suspendida_lpb',
    'company_suspensions', suspension, 'lpb', ahora
  );
  UPDATE companies SET estado = 'suspendida' WHERE id = empresa.id;
  INSERT INTO company_state_history (
    id, operator_id, company_id, estado_anterior, estado_nuevo, actor_id, suspension_id, ocurrido_en
  ) VALUES (
    gen_random_uuid(), empresa.operator_id, empresa.id, 'activa', 'suspendida', NULL, suspension, ahora
  );
END;
$$;

REVOKE ALL ON FUNCTION lpb_suspender(uuid, uuid) FROM PUBLIC;

-- Cotejo de una empresa: la empresa, su expediente vigente y sus proveedores,
-- contra la lista vigente del operador y los definitivos del 69-B (74ª fr. VII).
CREATE FUNCTION lpb_cotejar_empresa(p_company uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  empresa companies%ROWTYPE;
  carga uuid;
  copia uuid;
  version uuid;
  nueva record;
  nuevas integer := 0;
  primera uuid;
  ahora timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO empresa FROM companies c WHERE c.id = p_company;
  IF empresa.id IS NULL THEN
    RETURN 0;
  END IF;
  carga := lpb_carga_vigente(empresa.operator_id);
  SELECT s.id INTO copia FROM lista_69b_snapshots s ORDER BY s.cargado_en DESC, s.id DESC LIMIT 1;
  SELECT v.id INTO version FROM kyb_versiones v
  WHERE v.company_id = p_company AND v.estado = 'enviada' ORDER BY v.numero DESC LIMIT 1;

  FOR nueva IN
    WITH sujetos AS (
      SELECT 'empresa'::text AS sujeto_tipo, empresa.id AS sujeto_clave, empresa.razon_social AS nombre,
             empresa.rfc AS rfc, NULL::text AS curp
      UNION ALL
      SELECT 'beneficiario', b.clave, b.nombre, b.rfc, b.curp
      FROM kyb_beneficiarios b WHERE b.version_id = version
      UNION ALL
      SELECT 'representante', r.clave, r.nombre, r.rfc, r.curp
      FROM kyb_representantes r
      WHERE r.version_id = version AND r.retirado_en IS NULL
        AND NOT EXISTS (SELECT 1 FROM kyb_beneficiarios b WHERE b.version_id = version AND b.clave = r.clave)
      UNION ALL
      SELECT 'accionista', a.clave, a.nombre, a.rfc, a.curp
      FROM kyb_accionistas a
      WHERE a.version_id = version AND a.retirado_en IS NULL
        AND NOT EXISTS (SELECT 1 FROM kyb_beneficiarios b WHERE b.version_id = version AND b.clave = a.clave)
      UNION ALL
      SELECT 'contraparte', s.id, s.razon_social, s.rfc, NULL
      FROM suppliers s WHERE s.company_id = p_company
    ),
    hallazgos AS (
      SELECT s.*, 'lpb'::text AS lista, p.id AS persona_id, 'rfc'::text AS por, upper(btrim(s.rfc)) AS valor
      FROM sujetos s JOIN lpb_personas p ON p.carga_id = carga AND p.rfc = upper(btrim(s.rfc))
      WHERE s.rfc IS NOT NULL
      UNION ALL
      SELECT s.*, 'lpb', p.id, 'curp', upper(btrim(s.curp))
      FROM sujetos s JOIN lpb_personas p ON p.carga_id = carga AND p.curp = upper(btrim(s.curp))
      WHERE s.curp IS NOT NULL
      UNION ALL
      SELECT s.*, 'lpb', p.id, 'nombre', p.nombre_normalizado
      FROM sujetos s JOIN lpb_personas p ON p.carga_id = carga AND p.nombre_normalizado = lpb_normalizar(s.nombre)
      WHERE p.nombre_normalizado IS NOT NULL
        AND (s.rfc IS NULL OR p.rfc IS DISTINCT FROM upper(btrim(s.rfc)))
        AND (s.curp IS NULL OR p.curp IS DISTINCT FROM upper(btrim(s.curp)))
      UNION ALL
      SELECT s.*, '69b', NULL::uuid, 'rfc', upper(btrim(s.rfc))
      FROM sujetos s
      WHERE s.rfc IS NOT NULL AND copia IS NOT NULL AND EXISTS (
        SELECT 1 FROM lista_69b_rows r
        WHERE r.snapshot_id = copia AND r.rfc = upper(btrim(s.rfc)) AND r.situacion ILIKE 'definitivo%'
      )
    )
    INSERT INTO lpb_coincidencias (
      operator_id, company_id, sujeto_tipo, sujeto_clave, sujeto_nombre, sujeto_rfc, sujeto_curp,
      lista, carga_id, lpb_persona_id, snapshot_69b_id, tipo, coincide_por, valor_coincidente,
      detectada_en, plazo_reporte_hasta
    )
    SELECT DISTINCT ON (h.sujeto_tipo, h.sujeto_clave, h.lista, h.por, h.valor)
           empresa.operator_id, empresa.id, h.sujeto_tipo, h.sujeto_clave, h.nombre, h.rfc, h.curp,
           h.lista,
           CASE WHEN h.lista = 'lpb' THEN carga END,
           h.persona_id,
           CASE WHEN h.lista = '69b' THEN copia END,
           CASE WHEN h.por = 'nombre' THEN 'posible' ELSE 'exacta' END,
           h.por, h.valor, ahora,
           CASE WHEN h.por = 'nombre' THEN NULL ELSE ahora + interval '24 hours' END
    FROM hallazgos h
    -- Un caso abierto no se duplica. Uno cerrado (fuera de lista o falso positivo)
    -- se reabre cuando la persona aparece en una carga o copia del 69-B posterior a
    -- la del cierre; con la misma carga, no. Una posible por nombre que Cumplimiento
    -- descartó como falso positivo no se reabre por el mismo nombre.
    WHERE NOT EXISTS (
      SELECT 1 FROM lpb_coincidencias x
      WHERE x.company_id = empresa.id AND x.sujeto_tipo = h.sujeto_tipo AND x.sujeto_clave = h.sujeto_clave
        AND x.lista = h.lista AND x.coincide_por = h.por AND x.valor_coincidente = h.valor
        AND (
          x.estado IN ('pendiente', 'confirmada')
          OR (x.coincide_por = 'nombre' AND x.estado = 'falso_positivo')
          OR (h.lista = 'lpb' AND x.carga_id = carga)
          OR (h.lista = '69b' AND x.snapshot_69b_id = copia)
        )
    )
    ORDER BY h.sujeto_tipo, h.sujeto_clave, h.lista, h.por, h.valor, h.persona_id
    ON CONFLICT (company_id, sujeto_tipo, sujeto_clave, lista, coincide_por, valor_coincidente)
      WHERE estado IN ('pendiente', 'confirmada') DO NOTHING
    RETURNING id, sujeto_tipo, tipo
  LOOP
    nuevas := nuevas + 1;
    INSERT INTO audit_log (
      operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen, ocurrido_en
    ) VALUES (
      empresa.operator_id, empresa.id, 'sistema', NULL, 'sistema', 'lpb_coincidencia_detectada',
      'lpb_coincidencias', nueva.id, 'lpb', ahora
    );
    IF nueva.tipo = 'exacta' AND nueva.sujeto_tipo IN ('empresa', 'representante', 'beneficiario') THEN
      primera := coalesce(primera, nueva.id);
    END IF;
  END LOOP;

  -- 75ª fr. I: con coincidencia de la empresa, un representante o un propietario real, se suspende de inmediato.
  IF primera IS NOT NULL THEN
    PERFORM lpb_suspender(p_company, primera);
  END IF;
  IF nuevas > 0 THEN
    -- Lo que ya estaba autorizado y ahora frena la lista regresa a «por autorizar».
    PERFORM pagos_listos_regresan(p_company, false);
    -- Quien decide con una foto vieja (REPEATABLE READ) choca con esta escritura
    -- al cambiar el estado de la empresa: activar o reactivar no pasa sin ver el caso nuevo.
    UPDATE companies SET estado = estado WHERE id = p_company;
  END IF;
  RETURN nuevas;
END;
$$;

REVOKE ALL ON FUNCTION lpb_cotejar_empresa(uuid) FROM PUBLIC;

CREATE FUNCTION lpb_cotejar_operador(p_operador uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  empresa uuid;
  total integer := 0;
BEGIN
  FOR empresa IN
    SELECT c.id FROM companies c WHERE c.operator_id = p_operador AND c.estado <> 'baja' ORDER BY c.id
  LOOP
    total := total + lpb_cotejar_empresa(empresa);
  END LOOP;
  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION lpb_cotejar_operador(uuid) FROM PUBLIC;

-- 73ª: una carga nueva vuelve a cotejar a todos los clientes y contrapartes del operador.
CREATE FUNCTION lpb_cargas_cotejar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM lpb_cotejar_operador(NEW.operator_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER lpb_cargas_cotejar
AFTER INSERT ON lpb_cargas
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION lpb_cargas_cotejar();

-- Una copia nueva del 69-B vuelve a cotejar a las empresas del operador que la
-- carga (Administración, con su contexto). La dueña de la base, sin contexto,
-- coteja a todos.
CREATE FUNCTION lista_69b_cotejar_empresas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operador uuid;
BEGIN
  FOR operador IN
    SELECT o.id FROM operators o WHERE app_operador() IS NULL OR o.id = app_operador() ORDER BY o.id
  LOOP
    PERFORM lpb_cotejar_operador(operador);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER lista_69b_cotejar_empresas
AFTER INSERT ON lista_69b_snapshots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION lista_69b_cotejar_empresas();

-- Al enviar: propietarios reales calculados y cotejo inmediato.
CREATE FUNCTION kyb_versiones_al_enviar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'enviada' AND OLD.estado = 'borrador' THEN
    INSERT INTO kyb_beneficiarios (
      version_id, company_id, operator_id, clave, nombre, rfc, curp, pep,
      capital_pct, votos_pct, votos_controlados_pct, motivo, capas
    )
    SELECT NEW.id, NEW.company_id, NEW.operator_id, b.clave, b.nombre, b.rfc, b.curp, b.pep,
           b.capital_pct, b.votos_pct, b.votos_controlados_pct, b.motivo, b.capas
    FROM kyb_calcular_beneficiarios(NEW.id) b;
    PERFORM lpb_cotejar_empresa(NEW.company_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER kyb_versiones_al_enviar
AFTER UPDATE OF estado ON kyb_versiones
FOR EACH ROW EXECUTE FUNCTION kyb_versiones_al_enviar();

-- Un proveedor nuevo o con RFC nuevo se coteja como contraparte.
CREATE FUNCTION suppliers_cotejar_lpb()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM lpb_cotejar_empresa(NEW.company_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER suppliers_cotejar_lpb
AFTER INSERT OR UPDATE OF rfc, razon_social ON suppliers
FOR EACH ROW EXECUTE FUNCTION suppliers_cotejar_lpb();

-- Resolver coincidencias: solo Cumplimiento, siempre con motivo.
CREATE FUNCTION lpb_coincidencias_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  carga uuid;
  copia uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'conservacion_no_se_borra';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF current_user IN ('plataforma_sofipo', 'plataforma_cliente') THEN
      RAISE EXCEPTION 'coincidencia_solo_sistema';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY[
        'estado', 'resuelta_por', 'resuelta_en', 'motivo_resolucion', 'plazo_reporte_hasta',
        'reporte_folio', 'reporte_presentado_el', 'aviso_cliente_el', 'reporte_registrado_por', 'reporte_registrado_en'
      ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
        'estado', 'resuelta_por', 'resuelta_en', 'motivo_resolucion', 'plazo_reporte_hasta',
        'reporte_folio', 'reporte_presentado_el', 'aviso_cliente_el', 'reporte_registrado_por', 'reporte_registrado_en'
      ]) THEN
    RAISE EXCEPTION 'coincidencia_no_se_reescribe';
  END IF;
  IF current_user = 'plataforma_sofipo'
    AND NOT personal_tiene_rol(NEW.operator_id, app_usuario(), ARRAY['cumplimiento']) THEN
    RAISE EXCEPTION 'sin_rol_para_lpb';
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (
      (OLD.estado = 'pendiente' AND NEW.estado IN ('confirmada', 'falso_positivo', 'fuera_de_lista'))
      OR (OLD.estado = 'confirmada' AND NEW.estado = 'fuera_de_lista')
    ) THEN
      RAISE EXCEPTION 'coincidencia_transicion_invalida';
    END IF;
    IF current_user = 'plataforma_sofipo' AND NEW.resuelta_por IS DISTINCT FROM app_usuario() THEN
      RAISE EXCEPTION 'sin_rol_para_lpb';
    END IF;
    -- 77ª: «fuera de lista» solo si la persona ya no aparece en la lista vigente.
    IF NEW.estado = 'fuera_de_lista' THEN
      IF NEW.lista = 'lpb' THEN
        carga := lpb_carga_vigente(NEW.operator_id);
        IF EXISTS (
          SELECT 1 FROM lpb_personas p
          WHERE p.carga_id = carga AND (
            (NEW.coincide_por = 'rfc' AND p.rfc = NEW.valor_coincidente)
            OR (NEW.coincide_por = 'curp' AND p.curp = NEW.valor_coincidente)
            OR (NEW.coincide_por = 'nombre' AND p.nombre_normalizado = NEW.valor_coincidente)
          )
        ) THEN
          RAISE EXCEPTION 'coincidencia_sigue_en_lista';
        END IF;
      ELSE
        SELECT s.id INTO copia FROM lista_69b_snapshots s ORDER BY s.cargado_en DESC, s.id DESC LIMIT 1;
        IF EXISTS (
          SELECT 1 FROM lista_69b_rows r
          WHERE r.snapshot_id = copia AND r.rfc = NEW.valor_coincidente AND r.situacion ILIKE 'definitivo%'
        ) THEN
          RAISE EXCEPTION 'coincidencia_sigue_en_lista';
        END IF;
      END IF;
    END IF;
    IF NEW.tipo = 'posible' AND NEW.estado = 'confirmada' THEN
      NEW.plazo_reporte_hasta := NEW.resuelta_en + interval '24 hours';
    ELSIF NEW.tipo = 'posible' THEN
      NEW.plazo_reporte_hasta := NULL;
    ELSE
      NEW.plazo_reporte_hasta := OLD.plazo_reporte_hasta;
    END IF;
    IF OLD.estado = 'confirmada' AND (
      NEW.resuelta_por IS DISTINCT FROM OLD.resuelta_por AND NEW.resuelta_en IS NOT DISTINCT FROM OLD.resuelta_en
    ) THEN
      RAISE EXCEPTION 'coincidencia_no_se_reescribe';
    END IF;
  ELSIF (NEW.resuelta_por, NEW.resuelta_en, NEW.motivo_resolucion, NEW.plazo_reporte_hasta)
    IS DISTINCT FROM (OLD.resuelta_por, OLD.resuelta_en, OLD.motivo_resolucion, OLD.plazo_reporte_hasta) THEN
    RAISE EXCEPTION 'coincidencia_no_se_reescribe';
  END IF;

  -- El folio del reporte y la fecha del aviso se anotan una vez.
  IF OLD.reporte_folio IS NOT NULL AND (
    (NEW.reporte_folio, NEW.reporte_presentado_el, NEW.reporte_registrado_por, NEW.reporte_registrado_en)
    IS DISTINCT FROM (OLD.reporte_folio, OLD.reporte_presentado_el, OLD.reporte_registrado_por, OLD.reporte_registrado_en)
  ) THEN
    RAISE EXCEPTION 'reporte_ya_registrado';
  END IF;
  IF OLD.aviso_cliente_el IS NOT NULL AND NEW.aviso_cliente_el IS DISTINCT FROM OLD.aviso_cliente_el THEN
    RAISE EXCEPTION 'reporte_ya_registrado';
  END IF;
  IF current_user = 'plataforma_sofipo' AND NEW.reporte_folio IS NOT NULL AND OLD.reporte_folio IS NULL
    AND NEW.reporte_registrado_por IS DISTINCT FROM app_usuario() THEN
    RAISE EXCEPTION 'sin_rol_para_lpb';
  END IF;
  IF NEW.reporte_presentado_el IS NOT NULL AND NEW.reporte_presentado_el > hoy_mexico() THEN
    RAISE EXCEPTION 'reporte_fecha_futura';
  END IF;
  IF NEW.aviso_cliente_el IS NOT NULL AND NEW.aviso_cliente_el > hoy_mexico() THEN
    RAISE EXCEPTION 'reporte_fecha_futura';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lpb_coincidencias_revisar
BEFORE INSERT OR UPDATE OR DELETE ON lpb_coincidencias
FOR EACH ROW EXECUTE FUNCTION lpb_coincidencias_revisar();
CREATE TRIGGER lpb_coincidencias_no_truncate
BEFORE TRUNCATE ON lpb_coincidencias
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

-- Una posible coincidencia confirmada de la empresa, un representante o un
-- propietario real también suspende de inmediato (75ª fr. I).
CREATE FUNCTION lpb_coincidencias_al_confirmar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'confirmada' AND OLD.estado = 'pendiente'
    AND NEW.sujeto_tipo IN ('empresa', 'representante', 'beneficiario') THEN
    PERFORM lpb_suspender(NEW.company_id, NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER lpb_coincidencias_al_confirmar
AFTER UPDATE OF estado ON lpb_coincidencias
FOR EACH ROW EXECUTE FUNCTION lpb_coincidencias_al_confirmar();

-- Al operar ---------------------------------------------------------------------

-- ¿Algo de la lista frena un pago a este proveedor? Empresa, propietarios
-- reales y la contraparte, con caso abierto o con su RFC en la lista vigente.
CREATE FUNCTION lpb_bloquea_pago(p_company uuid, p_supplier uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM lpb_coincidencias c
    WHERE c.company_id = p_company AND c.estado IN ('pendiente', 'confirmada')
      AND (
        c.sujeto_tipo IN ('empresa', 'beneficiario')
        OR (c.sujeto_tipo = 'contraparte' AND c.sujeto_clave = p_supplier)
      )
  ) OR EXISTS (
    SELECT 1
    FROM suppliers s
    JOIN companies e ON e.id = s.company_id
    JOIN lpb_personas p ON p.carga_id = lpb_carga_vigente(e.operator_id) AND p.rfc = s.rfc
    WHERE s.id = p_supplier AND s.company_id = p_company
  )
$$;

REVOKE ALL ON FUNCTION lpb_bloquea_pago(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION lpb_bloquea_empresa(p_company uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM lpb_coincidencias c
    WHERE c.company_id = p_company AND c.estado IN ('pendiente', 'confirmada') AND c.sujeto_tipo = 'empresa'
  ) OR EXISTS (
    SELECT 1
    FROM companies e
    JOIN lpb_personas p ON p.carga_id = lpb_carga_vigente(e.operator_id) AND p.rfc = e.rfc
    WHERE e.id = p_company
  )
$$;

REVOKE ALL ON FUNCTION lpb_bloquea_empresa(uuid) FROM PUBLIC;

-- Lo que ya estaba «listo para pagar» no conserva una autorización que ya no
-- vale. Al suspender la empresa regresa todo; cuando la lista frena el pago a un
-- proveedor (la empresa, un propietario real o la contraparte), regresa lo de ese
-- proveedor. Pasa en la misma transacción, con un evento por solicitud. Tras
-- reactivar, el liberador vuelve a autorizar. El texto no menciona la lista.
CREATE FUNCTION pagos_listos_regresan(p_company uuid, p_todos boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  regresado record;
  total integer := 0;
  motivo text := CASE WHEN p_todos
    THEN 'La empresa quedó suspendida. La autorización anterior se retiró.'
    ELSE 'Este pago quedó detenido para revisión de cumplimiento. La autorización anterior se retiró.' END;
BEGIN
  FOR regresado IN
    UPDATE supplier_payment_requests AS r
    SET estado = 'por_autorizar', resuelto_por = NULL, resuelto_en = NULL, motivo_resolucion = NULL,
        version = r.version + 1
    FROM supplier_payables AS p
    WHERE p.company_id = r.company_id AND p.id = r.payable_id
      AND r.company_id = p_company AND r.estado = 'listo_para_pagar'
      AND (p_todos OR lpb_bloquea_pago(p_company, p.supplier_id))
    RETURNING r.id
  LOOP
    total := total + 1;
    INSERT INTO audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, motivo)
    SELECT c.operator_id, p_company, 'sistema', NULL, 'sistema', 'regresar_pago_proveedor',
           'supplier_payment_requests', regresado.id, motivo
    FROM companies c WHERE c.id = p_company;
  END LOOP;
  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION pagos_listos_regresan(uuid, boolean) FROM PUBLIC;

-- Suspender (por la lista o con doble firma) regresa lo autorizado.
CREATE FUNCTION companies_suspendida_regresa_pagos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pagos_listos_regresan(NEW.id, true);
  RETURN NULL;
END;
$$;

CREATE TRIGGER companies_suspendida_regresa_pagos
AFTER UPDATE OF estado ON companies
FOR EACH ROW WHEN (OLD.estado = 'activa' AND NEW.estado = 'suspendida')
EXECUTE FUNCTION companies_suspendida_regresa_pagos();

-- El regreso de «listo para pagar» acepta también estas causas (0022 solo
-- conocía la CLABE cerrada y el proveedor bloqueado o inactivo).
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


-- Liberar un pago a proveedor: con la empresa suspendida o con la lista de por
-- medio, la base no deja pasar a «listo para pagar», venga de donde venga.
CREATE FUNCTION supplier_payment_requests_lpb()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  proveedor uuid;
  estado_empresa text;
BEGIN
  IF NOT (TG_OP = 'UPDATE' AND OLD.estado = 'por_autorizar' AND NEW.estado = 'listo_para_pagar') THEN
    RETURN NEW;
  END IF;
  SELECT c.estado INTO estado_empresa FROM companies c WHERE c.id = NEW.company_id;
  IF estado_empresa IN ('suspendida', 'baja') THEN
    RAISE EXCEPTION 'empresa_suspendida';
  END IF;
  SELECT p.supplier_id INTO proveedor FROM supplier_payables p WHERE p.company_id = NEW.company_id AND p.id = NEW.payable_id;
  IF lpb_bloquea_pago(NEW.company_id, proveedor) THEN
    RAISE EXCEPTION 'pago_bloqueado_lpb';
  END IF;
  RETURN NEW;
END;
$$;

-- El nombre ordena el disparo: corre antes de supplier_payment_requests_antes para que la razón sea la lista.
CREATE TRIGGER lpb_bloquea_liberacion
BEFORE UPDATE ON supplier_payment_requests
FOR EACH ROW EXECUTE FUNCTION supplier_payment_requests_lpb();

-- Preparar nómina: misma regla sobre la empresa.
CREATE FUNCTION payroll_batches_lpb()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  estado_empresa text;
BEGIN
  SELECT c.estado INTO estado_empresa FROM companies c WHERE c.id = NEW.company_id;
  IF estado_empresa IN ('suspendida', 'baja') THEN
    RAISE EXCEPTION 'empresa_suspendida';
  END IF;
  IF lpb_bloquea_empresa(NEW.company_id) THEN
    RAISE EXCEPTION 'nomina_bloqueada_lpb';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lpb_bloquea_nomina
BEFORE INSERT ON payroll_batches
FOR EACH ROW EXECUTE FUNCTION payroll_batches_lpb();

-- Empresa suspendida: la consola queda en solo lectura. Toda escritura del
-- portal del cliente sobre sus tablas se rechaza (75ª fr. I: se suspende todo
-- acto, operación o servicio). La bitácora sigue recibiendo eventos.
CREATE FUNCTION bloqueo_empresa_suspendida()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  empresa uuid;
  estado_empresa text;
BEGIN
  IF current_user <> 'plataforma_cliente' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    empresa := OLD.company_id;
  ELSE
    empresa := NEW.company_id;
  END IF;
  SELECT c.estado INTO estado_empresa FROM companies c WHERE c.id = empresa;
  IF estado_empresa IN ('suspendida', 'baja') THEN
    RAISE EXCEPTION 'empresa_suspendida';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tabla text;
BEGIN
  FOR tabla IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.role_table_grants g
      ON g.table_schema = c.table_schema AND g.table_name = c.table_name
     AND g.grantee = 'plataforma_cliente' AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND c.table_name <> 'audit_log'
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'CREATE TRIGGER bloqueo_empresa_suspendida BEFORE INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION bloqueo_empresa_suspendida()',
      tabla
    );
  END LOOP;
END;
$$;

-- Invitaciones: el personal no invita a una empresa que no está activa.
CREATE FUNCTION invitations_empresa_activa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM companies c WHERE c.id = NEW.company_id AND c.estado IN ('suspendida', 'baja')
  ) THEN
    RAISE EXCEPTION 'empresa_suspendida';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invitations_empresa_activa
BEFORE INSERT ON invitations
FOR EACH ROW EXECUTE FUNCTION invitations_empresa_activa();

-- 6. Candado de activación ------------------------------------------------------

-- en_alta → activa solo con expediente aprobado en su versión vigente, sin
-- documentos vencidos, sin coincidencias abiertas y con riesgo vigente sobre
-- esa versión (23ª, 27ª, 75ª). Con grado distinto de bajo, estructura
-- corporativa interna (4ª fr. II c). Aplica a cualquier rol.
CREATE FUNCTION companies_candado_regulado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  version kyb_versiones%ROWTYPE;
  riesgo kyb_calificaciones_riesgo%ROWTYPE;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF OLD.estado = 'en_alta' AND NEW.estado = 'activa' THEN
    SELECT * INTO version FROM kyb_versiones v
    WHERE v.company_id = NEW.id AND v.estado = 'enviada' ORDER BY v.numero DESC LIMIT 1;
    IF version.id IS NULL OR NOT EXISTS (
      SELECT 1 FROM kyb_dictamenes d WHERE d.version_id = version.id AND d.resultado = 'aprobado'
    ) THEN
      RAISE EXCEPTION 'activacion_sin_expediente_aprobado';
    END IF;
    IF kyb_documento_vencido(version.id) THEN
      RAISE EXCEPTION 'activacion_con_documento_vencido';
    END IF;
    IF lpb_coincidencias_abiertas(NEW.id) THEN
      RAISE EXCEPTION 'activacion_con_coincidencia_lpb';
    END IF;
    SELECT * INTO riesgo FROM kyb_calificaciones_riesgo k
    WHERE k.company_id = NEW.id ORDER BY k.calificada_en DESC, k.id DESC LIMIT 1;
    IF riesgo.id IS NULL OR riesgo.version_id <> version.id OR riesgo.revisar_antes_de < hoy_mexico() THEN
      RAISE EXCEPTION 'activacion_sin_riesgo_vigente';
    END IF;
    IF riesgo.grado <> 'bajo' AND NOT EXISTS (
      SELECT 1 FROM kyb_documentos_de_version(version.id) d WHERE d.tipo = 'estructura_corporativa'
    ) THEN
      RAISE EXCEPTION 'activacion_sin_estructura_corporativa';
    END IF;
  ELSIF OLD.estado = 'suspendida' AND NEW.estado = 'activa' THEN
    IF lpb_coincidencias_abiertas(NEW.id) THEN
      RAISE EXCEPTION 'reactivacion_con_coincidencia_lpb';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_candado_regulado
BEFORE UPDATE OF estado ON companies
FOR EACH ROW EXECUTE FUNCTION companies_candado_regulado();

-- Pedir activación: Originación (o la administración de siempre). Decidirla: Aprobación.
-- 28ª/29ª: con grado alto, esta aprobación es la del directivo facultado.
CREATE FUNCTION company_activation_requests_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'plataforma_sofipo' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND (
    NEW.requested_by IS DISTINCT FROM app_usuario()
    OR NOT personal_tiene_rol(NEW.operator_id, NEW.requested_by, ARRAY['originacion', 'administracion_plataforma'])
  ) THEN
    RAISE EXCEPTION 'sin_rol_para_solicitar_activacion';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.estado IN ('aprobada', 'rechazada') AND (
    NEW.decided_by IS DISTINCT FROM app_usuario()
    OR NOT personal_tiene_rol(NEW.operator_id, NEW.decided_by, ARRAY['aprobacion'])
  ) THEN
    RAISE EXCEPTION 'sin_rol_para_aprobar';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_activation_requests_roles
BEFORE INSERT OR UPDATE ON company_activation_requests
FOR EACH ROW EXECUTE FUNCTION company_activation_requests_roles();

-- Registrar prospectos: Originación o la administración. Desde la aplicación
-- una empresa solo nace prospecto y real: llega a activa por el candado de
-- arriba (expediente, riesgo, lista y dos personas). Las empresas de
-- demostración y las de las pruebas las crea la dueña de la base.
CREATE FUNCTION companies_alta_por_rol()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('plataforma_sofipo', 'plataforma_cliente', 'plataforma_tarea', 'plataforma_app')
    AND (NEW.estado IS DISTINCT FROM 'prospecto' OR NEW.demostracion IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'empresa_nace_prospecto';
  END IF;
  IF current_user = 'plataforma_sofipo' AND app_usuario() IS NOT NULL
    AND NOT personal_tiene_rol(NEW.operator_id, app_usuario(), ARRAY['originacion', 'administracion_plataforma']) THEN
    RAISE EXCEPTION 'sin_rol_para_registrar';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_alta_por_rol
BEFORE INSERT ON companies
FOR EACH ROW EXECUTE FUNCTION companies_alta_por_rol();

-- 7. Descarga auditada ----------------------------------------------------------

-- El personal no lee la ruta del archivo: esta puerta la entrega y deja el evento
-- de quién, cuándo y qué en la misma transacción. El documento tiene que ser de la
-- empresa que dice la dirección: si no, no hay evento ni archivo.
CREATE FUNCTION kyb_documento_para_descarga(p_documento uuid, p_company uuid, p_peticion uuid)
RETURNS TABLE (clave_blob text, nombre_archivo text, tipo_contenido text, sha256 text, company_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  documento kyb_documentos%ROWTYPE;
BEGIN
  IF app_operador() IS NULL OR app_usuario() IS NULL
    OR NOT personal_tiene_rol(app_operador(), app_usuario(), ARRAY['originacion', 'aprobacion', 'cumplimiento', 'auditoria']) THEN
    RAISE EXCEPTION 'sin_permiso_expediente';
  END IF;
  SELECT * INTO documento FROM kyb_documentos d
  WHERE d.id = p_documento AND d.company_id = p_company AND d.operator_id = app_operador();
  IF documento.id IS NULL THEN
    RAISE EXCEPTION 'documento_no_existe';
  END IF;
  INSERT INTO audit_log (
    operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, peticion_id, origen
  ) VALUES (
    documento.operator_id, documento.company_id, 'personal', app_usuario(), 'sofipo',
    'expediente_documento_descargado', 'kyb_documentos', documento.id, p_peticion, 'operacion'
  );
  RETURN QUERY SELECT documento.clave_blob, documento.nombre_archivo, documento.tipo_contenido,
                      documento.sha256, documento.company_id;
END;
$$;

REVOKE ALL ON FUNCTION kyb_documento_para_descarga(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kyb_documento_para_descarga(uuid, uuid, uuid) TO plataforma_sofipo;

-- Rastro obligatorio de cada escritura del personal o del sistema --------------

CREATE FUNCTION regulado_exige_evento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ok boolean;
  empresa uuid;
BEGIN
  IF current_user NOT IN ('plataforma_sofipo', 'plataforma_cliente') THEN
    RETURN NULL;
  END IF;
  -- El evento tiene que ser de esta empresa y de esta entidad (o de la que la
  -- explica, como la versión para sus renglones heredados). lpb_cargas no es de
  -- ninguna empresa.
  IF TG_TABLE_NAME <> 'lpb_cargas' THEN
    empresa := NEW.company_id;
  END IF;
  CASE TG_TABLE_NAME
    WHEN 'kyb_versiones' THEN
      IF TG_OP = 'INSERT' THEN
        ok := bitacora_tiene_evento(empresa, 'expediente_version_creada', 'kyb_versiones', NEW.id);
      ELSIF NEW.estado = 'enviada' AND OLD.estado = 'borrador' THEN
        ok := bitacora_tiene_evento(empresa, 'expediente_enviado', 'kyb_versiones', NEW.id);
      ELSE
        ok := bitacora_tiene_evento(empresa, 'expediente_datos_editados', 'kyb_versiones', NEW.id)
          OR bitacora_tiene_evento(empresa, 'expediente_version_creada', 'kyb_versiones', NEW.id);
      END IF;
    WHEN 'kyb_documentos' THEN
      ok := bitacora_tiene_evento(empresa, 'expediente_documento_cargado', 'kyb_documentos', NEW.id);
    WHEN 'kyb_version_documentos' THEN
      ok := bitacora_tiene_evento(empresa, 'expediente_documento_cargado', 'kyb_documentos', NEW.documento_id)
        OR bitacora_tiene_evento(empresa, 'expediente_version_creada', 'kyb_versiones', NEW.version_id);
    WHEN 'kyb_representantes' THEN
      IF TG_OP = 'INSERT' THEN
        ok := bitacora_tiene_evento(empresa, 'expediente_representante_agregado', 'kyb_representantes', NEW.id)
          OR bitacora_tiene_evento(empresa, 'expediente_version_creada', 'kyb_versiones', NEW.version_id);
      ELSE
        ok := bitacora_tiene_evento(empresa, 'expediente_representante_retirado', 'kyb_representantes', NEW.id);
      END IF;
    WHEN 'kyb_accionistas' THEN
      IF TG_OP = 'INSERT' THEN
        ok := bitacora_tiene_evento(empresa, 'expediente_accionista_agregado', 'kyb_accionistas', NEW.id)
          OR bitacora_tiene_evento(empresa, 'expediente_version_creada', 'kyb_versiones', NEW.version_id);
      ELSE
        ok := bitacora_tiene_evento(empresa, 'expediente_accionista_retirado', 'kyb_accionistas', NEW.id);
      END IF;
    WHEN 'kyb_beneficiarios' THEN
      ok := bitacora_tiene_evento(empresa, 'expediente_enviado', 'kyb_versiones', NEW.version_id);
    WHEN 'kyb_dictamenes' THEN
      ok := bitacora_tiene_evento(empresa, 'expediente_dictaminado', 'kyb_dictamenes', NEW.id);
    WHEN 'kyb_calificaciones_riesgo' THEN
      ok := bitacora_tiene_evento(empresa, 'riesgo_calificado', 'kyb_calificaciones_riesgo', NEW.id);
    WHEN 'lpb_cargas' THEN
      ok := bitacora_tiene_evento(NULL, 'lpb_cargada', 'lpb_cargas', NEW.id);
    WHEN 'lpb_coincidencias' THEN
      IF TG_OP = 'INSERT' THEN
        ok := bitacora_tiene_evento(empresa, 'lpb_coincidencia_detectada', 'lpb_coincidencias', NEW.id);
      ELSIF NEW.estado IS DISTINCT FROM OLD.estado THEN
        ok := bitacora_tiene_evento(empresa, 'lpb_coincidencia_resuelta', 'lpb_coincidencias', NEW.id);
      ELSE
        ok := bitacora_tiene_evento(empresa, 'lpb_reporte_registrado', 'lpb_coincidencias', NEW.id);
      END IF;
    WHEN 'company_suspensions' THEN
      IF TG_OP = 'INSERT' THEN
        ok := bitacora_tiene_evento(
          empresa, CASE WHEN NEW.origen = 'lpb' THEN 'empresa_suspendida_lpb' ELSE NEW.tipo || '_solicitada' END,
          'company_suspensions', NEW.id
        );
      ELSE
        ok := bitacora_tiene_evento(empresa, NEW.tipo || '_' || NEW.estado, 'company_suspensions', NEW.id);
      END IF;
    ELSE
      ok := false;
  END CASE;
  IF NOT ok THEN
    RAISE EXCEPTION 'regulado_sin_auditoria';
  END IF;
  RETURN NULL;
END;
$$;

-- regulado_exige_evento corre con el rol del personal. bitacora_tiene_evento solo
-- mira eventos de la transacción en curso: no expone la bitácora.
GRANT EXECUTE ON FUNCTION bitacora_tiene_evento(uuid, text, text, uuid) TO plataforma_sofipo;

CREATE CONSTRAINT TRIGGER kyb_versiones_exige_evento AFTER INSERT OR UPDATE ON kyb_versiones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER kyb_documentos_exige_evento AFTER INSERT ON kyb_documentos
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER kyb_version_documentos_exige_evento AFTER INSERT ON kyb_version_documentos
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER kyb_representantes_exige_evento AFTER INSERT OR UPDATE ON kyb_representantes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER kyb_accionistas_exige_evento AFTER INSERT OR UPDATE ON kyb_accionistas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER kyb_beneficiarios_exige_evento AFTER INSERT ON kyb_beneficiarios
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER kyb_dictamenes_exige_evento AFTER INSERT ON kyb_dictamenes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER kyb_calificaciones_riesgo_exige_evento AFTER INSERT ON kyb_calificaciones_riesgo
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER lpb_cargas_exige_evento AFTER INSERT ON lpb_cargas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER lpb_coincidencias_exige_evento AFTER INSERT OR UPDATE ON lpb_coincidencias
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();
CREATE CONSTRAINT TRIGGER company_suspensions_exige_evento AFTER INSERT OR UPDATE ON company_suspensions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION regulado_exige_evento();

CREATE TRIGGER kyb_calificaciones_riesgo_revisar
BEFORE INSERT OR UPDATE OR DELETE ON kyb_calificaciones_riesgo
FOR EACH ROW EXECUTE FUNCTION kyb_calificaciones_riesgo_revisar();
CREATE TRIGGER kyb_calificaciones_riesgo_no_truncate
BEFORE TRUNCATE ON kyb_calificaciones_riesgo
FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra();

-- 8. RLS, incluida la segunda pared para el dueño -------------------------------

ALTER TABLE kyb_versiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_version_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_representantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_accionistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_beneficiarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_dictamenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_calificaciones_riesgo ENABLE ROW LEVEL SECURITY;
ALTER TABLE lpb_cargas ENABLE ROW LEVEL SECURITY;
ALTER TABLE lpb_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE lpb_coincidencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_suspensions ENABLE ROW LEVEL SECURITY;

ALTER TABLE kyb_versiones FORCE ROW LEVEL SECURITY;
ALTER TABLE kyb_documentos FORCE ROW LEVEL SECURITY;
ALTER TABLE kyb_version_documentos FORCE ROW LEVEL SECURITY;
ALTER TABLE kyb_representantes FORCE ROW LEVEL SECURITY;
ALTER TABLE kyb_accionistas FORCE ROW LEVEL SECURITY;
ALTER TABLE kyb_beneficiarios FORCE ROW LEVEL SECURITY;
ALTER TABLE kyb_dictamenes FORCE ROW LEVEL SECURITY;
ALTER TABLE kyb_calificaciones_riesgo FORCE ROW LEVEL SECURITY;
ALTER TABLE lpb_cargas FORCE ROW LEVEL SECURITY;
ALTER TABLE lpb_personas FORCE ROW LEVEL SECURITY;
ALTER TABLE lpb_coincidencias FORCE ROW LEVEL SECURITY;
ALTER TABLE company_suspensions FORCE ROW LEVEL SECURITY;

CREATE POLICY kyb_versiones_sofipo ON kyb_versiones FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY kyb_documentos_sofipo ON kyb_documentos FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY kyb_version_documentos_sofipo ON kyb_version_documentos FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY kyb_representantes_sofipo ON kyb_representantes FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY kyb_accionistas_sofipo ON kyb_accionistas FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY kyb_beneficiarios_sofipo ON kyb_beneficiarios FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador());
CREATE POLICY kyb_dictamenes_sofipo ON kyb_dictamenes FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY kyb_calificaciones_riesgo_sofipo ON kyb_calificaciones_riesgo FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY lpb_cargas_sofipo ON lpb_cargas FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY lpb_personas_sofipo ON lpb_personas FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY lpb_coincidencias_sofipo ON lpb_coincidencias FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY company_suspensions_sofipo ON company_suspensions FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());

GRANT SELECT, INSERT, UPDATE ON kyb_versiones TO plataforma_sofipo;
GRANT SELECT (
  id, operator_id, company_id, tipo, representante_clave, nombre_archivo, tipo_contenido, tamano_bytes,
  sha256, emitido_el, vigente_hasta, detalle, cargado_por, cargado_en, txid
) ON kyb_documentos TO plataforma_sofipo;
GRANT INSERT ON kyb_documentos TO plataforma_sofipo;
GRANT SELECT, INSERT ON kyb_version_documentos TO plataforma_sofipo;
GRANT SELECT, INSERT, UPDATE ON kyb_representantes TO plataforma_sofipo;
GRANT SELECT, INSERT, UPDATE ON kyb_accionistas TO plataforma_sofipo;
GRANT SELECT ON kyb_beneficiarios TO plataforma_sofipo;
GRANT SELECT, INSERT ON kyb_dictamenes TO plataforma_sofipo;
GRANT SELECT, INSERT ON kyb_calificaciones_riesgo TO plataforma_sofipo;
GRANT SELECT, INSERT ON lpb_cargas TO plataforma_sofipo;
GRANT SELECT, INSERT ON lpb_personas TO plataforma_sofipo;
GRANT SELECT, UPDATE ON lpb_coincidencias TO plataforma_sofipo;
GRANT SELECT, INSERT, UPDATE ON company_suspensions TO plataforma_sofipo;

GRANT EXECUTE ON FUNCTION kyb_calcular_beneficiarios(uuid) TO plataforma_sofipo;
GRANT EXECUTE ON FUNCTION kyb_estructura_completa(uuid) TO plataforma_sofipo;
GRANT EXECUTE ON FUNCTION kyb_documentos_de_version(uuid) TO plataforma_sofipo;

REVOKE ALL ON FUNCTION lpb_coincidencias_abiertas(uuid) FROM PUBLIC;
-- La usan los triggers de suspensión, que corren con el rol del personal.
GRANT EXECUTE ON FUNCTION lpb_coincidencias_abiertas(uuid) TO plataforma_sofipo;
REVOKE ALL ON FUNCTION lpb_carga_vigente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lpb_carga_vigente(uuid) TO plataforma_sofipo;

-- El portal del cliente lee la bitácora de su empresa salvo lo de Cumplimiento:
-- expediente, riesgo, Lista de Personas Bloqueadas y suspensiones con su motivo
-- (55ª: no se alerta al cliente). Que está suspendida lo ve en el estado de su empresa.
DROP POLICY audit_log_cliente_lectura ON audit_log;
CREATE POLICY audit_log_cliente_lectura ON audit_log FOR SELECT TO plataforma_cliente
  USING (
    company_id = app_empresa()
    AND entidad NOT LIKE 'kyb\_%' AND entidad NOT LIKE 'lpb\_%' AND entidad <> 'company_suspensions'
    AND accion NOT LIKE 'expediente\_%'
  );

REVOKE DELETE, TRUNCATE ON kyb_versiones, kyb_documentos, kyb_version_documentos, kyb_representantes,
  kyb_accionistas, kyb_beneficiarios, kyb_dictamenes, kyb_calificaciones_riesgo, lpb_cargas, lpb_personas,
  lpb_coincidencias, company_suspensions FROM PUBLIC;
