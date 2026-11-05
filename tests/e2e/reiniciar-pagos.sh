#!/bin/sh
# Solo Postgres local de pruebas. Borra lever_pagos_dev en 127.0.0.1:55432.
set -eu

cd "$(dirname "$0")/../.."
URL=${E2E_ADMIN_URL:-postgres://gilbertovillarreal@127.0.0.1:55432}

dropdb --if-exists -h 127.0.0.1 -p 55432 lever_pagos_dev
createdb -h 127.0.0.1 -p 55432 lever_pagos_dev
for archivo in db/migrations/*.sql; do
  psql "$URL/lever_pagos_dev" -X -q -v ON_ERROR_STOP=1 -f "$archivo" >/dev/null
done
psql "$URL/lever_pagos_dev" -X -q -v ON_ERROR_STOP=1 \
  -c "alter role plataforma_app with login password 'aplicacion-local'; grant connect on database lever_pagos_dev to plataforma_app;"
psql "$URL/lever_pagos_dev" -X -q -v ON_ERROR_STOP=1 -f tests/e2e/seed-pagos.sql
