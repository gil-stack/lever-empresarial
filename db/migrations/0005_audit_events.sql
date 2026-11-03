-- Fase 1. Auditoría del alta. registrarEvento inserta aquí, dentro de la
-- misma transacción que crea la empresa. El evento de esa llamada es
-- companyId, actorId, accion alta_empresa, entidad companies, identificador
-- y ocurridoEn. No hay columna de cuerpo: no caben secretos ni PAN.
-- company_id puede ir vacío en un acto del operador. La fila solo se inserta.

SET search_path TO public;

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies (id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  accion text NOT NULL,
  entidad text NOT NULL,
  identificador uuid NOT NULL,
  ocurrido_en timestamptz NOT NULL,
  CONSTRAINT audit_events_accion_formato CHECK (
    accion ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT audit_events_entidad_formato CHECK (
    entidad ~ '^[a-z][a-z0-9_]{0,63}$'
  )
);

CREATE INDEX audit_events_company_id_idx ON audit_events (company_id, ocurrido_en);
CREATE INDEX audit_events_entidad_idx ON audit_events (entidad, identificador);

COMMENT ON TABLE audit_events IS
  'Solo inserción. El alta escribe accion alta_empresa. Sin cuerpo libre.';

COMMENT ON COLUMN audit_events.company_id IS
  'Empresa del acto. Vacío solo cuando el acto es del operador de la plataforma.';

COMMENT ON COLUMN audit_events.actor_id IS
  'Usuario que actúa. En el alta es el actorId de registrarEvento.';

COMMENT ON COLUMN audit_events.identificador IS
  'Id de la entidad. En el alta, el id de la empresa.';

COMMENT ON COLUMN audit_events.ocurrido_en IS
  'Hora del acto, la de ocurridoEn.';

CREATE FUNCTION audit_events_solo_insercion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events solo acepta inserciones';
END;
$$;

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_solo_insercion();

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_solo_insercion();

CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION audit_events_solo_insercion();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;

-- El alta y su auditoría se confirman juntas. Si la transacción cierra la
-- empresa sin el evento, no queda cuenta sin rastro.
CREATE FUNCTION companies_exige_auditoria_de_alta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM audit_events
    WHERE company_id = NEW.id
      AND actor_id IS NOT NULL
      AND accion = 'alta_empresa'
      AND entidad = 'companies'
      AND identificador = NEW.id
  ) THEN
    RAISE EXCEPTION 'el alta de la empresa exige registrarEvento en la misma transaccion';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER companies_exige_auditoria_de_alta
AFTER INSERT ON companies
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION companies_exige_auditoria_de_alta();
