0. 约定

Base URL：/api/v1

Auth：Authorization: Bearer <token>

所有对象采用 id（UUID 或 ULID）

时间统一 UTC ISO8601

分页：?page=1&page_size=50

1. Auth

POST /auth/login → {token}

GET /auth/me → user profile

2. Project

POST /projects

GET /projects

GET /projects/{project_id}

PATCH /projects/{project_id}

DELETE /projects/{project_id}

Project schema（简要）：

{
  "id": "proj_x",
  "name": "Flight MARL",
  "tags": ["marl", "flight"],
  "created_at": "...",
  "updated_at": "..."
}

3. Environment Registry（EnvSpec）

GET /envs（列表：env_id/version/map_sets）

GET /envs/{env_id}/versions

POST /admin/envs（管理员注册/更新）

POST /admin/envs/{env_id}/versions（上传新版本元信息）

EnvVersion schema（核心字段）：

{
  "env_id": "smac",
  "version": "1.2.0",
  "api_mode": "multi_agent_parallel",
  "default_image_digest": "sha256:....",
  "map_sets": [{"id":"easy","maps":["3s5z","2s3z"]}],
  "scenario_schema": { "type":"object", "properties":{ "map_set":{"type":"string"} } }
}

4. Algo / Template

GET /algos（algo_id 列表）

POST /admin/algos（注册/更新）

GET /templates

POST /projects/{project_id}/templates

GET /templates/{template_id}

POST /templates/{template_id}/versions（版本化）

TemplateVersion 包含：默认超参、网络模板、支持 env 约束、默认 wrappers 等。

5. Plugin Registry（推荐：template+plugin 模式）

GET /plugins

POST /admin/plugins（注册插件包：wheel URI + hash + manifest）

GET /plugins/{plugin_id}/versions

PluginVersion schema：

{
  "plugin_id": "intent_modeling",
  "version": "0.3.1",
  "wheel_uri": "s3://artifacts/plugins/intent_modeling-0.3.1-py3-none-any.whl",
  "sha256": "...",
  "manifest": { "...": "..." }
}

6. TrainJob / Run / Job
6.1 提交训练

POST /train-jobs
request：

{
  "project_id": "proj_x",
  "template_version_id": "tmplv_x",
  "env": {"env_id":"smac","version":"1.2.0","map_set":"easy","wrappers":["reward_scale","obs_norm"]},
  "algo": {"algo_id":"mappo","preset":"strong"},
  "agent": {"policy_sharing":"shared","arch":"mlp","recurrent":false},
  "train": {"total_env_steps":50000000,"rollout_len":200,"batch_size":32768,"lr":0.0003,"entropy_coef":0.01,"gamma":0.99,"gae_lambda":0.95},
  "resources": {"gpus":1,"cpus":16,"mem_gb":32},
  "seed_set": [0,1,2,3,4],
  "plugin": {"plugin_id":"intent_modeling","version":"0.3.1"},
  "auto_eval": {"protocol_id":"proto_v5", "trigger_on":"best_ckpt"}
}


response：

{"run_id":"run_x","job_id":"job_x"}

6.2 Run 查询

GET /runs/{run_id}

GET /runs?project_id=...&type=train|eval|matrix&status=...

GET /runs/{run_id}/checkpoints

POST /runs/{run_id}/checkpoints/{ckpt_id}/tag（best/paper-fig）

6.3 Job 控制

GET /jobs/{job_id}

POST /jobs/{job_id}/cancel

POST /jobs/{job_id}/pause

POST /jobs/{job_id}/resume

7. EvalProtocol / OpponentPool / EvalJob / MatrixJob
7.1 EvalProtocol

POST /eval-protocols

GET /eval-protocols

GET /eval-protocols/{protocol_id}

POST /eval-protocols/{protocol_id}/freeze

EvalProtocol 核心字段：

{
  "id":"proto_v5",
  "env": {"env_id":"smac","version":"1.2.0","map_set":"easy"},
  "eval_seeds":[100,101,102,103],
  "episodes_per_match":50,
  "timeout_sec":60,
  "metrics":["winrate","return_mean","violations"],
  "opponent_pool_ref":{"pool_id":"pool_def","version":"2"},
  "frozen": true
}

7.2 OpponentPool

POST /opponent-pools

GET /opponent-pools

POST /opponent-pools/{pool_id}/members（add/remove）

POST /opponent-pools/{pool_id}/freeze

成员是 PolicySnapshot 引用：

{"snapshot_ids":["snap_a","snap_b"], "mode":"append"}

7.3 提交 EvalJob

POST /eval-jobs
request：

{"policy_snapshot_id":"snap_x","protocol_id":"proto_v5","resources":{"gpus":1}}

7.4 提交 MatrixJob

POST /matrix-jobs
request：

{"policy_snapshot_ids":["snap_a","snap_b","snap_c"],"protocol_id":"proto_v5","games_per_pair":50,"resources":{"gpus":2}}

7.5 结果

GET /eval-results/{eval_result_id}

GET /matrix-results/{matrix_id}（矩阵数据 + 统计 + 导出链接）

8. Metrics / Logs（实时）

GET /runs/{run_id}/metrics?keys=return_mean,entropy,kl&from_step=...

GET /runs/{run_id}/logs?page=...

WS /runs/{run_id}/stream（推送 metrics + job status + last_ckpt）

消息示例：

{"type":"metric","step":123456,"values":{"return_mean":12.3,"entropy":0.92}}
{"type":"status","job_status":"RUNNING","gpu_util":[0.78]}
{"type":"checkpoint","ckpt_id":"ckpt_1200000","path":"s3://..."}

9. Artifacts / Repro Bundle

GET /runs/{run_id}/artifacts

GET /artifacts/{artifact_id}/download_url

GET /runs/{run_id}/repro-bundle（返回一个可下载包或 manifest）

10. Events（给前端/自动化用）

（可选）Webhooks：

POST /admin/webhooks：订阅 job.finished, eval.finished, matrix.finished

事件 payload 包含 run_id、result_id、links
