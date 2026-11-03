-- Una persona, una empresa. La fase 2 puede sumar personas a la misma
-- empresa. No suma empresas a la misma persona. La primaria sigue siendo
-- el par (user_id, company_id). Esta única hace que un segundo RFC de la
-- misma cuenta falle en la base, aunque el insert no pase por el servicio.

SET search_path TO public;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_una_persona_una_empresa UNIQUE (user_id);

COMMENT ON CONSTRAINT memberships_una_persona_una_empresa ON memberships IS
  'Una persona, una empresa. Un segundo company_id para el mismo user_id no entra.';
