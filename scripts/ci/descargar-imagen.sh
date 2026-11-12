#!/bin/sh
# Descarga una imagen de docker con reintentos: hasta 5 intentos, con 5, 10, 20 y 40 s de espera entre ellos.
# El registro (mcr.microsoft.com) a veces corta la conexión con «EOF»; sin reintento, una parte entera del CI caía
# antes de correr una prueba (#66 y #71, 2026-11-12). Cada intento fallido se registra en stderr; si fallan los 5,
# sale con 1 y un mensaje que nombra la imagen. DESCARGA_ESPERAS cambia las esperas (las pruebas usan «0 0 0 0»).
set -u

imagen="${1:?uso: descargar-imagen.sh <imagen>}"
esperas="${DESCARGA_ESPERAS:-5 10 20 40}"
intentos=5
n=1
while :; do
  if docker pull -q "$imagen" >/dev/null 2>&1; then
    if [ "$n" -gt 1 ]; then echo "[docker] $imagen descargada al intento $n de $intentos." >&2; fi
    exit 0
  fi
  echo "[docker] $imagen: intento $n de $intentos falló." >&2
  if [ "$n" -ge "$intentos" ]; then
    echo "No se pudo descargar la imagen $imagen después de $intentos intentos." >&2
    exit 1
  fi
  espera=$(echo "$esperas" | awk -v i="$n" '{ print $i }')
  sleep "${espera:-40}"
  n=$((n + 1))
done
