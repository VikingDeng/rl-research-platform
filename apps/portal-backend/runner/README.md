# RL Platform Runner

This directory contains the Docker context for the execution environment (Runner).

## Building the Image

```bash
./build.sh
```

This will build `rl-platform-runner:latest`.

## Configuration

In `apps/portal-backend/.env`, set:

```
DETERMINED_IMAGE=rl-platform-runner:latest
```

(If running locally with Docker Compose and Determined, ensure the image is available to the Determined agent).

## Contents

- `Dockerfile`: The image definition (PyTorch + Ray/RLlib).
- `runner_main.py`: The entrypoint script that the platform invokes.
- `algorithms/`: Built-in algorithms (simple_train, simple_eval).
- `requirements.txt`: Python dependencies.
