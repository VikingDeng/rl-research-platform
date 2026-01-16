1. 背景与目标

你要的是一个科研用 RL 实验平台：在Linux 单机 4GPU上，实现从“选择环境→选择算法→提交训练→自动评测→对比与矩阵→导出论文级结果→一键复现”的闭环。

1.1 核心目标（平台必须做到）

可复现：任意结果可追溯到 code版本 + config_resolved + env镜像digest + eval协议版本 + seeds，并可一键复跑。

可比较：跨算法/超参/seed/环境版本/对手池版本，统一协议对齐对比。

全流程管理：训练、评测、矩阵评测、sweep/ablation、产物归档、报告导出，全在平台内完成。

实验人员不感知底层库：研究员在 UI 里选“算法/环境/模板/插件版本”，不需要知道 RLlib/MARLlib/Determined/容器细节。

强可视化：前端提供 run 曲线、对比、诊断、资源、对战矩阵热力图、协议与对手池视图。

1.2 非目标（v0.1 不做）

多机多集群/复杂多租户配额/K8s 运维

复杂 SSO/RBAC（先 token + 单用户/小团队）

在平台里重写 RL 算法（训练逻辑走开源引擎 + 插件扩展）

2. 用户与角色

Researcher：创建项目与实验、提交训练/评测/矩阵任务、对比、导出报告

Admin：注册环境/镜像、维护算法模板、管理插件白名单、维护存储与监控

3. 核心概念（术语）

Project：研究主题/课题

ExperimentTemplate：实验模板（算法族 + 默认超参 + 网络模板 + 环境约束）

Run：一次运行实体（TrainRun / EvalRun / MatrixRun）

Job：调度执行单元（提交到 Determined 的“可运行任务”）

PolicySnapshot：训练中/训练后的某个 checkpoint 快照（用于评测/对战）

EvalProtocol：评测协议（版本化）：环境版本、地图集合、seeds、对手池、局数、指标定义

OpponentPool：对手池/队友池（版本化，可冻结）

Artifact：产物：checkpoint、日志、配置快照、评测输出、矩阵 csv、热力图、报告

Plugin：研究员自研扩展包（算法/模型/wrapper/callback），平台 runner 负责加载

4. 端到端科研工作流（必须支持）
4.1 Baseline 训练

进入 Project

选择 ExperimentTemplate（如 PPO/SAC/MAPPO/QMIX/MADDPG）

选择 EnvSpec（env_id/version/map_set/wrappers）

选择资源（GPU=1/2/4）、seed_set（可多 seed）

提交 TrainJob

训练中看曲线与诊断

训练结束标记 best checkpoint → 生成 PolicySnapshot

4.2 固定协议评测

选择 PolicySnapshot

选择 EvalProtocol vX（固定 seeds + 对手池版本 + 地图集合）

提交 EvalJob

查看 EvalResult（mean/std/CI、成功率、违规率、能耗等）

4.3 Cross-play / 对战矩阵（MARL 一等公民）

选择一组 PolicySnapshot（或一个 OpponentPool）

选择 EvalProtocol vX

提交 MatrixJob

查看热力图、排名、导出 csv/图表

4.4 Sweep/Ablation

基于某模板/某 run 复制生成 Sweep

平台批量提交 jobs（自动并行 + 排队）

自动汇总：best config、学习曲线对比、统计显著性（至少 CI）

5. 功能需求（FR）
FR-1 项目/模板/版本管理

Project CRUD

Template 版本化（变更生成新版本）

从 run 一键“复制为新实验”（产生 config override）

FR-2 训练任务管理（Train）

提交 TrainJob：选择 env/algo/agent/train_spec/plugin/resources/seeds

队列与 GPU 资源分配（单机 4 卡）：并行多个 1-GPU 任务 + 少量 2/4-GPU 任务

自动 checkpoint & resume

失败可诊断（OOM/NaN/env crash/timeout）

FR-3 评测管理（Eval + Protocol）

EvalProtocol 版本化、冻结、复用

EvalJob 独立于 TrainJob（支持同一 snapshot 多协议评测）

EvalResult 自动聚合（多 seed、多局数 CI）

FR-4 MARL 专属（OpponentPool + Matrix）

OpponentPool 版本化、冻结、成员为 PolicySnapshot

MatrixJob 自动生成对战矩阵（并行执行）

输出 winrate/return matrix + CI + 导出

FR-5 可视化（平台体验核心）

Run Detail：曲线（return、winrate、loss、entropy、KL、grad_norm、FPS）、日志、checkpoint 列表

Compare：多 run 曲线对齐（按 env_steps），多 seed 聚合

Job Queue：GPU 占用、排队、暂停/取消

Protocol/Pool/Matrix：协议视图、对手池视图、矩阵热力图

FR-6 产物与复现包

每个 run 自动生成 repro_bundle：包含 config_resolved、env digest、code hash、plugin hash、评测协议引用

产物不可变：同 run_id 不允许覆盖写

FR-7 系统可观测性

GPU/CPU/内存/磁盘、吞吐（FPS）、失败率、队列等待

Grafana 面板（平台链接跳转）

6. 非功能需求（NFR）

可复现：同 repro_bundle 必须可在同镜像复跑

可靠性：服务重启后 job/run 状态可恢复

性能：UI 指标刷新 <2s（训练时）

扩展：后续可接多机（保留接口与数据模型扩展点）

7. 前端页面清单（给 Gemini）

Project Dashboard

Template Library（模板与版本）

Create Train Job（4-tab：Env/Algo/Agent/Train）

Run Detail（实时曲线/日志/ckpt）

Compare Runs（聚合/筛选/对齐）

Job Queue & GPU Monitor

Eval Protocols（创建/版本/冻结）

Opponent Pools（成员管理/冻结）

Cross-play Matrix Viewer（热力图/排名/导出）

Artifacts Browser（下载/标签/复现包）

8. MVP 验收标准（硬指标）

任意 run 能展示：config_resolved、code hash、env digest、seeds、ckpts

EvalProtocol 冻结后，任何评测可复跑一致

MatrixJob 能生成热力图与 csv

至少支持：PPO/SAC（单体）、MAPPO/QMIX（多体）两条主线模板

单机 4 卡能并行运行 ≥3 个 1-GPU 训练任务
