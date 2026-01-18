# 🤖 LLM 集成指南：零代码适配工作流

本指南介绍了如何利用大语言模型（GPT-4, Claude 3.5, DeepSeek-R1）自动生成“适配代码”，从而将任何 GitHub 上的开源强化学习代码接入本平台。

通过这种方式，你无需手动编写复杂的胶水代码，即可运行各种前沿算法。

---

## 💡 核心概念：适配器模式 (Adapter Pattern)

本平台通过 `runner_main.py` 定义了一套严格的接口契约。而 GitHub 上的科研代码通常结构各异。

我们不需要修改平台，也不需要修改原始科研代码，而是让 LLM 编写一个轻量级的 **适配脚本 (Adapter Script)** 来连接两者。

```text
[ 实验平台 ]  <--->  [ 适配脚本 (AI 生成) ]  <--->  [ GitHub 原始代码 ]
 (标准接口)             (逻辑翻译层)                (任意结构)
```

---

## 🏗️ 操作流程

### 模式一：适配既有代码 (Adapter Mode)
适用于你已经有现成的 GitHub 仓库，只想接入平台运行。
*   使用下方的 **[适配器提示词]**。

### 模式二：AI 全自动生成核心算法 (Generator Mode)
适用于你只有一个 idea（例如“帮我写一个带有 Attention 机制的 PPO”），希望 AI 直接写出能在平台上跑的代码。
*   使用下方的 **[全生成提示词]**。

---

## 📋 提示词模板

### 模板 A：适配器提示词 (用于接入 GitHub 代码)
*(请使用原文档中的模板，此处略)*

---

### 模板 B：全生成提示词 (用于 AI 直接写算法)

**场景**：你想让 AI 帮你从零写一个算法（比如 MADDPG），并直接在平台上跑。

请复制以下内容发送给 AI：

```markdown
# 角色定义
你是一个强化学习算法专家。请为我实现一个完整的 [算法名称，例如: MAPPO] 算法。

# 代码约束 (平台原生支持)
请不要写零散的代码片段，而是直接输出一个可以直接运行的 `entrypoint.py` 文件。该文件必须满足以下系统要求：

## 1. 核心逻辑要求
*   使用 PyTorch 或 TensorFlow 实现核心网络 (Actor/Critic)。
*   实现完整的训练循环 (Rollout -> Storage -> Update)。
*   支持 PettingZoo 或 Gym 接口的环境。

## 2. 必须实现的接口函数
代码中必须包含主函数 `train`：
```python
def train(config: dict, metrics_path: str, checkpoint_dir: str, run_id: str, env=None, env_config=None):
    # 这里写你的训练循环
    pass
```

## 3. 必选功能
*   **超参数读取**: `lr = config.get("train", {}).get("learningRate", 3e-4)`
*   **环境自动加载**: 如果 `env` 为 None，请根据 `env_config["envId"]` 自动加载 (推荐使用 `pettingzoo` 或 `gymnasium`)。
*   **日志写入 (JSONL)**: 训练每 N 步，必须将 `{"step": ..., "values": {"returnMean": ...}}` 写入 `metrics_path` 文件。
*   **模型保存**: 训练结束时保存 `.pt` 文件到 `checkpoint_dir`。

# 你的任务
请直接生成一份完整的、可运行的、包含核心算法实现和平台对接逻辑的 Python 代码。
```


# 平台接口契约 (严格约束)

你生成的代码必须严格遵守以下接口规范，否则系统将无法运行。

## 1. 入口函数签名
你必须定义一个名为 `train` 的函数，签名必须完全一致：
```python
def train(config: dict, metrics_path: str, checkpoint_dir: str, run_id: str, env=None, env_config=None):
    """
    参数:
        config (dict): 包含所有超参数。例如 config["train"]["learningRate"]。
        metrics_path (str): 指标日志的写入路径（JSONL 格式）。
        checkpoint_dir (str): 模型权重保存目录。
        run_id (str): 运行实例的唯一 ID。
        env (Any): 预实例化的环境对象（如果可用）。
        env_config (dict): 环境配置信息，如果 env 为 None，请根据此信息自行创建环境。
    """
    pass
```

## 2. 指标上报 (关键约束)
系统不读取控制台输出（stdout）。你必须将指标以 JSONL 格式追加写入到 `metrics_path` 文件。
**格式要求**: `{"step": <整数>, "values": {"returnMean": <浮点数>, "loss": <浮点数>}}`

实现参考：
```python
import json
def log_metrics(step, reward, loss, path):
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "step": step,
            "values": {
                "returnMean": float(reward),
                "loss": float(loss)
            }
        }) + "\n")
```

## 3. 环境加载
脚本必须具备在 `env` 为 None 时自行初始化环境的能力：
```python
if env is None:
    # 从 env_config 获取 envId，默认为 simple_spread_v3
    env_id = env_config.get("envId", "simple_spread_v3") if env_config else "simple_spread_v3"
    # 这里编写导入并创建环境的逻辑...
```

## 4. 参数提取
禁止在代码中硬编码超参数。必须从 `config` 中提取：
```python
lr = config.get("train", {}).get("learningRate", 1e-3)
steps = config.get("train", {}).get("totalEnvSteps", 10000)
```

# 任务输入
(在这里粘贴 GitHub URL 或你想适配的算法代码片段)

# 输出要求
请仅输出 `adapter.py` 文件的完整 Python 代码。不要包含任何 Markdown 解释。
```

---

## 🔍 为什么这能奏效？

*   **解耦**: 原始算法代码无需改动。
*   **标准化**: 提示词强制 AI 遵循 `runner_main.py` 的依赖注入逻辑。
*   **自动化**: 你不需要每次都手动处理 `argparse` 或日志文件的读写。

```