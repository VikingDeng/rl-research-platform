# 🧠 RL Research Platform (Gen 2)

[中文版本 (Chinese Version)](./README_CN.md)

An industrial-grade Research & Operations (MLOps) platform tailored for **Reinforcement Learning (RL)** and **Multi-Agent RL (MARL)**.

Designed for researchers who need reproducible experiments, automated evaluation, and deep observability.

![Status](https://img.shields.io/badge/Status-Production%20Ready-green) ![Stack](https://img.shields.io/badge/Stack-FastAPI%20%7C%20React%20%7C%20Ray%20%7C%20SB3-blue)

---

## ✨ Key Features

### 🏋️ Training & Scheduling
*   **Hybrid Engine Support**: Native support for **Stable-Baselines3** (Single-Agent) and **Ray RLLib** (Multi-Agent).
*   **Git-Ops Workflow**: Run experiments directly from your Git commits. The platform records commit hashes for 100% reproducibility.
*   **Config Diff**: Instantly visualize hyperparameter differences between any two runs.

### 👁️ Observability
*   **TensorBoard Integration**: Built-in TensorBoard proxy for deep gradient/loss analysis.
*   **Smart Video Gallery**: Automatically records and organizes replay videos from training checkpoints.
*   **Real-time Metrics**: Live streaming of Reward, Entropy, and Win Rate with downsampling for performance.

### 🧪 Evaluation & Analysis
*   **Matrix Evaluation**: Automated "League Table" generation. Run A vs Run B evaluations with heatmaps and Elo scoring.
*   **Repro Bundle**: One-click export of `reproduce.sh`, `config.yaml`, and `README.md` for open-sourcing your results.

---

## 🚀 Quick Start

### Prerequisites
*   **OS**: Linux (Recommended) or macOS.
*   **Dependencies**: Python 3.9+, Node.js 16+, npm.
*   **Optional**: NVIDIA Drivers (for GPU training).

### One-Click Launch

We provide a unified startup script that manages Backend, Frontend, and TensorBoard services.

```bash
# 1. Grant execution permissions
chmod +x start-linux.sh

# 2. Start the platform
./start-linux.sh
```

Access the dashboard at: **http://localhost:5173** (or your server IP).

> **Note**: The first launch will take a few minutes to create the Python virtual environment and install dependencies (`torch`, `ray`, `stable-baselines3`, etc.).

---

## 📂 Project Structure

```text
rl-research-platform/
├── apps/
│   ├── portal-backend/       # FastAPI Backend & Orchestrator
│   │   ├── app/              # Core Logic (API, DB, Services)
│   │   └── runner/           # Training Runner (Executes SB3/RLLib)
│   └── portal-frontend/      # React Frontend (Vite)
├── scripts/
│   ├── seed-full.sh          # Database Seeding (Default Envs/Algos)
│   └── start-linux.sh        # Unified Startup Script
├── docs/                     # Documentation
└── requirements.txt          # Top-level deps
```

---

## 🔬 Research Workflow

1.  **Develop**: Write your custom environment or algorithm wrapper in your local Git repository.
2.  **Push**: Commit your changes to GitHub/GitLab.
3.  **Submit**: In the platform, create a Job pointing to your Git Repo URL.
4.  **Observe**: Watch live TensorBoard plots and video replays.
5.  **Evaluate**: Select your best checkpoints and run a "Matrix Job" to benchmark against baselines.
6.  **Publish**: Click "Download Repro Bundle" to get a clean, shippable zip file for your paper.

---

## 🔧 Extending the Platform

See [Developer Guide](docs/DEV_GUIDE_RL_PLATFORM.md) for details on:
*   Adding custom Gym/PettingZoo environments.
*   Registering new Algorithms.
*   Plugin system for custom rewards/loggers.

---

*Built for the RL Community.*