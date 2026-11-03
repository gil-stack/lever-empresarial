-- Política de comprobantes, categorías y cajones.
-- El default de la cuenta es cinco días y cinco comprobantes vencidos.
-- Esos dos números no son montos. El umbral de proveedores y el tope de
-- cada categoría nacen vacíos: la migración no escribe un centavo.
-- Los cuatro cajones se siembran por nombre. No hay columna de saldo.
-- El saldo es la suma de postings, y esta migración no inserta asientos.
-- No dispersa y no inventa una cuenta de dieciocho dígitos.

SET search_path TO public;

CREATE TABLE policies (
  company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,
  dias_comprobante integer NOT NULL DEFAULT 5,
  max_vencidos integer NOT NULL DEFAULT 5,
  umbral_proveedores_centavos bigint,
  CONSTRAINT policies_dias_comprobante CHECK (dias_comprobante BETWEEN 1 AND 365),
  CONSTRAINT policies_max_vencidos CHECK (max_vencidos BETWEEN 1 AND 365),
  CONSTRAINT policies_umbral_centavos CHECK (
    umbral_proveedores_centavos IS NULL OR umbral_proveedores_centavos >= 0
  )
);

COMMENT ON TABLE policies IS
  'Una política por empresa. Cinco días y cinco vencidos al nacer. El umbral nace vacío.';

COMMENT ON COLUMN policies.dias_comprobante IS
  'Días para pasar de todavía no a ya se pasó. Default 5. No es un monto.';

COMMENT ON COLUMN policies.max_vencidos IS
  'Comprobantes vencidos que pausan la tarjeta. Default 5. No es un monto.';

COMMENT ON COLUMN policies.umbral_proveedores_centavos IS
  'Centavos del umbral de proveedores. Vacío hasta que la empresa lo escribe. Sin default.';

CREATE TABLE policy_persons (
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  dias_comprobante integer NOT NULL,
  max_vencidos integer NOT NULL,
  CONSTRAINT policy_persons_pkey PRIMARY KEY (company_id, user_id),
  CONSTRAINT policy_persons_miembro
    FOREIGN KEY (user_id, company_id)
    REFERENCES memberships (user_id, company_id)
    ON DELETE RESTRICT,
  CONSTRAINT policy_persons_dias_comprobante CHECK (dias_comprobante BETWEEN 1 AND 365),
  CONSTRAINT policy_persons_max_vencidos CHECK (max_vencidos BETWEEN 1 AND 365)
);

COMMENT ON TABLE policy_persons IS
  'Plazo propio de una persona. Si no hay fila, usa el default de la empresa.';

CREATE TABLE policy_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  tope_centavos bigint,
  CONSTRAINT policy_categories_nombre_presente CHECK (
    nombre = btrim(nombre)
    AND char_length(nombre) BETWEEN 1 AND 80
    AND nombre !~ '[[:cntrl:]]'
  ),
  CONSTRAINT policy_categories_tope_centavos CHECK (
    tope_centavos IS NULL OR tope_centavos >= 0
  )
);

CREATE UNIQUE INDEX policy_categories_nombre_unico
  ON policy_categories (company_id, lower(nombre));

CREATE INDEX policy_categories_company_id_idx ON policy_categories (company_id);

COMMENT ON TABLE policy_categories IS
  'Categoría de la política. El tope nace vacío. Cero, si llega, es porque la empresa lo escribió.';

COMMENT ON COLUMN policy_categories.tope_centavos IS
  'Centavos del tope. NULL significa que la empresa todavía no lo escribe.';

CREATE TABLE drawers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  codigo text NOT NULL,
  nombre text NOT NULL,
  CONSTRAINT drawers_id_empresa UNIQUE (id, company_id),
  CONSTRAINT drawers_empresa_codigo UNIQUE (company_id, codigo),
  CONSTRAINT drawers_codigo_y_nombre CHECK (
    (codigo = 'viaticos' AND nombre = 'Viáticos')
    OR (codigo = 'proveedores' AND nombre = 'Proveedores')
    OR (codigo = 'impuestos' AND nombre = 'Impuestos')
    OR (codigo = 'nomina' AND nombre = 'Nómina')
  )
);

CREATE INDEX drawers_company_id_idx ON drawers (company_id);

COMMENT ON TABLE drawers IS
  'Viáticos, Proveedores, Impuestos y Nómina. No guardan saldo: el saldo es la suma de postings.';

CREATE TABLE postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  drawer_id uuid,
  centavos bigint NOT NULL,
  motivo text NOT NULL,
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT postings_cajon_de_la_empresa
    FOREIGN KEY (drawer_id, company_id)
    REFERENCES drawers (id, company_id)
    ON DELETE RESTRICT,
  CONSTRAINT postings_motivo_presente CHECK (
    motivo = btrim(motivo)
    AND char_length(motivo) BETWEEN 1 AND 200
    AND motivo !~ '[[:cntrl:]]'
  )
);

CREATE INDEX postings_company_drawer_idx ON postings (company_id, drawer_id);

COMMENT ON TABLE postings IS
  'Asientos en centavos con signo. drawer_id vacío es sin cajón. Esta migración no inserta filas.';

COMMENT ON COLUMN postings.centavos IS
  'Centavos de peso con signo. El saldo del cajón es la suma. No hay monto de ejemplo.';

COMMENT ON COLUMN postings.drawer_id IS
  'Cajón del asiento. Vacío significa sin cajón.';

-- Los asientos no se reescriben. Un ajuste es otro asiento, con el signo que corresponda.
CREATE FUNCTION postings_solo_insercion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'los asientos solo se insertan';
END;
$$;

CREATE TRIGGER postings_no_update
BEFORE UPDATE ON postings
FOR EACH ROW
EXECUTE FUNCTION postings_solo_insercion();

CREATE TRIGGER postings_no_delete
BEFORE DELETE ON postings
FOR EACH ROW
EXECUTE FUNCTION postings_solo_insercion();

CREATE TRIGGER postings_no_truncate
BEFORE TRUNCATE ON postings
FOR EACH STATEMENT
EXECUTE FUNCTION postings_solo_insercion();

REVOKE UPDATE, DELETE, TRUNCATE ON postings FROM PUBLIC;

-- La política acompaña a la empresa. Borrarla dejaría la cuenta sin default.
CREATE FUNCTION policies_no_se_borran()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'la política de la empresa no se borra';
END;
$$;

CREATE TRIGGER policies_no_delete
BEFORE DELETE ON policies
FOR EACH ROW
EXECUTE FUNCTION policies_no_se_borran();

CREATE TRIGGER policies_no_truncate
BEFORE TRUNCATE ON policies
FOR EACH STATEMENT
EXECUTE FUNCTION policies_no_se_borran();

-- El nombre y el código se siembran juntos y no se reescriben.
CREATE FUNCTION drawers_inamovibles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'los cuatro cajones no se borran';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.codigo IS DISTINCT FROM OLD.codigo
     OR NEW.nombre IS DISTINCT FROM OLD.nombre THEN
    RAISE EXCEPTION 'el cajón sembrado no se reescribe';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER drawers_no_update
BEFORE UPDATE ON drawers
FOR EACH ROW
EXECUTE FUNCTION drawers_inamovibles();

CREATE TRIGGER drawers_no_delete
BEFORE DELETE ON drawers
FOR EACH ROW
EXECUTE FUNCTION drawers_inamovibles();

CREATE FUNCTION companies_siembra_politica_y_cajones()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO policies (company_id) VALUES (NEW.id);
  INSERT INTO drawers (company_id, codigo, nombre) VALUES
    (NEW.id, 'viaticos', 'Viáticos'),
    (NEW.id, 'proveedores', 'Proveedores'),
    (NEW.id, 'impuestos', 'Impuestos'),
    (NEW.id, 'nomina', 'Nómina');
  RETURN NEW;
END;
$$;

CREATE FUNCTION companies_exige_politica_y_cajones()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM policies WHERE company_id = NEW.id) THEN
    RAISE EXCEPTION 'la empresa exige su política';
  END IF;
  IF (
    SELECT count(*)
    FROM drawers
    WHERE company_id = NEW.id
      AND (codigo, nombre) IN (
        ('viaticos', 'Viáticos'),
        ('proveedores', 'Proveedores'),
        ('impuestos', 'Impuestos'),
        ('nomina', 'Nómina')
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'la empresa exige los cuatro cajones';
  END IF;
  IF EXISTS (SELECT 1 FROM postings WHERE company_id = NEW.id) THEN
    RAISE EXCEPTION 'el alta no siembra asientos';
  END IF;
  RETURN NEW;
END;
$$;

-- El trigger queda antes de la siembra. Una empresa que entre después
-- de este punto ya nace con política y cajones. La pasada que cierra
-- las firmas cubre la que se hubiera confirmado en la ventana anterior.
CREATE TRIGGER companies_siembra_politica_y_cajones
AFTER INSERT ON companies
FOR EACH ROW
EXECUTE FUNCTION companies_siembra_politica_y_cajones();

CREATE CONSTRAINT TRIGGER companies_exige_politica_y_cajones
AFTER INSERT ON companies
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION companies_exige_politica_y_cajones();

-- Cuentas que ya existían antes de esta migración.
INSERT INTO policies (company_id)
SELECT id FROM companies
ON CONFLICT (company_id) DO NOTHING;

INSERT INTO drawers (company_id, codigo, nombre)
SELECT companies.id, semilla.codigo, semilla.nombre
FROM companies
CROSS JOIN (
  VALUES
    ('viaticos', 'Viáticos'),
    ('proveedores', 'Proveedores'),
    ('impuestos', 'Impuestos'),
    ('nomina', 'Nómina')
) AS semilla (codigo, nombre)
ON CONFLICT ON CONSTRAINT drawers_empresa_codigo DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM companies
    WHERE NOT EXISTS (
      SELECT 1 FROM policies WHERE policies.company_id = companies.id
    )
    OR (
      SELECT count(*)
      FROM drawers
      WHERE drawers.company_id = companies.id
    ) <> 4
  ) THEN
    RAISE EXCEPTION 'la siembra de política y cajones quedó incompleta';
  END IF;
END;
$$;
