-- Fase 1. Sesión mínima para el alta: a qué persona pertenece, el hash del
-- token y cuándo vence. La cookie no se guarda; el servidor guarda el SHA-256
-- en hexadecimal.

SET search_path TO public;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT sessions_token_hash_unico UNIQUE (token_hash),
  CONSTRAINT sessions_token_hash_sha256 CHECK (
    token_hash ~ '^[0-9a-fA-F]{64}$'
  )
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

COMMENT ON TABLE sessions IS
  'Lo mínimo para sostener el alta. Pertenece al usuario. No guarda el token.';

COMMENT ON COLUMN sessions.token_hash IS
  'SHA-256 en hexadecimal del token de la cookie. Nunca el token.';
