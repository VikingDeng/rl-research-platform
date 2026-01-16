#!/bin/sh
set -e

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
exec "$ROOT_DIR/scripts/dev-mac-up.sh"
