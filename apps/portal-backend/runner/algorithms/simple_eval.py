import json
import os
import time
import random
from pathlib import Path

def evaluate(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None, output_dir=None):
    """
    Standard evaluation entrypoint.
    """
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    output_dir = output_dir or os.environ.get("OUTPUT_DIR", ".")
    
    # 1. Parse Protocol
    protocol_id = config.get("protocolId")
    policy_snapshot_id = config.get("policySnapshotId")
    
    # In a real scenario, we would load the 'protocol' definition from the config
    # passed down by the backend (which should resolve it).
    # For now, we assume the config contains 'evalEpisodes' and 'seeds'.
    
    episodes = int(config.get("episodesPerMatch", 10))
    seeds = config.get("evalSeeds", [0])
    
    results = []
    
    # 2. Run Eval Loop
    print(f"Starting evaluation for {policy_snapshot_id} on protocol {protocol_id}")
    for seed in seeds:
        # rng = random.Random(seed) # In real RL, we set env seed
        for i in range(episodes):
            # Simulate an episode
            # In reality: env.reset(seed=seed), while not done: act...
            
            # Mocking result
            score = 0.5 + (random.random() * 0.5) # Random score 0.5 - 1.0
            win = 1 if score > 0.7 else 0
            
            results.append({
                "seed": seed,
                "episode": i,
                "return": score,
                "win": win
            })
            
            # Log progress
            if metrics_path:
                 with open(metrics_path, "a", encoding="utf-8") as handle:
                    handle.write(json.dumps({"step": len(results), "values": {"return": score, "win": win}}) + "\n")
            time.sleep(0.05) # Simulate compute
            
    # 3. Aggregate & Write Summary
    returns = [r["return"] for r in results]
    wins = [r["win"] for r in results]
    
    summary = {
        "mean": sum(returns) / len(returns),
        "min": min(returns),
        "max": max(returns),
        "count": len(returns),
        "winRate": sum(wins) / len(wins)
    }
    
    # Write to artifacts
    eval_dir = Path(output_dir) / "eval"
    eval_dir.mkdir(parents=True, exist_ok=True)
    
    (eval_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    (eval_dir / "results.json").write_text(json.dumps(results, indent=2))
    
    print(f"Evaluation complete. Summary: {summary}")
