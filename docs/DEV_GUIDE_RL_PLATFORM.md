# 🛠️ Developer Guide: RL Research Platform

This guide covers how to extend the platform with new environments, algorithms, and how to use the Git-based research workflow.

## 1. Adding a New Environment

The platform supports both **Gymnasium** (Single-Agent) and **PettingZoo** (Multi-Agent).

### Steps
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
    Run `python apps/portal-backend/runner/scripts/patch_db.py` (if available) or just modify the seeder to run again. For development, running `./scripts/seed-full.sh` is the easiest way to update definitions.

---

## 2. Adding a New Algorithm

The platform uses an "Entrypoint" system. An algorithm is just a Python function that accepts a `config` dict.

### Steps
1.  **Create the Script**:
    Create a file in `apps/portal-backend/runner/algorithms/`. E.g., `dreamer_v3.py`.

    ```python
    # apps/portal-backend/runner/algorithms/dreamer_v3.py
    import json
    
    def train(config, metrics_path, checkpoint_dir, **kwargs):
        # 1. Parse Config
        lr = config['train']['learning_rate']
        
        # 2. Setup your model (PyTorch/JAX/etc)
        model = DreamerV3(lr=lr)
        
        # 3. Training Loop
        for step in range(10000):
            metrics = model.train_step()
            
            # 4. Log Metrics (Critical for UI)
            with open(metrics_path, "a") as f:
                f.write(json.dumps({"step": step, "values": metrics}) + "\n")
                
            # 5. Save Checkpoint periodically
            if step % 1000 == 0:
                model.save(f"{checkpoint_dir}/step_{step}.pt")
    ```

2.  **Register in Database**:
    Add to `ALGO_DEFS` in `scripts/seed-full.sh`.

    ```python
    {
        "algo_id": "dreamer-v3",
        "name": "DreamerV3 (Custom)",
        "entrypoint": "algorithms.dreamer_v3:train",
        "default_config": { ... }
    }
    ```

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