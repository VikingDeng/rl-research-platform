FROM pytorch/pytorch:2.1.2-cuda11.8-cudnn8-runtime

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy runner scripts
COPY runner_main.py /app/runner_main.py

# Copy default algorithms and envs
# We assume the context is apps/portal-backend/runner, so we need to copy these in from the parent if we run docker build from root,
# or we just structure the files to be here.
# For simplicity, we'll assume we COPY them in via the build command or they are pre-staged.
# But since I'm creating the file structure now, I'll create a dummy folder.

COPY algorithms /app/algorithms
COPY envs /app/envs

ENV PYTHONPATH=/app

ENTRYPOINT ["python", "/app/runner_main.py"]

