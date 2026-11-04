#!/bin/sh
# Postgres desechable para las cuatro pruebas que crean y borran una base.
# No lee DATABASE_URL ni AISLAMIENTO_DATABASE_URL del entorno: así no puede
# apuntar al libro de production ni al de preview. La contraseña es la del
# contenedor local, armada aquí para no dejar una URL completa en el archivo.
set -eu

cd "$(dirname "$0")/../.."

contenedor=ci-postgres

if docker inspect "$contenedor" >/dev/null 2>&1; then
  echo "Ya existe un contenedor $contenedor. La prueba no lo reutiliza." >&2
  exit 1
fi

docker run -d --rm --name "$contenedor" \
  -p 127.0.0.1:5432:5432 \
  -v "$PWD:/work:ro" \
  -e POSTGRES_PASSWORD=postgres \
  postgres:17 >/dev/null

trap 'docker rm -f "$contenedor" >/dev/null 2>&1 || true' EXIT

i=0
while [ "$i" -lt 120 ]; do
  if docker exec "$contenedor" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$i" -eq 120 ]; then
  echo "Postgres no aceptó conexiones en 120 segundos." >&2
  exit 1
fi

echo "Postgres desechable listo. Corren las cuatro pruebas que migran y borran su base."

export PATH="$PWD/scripts/ci/bin:$PATH"
usuario_local=postgres
clave_local=postgres
export AISLAMIENTO_DATABASE_URL="postgres://${usuario_local}:${clave_local}@127.0.0.1:5432/postgres"
unset DATABASE_URL

exec ./node_modules/.bin/tsx --test \
  tests/aislamiento/aislamiento.test.ts \
  tests/firmas/dos-firmas.test.ts \
  tests/proveedores/historial-clabe.test.ts \
  tests/proveedores/relectura-69b.test.ts
