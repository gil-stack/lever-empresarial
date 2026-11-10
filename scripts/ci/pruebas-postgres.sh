#!/bin/sh
# Postgres desechable para las pruebas que crean y borran una base.
# No lee DATABASE_URL ni AISLAMIENTO_DATABASE_URL del entorno: así no puede
# apuntar al libro de production ni al de preview. La contraseña es la del
# contenedor local, armada aquí para no dejar una URL completa en el archivo.
set -eu

cd "$(dirname "$0")/../.."

contenedor=ci-postgres

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

# En serie: las pruebas alteran el mismo rol temporal y en paralelo chocan
# con «tuple concurrently updated».
./node_modules/.bin/tsx --test --test-concurrency=1 \
  tests/aislamiento/aislamiento.test.ts \
  tests/aislamiento/telefono.test.ts \
  tests/esquema/deriva.test.ts \
  tests/firmas/dos-firmas.test.ts \
  tests/proveedores/historial-clabe.test.ts \
  tests/proveedores/relectura-69b.test.ts \
  tests/proveedores/pagos-proveedores.test.ts \
  tests/autenticacion/postgres.test.ts \
  tests/autenticacion/seguridad-cuentas.test.ts \
  tests/autenticacion/recuperacion-factor-nuevo.test.ts \
  tests/autenticacion/enumeracion-tope.test.ts \
  tests/operacion/portal-postgres.test.ts \
  tests/personas/colaboradores-postgres.test.ts \
  tests/inicio/resumen-postgres.test.ts \
  tests/flujo/flujo-postgres.test.ts \
  tests/cobranza/cobranza-postgres.test.ts \
  tests/flujo/runway-postgres.test.ts \
  tests/flujo/runway-reglas-base.test.ts \
  tests/cobranza/reglas-base.test.ts \
  tests/esquema/empresa-suspendida.test.ts
estado=$?
limpiar
trap - EXIT
exit "$estado"
