#!/usr/bin/env bash
#
# Despliegue. El servidor trae el codigo de GitHub por su cuenta: este script
# solo dispara el proceso, asi que podes correrlo desde cualquier maquina o
# entrar por SSH y ejecutar `~/apps/flashcards/actualizar.sh` a mano.
#
# Uso: ./deploy.sh [usuario@host] [ruta remota] [rama]
set -euo pipefail

HOST="${1:-matthewsdjr@100.118.186.97}"
DIR="${2:-apps/flashcards}"
RAMA="${3:-main}"
REPO="https://github.com/matthewsdjr/flashcards.git"

echo "Desplegando ${RAMA} en ${HOST}:~/${DIR}"

ssh "${HOST}" bash -se <<REMOTO
set -euo pipefail
DIR="\$HOME/${DIR}"

if [ ! -d "\$DIR/.git" ]; then
  # Puede quedar el directorio del despliegue anterior por rsync: se aparta
  # en lugar de borrarlo, por si guardaba algo que no esta en el repo.
  if [ -d "\$DIR" ]; then
    RESPALDO="\$DIR.anterior-\$(date +%Y%m%d%H%M%S)"
    echo "Apartando el directorio anterior en \$RESPALDO"
    mv "\$DIR" "\$RESPALDO"
  fi
  echo "Clonando el repositorio"
  mkdir -p "\$(dirname "\$DIR")"
  git clone --branch "${RAMA}" "${REPO}" "\$DIR"
else
  echo "Trayendo los ultimos cambios"
  git -C "\$DIR" fetch --quiet origin "${RAMA}"
  git -C "\$DIR" checkout --quiet "${RAMA}"
  # reset --hard: el servidor es un espejo del repo, nunca se edita ahi.
  git -C "\$DIR" reset --hard --quiet "origin/${RAMA}"
fi

echo "Version desplegada: \$(git -C "\$DIR" log --oneline -1)"

cd "\$DIR"
docker compose up -d --build

echo "Esperando a que el contenedor este sano"
for i in \$(seq 1 60); do
  estado=\$(docker inspect -f '{{.State.Health.Status}}' flashcards 2>/dev/null || echo desconocido)
  if [ "\$estado" = healthy ]; then
    echo "Contenedor sano"
    exit 0
  fi
  if [ "\$estado" = unhealthy ]; then
    echo "El contenedor quedo unhealthy"
    docker compose logs --tail 40 flashcards
    exit 1
  fi
  sleep 2
done

echo "El contenedor no llego a estado healthy a tiempo"
docker compose logs --tail 40 flashcards
exit 1
REMOTO

echo "Listo. La app responde en el puerto 8080 del servidor."
