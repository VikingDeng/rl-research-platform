1. 代码仓库结构（建议）
repo/
  apps/
    portal-backend/
    portal-frontend/
    runner/
  packages/
    sdk/                # runner 上报 metrics、写 artifacts 的轻量 SDK
    adapters/           # rllib/marllib adapters
  infra/
    compose/
    grafana/
    prometheus/
  docs/
    PRD_RL_PLATFORM.md
    API_SPEC_RL_PLATFORM.md
    TECH_DESIGN_RL_PLATFORM.md
    DEV_GUIDE_RL_PLATFORM.md

2. 服务清单（docker compose）

最小可用（MVP）：

portal-backend

portal-frontend

postgres

minio

determined-master

determined-agent

prometheus

grafana

runner-image（作为 job 运行镜像，不必常驻）

可选：

mlflow-server

3. 开发流程（强约束，减少返工）

先实现 数据模型 + API（OpenAPI）

前端按 API 拉数据做页面（Gemini 设计）

runner 能跑通 一个单体模板（PPO） + 一个 MARL 模板（MAPPO）

再加 EvalProtocol + MatrixJob

最后补 sweep/ablation 与报告导出

4. MVP 里程碑（建议）
M0（能提交训练、看曲线、产物落盘）

Project/Template/Run/Job CRUD

TrainJob → Determined → Runner 启动 → 产生 ckpt → UI 可见

Run Detail：曲线+日志+ckpt

M1（科研闭环：协议化评测 + 矩阵）

EvalProtocol（冻结）

EvalJob

OpponentPool（冻结）

MatrixJob + 热力图

M2（科研效率：sweep/ablation + 报告）

SweepJob 批量提交

自动汇总 best + CI

导出论文图表/表格

5. 测试（必须做，不然平台不可信）

单元测试：API schema 校验、manifest 校验、权限（token）

集成测试：TrainJob→ckpt→EvalJob→MatrixJob 全链路

可复现测试：repro_bundle 在新容器里复跑得到同级别统计结果（CI 内）

6. 运维（单机 4 卡）

MinIO：定期清理策略（保留策略：best ckpt + paper tag + 最近 N 天）

Postgres：每日备份

Grafana：GPU/CPU/磁盘告警阈值

Determined：限制同时运行的 GPU slots、失败重试策

7. 执行后端与运行时（本地/Determined）

本地（mac，无 Docker）：

- `EXECUTOR_MODE=local`
- `LOCAL_EXECUTOR_MODE=real`（使用 `runner_main.py`）
- `LOCAL_RUN_ROOT=.local/runs`
- 环境/算法 `package` 为空或本地已安装

Determined（linux，有 Docker）：

- `EXECUTOR_MODE=determined`
- `DETERMINED_MASTER_URL=http://<master>:8080`
- `DETERMINED_TOKEN=<token>`（如开启认证）
- `DETERMINED_IMAGE=<image>`（包含本仓库代码或通过镜像挂载）
- `DETERMINED_ENTRYPOINT=python -m app.executors.determined_runner`（容器内调用 runner）
- `DETERMINED_SHARED_FS_ROOT=/mnt/rl_runs`（需与 backend 共享）
- `LOCAL_RUN_ROOT=/mnt/rl_runs`（与 Determined 共享路径保持一致）

运行时包自动安装（可选）：

- `RUNTIME_AUTO_INSTALL=true`
- `RUNTIME_CACHE_ROOT=.local/runtimes`
- `RUNTIME_PIP_INDEX_URL=<custom index>`（可选）
