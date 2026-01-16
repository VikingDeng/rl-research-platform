# 🛠️ 开发者指南: RL Research Platform

本指南详细说明了如何扩展平台功能、添加新环境、新算法，以及如何利用 Git 工作流进行高效科研。

## 1. 添加新环境

平台支持 **Gymnasium** (单智能体) 和 **PettingZoo** (多智能体)。

### 步骤
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

### 步骤
1.  **编写训练脚本**:
    在 `apps/portal-backend/runner/algorithms/` 下创建文件。例如 `dreamer_v3.py`。

    ```python
    import json
    
    def train(config, metrics_path, checkpoint_dir, **kwargs):
        # 1. 解析超参数
        lr = config['train']['learning_rate']
        
        # 2. 初始化你的模型 (PyTorch/JAX/等)
        model = DreamerV3(lr=lr)
        
        # 3. 训练循环
        for step in range(10000):
            metrics = model.train_step()
            
            # 4. 记录指标 (这对 UI 展示至关重要)
            with open(metrics_path, "a") as f:
                f.write(json.dumps({"step": step, "values": metrics}) + "\n")
                
            # 5. 定期保存 Checkpoint
            if step % 1000 == 0:
                model.save(f"{checkpoint_dir}/step_{step}.pt")
    ```

2.  **注册算法**:
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
