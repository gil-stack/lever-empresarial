-- Fase 2. Una sola fila para la suscripción mensual por empresa.
-- suscripcion_centavos queda vacío a propósito: la cifra no está publicada
-- y esta migración no siembra un monto. Cero no se escribe aquí. Cero, como
-- decisión de producto, es por persona, por tarjeta y de implementación, y
-- no vive en esta tabla.

SET search_path TO public;

CREATE TABLE platform_pricing (
  singleton boolean PRIMARY KEY DEFAULT true,
  fila_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  suscripcion_centavos bigint,
  publicado_en timestamptz,
  CONSTRAINT platform_pricing_una_fila CHECK (singleton),
  CONSTRAINT platform_pricing_centavos_si_hay CHECK (
    suscripcion_centavos IS NULL OR suscripcion_centavos > 0
  ),
  CONSTRAINT platform_pricing_publicacion_completa CHECK (
    (suscripcion_centavos IS NULL AND publicado_en IS NULL)
    OR (suscripcion_centavos IS NOT NULL AND publicado_en IS NOT NULL)
  )
);

COMMENT ON TABLE platform_pricing IS
  'Una fila. Centavos de la suscripción mensual por empresa, o vacío si sigue no publicada.';

COMMENT ON COLUMN platform_pricing.suscripcion_centavos IS
  'Centavos de peso. NULL significa cifra no publicada. No se siembra un monto.';

COMMENT ON COLUMN platform_pricing.publicado_en IS
  'Hora en que el operador publicó el monto. Vacía mientras el campo lo esté.';

INSERT INTO platform_pricing (singleton, suscripcion_centavos, publicado_en)
VALUES (true, NULL, NULL);

CREATE FUNCTION platform_pricing_proteger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'platform_pricing no se borra';
  END IF;
  IF NEW.singleton IS DISTINCT FROM OLD.singleton OR NEW.fila_id IS DISTINCT FROM OLD.fila_id THEN
    RAISE EXCEPTION 'platform_pricing es una sola fila';
  END IF;
  IF OLD.suscripcion_centavos IS NOT NULL THEN
    RAISE EXCEPTION 'el monto de la suscripcion ya esta publicado';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_pricing_no_update
BEFORE UPDATE ON platform_pricing
FOR EACH ROW
EXECUTE FUNCTION platform_pricing_proteger();

CREATE TRIGGER platform_pricing_no_delete
BEFORE DELETE ON platform_pricing
FOR EACH ROW
EXECUTE FUNCTION platform_pricing_proteger();

CREATE TRIGGER platform_pricing_no_truncate
BEFORE TRUNCATE ON platform_pricing
FOR EACH STATEMENT
EXECUTE FUNCTION platform_pricing_proteger();
