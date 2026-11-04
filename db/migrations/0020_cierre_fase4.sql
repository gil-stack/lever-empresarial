-- Cierre de la fase 4.
--
-- La aplicación entra con plataforma_app. Ese rol no es dueño de las tablas
-- y no tiene BYPASSRLS. En cada transacción baja a plataforma_cliente o
-- plataforma_sofipo, que son los roles que las políticas filtran.
--
-- FORCE ROW LEVEL SECURITY hace que el dueño de la tabla también pase por
-- las políticas. Un superusuario sigue saltándolas: la aplicación no entra
-- como superusuario ni como dueña.
--
-- La recuperación de contraseña cambia el hash, cierra las sesiones y no
-- toca passkeys, TOTP ni códigos de respaldo.

SET search_path TO public;

-- Rol de la conexión ----------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_app') THEN
    CREATE ROLE plataforma_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;
  END IF;
END;
$$;

COMMENT ON ROLE plataforma_app IS
  'Conexión de la aplicación. No es dueña de las tablas, no salta RLS y baja a plataforma_cliente o plataforma_sofipo.';

GRANT plataforma_cliente, plataforma_sofipo TO plataforma_app;

-- El personal de la SOFIPO no es miembro de la empresa que atiende ----------

CREATE FUNCTION personal_no_es_miembro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'memberships' AND EXISTS (
    SELECT 1 FROM platform_staff WHERE user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'personal_no_es_miembro';
  END IF;
  IF TG_TABLE_NAME = 'platform_staff' AND EXISTS (
    SELECT 1 FROM memberships WHERE user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'personal_no_es_miembro';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_personal_no_es_miembro
BEFORE INSERT OR UPDATE OF user_id ON memberships
FOR EACH ROW
EXECUTE FUNCTION personal_no_es_miembro();

CREATE TRIGGER platform_staff_personal_no_es_miembro
BEFORE INSERT OR UPDATE OF user_id ON platform_staff
FOR EACH ROW
EXECUTE FUNCTION personal_no_es_miembro();

-- Una empresa de demostración no se activa para dinero ----------------------

CREATE FUNCTION companies_demostracion_no_dinero()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.demostracion IS TRUE AND NEW.demostracion IS FALSE THEN
    RAISE EXCEPTION 'demostracion_no_se_activa_para_dinero';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_demostracion_no_dinero
BEFORE UPDATE OF demostracion ON companies
FOR EACH ROW
EXECUTE FUNCTION companies_demostracion_no_dinero();

COMMENT ON COLUMN companies.demostracion IS
  'Verdadero: recorrido de la interfaz. No se apaga para mover dinero.';

-- Recuperación de contraseña --------------------------------------------------

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
  'Recuperación de contraseña de un solo uso. Guarda el SHA-256 del token. No toca el segundo factor.';

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

-- Puertas de la autenticación, sin empresa en el contexto --------------------

CREATE FUNCTION entrada_por_token(p_hash text, p_ahora timestamptz)
RETURNS TABLE (id uuid, user_id uuid, vence_en timestamptz, intentos_fallidos integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.user_id, e.vence_en, e.intentos_fallidos
  FROM auth_entradas AS e
  WHERE e.token_hash = p_hash
    AND e.consumida_en IS NULL
    AND e.vence_en > p_ahora
    AND e.intentos_fallidos < 5
$$;

CREATE FUNCTION fallos_de_contrasena(p_user uuid, p_desde timestamptz)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM audit_log
  WHERE accion = 'entrada_fallida'
    AND identificador = p_user
    AND ocurrido_en >= p_desde
$$;

CREATE FUNCTION factor_de_sesion(p_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT segundo_factor FROM sessions WHERE id = p_id
$$;

CREATE FUNCTION recuperaciones_pendientes()
RETURNS TABLE (id uuid, nombre text, correo text, motivo text, solicitada_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, u.nombre, u.correo, r.motivo, r.solicitada_en
  FROM auth_recuperaciones AS r
  JOIN users AS u ON u.id = r.user_id
  WHERE r.estado = 'solicitada'
  ORDER BY r.solicitada_en
$$;

REVOKE ALL ON FUNCTION entrada_por_token(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION fallos_de_contrasena(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION factor_de_sesion(uuid) FROM PUBLIC;
CREATE FUNCTION password_reset_por_token(p_hash text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  vence_en timestamptz,
  usado_en timestamptz,
  anulado_en timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.user_id, r.vence_en, r.usado_en, r.anulado_en
  FROM password_resets AS r
  WHERE r.token_hash = p_hash
$$;

REVOKE ALL ON FUNCTION recuperaciones_pendientes() FROM PUBLIC;
REVOKE ALL ON FUNCTION password_reset_por_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_por_token(text, timestamptz) TO plataforma_cliente;
GRANT EXECUTE ON FUNCTION fallos_de_contrasena(uuid, timestamptz) TO plataforma_cliente;
GRANT EXECUTE ON FUNCTION factor_de_sesion(uuid) TO plataforma_cliente;
GRANT EXECUTE ON FUNCTION recuperaciones_pendientes() TO plataforma_cliente, plataforma_sofipo;
GRANT EXECUTE ON FUNCTION password_reset_por_token(text) TO plataforma_cliente;

-- Políticas de los factores ---------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON
  auth_entradas, auth_passkeys, auth_totp, auth_codigos_respaldo, auth_retos, auth_recuperaciones
  TO plataforma_cliente;
GRANT SELECT, UPDATE ON auth_recuperaciones TO plataforma_sofipo;
GRANT SELECT, INSERT, UPDATE ON password_resets TO plataforma_cliente;
GRANT UPDATE (token_hash, expires_at, segundo_factor, segundo_factor_en, segundo_factor_metodo, entrada_id)
  ON sessions TO plataforma_cliente;

ALTER TABLE auth_entradas ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_totp ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_codigos_respaldo ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_retos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_recuperaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_entradas_cliente ON auth_entradas FOR ALL TO plataforma_cliente
  USING (user_id = app_usuario()) WITH CHECK (user_id = app_usuario());
CREATE POLICY auth_passkeys_cliente ON auth_passkeys FOR ALL TO plataforma_cliente
  USING (user_id = app_usuario()) WITH CHECK (user_id = app_usuario());
CREATE POLICY auth_totp_cliente ON auth_totp FOR ALL TO plataforma_cliente
  USING (user_id = app_usuario()) WITH CHECK (user_id = app_usuario());
CREATE POLICY auth_respaldo_cliente ON auth_codigos_respaldo FOR ALL TO plataforma_cliente
  USING (user_id = app_usuario()) WITH CHECK (user_id = app_usuario());
CREATE POLICY auth_retos_cliente ON auth_retos FOR ALL TO plataforma_cliente
  USING (user_id = app_usuario()) WITH CHECK (user_id = app_usuario());
CREATE POLICY auth_recuperaciones_cliente ON auth_recuperaciones FOR ALL TO plataforma_cliente
  USING (user_id = app_usuario()) WITH CHECK (user_id = app_usuario());
CREATE POLICY password_resets_cliente ON password_resets FOR ALL TO plataforma_cliente
  USING (user_id = app_usuario()) WITH CHECK (user_id = app_usuario());

CREATE POLICY auth_recuperaciones_sofipo ON auth_recuperaciones FOR SELECT TO plataforma_sofipo
  USING (app_operador() IS NOT NULL);
CREATE POLICY auth_recuperaciones_sofipo_cambio ON auth_recuperaciones FOR UPDATE TO plataforma_sofipo
  USING (app_operador() IS NOT NULL) WITH CHECK (app_operador() IS NOT NULL);

-- Segunda pared también para el dueño de la tabla ----------------------------

DO $$
DECLARE
  tabla text;
BEGIN
  FOR tabla IN
    SELECT clase.relname
    FROM pg_class AS clase
    JOIN pg_namespace AS espacio ON espacio.oid = clase.relnamespace
    WHERE espacio.nspname = 'public'
      AND clase.relkind = 'r'
      AND clase.relname <> 'schema_migrations'
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabla);
  END LOOP;
END;
$$;
