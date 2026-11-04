-- Fase 4. Invitaciones de un solo uso y recuperación de contraseña.
--
-- PROPUESTA: db/migrate.sh no lee esta carpeta. La rama fase-4/tenencia deja
-- la tabla de invitaciones; en la integración esta forma se alinea con la
-- suya y entra a db/migrations con el número que siga. src/server/invitaciones
-- escribe contra estas columnas.
--
-- El token nunca se guarda: solo su SHA-256 en hexadecimal, como la cookie.
-- Gastarlo es un UPDATE que exige la fila pendiente y vigente; la base vuelve
-- a revisar el vencimiento contra su propio reloj. Ninguna fila se borra.
--
-- Pendiente de la tenencia: operator_id, la membresía con estado y varios
-- roles, y la RLS. La aceptación ocurre sin sesión, así que con RLS necesita
-- el rol de sistema o una función SECURITY DEFINER que solo gaste el token.

SET search_path TO public;

-- La persona que abre el enlace del correo prueba que controla la dirección.
ALTER TABLE users ADD COLUMN correo_verificado_en timestamptz;

COMMENT ON COLUMN users.correo_verificado_en IS
  'Primera vez que la persona abrió un enlace de un solo uso enviado a este correo.';

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  tipo text NOT NULL,
  correo text NOT NULL,
  nombre text NOT NULL,
  roles text[] NOT NULL,
  token_hash text NOT NULL,
  invitado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL,
  vence_en timestamptz NOT NULL,
  aceptada_en timestamptz,
  aceptada_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  revocada_en timestamptz,
  CONSTRAINT invitations_token_hash_unico UNIQUE (token_hash),
  CONSTRAINT invitations_token_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT invitations_tipo_conocido CHECK (tipo IN ('empresa', 'usuario')),
  CONSTRAINT invitations_correo_formato CHECK (
    correo = lower(btrim(correo))
    AND char_length(correo) BETWEEN 3 AND 320
    AND correo ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  CONSTRAINT invitations_nombre_presente CHECK (
    nombre = btrim(nombre)
    AND char_length(nombre) BETWEEN 1 AND 200
    AND nombre !~ '[[:cntrl:]]'
  ),
  CONSTRAINT invitations_roles_conocidos CHECK (
    cardinality(roles) BETWEEN 1 AND 5
    AND array_position(roles, NULL) IS NULL
    AND roles <@ ARRAY['administrador', 'solicitante', 'liberador', 'tarjetahabiente', 'contador']::text[]
  ),
  CONSTRAINT invitations_empresa_administra CHECK (
    tipo <> 'empresa' OR roles = ARRAY['administrador']::text[]
  ),
  CONSTRAINT invitations_vigencia CHECK (
    vence_en > creada_en AND vence_en <= creada_en + interval '30 days'
  ),
  CONSTRAINT invitations_aceptacion_completa CHECK ((aceptada_en IS NULL) = (aceptada_por IS NULL)),
  CONSTRAINT invitations_un_desenlace CHECK (aceptada_en IS NULL OR revocada_en IS NULL)
);

-- Una sola pendiente por persona y empresa. Reenviar revoca la anterior en
-- la misma transacción, así que el enlace viejo deja de servir.
CREATE UNIQUE INDEX invitations_una_pendiente
  ON invitations (company_id, correo)
  WHERE aceptada_en IS NULL AND revocada_en IS NULL;

CREATE INDEX invitations_company_id_idx ON invitations (company_id, creada_en);

COMMENT ON TABLE invitations IS
  'Invitación de un solo uso. Guarda el SHA-256 del token, nunca el token. No se borra.';

COMMENT ON COLUMN invitations.token_hash IS
  'SHA-256 en hexadecimal del token del enlace. Nunca el token.';

COMMENT ON COLUMN invitations.roles IS
  'Roles que recibe la persona al aceptar. La invitación de empresa solo da administrador.';

CREATE FUNCTION invitations_un_solo_desenlace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'invitacion_no_se_borra';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.tipo IS DISTINCT FROM OLD.tipo
    OR NEW.correo IS DISTINCT FROM OLD.correo
    OR NEW.nombre IS DISTINCT FROM OLD.nombre
    OR NEW.roles IS DISTINCT FROM OLD.roles
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
    OR NEW.invitado_por IS DISTINCT FROM OLD.invitado_por
    OR NEW.creada_en IS DISTINCT FROM OLD.creada_en
    OR NEW.vence_en IS DISTINCT FROM OLD.vence_en
  THEN
    RAISE EXCEPTION 'invitacion_no_se_reescribe';
  END IF;
  IF (OLD.aceptada_en IS NOT NULL OR OLD.revocada_en IS NOT NULL)
    AND (NEW.aceptada_en IS DISTINCT FROM OLD.aceptada_en
      OR NEW.aceptada_por IS DISTINCT FROM OLD.aceptada_por
      OR NEW.revocada_en IS DISTINCT FROM OLD.revocada_en)
  THEN
    RAISE EXCEPTION 'invitacion_ya_cerrada';
  END IF;
  IF OLD.aceptada_en IS NULL AND NEW.aceptada_en IS NOT NULL
    AND (clock_timestamp() >= OLD.vence_en OR NEW.aceptada_en >= OLD.vence_en)
  THEN
    RAISE EXCEPTION 'invitacion_vencida';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invitations_un_solo_desenlace
BEFORE UPDATE OR DELETE ON invitations
FOR EACH ROW
EXECUTE FUNCTION invitations_un_solo_desenlace();

CREATE TRIGGER invitations_no_truncate
BEFORE TRUNCATE ON invitations
FOR EACH STATEMENT
EXECUTE FUNCTION invitations_un_solo_desenlace();

REVOKE DELETE, TRUNCATE ON invitations FROM PUBLIC;

CREATE TABLE password_resets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  creado_en timestamptz NOT NULL,
  vence_en timestamptz NOT NULL,
  usado_en timestamptz,
  anulado_en timestamptz,
  CONSTRAINT password_resets_token_hash_unico UNIQUE (token_hash),
  CONSTRAINT password_resets_token_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT password_resets_vigencia CHECK (
    vence_en > creado_en AND vence_en <= creado_en + interval '2 hours'
  ),
  CONSTRAINT password_resets_un_desenlace CHECK (usado_en IS NULL OR anulado_en IS NULL)
);

CREATE INDEX password_resets_user_id_idx ON password_resets (user_id, creado_en);

COMMENT ON TABLE password_resets IS
  'Recuperación de contraseña de un solo uso. Guarda el SHA-256 del token. No se borra.';

CREATE FUNCTION password_resets_un_solo_desenlace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'recuperacion_no_se_borra';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
    OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
    OR NEW.vence_en IS DISTINCT FROM OLD.vence_en
  THEN
    RAISE EXCEPTION 'recuperacion_no_se_reescribe';
  END IF;
  IF (OLD.usado_en IS NOT NULL OR OLD.anulado_en IS NOT NULL)
    AND (NEW.usado_en IS DISTINCT FROM OLD.usado_en OR NEW.anulado_en IS DISTINCT FROM OLD.anulado_en)
  THEN
    RAISE EXCEPTION 'recuperacion_ya_cerrada';
  END IF;
  IF OLD.usado_en IS NULL AND NEW.usado_en IS NOT NULL
    AND (clock_timestamp() >= OLD.vence_en OR NEW.usado_en >= OLD.vence_en)
  THEN
    RAISE EXCEPTION 'recuperacion_vencida';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER password_resets_un_solo_desenlace
BEFORE UPDATE OR DELETE ON password_resets
FOR EACH ROW
EXECUTE FUNCTION password_resets_un_solo_desenlace();

CREATE TRIGGER password_resets_no_truncate
BEFORE TRUNCATE ON password_resets
FOR EACH STATEMENT
EXECUTE FUNCTION password_resets_un_solo_desenlace();

REVOKE DELETE, TRUNCATE ON password_resets FROM PUBLIC;
