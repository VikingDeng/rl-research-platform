# 开发与测试作战手册

本文档定义 RL Research Platform 的默认开发流程与质量门禁。

## 1）目标

- 每次改动都保持可交付状态。
- 核心功能在干净机器上可复现验证。
- 合并和发布以自动化检查结果为准，而不是主观判断。

## 2）标准开发流程

1. 明确需求范围与验收标准。
2. 实现后端与前端改动。
3. 为改动补齐测试或校验脚本。
4. 本地跑完整质量门禁。
5. 本地通过后再提 PR。

## 3）完成定义（DoD）

满足以下全部条件才算完成：

- 相关功能已端到端打通。
- 本地 `scripts/full-quality-gate.sh --full` 通过。
- CI（`.github/workflows/ci.yml`）全绿。
- 涉及流程/配置变化时，文档已同步更新。

## 4）必须执行的测试命令

日常快速回归：

```bash
./scripts/full-quality-gate.sh --quick
```

若机器上的 npm 安装权限受限，需提前准备前端产物并显式跳过安装：
```bash
FRONTEND_INSTALL_MODE=skip ./scripts/acceptance-check.sh
```

提交前全量门禁：

```bash
./scripts/full-quality-gate.sh --full
```

仅跑真实链路冒烟：

```bash
./scripts/real-chain-smoke.sh
```

## 5）全量门禁覆盖内容

`scripts/full-quality-gate.sh --full` 会执行：

- 后端与 runner 的 Python 编译检查。
- `scripts/acceptance-check.sh --with-real-chain`：
  - compose 配置校验
  - 前端构建
  - 后端健康检查（`/healthz`）
  - 真实链路冒烟（project/env/algo/template/train/eval/matrix/pool/dataset/artifact/repro bundle）
- 后端回归 pytest 用例：
  - `tests/test_runner_integration.py::test_runner_integration`
  - `tests/test_platform_fixes.py::test_init_db_direct_sqlite_bootstrap_is_supported`
  - `tests/test_platform_fixes.py::test_artifact_manifest_written`
  - `tests/test_platform_fixes.py::test_matrix_materialization_includes_replay_payload`

## 6）CI 策略

CI 必须与本地门禁一致：

- 工作流：`.github/workflows/ci.yml`
- 命令：`./scripts/full-quality-gate.sh --full`

CI 失败时禁止合并。

## 7）失败处理流程

全量门禁失败时：

1. 查看终端输出与 `.local/real-smoke/backend.log`。
2. 用对应脚本单独复现（`acceptance-check` 或 `real-chain-smoke`）。
3. 修复根因后重跑全量门禁。
4. 不允许为了演示临时绕过检查。

## 8）发布检查清单

打 release 或 demo 版本前：

1. 运行 `./scripts/full-quality-gate.sh --full`。
2. 确认目标分支 CI 全绿。
3. 保存通过日志，作为评审或路演证据。
4. 更新发布说明（功能变化与已知限制）。

## 9）注册表预检策略

- 在生产工作空间中，新增环境/算法版本前必须先执行预检（preflight）。
- 在 `Create Job` 中，把“版本未冻结”“Git 未 pin commit”的预检 warning 视为可复现性风险。
- 论文/基准实验建议冻结 env/template/algo/plugin 版本，并使用 commit hash 固定代码版本。

## 10）严格失败策略

- Live API 模式严格执行：前端不会在后端失败时自动切换到 mock。
- AI Assistant 采用 fail-fast：不会静默跳过变体，也不会隐式补齐缺失注册表对象。
- Eval 链路采用 fail-fast：缺少模型产物时任务直接失败（`eval_model_artifact_missing`），不会静默降级。
- 出错时先修配置/注册表，再重复同一条链路。

## 11）科研工作流强化

新增能力建议纳入日常流程：

- 严格算法接入向导（预检 / 创建）：
```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/admin/algos/onboarding/strict \
  -H "Content-Type: application/json" \
  -d '{
    "algoId":"custom-ppo",
    "name":"Custom PPO",
    "version":"0.1.0",
    "entrypoint":"custom_algo:train",
    "code":"def train(config, **kwargs):\n    return {\"ok\": True}\n",
    "create": false
  }' | jq
```

- 运行失败诊断：
```bash
curl -sS http://127.0.0.1:8000/api/v1/runs/<RUN_ID>/diagnosis | jq
```

- 可复现锁报告：
```bash
curl -sS http://127.0.0.1:8000/api/v1/runs/<RUN_ID>/repro-lock | jq
```

执行原则：

- `diagnosis` 出现 blocker，先修复再重跑。
- `repro-lock` 为 `UNLOCKED` 时，不建议对外宣称 benchmark 级结果。
