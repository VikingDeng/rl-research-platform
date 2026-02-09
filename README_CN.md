# 🧠 RL Research Platform (第二代)

一个专为 **强化学习 (RL)** 和 **多智能体强化学习 (MARL)** 打造的工业级科研管理与实验平台。

旨在为研究人员提供可复现的实验、自动化的评估以及深度的实验可观测性。

![状态](https://img.shields.io/badge/状态-可投入生产-green) ![技术栈](https://img.shields.io/badge/技术栈-FastAPI%20%7C%20React%20%7C%20Ray%20%7C%20SB3-blue)

---

## ✨ 核心特性

### 🏋️ 训练与调度
*   **混合引擎支持**: 原生支持 **Stable-Baselines3** (单智能体) 和 **Ray RLLib** (多智能体)。
*   **Git-Ops 工作流**: 直接运行 Git 仓库中的代码。平台自动记录 Commit Hash，确保 100% 可复现。
*   **配置对比 (Config Diff)**: 瞬间可视化任意两次实验之间的超参数差异。

### 👁️ 可观测性
*   **TensorBoard 集成**: 内置 TensorBoard 代理，深度分析梯度、Loss 和网络权重。
*   **智能视频画廊**: 自动抓取并组织训练过程中生成的录像，按 Step 分类展示。
*   **实时指标**: 流式上报 Reward、Win Rate 等指标，并支持后端降采样以保证大屏显示性能。

### 🧪 评估与分析
*   **矩阵评估 (Matrix Evaluation)**: 自动化生成“天梯榜”。支持模型两两对战，产出热力图和胜率矩阵。
*   **复现包 (Repro Bundle)**: 一键导出包含 `reproduce.sh`、配置和代码索引的压缩包，方便开源和论文复现。

---

## 🚀 快速开始

### 方案 A：Docker 部署 (强烈推荐)
**适用场景**: 有 Docker 环境的服务器。零配置，全自动。

```bash
# 1. 启动平台 (自动构建镜像、初始化数据库)
docker compose up -d --build

# 2. 查看日志
docker compose logs -f
```
访问地址: **http://localhost:8000**

---

### 方案 B：用户态部署 (无 Docker/无 Sudo)
**适用场景**: 学校集群、共享服务器。

**步骤 1: 本地准备 (在你的电脑上)**
先编译前端，避免在服务器上安装 Node.js。
```bash
cd rl-research-platform
npm ci && npm run build
# 然后将整个项目（包含生成的 dist 文件夹）上传到服务器。
```

**步骤 2: 服务器启动**
```bash
# 1. 赋予权限
chmod +x start-linux.sh
chmod +x start-mac.sh

# 2. 启动平台（一键安装 + 测试）
# Linux:
./start-linux.sh
# macOS:
./start-mac.sh
```
访问地址: **http://localhost:8000**

---

### 方案 C：仅后端快速启动（离线友好）
**适用场景**: 已有可用 Python 环境，或服务器无法联网安装依赖。

```bash
chmod +x scripts/backend-local-up.sh
cp apps/portal-backend/.env.example apps/portal-backend/.env
./scripts/backend-local-up.sh
```

说明:
* 默认使用 SQLite (`apps/portal-backend/rl_platform.db`)。
* 自动选择可用 Python 解释器（`BACKEND_PYTHON`、`.venv`、conda 环境）。
* 跳过 `start-linux.sh` 中耗时的 Orbit/扩展环境安装步骤。

---

### 方案 D：一键验收检查（录屏前必跑）
**适用场景**: 录屏/路演前，快速确认“这台机器可用”。

```bash
chmod +x scripts/acceptance-check.sh
./scripts/acceptance-check.sh
```

检查项:
* docker compose 配置有效性
* 前端构建
* 后端启动 + `/healthz` 健康检查

---

### start 脚本做了什么
`start-*.sh` 已经整合为全自动流程，会：

* 构建前端 + 生成 OpenAPI 客户端
* 创建 venv 并安装后端/runner 依赖（或复用已有 conda 环境）
* 可选安装 Miniconda + OrbitZoo + Orekit 数据（`INSTALL_ORBIT_RUNTIME=1`）
* 可选安装常用环境扩展（`INSTALL_RL_EXTRAS=1`）
* 初始化数据库 + 预置默认环境
* 可选预置大型 MARL 环境（`SEED_MARL_ENVS=1`）
* 可选运行后端测试（`RUN_TESTS=1`）
* 启动 TensorBoard + 后端服务

需要跳过耗时步骤时可用：
```bash
SEED_MARL_ENVS=0 RUN_TESTS=0 INSTALL_ORBIT_RUNTIME=0 INSTALL_RL_EXTRAS=0 ./start-linux.sh
```

---

## 📂 项目结构

```text
rl-research-platform/
├── apps/
│   ├── portal-backend/       # FastAPI 后端与编排器
│   │   ├── app/              # 核心逻辑 (API, 数据库, 服务)
│   │   └── runner/           # 训练执行器 (运行 SB3/RLLib)
│   └── portal-frontend/      # React 前端 (Vite)
├── scripts/
│   ├── seed-full.sh          # 数据库初始化 (预设环境与算法)
│   ├── backend-local-up.sh   # 后端快速启动（离线友好）
│   ├── start-linux.sh        # 统一启动脚本 (Linux)
│   └── start-mac.sh          # 统一启动脚本 (macOS)
├── docs/                     # 文档目录
└── requirements.txt          # 全局依赖
```

---

## 🔬 科研工作流

1.  **开发**: 在本地 Git 仓库编写自定义环境或算法。
2.  **提交**: 将改动 `git push` 到你的 GitHub/GitLab。
3.  **运行**: 在平台创建任务，填入仓库地址和入口函数。
4.  **观测**: 实时查看 TensorBoard 曲线和 Agent 视频。
5.  **评估**: 挑选表现最好的 Checkpoint，运行矩阵任务进行基准测试。
6.  **发布**: 点击 "Download Repro Bundle"，直接获得可供开源的复现代码包。

---

## 🔧 平台扩展

详见 [开发者指南 (中文)](docs/DEV_GUIDE_RL_PLATFORM_CN.md):
*   如何添加自定义 Gym/PettingZoo 环境。
*   如何注册新算法。
*   如何使用插件系统。

🔥 **新特性**: [LLM 集成指南 (中文)](docs/LLM_INTEGRATION_GUIDE_CN.md) - 如何利用 GPT-4/Claude 为本平台自动生成算法代码。

---

*为强化学习社区打造。*
