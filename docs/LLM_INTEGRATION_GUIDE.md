# 🤖 LLM Integration Guide: Zero-Code Adaptation

This guide explains how to leverage Large Language Models (GPT-4, Claude 3.5 Sonnet, DeepSeek-R1) to automatically generate "Adapter Code" for your research.

This allows you to take **any open-source RL repository** (from GitHub) and run it on this platform **without writing manual glue code**.

---

## 💡 The Concept: "Adapter Pattern"

The platform has a strict interface contract (defined in `runner_main.py`). Most research code on GitHub has its own arbitrary structure.

Instead of modifying the platform or the research code, we ask the LLM to write a small **Adapter Script** that bridges the two.

```text
[ RL Platform ]  <--->  [ Adapter Script (AI Generated) ]  <--->  [ GitHub Research Code ]
   (Strict)                 (Translation Layer)                      (Arbitrary)
```

---

## 🏗️ Workflow

### Mode 1: Adapter Mode (Existing Code)
Use this when you have an existing GitHub repo and want to run it on the platform.
*   Use **[Template A: Adapter Prompt]** below.

### Mode 2: Generator Mode (AI-Written Code)
Use this when you want the AI to write the core algorithm from scratch (e.g., "Write me a PPO implementation") that is natively compatible with the platform.
*   Use **[Template B: Generator Prompt]** below.

---

## 📋 Prompt Templates

### Template A: Adapter Prompt (For GitHub Code)
*(Use the prompt from the original section below)*

---

### Template B: Generator Prompt (For Zero-to-One Implementation)

**Scenario**: You want the AI to implement an algorithm (e.g., MAPPO) from scratch and run it immediately.

Copy and paste this to the AI:

```markdown
# Role Definition
You are an Expert Reinforcement Learning Researcher. Please implement a complete [Algorithm Name, e.g., MAPPO] for me.

# Code Constraints (Platform Native)
Do not write snippets. Output a single, runnable `entrypoint.py` file that fully complies with the following system requirements:

## 1. Core Logic
*   Implement the core Network (Actor/Critic) using PyTorch.
*   Implement the full training loop (Rollout -> Storage -> Update).
*   Support PettingZoo or Gymnasium environments.

## 2. Required Interface
The code MUST define a main function `train`:
```python
def train(config: dict, metrics_path: str, checkpoint_dir: str, run_id: str, env=None, env_config=None):
    # Your training loop here
    pass
```

## 3. Mandatory Features
*   **Hyperparams**: Read from `config`, e.g., `lr = config.get("train", {}).get("learningRate", 3e-4)`.
*   **Auto-Env**: If `env` is None, instantiate it using `env_config["envId"]` (prefer `pettingzoo` or `gymnasium`).
*   **Logging (JSONL)**: Every N steps, append `{"step": ..., "values": {"returnMean": ...}}` to `metrics_path`.
*   **Checkpointing**: Save `.pt` models to `checkpoint_dir` at the end.

# Task Output
Please output **ONLY** the full Python code containing both the core algorithm and the platform interface logic.
```


```markdown
# Role Definition
You are a Senior Systems Integration Engineer specializing in Reinforcement Learning MLOps.
Your task is to write a Python "Adapter Script" that bridges an external RL algorithm (from a provided GitHub snippet/concept) to a specific standardization platform.

# The Platform Contract (Strict Constraints)

Your generated code MUST strictly adhere to the following interface, otherwise the system will crash.

## 1. Entrypoint Signature
You MUST define a function named `train` with this exact signature:
```python
def train(config: dict, metrics_path: str, checkpoint_dir: str, run_id: str, env=None, env_config=None):
    """
    Args:
        config (dict): Contains all hyperparameters. e.g. config["train"]["learningRate"].
        metrics_path (str): Path to write JSONL metrics.
        checkpoint_dir (str): Path to save model checkpoints.
        run_id (str): Unique Run ID.
        env (Any): Pre-instantiated environment object (if available).
        env_config (dict): Environment config (envId, etc.) to instantiate env if env is None.
    """
    pass
```

## 2. Metrics Logging (Crucial)
The system DOES NOT read stdout. You MUST write metrics to `metrics_path` in JSONL format.
**Format**: `{"step": <int>, "values": {"returnMean": <float>, "loss": <float>}}`

Example implementation snippet:
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

## 3. Environment Loading
The script must handle environment creation if `env` is None.
```python
# MPE / PettingZoo Example
if env is None:
    # Use env_id from config, default to simple_spread_v3
    env_id = env_config.get("envId", "simple_spread_v3") if env_config else "simple_spread_v3"
    # Import and instantiate...
```

## 4. Hyperparameter Extraction
Do NOT hardcode hyperparameters. Extract them from `config`.
```python
lr = config.get("train", {}).get("learningRate", 1e-3)
steps = config.get("train", {}).get("totalEnvSteps", 10000)
```

# Task Input
(Here, paste the GitHub URL or the code snippet of the algorithm you want to adapt, e.g., a simple PPO implementation class)

# Output Requirement
Please output **ONLY** the complete Python code for the `adapter.py` file. No markdown explanations.
```

---

## 🔍 Why this works

*   **Decoupling**: The core algorithm remains untouched.
*   **Standardization**: The prompt forces the LLM to conform to `runner_main.py`'s dependency injection logic.
*   **Automation**: You don't need to manually wire up `json.dump` or `argparse` every time.

```