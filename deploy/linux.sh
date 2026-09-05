#!/usr/bin/env sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
command -v docker >/dev/null 2>&1 || { echo "Install Docker Engine and Docker Compose first." >&2; exit 1; }
docker compose version >/dev/null
case "${1:-start}" in
  start|update)
    [ -f .env ] || cp .env.example .env
    docker compose up -d --build --wait --wait-timeout 180
    echo "Lumen is ready. See .env for its listening address and port."
    ;;
  stop) docker compose down ;;
  status) docker compose ps ;;
  logs) docker compose logs --tail=100 -f ;;
  *) echo "Usage: sh deploy/linux.sh [start|update|stop|status|logs]" >&2; exit 2 ;;
esac
