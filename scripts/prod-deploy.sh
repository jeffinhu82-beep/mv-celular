#!/usr/bin/env bash
set -euo pipefail

env_value() { { sed -n "s/^$1=//p" .env 2>/dev/null || true; } | tail -n 1; }

main() {
  cd "$(dirname "$0")/.."
  git pull --ff-only
  if [ -n "$(docker compose ps -q postgres)" ]; then
    if [ -n "${BACKUP_REMOTE:-$(env_value BACKUP_REMOTE)}" ]; then
      ./scripts/prod-backup.sh pre-deploy
    else
      echo "AVISO: BACKUP_REMOTE vazio no .env. Atualizando sem backup antes." >&2
    fi
  fi
  docker compose pull --ignore-buildable --quiet
  docker compose up -d --build --wait --remove-orphans
  docker image prune -f > /dev/null
  docker builder prune -f --filter until=168h > /dev/null
  docker compose ps
}

main "$@"
