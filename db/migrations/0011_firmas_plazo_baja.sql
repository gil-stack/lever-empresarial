-- Cierra las reglas de la fase 2 que el lote y la pantalla decían distinto.
--
-- Quien suelta dinero es solo el liberador vigente. El administrador no
-- cuenta como segunda firma. Dos firmas son dos usuarios y dos actos:
-- la solicitud no trae liberador; la liberación lo escribe después.
-- El CHECK de uuid rechaza el mismo usuario en las dos columnas.
--
-- La baja efectiva quita el rol de liberador. Un alta que ya trae fecha
-- de baja exige el evento baja_persona.
--
-- El plazo propio se escribe sobre la persona del maestro, aunque no
-- entre a la consola.
--
-- Al final se siembra otra vez política, cajones y suscripción para la
-- empresa que hubiera entrado entre el alta de esas tablas y su trigger.

SET search_path TO public;

ALTER TABLE employees
  ADD CONSTRAINT employees_id_empresa UNIQUE (id, company_id);

-- El plazo deja de exigir un login. La persona del maestro basta.
ALTER TABLE policy_persons ADD COLUMN employee_id uuid;

UPDATE policy_persons AS plazo
SET employee_id = empleado.id
FROM employees AS empleado
WHERE empleado.user_id = plazo.user_id
  AND empleado.company_id = plazo.company_id;

DELETE FROM policy_persons WHERE employee_id IS NULL;

ALTER TABLE policy_persons DROP CONSTRAINT policy_persons_miembro;
ALTER TABLE policy_persons DROP CONSTRAINT policy_persons_pkey;
ALTER TABLE policy_persons DROP COLUMN user_id;
ALTER TABLE policy_persons ALTER COLUMN employee_id SET NOT NULL;
ALTER TABLE policy_persons
  ADD CONSTRAINT policy_persons_pkey PRIMARY KEY (company_id, employee_id);
ALTER TABLE policy_persons
  ADD CONSTRAINT policy_persons_empleado
  FOREIGN KEY (employee_id, company_id)
  REFERENCES employees (id, company_id)
  ON DELETE RESTRICT;

COMMENT ON TABLE policy_persons IS
  'Plazo propio de una persona del maestro, aunque no entre a la consola. Sin fila, usa el plazo de la empresa.';

CREATE TABLE lotes_prueba (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  solicitante_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  solicitado_en timestamptz NOT NULL,
  liberador_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  liberado_en timestamptz,
  es_prueba boolean NOT NULL DEFAULT true,
  CONSTRAINT lotes_prueba_dos_firmas CHECK (
    liberador_user_id IS NULL OR solicitante_user_id <> liberador_user_id
  ),
  CONSTRAINT lotes_prueba_actos CHECK (
    (liberador_user_id IS NULL AND liberado_en IS NULL)
    OR (liberador_user_id IS NOT NULL AND liberado_en IS NOT NULL)
  ),
  CONSTRAINT lotes_prueba_es_prueba CHECK (es_prueba)
);

CREATE INDEX lotes_prueba_company_id_idx ON lotes_prueba (company_id);

COMMENT ON TABLE lotes_prueba IS
  'Lote de nómina de prueba. Dos usuarios, dos actos. No guarda dinero ni se dispersa.';

COMMENT ON COLUMN lotes_prueba.solicitante_user_id IS
  'Quien solicita, en su propio acto. Distinto de quien libera.';

COMMENT ON COLUMN lotes_prueba.liberador_user_id IS
  'Quien libera, en un acto posterior. Solo el rol liberador. Vacío hasta esa firma.';

COMMENT ON COLUMN lotes_prueba.es_prueba IS
  'Siempre verdadero. Un lote de esta tabla no es un pago.';

CREATE FUNCTION lotes_prueba_revisar_firmas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rol_liberador text;
  rol_solicitante text;
  autorizados bigint;
  hoy date := (timezone('America/Mexico_City', clock_timestamp()))::date;
BEGIN
  IF NEW.es_prueba IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'dinero_real_fuera' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.liberador_user_id IS NOT NULL OR NEW.liberado_en IS NOT NULL THEN
      RAISE EXCEPTION 'firma_en_un_solo_acto' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.liberador_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'lote_ya_firmado' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.solicitante_user_id IS DISTINCT FROM OLD.solicitante_user_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.solicitado_en IS DISTINCT FROM OLD.solicitado_en
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'entrada_invalida' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.liberador_user_id IS NULL OR NEW.liberado_en IS NULL THEN
      RAISE EXCEPTION 'entrada_invalida' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.solicitante_user_id = NEW.liberador_user_id THEN
      RAISE EXCEPTION 'misma_persona_en_las_dos_firmas' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT rol INTO rol_solicitante
  FROM memberships
  WHERE user_id = NEW.solicitante_user_id
    AND company_id = NEW.company_id;

  IF rol_solicitante IS NULL THEN
    RAISE EXCEPTION 'firmante_ajeno' USING ERRCODE = 'P0001';
  END IF;

  IF rol_solicitante = 'contador' THEN
    RAISE EXCEPTION 'contador_no_crea_pago' USING ERRCODE = 'P0001';
  END IF;

  IF rol_solicitante NOT IN ('administrador', 'liberador', 'solicitante') THEN
    RAISE EXCEPTION 'sin_permiso_para_solicitar' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM employees
    WHERE user_id = NEW.solicitante_user_id
      AND company_id = NEW.company_id
      AND baja_en IS NOT NULL
      AND baja_en <= hoy
  ) THEN
    RAISE EXCEPTION 'sin_permiso_para_solicitar' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(DISTINCT membresia.user_id) INTO autorizados
  FROM memberships AS membresia
  LEFT JOIN employees AS empleado
    ON empleado.user_id = membresia.user_id
   AND empleado.company_id = membresia.company_id
  WHERE membresia.company_id = NEW.company_id
    AND membresia.rol = 'liberador'
    AND (
      empleado.id IS NULL
      OR empleado.baja_en IS NULL
      OR empleado.baja_en > hoy
    );

  IF autorizados < 2 THEN
    RAISE EXCEPTION 'empresa_no_operable' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT rol INTO rol_liberador
  FROM memberships
  WHERE user_id = NEW.liberador_user_id
    AND company_id = NEW.company_id;

  IF rol_liberador IS NULL THEN
    RAISE EXCEPTION 'firmante_ajeno' USING ERRCODE = 'P0001';
  END IF;

  IF rol_liberador = 'contador' THEN
    RAISE EXCEPTION 'contador_no_libera' USING ERRCODE = 'P0001';
  END IF;

  IF rol_liberador <> 'liberador' THEN
    RAISE EXCEPTION 'sin_permiso_para_liberar' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM employees
    WHERE user_id = NEW.liberador_user_id
      AND company_id = NEW.company_id
      AND baja_en IS NOT NULL
      AND baja_en <= hoy
  ) THEN
    RAISE EXCEPTION 'sin_permiso_para_liberar' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER lotes_prueba_firmas
  BEFORE INSERT OR UPDATE ON lotes_prueba
  FOR EACH ROW
  EXECUTE FUNCTION lotes_prueba_revisar_firmas();

-- La baja escrita en el alta también deja rastro. El update ya lo exigía.
CREATE OR REPLACE FUNCTION employees_exige_auditoria_de_baja()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.baja_en IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.baja_en IS NOT DISTINCT FROM OLD.baja_en THEN
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

CREATE CONSTRAINT TRIGGER employees_exige_auditoria_de_baja_en_alta
AFTER INSERT ON employees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION employees_exige_auditoria_de_baja();

-- El día de la baja, quien liberaba deja de tener ese rol.
CREATE FUNCTION employees_quita_liberador()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.baja_en IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date THEN
    RETURN NEW;
  END IF;
  UPDATE memberships
  SET rol = 'tarjetahabiente'
  WHERE user_id = NEW.user_id
    AND company_id = NEW.company_id
    AND rol = 'liberador';
  RETURN NEW;
END;
$$;

CREATE TRIGGER employees_quita_liberador
AFTER INSERT OR UPDATE OF baja_en ON employees
FOR EACH ROW
EXECUTE FUNCTION employees_quita_liberador();

-- Segunda pasada, por si una empresa se confirmó antes de que el trigger
-- de su migración estuviera visible.
INSERT INTO policies (company_id)
SELECT empresa.id
FROM companies AS empresa
WHERE NOT EXISTS (
  SELECT 1 FROM policies AS politica WHERE politica.company_id = empresa.id
);

INSERT INTO drawers (company_id, codigo, nombre)
SELECT empresa.id, semilla.codigo, semilla.nombre
FROM companies AS empresa
CROSS JOIN (
  VALUES
    ('viaticos', 'Viáticos'),
    ('proveedores', 'Proveedores'),
    ('impuestos', 'Impuestos'),
    ('nomina', 'Nómina')
) AS semilla (codigo, nombre)
WHERE NOT EXISTS (
  SELECT 1
  FROM drawers AS cajon
  WHERE cajon.company_id = empresa.id
    AND cajon.codigo = semilla.codigo
);

INSERT INTO subscriptions (company_id, estado, recorrido_inicio)
SELECT empresa.id, 'recorrido', empresa.alta_at
FROM companies AS empresa
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions AS suscripcion WHERE suscripcion.company_id = empresa.id
);
