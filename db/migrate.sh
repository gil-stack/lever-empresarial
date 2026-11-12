#!/usr/bin/env bash
# Aplica db/migrations en orden, en un comando explícito.
#
# El servidor no llama a este script al arrancar. El servidor solo lee
# DATABASE_URL (el connection string agrupado). Este comando lee
# DATABASE_URL_UNPOOLED, el string directo: host sin -pooler, base plataforma.
# No imprime el connection string. Si psql falla, la salida se redacta
# antes de mostrarse: el argumento del cliente puede citar la URL.

set -euo pipefail

redact() {
  sed -E 's#postgres(ql)?://[^[:space:]'\''"]+#***#g'
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/migrations"

if ! command -v psql >/dev/null 2>&1; then
  echo "Falta psql en el PATH." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Falta python3 en el PATH." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL_UNPOOLED:-}" ]]; then
  echo "Falta DATABASE_URL_UNPOOLED." >&2
  echo "Exporta el connection string directo de la base plataforma (host sin -pooler)." >&2
  echo "El servidor usa DATABASE_URL y no ejecuta este comando." >&2
  exit 1
fi

python3 - <<'PY'
import os
import sys
from urllib.parse import urlparse

raw = os.environ.get("DATABASE_URL_UNPOOLED", "")
parsed = urlparse(raw)
host = parsed.hostname or ""
query = parsed.query or ""
database = (parsed.path or "").lstrip("/").split("/")[0]

if parsed.scheme not in ("postgres", "postgresql") or host == "":
    print(
        "DATABASE_URL_UNPOOLED tiene que ser el connection string directo de Postgres.",
        file=sys.stderr,
    )
    sys.exit(1)

if "-pooler" in host or "pgbouncer=true" in query:
    print(
        "DATABASE_URL_UNPOOLED apunta al connection string agrupado. Las migraciones usan el directo, sin -pooler.",
        file=sys.stderr,
    )
    sys.exit(1)

if database != "plataforma":
    print(
        "DATABASE_URL_UNPOOLED tiene que apuntar a la base plataforma.",
        file=sys.stderr,
    )
    sys.exit(1)
PY

shopt -s nullglob
files=("${MIGRATIONS_DIR}"/*.sql)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No hay archivos en db/migrations." >&2
  exit 1
fi

# Sin mapfile ni arreglos asociativos: el bash 3.2 de macOS también tiene que correrlo.
sorted=()
while IFS= read -r file; do
  sorted+=("$file")
done < <(printf '%s\n' "${files[@]}" | LC_ALL=C sort)
for file in "${sorted[@]}"; do
  base="$(basename "$file")"
  if [[ ! "$base" =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]]; then
    echo "Nombre de migración inválido: ${base}" >&2
    exit 1
  fi
done

anterior_prefijo=""
anterior_base=""
for file in "${sorted[@]}"; do
  base="$(basename "$file")"
  prefijo="${base%%_*}"
  if [[ "$prefijo" == "$anterior_prefijo" ]]; then
    echo "Prefijo repetido ${prefijo}: ${anterior_base} y ${base}." >&2
    exit 1
  fi
  anterior_prefijo="$prefijo"
  anterior_base="$base"
done

runner="$(mktemp)"
psql_out="$(mktemp)"
psql_err="$(mktemp)"
cleanup() {
  rm -f "$runner" "$psql_out" "$psql_err"
}
trap cleanup EXIT

{
  printf '%s\n' "SET lock_timeout = '15s';"
  printf '%s\n' "SET client_min_messages TO warning;"
  printf '%s\n' "BEGIN;"
  printf '%s\n' "SELECT pg_advisory_xact_lock(814271) AS migracion_en_curso \\gset"
  printf '%s\n' "CREATE TABLE IF NOT EXISTS schema_migrations ("
  printf '%s\n' "  version text PRIMARY KEY,"
  printf '%s\n' "  applied_at timestamptz NOT NULL DEFAULT now()"
  printf '%s\n' ");"
  printf '%s\n' "COMMENT ON TABLE schema_migrations IS 'Control de db/migrate.sh. No es tabla de negocio.';"
  for file in "${sorted[@]}"; do
    version="$(basename "$file" .sql)"
    variable="applied_${version}"
    # Las 0022 históricas no crearon el historial que 0030 ya necesita.
    # Adelantar SOLO la reparación incremental en ese caso permite llegar
    # hasta HEAD sin repetir 0022 ni borrar marcas. Comparte transacción y
    # candado con el resto; al llegar a 0034 su marca impide repetirla.
    if [[ "$version" == "0030_pld_alertas_reportes" ]]; then
      cat <<EOF
SELECT to_regclass('public.supplier_payment_request_history') IS NULL
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0034_pagos_proveedores_hardening')
  AS reparar_pagos_antes_de_0030
\\gset
\\if :reparar_pagos_antes_de_0030
\\echo Aplicando 0034_pagos_proveedores_hardening (prerrequisito de 0030)
\\i ${MIGRATIONS_DIR}/0034_pagos_proveedores_hardening.sql
INSERT INTO schema_migrations (version) VALUES ('0034_pagos_proveedores_hardening');
\\endif
EOF
    fi
    cat <<EOF
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM schema_migrations WHERE version = '${version}'
) THEN 1 ELSE 0 END AS ${variable}
\\gset
\\if :${variable}
\\else
\\echo Aplicando ${version}
\\i ${file}
INSERT INTO schema_migrations (version) VALUES ('${version}');
\\endif
EOF
  done
  printf '%s\n' "COMMIT;"
} >"$runner"

set +e
psql "$DATABASE_URL_UNPOOLED" -X -q -v ON_ERROR_STOP=1 -f "$runner" >"$psql_out" 2>"$psql_err"
status=$?
set -e
redact <"$psql_out"
redact <"$psql_err" >&2
if [[ "$status" -ne 0 ]]; then
  exit "$status"
fi
echo "Listo."
