#!/bin/bash
# Imita scripts/ci/bin/psql en Vercel CI: psql corre en el contenedor con -w /work (la raíz del repo, en solo
# lectura), las rutas del anfitrión dentro del repo se reescriben y nada fuera del repo existe.
set -euo pipefail
raiz=$(cd "$(dirname "$0")/../../../.." && pwd)  # o la raíz del worktree si se copia fuera
real=${PSQL_REAL:-/opt/homebrew/opt/postgresql@17/bin/psql}
args=()
for arg in "$@"; do
  case "$arg" in
    "$raiz"/*) args+=("${arg#"$raiz"/}") ;;
    /*) echo "psql: error: $arg: No such file or directory (fuera del contenedor)" >&2; exit 1 ;;
    *) args+=("$arg") ;;
  esac
done
cd "$raiz"
if [ -t 0 ]; then exec "$real" "${args[@]}"; fi
guion=$(cat)
if grep -qE '^\\i /' <<<"$guion"; then echo "psql: error: \\i con ruta del anfitrión (fuera del contenedor)" >&2; exit 1; fi
exec "$real" "${args[@]}" <<<"$guion"
