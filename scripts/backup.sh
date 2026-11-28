#!/bin/sh
set -e
cd "$(dirname "$0")/.."
[ -f .env ] && . ./.env
mkdir -p backups
FILE="backups/${POSTGRES_DB:-loja}-$(date +%Y%m%d-%H%M%S).sql"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-loja}" -d "${POSTGRES_DB:-loja}" --clean --if-exists > "$FILE"
echo "Backup salvo em $FILE"
