#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

env_value() { { sed -n "s/^$1=//p" .env 2>/dev/null || true; } | tail -n 1; }

remote="${BACKUP_REMOTE:-$(env_value BACKUP_REMOTE)}"
if [ -z "$remote" ]; then
  echo "Defina BACKUP_REMOTE no .env." >&2
  exit 1
fi

target="${1:-}"
if [ -z "$target" ]; then
  echo "Backups disponíveis (o mais novo por último):"
  rclone lsf "$remote/db" | sort
  echo
  echo "Uso: $0 <arquivo.dump | latest>"
  echo "latest pega o mais novo que não seja -pre-restore; para desfazer uma restauração, passe o arquivo -pre-restore."
  exit 0
fi
if [ "$target" = latest ]; then
  target="$(rclone lsf "$remote/db" | { grep -v -- '-pre-restore\.dump$' || true; } | sort | tail -n 1)"
fi
if [ -z "$target" ]; then
  echo "Nenhum backup em $remote/db." >&2
  exit 1
fi

if [ "${2:-}" != "--yes" ]; then
  echo "O banco atual vai ser trocado pelo backup $target."
  echo "Antes, o estado atual vai para o bucket e fica guardado no servidor como <banco>_previous."
  read -r -p "Digite RESTAURAR para continuar: " answer
  if [ "$answer" != RESTAURAR ]; then
    echo "Cancelado."
    exit 1
  fi
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

rclone copyto "$remote/db/$target" "$work/restore.dump"
docker compose exec -T postgres pg_restore --list < "$work/restore.dump" > /dev/null

./scripts/prod-backup.sh pre-restore

docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "${POSTGRES_DB}_restore" && createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "${POSTGRES_DB}_restore"'
if ! docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" --no-owner --exit-on-error' < "$work/restore.dump"; then
  echo "A restauração falhou. O banco atual não foi alterado." >&2
  exit 1
fi

docker compose stop api
if ! docker compose exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -v db="$POSTGRES_DB" -v previous="${POSTGRES_DB}_previous" -v restore="${POSTGRES_DB}_restore"' > /dev/null <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS :"previous";
BEGIN;
ALTER DATABASE :"db" RENAME TO :"previous";
ALTER DATABASE :"restore" RENAME TO :"db";
COMMIT;
SQL
then
  docker compose up -d --wait --no-build api
  echo "Não consegui trocar os bancos. A API voltou com o banco atual." >&2
  exit 1
fi
docker compose up -d --wait --no-build api

if [ -n "$(rclone lsf "$remote/uploads" 2>/dev/null | head -n 1)" ]; then
  mkdir "$work/uploads"
  rclone copy "$remote/uploads" "$work/uploads"
  docker compose cp "$work/uploads/." api:/app/apps/api/uploads
fi

echo "Restaurado: $target. O banco de antes ficou no servidor como <banco>_previous até a próxima restauração."
