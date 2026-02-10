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

# 安装依赖（使用根目录的 requirements.txt，已合并所有依赖）
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# 复制应用代码
COPY apps /app/apps
COPY scripts /app/scripts
COPY --from=frontend-builder /workspace/dist /app/dist

# 复制入口脚本
COPY apps/portal-backend/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /app/.local/runs /app/.local/artifacts

ENV PYTHONPATH=/app/apps/portal-backend
ENV FRONTEND_DIST=/app/dist
ENV LOCAL_RUN_ROOT=/app/.local/runs
ENV PORT=7860
ENV DATABASE_URL=sqlite:////app/apps/portal-backend/rl_platform.db
ENV DISABLE_CSP=1

EXPOSE 7860 6006

# 使用 entrypoint.sh（包含数据库初始化等完整启动流程）
ENTRYPOINT ["/app/entrypoint.sh"]
