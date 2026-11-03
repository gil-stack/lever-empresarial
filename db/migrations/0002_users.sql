-- Fase 1. La persona que entra al alta: nombre, correo único y hash bcrypt.
-- La contraseña en claro no cabe en password_hash.

SET search_path TO public;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  correo text NOT NULL,
  password_hash text NOT NULL,
  CONSTRAINT users_correo_unico UNIQUE (correo),
  CONSTRAINT users_correo_formato CHECK (
    correo = btrim(correo)
    AND char_length(correo) BETWEEN 3 AND 320
    AND correo ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  CONSTRAINT users_nombre_presente CHECK (
    nombre = btrim(nombre)
    AND char_length(nombre) BETWEEN 1 AND 200
    AND nombre !~ '[[:cntrl:]]'
  ),
  CONSTRAINT users_password_hash_bcrypt CHECK (
    password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
  )
);

-- El UNIQUE de correo distingue mayúsculas. Este índice cierra el mismo correo
-- escrito con otra caja, que seguiría siendo la misma persona.
CREATE UNIQUE INDEX users_correo_minusculas_unico ON users (lower(correo));

COMMENT ON COLUMN users.correo IS
  'Correo único de la persona.';

COMMENT ON COLUMN users.password_hash IS
  'Hash bcrypt. La contraseña en claro no se guarda.';
