#!/bin/sh
# Ronda r63. Revierte cada arreglo por separado (revertir-arreglo.py), corre su prueba y restaura con git checkout.
# El árbol debe estar limpio. Necesita AISLAMIENTO_DATABASE_URL para las pruebas de Postgres.
# Uso, desde la raíz: sh scripts/evidencia/cobranza/rojo-por-arreglo.sh N2:src/dominio/cobranza/cobranza.test.ts N10:tests/cobranza/cobranza-postgres.test.ts …
set -u
S=$(cd "$(dirname "$0")" && pwd)
W=$(cd "$S/../../.." && pwd)
cd "$W"
if [ -n "$(git status --porcelain)" ]; then echo "El árbol no está limpio." >&2; exit 1; fi
restaurar() { git checkout -q -- . ; }
trap restaurar EXIT INT TERM
for par in "$@"; do
  ID=${par%%:*}; PRUEBAS=$(printf '%s' "${par#*:}" | tr ',' ' ')
  restaurar
  if ! python3 "$S/revertir-arreglo.py" "$W" "$ID"; then echo "$ID · reversión NO aplicada"; continue; fi
  # shellcheck disable=SC2086
  SALIDA=$(node_modules/.bin/tsx --test --test-concurrency=1 $PRUEBAS 2>&1)
  if printf '%s' "$SALIDA" | grep -q "^ℹ fail 0"; then
    echo "$ID · su prueba PASA con el arreglo revertido (no lo protege) · $PRUEBAS"
  else
    echo "$ID · ROJO · $(printf '%s' "$SALIDA" | grep -E "^ *✖ " | grep -v "failing tests" | head -1 | sed 's/^ *//' | cut -c1-140)"
  fi
done
restaurar
