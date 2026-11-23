-- Alta de clientes como recorrido guiado: quién será el primer administrador.
--
-- Al registrar el prospecto, Operación puede anotar a la persona que va a
-- administrar la empresa en Lever (nombre y correo). No da acceso a nada: la
-- invitación sigue saliendo solo cuando la empresa está activa, por el camino de
-- siempre (invitations), y este dato solo la llena de antemano. Los dos van juntos
-- o ninguno. El correo se guarda como lo normaliza el servidor (minúsculas).

SET search_path TO public;

ALTER TABLE companies
  ADD COLUMN contacto_nombre text,
  ADD COLUMN contacto_correo text;

ALTER TABLE companies
  ADD CONSTRAINT companies_contacto_juntos CHECK ((contacto_nombre IS NULL) = (contacto_correo IS NULL)),
  ADD CONSTRAINT companies_contacto_nombre CHECK (
    contacto_nombre IS NULL
    OR (char_length(contacto_nombre) BETWEEN 1 AND 200 AND contacto_nombre !~ '[[:cntrl:]]')
  ),
  ADD CONSTRAINT companies_contacto_correo CHECK (
    contacto_correo IS NULL
    OR (char_length(contacto_correo) BETWEEN 3 AND 254 AND contacto_correo = lower(contacto_correo) AND contacto_correo ~ '^[^@[:space:]]+@[^@[:space:]]+$')
  );

COMMENT ON COLUMN companies.contacto_nombre IS
  'Quien será el primer administrador, anotado en el alta. Solo llena la invitación; no da acceso.';
COMMENT ON COLUMN companies.contacto_correo IS
  'Correo del primer administrador anotado en el alta, en minúsculas. Solo llena la invitación.';
