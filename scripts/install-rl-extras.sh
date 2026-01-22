#!/bin/sh
set -e

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
BACKEND_DIR="$ROOT_DIR/apps/portal-backend"

PYTHON="${RL_EXTRAS_PYTHON:-$BACKEND_DIR/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  echo "Target python not found at $PYTHON."
  exit 1
fi

echo "Installing optional RL environment extras into $PYTHON..."
"$PYTHON" -m pip install \
  "gymnasium[box2d]" \
  "gymnasium[mujoco]" \
  minigrid \
  "pettingzoo[butterfly]" \
  "pettingzoo[mpe]" \
  "pettingzoo[sisl]" \
  "pettingzoo[classic]"
