#!/usr/bin/env sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
command -v docker >/dev/null 2>&1 || { echo "Install Docker Engine and Docker Compose first." >&2; exit 1; }
docker compose version >/dev/null
case "${1:-start}" in
  start|update)
    [ -f .env ] || cp .env.example .env
    # Add deployment-owned secrets once. Existing non-empty values are preserved.
    for key in POSTGRES_PASSWORD LUMEN_CREDENTIAL_KEY LUMEN_SETUP_TOKEN; do
      if ! grep -Eq "^${key}=.+" .env; then
        value=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
        if [ "$key" = LUMEN_CREDENTIAL_KEY ]; then
          value=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
        fi
        sed "/^${key}=/d" .env > .env.next
        printf '%s=%s\n' "$key" "$value" >> .env.next
        mv .env.next .env
      fi
    done
    docker compose up -d --build --wait --wait-timeout 180
    echo "Lumen is ready. Open /admin over HTTPS and use LUMEN_SETUP_TOKEN from .env."
    ;;
  stop) docker compose down ;;
  status) docker compose ps ;;
  logs) docker compose logs --tail=100 -f ;;
  *) echo "Usage: sh deploy/linux.sh [start|update|stop|status|logs]" >&2; exit 2 ;;
esac
