1. 总体架构（单机 4 卡）

原则：平台做“管理与协议”，引擎做“训练”。

1.1 组件

portal-frontend：React/Next + ECharts（Gemini 负责）

portal-backend：FastAPI（建议）

portal-worker：编排器（可与 backend 合并，或独立 worker）

Postgres：平台元数据（Project/Run/Protocol/Pool/Artifact 索引）

MinIO：S3 对象存储（所有 artifacts、plugin wheel、报告）

Determined Master/Agent：执行底座（job 调度、GPU slot、试验生命周期）

Runner Image：统一训练/评测入口容器（加载模板+插件，启动 RLlib/MARLlib）

Prometheus+Grafana：系统监控（GPU/CPU/磁盘/队列）

（可选）

MLflow Tracking：指标/params/artifacts 的二级管理（平台可写入并引用 mlflow_run_id）

1.2 数据流

用户在 portal 提交 TrainJob

backend 生成 run_id，写入 Postgres

worker 打包 run_bundle（resolved config + refs），上传 MinIO

worker 通过 Determined API 创建 experiment/trial，指定 Runner Image + run_bundle_uri

Runner 拉取 run_bundle →（可选）安装 plugin wheel → 启动 RLlib/MARLlib 训练

Runner 上报 metrics（WS/HTTP 或写入 MLflow）并周期性上传 checkpoint 到 MinIO

backend 聚合并在前端展示

训练结束后可自动触发 EvalJob/MatrixJob

2. 数据模型（Postgres 表建议）

（字段可按实现细化，这里给必需的“最小强一致模型”）

2.1 projects

id, name, tags, created_at

2.2 templates / template_versions

templates(id,name,desc)

template_versions(id,template_id,version,algo_id,default_config_json,created_at)

2.3 env_versions

env_id, version, api_mode, image_digest, map_sets_json, scenario_schema_json

2.4 plugins / plugin_versions

plugin_id, version, wheel_uri, sha256, manifest_json

2.5 runs

id(run_id), project_id, type(train/eval/matrix), status

template_version_id, env_id, env_version, algo_id

plugin_version_ref(nullable)

code_hash, code_patch_uri(nullable)

env_image_digest

resolved_config_uri

created_at, updated_at

determined_job_ref(nullable)

mlflow_run_id(nullable)

2.6 jobs

id(job_id), run_id, status, resources_json, queue, created_at

determined_experiment_id / trial_id

2.7 checkpoints (policy_snapshots)

id(snapshot_id), run_id, step, ckpt_uri, sha256, tags(best/paper), created_at

2.8 eval_protocols

id, name, env_id, env_version, map_set, eval_seeds_json, episodes_per_match, timeout_sec

opponent_pool_ref_json, metrics_json, frozen, created_at

2.9 opponent_pools / opponent_pool_versions

pools(id,name)

pool_versions(id,pool_id,version,frozen,member_snapshot_ids_json,created_at)

2.10 eval_results / matrix_results

eval_results(id, eval_run_id, summary_json, ci_json, artifacts_uri)

matrix_results(id, matrix_run_id, matrix_uri(csv/json), heatmap_uri, ranking_json)

3. Runner 设计（统一训练/评测入口）

Runner 是你平台“隐藏底层复杂度”的关键。

3.1 Runner 输入：Run Bundle（MinIO 上一个目录或压缩包）

必须包含：

config_resolved.yaml

run_manifest.json（run_id、env_spec、algo_spec、plugin_ref、resources、seeds、mode=train/eval/matrix）

repro_manifest.json（code hash、env digest、template_version、protocol refs）

（可选）code_patch.diff（如果允许 dirty）

（可选）plugin_wheel_ref（uri+hash）

3.2 Runner 输出（写入 MinIO + 上报）

checkpoints/ckpt_<step>/...

logs/stdout.log, logs/stderr.log

metrics/metrics.jsonl（可选：本地落一份）

reports/（评测/矩阵生成的图表与 csv）

final_summary.json

4. 插件机制（Plugin API，研究创新入口）

目标：研究员能写新算法/模型/wrapper，而不破坏平台规范。

4.1 插件包形态

Python wheel（上传到 MinIO）

manifest：rl_platform_plugin.yaml

4.2 manifest 规范（示例）
plugin_id: intent_modeling
version: 0.3.1
compat:
  runner_min: 0.1.0
  engine: [rllib]
entrypoints:
  rllib_callbacks: "intent_modeling.callbacks:Callbacks"
  rllib_models:
    - name: "IntentTransformer"
      path: "intent_modeling.models:IntentTransformer"
  env_wrappers:
    - name: "OpponentBeliefWrapper"
      path: "intent_modeling.wrappers:OpponentBeliefWrapper"

4.3 平台侧约束

插件必须声明兼容 runner 版本

插件 wheel 必须 hash 校验

插件只能通过 entrypoints 影响训练（不允许随意改 runner 主流程）

插件的参数通过 config 注入（被记录在 resolved config）

5. 环境管理（Env Provider）

平台维护环境注册表（env_id/version → image_digest + entrypoint + scenario_schema）

Runner 根据 env_spec 在容器内创建环境（通过 adapter）

环境统一输出 observation/reward/done/info（对齐 RLlib multi-agent 或内部统一接口）

6. 与 Determined 对接（执行底座）

平台不自己造调度：把 job 发给 Determined 跑，平台负责：

创建实验（experiment）并绑定 GPU slots

监听状态回传（poll 或 webhook）

汇总 trial 输出（ckpt/artifacts/metrics）

关键映射：

platform Job ↔ Determined experiment/trial

run_bundle_uri 作为 Determined trial 的输入参数

7. 产物规范（Artifact Contract）

每个 run 的 artifact 目录结构固定，方便自动化与对齐：

runs/{run_id}/
  manifest/run_manifest.json
  manifest/config_resolved.yaml
  manifest/repro_manifest.json
  logs/stdout.log
  logs/stderr.log
  metrics/metrics.jsonl
  checkpoints/ckpt_{step}/...
  eval/ (only for eval/matrix)
    summary.json
    matrix.csv
    heatmap.png
  exports/
    repro_bundle.zip

8. 可视化数据来源建议

指标：Runner → backend（HTTP/WS）实时上报 + 最终落盘

系统资源：Prometheus node_exporter + nvidia exporter → Grafana

矩阵：matrix.csv/json 直接作为 artifact，由前端渲染热力图
