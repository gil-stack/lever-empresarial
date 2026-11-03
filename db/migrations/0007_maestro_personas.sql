-- Fase 2, maestro de personas. Centros de costo y personas de una empresa.
-- La CLABE se guarda solo si el dígito cierra con la ponderación 3, 7 y 1.
-- No hay dispersión: la baja es una fecha en el maestro.

SET search_path TO public;

CREATE FUNCTION clabe_digito_371(clabe text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  pesos int[] := ARRAY[3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
  suma int := 0;
  i int;
  digito int;
BEGIN
  IF clabe IS NULL OR clabe !~ '^[0-9]{18}$' THEN
    RETURN false;
  END IF;
  FOR i IN 1..17 LOOP
    digito := substring(clabe from i for 1)::int;
    suma := suma + ((digito * pesos[i]) % 10);
  END LOOP;
  RETURN ((10 - (suma % 10)) % 10) = substring(clabe from 18 for 1)::int;
END;
$$;

COMMENT ON FUNCTION clabe_digito_371(text) IS
  'Dígito de la CLABE con ponderación 3, 7 y 1. El residuo es de cada producto, no de la suma bruta.';

CREATE TABLE cost_centers (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  CONSTRAINT cost_centers_nombre_presente CHECK (
    nombre = btrim(nombre)
    AND char_length(nombre) BETWEEN 1 AND 80
    AND nombre !~ '[[:cntrl:]]'
  )
);

CREATE UNIQUE INDEX cost_centers_nombre_por_empresa
  ON cost_centers (company_id, lower(nombre));

CREATE INDEX cost_centers_company_id_idx ON cost_centers (company_id);

COMMENT ON TABLE cost_centers IS
  'Centro de costo de una empresa. El nombre no se repite dentro de la cuenta.';

CREATE TABLE employees (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  jefe_id uuid REFERENCES employees (id) ON DELETE RESTRICT,
  cost_center_id uuid NOT NULL REFERENCES cost_centers (id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  alta_en date NOT NULL,
  baja_en date,
  clabe text NOT NULL,
  clabe_digito_valido boolean NOT NULL,
  CONSTRAINT employees_nombre_presente CHECK (
    nombre = btrim(nombre)
    AND char_length(nombre) BETWEEN 1 AND 120
    AND nombre !~ '[[:cntrl:]]'
  ),
  CONSTRAINT employees_baja_no_anterior CHECK (
    baja_en IS NULL OR baja_en >= alta_en
  ),
  CONSTRAINT employees_no_es_su_jefe CHECK (
    jefe_id IS NULL OR jefe_id <> id
  ),
  CONSTRAINT employees_clabe_validada CHECK (
    clabe ~ '^[0-9]{18}$'
    AND clabe_digito_valido IS TRUE
    AND clabe_digito_371(clabe)
  ),
  CONSTRAINT employees_un_usuario UNIQUE (user_id)
);

CREATE INDEX employees_company_id_idx ON employees (company_id);
CREATE INDEX employees_jefe_id_idx ON employees (jefe_id);

COMMENT ON TABLE employees IS
  'Persona del maestro. La CLABE queda para un reembolso o una dispersión que esta fase no hace.';

COMMENT ON COLUMN employees.clabe IS
  '18 dígitos completos. El dígito ya cerró. No es un PAN y no se enmascara.';

COMMENT ON COLUMN employees.baja_en IS
  'Fecha de baja en el maestro. No apaga una tarjeta y no dispersa.';

CREATE FUNCTION employees_misma_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.jefe_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM employees
    WHERE id = NEW.jefe_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'jefe_de_otra_empresa';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM cost_centers
    WHERE id = NEW.cost_center_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'centro_de_otra_empresa';
  END IF;

  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM memberships
    WHERE user_id = NEW.user_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'usuario_de_otra_empresa';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER employees_misma_empresa
BEFORE INSERT OR UPDATE ON employees
FOR EACH ROW
EXECUTE FUNCTION employees_misma_empresa();

-- La única corrección de esta fase es la fecha de baja. La CLABE no se pisa.
CREATE FUNCTION employees_solo_cambia_la_baja()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.jefe_id IS DISTINCT FROM OLD.jefe_id
    OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id
    OR NEW.nombre IS DISTINCT FROM OLD.nombre
    OR NEW.alta_en IS DISTINCT FROM OLD.alta_en
    OR NEW.clabe IS DISTINCT FROM OLD.clabe
    OR NEW.clabe_digito_valido IS DISTINCT FROM OLD.clabe_digito_valido
  THEN
    RAISE EXCEPTION 'persona_solo_cambia_la_baja';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER employees_solo_cambia_la_baja
BEFORE UPDATE ON employees
FOR EACH ROW
EXECUTE FUNCTION employees_solo_cambia_la_baja();

CREATE FUNCTION cost_centers_exige_auditoria_de_alta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM audit_events
    WHERE company_id = NEW.company_id
      AND actor_id IS NOT NULL
      AND accion = 'alta_centro_costo'
      AND entidad = 'cost_centers'
      AND identificador = NEW.id
  ) THEN
    RAISE EXCEPTION 'auditoria_de_persona_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER cost_centers_exige_auditoria_de_alta
AFTER INSERT ON cost_centers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION cost_centers_exige_auditoria_de_alta();

CREATE FUNCTION employees_exige_auditoria_de_alta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM audit_events
    WHERE company_id = NEW.company_id
      AND actor_id IS NOT NULL
      AND accion = 'alta_persona'
      AND entidad = 'employees'
      AND identificador = NEW.id
  ) THEN
    RAISE EXCEPTION 'auditoria_de_persona_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER employees_exige_auditoria_de_alta
AFTER INSERT ON employees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION employees_exige_auditoria_de_alta();

-- Una baja nueva necesita su propio evento en esta transacción. Un evento
-- viejo no alcanza: el xmin tiene que ser el de la transacción que cambia la fecha.
CREATE FUNCTION employees_exige_auditoria_de_baja()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.baja_en IS NOT DISTINCT FROM OLD.baja_en THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM audit_events
    WHERE company_id = NEW.company_id
      AND actor_id IS NOT NULL
      AND accion = 'baja_persona'
      AND entidad = 'employees'
      AND identificador = NEW.id
      AND xmin::text::bigint = txid_current() % 4294967296
  ) THEN
    RAISE EXCEPTION 'auditoria_de_persona_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER employees_exige_auditoria_de_baja
AFTER UPDATE OF baja_en ON employees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION employees_exige_auditoria_de_baja();
