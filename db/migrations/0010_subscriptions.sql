-- Fase 2. Una suscripción por empresa. Nace en recorrido el día del alta.
-- Treinta días es la regla del producto y se cuenta desde recorrido_inicio:
-- no se guarda un segundo reloj. Pasar a aceptada exige que platform_pricing
-- ya tenga monto. Esta migración no escribe centavos.

SET search_path TO public;

CREATE TABLE subscriptions (
  company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,
  estado text NOT NULL,
  recorrido_inicio timestamptz NOT NULL,
  aceptada_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  aceptada_en timestamptz,
  CONSTRAINT subscriptions_estado CHECK (estado IN ('recorrido', 'aceptada')),
  CONSTRAINT subscriptions_aceptacion_completa CHECK (
    (estado = 'recorrido' AND aceptada_por IS NULL AND aceptada_en IS NULL)
    OR (estado = 'aceptada' AND aceptada_por IS NOT NULL AND aceptada_en IS NOT NULL)
  )
);

COMMENT ON TABLE subscriptions IS
  'Una por empresa. recorrido desde el alta, o aceptada cuando el monto ya está publicado.';

COMMENT ON COLUMN subscriptions.recorrido_inicio IS
  'Inicio del recorrido. La regla de producto son treinta días desde aquí.';

COMMENT ON COLUMN subscriptions.aceptada_por IS
  'Operador que registró la aceptación. Vacío mientras sigue en recorrido.';

CREATE FUNCTION subscriptions_proteger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'recorrido' OR NEW.aceptada_por IS NOT NULL OR NEW.aceptada_en IS NOT NULL THEN
      RAISE EXCEPTION 'la suscripcion nace en recorrido';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'la suscripcion no se borra';
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.recorrido_inicio IS DISTINCT FROM OLD.recorrido_inicio THEN
    RAISE EXCEPTION 'el recorrido no se reescribe';
  END IF;

  IF OLD.estado = 'aceptada' THEN
    RAISE EXCEPTION 'la suscripcion aceptada no regresa a recorrido';
  END IF;

  IF NEW.estado = 'aceptada' AND OLD.estado IS DISTINCT FROM 'aceptada' THEN
    IF NEW.aceptada_por IS NULL OR NEW.aceptada_en IS NULL THEN
      RAISE EXCEPTION 'la aceptacion no trae quien ni cuando';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM platform_pricing
      WHERE suscripcion_centavos IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'la suscripcion no pasa a aceptada sin monto publicado';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_antes_de_insertar
BEFORE INSERT ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION subscriptions_proteger();

CREATE TRIGGER subscriptions_antes_de_actualizar
BEFORE UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION subscriptions_proteger();

CREATE TRIGGER subscriptions_no_delete
BEFORE DELETE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION subscriptions_proteger();

CREATE TRIGGER subscriptions_no_truncate
BEFORE TRUNCATE ON subscriptions
FOR EACH STATEMENT
EXECUTE FUNCTION subscriptions_proteger();

CREATE FUNCTION companies_abre_recorrido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO subscriptions (company_id, estado, recorrido_inicio)
  VALUES (NEW.id, 'recorrido', NEW.alta_at);
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_abre_recorrido
AFTER INSERT ON companies
FOR EACH ROW
EXECUTE FUNCTION companies_abre_recorrido();

-- Empresas que ya estaban en el libro. El trigger cubre las que entren después.
INSERT INTO subscriptions (company_id, estado, recorrido_inicio)
SELECT id, 'recorrido', alta_at
FROM companies
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions AS suscripcion WHERE suscripcion.company_id = companies.id
);
