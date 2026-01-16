#!/bin/sh
set -e

if [ "$(uname -s)" != "Linux" ]; then
  echo "This script targets Linux."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "Docker Compose is required."
  exit 1
fi

$COMPOSE down
