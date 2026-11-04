-- Fase 3, correcciones. No crea un envío ni una orden de pago.
-- Una CLABE no puede colgar del proveedor de otra empresa.
-- Cerrar la única vigente no deja la ficha sin CLABE.
-- Una copia nueva del 69-B vuelve a leer a los proveedores ya guardados.
-- Quien se dio de alta sin archivo sigue sin pago si el RFC no entra.
-- Si el RFC entra, la situación se escribe y boton_pago queda en falso.

SET search_path TO public;

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_id_empresa UNIQUE (id, company_id);

ALTER TABLE supplier_clabes
  ADD CONSTRAINT supplier_clabes_proveedor_empresa
  FOREIGN KEY (supplier_id, company_id)
  REFERENCES suppliers (id, company_id);

CREATE FUNCTION supplier_clabes_misma_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM suppliers
    WHERE id = NEW.supplier_id
      AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'clabe_de_otra_empresa';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_clabes_misma_empresa
BEFORE INSERT OR UPDATE OF supplier_id, company_id ON supplier_clabes
FOR EACH ROW
EXECUTE FUNCTION supplier_clabes_misma_empresa();

-- Cerrar la vigente solo pasa si en la misma transacción queda otra abierta.
CREATE FUNCTION supplier_clabes_conserva_vigente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.vigente_hasta IS NULL AND NEW.vigente_hasta IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM supplier_clabes
      WHERE supplier_id = NEW.supplier_id
        AND company_id = NEW.company_id
        AND vigente_hasta IS NULL
    ) THEN
      RAISE EXCEPTION 'proveedor_sin_clabe';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER supplier_clabes_conserva_vigente
AFTER UPDATE OF vigente_hasta ON supplier_clabes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION supplier_clabes_conserva_vigente();

CREATE FUNCTION documents_no_se_reescribe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.clave_blob IS DISTINCT FROM OLD.clave_blob
    OR NEW.hash_sha256 IS DISTINCT FROM OLD.hash_sha256
  THEN
    RAISE EXCEPTION 'constancia_no_se_reescribe';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_no_se_reescribe
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE FUNCTION documents_no_se_reescribe();

CREATE OR REPLACE FUNCTION suppliers_exige_auditoria_de_alta()
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
      AND xmin::text::bigint = txid_current() % 4294967296
  ) THEN
    RAISE EXCEPTION 'auditoria_de_proveedor_ausente';
  END IF;
  RETURN NEW;
END;
$$;

-- boton_pago verdadero solo si el RFC no está en la copia que la ficha señala,
-- y la fecha es la de esa copia. La situación, si existe, es la publicada.
CREATE FUNCTION suppliers_lectura_contra_copia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  fecha date;
  publicada text;
BEGIN
  IF NEW.snapshot_id IS NULL THEN
    IF NEW.boton_pago IS TRUE OR NEW.situacion_69b IS NOT NULL OR NEW.lista_fecha IS NOT NULL THEN
      RAISE EXCEPTION 'lectura_sin_copia';
    END IF;
    RETURN NEW;
  END IF;

  SELECT s.fecha_archivo
  INTO fecha
  FROM lista_69b_snapshots AS s
  WHERE s.id = NEW.snapshot_id;

  IF fecha IS NULL OR fecha IS DISTINCT FROM NEW.lista_fecha THEN
    RAISE EXCEPTION 'fecha_de_lista_distinta';
  END IF;

  SELECT string_agg(r.situacion, ' · ' ORDER BY r.situacion)
  INTO publicada
  FROM lista_69b_rows AS r
  WHERE r.snapshot_id = NEW.snapshot_id
    AND r.rfc = NEW.rfc;

  IF publicada IS NOT NULL THEN
    IF NEW.boton_pago IS TRUE THEN
      RAISE EXCEPTION 'pago_con_rfc_publicado';
    END IF;
    IF NEW.situacion_69b IS DISTINCT FROM publicada THEN
      RAISE EXCEPTION 'situacion_distinta_de_la_copia';
    END IF;
  ELSIF NEW.situacion_69b IS NOT NULL THEN
    RAISE EXCEPTION 'situacion_distinta_de_la_copia';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER suppliers_lectura_contra_copia
BEFORE INSERT OR UPDATE OF snapshot_id, lista_fecha, situacion_69b, boton_pago, rfc
ON suppliers
FOR EACH ROW
EXECUTE FUNCTION suppliers_lectura_contra_copia();

CREATE FUNCTION releer_proveedores_69b(copia uuid, leida timestamptz)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  fecha date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lista_69b_rows WHERE snapshot_id = copia) THEN
    RAISE EXCEPTION 'copia_69b_sin_filas';
  END IF;

  SELECT s.fecha_archivo
  INTO fecha
  FROM lista_69b_snapshots AS s
  WHERE s.id = copia;

  IF fecha IS NULL THEN
    RAISE EXCEPTION 'copia_69b_ausente';
  END IF;

  -- El RFC que entra deja de estar fuera de la lista y el pago sigue apagado.
  UPDATE suppliers AS s
  SET snapshot_id = copia,
      lista_fecha = fecha,
      situacion_69b = pub.situacion,
      lista_leida_en = leida,
      boton_pago = false
  FROM (
    SELECT r.rfc, string_agg(r.situacion, ' · ' ORDER BY r.situacion) AS situacion
    FROM lista_69b_rows AS r
    WHERE r.snapshot_id = copia
    GROUP BY r.rfc
  ) AS pub
  WHERE s.rfc = pub.rfc;

  -- Quien ya tenía archivo y no aparece en esta copia queda fuera, con la fecha nueva.
  -- Quien nunca tuvo archivo no entra aquí: la falta de archivo no abre el pago.
  UPDATE suppliers AS s
  SET snapshot_id = copia,
      lista_fecha = fecha,
      situacion_69b = NULL,
      lista_leida_en = leida,
      boton_pago = true
  WHERE s.snapshot_id IS NOT NULL
    AND s.snapshot_id IS DISTINCT FROM copia
    AND NOT EXISTS (
      SELECT 1
      FROM lista_69b_rows AS r
      WHERE r.snapshot_id = copia
        AND r.rfc = s.rfc
    );
END;
$$;

CREATE FUNCTION lista_69b_relee_al_cerrar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM releer_proveedores_69b(NEW.id, NEW.cargado_en);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER lista_69b_relee_proveedores
AFTER INSERT ON lista_69b_snapshots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lista_69b_relee_al_cerrar();

COMMENT ON FUNCTION releer_proveedores_69b(uuid, timestamptz) IS
  'Una copia nueva vuelve a leer a los proveedores. Si el RFC entra, no hay pago. Sin archivo previo, el pago no se abre.';

COMMENT ON COLUMN suppliers.snapshot_id IS
  'Copia del listado contra la que se leyó al proveedor. Una copia nueva vuelve a leer a quien ya estaba.';
