-- Fase 3. Historial de la CLABE del proveedor.
-- Esta pieza nació como 0012_clabes_proveedor.sql. Se numera 0014 para
-- correr después de la ficha (0012) y del listado 69-B (0013).
-- supplier_clabes se crea aquí, una sola vez. Cambiar la CLABE agrega
-- una fila. La anterior no se reescribe ni se borra.
-- El dígito sigue la función de la fase 2 (ponderación 3, 7 y 1).
-- El nombre del banco no se guarda. No hay envío de dinero.

SET search_path TO public;

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_snapshot_id_fkey
  FOREIGN KEY (snapshot_id) REFERENCES lista_69b_snapshots (id) ON DELETE RESTRICT;

CREATE TABLE supplier_clabes (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
  clabe text NOT NULL,
  digito_valido boolean NOT NULL,
  vigente_desde timestamptz NOT NULL,
  vigente_hasta timestamptz,
  CONSTRAINT supplier_clabes_clabe_validada CHECK (
    clabe ~ '^[0-9]{18}$'
    AND digito_valido IS TRUE
    AND clabe_digito_371(clabe)
  ),
  CONSTRAINT supplier_clabes_vigencia_orden CHECK (
    vigente_hasta IS NULL OR vigente_hasta >= vigente_desde
  )
);

CREATE UNIQUE INDEX supplier_clabes_una_vigente
  ON supplier_clabes (company_id, supplier_id)
  WHERE vigente_hasta IS NULL;

CREATE INDEX supplier_clabes_company_id_idx ON supplier_clabes (company_id);

CREATE INDEX supplier_clabes_supplier_id_idx ON supplier_clabes (company_id, supplier_id);

COMMENT ON TABLE supplier_clabes IS
  'Historial de la CLABE de un proveedor. Cada cambio es una fila nueva. No se envía dinero.';

COMMENT ON COLUMN supplier_clabes.supplier_id IS
  'Proveedor de esta empresa. La fila no se borra cuando la CLABE deja de estar vigente.';

COMMENT ON COLUMN supplier_clabes.clabe IS
  '18 dígitos completos. El dígito ya cerró con la ponderación 3, 7 y 1. No se enmascara y no se reescribe.';

COMMENT ON COLUMN supplier_clabes.vigente_hasta IS
  'Vacío mientras esta CLABE es la vigente. Al cambiar, se llena y la fila se queda.';

-- Cerrar la vigencia es el único cambio. Los dígitos no se pisan.
CREATE FUNCTION supplier_clabes_solo_cierra()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
    OR NEW.clabe IS DISTINCT FROM OLD.clabe
    OR NEW.digito_valido IS DISTINCT FROM OLD.digito_valido
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
  THEN
    RAISE EXCEPTION 'clabe_no_se_pisa';
  END IF;

  IF OLD.vigente_hasta IS NOT NULL THEN
    RAISE EXCEPTION 'clabe_ya_cerrada';
  END IF;

  IF NEW.vigente_hasta IS NULL THEN
    RAISE EXCEPTION 'clabe_no_se_pisa';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_clabes_solo_cierra
BEFORE UPDATE ON supplier_clabes
FOR EACH ROW
EXECUTE FUNCTION supplier_clabes_solo_cierra();

CREATE FUNCTION supplier_clabes_no_borra()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'historial_de_clabe_no_se_borra';
END;
$$;

CREATE TRIGGER supplier_clabes_no_borra
BEFORE DELETE ON supplier_clabes
FOR EACH ROW
EXECUTE FUNCTION supplier_clabes_no_borra();

-- Una CLABE nueva necesita su evento en esta transacción. Un evento viejo no alcanza.
CREATE FUNCTION supplier_clabes_exige_auditoria()
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
      AND accion = 'clabe_proveedor'
      AND entidad = 'supplier_clabes'
      AND identificador = NEW.id
      AND xmin::text::bigint = txid_current() % 4294967296
  ) THEN
    RAISE EXCEPTION 'auditoria_de_clabe_ausente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER supplier_clabes_exige_auditoria
AFTER INSERT ON supplier_clabes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION supplier_clabes_exige_auditoria();

-- La ficha no queda sin CLABE vigente. El alta inserta las dos en la misma transacción.
CREATE FUNCTION suppliers_exige_clabe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM supplier_clabes
    WHERE supplier_id = NEW.id
      AND company_id = NEW.company_id
      AND vigente_hasta IS NULL
  ) THEN
    RAISE EXCEPTION 'proveedor_sin_clabe';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER suppliers_exige_clabe
AFTER INSERT ON suppliers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION suppliers_exige_clabe();
