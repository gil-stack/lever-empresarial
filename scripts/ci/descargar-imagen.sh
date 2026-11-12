#!/bin/sh
# Descarga una imagen de docker con reintentos: hasta 5 intentos, con 5, 10, 20 y 40 s de espera entre ellos.
# El registro (mcr.microsoft.com) a veces corta la conexión con «EOF»; sin reintento, una parte entera del CI caía
# antes de correr una prueba (#66 y #71, 2026-11-12).
# Solo se reintenta lo pasajero (EOF, timeout, conexión cortada, 5xx, 429 toomanyrequests y fallas de DNS). Lo permanente (manifest unknown, not found,
# denied, unauthorized: una imagen que no existe o un permiso) falla al primer intento. Cada falla lleva el motivo
# que dio docker; si fallan los 5, sale con 1 y un mensaje que nombra la imagen y el último motivo.
# DESCARGA_ESPERAS cambia las esperas (las pruebas usan «0 0 0 0»).
set -u

imagen="${1:?uso: descargar-imagen.sh <imagen>}"
esperas="${DESCARGA_ESPERAS:-5 10 20 40}"
intentos=5
n=1
while :; do
  if motivo=$(docker pull -q "$imagen" 2>&1 >/dev/null); then
    if [ "$n" -gt 1 ]; then echo "[docker] $imagen descargada al intento $n de $intentos." >&2; fi
    exit 0
  fi
  motivo=$(printf '%s' "$motivo" | tr '\n' ' ' | cut -c1-300)
  if printf '%s' "$motivo" | grep -qiE 'manifest unknown|not found|denied|unauthorized'; then
    echo "No se pudo descargar la imagen $imagen: $motivo (no se reintenta)." >&2
    exit 1
  fi
  echo "[docker] $imagen: intento $n de $intentos falló: $motivo" >&2
  if ! printf '%s' "$motivo" | grep -qiE 'EOF|timeout|timed out|connection reset|TLS handshake|[^0-9]5[0-9][0-9][^0-9]|service unavailable|bad gateway|gateway time|toomanyrequests|[^0-9]429[^0-9]|no such host|temporary failure in name resolution'; then
    echo "No se pudo descargar la imagen $imagen: $motivo (no parece pasajero; no se reintenta)." >&2
    exit 1
  fi
  if [ "$n" -ge "$intentos" ]; then
    echo "No se pudo descargar la imagen $imagen después de $intentos intentos. Último motivo: $motivo" >&2
    exit 1
  fi
  espera=$(echo "$esperas" | awk -v i="$n" '{ print $i }')
  sleep "${espera:-40}"
  n=$((n + 1))
done
