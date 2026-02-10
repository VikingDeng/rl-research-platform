# Registry Quickstart (Real Backend)

本文件说明最新的真实注册链路，目标是降低“环境/算法注册”的入门成本，同时保留高级可控能力。

## 1. 环境注册（Environment Registry）

页面：`Environment Registry`

### 快速模式（推荐）
- 在 `Register New Environment` 弹窗里点击 `Quick Presets`。
- 预设会自动填充：`envId`、`version`、`apiMode`、`entrypoint`、`mapSets`。
- 目前内置预设：
  - `Gym Classic (Quick Test)` -> `app.envs.dummy:make_env`
  - `PettingZoo MPE` -> `app.envs.pettingzoo:make_env`
  - `OrbitZoo` -> `app.envs.orbitzoo:make_env`

### 版本迭代
- 在 `Add Environment Version` 弹窗中可点击 `Copy Latest`。
- 系统会复制上一版本配置并自动建议下一个语义版本号（例如 `1.0.0 -> 1.0.1`）。

## 2. 算法注册（Algorithm Registry）

页面：`Algorithm Registry`

### 算法基础信息
- 新建算法时 `Algorithm ID` 改为可选。
- 可点击 `Auto-generate from name` 自动从 `Name` 生成 ID。

### 算法版本注册模式
- 新建版本弹窗新增 `Registration Mode`：
  - `Quick`（推荐）：只需要 `version + entrypoint`，`dependencies` 可选。
  - `Advanced`：可直接编辑完整 manifest JSON。

### Quick 模式行为
- 后端会自动补齐合规 manifest（默认 `python=3.10`，默认 `configSchema={"type":"object"}`）。
- `Copy Latest` 可从上一版本复制入口、依赖和配置字段，减少重复录入。
- `Inline Code` 模式支持 `Insert starter template`，可一键生成可运行的训练入口样板。
- 新建/编辑版本支持 `Run Preflight`，会提前校验入口点可导入、函数签名和源码来源配置。

### 个人算法接入建议（最快链路）
1. 在 `Algorithm Registry` 新建算法（ID 可自动生成）。
2. 新建版本选择 `Quick` 模式，填 `version + entrypoint`。
3. 选择 `Inline Code` 并插入 starter，再替换为你的真实训练逻辑。
4. 点击 `Run Preflight` 确认校验通过后再保存版本。
5. 在 `Create Job -> Quick Run` 选择该算法版本，确认 `Algorithm Readiness` 卡片后提交。

最小可用入口建议：
- 函数名：`train`
- 入口点：`module:function`（例如 `custom_algo:train`）
- 签名：建议 `train(config, **kwargs)`，兼容平台注入参数

## 3. 后端最小 API（不传 manifest 也可创建）

> 以下示例针对真实后端，要求你已完成 API token 配置。

### 3.1 创建算法
```bash
curl -X POST http://127.0.0.1:8000/api/v1/admin/algos \
  -H "Authorization: Bearer $RL_PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "quickalgo",
    "name": "Quick Algo",
    "description": "minimal registration"
  }'
```

### 3.2 创建算法版本（最小 payload）
```bash
curl -X POST http://127.0.0.1:8000/api/v1/admin/algos/quickalgo/versions \
  -H "Authorization: Bearer $RL_PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "0.1.0",
    "entrypoint": "algorithms.simple_train:train",
    "active": true
  }'
```

### 3.3 预检算法版本（推荐）
```bash
curl -X POST http://127.0.0.1:8000/api/v1/admin/algos/quickalgo/versions/preflight \
  -H "Authorization: Bearer $RL_PLATFORM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "0.1.0",
    "entrypoint": "algorithms.simple_train:train",
    "configSchema": {"type": "object"},
    "defaultConfig": {"train": {"lr": 0.0003}}
  }'
```

## 4. 日志与可观测性

新版 runner 会写入结构化启动摘要：
- 日志关键字：`runner_main: bootstrap ...`
- 产物文件：`/manifest/runner_bootstrap.json`

在 `Run Detail -> Source` 页会看到：
- 算法 ID/版本、entrypoint、source type、dependencies
- 运行时 dataset 注入信息（若有）

这有助于快速定位“个人算法接入失败”的常见问题（入口点、依赖、源码来源）。

## 5. 建议回归检查

### 后端
```bash
./scripts/real-chain-smoke.sh
./scripts/acceptance-check.sh --with-real-chain
```

### 前端
```bash
npm install
npm run build
```

如果你的环境 Node 版本低于 `@vitejs/plugin-react` 要求（当前要求 `^20.19.0` 或 `>=22.12.0`），建议先升级 Node 再执行构建。
