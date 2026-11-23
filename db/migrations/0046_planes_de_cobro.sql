-- Planes de mensualidad y costo por SPEI.
--
-- El operador cobra a cada cliente una mensualidad según su plan (tres niveles) y un
-- costo por cada SPEI. Esto es configuración comercial y un cálculo para la pantalla
-- de Comisiones: no genera cargos ni mueve dinero.
--
-- * billing_plans: tres planes por operador (nivel 1, 2 y 3) con nombre, mensualidad y
--   costo por SPEI en centavos. Nacen con montos de ejemplo (de_ejemplo = true) para que
--   el operador los cambie; la primera edición los marca como propios.
-- * company_billing_plans: el plan de cada empresa. Una fila por empresa.
-- * spei_autorizados_por_empresa: cuántos pagos a proveedores quedaron autorizados para
--   pagar en un periodo, por empresa del operador. El personal no lee esas tablas del
--   cliente; esta función solo devuelve el conteo.
--
-- Si la empresa tiene una tarifa SPEI propia vigente (company_commissions, tipo spei),
-- la pantalla usa esa en lugar del costo del plan.
--
-- Aditiva: dos tablas con RLS, una función definer, un trigger que siembra los planes de
-- ejemplo de cada operador nuevo y la siembra de los operadores que ya existen.

SET search_path TO public;

CREATE TABLE billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  nivel smallint NOT NULL,
  nombre text NOT NULL,
  mensualidad_centavos bigint NOT NULL,
  spei_centavos bigint NOT NULL,
  de_ejemplo boolean NOT NULL DEFAULT true,
  actualizado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz,
  CONSTRAINT billing_plans_nivel CHECK (nivel BETWEEN 1 AND 3),
  CONSTRAINT billing_plans_un_nivel UNIQUE (operator_id, nivel),
  CONSTRAINT billing_plans_id_operador UNIQUE (id, operator_id),
  CONSTRAINT billing_plans_nombre CHECK (
    nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 60 AND nombre !~ '[[:cntrl:]]'
  ),
  CONSTRAINT billing_plans_mensualidad CHECK (mensualidad_centavos BETWEEN 0 AND 100000000000),
  CONSTRAINT billing_plans_spei CHECK (spei_centavos BETWEEN 0 AND 10000000),
  CONSTRAINT billing_plans_edicion CHECK (
    (de_ejemplo AND actualizado_por IS NULL AND actualizado_en IS NULL)
    OR (NOT de_ejemplo AND actualizado_por IS NOT NULL AND actualizado_en IS NOT NULL)
  )
);

COMMENT ON TABLE billing_plans IS
  'Tres planes por operador: mensualidad y costo por SPEI en centavos. Configuración, no cargos.';
COMMENT ON COLUMN billing_plans.de_ejemplo IS
  'true mientras conserva los montos de ejemplo de la siembra; la primera edición lo apaga.';

CREATE FUNCTION billing_plans_proteger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'plan_no_se_borra';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.nivel IS DISTINCT FROM OLD.nivel THEN
    RAISE EXCEPTION 'plan_no_cambia_de_nivel';
  END IF;
  IF NEW.de_ejemplo AND NOT OLD.de_ejemplo THEN
    RAISE EXCEPTION 'plan_no_vuelve_a_ejemplo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER billing_plans_antes_de_cambiar
BEFORE UPDATE OR DELETE ON billing_plans
FOR EACH ROW EXECUTE FUNCTION billing_plans_proteger();
CREATE TRIGGER billing_plans_no_truncate
BEFORE TRUNCATE ON billing_plans
FOR EACH STATEMENT EXECUTE FUNCTION billing_plans_proteger();

CREATE TABLE company_billing_plans (
  company_id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL,
  asignado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  asignado_en timestamptz NOT NULL,
  CONSTRAINT company_billing_plans_empresa
    FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT company_billing_plans_plan
    FOREIGN KEY (plan_id, operator_id) REFERENCES billing_plans (id, operator_id) ON DELETE RESTRICT
);

CREATE INDEX company_billing_plans_plan_idx ON company_billing_plans (plan_id);

COMMENT ON TABLE company_billing_plans IS
  'El plan de mensualidad de cada empresa. Cada cambio queda en audit_log (plan_asignado).';

CREATE FUNCTION company_billing_plans_proteger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'plan_de_empresa_no_se_borra';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.operator_id IS DISTINCT FROM OLD.operator_id THEN
    RAISE EXCEPTION 'plan_de_empresa_no_cambia_de_empresa';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_billing_plans_antes_de_cambiar
BEFORE UPDATE OR DELETE ON company_billing_plans
FOR EACH ROW EXECUTE FUNCTION company_billing_plans_proteger();
CREATE TRIGGER company_billing_plans_no_truncate
BEFORE TRUNCATE ON company_billing_plans
FOR EACH STATEMENT EXECUTE FUNCTION company_billing_plans_proteger();

-- Siembra de los planes de ejemplo ------------------------------------------------

CREATE FUNCTION billing_plans_sembrar(p_operador uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO billing_plans (operator_id, nivel, nombre, mensualidad_centavos, spei_centavos)
  VALUES
    (p_operador, 1, 'Básico', 150000, 800),
    (p_operador, 2, 'Empresarial', 350000, 600),
    (p_operador, 3, 'Corporativo', 750000, 400)
  ON CONFLICT (operator_id, nivel) DO NOTHING
$$;

REVOKE ALL ON FUNCTION billing_plans_sembrar(uuid) FROM PUBLIC;

CREATE FUNCTION operators_siembra_planes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM billing_plans_sembrar(NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER operators_siembra_planes
AFTER INSERT ON operators
FOR EACH ROW EXECUTE FUNCTION operators_siembra_planes();

SELECT billing_plans_sembrar(id) FROM operators;

-- SPEI autorizados por empresa -----------------------------------------------------

CREATE FUNCTION spei_autorizados_por_empresa(p_desde timestamptz, p_hasta timestamptz)
RETURNS TABLE (company_id uuid, spei bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.company_id, count(*)::bigint
  FROM supplier_payment_requests r
  JOIN companies c ON c.id = r.company_id
  WHERE app_operador() IS NOT NULL
    AND c.operator_id = app_operador()
    AND r.estado = 'listo_para_pagar'
    AND r.resuelto_en >= p_desde
    AND r.resuelto_en < p_hasta
  GROUP BY r.company_id
$$;

COMMENT ON FUNCTION spei_autorizados_por_empresa(timestamptz, timestamptz) IS
  'Conteo de pagos a proveedores autorizados (listo_para_pagar) en el periodo, por empresa del operador del contexto.';

REVOKE ALL ON FUNCTION spei_autorizados_por_empresa(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spei_autorizados_por_empresa(timestamptz, timestamptz) TO plataforma_sofipo;

-- RLS ------------------------------------------------------------------------------

ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE company_billing_plans FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_plans_sofipo ON billing_plans
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY company_billing_plans_sofipo ON company_billing_plans
  FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());

REVOKE ALL ON billing_plans, company_billing_plans FROM PUBLIC;
GRANT SELECT, UPDATE ON billing_plans TO plataforma_sofipo;
GRANT SELECT, INSERT, UPDATE ON company_billing_plans TO plataforma_sofipo;
