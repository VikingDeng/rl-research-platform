# RL Platform Demo Recording Script (English)

## 1) One-line intro (10s)
Hello everyone, this is our RL Research Platform. We cover the full chain from experiment setup to training, evaluation, replay export, matrix analysis, and opponent pool management in one unified UI.

## 2) Optional "create project" segment (30-45s)
- Open `Dashboard`.
- Click `New Project`.
- Name it `Hackathon Demo Project`, add a short description, and create.
- Say: "Projects are the top-level container for templates, runs, and comparison workflows."

## 3) Main recording chain (2-3 min)
Use this exact flow:

1. `Dashboard`
- Say: "Here we monitor active runs, resource usage, and quick actions."
- Highlight that metrics, matrix, opponent pools, and replay assets are already linked.

2. `Open Run Detail`
- Open a succeeded run with metrics and checkpoints.
- Say: "Run Detail gives us learning curves, logs, checkpoints, and reproducibility artifacts."

3. `Replay Gallery (Export WebM)`
- Switch to `Replay Gallery`.
- Play one replay and click `Export WebM`.
- Say: "This enables quick visual evidence for agent behavior and easy sharing in reports."

4. `Open Matrix`
- Open matrix analysis (from Run Detail tab or `Matrix` page).
- Say: "We can compare policy snapshots pairwise and rank agents by aggregate performance."

5. `Open Opponent Pools`
- Open `Opponent Pools`.
- Show members/version/freeze flow.
- Say: "Opponent pools let us lock evaluation populations for fair and repeatable benchmarking."

## 4) Closing (10-15s)
End with:
This platform is designed for real experimentation, not just dashboards. You can run training, track artifacts, reproduce runs, evaluate against fixed opponent pools, and export visual evidence in a single workflow.

## 5) Presenter tips
- Keep zoom at 110%-125% for readability.
- Use one completed run to avoid waiting during recording.
- Keep terminal ready with smoke-check output as backup proof:
  - `./scripts/real-chain-smoke.sh`
  - `./scripts/acceptance-check.sh --with-real-chain`
