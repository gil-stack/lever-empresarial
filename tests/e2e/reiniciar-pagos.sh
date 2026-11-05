#!/bin/sh
# Solo Postgres local de pruebas. Borra y recrea la base de recorridos.
# E2E_ADMIN_URL: Postgres administrador (por omisión, el usuario del sistema
# en 127.0.0.1:55432). E2E_BASE_DATOS: nombre de la base (lever_pagos_dev).
set -eu

cd "$(dirname "$0")/../.."
URL=${E2E_ADMIN_URL:-postgres://$(id -un)@127.0.0.1:55432}
BASE=${E2E_BASE_DATOS:-lever_pagos_dev}

case "$BASE" in
  *[!a-z0-9_]*|"") echo "E2E_BASE_DATOS solo admite minúsculas, dígitos y guion bajo." >&2; exit 1 ;;
esac

psql "$URL/postgres" -X -q -v ON_ERROR_STOP=1 -c "drop database if exists $BASE" -c "create database $BASE"
for archivo in db/migrations/*.sql; do
  psql "$URL/$BASE" -X -q -v ON_ERROR_STOP=1 -f "$archivo" >/dev/null
done
psql "$URL/$BASE" -X -q -v ON_ERROR_STOP=1 \
  -c "alter role plataforma_app with login password 'aplicacion-local'; grant connect on database $BASE to plataforma_app;"
psql "$URL/$BASE" -X -q -v ON_ERROR_STOP=1 -f tests/e2e/seed-pagos.sql
