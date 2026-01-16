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

### 前置要求
*   **操作系统**: Linux (推荐) 或 macOS。
*   **环境依赖**: Python 3.9+, Node.js 16+, npm。
*   **硬件建议**: NVIDIA GPU（用于加速训练）。

### 一键启动

我们提供了一个统一的启动脚本，自动管理后端、前端和 TensorBoard 服务。

```bash
# 1. 赋予执行权限
chmod +x start-linux.sh

# 2. 启动平台
./start-linux.sh
```

启动后访问: **http://localhost:5173** (或服务器 IP)。

> **注意**: 首次启动会创建 Python 虚拟环境并安装依赖 (`torch`, `ray`, `sb3` 等)，可能需要几分钟时间。

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
│   └── start-linux.sh        # 统一启动脚本
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

---

*为强化学习社区打造。*
