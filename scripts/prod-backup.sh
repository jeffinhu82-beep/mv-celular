#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

env_value() { { sed -n "s/^$1=//p" .env 2>/dev/null || true; } | tail -n 1; }

remote="${BACKUP_REMOTE:-$(env_value BACKUP_REMOTE)}"
ping_url="${BACKUP_PING_URL:-$(env_value BACKUP_PING_URL)}"
if [ -z "$remote" ]; then
  echo "Defina BACKUP_REMOTE no .env (ex.: backup:mv-celular-backups)." >&2
  exit 1
fi

name="loja-$(TZ=America/Sao_Paulo date +%Y-%m-%d_%H%M%S)${1:+-$1}.dump"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$work/$name"
docker compose exec -T postgres pg_restore --list < "$work/$name" > /dev/null

mkdir "$work/uploads"
docker compose cp api:/app/apps/api/uploads/. "$work/uploads"

rclone copyto "$work/$name" "$remote/db/$name"
rclone copy "$work/uploads" "$remote/uploads"
rclone delete --min-age 30d "$remote/db"

if [ -n "$ping_url" ]; then
  curl -fsS -m 10 --retry 3 "$ping_url" > /dev/null
fi
echo "Backup enviado: $remote/db/$name"
