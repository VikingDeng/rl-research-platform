import sys
import json
import tempfile
import subprocess
from pathlib import Path

# Add backend to path to import app modules if needed
BACKEND_ROOT = Path(__file__).parents[1]
sys.path.append(str(BACKEND_ROOT))

def test_runner_integration():
    """
    Verifies that runner_main.py can successfully execute 'simple_train' algorithm.
    """
    runner_dir = BACKEND_ROOT / "runner"
    runner_script = runner_dir / "runner_main.py"
    
    assert runner_script.exists(), "runner_main.py not found"
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        config_path = temp_path / "config.json"
        metrics_path = temp_path / "metrics.jsonl"
        checkpoint_dir = temp_path / "checkpoints"
        checkpoint_dir.mkdir()
        
        # Create a valid config for simple_train
        config = {
            "algo": {
                "entrypoint": "algorithms.simple_train:train"
            },
            "train": {
                "totalEnvSteps": 50,
                "rolloutLen": 10
            }
        }
        config_path.write_text(json.dumps(config))
        
        # Construct env
        env_vars = {
            "PYTHONPATH": f"{str(runner_dir)}:{str(BACKEND_ROOT)}",
            "METRICS_PATH": str(metrics_path),
            "CHECKPOINT_DIR": str(checkpoint_dir),
            "RUN_ID": "test-run"
        }
        
        # Run command
        cmd = [
            sys.executable,
            str(runner_script),
            "--run-id", "test-run",
            "--config-path", str(config_path),
            "--metrics-path", str(metrics_path),
            "--checkpoint-dir", str(checkpoint_dir)
        ]
        
        result = subprocess.run(
            cmd, 
            env=env_vars, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            text=True
        )
        
        if result.returncode != 0:
            print("STDOUT:", result.stdout)
            print("STDERR:", result.stderr)
            
        assert result.returncode == 0, "Runner failed"
        assert metrics_path.exists(), "Metrics file not created"
        
        # Check output content
        lines = metrics_path.read_text().strip().split("\n")
        assert len(lines) > 0
        last_line = json.loads(lines[-1])
        assert "values" in last_line
        assert "returnMean" in last_line["values"]
        
        print("Integration test passed!")

if __name__ == "__main__":
    test_runner_integration()
