import json
import os
import time
import random
from pathlib import Path

from algorithms.eval_utils import expand_scenario_grid, sample_opponent

def evaluate(config, metrics_path=None, checkpoint_dir=None, run_id=None, env=None, env_config=None, output_dir=None):
    """
    Standard evaluation entrypoint.
    """
    metrics_path = metrics_path or os.environ.get("METRICS_PATH")
    output_dir = output_dir or os.environ.get("OUTPUT_DIR", ".")
    
    # 1. Parse Protocol
    protocol_id = config.get("protocolId")
    policy_snapshot_id = config.get("policySnapshotId")
    
    protocol = config.get("protocol", {})
    scenario_grid = protocol.get("scenarioGrid") or config.get("scenarioGrid")
    opponent_sampling = protocol.get("opponentSampling") or config.get("opponentSampling")
    opponent_pool_ref = protocol.get("opponentPoolRef")

    episodes = int(config.get("episodesPerMatch", 10))
    seeds = config.get("evalSeeds", [0])
    scenarios = expand_scenario_grid(scenario_grid)
    
    results = []
    
    # 2. Run Eval Loop
    print(f"Starting evaluation for {policy_snapshot_id} on protocol {protocol_id}")
    for scenario_idx, scenario in enumerate(scenarios):
        for seed in seeds:
            rng = random.Random(seed + scenario_idx * 1000)
            for i in range(episodes):
                # Simulate an episode
                # In reality: env.reset(seed=seed), while not done: act...
                opponent = sample_opponent(opponent_sampling, opponent_pool_ref, rng)

                # Mocking result
                score = 0.5 + (rng.random() * 0.5) # Random score 0.5 - 1.0
                win = 1 if score > 0.7 else 0

                results.append({
                    "seed": seed,
                    "episode": i,
                    "return": score,
                    "win": win,
                    "scenarioId": scenario_idx,
                    "scenario": scenario,
                    "opponent": opponent,
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
        "winRate": sum(wins) / len(wins),
        "scenarioCount": len(scenarios),
    }

    if scenarios and scenarios != [None]:
        scenario_stats = {}
        for r in results:
            key = str(r.get("scenarioId", 0))
            scenario_stats.setdefault(key, []).append(r["return"])
        summary["perScenarioMean"] = {
            key: sum(vals) / len(vals) for key, vals in scenario_stats.items() if vals
        }
    
    # Write to artifacts
    eval_dir = Path(output_dir) / "eval"
    eval_dir.mkdir(parents=True, exist_ok=True)
    
    (eval_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    (eval_dir / "results.json").write_text(json.dumps(results, indent=2))
    
    print(f"Evaluation complete. Summary: {summary}")
