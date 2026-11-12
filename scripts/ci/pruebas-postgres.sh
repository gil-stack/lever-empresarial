#!/bin/sh
# Postgres desechable para las pruebas que crean y borran una base.
# No lee DATABASE_URL ni AISLAMIENTO_DATABASE_URL del entorno: así no puede
# apuntar al libro de production ni al de preview. La contraseña es la del
# contenedor local, armada aquí para no dejar una URL completa en el archivo.
set -eu

cd "$(dirname "$0")/../.."

# La parte (1 o 2) la elige el CI: test:db:1 y test:db:2 corren en máquinas distintas. Sin parte, las dos en serie
# (npm run test:db, para el laboratorio). El reparto vive en scripts/ci/pruebas-postgres.partes y
# tests/ci/partes-postgres.test.ts exige que cada prueba de Postgres esté en exactamente una parte.
parte="${PARTE_POSTGRES:-todas}"
case "$parte" in
  1 | 2) lista=$(awk -v p="$parte" '$1 == p { print $2 }' scripts/ci/pruebas-postgres.partes) ;;
  todas) lista=$(awk '$1 == "1" || $1 == "2" { print $2 }' scripts/ci/pruebas-postgres.partes) ;;
  *) echo "PARTE_POSTGRES debe ser 1 o 2 (o nada, para las dos)." >&2; exit 2 ;;
esac
if [ -z "$lista" ]; then
  echo "La parte $parte de test:db no tiene pruebas (scripts/ci/pruebas-postgres.partes)." >&2
  exit 1
fi

contenedor=ci-postgres

# Con reintentos: el registro a veces corta con EOF, y docker run la bajaría sin reintentar.
sh scripts/ci/descargar-imagen.sh postgres:17

if docker inspect "$contenedor" >/dev/null 2>&1; then
  docker rm -f "$contenedor" >/dev/null 2>&1 || true
fi

docker run -d --name "$contenedor" \
  -p 127.0.0.1:5432:5432 \
  -v "$PWD:/work:ro" \
  -e POSTGRES_PASSWORD=postgres \
  postgres:17 >/dev/null

limpiar() {
  docker rm -f "$contenedor" >/dev/null 2>&1 || true
}
trap limpiar EXIT

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

echo "Postgres desechable listo. Corren las pruebas que migran y borran su base."

export PATH="$PWD/scripts/ci/bin:$PATH"
usuario_local=postgres
clave_local=postgres
export AISLAMIENTO_DATABASE_URL="postgres://${usuario_local}:${clave_local}@127.0.0.1:5432/postgres"
unset DATABASE_URL

echo "test:db, parte $parte: $(echo "$lista" | wc -l | tr -d ' ') archivos."

# En serie: las pruebas alteran el mismo rol temporal y en paralelo chocan
# con «tuple concurrently updated».
set +e
# shellcheck disable=SC2086
./node_modules/.bin/tsx --test --test-concurrency=1 $lista
estado=$?
limpiar
trap - EXIT
exit "$estado"
