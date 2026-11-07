-- Recuperación del segundo factor con la app vieja todavía vigente.
--
-- Con una recuperación aprobada, la persona inscribe una app nueva mientras la
-- confirmada vieja sigue viva: la vieja se revoca en la misma transacción que
-- confirma la nueva. El índice de 0019 admitía una sola fila vigente por
-- persona, así que la app pendiente no cabía junto a la confirmada.
--
-- Sigue habiendo a lo más una app confirmada vigente por persona, y la base
-- obliga a revocar la vieja antes de confirmar la nueva. No toca datos.

DROP INDEX auth_totp_uno_vigente;

CREATE UNIQUE INDEX auth_totp_uno_confirmado ON auth_totp (user_id)
  WHERE revocado_en IS NULL AND confirmado_en IS NOT NULL;

CREATE UNIQUE INDEX auth_totp_uno_pendiente ON auth_totp (user_id)
  WHERE revocado_en IS NULL AND confirmado_en IS NULL;
