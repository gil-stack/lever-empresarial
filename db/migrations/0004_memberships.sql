-- Fase 1. La persona queda en una cuenta con un rol.
-- La única (user_id, company_id) es la que usa el alta. El rol es texto:
-- administrador, solicitante, liberador, tarjetahabiente o contador.
-- El alta del fundador escribe administrador.

SET search_path TO public;

CREATE TABLE memberships (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  rol text NOT NULL,
  CONSTRAINT memberships_usuario_empresa_unicos PRIMARY KEY (user_id, company_id),
  CONSTRAINT memberships_rol_conocido CHECK (
    rol IN (
      'administrador',
      'solicitante',
      'liberador',
      'tarjetahabiente',
      'contador'
    )
  )
);

CREATE INDEX memberships_company_id_idx ON memberships (company_id);

COMMENT ON TABLE memberships IS
  'Une a la persona con una cuenta. El par (user_id, company_id) es único.';

COMMENT ON COLUMN memberships.rol IS
  'administrador, solicitante, liberador, tarjetahabiente o contador.';
