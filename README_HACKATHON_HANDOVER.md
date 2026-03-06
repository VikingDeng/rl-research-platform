# RL Research Platform - 黑客松交接文档 (Hackathon Handover)

## 📌 当前状态总结
前端已经完成了**完全的风格重构**，从旧版的 Vite + React 厚重界面，成功迁移到了极简的 **Next.js (App Router) + Tailwind CSS** 现代 SaaS 控制台风格。
- **已完成页面**：Dashboard (大盘)、Job Queue (任务队列)、Model Registry (模型库)、Compare Runs (对比占位)。
- **数据对接**：前端的 `src/lib/api.ts` 已对接 `http://localhost:8000/api/v1`。
- **Mock数据注入**：后端的 SQLite 数据库 (`apps/portal-backend/rl_platform.db`) 中已经注入了一批高质量的 Demo 数据（MAPPO、SAC、DQN 的多状态任务记录和模型记录）。

---

## 🚀 如何在任何环境启动项目

为了在测试环境或路演时快速拉起系统，请按以下步骤操作：

### 1. 启动后端 (FastAPI)
如果你在全新的测试机器上：
```bash
# 1. 进入后端目录
cd apps/portal-backend

# 2. 如果没有虚拟环境，先创建并安装依赖
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. 启动服务
uvicorn app.main:app --host 0.0.0.0 --port 8000
```
> 如果使用内置脚本，也可以直接在项目根目录运行 `./scripts/backend-local-up.sh`

### 2. 启动前端 (Next.js)
新开一个终端窗口：
```bash
# 1. 进入前端目录
cd web

# 2. 安装依赖 (如果是克隆下来的新环境)
npm install

# 3. 启动开发服务器
npm run dev
```
访问 **http://localhost:3000** 即可看到控制台和所有 Demo 数据。

---

## 📋 剩余任务清单 (TODO List)

如果您要继续完善项目，可以沿着以下清单进行：

### 前端体验打磨
- [ ] **运行对比 (Compare Runs)**：目前是 Empty State 状态，需要对接后端的 `DiffMatrix` 数据，使用类似 Echarts 或 Framer Motion 渲染指标曲线对比图。
- [ ] **创建任务 (Submit Job)**：Job Queue 页面的 "提交新任务" 按钮目前无响应，需要实现一个抽屉式 (Drawer) 或模态框 (Modal) 表单，收集 Env、Algo、GPU 参数并 POST 到后端。
- [ ] **Agentic Lab (工作流画布)**：将 `web/src/app/agentic/page.tsx` 中写死的占位符，结合 `ReactFlow` 还原出丝滑的多智能体调度图。

### 后端与演示数据
- [ ] **实时指标流 (WebSockets/SSE)**：目前运行中的任务状态是拉取的 (Polling/Refresh)。为了展示极客感，可以加一个 WebSocket 接口推送 loss 和 reward 曲线。
- [ ] **假日志数据**：目前 Run 的 "查看日志" 按钮没做。可以在后端写一个假接口，随机吐出一些类似 `Loss: 0.12, Reward: 24.5` 的训练日志供前端滚动展示。
