# 🛠️ 开发者指南: RL Research Platform

本指南详细说明了如何扩展平台功能、添加新环境、新算法，以及如何利用 Git 工作流进行高效科研。

## 0. 一键启动说明

推荐使用 `start-linux.sh` / `start-mac.sh` 一键启动。脚本会自动完成：

* 前端构建 + OpenAPI 客户端生成
* 后端/Runner 依赖安装
* Miniconda + OrbitZoo + Orekit 数据准备
* 常用环境扩展安装（Box2D/MuJoCo/MiniGrid/PettingZoo）
* 数据库初始化 + 默认/综合 MARL 环境注入
* 后端测试运行

如需跳过耗时步骤，可在启动时设置环境变量：
```bash
SEED_MARL_ENVS=0 RUN_TESTS=0 ./start-linux.sh
```

## 1. 添加新环境

### 方法一：Web UI 注册 (推荐)
最快的方式，无需重启服务。

1.  进入 **Registries -> Environments** 页面。
2.  点击右上角 **"Register Environment"**。
3.  填写表单：
    *   **ID**: 环境唯一标识（如 `my-custom-env`）。
    *   **Entrypoint**: 指向你的 Python 函数（如 `my_package.env:make_env`）。确保该包在 Runner 环境中可导入（通过 pip 安装或 Git 挂载）。
    *   **Version**: 版本号（如 `1.0.0`）。
    *   **API Mode**: 选择 `gym` (单智能体) 或 `pettingzoo` (多智能体)。

### 方法二：后端代码注册 (初始化用)
用于系统预设环境。

1.  **编写适配器**:
    在 `apps/portal-backend/app/envs/` 下创建一个新的 Python 文件。例如 `my_env.py`。
    
    ```python
    import gymnasium as gym

    def make_env(env_id: str = "my-custom-env-v0", **kwargs):
        # 在这里可以编写或引入你的环境逻辑
        return gym.make(env_id, render_mode="rgb_array")
    ```

2.  **注册到数据库**:
    修改 `scripts/seed-full.sh`，在 `ENV_DEFS` 列表中添加一项。

    ```python
    {
        "env_id": "my-custom-env",
        "version": "1.0.0",
        "api_mode": "gym",  # 或 'pettingzoo'
        "entrypoint": "app.envs.my_env:make_env",  # 指向你的函数
        "map_sets": [{"id": "default", "maps": ["my-custom-env-v0"]}]
    }
    ```

3.  **重新初始化**:
    运行 `./scripts/seed-full.sh` 更新平台定义。

---

## 2. 添加新算法

平台采用“入口函数 (Entrypoint)”系统。一个算法本质上就是一个接收 `config` 字典的 Python 函数。

### 步骤 A：编写训练脚本
无论用哪种注册方式，你首先需要一个训练入口。
在 `apps/portal-backend/runner/algorithms/` 下创建文件，或者在你自己的 Git 仓库中创建。

```python
# my_algo.py
import json

def train(config, metrics_path, checkpoint_dir, **kwargs):
    # 1. 解析超参数
    lr = config['train']['learning_rate']
    
    # 2. 初始化你的模型 (PyTorch/JAX/等)
    # ...
    
    # 3. 训练循环与 Metrics 记录
    # ...
```

### 步骤 B：注册算法

#### 方法一：Web UI 注册 (推荐)
1.  进入 **Registries -> Algorithms** 页面。
2.  点击 **"Register Algorithm"**。
3.  填写信息：
    *   **Entrypoint**: 指向你的函数（如 `my_algo:train` 或 Git 仓库中的 `src.train:main`）。
    *   **Default Config**: 填写默认的 JSON 超参数。

#### 方法二：后端代码注册 (初始化用)
在 `scripts/seed-full.sh` 的 `ALGO_DEFS` 中添加配置。

---

## 3. Git 科研工作流 (推荐)

**无需修改平台源代码**，你可以将所有研究代码保留在自己的 Git 仓库中。

### 运行方式
1.  **代码准备**: 在你的仓库（如 `github.com/my-lab/new-idea`）中编写模型和训练入口。
2.  **任务提交**: 在 Web UI 创建任务时，开启 "Git Config"。
    *   **Repository**: `https://github.com/my-lab/new-idea.git`
    *   **Branch**: `main`
3.  **覆盖入口**:
    在 "Configuration" 步骤的 JSON 编辑器中，覆盖算法入口：
    
    ```json
    {
      "algo": {
        "entrypoint": "my_package.train:main"
      }
    }
    ```
4.  **执行过程**: Runner 将自动 Clone 你的仓库，将其加入 `PYTHONPATH`，并执行你指定的函数。

---

## 4. 矩阵评估 (Evaluation Matrix)

用于基准测试（Benchmark）多个模型：
1.  在 **Eval Protocols** 中定义评估协议（如 "CartPole 100轮测试"）。
2.  创建 **Matrix Job**，勾选 3-5 个不同的实验（Run）或 Checkpoint。
3.  系统会自动启动多组对战/测试任务。
4.  在 **Matrix View** 中查看胜率热力图。

---

## 5. 产物与导出

*   **录像播放**: 确保你的训练脚本将 `.mp4` 文件保存到 `video` 文件夹。平台会自动发现并支持在线播放。
*   **复现包**: 在实验详情页，点击 "Download Repro Bundle"。它包含一个 `reproduce.sh` 脚本，会自动 Clone 当时精确的代码版本并应用当时的配置进行复现。
