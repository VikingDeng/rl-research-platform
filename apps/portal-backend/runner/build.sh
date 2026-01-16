#!/bin/bash
set -e

TAG="rl-platform-runner:latest"

echo "Building runner image: $TAG"
docker build -t $TAG .

echo "Build complete."
echo "To use this image in local dev, set DETERMINED_IMAGE=$TAG in your .env file."
