#!/usr/bin/env bash
# Publica la app en el servidor propio: sincroniza el repo y reconstruye el contenedor.
# Uso: ./deploy.sh [usuario@host] [ruta remota]
set -euo pipefail

HOST="${1:-matthewsdjr@100.118.186.97}"
DIR="${2:-~/apps/flashcards}"

# rsync no crea la ruta destino si faltan directorios intermedios.
ssh "${HOST}" "mkdir -p ${DIR}"

echo "Sincronizando codigo hacia ${HOST}:${DIR}"
# Se excluye lo que se regenera en el servidor o no aporta a la imagen.
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git \
  --exclude shots --exclude '*.log' \
  ./ "${HOST}:${DIR}/"

echo "Reconstruyendo el contenedor"
ssh "${HOST}" "cd ${DIR} && docker compose up -d --build"

echo "Esperando a que responda"
ssh "${HOST}" "for i in \$(seq 1 30); do
  if [ \"\$(docker inspect -f '{{.State.Health.Status}}' flashcards 2>/dev/null)\" = healthy ]; then
    echo 'Contenedor sano'; exit 0
  fi
  sleep 2
done
echo 'El contenedor no llego a estado healthy'; docker compose -f ${DIR}/docker-compose.yml logs --tail 30; exit 1"

echo "Listo. La app responde en el puerto 8080 del servidor."
