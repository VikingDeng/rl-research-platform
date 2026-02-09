# === Stage 1: Build Frontend ===
FROM node:20-alpine AS frontend-builder

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# === Stage 2: Build Backend Runtime ===
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY apps/portal-backend/requirements.txt /app/apps/portal-backend/requirements.txt
COPY apps/portal-backend/runner/requirements.txt /app/apps/portal-backend/runner/requirements.txt
RUN pip install --no-cache-dir \
    -r /app/apps/portal-backend/requirements.txt \
    -r /app/apps/portal-backend/runner/requirements.txt \
    tensorboard \
    psycopg2-binary

COPY apps /app/apps
COPY scripts /app/scripts
COPY --from=frontend-builder /workspace/dist /app/dist

COPY apps/portal-backend/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /app/.local/runs /app/.local/artifacts

ENV PYTHONPATH=/app/apps/portal-backend
ENV FRONTEND_DIST=/app/dist
ENV LOCAL_RUN_ROOT=/app/.local/runs
ENV PORT=8000

EXPOSE 8000 6006

ENTRYPOINT ["/app/entrypoint.sh"]
