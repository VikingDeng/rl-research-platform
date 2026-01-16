# 🛠️ Developer Guide: RL Research Platform

This guide covers how to extend the platform with new environments, algorithms, and how to use the Git-based research workflow.

## 1. Adding a New Environment

### Method 1: Web UI Registry (Recommended)
Fastest way, no restart required.

1.  Navigate to **Registries -> Environments**.
2.  Click **"Register Environment"**.
3.  Fill in the form:
    *   **ID**: Unique identifier (e.g., `my-custom-env`).
    *   **Entrypoint**: Python function path (e.g., `my_package.env:make_env`).
    *   **Version**: e.g., `1.0.0`.
    *   **API Mode**: `gym` or `pettingzoo`.

### Method 2: Backend Seeding (Initialization)
For system defaults.

1.  **Create the Adapter**:
    Create a new python file in `apps/portal-backend/app/envs/`. For example, `my_env.py`.
    
    ```python
    # apps/portal-backend/app/envs/my_env.py
    import gymnasium as gym

    def make_env(env_id: str = "my-custom-env-v0", **kwargs):
        # You can import your custom logic here
        return gym.make(env_id, render_mode="rgb_array")
    ```

2.  **Register in Database**:
    Update `scripts/seed-full.sh`. Add an entry to `ENV_DEFS`.

    ```python
    {
        "env_id": "my-custom-env",
        "version": "1.0.0",
        "api_mode": "gym",  # or 'pettingzoo'
        "entrypoint": "app.envs.my_env:make_env",  # Points to your function
        "map_sets": [{"id": "default", "maps": ["my-custom-env-v0"]}]
    }
    ```

3.  **Reseed**:
    Run `./scripts/seed-full.sh` to update definitions.

---

## 2. Adding a New Algorithm

The platform uses an "Entrypoint" system. An algorithm is just a Python function that accepts a `config` dict.

### Step A: Create the Script
Create a file in `apps/portal-backend/runner/algorithms/` or in your Git repo.

```python
# my_algo.py
import json

def train(config, metrics_path, checkpoint_dir, **kwargs):
    # ... implementation ...
    pass
```

### Step B: Register Algorithm

#### Method 1: Web UI Registry (Recommended)
1.  Navigate to **Registries -> Algorithms**.
2.  Click **"Register Algorithm"**.
3.  Provide the `Entrypoint` (e.g., `my_algo:train`) and `Default Config`.

#### Method 2: Backend Seeding
Add to `ALGO_DEFS` in `scripts/seed-full.sh`.

---

## 3. The Git Research Workflow (Recommended)

Instead of modifying the platform code, you should keep your research code in your own Git repository.

### How it works
1.  **Your Repo**: `github.com/my-lab/new-idea`. Contains your custom models, wrappers, and training loop.
2.  **Config**: When creating a Job in the UI, enable "Git Config".
    *   **Repo**: `https://github.com/my-lab/new-idea.git`
    *   **Branch**: `main`
3.  **Entrypoint Override**:
    In the "Configuration" step (JSON editor), override the entrypoint to point to your Git code.
    
    ```json
    {
      "algo": {
        "entrypoint": "my_package.train:main"
      }
    }
    ```
4.  **Execution**: The Runner will clone your repo, add it to `PYTHONPATH`, and execute `my_package.train:main`.

**Benefit**: Total reproducibility. The platform records the exact Commit Hash used for every run.

---

## 4. Evaluation Matrix

To benchmark multiple models:
1.  Go to **Eval Protocols** and define a protocol (e.g., "CartPole 100 Episodes").
2.  Run **Matrix Job**. Select 3-5 different Runs/Checkpoints.
3.  The system will launch evaluation jobs for each pair/agent.
4.  View the results in the **Matrix View** heatmap.

---

## 5. Artifacts & Export

*   **Videos**: Ensure your training script saves `.mp4` files to the `video` folder (or simply enables `RecordVideo` wrapper). The platform auto-discovers them.
*   **Repro Bundle**: On the Run Detail page, download the bundle. It contains a `reproduce.sh` script that auto-clones the specific commit and runs the config.