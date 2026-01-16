#!/bin/sh
set -e

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script targets macOS."
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
exec "$SCRIPT_DIR/dev-local-up.sh"
