-- Seguridad de cuentas. Cinco cambios. Aditivos: el índice, las dos columnas
-- de sessions (con valor por omisión) y el GRANT. No aditivos: el REVOKE, el
-- reemplazo de sesion_por_token (devuelve una columna más y filtra la sesión
-- inactiva) y el de la función del trigger de auth_totp.
--   1. recuperaciones_pendientes() deja de ser legible desde la superficie
--      cliente: devolvía nombre, correo y motivo de las solicitudes de todas
--      las empresas. Solo el personal (plataforma_sofipo) la lee.
--   2. Índice parcial para contar contraseñas fallidas por persona sin
--      recorrer audit_log completo en cada intento.
--   3. La sesión vence por inactividad (30 minutos sin uso) además del
--      vencimiento absoluto. sesion_por_token deja de devolver la sesión
--      inactiva y devuelve ultimo_uso para que la aplicación lo renueve como
--      mucho una vez por minuto.
--   4. Confirmar la identidad dentro de una sesión (cambiar factores, aprobar
--      recuperaciones) renueva segundo_factor_en y cuenta los intentos
--      fallidos de esa sesión. Al quinto, la aplicación cierra la sesión.
--   5. Quitar la app autenticadora ya usada fallaba siempre: el trigger de
--      auth_totp tomaba un ultimo_paso sin cambio como código repetido. Ahora
--      la regla solo aplica cuando ultimo_paso cambia; un código repetido
--      sigue rechazado.

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
  'Intentos fallidos de confirmar la identidad dentro de esta sesión. Al quinto la aplicación borra la sesión.';

GRANT UPDATE (ultimo_uso, reautenticaciones_fallidas) ON sessions TO plataforma_cliente;

-- 5. Revocar una app autenticadora ya usada -----------------------------------

-- Igual que en 0019 salvo la última regla: «ultimo_paso solo avanza» se evalúa
-- solo cuando ultimo_paso cambia. Revocar no lo toca y antes se rechazaba como
-- totp_codigo_repetido.
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
  IF OLD.ultimo_paso IS NOT NULL
    AND NEW.ultimo_paso IS DISTINCT FROM OLD.ultimo_paso
    AND (NEW.ultimo_paso IS NULL OR NEW.ultimo_paso < OLD.ultimo_paso) THEN
    RAISE EXCEPTION 'totp_codigo_repetido';
  END IF;
  RETURN NEW;
END;
$$;
