#!/bin/sh
# Recorridos de navegador (Playwright) contra `next start`, con Postgres
# desechable y el emulador de Blob. Corre igual en Vercel CI y en local.
#
# - Con E2E_ADMIN_URL usa ese Postgres desechable y el Chromium local de
#   Playwright (modo local).
# - Sin E2E_ADMIN_URL levanta postgres:17 y el navegador en contenedores
#   (modo CI). La imagen de Vercel CI no trae las bibliotecas de Chromium; la
#   guía de Vercel CI corre el navegador dentro de la imagen oficial de
#   Playwright de la misma versión. Aquí solo el navegador vive ahí
#   (`playwright run-server`); el corredor, la siembra, el emulador de Blob y
#   `next start` siguen en la máquina de la tarea.
#
# No lee DATABASE_URL ni ningún secreto: no puede apuntar a Neon. Los
# argumentos se pasan a `playwright test` (por ejemplo, un spec).
set -eu

cd "$(dirname "$0")/../.."

inicio=$(date +%s)
marca() {
  echo "[e2e] $1 · $(( $(date +%s) - inicio )) s"
}

export E2E_PUERTO="${E2E_PUERTO:-3153}"
export E2E_BLOB_PUERTO="${E2E_BLOB_PUERTO:-4896}"
puerto_pg=5553
puerto_navegador=4813
pg=ci-postgres
navegador=ci-navegador
contenedores=""

limpiar() {
  if [ -n "$contenedores" ]; then
    # shellcheck disable=SC2086
    docker rm -f $contenedores >/dev/null 2>&1 || true
  fi
}
trap limpiar EXIT

esperar() {
  # $1 descripción, $2 comando que devuelve 0 cuando está listo.
  i=0
  while [ "$i" -lt 180 ]; do
    if sh -c "$2" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "$1 no estuvo listo en 180 segundos." >&2
  exit 1
}

if [ -z "${E2E_ADMIN_URL:-}" ]; then
  version=$(node -p 'require("@playwright/test/package.json").version')
  imagen="mcr.microsoft.com/playwright:v${version}-noble"
  # La descarga del navegador corre mientras compila Next.
  docker pull -q "$imagen" >/dev/null &
  descarga=$!

  docker rm -f "$pg" "$navegador" >/dev/null 2>&1 || true
  contenedores="$pg $navegador"
  docker run -d --name "$pg" \
    -p "127.0.0.1:${puerto_pg}:5432" \
    -v "$PWD:/work:ro" \
    -e POSTGRES_PASSWORD=postgres \
    postgres:17 >/dev/null
  usuario_local=postgres
  clave_local=postgres
  export E2E_ADMIN_URL="postgres://${usuario_local}:${clave_local}@127.0.0.1:${puerto_pg}/postgres"
  # psql de la siembra: el del contenedor (la imagen de Vercel CI no lo trae).
  export PATH="$PWD/scripts/ci/bin:$PATH"
  modo=ci
else
  modo=local
fi
unset DATABASE_URL

marca "compilando Next con las acciones de servidor de la prueba"
E2E_SERVER_ACTIONS=1 ./node_modules/.bin/next build >/dev/null
marca "compilado"

if [ "$modo" = ci ]; then
  wait "$descarga"
  marca "imagen del navegador lista ($imagen)"
  # Red del anfitrión: el navegador abre http://localhost:$E2E_PUERTO como en local.
  docker run -d --name "$navegador" \
    --network host --init --ipc=host --user pwuser \
    -v "$PWD:$PWD:ro" -w "$PWD" \
    "$imagen" \
    ./node_modules/.bin/playwright run-server --port "$puerto_navegador" --host 127.0.0.1 >/dev/null
  esperar "Postgres" "docker exec $pg pg_isready -h 127.0.0.1 -U postgres"
  esperar "El navegador" "node -e \"require('net').connect($puerto_navegador, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))\""
  export PW_TEST_CONNECT_WS_ENDPOINT="ws://127.0.0.1:${puerto_navegador}/"
  marca "Postgres y navegador listos"
fi

set +e
./node_modules/.bin/playwright test "$@"
estado=$?
set -e
marca "recorridos terminados con estado $estado"

if [ "$estado" -ne 0 ]; then
  # Vercel CI no guarda archivos de una tarea que falla: la evidencia va a la salida.
  echo "[e2e] ===== Contexto de cada falla (árbol accesible de la página) ====="
  find test-results/e2e -name error-context.md -print -exec cat {} \; 2>/dev/null || true
  echo "[e2e] ===== Últimas líneas del servidor ====="
  tail -n 80 test-results/next-e2e.log 2>/dev/null || true
  echo "[e2e] ===== Capturas de las primeras fallas (base64 de PNG: pégalo en un archivo y usa base64 -d) ====="
  find test-results/e2e -name 'test-failed-*.png' 2>/dev/null | head -n 2 | while read -r captura; do
    echo "[e2e] captura: $captura"
    base64 < "$captura" | tr -d '\n'
    echo
  done
fi

exit "$estado"
