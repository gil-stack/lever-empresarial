-- Fase 2. Contrato de tablas de roles y de las dos firmas.
--
-- Esto no es una migración. db/migrate.sh solo lee db/migrations, y otro
-- frente escribe ese directorio. Quien migre copia este archivo a una
-- migración nueva, sin reescribir las de la fase 1.
--
-- memberships ya existe (0004 y 0006). Este frente no le agrega columnas
-- ni le cambia el CHECK del rol. Escribe tres de los roles que esa tabla
-- ya nombra:
--   administrador  administra la cuenta y puede soltar dinero
--   liberador      quien libera; puede soltar dinero
--   contador       entra a la póliza y no suelta dinero
-- solicitante y tarjetahabiente siguen siendo válidos en la base. Este
-- frente no los asigna.
--
-- La empresa no queda operable con una sola persona cuyo rol sea
-- administrador o liberador. En un lote de nómina de prueba las dos
-- firmas son dos usuarios distintos. No hay tercera firma.
--
-- No hay dinero. La fila no tiene monto, centavos, CLABE, estado de SPEI
-- ni costo. es_prueba tiene que ser verdadero: esta tabla no se convierte
-- en una dispersión.
--
-- El trigger usa EXECUTE FUNCTION, válido desde PostgreSQL 14. La base de
-- este producto es PostgreSQL 17.

SET search_path TO public;

CREATE TABLE lotes_prueba (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  solicitante_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  liberador_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  firmado_en timestamptz NOT NULL DEFAULT now(),
  es_prueba boolean NOT NULL DEFAULT true,
  CONSTRAINT lotes_prueba_dos_firmas CHECK (solicitante_user_id <> liberador_user_id),
  CONSTRAINT lotes_prueba_es_prueba CHECK (es_prueba)
);

CREATE INDEX lotes_prueba_company_id_idx ON lotes_prueba (company_id);

COMMENT ON TABLE lotes_prueba IS
  'Lote de nómina de prueba con dos firmas distintas. No guarda dinero ni se dispersa.';

COMMENT ON COLUMN lotes_prueba.solicitante_user_id IS
  'Quien solicita. Distinto de quien libera.';

COMMENT ON COLUMN lotes_prueba.liberador_user_id IS
  'Quien libera. Su membresía tiene que poder soltar dinero.';

COMMENT ON COLUMN lotes_prueba.es_prueba IS
  'Siempre verdadero. Un lote de esta tabla no es un pago.';

-- La base rechaza la fila aunque el insert no pase por el servicio.
-- El orden copia la decisión del servidor: mismas personas, dinero,
-- firmante de otra empresa, quien libera sin permiso, empresa con una
-- sola firma, y al final quien solicita si no puede pedir el lote.
CREATE FUNCTION lotes_prueba_revisar_firmas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rol_liberador text;
  rol_solicitante text;
  autorizados bigint;
BEGIN
  IF NEW.solicitante_user_id = NEW.liberador_user_id THEN
    RAISE EXCEPTION 'misma_persona_en_las_dos_firmas' USING ERRCODE = '23514';
  END IF;

  IF NEW.es_prueba IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'dinero_real_fuera' USING ERRCODE = '23514';
  END IF;

  SELECT rol INTO rol_liberador
  FROM memberships
  WHERE user_id = NEW.liberador_user_id
    AND company_id = NEW.company_id;

  SELECT rol INTO rol_solicitante
  FROM memberships
  WHERE user_id = NEW.solicitante_user_id
    AND company_id = NEW.company_id;

  IF rol_liberador IS NULL OR rol_solicitante IS NULL THEN
    RAISE EXCEPTION 'firmante_ajeno' USING ERRCODE = '23514';
  END IF;

  IF rol_liberador NOT IN ('administrador', 'liberador') THEN
    IF rol_liberador = 'contador' THEN
      RAISE EXCEPTION 'contador_no_libera' USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'sin_permiso_para_liberar' USING ERRCODE = '23514';
  END IF;

  SELECT count(DISTINCT user_id) INTO autorizados
  FROM memberships
  WHERE company_id = NEW.company_id
    AND rol IN ('administrador', 'liberador');

  IF autorizados < 2 THEN
    RAISE EXCEPTION 'empresa_no_operable' USING ERRCODE = '23514';
  END IF;

  IF rol_solicitante = 'contador' THEN
    RAISE EXCEPTION 'contador_no_crea_pago' USING ERRCODE = '23514';
  END IF;

  IF rol_solicitante NOT IN ('administrador', 'liberador', 'solicitante') THEN
    RAISE EXCEPTION 'sin_permiso_para_solicitar' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER lotes_prueba_firmas
  BEFORE INSERT OR UPDATE ON lotes_prueba
  FOR EACH ROW
  EXECUTE FUNCTION lotes_prueba_revisar_firmas();
