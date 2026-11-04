-- Fase 3. Copia del listado del artículo 69-B que publica el SAT.
--
-- Es un archivo público, compartido por todas las empresas: no lleva
-- company_id. Cada carga es una copia nueva, con la fecha que declara el
-- archivo y la hora en que el servidor la guardó. La anterior no se pisa.
--
-- La fila guarda el RFC y la situación tal como vienen en el archivo.
-- La misma situación no se repite dentro de la copia. No hay proveedor,
-- CLABE, constancia ni dinero en esta migración.

SET search_path TO public;

CREATE TABLE lista_69b_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_archivo date NOT NULL,
  cargado_en timestamptz NOT NULL
);

COMMENT ON TABLE lista_69b_snapshots IS
  'Una carga del listado 69-B. Fecha del archivo y hora de carga. Sin company_id: el archivo es público.';

COMMENT ON COLUMN lista_69b_snapshots.fecha_archivo IS
  'Fecha que el archivo declara como información actualizada. No es la hora de carga.';

COMMENT ON COLUMN lista_69b_snapshots.cargado_en IS
  'Hora en que el servidor guardó esta copia.';

CREATE TABLE lista_69b_rows (
  snapshot_id uuid NOT NULL REFERENCES lista_69b_snapshots (id) ON DELETE RESTRICT,
  rfc text NOT NULL,
  situacion text NOT NULL,
  PRIMARY KEY (snapshot_id, rfc, situacion),
  CONSTRAINT lista_69b_rows_rfc_presente CHECK (char_length(rfc) BETWEEN 12 AND 13),
  CONSTRAINT lista_69b_rows_rfc_mayusculas CHECK (rfc = upper(rfc)),
  CONSTRAINT lista_69b_rows_situacion_presente CHECK (
    char_length(btrim(situacion)) BETWEEN 1 AND 120
  )
);

COMMENT ON TABLE lista_69b_rows IS
  'RFC y situación publicados en esa copia. La clave impide repetir la misma situación del mismo RFC.';

COMMENT ON COLUMN lista_69b_rows.situacion IS
  'Texto de la situación tal como viene en el archivo. No se traduce a otro catálogo.';

CREATE FUNCTION lista_69b_solo_insercion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'la lista 69-B solo acepta inserciones';
END;
$$;

CREATE TRIGGER lista_69b_snapshots_no_update
BEFORE UPDATE ON lista_69b_snapshots
FOR EACH ROW
EXECUTE FUNCTION lista_69b_solo_insercion();

CREATE TRIGGER lista_69b_snapshots_no_delete
BEFORE DELETE ON lista_69b_snapshots
FOR EACH ROW
EXECUTE FUNCTION lista_69b_solo_insercion();

CREATE TRIGGER lista_69b_snapshots_no_truncate
BEFORE TRUNCATE ON lista_69b_snapshots
FOR EACH STATEMENT
EXECUTE FUNCTION lista_69b_solo_insercion();

CREATE TRIGGER lista_69b_rows_no_update
BEFORE UPDATE ON lista_69b_rows
FOR EACH ROW
EXECUTE FUNCTION lista_69b_solo_insercion();

CREATE TRIGGER lista_69b_rows_no_delete
BEFORE DELETE ON lista_69b_rows
FOR EACH ROW
EXECUTE FUNCTION lista_69b_solo_insercion();

CREATE TRIGGER lista_69b_rows_no_truncate
BEFORE TRUNCATE ON lista_69b_rows
FOR EACH STATEMENT
EXECUTE FUNCTION lista_69b_solo_insercion();

REVOKE UPDATE, DELETE, TRUNCATE ON lista_69b_snapshots FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON lista_69b_rows FROM PUBLIC;
