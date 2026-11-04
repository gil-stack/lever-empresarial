-- Fase 3. Alta de proveedor: RFC, razón social y constancia.
-- El par (empresa, RFC) es único: otro nombre comercial no abre otra ficha.
-- Si el RFC está en el archivo 69-B, o si ese archivo no está cargado,
-- boton_pago queda en falso. Esta migración no crea un SPEI ni una orden de pago.
--
-- La lista pública vive en 0013_lista_69b.sql. El historial de la CLABE
-- vive en 0014_clabes_proveedor.sql. Esas dos piezas nacieron las dos
-- como 0012; aquí quedan en orden y no se pierde ninguna tabla.
-- snapshot_id se enlaza en 0014, cuando el listado ya existe.
-- La constancia es un documents. La clave no es una URL.

SET search_path TO public;

CREATE TABLE documents (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  clave_blob text NOT NULL,
  hash_sha256 text NOT NULL,
  tipo text NOT NULL,
  nombre_original text NOT NULL,
  creado_en timestamptz NOT NULL,
  CONSTRAINT documents_clave_privada CHECK (
    clave_blob = btrim(clave_blob)
    AND char_length(clave_blob) BETWEEN 8 AND 200
    AND clave_blob !~* '^https?://'
    AND clave_blob !~* 'blob\.vercel'
  ),
  CONSTRAINT documents_hash_sha256 CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT documents_tipo_presente CHECK (
    tipo = btrim(tipo)
    AND char_length(tipo) BETWEEN 3 AND 120
    AND tipo !~ '[[:cntrl:]]'
  ),
  CONSTRAINT documents_nombre_presente CHECK (
    nombre_original = btrim(nombre_original)
    AND char_length(nombre_original) BETWEEN 1 AND 180
    AND nombre_original !~ '[[:cntrl:]]'
    AND nombre_original !~ '[/\\]'
  )
);

CREATE INDEX documents_company_id_idx ON documents (company_id);

COMMENT ON TABLE documents IS
  'Metadato de un archivo privado. Los bytes no viven aquí. Esta fase solo escribe la constancia del proveedor.';

COMMENT ON COLUMN documents.clave_blob IS
  'Ruta interna del almacén. No es una URL y no se entrega al navegador.';

CREATE TABLE suppliers (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES documents (id) ON DELETE RESTRICT,
  snapshot_id uuid,
  rfc text NOT NULL,
  razon_social text NOT NULL,
  situacion_69b text,
  lista_fecha date,
  lista_leida_en timestamptz NOT NULL,
  boton_pago boolean NOT NULL,
  alta_en timestamptz NOT NULL,
  CONSTRAINT suppliers_rfc_por_empresa UNIQUE (company_id, rfc),
  CONSTRAINT suppliers_rfc_patron CHECK (
    char_length(rfc) IN (12, 13)
    AND (
      rfc ~ '^[A-Z&Ñ]{3}[0-9]{2}(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[0-9A]$'
      OR rfc ~ '^[A-Z&Ñ]{4}[0-9]{2}(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[0-9A]$'
    )
  ),
  CONSTRAINT suppliers_razon_social_presente CHECK (
    razon_social = btrim(razon_social)
    AND char_length(razon_social) BETWEEN 1 AND 254
    AND razon_social !~ '[[:cntrl:]]'
  ),
  CONSTRAINT suppliers_situacion_presente CHECK (
    situacion_69b IS NULL
    OR (
      situacion_69b = btrim(situacion_69b)
      AND char_length(situacion_69b) BETWEEN 1 AND 400
      AND situacion_69b !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT suppliers_lectura_con_fecha CHECK (
    (snapshot_id IS NULL AND lista_fecha IS NULL)
    OR (snapshot_id IS NOT NULL AND lista_fecha IS NOT NULL)
  ),
  CONSTRAINT suppliers_pago_solo_fuera_de_lista CHECK (
    boton_pago IS FALSE
    OR (snapshot_id IS NOT NULL AND situacion_69b IS NULL)
  )
);

CREATE INDEX suppliers_company_id_idx ON suppliers (company_id);

COMMENT ON TABLE suppliers IS
  'Proveedor de una empresa. El RFC manda. boton_pago en falso no ofrece pago.';

COMMENT ON COLUMN suppliers.boton_pago IS
  'Verdadero solo si había archivo 69-B y el RFC no aparecía. Esta fase no envía el pago.';

COMMENT ON COLUMN suppliers.snapshot_id IS
  'Copia del listado usada en el alta. El enlace a lista_69b_snapshots se agrega en 0014.';

CREATE FUNCTION suppliers_constancia_de_la_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM documents
    WHERE id = NEW.document_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'constancia_ajena';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER suppliers_constancia_de_la_empresa
BEFORE INSERT OR UPDATE OF document_id, company_id ON suppliers
FOR EACH ROW
EXECUTE FUNCTION suppliers_constancia_de_la_empresa();

CREATE FUNCTION suppliers_rfc_fijo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.rfc IS DISTINCT FROM OLD.rfc
    OR NEW.document_id IS DISTINCT FROM OLD.document_id
  THEN
    RAISE EXCEPTION 'rfc_de_proveedor_fijo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER suppliers_rfc_fijo
BEFORE UPDATE ON suppliers
FOR EACH ROW
EXECUTE FUNCTION suppliers_rfc_fijo();

CREATE FUNCTION suppliers_exige_auditoria_de_alta()
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
      AND accion = 'alta_proveedor'
      AND entidad = 'suppliers'
      AND identificador = NEW.id
  ) THEN
    RAISE EXCEPTION 'auditoria_de_proveedor_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER suppliers_exige_auditoria_de_alta
AFTER INSERT ON suppliers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION suppliers_exige_auditoria_de_alta();
