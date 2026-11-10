#!/bin/sh
# Ronda r63. Corre una prueba contra cada mutación de la 0031 (MU1-MU19 del revisor y AR1-AR6, las reversiones de
# los arreglos de base) y restaura la 0031 al salir. Necesita AISLAMIENTO_DATABASE_URL (Postgres desechable, UTF-8).
# Uso, desde la raíz: sh scripts/evidencia/cobranza/mutaciones.sh tests/cobranza/reglas-base.test.ts MU1 … AR6
set -u
S=$(cd "$(dirname "$0")" && pwd)
cd "$S/../../.."
F=db/migrations/0031_cobranza.sql
PRUEBA=$1; shift
ORIG=$(mktemp); cp "$F" "$ORIG"
restaurar() { cp "$ORIG" "$F"; rm -f "$ORIG"; }
trap restaurar EXIT INT TERM
for M in "$@"; do
  cp "$ORIG" "$F"
  if ! python3 "$S/mutar-0031.py" "$F" "$M"; then echo "$M · no aplicada"; continue; fi
  SALIDA=$(node_modules/.bin/tsx --test --test-concurrency=1 "$PRUEBA" 2>&1)
  if printf '%s' "$SALIDA" | grep -q "^ℹ fail 0"; then
    echo "$M · PASA (sobrevive)"
  else
    echo "$M · FALLA (la atrapa) · $(printf '%s' "$SALIDA" | grep -E "AssertionError" | head -1 | sed 's/^ *//' | cut -c1-200)"
  fi
done
