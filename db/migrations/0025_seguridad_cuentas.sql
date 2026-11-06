-- Seguridad de cuentas.
--   - recuperaciones_pendientes() deja de ser legible desde la superficie
--      cliente: devolvía nombre, correo y motivo de las solicitudes de todas
--      las empresas. Solo el personal (plataforma_sofipo) la lee.
--   - Índice parcial para contar contraseñas fallidas por persona sin
--      recorrer audit_log completo en cada intento.
--   - La sesión vence por inactividad (30 minutos sin uso) además del
--      vencimiento absoluto. sesion_por_token deja de devolver la sesión
--      inactiva y devuelve ultimo_uso para que la aplicación lo renueve como
--      mucho una vez por minuto.
--   - Confirmar la identidad dentro de una sesión (cambiar factores, aprobar
--      recuperaciones) renueva segundo_factor_en y cuenta los intentos de esa
--      sesión. El intento se aparta antes de verificar: al quinto no hay más.
--      El sello solo avanza con su evento en la misma transacción y el
--      contador solo baja cuando el sello avanza.
--   - Quitar la app autenticadora ya usada fallaba siempre: el trigger de
--      auth_totp tomaba un ultimo_paso sin cambio como código repetido. Ahora
--      el mismo paso solo pasa cuando la misma escritura revoca la app.
--   - La puerta de entrada también aparta el intento antes de verificar; el
--      intento apartado se devuelve solo al consumir la entrada con éxito.
--   - Los retos de passkey para confirmar la identidad tienen propósito
--      propio y quedan ligados a la sesión: los de la puerta no los tocan.
--
-- Aditivos: el índice, las columnas nuevas (con valor por omisión), el GRANT y
-- el constraint trigger del sello. No aditivos: el REVOKE, el reemplazo de
-- sesion_por_token (devuelve una columna más y filtra la sesión inactiva), el
-- reemplazo de las funciones de los triggers de auth_totp, auth_entradas y
-- sessions, y el CHECK de propósito de auth_retos.

SET search_path TO public;

-- 1. Fuga entre empresas -------------------------------------------------------

REVOKE EXECUTE ON FUNCTION recuperaciones_pendientes() FROM plataforma_cliente;

COMMENT ON FUNCTION recuperaciones_pendientes() IS
  'Solicitudes de segundo factor perdido de todas las empresas. Solo plataforma_sofipo: trae nombre, correo y motivo.';

-- 2. Bloqueo por persona ---------------------------------------------------------

-- fallos_de_contrasena filtra accion = 'entrada_fallida', identificador y
-- ocurrido_en. audit_log_entidad_idx empieza por entidad y no sirve.
CREATE INDEX audit_log_entrada_fallida_idx
  ON audit_log (identificador, ocurrido_en)
  WHERE accion = 'entrada_fallida';

-- 3. Inactividad -----------------------------------------------------------------

ALTER TABLE sessions ADD COLUMN ultimo_uso timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN sessions.ultimo_uso IS
  'Último uso visto de la sesión. Sin uso en 30 minutos, sesion_por_token ya no la devuelve. Se renueva como mucho una vez por minuto.';

-- Cambia el tipo de retorno (agrega ultimo_uso): CREATE OR REPLACE no basta.
DROP FUNCTION sesion_por_token(text, timestamptz, boolean);

CREATE FUNCTION sesion_por_token(p_token_hash text, p_ahora timestamptz, p_completa boolean)
RETURNS TABLE (
  sesion_id uuid,
  user_id uuid,
  nombre text,
  correo text,
  expires_at timestamptz,
  superficie text,
  segundo_factor_en timestamptz,
  segundo_factor_metodo text,
  ultimo_uso timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, u.id, u.nombre, u.correo, s.expires_at, s.superficie,
         s.segundo_factor_en, s.segundo_factor_metodo, s.ultimo_uso
  FROM sessions AS s
  JOIN users AS u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.expires_at > p_ahora
    AND s.ultimo_uso > p_ahora - interval '30 minutes'
    AND u.password_hash IS NOT NULL
    AND (s.segundo_factor_en IS NOT NULL) = p_completa
$$;

REVOKE ALL ON FUNCTION sesion_por_token(text, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sesion_por_token(text, timestamptz, boolean) TO plataforma_cliente;

-- 4. Reautenticación dentro de la sesión ----------------------------------------

ALTER TABLE sessions ADD COLUMN reautenticaciones_fallidas smallint NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD CONSTRAINT sessions_reautenticaciones_fallidas CHECK (
  reautenticaciones_fallidas BETWEEN 0 AND 5
);

COMMENT ON COLUMN sessions.reautenticaciones_fallidas IS
  'Intentos de confirmar la identidad dentro de esta sesión. Se aparta antes de verificar; un acierto lo regresa a 0 junto con el sello. Con 5 no hay más intentos y la aplicación borra la sesión.';

GRANT UPDATE (ultimo_uso, reautenticaciones_fallidas) ON sessions TO plataforma_cliente;

-- 5. Revocar una app autenticadora ya usada -----------------------------------

-- Igual que en 0019 salvo la última regla: ultimo_paso solo avanza, y el mismo
-- paso solo pasa cuando esa escritura revoca la app (revocar no toca el paso y
-- antes se rechazaba como totp_codigo_repetido).
CREATE OR REPLACE FUNCTION auth_totp_solo_avanza()
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
  IF OLD.ultimo_paso IS NOT NULL AND (
    NEW.ultimo_paso IS NULL
    OR NEW.ultimo_paso < OLD.ultimo_paso
    OR (NEW.ultimo_paso = OLD.ultimo_paso AND NEW.revocado_en IS NOT DISTINCT FROM OLD.revocado_en)
  ) THEN
    RAISE EXCEPTION 'totp_codigo_repetido';
  END IF;
  RETURN NEW;
END;
$$;

-- 6. El sello de la sesión exige rastro ----------------------------------------

-- Igual que en 0019 salvo el UPDATE: el rol cliente puede escribir
-- segundo_factor_en y reautenticaciones_fallidas de su sesión. El sello solo
-- avanza, el método cambia solo con él y el contador solo baja cuando el sello
-- avanza (un acierto lo regresa a 0).
CREATE OR REPLACE FUNCTION sessions_exige_segundo_factor()
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
    IF NEW.segundo_factor_en IS DISTINCT FROM OLD.segundo_factor_en AND (
      NEW.segundo_factor_en IS NULL
      OR (OLD.segundo_factor_en IS NOT NULL AND NEW.segundo_factor_en <= OLD.segundo_factor_en)
    ) THEN
      RAISE EXCEPTION 'sesion_no_se_reescribe';
    END IF;
    IF NEW.segundo_factor_en IS NOT DISTINCT FROM OLD.segundo_factor_en AND (
      NEW.segundo_factor_metodo IS DISTINCT FROM OLD.segundo_factor_metodo
      OR NEW.reautenticaciones_fallidas < OLD.reautenticaciones_fallidas
    ) THEN
      RAISE EXCEPTION 'sesion_no_se_reescribe';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.segundo_factor IS NULL OR NEW.entrada_id IS NULL THEN
    RAISE EXCEPTION 'sesion_sin_segundo_factor';
  END IF;
  NEW.segundo_factor_en := now();
  NEW.segundo_factor_metodo := NEW.segundo_factor;
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

-- Renovar el sello deja evento en la misma transacción, como los factores.
CREATE FUNCTION sessions_sello_exige_rastro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.segundo_factor_en IS DISTINCT FROM OLD.segundo_factor_en
    AND NOT auth_exige_evento('reautenticacion', NEW.id)
    AND NOT auth_exige_evento('entrada_completa', NEW.id) THEN
    RAISE EXCEPTION 'sesion_sin_auditoria';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER sessions_sello_exige_rastro
AFTER UPDATE OF segundo_factor_en ON sessions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sessions_sello_exige_rastro();

-- 7. La puerta aparta el intento antes de verificar -------------------------

-- Igual que en 0019 salvo intentos_fallidos: puede bajar uno, y solo en la
-- escritura que consume la entrada verificada (el intento apartado acertó).
CREATE OR REPLACE FUNCTION auth_entradas_solo_avanza()
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
  IF NEW.intentos_fallidos < OLD.intentos_fallidos AND NOT (
    NEW.intentos_fallidos = OLD.intentos_fallidos - 1
    AND OLD.consumida_en IS NULL
    AND NEW.consumida_en IS NOT NULL
    AND NEW.verificada_con IS NOT NULL
  ) THEN
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

-- 8. Retos de passkey para confirmar la identidad ---------------------------

ALTER TABLE auth_retos ADD COLUMN sesion_id uuid REFERENCES sessions (id) ON DELETE CASCADE;
ALTER TABLE auth_retos DROP CONSTRAINT auth_retos_proposito;
ALTER TABLE auth_retos ADD CONSTRAINT auth_retos_proposito CHECK (
  proposito IN ('entrar', 'registrar', 'reautenticar')
);
ALTER TABLE auth_retos ADD CONSTRAINT auth_retos_sesion CHECK (
  (proposito = 'reautenticar') = (sesion_id IS NOT NULL)
);

COMMENT ON COLUMN auth_retos.sesion_id IS
  'Solo para reautenticar: la sesión que pidió el reto. Un reto de la puerta nunca sirve para confirmar la identidad y viceversa.';
