-- Fase 4. Tenencia: operador, personal de la plataforma, membresías con
-- varios roles e invitaciones.
--
-- El operador es la SOFIPO: una fila hoy. Toda empresa cliente lleva su
-- operador. El personal de la plataforma es otra entidad, separada de las
-- membresías: no es miembro de la empresa que atiende.
--
-- Cae la regla «una persona, una empresa». Una persona puede pertenecer a
-- varias empresas, y en cada una tener varios roles. Se conserva «un RFC por
-- cliente». Los roles de hoy pasan a membership_roles sin perder una fila.
--
-- La invitación es el único camino para que alguien nuevo entre: la persona
-- fija su propia contraseña con un enlace de un solo uso. El token no se
-- guarda; se guarda su SHA-256.

SET search_path TO public;

-- 1. Operador -----------------------------------------------------------------

CREATE TABLE operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  alta_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operators_nombre_presente CHECK (
    nombre = btrim(nombre)
    AND char_length(nombre) BETWEEN 1 AND 200
    AND nombre !~ '[[:cntrl:]]'
  )
);

COMMENT ON TABLE operators IS
  'La entidad que opera la plataforma. Hoy una fila: la SOFIPO. La configuración de plataforma cuelga de aquí.';

INSERT INTO operators (nombre) VALUES ('Operador de la plataforma');

-- 2. Empresa cliente: operador, ciclo de vida y demostración ------------------

ALTER TABLE companies ADD COLUMN operator_id uuid REFERENCES operators (id) ON DELETE RESTRICT;
UPDATE companies SET operator_id = (SELECT id FROM operators ORDER BY alta_en, id LIMIT 1);
ALTER TABLE companies ALTER COLUMN operator_id SET NOT NULL;
CREATE INDEX companies_operator_id_idx ON companies (operator_id);
ALTER TABLE companies ADD CONSTRAINT companies_id_operador UNIQUE (id, operator_id);

ALTER TABLE companies ADD COLUMN estado text NOT NULL DEFAULT 'activa';
ALTER TABLE companies ALTER COLUMN estado DROP DEFAULT;
ALTER TABLE companies ADD CONSTRAINT companies_estado_conocido CHECK (
  estado IN ('prospecto', 'en_alta', 'activa', 'suspendida', 'baja')
);

-- Las empresas que hoy viven en el libro nacieron del alta pública de prueba.
-- Quedan como demostración: recorren la interfaz y nunca se activan para dinero.
ALTER TABLE companies ADD COLUMN demostracion boolean NOT NULL DEFAULT true;
ALTER TABLE companies ALTER COLUMN demostracion DROP DEFAULT;

ALTER TABLE companies ADD COLUMN originada_por uuid REFERENCES users (id) ON DELETE RESTRICT;

COMMENT ON COLUMN companies.operator_id IS 'Operador que origina y supervisa a la empresa.';
COMMENT ON COLUMN companies.estado IS 'Ciclo de vida: prospecto, en_alta, activa, suspendida o baja.';
COMMENT ON COLUMN companies.demostracion IS 'Empresa de demostración: recorre la interfaz y nunca se activa para dinero.';
COMMENT ON COLUMN companies.originada_por IS 'Personal de la plataforma que dio de alta a la empresa. Vacío en las que vienen del alta pública.';

-- 3. Personas: contraseña propia y correo verificado ---------------------------

-- Quien recibe una invitación existe antes de fijar su contraseña.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN correo_verificado_en timestamptz;

COMMENT ON COLUMN users.password_hash IS
  'Hash bcrypt. Vacío hasta que la persona acepta su invitación. La contraseña en claro no se guarda.';
COMMENT ON COLUMN users.correo_verificado_en IS
  'Hora en que la persona abrió su enlace de invitación. Ese enlace solo llega a su correo.';

-- 4. Sesiones: superficie --------------------------------------------------------

ALTER TABLE sessions ADD COLUMN superficie text NOT NULL DEFAULT 'cliente';
ALTER TABLE sessions ADD CONSTRAINT sessions_superficie_conocida CHECK (
  superficie IN ('cliente', 'sofipo', 'telefono')
);
ALTER TABLE sessions ADD COLUMN creada_en timestamptz NOT NULL DEFAULT now();

-- Contraseña sola no abre ningún portal. La sesión nace parcial y queda
-- completa cuando la persona verifica su segundo factor (passkey, o TOTP si
-- no tiene passkey). Al completarse, el token cambia.
ALTER TABLE sessions ADD COLUMN segundo_factor_en timestamptz;
ALTER TABLE sessions ADD COLUMN segundo_factor_metodo text;
ALTER TABLE sessions ADD CONSTRAINT sessions_segundo_factor CHECK (
  (segundo_factor_en IS NULL AND segundo_factor_metodo IS NULL)
  OR (segundo_factor_en IS NOT NULL AND segundo_factor_metodo IN ('passkey', 'totp'))
);

COMMENT ON COLUMN sessions.segundo_factor_en IS
  'Hora en que la persona verificó su segundo factor en esta sesión. Vacía: sesión parcial, no abre ningún portal.';

-- Las sesiones de hoy se abrieron sin segundo factor. Se cierran: cada persona
-- vuelve a entrar con su segundo factor.
DELETE FROM sessions;

-- 5. Personal de la plataforma -------------------------------------------------

CREATE TABLE platform_staff (
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  estado text NOT NULL,
  alta_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_staff_pkey PRIMARY KEY (operator_id, user_id),
  CONSTRAINT platform_staff_estado_conocido CHECK (estado IN ('invitado', 'activo', 'suspendido'))
);

CREATE INDEX platform_staff_user_id_idx ON platform_staff (user_id);

COMMENT ON TABLE platform_staff IS
  'Personal del operador. No es miembro de ninguna empresa cliente y entra con su propio rol.';

CREATE TABLE platform_staff_roles (
  operator_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rol text NOT NULL,
  CONSTRAINT platform_staff_roles_pkey PRIMARY KEY (operator_id, user_id, rol),
  CONSTRAINT platform_staff_roles_personal
    FOREIGN KEY (operator_id, user_id)
    REFERENCES platform_staff (operator_id, user_id)
    ON DELETE RESTRICT,
  -- Cada rol se enciende cuando su fase le da trabajo. Hoy hay uno.
  CONSTRAINT platform_staff_roles_conocido CHECK (rol IN ('administracion_plataforma'))
);

COMMENT ON TABLE platform_staff_roles IS
  'Roles del personal del operador. administracion_plataforma: lista 69-B, precio, alta de empresas e invitaciones.';

-- 6. Membresías con estado y varios roles --------------------------------------

ALTER TABLE memberships DROP CONSTRAINT memberships_una_persona_una_empresa;
CREATE INDEX memberships_user_id_idx ON memberships (user_id);

ALTER TABLE memberships ADD COLUMN estado text NOT NULL DEFAULT 'activa';
ALTER TABLE memberships ALTER COLUMN estado DROP DEFAULT;
ALTER TABLE memberships ADD CONSTRAINT memberships_estado_conocido CHECK (
  estado IN ('invitada', 'activa', 'suspendida')
);
ALTER TABLE memberships ADD COLUMN alta_en timestamptz NOT NULL DEFAULT now();

CREATE TABLE membership_roles (
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  rol text NOT NULL,
  CONSTRAINT membership_roles_pkey PRIMARY KEY (user_id, company_id, rol),
  CONSTRAINT membership_roles_membresia
    FOREIGN KEY (user_id, company_id)
    REFERENCES memberships (user_id, company_id)
    ON DELETE RESTRICT,
  CONSTRAINT membership_roles_rol_conocido CHECK (
    rol IN ('administrador', 'solicitante', 'liberador', 'tarjetahabiente', 'contador')
  )
);

CREATE INDEX membership_roles_company_rol_idx ON membership_roles (company_id, rol);

COMMENT ON TABLE membership_roles IS
  'Roles de una persona en una empresa. Se combinan: el administrador puede liberar y el liberador puede tener tarjeta.';

-- Cada membresía de hoy conserva su rol. Ninguna fila se pierde.
INSERT INTO membership_roles (user_id, company_id, rol)
SELECT user_id, company_id, rol FROM memberships;

ALTER TABLE memberships DROP COLUMN rol;

COMMENT ON TABLE memberships IS
  'Persona × empresa. Una persona puede tener varias. Los roles viven en membership_roles. Solo la activa da acceso.';

-- 7. El maestro admite a la misma persona en otra empresa -----------------------

ALTER TABLE employees DROP CONSTRAINT employees_un_usuario;
ALTER TABLE employees ADD CONSTRAINT employees_un_usuario_por_empresa UNIQUE (company_id, user_id);

-- 8. Invitaciones ---------------------------------------------------------------

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  emitida_por_tipo text NOT NULL,
  emitida_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  emitida_en timestamptz NOT NULL DEFAULT now(),
  expira_en timestamptz NOT NULL,
  usada_en timestamptz,
  revocada_en timestamptz,
  CONSTRAINT invitations_token_hash_unico UNIQUE (token_hash),
  CONSTRAINT invitations_token_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT invitations_empresa_del_operador
    FOREIGN KEY (company_id, operator_id)
    REFERENCES companies (id, operator_id)
    ON DELETE RESTRICT,
  CONSTRAINT invitations_membresia
    FOREIGN KEY (user_id, company_id)
    REFERENCES memberships (user_id, company_id)
    ON DELETE RESTRICT,
  CONSTRAINT invitations_emisor CHECK (
    (emitida_por_tipo IN ('personal', 'miembro') AND emitida_por IS NOT NULL)
    OR (emitida_por_tipo = 'sistema' AND emitida_por IS NULL)
  ),
  CONSTRAINT invitations_vigencia CHECK (
    expira_en > emitida_en AND expira_en <= emitida_en + interval '7 days'
  ),
  CONSTRAINT invitations_un_cierre CHECK (usada_en IS NULL OR revocada_en IS NULL)
);

CREATE INDEX invitations_company_id_idx ON invitations (company_id);
CREATE INDEX invitations_user_id_idx ON invitations (user_id);

COMMENT ON TABLE invitations IS
  'Enlace de un solo uso para entrar. company_id vacío: invitación al personal del operador. Guarda el SHA-256 del token, nunca el token.';
COMMENT ON COLUMN invitations.expira_en IS
  'Después de esta hora la invitación no sirve. Siete días como máximo.';

-- La invitación solo se cierra una vez: se usa o se revoca. Nada más cambia.
CREATE FUNCTION invitations_un_solo_uso()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'invitacion_no_se_borra';
  END IF;
  IF OLD.usada_en IS NOT NULL OR OLD.revocada_en IS NOT NULL THEN
    RAISE EXCEPTION 'invitacion_cerrada';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.emitida_por_tipo IS DISTINCT FROM OLD.emitida_por_tipo
     OR NEW.emitida_por IS DISTINCT FROM OLD.emitida_por
     OR NEW.emitida_en IS DISTINCT FROM OLD.emitida_en
     OR NEW.expira_en IS DISTINCT FROM OLD.expira_en THEN
    RAISE EXCEPTION 'invitacion_cerrada';
  END IF;
  IF NEW.usada_en IS NOT NULL AND OLD.expira_en <= now() THEN
    RAISE EXCEPTION 'invitacion_vencida';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invitations_no_update
BEFORE UPDATE ON invitations
FOR EACH ROW
EXECUTE FUNCTION invitations_un_solo_uso();

CREATE TRIGGER invitations_no_delete
BEFORE DELETE ON invitations
FOR EACH ROW
EXECUTE FUNCTION invitations_un_solo_uso();

CREATE TRIGGER invitations_no_truncate
BEFORE TRUNCATE ON invitations
FOR EACH STATEMENT
EXECUTE FUNCTION invitations_un_solo_uso();
