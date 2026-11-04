-- Fase 4. Autenticación fuerte para las tres superficies.
--
-- Decisión del fundador: toda persona entra con correo, contraseña y un
-- segundo factor. El segundo factor es una passkey o, si no tiene, un código
-- TOTP de una app autenticadora. Sin segundo factor no hay sesión.
--
-- La contraseña sola abre una entrada de minutos, no una sesión. La sesión
-- nace cuando esa entrada se consume con el segundo factor, en la misma
-- transacción. Perder el segundo factor no lo quita un correo: lo quita la
-- aprobación de otra persona, con evento, y la cuenta sigue cerrada hasta
-- que se inscribe uno nuevo.
--
-- Nada en claro: la passkey es llave pública, la semilla TOTP va cifrada con
-- una llave que no vive en la base, y los códigos de respaldo y los tokens
-- se guardan como SHA-256.

SET search_path TO public;

-- Las sesiones de antes no tienen segundo factor. No se honran.
DELETE FROM sessions;

CREATE FUNCTION auth_exige_evento(p_accion text, p_identificador uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM audit_events
    WHERE accion = p_accion
      AND identificador = p_identificador
  );
$$;

-- La contraseña ya coincidió. Falta el segundo factor.
CREATE TABLE auth_entradas (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  creada_en timestamptz NOT NULL,
  vence_en timestamptz NOT NULL,
  intentos_fallidos integer NOT NULL DEFAULT 0,
  verificada_con text,
  verificada_en timestamptz,
  consumida_en timestamptz,
  CONSTRAINT auth_entradas_token_hash_unico UNIQUE (token_hash),
  CONSTRAINT auth_entradas_token_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_entradas_vigencia_corta CHECK (
    vence_en > creada_en AND vence_en <= creada_en + interval '15 minutes'
  ),
  CONSTRAINT auth_entradas_intentos CHECK (intentos_fallidos BETWEEN 0 AND 5),
  CONSTRAINT auth_entradas_metodo CHECK (
    verificada_con IS NULL OR verificada_con IN ('passkey', 'totp', 'respaldo')
  ),
  CONSTRAINT auth_entradas_verificacion_completa CHECK (
    (verificada_con IS NULL) = (verificada_en IS NULL)
  ),
  CONSTRAINT auth_entradas_verificada_al_consumir CHECK (
    verificada_con IS NULL OR consumida_en IS NOT NULL
  )
);

CREATE INDEX auth_entradas_user_idx ON auth_entradas (user_id, creada_en);

COMMENT ON TABLE auth_entradas IS
  'La contraseña coincidió. Vive minutos, se consume una vez y solo así nace una sesión.';

CREATE FUNCTION auth_entradas_solo_avanza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'entrada_no_se_borra';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.user_id <> OLD.user_id
    OR NEW.token_hash <> OLD.token_hash
    OR NEW.creada_en <> OLD.creada_en
    OR NEW.vence_en <> OLD.vence_en THEN
    RAISE EXCEPTION 'entrada_no_se_reescribe';
  END IF;
  IF NEW.intentos_fallidos < OLD.intentos_fallidos THEN
    RAISE EXCEPTION 'entrada_no_se_reescribe';
  END IF;
  IF OLD.verificada_con IS NOT NULL AND (
    NEW.verificada_con IS DISTINCT FROM OLD.verificada_con
    OR NEW.verificada_en IS DISTINCT FROM OLD.verificada_en
  ) THEN
    RAISE EXCEPTION 'entrada_no_se_reescribe';
  END IF;
  IF OLD.consumida_en IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'entrada_ya_consumida';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_entradas_solo_avanza
BEFORE UPDATE OR DELETE ON auth_entradas
FOR EACH ROW
EXECUTE FUNCTION auth_entradas_solo_avanza();

ALTER TABLE sessions
  ADD COLUMN segundo_factor text,
  ADD COLUMN entrada_id uuid REFERENCES auth_entradas (id) ON DELETE RESTRICT,
  ADD CONSTRAINT sessions_segundo_factor_metodo CHECK (
    segundo_factor IS NULL OR segundo_factor IN ('passkey', 'totp', 'respaldo')
  ),
  ADD CONSTRAINT sessions_segundo_factor_con_entrada CHECK (
    (segundo_factor IS NULL) = (entrada_id IS NULL)
  ),
  ADD CONSTRAINT sessions_entrada_unica UNIQUE (entrada_id);

COMMENT ON COLUMN sessions.segundo_factor IS
  'Con qué segundo factor nació la sesión. Vacía: la aplicación no la honra.';

COMMENT ON COLUMN sessions.entrada_id IS
  'La entrada que se consumió en la misma transacción que creó esta sesión.';

-- Una sesión con segundo factor sale de una entrada de la misma persona,
-- verificada con ese método y consumida en esta transacción.
CREATE FUNCTION sessions_exige_segundo_factor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.segundo_factor IS DISTINCT FROM OLD.segundo_factor
      OR NEW.entrada_id IS DISTINCT FROM OLD.entrada_id
      OR NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'sesion_no_se_reescribe';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.segundo_factor IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM auth_entradas e
    WHERE e.id = NEW.entrada_id
      AND e.user_id = NEW.user_id
      AND e.verificada_con = NEW.segundo_factor
      AND e.consumida_en = now()
      AND now() <= e.vence_en
  ) THEN
    RAISE EXCEPTION 'sesion_sin_segundo_factor';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_exige_segundo_factor
BEFORE INSERT OR UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION sessions_exige_segundo_factor();

-- La llave privada no sale del dispositivo.
CREATE TABLE auth_passkeys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  credencial_id text NOT NULL,
  llave_publica bytea NOT NULL,
  contador bigint NOT NULL DEFAULT 0,
  transportes text[] NOT NULL DEFAULT '{}',
  nombre text NOT NULL,
  respaldada boolean NOT NULL DEFAULT false,
  creada_en timestamptz NOT NULL,
  ultimo_uso_en timestamptz,
  revocada_en timestamptz,
  revocada_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT auth_passkeys_credencial_unica UNIQUE (credencial_id),
  CONSTRAINT auth_passkeys_credencial_formato CHECK (
    char_length(credencial_id) BETWEEN 16 AND 1400
    AND credencial_id ~ '^[A-Za-z0-9_-]+$'
  ),
  CONSTRAINT auth_passkeys_llave_tamano CHECK (octet_length(llave_publica) BETWEEN 16 AND 2048),
  CONSTRAINT auth_passkeys_contador CHECK (contador >= 0),
  CONSTRAINT auth_passkeys_nombre CHECK (
    nombre = btrim(nombre)
    AND char_length(nombre) BETWEEN 1 AND 60
    AND nombre !~ '[[:cntrl:]]'
  ),
  CONSTRAINT auth_passkeys_revocacion_completa CHECK (
    (revocada_en IS NULL) = (revocada_por IS NULL)
  )
);

CREATE INDEX auth_passkeys_user_idx ON auth_passkeys (user_id) WHERE revocada_en IS NULL;

COMMENT ON TABLE auth_passkeys IS
  'Llave pública de cada passkey. No se borra: se revoca y deja evento.';

CREATE FUNCTION auth_passkeys_solo_avanza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'passkey_no_se_borra';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.user_id <> OLD.user_id
    OR NEW.credencial_id <> OLD.credencial_id
    OR NEW.llave_publica <> OLD.llave_publica
    OR NEW.creada_en <> OLD.creada_en THEN
    RAISE EXCEPTION 'passkey_no_se_reescribe';
  END IF;
  IF OLD.revocada_en IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'passkey_revocada';
  END IF;
  IF NEW.contador < OLD.contador THEN
    RAISE EXCEPTION 'passkey_contador_atras';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_passkeys_solo_avanza
BEFORE UPDATE OR DELETE ON auth_passkeys
FOR EACH ROW
EXECUTE FUNCTION auth_passkeys_solo_avanza();

-- Semilla cifrada (AES-256-GCM). La llave no está en la base.
-- Una fila sin confirmar se puede borrar. Una confirmada solo se revoca.
CREATE TABLE auth_totp (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  secreto_cifrado text NOT NULL,
  creado_en timestamptz NOT NULL,
  confirmado_en timestamptz,
  ultimo_paso bigint,
  revocado_en timestamptz,
  revocado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT auth_totp_cifrado_formato CHECK (
    secreto_cifrado ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,200}\.[A-Za-z0-9_-]{22}$'
  ),
  CONSTRAINT auth_totp_paso CHECK (ultimo_paso IS NULL OR ultimo_paso > 0),
  CONSTRAINT auth_totp_paso_confirmado CHECK (ultimo_paso IS NULL OR confirmado_en IS NOT NULL),
  CONSTRAINT auth_totp_revocacion_completa CHECK (
    (revocado_en IS NULL) = (revocado_por IS NULL)
  )
);

CREATE UNIQUE INDEX auth_totp_uno_vigente ON auth_totp (user_id) WHERE revocado_en IS NULL;

COMMENT ON TABLE auth_totp IS
  'Semilla TOTP cifrada. ultimo_paso impide repetir un código ya usado.';

CREATE FUNCTION auth_totp_solo_avanza()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.confirmado_en IS NOT NULL THEN
      RAISE EXCEPTION 'totp_no_se_borra';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.user_id <> OLD.user_id
    OR NEW.secreto_cifrado <> OLD.secreto_cifrado
    OR NEW.creado_en <> OLD.creado_en THEN
    RAISE EXCEPTION 'totp_no_se_reescribe';
  END IF;
  IF OLD.confirmado_en IS NOT NULL AND NEW.confirmado_en IS DISTINCT FROM OLD.confirmado_en THEN
    RAISE EXCEPTION 'totp_no_se_reescribe';
  END IF;
  IF OLD.revocado_en IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'totp_revocado';
  END IF;
  IF OLD.ultimo_paso IS NOT NULL AND (NEW.ultimo_paso IS NULL OR NEW.ultimo_paso <= OLD.ultimo_paso) THEN
    RAISE EXCEPTION 'totp_codigo_repetido';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_totp_solo_avanza
BEFORE UPDATE OR DELETE ON auth_totp
FOR EACH ROW
EXECUTE FUNCTION auth_totp_solo_avanza();

-- Diez códigos, de un solo uso, guardados como SHA-256.
CREATE TABLE auth_codigos_respaldo (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  codigo_hash text NOT NULL,
  creado_en timestamptz NOT NULL,
  usado_en timestamptz,
  invalidado_en timestamptz,
  CONSTRAINT auth_codigos_respaldo_hash_unico UNIQUE (codigo_hash),
  CONSTRAINT auth_codigos_respaldo_sha256 CHECK (codigo_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_codigos_respaldo_un_cierre CHECK (usado_en IS NULL OR invalidado_en IS NULL)
);

CREATE INDEX auth_codigos_respaldo_user_idx
  ON auth_codigos_respaldo (user_id)
  WHERE usado_en IS NULL AND invalidado_en IS NULL;

COMMENT ON TABLE auth_codigos_respaldo IS
  'Hash de cada código de respaldo. Sirve una vez. El código en claro se muestra una sola vez y no se guarda.';

CREATE FUNCTION auth_codigos_respaldo_un_uso()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'respaldo_no_se_borra';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.user_id <> OLD.user_id
    OR NEW.codigo_hash <> OLD.codigo_hash
    OR NEW.creado_en <> OLD.creado_en THEN
    RAISE EXCEPTION 'respaldo_no_se_reescribe';
  END IF;
  IF (OLD.usado_en IS NOT NULL OR OLD.invalidado_en IS NOT NULL) AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'respaldo_ya_usado';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_codigos_respaldo_un_uso
BEFORE UPDATE OR DELETE ON auth_codigos_respaldo
FOR EACH ROW
EXECUTE FUNCTION auth_codigos_respaldo_un_uso();

CREATE TABLE auth_retos (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  proposito text NOT NULL,
  reto text NOT NULL,
  creado_en timestamptz NOT NULL,
  vence_en timestamptz NOT NULL,
  usado_en timestamptz,
  CONSTRAINT auth_retos_proposito CHECK (proposito IN ('entrar', 'registrar')),
  CONSTRAINT auth_retos_formato CHECK (reto ~ '^[A-Za-z0-9_-]{32,128}$'),
  CONSTRAINT auth_retos_reto_unico UNIQUE (reto),
  CONSTRAINT auth_retos_vigencia_corta CHECK (
    vence_en > creado_en AND vence_en <= creado_en + interval '10 minutes'
  )
);

CREATE INDEX auth_retos_user_idx ON auth_retos (user_id, proposito, creado_en);

COMMENT ON TABLE auth_retos IS
  'Reto de WebAuthn. Sirve una vez y vence en minutos.';

-- Recuperar el segundo factor: la persona pide, otra verifica su identidad
-- y aprueba. La aprobación revoca los factores y las sesiones en la misma
-- transacción. La ventana que abre solo sirve para inscribir uno nuevo
-- después de volver a escribir la contraseña.
CREATE TABLE auth_recuperaciones (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  solicitada_en timestamptz NOT NULL,
  motivo text NOT NULL,
  estado text NOT NULL DEFAULT 'solicitada',
  resuelta_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  resuelta_en timestamptz,
  verificacion text,
  nota text,
  vence_en timestamptz,
  cumplida_en timestamptz,
  CONSTRAINT auth_recuperaciones_estado CHECK (
    estado IN ('solicitada', 'aprobada', 'rechazada', 'cumplida', 'vencida')
  ),
  CONSTRAINT auth_recuperaciones_motivo CHECK (
    motivo = btrim(motivo)
    AND char_length(motivo) BETWEEN 1 AND 500
    AND motivo !~ '[[:cntrl:]]'
  ),
  CONSTRAINT auth_recuperaciones_nota CHECK (
    nota IS NULL OR (
      nota = btrim(nota)
      AND char_length(nota) BETWEEN 1 AND 500
      AND nota !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT auth_recuperaciones_otra_persona CHECK (
    resuelta_por IS NULL OR resuelta_por <> user_id
  ),
  CONSTRAINT auth_recuperaciones_verificacion CHECK (
    verificacion IS NULL OR verificacion IN ('presencial', 'videollamada')
  ),
  CONSTRAINT auth_recuperaciones_forma CHECK (
    (estado = 'solicitada'
      AND resuelta_por IS NULL AND resuelta_en IS NULL AND verificacion IS NULL
      AND vence_en IS NULL AND cumplida_en IS NULL)
    OR (estado = 'rechazada'
      AND resuelta_por IS NOT NULL AND resuelta_en IS NOT NULL AND nota IS NOT NULL
      AND vence_en IS NULL AND cumplida_en IS NULL)
    OR (estado IN ('aprobada', 'cumplida')
      AND resuelta_por IS NOT NULL AND resuelta_en IS NOT NULL AND verificacion IS NOT NULL
      AND vence_en IS NOT NULL AND vence_en > resuelta_en
      AND vence_en <= resuelta_en + interval '24 hours'
      AND (estado = 'aprobada') = (cumplida_en IS NULL))
    OR (estado = 'vencida'
      AND resuelta_por IS NOT NULL AND resuelta_en IS NOT NULL AND verificacion IS NOT NULL
      AND vence_en IS NOT NULL AND cumplida_en IS NULL)
  )
);

CREATE UNIQUE INDEX auth_recuperaciones_una_abierta
  ON auth_recuperaciones (user_id)
  WHERE estado IN ('solicitada', 'aprobada');

COMMENT ON TABLE auth_recuperaciones IS
  'Pedir, verificar y aprobar la recuperación del segundo factor. Dos personas y evento en cada paso.';

CREATE FUNCTION auth_recuperaciones_transicion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'recuperacion_no_se_borra';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.user_id <> OLD.user_id
    OR NEW.solicitada_en <> OLD.solicitada_en
    OR NEW.motivo <> OLD.motivo THEN
    RAISE EXCEPTION 'recuperacion_no_se_reescribe';
  END IF;
  IF NOT (
    (OLD.estado = 'solicitada' AND NEW.estado IN ('aprobada', 'rechazada'))
    OR (OLD.estado = 'aprobada' AND NEW.estado = 'cumplida'
      AND NEW.resuelta_por = OLD.resuelta_por
      AND NEW.resuelta_en = OLD.resuelta_en
      AND NEW.vence_en = OLD.vence_en)
    OR (OLD.estado = 'aprobada' AND NEW.estado = 'vencida'
      AND NEW.resuelta_por = OLD.resuelta_por
      AND NEW.resuelta_en = OLD.resuelta_en
      AND NEW.vence_en = OLD.vence_en
      AND NEW.cumplida_en IS NULL)
  ) THEN
    RAISE EXCEPTION 'recuperacion_transicion_invalida';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_recuperaciones_transicion
BEFORE UPDATE OR DELETE ON auth_recuperaciones
FOR EACH ROW
EXECUTE FUNCTION auth_recuperaciones_transicion();

CREATE FUNCTION auth_recuperaciones_exige_rastro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  esperada text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    esperada := 'recuperacion_solicitada';
  ELSIF NEW.estado = OLD.estado THEN
    RETURN NULL;
  ELSIF NEW.estado = 'aprobada' THEN
    esperada := 'recuperacion_aprobada';
  ELSIF NEW.estado = 'rechazada' THEN
    esperada := 'recuperacion_rechazada';
  ELSIF NEW.estado = 'cumplida' THEN
    esperada := 'recuperacion_cumplida';
  ELSIF NEW.estado = 'vencida' THEN
    esperada := 'recuperacion_vencida';
  END IF;
  IF esperada IS NOT NULL AND NOT auth_exige_evento(esperada, NEW.id) THEN
    RAISE EXCEPTION 'recuperacion_sin_auditoria';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.estado = 'aprobada' THEN
    IF EXISTS (SELECT 1 FROM auth_passkeys WHERE user_id = NEW.user_id AND revocada_en IS NULL)
      OR EXISTS (SELECT 1 FROM auth_totp WHERE user_id = NEW.user_id AND revocado_en IS NULL)
      OR EXISTS (
        SELECT 1 FROM auth_codigos_respaldo
        WHERE user_id = NEW.user_id AND usado_en IS NULL AND invalidado_en IS NULL
      )
      OR EXISTS (SELECT 1 FROM sessions WHERE user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'recuperacion_con_factores_vigentes';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER auth_recuperaciones_exige_rastro
AFTER INSERT OR UPDATE ON auth_recuperaciones
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION auth_recuperaciones_exige_rastro();

-- Registrar o revocar un factor deja evento en la misma transacción.
CREATE FUNCTION auth_factor_exige_rastro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  esperada text;
BEGIN
  IF TG_TABLE_NAME = 'auth_passkeys' THEN
    IF TG_OP = 'INSERT' THEN
      esperada := 'passkey_registrada';
    ELSIF OLD.revocada_en IS NULL AND NEW.revocada_en IS NOT NULL THEN
      esperada := 'passkey_revocada';
    END IF;
  ELSIF TG_TABLE_NAME = 'auth_totp' THEN
    IF TG_OP = 'UPDATE' AND OLD.confirmado_en IS NULL AND NEW.confirmado_en IS NOT NULL THEN
      esperada := 'totp_confirmado';
    ELSIF TG_OP = 'UPDATE' AND OLD.revocado_en IS NULL AND NEW.revocado_en IS NOT NULL THEN
      esperada := 'totp_revocado';
    END IF;
  END IF;
  IF esperada IS NOT NULL AND NOT auth_exige_evento(esperada, NEW.id) THEN
    RAISE EXCEPTION 'factor_sin_auditoria';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER auth_passkeys_exige_rastro
AFTER INSERT OR UPDATE ON auth_passkeys
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION auth_factor_exige_rastro();

CREATE CONSTRAINT TRIGGER auth_totp_exige_rastro
AFTER INSERT OR UPDATE ON auth_totp
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION auth_factor_exige_rastro();

-- El conteo de contraseñas fallidas lee la bitácora por acción e identificador.
CREATE INDEX audit_events_accion_identificador_idx
  ON audit_events (accion, identificador, ocurrido_en);
