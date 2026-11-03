#!/usr/bin/env bash
# Crea la rama Neon "preview", hija de "main", en el proyecto de esta plataforma.
#
# main es el libro de production. preview tiene su propio cómputo: lo que una
# vista previa migra o escribe no cae en el libro del que después sale un SPEI.
# Este script no imprime connection strings ni los copia al repositorio.

set -euo pipefail

PROJECT_ID="royal-heart-90586962"
PARENT_BRANCH="main"
BRANCH_NAME="preview"

redact() {
  sed -E 's#postgres(ql)?://[^[:space:]]+#***#g'
}

if ! command -v neon >/dev/null 2>&1; then
  echo "Falta el CLI de Neon. La instalación está en https://neon.com/docs/reference/neon-cli" >&2
  echo "Después autentica con neon auth, fuera de este repositorio." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Falta python3 en el PATH." >&2
  exit 1
fi

list_json="$(mktemp)"
list_err="$(mktemp)"
create_out="$(mktemp)"
create_err="$(mktemp)"
cleanup() {
  rm -f "$list_json" "$list_err" "$create_out" "$create_err"
}
trap cleanup EXIT

if ! neon branches list --project-id "$PROJECT_ID" --output json >"$list_json" 2>"$list_err"; then
  redact <"$list_err" >&2
  exit 1
fi

exists="$(python3 - "$list_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    raw = handle.read().strip()
data = json.loads(raw) if raw else []
if isinstance(data, dict):
    branches = data.get("branches") or data.get("data") or []
else:
    branches = data
names = {branch.get("name") for branch in branches if isinstance(branch, dict)}
print("yes" if "preview" in names else "no")
PY
)"

if [[ "$exists" == "yes" ]]; then
  echo "La rama preview ya existe, hija del libro de production. No se creó otra."
  echo "En Vercel, el entorno preview usa los connection strings de esa rama."
  echo "Production sigue en la rama main. Esos valores no van en el repositorio."
  exit 0
fi

if ! neon branches create \
  --project-id "$PROJECT_ID" \
  --name "$BRANCH_NAME" \
  --parent "$PARENT_BRANCH" \
  >"$create_out" \
  2>"$create_err"; then
  if grep -qiE 'already exists|duplicate' "$create_err" "$create_out"; then
    echo "La rama preview ya existe. No se creó otra."
    exit 0
  fi
  redact <"$create_err" >&2
  exit 1
fi

echo "Lista la rama Neon preview, hija de main, en el proyecto ${PROJECT_ID}."
echo "Tiene su propio cómputo. No comparte el libro de la rama main."
echo "Siguiente paso, en Vercel y solo en el entorno preview:"
echo "  DATABASE_URL apunta al string agrupado de la rama preview."
echo "  DATABASE_URL_UNPOOLED apunta al string directo de la rama preview, base plataforma."
echo "Production conserva los strings de la rama main."
echo "No pegues esos strings en el repositorio ni en los logs."
echo "Después corre ./db/migrate.sh con DATABASE_URL_UNPOOLED de la rama que quieras migrar."
