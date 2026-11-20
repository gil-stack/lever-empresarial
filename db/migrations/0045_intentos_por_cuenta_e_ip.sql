-- Intentos de contraseña por cuenta y por IP, con espera creciente.
--
-- Hasta aquí el único tope de contraseña era por persona: ocho fallos en quince
-- minutos (fallos_de_contrasena, 0020). Servía contra quien adivina, pero también
-- dejaba fuera a la persona a propósito: bastaban ocho contraseñas malas desde
-- cualquier lado. Ahora el servicio (src/server/autenticacion/limites.ts) mira tres
-- cosas, y esta tabla guarda las dos nuevas:
--
-- * Cuenta + IP: con cinco fallos seguidos desde la misma salida, esa pareja espera
--   un minuto, luego dos, cuatro, ocho… hasta treinta. Nunca es permanente y un
--   acierto la reinicia. Quien ataca desde otra IP no afecta a la persona.
-- * IP: treinta correos distintos con fallos desde la misma salida en quince minutos
--   es una lista de cuentas probándose. Esa salida espera quince minutos, salvo para
--   las cuentas que ya entraron antes desde ahí: una oficina detrás de una misma IP
--   sigue entrando.
-- * Persona, en cualquier IP: el tope de 0020 sigue, más alto (veinte), para quien
--   reparte los intentos entre muchas salidas.
--
-- No guarda el correo ni la IP en claro: correo_hash e ip_hash son HMAC-SHA256 con
-- una llave del servidor. Las filas se borran solas a los noventa días.
--
-- Aditivos: la tabla (con RLS y sin permisos directos), dos funciones definer, sus
-- permisos y los índices. No toca datos.

SET search_path TO public;

CREATE TABLE auth_intentos_contrasena (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correo_hash text NOT NULL,
  ip_hash text NOT NULL,
  exito boolean NOT NULL,
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_intentos_contrasena_correo_hash CHECK (correo_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auth_intentos_contrasena_ip_hash CHECK (ip_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE auth_intentos_contrasena IS
  'Intentos de contraseña por cuenta y salida, sin correo ni IP en claro. Solo se lee y escribe con las funciones de 0045.';

CREATE INDEX auth_intentos_contrasena_pareja_idx
  ON auth_intentos_contrasena (correo_hash, ip_hash, ocurrido_en);
CREATE INDEX auth_intentos_contrasena_ip_idx
  ON auth_intentos_contrasena (ip_hash, ocurrido_en)
  WHERE NOT exito;
CREATE INDEX auth_intentos_contrasena_vejez_idx
  ON auth_intentos_contrasena (ocurrido_en);

ALTER TABLE auth_intentos_contrasena ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_intentos_contrasena FORCE ROW LEVEL SECURITY;
REVOKE ALL ON auth_intentos_contrasena FROM PUBLIC;

-- Anota un intento y borra, de a poco, lo de más de noventa días.
CREATE FUNCTION registrar_intento_contrasena(p_correo text, p_ip text, p_exito boolean, p_ahora timestamptz)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM auth_intentos_contrasena
  WHERE id IN (
    SELECT id FROM auth_intentos_contrasena
    WHERE ocurrido_en < p_ahora - interval '90 days'
    ORDER BY ocurrido_en
    LIMIT 100
  );
  INSERT INTO auth_intentos_contrasena (correo_hash, ip_hash, exito, ocurrido_en)
  VALUES (p_correo, p_ip, p_exito, p_ahora);
$$;

-- Lo que el servicio necesita para decidir, sin devolver filas:
-- fallos_pareja y ultima_falla: fallos de la pareja en 24 horas desde su último acierto.
-- cuentas_ip: correos distintos con fallos desde la IP en quince minutos.
-- ip_conocida: la cuenta ya entró desde esa IP en los últimos noventa días.
CREATE FUNCTION estado_intentos_contrasena(p_correo text, p_ip text, p_ahora timestamptz)
RETURNS TABLE (fallos_pareja integer, ultima_falla timestamptz, cuentas_ip integer, ip_conocida boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH acierto AS (
    SELECT max(ocurrido_en) AS en
    FROM auth_intentos_contrasena
    WHERE correo_hash = p_correo AND ip_hash = p_ip AND exito
      AND ocurrido_en >= p_ahora - interval '90 days'
  )
  SELECT
    (SELECT count(*)::integer FROM auth_intentos_contrasena, acierto
      WHERE correo_hash = p_correo AND ip_hash = p_ip AND NOT exito
        AND ocurrido_en >= p_ahora - interval '24 hours'
        AND (acierto.en IS NULL OR ocurrido_en > acierto.en)),
    (SELECT max(ocurrido_en) FROM auth_intentos_contrasena, acierto
      WHERE correo_hash = p_correo AND ip_hash = p_ip AND NOT exito
        AND ocurrido_en >= p_ahora - interval '24 hours'
        AND (acierto.en IS NULL OR ocurrido_en > acierto.en)),
    (SELECT count(DISTINCT correo_hash)::integer FROM auth_intentos_contrasena
      WHERE ip_hash = p_ip AND NOT exito AND ocurrido_en >= p_ahora - interval '15 minutes'),
    (SELECT acierto.en IS NOT NULL FROM acierto)
$$;

REVOKE ALL ON FUNCTION registrar_intento_contrasena(text, text, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION estado_intentos_contrasena(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_intento_contrasena(text, text, boolean, timestamptz) TO plataforma_cliente;
GRANT EXECUTE ON FUNCTION estado_intentos_contrasena(text, text, timestamptz) TO plataforma_cliente;
