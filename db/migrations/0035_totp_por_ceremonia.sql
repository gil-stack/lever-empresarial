-- Una pendiente anterior no acredita quién vio su semilla. Se descarta sin
-- tocar las apps confirmadas: cada persona puede volver a preparar su QR.
DELETE FROM auth_totp WHERE confirmado_en IS NULL;

ALTER TABLE auth_totp
  ADD COLUMN entrada_id uuid REFERENCES auth_entradas (id) ON DELETE RESTRICT,
  -- La sesión puede cerrarse; conservamos su identificador como origen histórico.
  ADD COLUMN sesion_id uuid,
  ADD COLUMN recuperacion_id uuid REFERENCES auth_recuperaciones (id) ON DELETE RESTRICT,
  ADD COLUMN vence_en timestamptz,
  ADD CONSTRAINT auth_totp_ceremonia CHECK (
    (confirmado_en IS NOT NULL AND entrada_id IS NULL AND sesion_id IS NULL
      AND recuperacion_id IS NULL AND vence_en IS NULL)
    OR (num_nonnulls(entrada_id, sesion_id) = 1 AND vence_en IS NOT NULL
      AND vence_en > creado_en AND vence_en <= creado_en + interval '10 minutes'
      AND (recuperacion_id IS NULL OR entrada_id IS NOT NULL))
  );

DROP INDEX auth_totp_uno_pendiente;
CREATE UNIQUE INDEX auth_totp_pendiente_entrada ON auth_totp (user_id, entrada_id)
  WHERE confirmado_en IS NULL AND revocado_en IS NULL AND entrada_id IS NOT NULL;
CREATE UNIQUE INDEX auth_totp_pendiente_sesion ON auth_totp (user_id, sesion_id)
  WHERE confirmado_en IS NULL AND revocado_en IS NULL AND sesion_id IS NOT NULL;

-- No se permite convertir una pendiente ajena en la pendiente de otra ceremonia
-- ni extender su plazo. La confirmación vuelve a comprobar el padre en la base.
CREATE FUNCTION auth_totp_validar_ceremonia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  instante timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.entrada_id IS DISTINCT FROM OLD.entrada_id
    OR NEW.sesion_id IS DISTINCT FROM OLD.sesion_id
    OR NEW.recuperacion_id IS DISTINCT FROM OLD.recuperacion_id
    OR NEW.vence_en IS DISTINCT FROM OLD.vence_en
  ) THEN
    RAISE EXCEPTION 'totp_no_se_reescribe';
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.confirmado_en IS NULL)
    OR (TG_OP = 'UPDATE' AND OLD.confirmado_en IS NULL AND NEW.confirmado_en IS NOT NULL) THEN
    instante := greatest(coalesce(NEW.confirmado_en, NEW.creado_en), clock_timestamp());
    IF NEW.vence_en IS NULL OR NEW.vence_en <= instante THEN
      RAISE EXCEPTION 'totp_codigo_repetido';
    END IF;
    IF NEW.entrada_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM auth_entradas WHERE id = NEW.entrada_id AND user_id = NEW.user_id
        AND consumida_en IS NULL AND vence_en > instante) THEN
        RAISE EXCEPTION 'totp_no_se_reescribe';
      END IF;
      IF NEW.recuperacion_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM auth_recuperaciones WHERE id = NEW.recuperacion_id AND user_id = NEW.user_id
          AND estado = 'aprobada' AND resuelta_en <= NEW.creado_en AND vence_en > instante
      ) THEN
        RAISE EXCEPTION 'totp_no_se_reescribe';
      END IF;
    ELSIF NEW.sesion_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM sessions WHERE id = NEW.sesion_id AND user_id = NEW.user_id AND expires_at > instante
        AND segundo_factor_en <= instante AND segundo_factor_en >= instante - interval '5 minutes'
    ) THEN
      RAISE EXCEPTION 'totp_no_se_reescribe';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_totp_validar_ceremonia BEFORE INSERT OR UPDATE ON auth_totp
FOR EACH ROW EXECUTE FUNCTION auth_totp_validar_ceremonia();
