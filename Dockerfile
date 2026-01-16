# === Stage 1: Build Frontend ===
FROM node:18-alpine AS frontend-builder

WORKDIR /frontend
# Copy frontend package files
COPY package.json package-lock.json ./
# Install deps
RUN npm ci
# Copy source code
COPY . .
# Build
RUN npm run build

# === Stage 2: Build Backend & Runtime ===
FROM python:3.9-slim

WORKDIR /app

# Install system dependencies (git is needed for research workflows)
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY apps/portal-backend/requirements.txt .
COPY apps/portal-backend/runner/requirements.txt ./runner-requirements.txt
# Install tensorboard and psycopg2 (needed for Postgres in Docker) explicitly
RUN pip install --no-cache-dir -r requirements.txt -r runner-requirements.txt tensorboard psycopg2-binary

# Copy Backend Code
COPY apps/portal-backend/app /app/app
COPY apps/portal-backend/runner /app/runner
COPY apps/portal-backend/alembic.ini /app/alembic.ini
# Copy Seed Script
COPY scripts/seed-full.sh /app/seed-full.sh

# Copy Frontend Build Artifacts from Stage 1
# We verify the path based on your project structure: root -> dist
COPY --from=frontend-builder /frontend/dist /app/portal-frontend/dist

# Set Envs
ENV PYTHONPATH=/app
ENV PORT=8000
# Tell Backend where to find the static files
# We modified main.py to look at ../portal-frontend/dist relative to app/main.py
# In container: /app/app/main.py -> parent is /app/app -> parent is /app.
# So /app/portal-frontend/dist is correct relative structure?
# main.py logic: Path(__file__).parent.parent -> /app/app/.. -> /app.
# then .parent -> / -> then /portal-frontend/dist. 
# Wait, main.py logic: BACKEND_ROOT = /app. FRONTEND_DIST = /app/../portal-frontend/dist = /portal-frontend/dist.
# So we should put dist at /portal-frontend/dist in the container root?
# Let's just adjust main.py to be robust or place it carefully.
# Placing at /app/portal-frontend/dist works if BACKEND_ROOT is /app.

# Create directory for runs
RUN mkdir -p /app/.local/runs

# Start Script
COPY apps/portal-backend/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose API and TensorBoard
EXPOSE 8000 6006

# Use entrypoint script to handle migrations and seeding
ENTRYPOINT ["/app/entrypoint.sh"]
