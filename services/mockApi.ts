import {
  type AgenticApproverListResponse,
  type AgenticApprovalPolicyTemplateListResponse,
  type AgenticAuditReplayResponse,
  type AgenticActionResponse,
  type AgenticContractReport,
  type AgenticIdeaInput,
  type AgenticListResponse,
  type AgenticMatrixResponse,
  type AgenticNode,
  type AgenticReproResponse,
  type AgenticRunReportResponse,
  type AgenticRunCreateResponse,
  type AgenticRunDetail,
  type AgenticSearchStats,
  type AgenticRunSummary,
  type AgenticSubAgentListResponse,
  type AgenticSpecValidationResponse,
  JobStatus,
  RunType,
  type Algo,
  type AlgoVersion,
  type ArtifactFile,
  type BootstrapResponse,
  type Checkpoint,
  type Dataset,
  type EnvSpec,
  type EnvVersion,
  type EvalProtocol,
  type EvalProtocolDetail,
  type EvalResult,
  type LogPage,
  type MatrixCell,
  type MatrixResult,
  type ModelVersion,
  type OpponentPool,
  type Plugin,
  type PluginVersion,
  type Project,
  type RegisteredModel,
  type RetentionApplyResponse,
  type RetentionPolicy,
  type Run,
  type RunGroupSummary,
  type RunMetricsResponse,
  type SettingsResponse,
  type SettingsUpdate,
  type StorageUsage,
  type Template,
  type TemplateDetail,
  type TemplateVersion,
  type TokenRotateResponse,
} from '../types';

type JobRecord = {
  id: string;
  runId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  message?: string;
};

type ArtifactRecord = ArtifactFile & {
  content?: string;
  mime?: string;
  externalUrl?: string;
};

type ProtocolSummaryExt = EvalProtocol & {
  scenarioGrid?: Record<string, unknown>;
  opponentSampling?: Record<string, unknown>;
  opponentPoolRef?: { poolId: string; version: string };
};

type DatasetPreview = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
};

type ReplayTeam = {
  id: string;
  name: string;
  color: string;
};

type ReplayUnit = {
  id: string;
  team: string;
  role: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
};

type ReplayEvent = {
  t: number;
  type: 'kill' | 'focus_fire' | 'objective' | 'swing';
  actor: string;
  target?: string;
  text: string;
};

type AdversarialReplay = {
  kind: 'rl_adversarial_replay_v1';
  title: string;
  map: string;
  durationSec: number;
  fps: number;
  seed: number;
  arena: { width: number; height: number };
  teams: ReplayTeam[];
  units: ReplayUnit[];
  events: ReplayEvent[];
};

type DemoState = {
  projects: Project[];
  runs: Run[];
  jobs: JobRecord[];
  logs: Record<string, string[]>;
  checkpoints: Record<string, Checkpoint[]>;
  templates: Template[];
  templateVersions: Record<string, TemplateVersion[]>;
  algos: Algo[];
  algoVersions: Record<string, AlgoVersion[]>;
  envs: EnvSpec[];
  envVersions: Record<string, EnvVersion[]>;
  pools: Array<OpponentPool & { memberSnapshotIds: string[] }>;
  poolVersions: Record<string, OpponentPool[]>;
  protocols: ProtocolSummaryExt[];
  protocolVersions: Record<string, ProtocolSummaryExt[]>;
  protocolDetails: Record<string, EvalProtocolDetail>;
  matrixResults: MatrixResult[];
  evalResults: Record<string, EvalResult>;
  datasets: Dataset[];
  datasetPreviews: Record<string, DatasetPreview>;
  plugins: Plugin[];
  pluginVersions: Record<string, PluginVersion[]>;
  models: RegisteredModel[];
  modelVersions: Record<string, ModelVersion[]>;
  settings: SettingsResponse;
  artifacts: Record<string, ArtifactRecord[]>;
  artifactById: Record<string, ArtifactRecord>;
  runGroupIndex: Record<string, string[]>;
  baseSystemResources: Record<string, unknown>;
  agenticRuns: Record<string, AgenticRunDetail>;
};

const isoMinutesAgo = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const randomToken = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const makeSeries = (points: number, start: number, end: number, variance = 0.05) => {
  const list: Array<{ step: number; value: number }> = [];
  for (let i = 0; i < points; i += 1) {
    const t = points <= 1 ? 1 : i / (points - 1);
    const noise = (Math.random() - 0.5) * variance;
    const raw = start + (end - start) * (1 - Math.exp(-4 * t)) + noise;
    list.push({ step: (i + 1) * 10_000, value: Number(raw.toFixed(4)) });
  }
  return list;
};

const shortId = (id: string) => id.slice(0, 8);

const latestMetric = (run: Run, key: 'returnMean' | 'winRate' | 'entropy') => {
  const series = run.metrics?.[key] || [];
  const tail = series[series.length - 1];
  return typeof tail?.value === 'number' ? tail.value : 0;
};

const computeGroupSummary = (state: DemoState, groupId: string): RunGroupSummary => {
  const members = state.runs.filter(run => {
    const runGroupId = (run as any).groupId || (run.config as any)?.groupId;
    return runGroupId === groupId;
  });
  const statusCounts: Record<string, number> = {};
  members.forEach(run => {
    statusCounts[run.status] = (statusCounts[run.status] || 0) + 1;
  });

  const metricKeys = ['returnMean', 'winRate', 'entropy'];
  const metrics: RunGroupSummary['metrics'] = {};

  metricKeys.forEach(key => {
    const values = members
      .map(run => latestMetric(run, key as 'returnMean' | 'winRate' | 'entropy'))
      .filter(value => Number.isFinite(value));
    if (values.length === 0) return;

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const n = values.length;
    const ci = 1.96 * (std / Math.sqrt(Math.max(1, n)));
    const bestRun = members
      .slice()
      .sort((a, b) => latestMetric(b, key as 'returnMean' | 'winRate' | 'entropy') - latestMetric(a, key as 'returnMean' | 'winRate' | 'entropy'))[0];

    metrics[key] = {
      mean,
      std,
      min,
      max,
      n,
      bestRunId: bestRun?.id,
      ciLow: mean - ci,
      ciHigh: mean + ci,
    };
  });

  return {
    groupId,
    totalRuns: members.length,
    statusCounts,
    metrics,
    runs: members.map(run => ({
      id: run.id,
      name: run.name,
      status: run.status,
      created: run.created,
      algo: run.algo,
      env: run.env,
      seed: (run.config as any)?.seed,
      metrics: {
        returnMean: latestMetric(run, 'returnMean'),
        winRate: latestMetric(run, 'winRate'),
        entropy: latestMetric(run, 'entropy'),
      },
    })),
  };
};

const matrixCellsFromLabels = (labels: string[], metric: string): MatrixCell[] => {
  const cells: MatrixCell[] = [];
  labels.forEach((rowLabel, rowIdx) => {
    labels.forEach((colLabel, colIdx) => {
      const base = rowIdx === colIdx
        ? metric === 'winRate'
          ? 0.5
          : metric === 'survivalTime'
            ? 128
            : 14
        : metric === 'winRate'
          ? 0.45 + (rowIdx - colIdx) * 0.08 + (Math.random() - 0.5) * 0.05
          : metric === 'survivalTime'
            ? 95 + (rowIdx - colIdx) * 6 + (Math.random() - 0.5) * 4
            : 9 + (rowIdx - colIdx) * 2 + (Math.random() - 0.5);
      const bounded = metric === 'winRate'
        ? Math.min(1, Math.max(0, base))
        : Math.max(0, base);
      cells.push({ row: rowLabel, col: colLabel, value: Number(bounded.toFixed(4)) });
    });
  });
  return cells;
};

const toCsv = (cells: MatrixCell[]) => {
  const rows = ['row,col,value'];
  cells.forEach(cell => rows.push(`${cell.row},${cell.col},${cell.value}`));
  return rows.join('\n');
};

const buildSystemMetricsJsonl = (samples: number) => {
  const lines: string[] = [];
  const startTs = Date.now() - samples * 2000;
  for (let i = 0; i < samples; i += 1) {
    const t = i / Math.max(1, samples - 1);
    const gpu0Compute = Number((54 + Math.sin(t * 9) * 17 + (Math.random() - 0.5) * 3).toFixed(2));
    const gpu0Mem = Number((61 + Math.sin(t * 5) * 11 + (Math.random() - 0.5) * 2.5).toFixed(2));
    const gpu1Compute = Number((41 + Math.sin(t * 8 + 0.7) * 14 + (Math.random() - 0.5) * 3).toFixed(2));
    const gpu1Mem = Number((49 + Math.sin(t * 4 + 0.35) * 10 + (Math.random() - 0.5) * 2.5).toFixed(2));
    lines.push(
      JSON.stringify({
        timestamp: startTs + i * 2000,
        cpu_percent: Number((42 + Math.sin(t * 8) * 10 + (Math.random() - 0.5) * 2).toFixed(2)),
        memory_percent: Number((64 + Math.sin(t * 4) * 6 + (Math.random() - 0.5) * 1.5).toFixed(2)),
        gpus: [
          { index: 0, util_gpu: Math.max(0, Math.min(100, gpu0Compute)), util_mem: Math.max(0, Math.min(100, gpu0Mem)) },
          { index: 1, util_gpu: Math.max(0, Math.min(100, gpu1Compute)), util_mem: Math.max(0, Math.min(100, gpu1Mem)) },
        ],
      }),
    );
  }
  return lines.join('\n');
};

const buildRunLogs = (runName: string, status: string) => {
  const lines: string[] = [];
  for (let i = 1; i <= 180; i += 1) {
    lines.push(`[${new Date(Date.now() - (180 - i) * 1500).toISOString()}] ${runName} step=${i * 1000} reward=${(Math.random() * 12).toFixed(3)} win_rate=${(0.35 + Math.random() * 0.6).toFixed(3)}`);
  }
  if (status === JobStatus.FAILED) {
    lines.push('Traceback (most recent call last):');
    lines.push('  File "runner_main.py", line 211, in <module>');
    lines.push("ModuleNotFoundError: No module named 'pettingzoo'");
  }
  return lines;
};

const hashSeed = (text: string) => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${key}:${stableSerialize(nested)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

const mockHash64 = (value: unknown): string => hashSeed(stableSerialize(value)).toString(16).padStart(8, '0').repeat(8);

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const pick = <T>(list: T[], random: () => number) => list[Math.floor(random() * list.length)];

const buildAdversarialReplay = (
  title: string,
  map: string,
  seedKey: string,
  profile: 'train' | 'eval' | 'matrix',
): AdversarialReplay => {
  const seed = hashSeed(seedKey);
  const random = createSeededRandom(seed);
  const arena = { width: 120, height: 80 };
  const durationSec = profile === 'matrix' ? 26 : profile === 'eval' ? 22 : 28;
  const fps = 24;

  const teams: ReplayTeam[] = [
    { id: 'blue', name: 'Blue', color: '#38bdf8' },
    { id: 'red', name: 'Red', color: '#fb7185' },
  ];

  const roles = ['tank', 'striker', 'support', 'flanker'];
  const units: ReplayUnit[] = [];
  for (let i = 0; i < 4; i += 1) {
    units.push({
      id: `b${i + 1}`,
      team: 'blue',
      role: roles[i % roles.length],
      x: 12 + random() * 12,
      y: 10 + i * 16 + random() * 4,
      vx: 0.7 + random() * 0.4,
      vy: (random() - 0.5) * 1.1,
      hp: roles[i % roles.length] === 'tank' ? 160 : 110,
    });
    units.push({
      id: `r${i + 1}`,
      team: 'red',
      role: roles[(i + 1) % roles.length],
      x: arena.width - 12 - random() * 12,
      y: 10 + i * 16 + random() * 4,
      vx: -(0.7 + random() * 0.4),
      vy: (random() - 0.5) * 1.1,
      hp: roles[(i + 1) % roles.length] === 'tank' ? 160 : 110,
    });
  }

  const blueIds = units.filter(unit => unit.team === 'blue').map(unit => unit.id);
  const redIds = units.filter(unit => unit.team === 'red').map(unit => unit.id);
  const events: ReplayEvent[] = [];
  const eventCount = profile === 'matrix' ? 9 : profile === 'eval' ? 8 : 10;

  for (let i = 0; i < eventCount; i += 1) {
    const t = Number((2.3 + i * ((durationSec - 4) / eventCount) + random() * 0.9).toFixed(2));
    const blueActs = random() > 0.45;
    const actor = blueActs ? pick(blueIds, random) : pick(redIds, random);
    const target = blueActs ? pick(redIds, random) : pick(blueIds, random);
    if (i % 4 === 2) {
      events.push({
        t,
        type: 'objective',
        actor,
        text: `${actor.toUpperCase()} secured objective control (+2).`,
      });
    } else if (i % 3 === 1) {
      events.push({
        t,
        type: 'focus_fire',
        actor,
        target,
        text: `${actor.toUpperCase()} and team focused ${target.toUpperCase()}.`,
      });
    } else if (i % 5 === 0) {
      events.push({
        t,
        type: 'swing',
        actor,
        target,
        text: `${actor.toUpperCase()} flipped the skirmish momentum.`,
      });
    } else {
      events.push({
        t,
        type: 'kill',
        actor,
        target,
        text: `${actor.toUpperCase()} eliminated ${target.toUpperCase()}.`,
      });
    }
  }

  return {
    kind: 'rl_adversarial_replay_v1',
    title,
    map,
    durationSec,
    fps,
    seed,
    arena,
    teams,
    units,
    events,
  };
};

const asArtifact = (raw: Partial<ArtifactRecord> & { id: string; name: string; path: string }): ArtifactRecord => ({
  type: 'file',
  size: raw.size || '1.2 MB',
  createdAt: raw.createdAt || isoMinutesAgo(120),
  lastModified: raw.lastModified || isoMinutesAgo(5),
  ...raw,
});

const makeArtifactsForRun = (runId: string, prefix: string, includeVideo = true): ArtifactRecord[] => {
  const artifacts: ArtifactRecord[] = [
    asArtifact({
      id: `${runId}_art_metrics`,
      name: 'metrics.jsonl',
      path: '/metrics/metrics.jsonl',
      size: '420 KB',
      content: JSON.stringify({ runId, message: 'demo metrics placeholder' }, null, 2),
      mime: 'application/json',
    }),
    asArtifact({
      id: `${runId}_art_system_metrics`,
      name: 'system_metrics.jsonl',
      path: '/system/system_metrics.jsonl',
      size: '88 KB',
      content: buildSystemMetricsJsonl(280),
      mime: 'application/json',
    }),
    asArtifact({
      id: `${runId}_art_report`,
      name: `${prefix}_report.md`,
      path: `/reports/${prefix}_report.md`,
      size: '6 KB',
      content: `# ${prefix} report\n\nThis is a demo artifact generated in mock mode.`,
      mime: 'text/markdown',
    }),
  ];

  [200000, 600000, 1200000].forEach(step => {
    artifacts.push(
      asArtifact({
        id: `${runId}_art_ckpt_${step}`,
        name: `ckpt_${step}.json`,
        path: `/checkpoints/ckpt_${step}.json`,
        size: '1.8 MB',
        content: JSON.stringify({ step, score: Number((Math.random() * 12 + 6).toFixed(3)) }, null, 2),
        mime: 'application/json',
      }),
    );
  });

  if (includeVideo) {
    artifacts.push(
      asArtifact({
        id: `${runId}_art_train_replay`,
        name: 'train_episode_001.replay.json',
        path: '/videos/train_episode_001.replay.json',
        size: '92 KB',
        content: JSON.stringify(buildAdversarialReplay(`${prefix} training replay`, 'SMAC 3s5z', `${runId}_train`, 'train')),
        mime: 'application/json',
      }),
    );
    artifacts.push(
      asArtifact({
        id: `${runId}_art_eval_replay`,
        name: 'eval_episode_001.replay.json',
        path: '/videos/eval_episode_001.replay.json',
        size: '88 KB',
        content: JSON.stringify(buildAdversarialReplay(`${prefix} evaluation replay`, 'SMAC 3s5z', `${runId}_eval`, 'eval')),
        mime: 'application/json',
      }),
    );
    if (prefix.toLowerCase().includes('matrix')) {
      artifacts.push(
        asArtifact({
          id: `${runId}_art_matrix_replay`,
          name: 'matrix_matchup_overview.replay.json',
          path: '/videos/matrix/matrix_matchup_overview.replay.json',
          size: '96 KB',
          content: JSON.stringify(buildAdversarialReplay(`${prefix} matrix replay`, 'SMAC 3s5z', `${runId}_matrix`, 'matrix')),
          mime: 'application/json',
        }),
      );
    }
  }

  return artifacts;
};

const byCreatedDesc = <T extends { created?: string; createdAt?: string }>(items: T[]) =>
  items.slice().sort((a, b) => {
    const ta = Date.parse((a.createdAt || a.created || '') as string) || 0;
    const tb = Date.parse((b.createdAt || b.created || '') as string) || 0;
    return tb - ta;
  });

const makeInitialState = (): DemoState => {
  const projectA: Project = {
    id: 'proj_hackathon',
    name: 'Hackathon Champion Stack',
    description: 'Multi-agent policy stack for resilient autonomous fleet coordination.',
    tags: ['hackathon', 'marl', 'production-ready'],
    createdAt: isoMinutesAgo(60 * 24 * 10),
    updatedAt: isoMinutesAgo(22),
    activeRuns: 2,
    totalRuns: 0,
  };

  const projectB: Project = {
    id: 'proj_space_ops',
    name: 'Orbital Ops Research',
    description: 'RL workflows for orbital traffic deconfliction and safe maneuvers.',
    tags: ['space', 'sim2real'],
    createdAt: isoMinutesAgo(60 * 24 * 30),
    updatedAt: isoMinutesAgo(180),
    activeRuns: 0,
    totalRuns: 0,
  };

  const runA1: Run = {
    id: 'run_train_alpha',
    projectId: projectA.id,
    groupId: 'grp_sweep_lr',
    name: 'MAPPO Sweep lr=3e-4 seed=11',
    type: RunType.TRAIN,
    status: JobStatus.SUCCEEDED,
    algo: 'mappo',
    env: 'smac:3s5z',
    gpu: 1,
    created: isoMinutesAgo(350),
    config: {
      seed: 11,
      groupId: 'grp_sweep_lr',
      algo: { algoId: 'mappo', algoVersionId: 'algo_mappo_v3' },
      env: { envId: 'smac', version: '2.4.0', mapSet: '3s5z' },
      train: { totalEnvSteps: 1200000, rolloutLen: 256, batchSize: 4096, lr: 3e-4, entropyCoef: 0.01, gamma: 0.99, gaeLambda: 0.95 },
      network: { hidden: [256, 256], activation: 'relu' },
      resources: { gpus: 1, priority: 2 },
      datasetId: 'ds_human_telemetry',
      git: { repo: 'git@github.com:demo/hackathon-stack.git', branch: 'main', commit: 'cafe4242' },
    },
    metrics: {
      returnMean: makeSeries(120, 1.2, 16.5, 0.5),
      winRate: makeSeries(120, 0.32, 0.82, 0.03),
      entropy: makeSeries(120, 0.95, 0.22, 0.04),
    },
  };

  const runA2: Run = {
    id: 'run_train_bravo',
    projectId: projectA.id,
    groupId: 'grp_sweep_lr',
    name: 'MAPPO Sweep lr=1e-4 seed=19',
    type: RunType.TRAIN,
    status: JobStatus.SUCCEEDED,
    algo: 'mappo',
    env: 'smac:3s5z',
    gpu: 1,
    created: isoMinutesAgo(330),
    config: {
      seed: 19,
      groupId: 'grp_sweep_lr',
      algo: { algoId: 'mappo', algoVersionId: 'algo_mappo_v3' },
      env: { envId: 'smac', version: '2.4.0', mapSet: '3s5z' },
      train: { totalEnvSteps: 1200000, rolloutLen: 256, batchSize: 4096, lr: 1e-4, entropyCoef: 0.012, gamma: 0.99, gaeLambda: 0.95 },
      network: { hidden: [256, 256], activation: 'relu' },
      resources: { gpus: 1, priority: 2 },
      datasetId: 'ds_human_telemetry',
    },
    metrics: {
      returnMean: makeSeries(120, 1.0, 14.2, 0.55),
      winRate: makeSeries(120, 0.28, 0.78, 0.035),
      entropy: makeSeries(120, 1.0, 0.26, 0.045),
    },
  };

  const runA3: Run = {
    id: 'run_train_charlie',
    projectId: projectA.id,
    groupId: 'grp_sweep_lr',
    name: 'MAPPO Sweep lr=5e-4 seed=27',
    type: RunType.TRAIN,
    status: JobStatus.FAILED,
    algo: 'mappo',
    env: 'smac:3s5z',
    gpu: 1,
    created: isoMinutesAgo(300),
    config: {
      seed: 27,
      groupId: 'grp_sweep_lr',
      algo: { algoId: 'mappo', algoVersionId: 'algo_mappo_v3' },
      env: { envId: 'smac', version: '2.4.0', mapSet: '3s5z' },
      train: { totalEnvSteps: 1200000, rolloutLen: 256, batchSize: 4096, lr: 5e-4, entropyCoef: 0.008, gamma: 0.99, gaeLambda: 0.95 },
      network: { hidden: [512, 512], activation: 'relu' },
      resources: { gpus: 1, priority: 2 },
      datasetId: 'ds_human_telemetry',
    },
    metrics: {
      returnMean: makeSeries(50, 1.1, 8.1, 0.6),
      winRate: makeSeries(50, 0.29, 0.58, 0.05),
      entropy: makeSeries(50, 1.05, 0.42, 0.06),
    },
  };

  const runA4: Run = {
    id: 'run_train_live',
    projectId: projectA.id,
    name: 'QMix RNN continuous training',
    type: RunType.TRAIN,
    status: JobStatus.RUNNING,
    algo: 'qmix',
    env: 'smac:6h_vs_8z',
    gpu: 2,
    created: isoMinutesAgo(75),
    config: {
      seed: 44,
      algo: { algoId: 'qmix', algoVersionId: 'algo_qmix_v2' },
      env: { envId: 'smac', version: '2.4.0', mapSet: '6h_vs_8z' },
      train: { totalEnvSteps: 2400000, rolloutLen: 128, batchSize: 2048, lr: 2e-4, entropyCoef: 0.0, gamma: 0.995, gaeLambda: 0.95 },
      network: { hidden: [512, 512], activation: 'gelu' },
      resources: { gpus: 2, priority: 1 },
    },
    metrics: {
      returnMean: makeSeries(65, 1.8, 12.8, 0.5),
      winRate: makeSeries(65, 0.22, 0.63, 0.04),
      entropy: makeSeries(65, 0.82, 0.31, 0.05),
    },
  };

  const runA5: Run = {
    id: 'run_train_queue',
    projectId: projectA.id,
    name: 'PPO ablation no-opponent-prior',
    type: RunType.TRAIN,
    status: JobStatus.PENDING,
    algo: 'ppo',
    env: 'mpe:simple_spread',
    gpu: 1,
    created: isoMinutesAgo(12),
    config: {
      seed: 101,
      algo: { algoId: 'ppo', algoVersionId: 'algo_ppo_v5' },
      env: { envId: 'mpe', version: '1.3.0', mapSet: 'simple_spread' },
      train: { totalEnvSteps: 600000, rolloutLen: 128, batchSize: 1024, lr: 2.5e-4, entropyCoef: 0.02, gamma: 0.99, gaeLambda: 0.95 },
      network: { hidden: [128, 128], activation: 'tanh' },
      resources: { gpus: 1, priority: 3 },
    },
    metrics: {
      returnMean: [],
      winRate: [],
      entropy: [],
    },
  };

  const runEval: Run = {
    id: 'run_eval_alpha',
    projectId: projectA.id,
    name: 'Eval: MAPPO v3 vs Champion Pool',
    type: RunType.EVAL,
    status: JobStatus.SUCCEEDED,
    algo: 'mappo',
    env: 'smac:3s5z',
    gpu: 1,
    created: isoMinutesAgo(110),
    config: {
      protocolId: 'proto_competitive',
      evalResultId: 'eval_result_alpha',
      policySnapshotId: 'run_train_alpha_ckpt_1200000',
    },
    metrics: {
      returnMean: makeSeries(20, 12.8, 13.7, 0.2),
      winRate: makeSeries(20, 0.74, 0.81, 0.015),
      entropy: makeSeries(20, 0.32, 0.27, 0.01),
    },
  };

  const runMatrix: Run = {
    id: 'run_matrix_alpha',
    projectId: projectA.id,
    name: 'Matrix: Season 3 Champions',
    type: RunType.MATRIX,
    status: JobStatus.SUCCEEDED,
    algo: 'matrix',
    env: 'smac:3s5z',
    gpu: 1,
    created: isoMinutesAgo(96),
    config: {
      protocolId: 'proto_competitive',
      poolId: 'pool_champion',
      matrixId: 'matrix_alpha',
      metric: 'winRate',
    },
    metrics: {
      returnMean: [],
      winRate: [],
      entropy: [],
    },
  };

  const notebookRun: Run = {
    id: 'run_notebook_alpha',
    projectId: projectA.id,
    name: 'Notebook: Feature Diagnostics',
    type: 'NOTEBOOK' as any,
    status: JobStatus.RUNNING,
    algo: 'notebook',
    env: 'python',
    gpu: 0,
    created: isoMinutesAgo(28),
    config: {
      url: 'https://jupyter.org/try-jupyter/lab/',
      token: 'demo-token',
    },
    metrics: {
      returnMean: [],
      winRate: [],
      entropy: [],
    },
  };

  const runSpace: Run = {
    id: 'run_train_orbit_01',
    projectId: projectB.id,
    name: 'Orbit PPO baseline',
    type: RunType.TRAIN,
    status: JobStatus.SUCCEEDED,
    algo: 'ppo',
    env: 'orbitzoo:leo_avoidance',
    gpu: 1,
    created: isoMinutesAgo(860),
    config: {
      seed: 5,
      algo: { algoId: 'ppo', algoVersionId: 'algo_ppo_v5' },
      env: { envId: 'orbitzoo', version: '0.9.0', mapSet: 'leo_avoidance' },
      train: { totalEnvSteps: 400000, rolloutLen: 128, batchSize: 512, lr: 1.2e-4, entropyCoef: 0.01, gamma: 0.99, gaeLambda: 0.95 },
      network: { hidden: [256, 256], activation: 'tanh' },
      resources: { gpus: 1, priority: 2 },
    },
    metrics: {
      returnMean: makeSeries(80, 2.4, 9.2, 0.3),
      winRate: makeSeries(80, 0.31, 0.67, 0.025),
      entropy: makeSeries(80, 0.74, 0.28, 0.03),
    },
  };

  const runs = [
    runA1,
    runA2,
    runA3,
    runA4,
    runA5,
    runEval,
    runMatrix,
    notebookRun,
    runSpace,
  ];

  const checkpoints: Record<string, Checkpoint[]> = {
    [runA1.id]: [
      { id: 'run_train_alpha_ckpt_200000', runId: runA1.id, step: 200000, metrics: { returnMean: 8.44, winRate: 0.61 }, path: '/checkpoints/ckpt_200000.json', tags: [], createdAt: isoMinutesAgo(310) },
      { id: 'run_train_alpha_ckpt_600000', runId: runA1.id, step: 600000, metrics: { returnMean: 12.02, winRate: 0.73 }, path: '/checkpoints/ckpt_600000.json', tags: [], createdAt: isoMinutesAgo(280) },
      { id: 'run_train_alpha_ckpt_1200000', runId: runA1.id, step: 1200000, metrics: { returnMean: 16.42, winRate: 0.82 }, path: '/checkpoints/ckpt_1200000.json', tags: ['best', 'prod_candidate'], createdAt: isoMinutesAgo(240) },
    ],
    [runA2.id]: [
      { id: 'run_train_bravo_ckpt_200000', runId: runA2.id, step: 200000, metrics: { returnMean: 7.94, winRate: 0.58 }, path: '/checkpoints/ckpt_200000.json', tags: [], createdAt: isoMinutesAgo(300) },
      { id: 'run_train_bravo_ckpt_600000', runId: runA2.id, step: 600000, metrics: { returnMean: 11.11, winRate: 0.69 }, path: '/checkpoints/ckpt_600000.json', tags: ['best'], createdAt: isoMinutesAgo(270) },
      { id: 'run_train_bravo_ckpt_1200000', runId: runA2.id, step: 1200000, metrics: { returnMean: 14.10, winRate: 0.77 }, path: '/checkpoints/ckpt_1200000.json', tags: [], createdAt: isoMinutesAgo(220) },
    ],
    [runA4.id]: [
      { id: 'run_train_live_ckpt_200000', runId: runA4.id, step: 200000, metrics: { returnMean: 7.31, winRate: 0.48 }, path: '/checkpoints/ckpt_200000.json', tags: [], createdAt: isoMinutesAgo(65) },
      { id: 'run_train_live_ckpt_500000', runId: runA4.id, step: 500000, metrics: { returnMean: 10.22, winRate: 0.56 }, path: '/checkpoints/ckpt_500000.json', tags: ['latest'], createdAt: isoMinutesAgo(20) },
    ],
    [runSpace.id]: [
      { id: 'run_train_orbit_01_ckpt_200000', runId: runSpace.id, step: 200000, metrics: { returnMean: 6.92, winRate: 0.55 }, path: '/checkpoints/ckpt_200000.json', tags: [], createdAt: isoMinutesAgo(780) },
      { id: 'run_train_orbit_01_ckpt_400000', runId: runSpace.id, step: 400000, metrics: { returnMean: 9.21, winRate: 0.67 }, path: '/checkpoints/ckpt_400000.json', tags: ['best'], createdAt: isoMinutesAgo(760) },
    ],
  };

  const jobs: JobRecord[] = [
    { id: 'job_train_live', runId: runA4.id, status: JobStatus.RUNNING, createdAt: isoMinutesAgo(75), updatedAt: isoMinutesAgo(1) },
    { id: 'job_train_queue', runId: runA5.id, status: JobStatus.PENDING, createdAt: isoMinutesAgo(12), updatedAt: isoMinutesAgo(12), message: 'queued: waiting for GPU slot' },
    { id: 'job_notebook_alpha', runId: notebookRun.id, status: JobStatus.RUNNING, createdAt: isoMinutesAgo(28), updatedAt: isoMinutesAgo(1), message: 'workspace alive' },
  ];

  const algos: Algo[] = [
    { id: 'mappo', name: 'MAPPO', description: 'Multi-agent PPO with parameter sharing and centralized critic.', archived: false },
    { id: 'qmix', name: 'QMIX-RNN', description: 'Value factorization with recurrent coordination modules.', archived: false },
    { id: 'ppo', name: 'PPO', description: 'Stable single-agent baseline for ablations.', archived: false },
    { id: 'offline_bc', name: 'Offline BC', description: 'Behavior cloning warm-start from replay datasets.', archived: true },
  ];

  const sharedSchema = {
    type: 'object',
    properties: {
      train: {
        type: 'object',
        properties: {
          totalEnvSteps: { type: 'number', title: 'Total Env Steps', minimum: 10000 },
          rolloutLen: { type: 'number', title: 'Rollout Length', minimum: 16 },
          batchSize: { type: 'number', title: 'Batch Size', minimum: 64 },
          lr: { type: 'number', title: 'Learning Rate', minimum: 0.00001, maximum: 0.01 },
          entropyCoef: { type: 'number', title: 'Entropy Coef', minimum: 0, maximum: 1 },
          gamma: { type: 'number', title: 'Gamma', minimum: 0.8, maximum: 0.9999 },
          gaeLambda: { type: 'number', title: 'GAE Lambda', minimum: 0.8, maximum: 1.0 },
        },
      },
      network: {
        type: 'object',
        properties: {
          hidden: { type: 'array', title: 'Hidden Layers' },
          activation: { type: 'string', title: 'Activation', enum: ['relu', 'tanh', 'gelu', 'elu'] },
        },
      },
      env: {
        type: 'object',
        properties: {
          maxCycles: { type: 'number', title: 'Max Cycles', minimum: 10, maximum: 2000 },
          continuousActions: { type: 'boolean', title: 'Continuous Actions' },
        },
      },
      datasetId: { type: 'string', title: 'Dataset ID' },
    },
  };

  const algoVersions: Record<string, AlgoVersion[]> = {
    mappo: [
      {
        id: 'algo_mappo_v3',
        algoId: 'mappo',
        version: '3.1.0',
        entrypoint: 'algorithms.mappo.train:run',
        package: 'rl-platform-mappo==3.1.0',
        configSchema: sharedSchema,
        defaultConfig: {
          train: { totalEnvSteps: 1200000, rolloutLen: 256, batchSize: 4096, lr: 3e-4, entropyCoef: 0.01, gamma: 0.99, gaeLambda: 0.95 },
          network: { hidden: [256, 256], activation: 'relu' },
          env: { maxCycles: 400, continuousActions: false },
        },
        resourceProfile: { gpu: 1, cpu: 8, ramGb: 24 },
        envConstraints: { apiMode: 'pettingzoo' },
        metadata: { runtimePackages: ['pettingzoo>=1.24.0', 'supersuit>=3.9.0'] },
        active: true,
        frozen: true,
        createdAt: isoMinutesAgo(60 * 24 * 12),
      },
      {
        id: 'algo_mappo_v2',
        algoId: 'mappo',
        version: '2.9.0',
        entrypoint: 'algorithms.mappo.train:run',
        package: 'rl-platform-mappo==2.9.0',
        configSchema: sharedSchema,
        defaultConfig: {
          train: { totalEnvSteps: 900000, rolloutLen: 256, batchSize: 3072, lr: 2.8e-4, entropyCoef: 0.015, gamma: 0.99, gaeLambda: 0.95 },
          network: { hidden: [256, 256], activation: 'relu' },
        },
        metadata: { runtimePackages: ['pettingzoo>=1.23.0'] },
        active: false,
        frozen: true,
        createdAt: isoMinutesAgo(60 * 24 * 26),
      },
    ],
    qmix: [
      {
        id: 'algo_qmix_v2',
        algoId: 'qmix',
        version: '2.3.1',
        entrypoint: 'algorithms.qmix.train:run',
        package: 'rl-platform-qmix==2.3.1',
        configSchema: sharedSchema,
        defaultConfig: {
          train: { totalEnvSteps: 2400000, rolloutLen: 128, batchSize: 2048, lr: 2e-4, entropyCoef: 0.0, gamma: 0.995, gaeLambda: 0.95 },
          network: { hidden: [512, 512], activation: 'gelu' },
        },
        metadata: { runtimePackages: ['torch>=2.3.0'] },
        active: true,
        frozen: true,
        createdAt: isoMinutesAgo(60 * 24 * 8),
      },
    ],
    ppo: [
      {
        id: 'algo_ppo_v5',
        algoId: 'ppo',
        version: '5.0.0',
        entrypoint: 'algorithms.ppo.train:run',
        package: 'stable-baselines3==2.4.0',
        configSchema: sharedSchema,
        defaultConfig: {
          train: { totalEnvSteps: 600000, rolloutLen: 128, batchSize: 1024, lr: 2.5e-4, entropyCoef: 0.02, gamma: 0.99, gaeLambda: 0.95 },
          network: { hidden: [128, 128], activation: 'tanh' },
        },
        active: true,
        frozen: false,
        createdAt: isoMinutesAgo(60 * 24 * 3),
      },
    ],
    offline_bc: [
      {
        id: 'algo_offline_bc_v1',
        algoId: 'offline_bc',
        version: '1.0.0',
        entrypoint: 'algorithms.offline.bc:run',
        configSchema: sharedSchema,
        defaultConfig: { train: { totalEnvSteps: 120000, batchSize: 512, lr: 1e-4 } },
        active: false,
        frozen: true,
        createdAt: isoMinutesAgo(60 * 24 * 90),
      },
    ],
  };

  const envs: EnvSpec[] = [
    { id: 'smac', versions: ['2.4.0', '2.3.1'], maps: ['3s5z', '6h_vs_8z'], archived: false },
    { id: 'mpe', versions: ['1.3.0'], maps: ['simple_spread', 'simple_tag'], archived: false },
    { id: 'orbitzoo', versions: ['0.9.0'], maps: ['leo_avoidance'], archived: false },
    { id: 'legacy_gridworld', versions: ['0.4.2'], maps: ['default'], archived: true },
  ];

  const envVersions: Record<string, EnvVersion[]> = {
    smac: [
      {
        envId: 'smac',
        version: '2.4.0',
        apiMode: 'pettingzoo',
        entrypoint: 'envs.smac:make_env',
        package: 'smacv2>=2.4.0',
        active: true,
        frozen: true,
        mapSets: [
          { id: '3s5z', maps: ['3s5z'] },
          { id: '6h_vs_8z', maps: ['6h_vs_8z'] },
        ],
        scenarioSchema: {
          type: 'object',
          properties: {
            delay: { type: 'string', enum: ['low', 'mid', 'high'] },
            fog: { type: 'boolean' },
          },
        },
      },
      {
        envId: 'smac',
        version: '2.3.1',
        apiMode: 'pettingzoo',
        entrypoint: 'envs.smac:make_env',
        package: 'smacv2==2.3.1',
        active: false,
        frozen: true,
        mapSets: [{ id: '3s5z', maps: ['3s5z'] }],
      },
    ],
    mpe: [
      {
        envId: 'mpe',
        version: '1.3.0',
        apiMode: 'pettingzoo',
        entrypoint: 'envs.mpe:make_env',
        package: 'pettingzoo[mpe]>=1.24.0',
        active: true,
        frozen: false,
        mapSets: [
          { id: 'simple_spread', maps: ['simple_spread'] },
          { id: 'simple_tag', maps: ['simple_tag'] },
        ],
      },
    ],
    orbitzoo: [
      {
        envId: 'orbitzoo',
        version: '0.9.0',
        apiMode: 'gym',
        entrypoint: 'envs.orbitzoo:make_env',
        package: 'orbitzoo==0.9.0',
        active: true,
        frozen: true,
        mapSets: [{ id: 'leo_avoidance', maps: ['leo_avoidance'] }],
      },
    ],
    legacy_gridworld: [
      {
        envId: 'legacy_gridworld',
        version: '0.4.2',
        apiMode: 'gym',
        entrypoint: 'envs.gridworld:make_env',
        package: 'gridworld==0.4.2',
        active: false,
        frozen: true,
        mapSets: [{ id: 'default', maps: ['default'] }],
      },
    ],
  };

  const templates: Template[] = [
    {
      id: 'tmpl_quick_run',
      projectId: projectA.id,
      name: 'Quick Run',
      description: 'System template for one-click demos.',
      type: 'Multi-Agent',
      defaultConfig: {
        train: { totalEnvSteps: 300000, rolloutLen: 128, batchSize: 2048, lr: 3e-4 },
      },
      archived: false,
    },
    {
      id: 'tmpl_competitive_mappo',
      projectId: projectA.id,
      name: 'Competitive MAPPO',
      description: 'Baseline for SMAC competition maps.',
      type: 'Multi-Agent',
      defaultConfig: {
        train: { totalEnvSteps: 1200000, rolloutLen: 256, batchSize: 4096, lr: 3e-4 },
        network: { hidden: [256, 256], activation: 'relu' },
      },
      archived: false,
    },
    {
      id: 'tmpl_orbit_safe_ppo',
      projectId: projectB.id,
      name: 'Orbit Safe PPO',
      description: 'Risk-averse policy template for orbital scenario.',
      type: 'Single-Agent',
      defaultConfig: {
        train: { totalEnvSteps: 400000, rolloutLen: 128, batchSize: 1024, lr: 1.2e-4 },
      },
      archived: false,
    },
  ];

  const templateVersions: Record<string, TemplateVersion[]> = {
    tmpl_quick_run: [
      {
        id: 'tmpl_quick_run_v1',
        templateId: 'tmpl_quick_run',
        algoVersionId: 'algo_mappo_v3',
        version: '1.0.0',
        defaultConfig: { train: { totalEnvSteps: 300000, rolloutLen: 128, batchSize: 2048, lr: 3e-4 } },
        createdAt: isoMinutesAgo(60 * 24 * 20),
        frozen: true,
      },
    ],
    tmpl_competitive_mappo: [
      {
        id: 'tmpl_comp_mappo_v2',
        templateId: 'tmpl_competitive_mappo',
        algoVersionId: 'algo_mappo_v3',
        version: '2.1.0',
        defaultConfig: { train: { totalEnvSteps: 1200000, rolloutLen: 256, batchSize: 4096, lr: 3e-4 } },
        createdAt: isoMinutesAgo(60 * 24 * 9),
        frozen: true,
      },
      {
        id: 'tmpl_comp_mappo_v1',
        templateId: 'tmpl_competitive_mappo',
        algoVersionId: 'algo_mappo_v2',
        version: '1.8.0',
        defaultConfig: { train: { totalEnvSteps: 900000, rolloutLen: 256, batchSize: 3072, lr: 2.8e-4 } },
        createdAt: isoMinutesAgo(60 * 24 * 24),
        frozen: true,
      },
    ],
    tmpl_orbit_safe_ppo: [
      {
        id: 'tmpl_orbit_v1',
        templateId: 'tmpl_orbit_safe_ppo',
        algoVersionId: 'algo_ppo_v5',
        version: '1.0.0',
        defaultConfig: { train: { totalEnvSteps: 400000, rolloutLen: 128, batchSize: 1024, lr: 1.2e-4 } },
        createdAt: isoMinutesAgo(60 * 24 * 28),
        frozen: false,
      },
    ],
  };

  const pools: Array<OpponentPool & { memberSnapshotIds: string[] }> = [
    {
      id: 'pool_champion',
      poolKey: 'champion',
      name: 'Champion Pool',
      version: '1.1.0',
      size: 4,
      env: 'smac',
      frozen: true,
      created: isoMinutesAgo(200),
      memberSnapshotIds: [
        'run_train_alpha_ckpt_1200000',
        'run_train_bravo_ckpt_1200000',
        'run_train_live_ckpt_500000',
        'run_train_orbit_01_ckpt_400000',
      ],
    },
    {
      id: 'pool_baseline',
      poolKey: 'baseline',
      name: 'Baseline Pool',
      version: '1.0.0',
      size: 2,
      env: 'smac',
      frozen: false,
      created: isoMinutesAgo(320),
      memberSnapshotIds: ['run_train_alpha_ckpt_600000', 'run_train_bravo_ckpt_600000'],
    },
  ];

  const poolVersions: Record<string, OpponentPool[]> = {
    pool_champion: [
      { ...clone(pools[0]), version: '1.1.0', size: 4 },
      { ...clone(pools[0]), version: '1.0.0', size: 3 },
    ],
    pool_baseline: [
      { ...clone(pools[1]), version: '1.0.0', size: 2 },
    ],
  };

  const protocolCompetitive: ProtocolSummaryExt = {
    id: 'proto_competitive',
    protocolKey: 'smac_ladder',
    name: 'SMAC Ladder',
    version: '1.2.0',
    envId: 'smac',
    map: '3s5z',
    evalSeeds: [1, 2, 3, 4],
    episodes: 32,
    frozen: true,
    created: isoMinutesAgo(210),
    scenarioGrid: {
      axes: {
        fog: [false, true],
        delay: ['low', 'mid', 'high'],
      },
    },
    opponentSampling: {
      strategy: 'elo_weighted',
      minMatches: 6,
    },
    opponentPoolRef: {
      poolId: 'pool_champion',
      version: '1.1.0',
    },
  };

  const protocolStress: ProtocolSummaryExt = {
    id: 'proto_stress_test',
    protocolKey: 'stress_suite',
    name: 'Stress Suite',
    version: '0.9.0',
    envId: 'smac',
    map: '6h_vs_8z',
    evalSeeds: [1, 2, 3],
    episodes: 24,
    frozen: false,
    created: isoMinutesAgo(44),
    scenarioGrid: {
      scenarios: [
        { turbulence: 'low', jitter: 0.05 },
        { turbulence: 'mid', jitter: 0.12 },
        { turbulence: 'high', jitter: 0.2 },
      ],
    },
    opponentSampling: undefined,
  };

  const protocols: ProtocolSummaryExt[] = [protocolCompetitive, protocolStress];

  const protocolVersions: Record<string, ProtocolSummaryExt[]> = {
    proto_competitive: [
      clone(protocolCompetitive),
      {
        ...clone(protocolCompetitive),
        version: '1.1.0',
        created: isoMinutesAgo(360),
      },
    ],
    proto_stress_test: [clone(protocolStress)],
  };

  const protocolDetails: Record<string, EvalProtocolDetail> = {
    proto_competitive: {
      id: protocolCompetitive.id,
      protocolKey: protocolCompetitive.protocolKey,
      name: protocolCompetitive.name,
      version: protocolCompetitive.version,
      env: { envId: protocolCompetitive.envId, version: '2.4.0', mapSet: protocolCompetitive.map },
      evalSeeds: protocolCompetitive.evalSeeds,
      episodesPerMatch: protocolCompetitive.episodes,
      timeoutSec: 120,
      metrics: ['winRate', 'returnMean'],
      opponentPoolRef: protocolCompetitive.opponentPoolRef,
      scenarioGrid: protocolCompetitive.scenarioGrid,
      opponentSampling: protocolCompetitive.opponentSampling,
      frozen: true,
      createdAt: protocolCompetitive.created,
    } as any,
    proto_stress_test: {
      id: protocolStress.id,
      protocolKey: protocolStress.protocolKey,
      name: protocolStress.name,
      version: protocolStress.version,
      env: { envId: protocolStress.envId, version: '2.4.0', mapSet: protocolStress.map },
      evalSeeds: protocolStress.evalSeeds,
      episodesPerMatch: protocolStress.episodes,
      timeoutSec: 140,
      metrics: ['winRate', 'returnMean', 'survivalTime'],
      scenarioGrid: protocolStress.scenarioGrid,
      opponentSampling: protocolStress.opponentSampling,
      frozen: false,
      createdAt: protocolStress.created,
    } as any,
  };

  const labels = ['mappo_v3', 'qmix_v2', 'ppo_v5', 'champion_bot'];
  const matrixCells = matrixCellsFromLabels(labels, 'winRate');
  const matrixCellsReturn = matrixCellsFromLabels(labels, 'returnMean');

  const matrixAlpha: MatrixResult = {
    id: 'matrix_alpha',
    protocolId: 'proto_competitive',
    poolId: 'pool_champion',
    createdAt: isoMinutesAgo(96),
    cells: matrixCells,
    labels,
    matrix: labels.map(row => labels.map(col => matrixCells.find(cell => cell.row === row && cell.col === col)?.value || 0)),
    meta: { gamesPerPair: 12, seeds: [1, 2, 3, 4], metric: 'winRate' },
    ranking: [
      { id: 'mappo_v3', score: 0.72 },
      { id: 'qmix_v2', score: 0.63 },
      { id: 'ppo_v5', score: 0.52 },
      { id: 'champion_bot', score: 0.49 },
    ],
    summary: {
      note: 'Demo matrix summary',
      replay: buildAdversarialReplay('Matrix: Champion Pool Cross-Play', 'SMAC 3s5z', 'matrix_alpha_summary', 'matrix'),
    },
    exportUrl: '',
  };

  const matrixAlphaReturn: MatrixResult = {
    id: 'matrix_alpha_return',
    protocolId: 'proto_competitive',
    poolId: 'pool_champion',
    createdAt: isoMinutesAgo(130),
    cells: matrixCellsReturn,
    labels,
    matrix: labels.map(row => labels.map(col => matrixCellsReturn.find(cell => cell.row === row && cell.col === col)?.value || 0)),
    meta: { gamesPerPair: 12, seeds: [1, 2, 3, 4], metric: 'returnMean' },
    ranking: [
      { id: 'mappo_v3', score: 15.3 },
      { id: 'qmix_v2', score: 13.6 },
      { id: 'ppo_v5', score: 10.8 },
      { id: 'champion_bot', score: 9.9 },
    ],
    summary: {
      note: 'return matrix demo',
      replay: buildAdversarialReplay('Matrix: Return Mean Replay', 'SMAC 3s5z', 'matrix_alpha_return_summary', 'matrix'),
    },
    exportUrl: '',
  };

  const matrixResults: MatrixResult[] = [
    {
      ...matrixAlpha,
      exportUrl: `data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(matrixAlpha.cells))}`,
    },
    {
      ...matrixAlphaReturn,
      exportUrl: `data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(matrixAlphaReturn.cells))}`,
    },
  ];

  const evalResults: Record<string, EvalResult> = {
    eval_result_alpha: {
      id: 'eval_result_alpha',
      runId: runEval.id,
      protocolId: 'proto_competitive',
      metrics: {
        winRate: 0.804,
        returnMean: 13.64,
        survivalTime: 132.4,
      },
      summary: {
        mean: 0.804,
        std: 0.051,
        n: 128,
      },
      ci: {
        low: 0.771,
        high: 0.832,
        level: 0.95,
      },
      createdAt: isoMinutesAgo(108),
      artifactUrl: 'https://example.com/eval-result-alpha',
    },
  };

  const datasets: Dataset[] = [
    {
      id: 'ds_human_telemetry',
      name: 'human-telemetry-v2',
      description: 'Expert traces from finalist scrimmages.',
      path: 's3://rl-demo/human-telemetry-v2.jsonl',
      format: 'jsonl',
      sizeBytes: 1024 * 1024 * 512,
      createdAt: isoMinutesAgo(60 * 24 * 14),
    },
    {
      id: 'ds_orbit_ops',
      name: 'orbit-ops-scenarios',
      description: 'Trajectory and conflict windows.',
      path: '/mnt/datasets/orbit_ops.parquet',
      format: 'parquet',
      sizeBytes: 1024 * 1024 * 220,
      createdAt: isoMinutesAgo(60 * 24 * 40),
    },
  ];

  const datasetPreviews: Record<string, DatasetPreview> = {
    ds_human_telemetry: {
      columns: ['episode_id', 'agent_id', 'obs_norm', 'action', 'reward'],
      totalRows: 128000,
      rows: [
        { episode_id: 1, agent_id: 'alpha_1', obs_norm: 0.61, action: 'advance', reward: 0.22 },
        { episode_id: 1, agent_id: 'alpha_2', obs_norm: 0.54, action: 'cover', reward: 0.18 },
        { episode_id: 1, agent_id: 'alpha_3', obs_norm: 0.49, action: 'flank', reward: 0.35 },
        { episode_id: 2, agent_id: 'beta_1', obs_norm: 0.58, action: 'retreat', reward: -0.08 },
      ],
    },
    ds_orbit_ops: {
      columns: ['object_id', 'time_to_conjunction', 'delta_v', 'risk_score'],
      totalRows: 24500,
      rows: [
        { object_id: 'SAT-019', time_to_conjunction: 420, delta_v: 0.13, risk_score: 0.72 },
        { object_id: 'SAT-441', time_to_conjunction: 190, delta_v: 0.31, risk_score: 0.84 },
        { object_id: 'SAT-112', time_to_conjunction: 920, delta_v: 0.05, risk_score: 0.44 },
      ],
    },
  };

  const plugins: Plugin[] = [
    {
      id: 'plugin_reward_shaper',
      name: 'Reward Shaper Toolkit',
      version: '2.1.0',
      type: 'Wrapper',
      description: 'Composable reward terms with weighted schedules.',
      author: 'Platform Team',
      installed: true,
      archived: false,
    },
    {
      id: 'plugin_rllib_bridge',
      name: 'RLLib Bridge',
      version: '1.4.2',
      type: 'Algorithm',
      description: 'Runner bridge for custom RLLib pipelines.',
      author: 'Infra Guild',
      installed: true,
      archived: false,
    },
    {
      id: 'plugin_lora_policy',
      name: 'LoRA Policy Adapter',
      version: '0.3.0',
      type: 'Model',
      description: 'Low-rank adapters for policy transfer.',
      author: 'Applied RL',
      installed: false,
      archived: false,
    },
  ];

  const pluginVersions: Record<string, PluginVersion[]> = {
    plugin_reward_shaper: [
      { pluginId: 'plugin_reward_shaper', version: '2.1.0', wheelUri: 's3://plugins/reward_shaper-2.1.0.whl', sha256: 'sha256-demo-rs210', manifest: { hooks: ['reward_pre_step', 'reward_post_step'] }, frozen: true },
      { pluginId: 'plugin_reward_shaper', version: '2.0.0', wheelUri: 's3://plugins/reward_shaper-2.0.0.whl', sha256: 'sha256-demo-rs200', frozen: true },
    ],
    plugin_rllib_bridge: [
      { pluginId: 'plugin_rllib_bridge', version: '1.4.2', wheelUri: 's3://plugins/rllib_bridge-1.4.2.whl', sha256: 'sha256-demo-rb142', frozen: true },
    ],
    plugin_lora_policy: [
      { pluginId: 'plugin_lora_policy', version: '0.3.0', wheelUri: 's3://plugins/lora_policy-0.3.0.whl', sha256: 'sha256-demo-lora030', frozen: false },
    ],
  };

  const models: RegisteredModel[] = [
    {
      id: 'model_champion_mappo',
      name: 'Champion MAPPO Family',
      description: 'Production candidate policies for SMAC leaderboard.',
      createdAt: isoMinutesAgo(60 * 24 * 15),
      updatedAt: isoMinutesAgo(75),
    },
    {
      id: 'model_orbit_guardian',
      name: 'Orbit Guardian Family',
      description: 'Safe maneuver policies for orbital operations.',
      createdAt: isoMinutesAgo(60 * 24 * 35),
      updatedAt: isoMinutesAgo(700),
    },
  ];

  const modelVersions: Record<string, ModelVersion[]> = {
    model_champion_mappo: [
      {
        id: 'model_champion_mappo_v7',
        modelId: 'model_champion_mappo',
        version: 7,
        checkpointId: 'run_train_alpha_ckpt_1200000',
        stage: 'Production',
        createdAt: isoMinutesAgo(70),
      },
      {
        id: 'model_champion_mappo_v6',
        modelId: 'model_champion_mappo',
        version: 6,
        checkpointId: 'run_train_bravo_ckpt_1200000',
        stage: 'Staging',
        createdAt: isoMinutesAgo(140),
      },
    ],
    model_orbit_guardian: [
      {
        id: 'model_orbit_guardian_v3',
        modelId: 'model_orbit_guardian',
        version: 3,
        checkpointId: 'run_train_orbit_01_ckpt_400000',
        stage: 'Production',
        createdAt: isoMinutesAgo(680),
      },
    ],
  };

  const settings: SettingsResponse = {
    apiToken: 'sk-demo-platform-2026',
    executor: {
      mode: 'local',
      localGpuCount: 4,
      localExecutorMode: 'mock',
      determinedMasterUrl: 'http://determined.mock.internal:8080',
      determinedConnected: true,
      determinedMock: true,
      scheduler: 'Priority FIFO',
    },
    storage: {
      artifactBytes: 1024 * 1024 * 1024 * 18,
      dbBytes: 1024 * 1024 * 1024 * 2.4,
    } as StorageUsage,
    retention: {
      checkpointPolicy: 'best_latest_5',
    } as RetentionPolicy,
  };

  const artifacts: Record<string, ArtifactRecord[]> = {
    [runA1.id]: makeArtifactsForRun(runA1.id, 'train_alpha', true),
    [runA2.id]: makeArtifactsForRun(runA2.id, 'train_bravo', true),
    [runA3.id]: makeArtifactsForRun(runA3.id, 'train_charlie', false),
    [runA4.id]: makeArtifactsForRun(runA4.id, 'train_live', true),
    [runEval.id]: makeArtifactsForRun(runEval.id, 'eval_alpha', true),
    [runMatrix.id]: makeArtifactsForRun(runMatrix.id, 'matrix_alpha', true),
    [runSpace.id]: makeArtifactsForRun(runSpace.id, 'orbit_safe', false),
  };

  const artifactById: Record<string, ArtifactRecord> = {};
  Object.values(artifacts).forEach(list => {
    list.forEach(item => {
      artifactById[item.id] = item;
    });
  });

  const logs: Record<string, string[]> = {
    [runA1.id]: buildRunLogs(runA1.name, runA1.status),
    [runA2.id]: buildRunLogs(runA2.name, runA2.status),
    [runA3.id]: buildRunLogs(runA3.name, runA3.status),
    [runA4.id]: buildRunLogs(runA4.name, runA4.status),
    [runA5.id]: ['Queued by scheduler, waiting for GPU slot...', 'Estimated wait: 2m 10s'],
    [runEval.id]: buildRunLogs(runEval.name, runEval.status),
    [runMatrix.id]: buildRunLogs(runMatrix.name, runMatrix.status),
    [runSpace.id]: buildRunLogs(runSpace.name, runSpace.status),
    [notebookRun.id]: ['JupyterLab ready.', 'Kernel: Python 3.11', 'Notebook workspace healthy.'],
  };

  const runGroupIndex: Record<string, string[]> = {
    grp_sweep_lr: [runA1.id, runA2.id, runA3.id],
  };

  return {
    projects: [projectA, projectB],
    runs,
    jobs,
    logs,
    checkpoints,
    templates,
    templateVersions,
    algos,
    algoVersions,
    envs,
    envVersions,
    pools,
    poolVersions,
    protocols,
    protocolVersions,
    protocolDetails,
    matrixResults,
    evalResults,
    datasets,
    datasetPreviews,
    plugins,
    pluginVersions,
    models,
    modelVersions,
    settings,
    artifacts,
    artifactById,
    runGroupIndex,
    agenticRuns: {},
    baseSystemResources: {
      cpuPercent: 52,
      memoryPercent: 68,
      memoryUsed: 58 * 1024 * 1024 * 1024,
      memoryTotal: 86 * 1024 * 1024 * 1024,
      gpus: [
        {
          index: 0,
          name: 'NVIDIA A100 80GB',
          utilizationGpu: 78,
          memoryUsed: 58 * 1024 * 1024 * 1024,
          memoryTotal: 80 * 1024 * 1024 * 1024,
          temperature: 71,
          power_draw: 285000,
          fan_speed: 44,
          processes: [
            { pid: 6124, process_name: 'runner_main.py', memory_used: 23 * 1024 * 1024 * 1024 },
            { pid: 8821, process_name: 'python train.py', memory_used: 17 * 1024 * 1024 * 1024 },
          ],
        },
        {
          index: 1,
          name: 'NVIDIA A100 80GB',
          utilizationGpu: 46,
          memoryUsed: 34 * 1024 * 1024 * 1024,
          memoryTotal: 80 * 1024 * 1024 * 1024,
          temperature: 63,
          power_draw: 215000,
          fan_speed: 37,
          processes: [{ pid: 9011, process_name: 'matrix_eval.py', memory_used: 12 * 1024 * 1024 * 1024 }],
        },
      ],
      cpu_count: 64,
      load_avg: [12.2, 10.8, 9.4],
      disk_percent: 57.2,
      disk_used: 4.12 * 1024 * 1024 * 1024 * 1024,
      disk_total: 7.2 * 1024 * 1024 * 1024 * 1024,
      net_bytes_sent: 3.9 * 1024 * 1024 * 1024,
      net_bytes_recv: 5.1 * 1024 * 1024 * 1024,
    },
  };
};

let state: DemoState = makeInitialState();

const blobCache = new Map<string, string>();

const respond = async <T>(value: T): Promise<T> => {
  await new Promise(resolve => setTimeout(resolve, 40 + Math.random() * 120));
  return clone(value);
};

const must = <T>(value: T | undefined, message: string): T => {
  if (!value) throw new Error(message);
  return value;
};

const urlFromContent = (id: string, content: string, mime: string) => {
  if (blobCache.has(id)) return blobCache.get(id)!;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  blobCache.set(id, url);
  return url;
};

const refreshProjectStats = () => {
  state.projects.forEach(project => {
    const projectRuns = state.runs.filter(run => run.projectId === project.id);
    project.totalRuns = projectRuns.length;
    project.activeRuns = projectRuns.filter(run => run.status === JobStatus.RUNNING || run.status === JobStatus.PENDING).length;
    project.updatedAt = byCreatedDesc(projectRuns)[0]?.created || project.updatedAt;
  });
};

const upsertArtifacts = (runId: string, list: ArtifactRecord[]) => {
  state.artifacts[runId] = list;
  list.forEach(item => {
    state.artifactById[item.id] = item;
  });
};

const nextVersionLabel = (existing: string[]) => {
  if (existing.length === 0) return '1.0.0';
  const parsed = existing
    .map(label => label.split('.').map(v => Number(v)))
    .filter(parts => parts.length === 3 && parts.every(v => Number.isFinite(v)));
  if (parsed.length === 0) return `v${existing.length + 1}`;
  parsed.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]) || (b[2] - a[2]));
  const [major, minor, patch] = parsed[0];
  return `${major}.${minor}.${patch + 1}`;
};

const normalizePoolSummary = (pool: OpponentPool & { memberSnapshotIds?: string[] }): OpponentPool => ({
  id: pool.id,
  poolKey: pool.poolKey,
  name: pool.name,
  version: pool.version,
  env: pool.env,
  frozen: pool.frozen,
  size: pool.memberSnapshotIds?.length ?? pool.size ?? 0,
  created: pool.created,
});

const normalizeProtocolSummary = (detail: EvalProtocolDetail): ProtocolSummaryExt => ({
  id: detail.id,
  protocolKey: (detail as any).protocolKey,
  name: detail.name,
  version: detail.version,
  envId: detail.env.envId,
  map: detail.env.mapSet,
  evalSeeds: detail.evalSeeds,
  episodes: detail.episodesPerMatch,
  frozen: detail.frozen,
  created: detail.createdAt,
  scenarioGrid: (detail as any).scenarioGrid,
  opponentSampling: (detail as any).opponentSampling,
  opponentPoolRef: detail.opponentPoolRef,
});

const createTrainRunSkeleton = (id: string, payload: any, name?: string): Run => {
  const metrics = {
    returnMean: makeSeries(80, 1.2, 14.5, 0.45),
    winRate: makeSeries(80, 0.24, 0.77, 0.03),
    entropy: makeSeries(80, 0.92, 0.26, 0.04),
  };

  return {
    id,
    projectId: payload.projectId,
    name: name || `Train ${shortId(id)}`,
    type: RunType.TRAIN,
    status: JobStatus.RUNNING,
    algo: payload?.algo?.algoId || 'unknown_algo',
    env: `${payload?.env?.envId || 'unknown_env'}:${payload?.env?.mapSet || 'default'}`,
    gpu: payload?.resources?.gpus || 1,
    created: new Date().toISOString(),
    config: {
      ...payload,
      groupId: payload.groupId,
      seed: Array.isArray(payload.seedSet) ? payload.seedSet[0] : 1,
    },
    metrics,
  };
};

const downloadDatasetAsJsonl = (dataset: Dataset) => {
  const preview = state.datasetPreviews[dataset.id];
  const body = preview
    ? preview.rows.map(row => JSON.stringify(row)).join('\n')
    : JSON.stringify(dataset, null, 2);
  return urlFromContent(`dataset_${dataset.id}`, body, 'application/json');
};

const tuneStudy = (studyName: string) => {
  const trials = Array.from({ length: 24 }, (_, i) => ({
    number: i,
    value: Number((0.52 + Math.sin(i / 5) * 0.06 + Math.random() * 0.02).toFixed(4)),
    params: {
      lr: Number((0.00008 + i * 0.00001).toFixed(6)),
      entropyCoef: Number((0.005 + (i % 6) * 0.003).toFixed(4)),
      batchSize: [1024, 2048, 4096][i % 3],
    },
    state: 'COMPLETE',
  }));
  const sorted = trials.slice().sort((a, b) => b.value - a.value);
  return {
    study_name: studyName,
    best_value: sorted[0].value,
    best_params: sorted[0].params,
    trials,
    importance: {
      lr: 0.44,
      entropyCoef: 0.31,
      batchSize: 0.25,
    },
  };
};

const makeAgenticContract = (): AgenticContractReport => ({
  totalRequired: 19,
  present: 19,
  passRate: 100,
  missing: [],
});

const createAgenticNode = (
  nodeId: string,
  agent: string,
  title: string,
  parentId: string | null,
  risk: string,
  status = 'PENDING',
): AgenticNode => ({
  nodeId,
  parentId,
  agent,
  title,
  hypothesis: `${title} hypothesis`,
  executionPlan: `${title} execution plan`,
  expectedMetrics: { winRate: '>=0.6' },
  budget: { gpuHours: 0.2, wallclockMinutes: 10 },
  risk,
  status,
  rationale: `${agent} rationale`,
  evidence: {},
  subAgents: [],
  nextSuggestions: ['Execute next', 'Inspect evidence'],
  children: [],
});

const ensureNodeSearchMeta = (node: AgenticNode, depth: number) => {
  const evidence = (node.evidence || {}) as Record<string, unknown>;
  const search = ((evidence.search as Record<string, unknown>) || {}) as Record<string, unknown>;
  const visits = Number(search.visits || 0);
  const selectedCount = Number(search.selectedCount || 0);
  const value = Number(search.value || 0);
  const frontierScore = Number(search.frontierScore || 0);
  node.evidence = {
    ...evidence,
    search: {
      visits: Number.isFinite(visits) ? visits : 0,
      value: Number.isFinite(value) ? value : 0,
      expanded: Boolean(search.expanded),
      selectedCount: Number.isFinite(selectedCount) ? selectedCount : 0,
      frontierScore: Number.isFinite(frontierScore) ? frontierScore : 0,
      depth,
      updatedAt: search.updatedAt || new Date().toISOString(),
    },
  };
};

const refreshAgenticSearchMeta = (detail: AgenticRunDetail) => {
  const byId = new Map(detail.totTree.map(node => [node.nodeId, node]));
  const depthMemo = new Map<string, number>();
  const resolveDepth = (nodeId: string): number => {
    if (depthMemo.has(nodeId)) return depthMemo.get(nodeId) || 0;
    const node = byId.get(nodeId);
    if (!node) return 0;
    const parentId = node.parentId || null;
    if (!parentId || !byId.has(parentId)) {
      depthMemo.set(nodeId, 0);
      return 0;
    }
    const depth = resolveDepth(parentId) + 1;
    depthMemo.set(nodeId, depth);
    return depth;
  };
  detail.totTree.forEach(node => {
    ensureNodeSearchMeta(node, resolveDepth(node.nodeId));
  });
};

const computeAgenticSearchStats = (detail: AgenticRunDetail): AgenticSearchStats => {
  const nodes = detail.totTree || [];
  if (nodes.length === 0) {
    return {
      totalNodes: 0,
      rootNodes: 0,
      maxDepth: 0,
      expandedNodes: 0,
      visitedNodes: 0,
      pendingNodes: 0,
      avgBranchingFactor: 0,
      avgFrontierScore: 0,
      avgValue: 0,
      totalVisits: 0,
      selectionEvents: 0,
      expansionEvents: 0,
      explorationCoverage: 0,
    };
  }

  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const childCount = new Map<string, number>();
  let rootNodes = 0;
  let expandedNodes = 0;
  let visitedNodes = 0;
  let pendingNodes = 0;
  let totalVisits = 0;
  let frontierSum = 0;
  let valueSum = 0;
  let maxDepth = 0;

  nodes.forEach(node => {
    const parentId = node.parentId || null;
    if (!parentId || !byId.has(parentId)) {
      rootNodes += 1;
    } else {
      childCount.set(parentId, (childCount.get(parentId) || 0) + 1);
    }

    const status = String(node.status || '').toUpperCase();
    if (status === 'PENDING' || status === 'RETRY_PENDING' || status === 'RUNNING') {
      pendingNodes += 1;
    }

    const search = ((node.evidence || {}) as Record<string, unknown>).search as Record<string, unknown> | undefined;
    const visits = Number(search?.visits || 0);
    const value = Number(search?.value || 0);
    const frontier = Number(search?.frontierScore || 0);
    const depth = Number(search?.depth || 0);
    if (Number.isFinite(visits) && visits > 0) visitedNodes += 1;
    if (Boolean(search?.expanded)) expandedNodes += 1;
    totalVisits += Number.isFinite(visits) ? visits : 0;
    frontierSum += Number.isFinite(frontier) ? frontier : 0;
    valueSum += Number.isFinite(value) ? value : 0;
    if (Number.isFinite(depth)) maxDepth = Math.max(maxDepth, depth);
  });

  const branchRows = Array.from(childCount.values()).filter(count => count > 0);
  const avgBranchingFactor = branchRows.length > 0 ? branchRows.reduce((acc, cur) => acc + cur, 0) / branchRows.length : 0;
  const avgFrontierScore = frontierSum / Math.max(1, nodes.length);
  const avgValue = valueSum / Math.max(1, nodes.length);
  const selectionEvents = (detail.events || []).filter(event => String((event as any).event || '') === 'search_node_selected').length;
  const expansionEvents = (detail.events || []).filter(event => String((event as any).event || '') === 'tot_node_expanded').length;

  return {
    totalNodes: nodes.length,
    rootNodes,
    maxDepth,
    expandedNodes,
    visitedNodes,
    pendingNodes,
    avgBranchingFactor: Number(avgBranchingFactor.toFixed(4)),
    avgFrontierScore: Number(avgFrontierScore.toFixed(4)),
    avgValue: Number(avgValue.toFixed(4)),
    totalVisits,
    selectionEvents,
    expansionEvents,
    explorationCoverage: Number((visitedNodes / Math.max(1, nodes.length)).toFixed(4)),
  };
};

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseMetricTarget = (raw: unknown): number | null => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const match = raw.match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) return null;
    if (raw.includes('%')) return parsed / 100;
    return parsed;
  }
  return null;
};

const AGENTIC_DEFAULT_SUB_AGENT_POLICY = {
  enabled: true,
  maxDepth: 2,
  maxPerNode: 3,
  maxTotal: 24,
  timeoutMs: 1500,
};

const AGENTIC_DEFAULT_APPROVAL_POLICY = {
  mode: 'balanced' as const,
  highRiskActions: ['external_dependency_install', 'unknown_script_execution', 'data_exfiltration'],
  blockedActionRoles: ['admin', 'security'] as Array<'admin' | 'ops' | 'security'>,
  highRiskActionRoles: ['admin', 'ops', 'security'] as Array<'admin' | 'ops' | 'security'>,
  requireApprovalForUnknownActions: true,
  minApprovals: 1,
  requireDistinctRoles: false,
  approvalTtlMinutes: 120,
};

const resolveAgenticSubAgentPolicy = (idea: AgenticIdeaInput) => {
  const row = { ...AGENTIC_DEFAULT_SUB_AGENT_POLICY, ...(idea.subAgentPolicy || {}) };
  return {
    enabled: Boolean(row.enabled),
    maxDepth: clampNumber(Number(row.maxDepth || 1), 1, 4),
    maxPerNode: clampNumber(Number(row.maxPerNode || 1), 1, 8),
    maxTotal: clampNumber(Number(row.maxTotal || 1), 1, 128),
    timeoutMs: clampNumber(Number(row.timeoutMs || 50), 50, 10000),
  };
};

const resolveAgenticApprovalPolicy = (idea: AgenticIdeaInput) => {
  const raw = { ...AGENTIC_DEFAULT_APPROVAL_POLICY, ...(idea.approvalPolicy || {}) };
  const highRiskActions = uniqueRows(
    [...(raw.highRiskActions || []), ...(idea.requestedActions || [])]
      .map(item => String(item || '').trim())
      .filter(Boolean),
  );
  return {
    mode: raw.mode,
    highRiskActions,
    blockedActionRoles: (raw.blockedActionRoles || []).filter(Boolean),
    highRiskActionRoles: (raw.highRiskActionRoles || []).filter(Boolean),
    requireApprovalForUnknownActions: Boolean(raw.requireApprovalForUnknownActions),
    minApprovals: clampNumber(Number(raw.minApprovals || 1), 1, 3),
    requireDistinctRoles: Boolean(raw.requireDistinctRoles),
    approvalTtlMinutes: clampNumber(Number(raw.approvalTtlMinutes || 120), 5, 10080),
  };
};

const inferAgenticPrimaryMetric = (successMetrics?: Record<string, unknown>) => {
  const metrics = successMetrics || {};
  const preferred = ['winRate', 'eloLift', 'returnMean'];
  let key = preferred.find(item => Object.prototype.hasOwnProperty.call(metrics, item)) || Object.keys(metrics)[0] || 'winRate';
  if (!key) key = 'winRate';
  const targetRaw = (metrics as Record<string, unknown>)[key];
  const target = parseMetricTarget(targetRaw);
  return { key, target, targetRaw };
};

const inferEnvironmentComplexity = (envName: string) => {
  const env = String(envName || '').toLowerCase();
  if (env.includes('smac') || env.includes('football') || env.includes('magent')) return 3;
  if (env.includes('pettingzoo') || env.includes('mpe') || env.includes('atari')) return 2;
  return 1;
};

const buildAgenticDraftsFromIdea = (idea: AgenticIdeaInput) => {
  const now = new Date().toISOString();
  const context = buildAgenticApprovalContext(idea);
  const riskScore = scoreAgenticApprovalRisk(context);
  const primaryMetric = inferAgenticPrimaryMetric(idea.successMetrics || {});
  const envComplexity = inferEnvironmentComplexity(idea.environment);
  const subAgentPolicy = resolveAgenticSubAgentPolicy(idea);
  const approvalPolicy = resolveAgenticApprovalPolicy(idea);
  const approvalPolicyMeta = buildAgenticApprovalPolicyMeta(approvalPolicy as Record<string, unknown>);

  const budgetGpuHours = Math.max(0, Number(idea.budget?.gpuHours || 0));
  const budgetMinutes = Math.max(0, Number(idea.budget?.wallclockMinutes || 0));
  const budgetScale = clampNumber((budgetGpuHours * 0.75) + (budgetMinutes / 120), 0.5, 6);

  const baseSteps = envComplexity === 3 ? 36000 : envComplexity === 2 ? 22000 : 12000;
  const totalEnvSteps = Math.round((baseSteps * budgetScale) / 1000) * 1000;
  const rolloutLen = envComplexity >= 2 ? 256 : 128;
  const batchSizeBase = envComplexity === 3 ? 4096 : envComplexity === 2 ? 3072 : 2048;
  const batchSize = Math.round(clampNumber(batchSizeBase * Math.max(0.75, budgetScale / 2), 512, 8192) / 256) * 256;
  const lr = Number((envComplexity === 3 ? 2.5e-4 : 3e-4).toFixed(6));

  const gamesPerPair = clampNumber(Math.round(4 + budgetScale * 2), 4, 16);
  const seedCount = clampNumber(Math.round(2 + budgetScale), 2, 6);
  const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);
  const matrixK = clampNumber(Math.round(3 + budgetScale), 3, 10);

  const riskParts: string[] = [];
  riskParts.push(`riskScore=${riskScore}`);
  riskParts.push(`approvalMode=${approvalPolicy.mode}`);
  riskParts.push(`approvalRulesVersion=${approvalPolicyMeta.rulesVersion}`);
  riskParts.push(`approvalPolicyHash=${approvalPolicyMeta.policyHash}`);
  riskParts.push(`executionMode=${idea.executionMode || 'offline_stub'}`);
  riskParts.push(`forbiddenActions=${context.forbiddenActions.join(',') || 'none'}`);
  riskParts.push(`unknownActions=${context.unknownActions.join(',') || 'none'}`);
  if (context.allowNetwork) riskParts.push('network=enabled');
  if (context.allowDependencyInstall) riskParts.push('dependencyInstall=enabled');
  if (context.blockedRequestedActions.length > 0) {
    riskParts.push(`blockedRequested=${context.blockedRequestedActions.join(',')}`);
  }

  const normalizedSpec = {
    title: idea.title,
    taskGoal: idea.taskGoal,
    environment: { name: idea.environment, dataSources: idea.dataSources || [] },
    successMetrics: idea.successMetrics,
    budget: idea.budget,
    constraints: idea.constraints,
    execution: {
      mode: idea.executionMode || 'offline_stub',
      localCommand: idea.localCommand || null,
    },
    requestedActions: context.requestedActions,
    subAgentPolicy,
    approvalPolicy,
    approvalPolicyMeta,
    generatedAt: now,
  };

  const rootConfigDraft = {
    algo: {
      family: envComplexity >= 2 ? 'mappo' : 'ppo',
      entrypoint: envComplexity >= 2 ? 'algorithms.simple_train:train' : 'algorithms.single_train:train',
      adapterMode: idea.executionMode || 'offline_stub',
      objective: idea.taskGoal,
      ...(idea.localCommand ? { localCommand: idea.localCommand } : {}),
    },
    train: {
      totalEnvSteps,
      rolloutLen,
      batchSize,
      lr,
      entropyCoef: envComplexity >= 2 ? 0.01 : 0.02,
      gamma: 0.99,
      gaeLambda: 0.95,
    },
    resources: {
      gpus: budgetGpuHours > 0 ? 1 : 0,
      wallclockMinutes: budgetMinutes,
      gpuHoursBudget: budgetGpuHours,
    },
    safety: {
      approvalPolicy,
      constraints: idea.constraints,
    },
  };

  const evalProtocolDraft = {
    metric: primaryMetric.key,
    target: primaryMetric.targetRaw ?? null,
    gamesPerPair,
    seeds,
    matrixPlan: { mode: 'NxN', k: matrixK },
    confidence: { method: 'wilson', alpha: 0.05 },
  };

  const retrievalContext = [
    {
      source: 'demo://runner_contract',
      score: 4,
      snippet: `Runner mode ${idea.executionMode || 'offline_stub'} for ${idea.environment}`,
    },
    {
      source: 'demo://runs/history',
      score: 3,
      snippet: `Budget ${budgetGpuHours} GPUh / ${budgetMinutes} min with metric ${primaryMetric.key}`,
    },
    {
      source: 'demo://safety/policy_templates',
      score: 2,
      snippet: `Approval mode ${approvalPolicy.mode}, unknownActions=${context.unknownActions.length}`,
    },
  ];

  return {
    normalizedSpec,
    rootConfigDraft,
    evalProtocolDraft,
    riskStatement: riskParts.join(' | '),
    retrievalContext,
    riskScore,
    primaryMetric,
  };
};

const riskFromScore = (base: 'low' | 'medium' | 'high', riskScore: number): 'low' | 'medium' | 'high' => {
  if (riskScore >= 10) return 'high';
  if (riskScore >= 5 && base === 'low') return 'medium';
  if (riskScore <= 2 && base === 'high') return 'medium';
  return base;
};

const buildAgenticTotTree = (idea: AgenticIdeaInput, drafts: ReturnType<typeof buildAgenticDraftsFromIdea>): AgenticNode[] => {
  const metricKey = String((drafts.evalProtocolDraft as Record<string, unknown>).metric || 'winRate');
  const budgetGpu = Math.max(0.06, Number(idea.budget?.gpuHours || 0) / 6 || 0.16);
  const budgetMinutes = Math.max(6, Math.round(Number(idea.budget?.wallclockMinutes || 0) / 6) || 12);
  const safetyMode = String((drafts.normalizedSpec as any)?.approvalPolicy?.mode || 'balanced');

  const root = createAgenticNode('n0', 'ResearchAgent', `Research Spec · ${idea.title}`, null, 'low', 'SUCCEEDED');
  root.hypothesis = `Formalize objective and constraints for ${idea.environment}.`;
  root.executionPlan = 'Compile normalized spec, training draft, evaluation protocol, and safety policy.';
  root.expectedMetrics = idea.successMetrics || {};
  root.budget = { gpuHours: Number((budgetGpu * 1.2).toFixed(2)), wallclockMinutes: budgetMinutes };
  root.evidence = {
    normalizedSpec: drafts.normalizedSpec,
    rootConfigDraft: drafts.rootConfigDraft,
    evalProtocolDraft: drafts.evalProtocolDraft,
  };
  root.nextSuggestions = ['Expand candidate branches', 'Run safety gate'];

  const stageRows: Array<{
    id: string;
    agent: string;
    title: string;
    risk: 'low' | 'medium' | 'high';
    hypothesis: string;
    executionPlan: string;
    suggestions: string[];
    budgetScale: number;
  }> = [
    {
      id: 'n1',
      agent: 'ResearchAgent',
      title: `Hypothesis Proposal (${metricKey})`,
      risk: 'medium',
      hypothesis: `A constrained branch can raise ${metricKey} under budget.`,
      executionPlan: 'Generate branch candidates and estimate cost/benefit/risk for each.',
      suggestions: ['Run top branch', 'Compare sibling nodes'],
      budgetScale: 0.8,
    },
    {
      id: 'n2',
      agent: 'IntegrationAgent',
      title: `Adapter Strategy (${idea.executionMode || 'offline_stub'})`,
      risk: 'high',
      hypothesis: 'Adapter/runner alignment determines execution stability.',
      executionPlan: 'Verify runner interface, materialize adapter draft, and add fallback path.',
      suggestions: ['Inspect adapter evidence', 'Trigger recovery if blocked'],
      budgetScale: 1.05,
    },
    {
      id: 'n3',
      agent: 'OpsAgent',
      title: 'Budget and Ops Guard',
      risk: 'medium',
      hypothesis: 'Budget guardrails reduce drift and avoid overrun.',
      executionPlan: 'Track GPU/time, enforce stop conditions, and schedule retries.',
      suggestions: ['Review progress board', 'Tune retry policy'],
      budgetScale: 0.75,
    },
    {
      id: 'n4',
      agent: 'EvalAgent',
      title: `Evaluation Protocol (${metricKey})`,
      risk: 'low',
      hypothesis: 'Evaluation confidence controls true signal quality.',
      executionPlan: 'Generate matrix plan, confidence thresholds, and verdict criteria.',
      suggestions: ['Generate league matrix', 'Inspect confidence cells'],
      budgetScale: 0.7,
    },
    {
      id: 'n5',
      agent: 'SafetyAgent',
      title: `Safety Gate (${safetyMode})`,
      risk: 'high',
      hypothesis: 'Policy gating prevents unsafe execution paths.',
      executionPlan: 'Check requested actions and create approvals for high-risk operations.',
      suggestions: ['Approve pending actions', 'Adjust policy and retry'],
      budgetScale: 0.6,
    },
    {
      id: 'n6',
      agent: 'OpsAgent',
      title: 'Execute Candidate Run',
      risk: 'medium',
      hypothesis: 'Selected branch can meet target metric within budget.',
      executionPlan: 'Execute selected branch and record timeline, artifacts, and diagnostics.',
      suggestions: ['Play timeline', 'Export repro bundle'],
      budgetScale: 1.1,
    },
  ];

  const nodes = stageRows.map(row => {
    const node = createAgenticNode(
      row.id,
      row.agent,
      row.title,
      'n0',
      riskFromScore(row.risk, drafts.riskScore),
      'PENDING',
    );
    node.hypothesis = row.hypothesis;
    node.executionPlan = row.executionPlan;
    node.expectedMetrics = {
      [metricKey]: (idea.successMetrics || {})[metricKey] || drafts.primaryMetric.targetRaw || 'optimize',
    };
    node.budget = {
      gpuHours: Number((budgetGpu * row.budgetScale).toFixed(2)),
      wallclockMinutes: Math.max(4, Math.round(budgetMinutes * row.budgetScale)),
    };
    node.rationale = `${row.agent} generates step-level decision evidence from spec context.`;
    node.nextSuggestions = row.suggestions;
    return node;
  });

  root.children = nodes.map(node => node.nodeId);
  return [root, ...nodes];
};

const countAgenticSubAgents = (detail: AgenticRunDetail) =>
  detail.totTree.reduce((acc, node) => acc + (node.subAgents || []).length, 0);

const AGENTIC_SUB_AGENT_ROLE_TEMPLATES: Record<string, string[]> = {
  ResearchAgent: ['HypothesisMiner', 'CounterExampleScout', 'AblationPlanner'],
  IntegrationAgent: ['AdapterBuilder', 'InterfaceValidator', 'FallbackPlanner'],
  OpsAgent: ['BudgetSentinel', 'RetryPlanner', 'RunnerHealthMonitor'],
  EvalAgent: ['MetricAuditor', 'MatrixBuilder', 'ConfidenceCalibrator'],
  SafetyAgent: ['PolicyChecker', 'ApprovalOrchestrator', 'RiskExplainer'],
  default: ['TaskWorker', 'Verifier', 'Reporter'],
};

const spawnSubAgentsForNode = (detail: AgenticRunDetail, node: AgenticNode) => {
  const spec = (detail.researchSpec || {}) as Record<string, unknown>;
  const policy = {
    ...AGENTIC_DEFAULT_SUB_AGENT_POLICY,
    ...((spec.subAgentPolicy as Record<string, unknown>) || {}),
  };
  if (!policy.enabled) return [] as Array<Record<string, unknown>>;
  if ((node.subAgents || []).length > 0) return [] as Array<Record<string, unknown>>;

  const maxDepth = clampNumber(Number(policy.maxDepth || 1), 1, 4);
  const maxPerNode = clampNumber(Number(policy.maxPerNode || 1), 1, 8);
  const maxTotal = clampNumber(Number(policy.maxTotal || 1), 1, 128);
  let remaining = maxTotal - countAgenticSubAgents(detail);
  if (remaining <= 0) return [] as Array<Record<string, unknown>>;

  const roleRows = AGENTIC_SUB_AGENT_ROLE_TEMPLATES[node.agent] || AGENTIC_SUB_AGENT_ROLE_TEMPLATES.default;
  const rootCount = Math.min(maxPerNode, remaining);
  if (rootCount <= 0) return [] as Array<Record<string, unknown>>;

  const now = new Date().toISOString();
  const created: Array<Record<string, unknown>> = [];

  for (let i = 0; i < rootCount; i += 1) {
    const subAgentId = `sa_${node.nodeId}_${randomToken('')}`;
    const role = roleRows[i % roleRows.length];
    created.push({
      subAgentId,
      parentNodeId: node.nodeId,
      parentSubAgentId: null,
      ownerAgent: node.agent,
      role,
      objective: `${role} for ${node.nodeId}: ${node.title}`,
      depth: 1,
      status: 'SUCCEEDED',
      startedAt: now,
      finishedAt: now,
      evidence: {
        summary: `${role} completed`,
        linkedNode: node.nodeId,
      },
      children: [],
    });
    remaining -= 1;
  }

  if (maxDepth > 1 && remaining > 0 && created.length > 0) {
    const depthRoles = ['Verifier', 'Critic', 'Synthesizer', 'Reporter'];
    let frontier = created.slice();
    let depth = 1;
    while (depth < maxDepth && remaining > 0 && frontier.length > 0) {
      const next: Array<Record<string, unknown>> = [];
      frontier.forEach((parent, idx) => {
        if (remaining <= 0) return;
        const childId = `sa_${node.nodeId}_${randomToken('')}`;
        const childRole = depthRoles[Math.min(depthRoles.length - 1, depth - 1)];
        const child = {
          subAgentId: childId,
          parentNodeId: node.nodeId,
          parentSubAgentId: String(parent.subAgentId),
          ownerAgent: node.agent,
          role: childRole,
          objective: `${childRole} check for ${String(parent.role || 'sub-agent')} (#${idx + 1})`,
          depth: depth + 1,
          status: 'SUCCEEDED',
          startedAt: now,
          finishedAt: now,
          evidence: {
            summary: `${childRole} checks passed`,
            parentSubAgentId: String(parent.subAgentId),
          },
          children: [],
        } as Record<string, unknown>;
        const parentChildren = Array.isArray(parent.children) ? (parent.children as unknown[]).map(v => String(v)) : [];
        parent.children = [...parentChildren, childId];
        created.push(child);
        next.push(child);
        remaining -= 1;
      });
      frontier = next;
      depth += 1;
    }
  }

  node.subAgents = created;
  return created;
};

const makeAgenticRunDetail = (runId: string, idea: AgenticIdeaInput): AgenticRunDetail => {
  const now = new Date().toISOString();
  const drafts = buildAgenticDraftsFromIdea(idea);
  const tree = buildAgenticTotTree(idea, drafts);
  const detail: AgenticRunDetail = {
    runId,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
    idea: idea as unknown as Record<string, unknown>,
    researchSpec: drafts.normalizedSpec,
    rootConfigDraft: drafts.rootConfigDraft,
    evalProtocolDraft: drafts.evalProtocolDraft,
    riskStatement: drafts.riskStatement,
    totTree: tree,
    timeline: [
      {
        ts: now,
        nodeId: 'n0',
        phase: 'spec_modeled',
        status: 'SUCCEEDED',
        cost: 0.011,
      },
      {
        ts: now,
        nodeId: 'n0',
        phase: 'tot_planned',
        status: 'SUCCEEDED',
        cost: 0.019,
      },
    ],
    events: [
      {
        ts: now,
        event: 'run_created',
        message: 'Demo agentic run created',
        payload: {
          runId,
          metric: (drafts.evalProtocolDraft as Record<string, unknown>).metric,
          riskScore: drafts.riskScore,
        },
      },
    ],
    pendingApprovals: [],
    contract: makeAgenticContract(),
    searchStats: {
      totalNodes: 0,
      rootNodes: 0,
      maxDepth: 0,
      expandedNodes: 0,
      visitedNodes: 0,
      pendingNodes: 0,
      avgBranchingFactor: 0,
      avgFrontierScore: 0,
      avgValue: 0,
      totalVisits: 0,
      selectionEvents: 0,
      expansionEvents: 0,
      explorationCoverage: 0,
    },
    matrix: null,
    registryRecord: {
      runId,
      status: 'PENDING',
      specHash: randomToken('spec'),
      configHash: randomToken('cfg'),
      contractPassRate: 100,
      approvalPolicyMeta: (drafts.normalizedSpec as Record<string, unknown>)?.approvalPolicyMeta || {},
    },
    reproBundle: null,
  };
  refreshAgenticSearchMeta(detail);
  detail.searchStats = computeAgenticSearchStats(detail);
  return detail;
};

const AGENTIC_HIGH_RISK_BASELINE = ['external_dependency_install', 'unknown_script_execution', 'data_exfiltration'];
const AGENTIC_KNOWN_ACTIONS = [
  ...AGENTIC_HIGH_RISK_BASELINE,
  'switch_offline_stub',
  'reduce_scope',
  'retry_with_debug',
];
const AGENTIC_APPROVAL_TEMPLATE_RULES = {
  strict: {
    label: 'Strict',
    description: 'Unknown actions and blocked actions require stricter approval gates.',
    mode: 'strict',
    minRiskScore: 8,
    minApprovals: 1,
    requireDistinctRoles: true,
    approvalTtlMinutes: 120,
    blockedActionRoles: ['security'],
    highRiskActionRoles: ['admin', 'security'],
    requireApprovalForUnknownActions: true,
  },
  balanced: {
    label: 'Balanced',
    description: 'Default production profile balancing safety and execution throughput.',
    mode: 'balanced',
    minRiskScore: 3,
    minApprovals: 1,
    requireDistinctRoles: false,
    approvalTtlMinutes: 120,
    blockedActionRoles: ['admin', 'security'],
    highRiskActionRoles: ['admin', 'ops', 'security'],
    requireApprovalForUnknownActions: true,
  },
  permissive: {
    label: 'Permissive',
    description: 'Allows faster local iteration while keeping explicit high-risk approvals.',
    mode: 'permissive',
    minRiskScore: 0,
    minApprovals: 1,
    requireDistinctRoles: false,
    approvalTtlMinutes: 180,
    blockedActionRoles: ['admin'],
    highRiskActionRoles: ['admin', 'ops', 'security'],
    requireApprovalForUnknownActions: false,
  },
} as const;
const AGENTIC_APPROVAL_RULES_VERSION = '1.0';
const AGENTIC_APPROVAL_RULES_HASH = mockHash64({
  version: AGENTIC_APPROVAL_RULES_VERSION,
  templates: AGENTIC_APPROVAL_TEMPLATE_RULES,
  baselineHighRiskActions: AGENTIC_HIGH_RISK_BASELINE,
});
const AGENTIC_APPROVAL_RISK_WEIGHTS = {
  forbiddenAction: 2,
  blockedRequestedAction: 4,
  requestedHighRiskAction: 3,
  requestedUnknownAction: 2,
  complianceNoExternalPush: 3,
  complianceNoPII: 1,
  allowNetwork: 2,
  allowDependencyInstall: 1,
};

const buildAgenticApprovalPolicyMeta = (approvalPolicy: Record<string, unknown>) => {
  const mode = String(approvalPolicy.mode || 'balanced').toLowerCase();
  const matchedTemplates = Object.entries(AGENTIC_APPROVAL_TEMPLATE_RULES)
    .filter(([, item]) => String(item.mode || '').toLowerCase() === mode)
    .map(([templateId]) => templateId)
    .sort();
  return {
    rulesVersion: AGENTIC_APPROVAL_RULES_VERSION,
    rulesHash: AGENTIC_APPROVAL_RULES_HASH,
    policyHash: mockHash64(approvalPolicy),
    mode,
    matchedTemplates,
    highRiskActionCount: Array.isArray(approvalPolicy.highRiskActions) ? approvalPolicy.highRiskActions.length : 0,
    minApprovals: Number(approvalPolicy.minApprovals || 1),
    requireDistinctRoles: Boolean(approvalPolicy.requireDistinctRoles),
  };
};

const uniqueRows = (values: string[]) => Array.from(new Set(values));

const buildAgenticApprovalContext = (idea?: AgenticIdeaInput) => {
  const constraints = idea?.constraints || {
    compliance: [],
    forbiddenActions: [],
    allowNetwork: false,
    allowDependencyInstall: false,
  };
  const requestedActions = uniqueRows((idea?.requestedActions || []).map(item => String(item || '').trim()).filter(Boolean));
  const forbidden = new Set((constraints.forbiddenActions || []).map(item => String(item || '').trim()).filter(Boolean));
  const compliance = new Set((constraints.compliance || []).map(item => String(item || '').trim()).filter(Boolean));
  const requestedHighRiskActions = requestedActions.filter(action => AGENTIC_HIGH_RISK_BASELINE.includes(action));
  const blockedRequestedActions = requestedActions.filter(action => forbidden.has(action));
  const knownActions = new Set(AGENTIC_KNOWN_ACTIONS);
  const unknownActions = requestedActions.filter(action => !knownActions.has(action));

  return {
    requestedActions,
    requestedHighRiskActions,
    blockedRequestedActions,
    unknownActions,
    forbiddenActions: Array.from(forbidden).sort(),
    compliance: Array.from(compliance).sort(),
    allowNetwork: Boolean(constraints.allowNetwork),
    allowDependencyInstall: Boolean(constraints.allowDependencyInstall),
  };
};

const scoreAgenticApprovalRisk = (context: ReturnType<typeof buildAgenticApprovalContext>) => {
  let score = 0;
  score += context.forbiddenActions.length * AGENTIC_APPROVAL_RISK_WEIGHTS.forbiddenAction;
  score += context.blockedRequestedActions.length * AGENTIC_APPROVAL_RISK_WEIGHTS.blockedRequestedAction;
  score += context.requestedHighRiskActions.length * AGENTIC_APPROVAL_RISK_WEIGHTS.requestedHighRiskAction;
  score += context.unknownActions.length * AGENTIC_APPROVAL_RISK_WEIGHTS.requestedUnknownAction;
  if (context.compliance.includes('no_external_data_push')) score += AGENTIC_APPROVAL_RISK_WEIGHTS.complianceNoExternalPush;
  if (context.compliance.includes('no_pii')) score += AGENTIC_APPROVAL_RISK_WEIGHTS.complianceNoPII;
  if (context.allowNetwork) score += AGENTIC_APPROVAL_RISK_WEIGHTS.allowNetwork;
  if (context.allowDependencyInstall) score += AGENTIC_APPROVAL_RISK_WEIGHTS.allowDependencyInstall;
  return score;
};

const templateRationale = (templateId: string, riskScore: number, threshold: number, blocked: number, unknown: number) => {
  if (templateId === 'strict') {
    return `riskScore=${riskScore} (threshold=${threshold}); blocked=${blocked}, unknown=${unknown}. Strict gate reduces unsafe overrides.`;
  }
  if (templateId === 'permissive') {
    return `riskScore=${riskScore} (threshold=${threshold}); blocked=${blocked}, unknown=${unknown}. Permissive profile favors speed with explicit high-risk controls.`;
  }
  return `riskScore=${riskScore} (threshold=${threshold}); blocked=${blocked}, unknown=${unknown}. Balanced profile fits mixed workloads.`;
};

const AGENTIC_APPROVERS_FALLBACK: AgenticApproverListResponse = {
  strictMode: true,
  total: 6,
  items: [
    { actorId: 'ui:local_admin', roles: ['admin'], scopes: ['*'], actionAllowlist: ['*'], actionDenylist: [], active: true, note: 'local ui default admin' },
    { actorId: 'ui:local_ops', roles: ['ops'], scopes: ['*'], actionAllowlist: ['switch_offline_stub', 'reduce_scope', 'retry_with_debug'], actionDenylist: [], active: true, note: 'local ui ops reviewer' },
    { actorId: 'ui:local_security', roles: ['security'], scopes: ['*'], actionAllowlist: ['*'], actionDenylist: [], active: true, note: 'local ui security reviewer' },
    { actorId: 'ui:admin_reviewer', roles: ['admin'], scopes: ['*'], actionAllowlist: ['*'], actionDenylist: [], active: true },
    { actorId: 'ui:ops_reviewer', roles: ['ops'], scopes: ['*'], actionAllowlist: ['switch_offline_stub', 'reduce_scope', 'retry_with_debug'], actionDenylist: [], active: true },
    { actorId: 'ui:security_reviewer', roles: ['security'], scopes: ['*'], actionAllowlist: ['*'], actionDenylist: [], active: true },
  ],
};

const agenticApprovalPolicyTemplates = (idea?: AgenticIdeaInput): AgenticApprovalPolicyTemplateListResponse => {
  const context = buildAgenticApprovalContext(idea);
  const riskScore = scoreAgenticApprovalRisk(context);
  const templates = Object.entries(AGENTIC_APPROVAL_TEMPLATE_RULES)
    .map(([templateId, row]) => ({ templateId, ...row }))
    .sort((a, b) => a.minRiskScore - b.minRiskScore);

  let recommendedTemplateId: string = 'balanced';
  if (idea) {
    for (const row of templates) {
      if (riskScore >= row.minRiskScore) {
        recommendedTemplateId = row.templateId;
      }
    }
  }
  if (context.blockedRequestedActions.length > 0) {
    recommendedTemplateId = 'strict';
  }

  const highRiskActions = uniqueRows([...AGENTIC_HIGH_RISK_BASELINE, ...context.requestedHighRiskActions, ...context.unknownActions]).sort();
  const items = templates
    .map(row => ({
      templateId: row.templateId,
      label: row.label,
      description: row.description,
      rationale: templateRationale(row.templateId, riskScore, row.minRiskScore, context.blockedRequestedActions.length, context.unknownActions.length),
      recommended: row.templateId === recommendedTemplateId,
      policy: {
        mode: row.mode,
        highRiskActions,
        blockedActionRoles: [...row.blockedActionRoles],
        highRiskActionRoles: [...row.highRiskActionRoles],
        requireApprovalForUnknownActions: row.requireApprovalForUnknownActions,
        minApprovals: row.minApprovals,
        requireDistinctRoles: row.requireDistinctRoles,
        approvalTtlMinutes: row.approvalTtlMinutes,
      },
    }))
    .sort((a, b) => a.templateId.localeCompare(b.templateId));

  return {
    recommendedTemplateId,
    contextSummary: {
      ...context,
      riskScore,
      policyRulesVersion: AGENTIC_APPROVAL_RULES_VERSION,
      policyRulesHash: AGENTIC_APPROVAL_RULES_HASH,
    },
    items,
  };
};

const summarizeAgenticRun = (detail: AgenticRunDetail): AgenticRunSummary => ({
  runId: detail.runId,
  title: String((detail.researchSpec as any)?.title || 'Agentic Run'),
  objective: String((detail.researchSpec as any)?.taskGoal || ''),
  status: detail.status,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
  contractPassRate: detail.contract.passRate,
  failureReason: (detail.registryRecord as any)?.failureReason || null,
});

const seedAgenticShowcaseRun = () => {
  if (Object.keys(state.agenticRuns || {}).length > 0) return;
  const idea: AgenticIdeaInput = {
    title: 'Auto-Science Showcase Run',
    taskGoal: 'Automatically explore and converge on a robust branch under constrained budget.',
    environment: 'pettingzoo.smac_v2:3s5z',
    dataSources: ['registry://baseline_runs', 'registry://historical_failures'],
    successMetrics: { winRate: '>=0.62', eloLift: '>=25' },
    budget: { gpuHours: 2, wallclockMinutes: 90 },
    constraints: {
      compliance: ['no_pii', 'no_external_data_push'],
      forbiddenActions: ['data_exfiltration'],
      allowNetwork: false,
      allowDependencyInstall: false,
    },
    executionMode: 'offline_stub',
    requestedActions: [],
  };

  const runId = 'agentic_demo_showcase';
  const detail = makeAgenticRunDetail(runId, idea);
  const choosePending = () =>
    detail.totTree.find(node => String(node.status || '').toUpperCase() === 'PENDING' || String(node.status || '').toUpperCase() === 'RETRY_PENDING');
  const nextNodeId = () => {
    let idx = detail.totTree.length;
    let id = `n${idx}`;
    while (detail.totTree.some(node => node.nodeId === id)) {
      idx += 1;
      id = `n${idx}`;
    }
    return id;
  };

  for (let round = 0; round < 8; round += 1) {
    const node = choosePending();
    if (!node) break;
    const ts = new Date(Date.now() - (8 - round) * 60000).toISOString();
    const search = (((node.evidence || {}) as Record<string, unknown>).search || {}) as Record<string, unknown>;
    const depth = Number(search.depth || 0);
    node.status = 'SUCCEEDED';
    node.evidence = {
      ...(node.evidence || {}),
      executedAt: ts,
      mode: 'offline_stub',
      search: {
        ...search,
        visits: Number(search.visits || 0) + 1,
        selectedCount: Number(search.selectedCount || 0) + 1,
        value: Number((0.56 + Math.random() * 0.32 - depth * 0.05).toFixed(4)),
        frontierScore: Number((0.64 + Math.random() * 0.22).toFixed(4)),
        depth,
        updatedAt: ts,
      },
    };
    detail.timeline.push({ ts, nodeId: node.nodeId, phase: 'executed', status: 'SUCCEEDED', cost: 0.012 });
    detail.events.push({
      ts,
      event: 'search_node_selected',
      message: `${node.nodeId} selected from frontier`,
      payload: { nodeId: node.nodeId, depth },
    });
    detail.events.push({
      ts,
      event: 'node_succeeded',
      message: `${node.nodeId} succeeded`,
      payload: { nodeId: node.nodeId },
    });

    if ((node.children || []).length === 0 && depth < 2 && detail.totTree.length < 24) {
      const childCount = depth === 0 ? 2 : 1;
      const childIds: string[] = [];
      for (let i = 0; i < childCount; i += 1) {
        const child = createAgenticNode(
          nextNodeId(),
          i % 2 === 0 ? 'ResearchAgent' : 'EvalAgent',
          `${node.title} · showcase branch ${i + 1}`,
          node.nodeId,
          depth === 0 ? 'medium' : 'low',
          'PENDING',
        );
        child.hypothesis = `Showcase branch ${i + 1} for ${node.nodeId}`;
        child.executionPlan = `Evaluate branch ${i + 1}, compare with sibling, and keep the better node.`;
        child.expectedMetrics = { ...(node.expectedMetrics || {}) };
        ensureNodeSearchMeta(child, depth + 1);
        detail.totTree.push(child);
        childIds.push(child.nodeId);
      }
      node.children = [...(node.children || []), ...childIds];
      detail.events.push({
        ts,
        event: 'tot_node_expanded',
        message: `${node.nodeId} expanded`,
        payload: { nodeId: node.nodeId, childIds },
      });
    }
  }

  if (!detail.totTree.some(node => String(node.status || '').toUpperCase() === 'PENDING' || String(node.status || '').toUpperCase() === 'RETRY_PENDING')) {
    detail.status = 'SUCCEEDED';
  } else {
    detail.status = 'RUNNING';
  }
  detail.updatedAt = new Date().toISOString();
  detail.registryRecord = {
    ...(detail.registryRecord || {}),
    status: detail.status,
    updatedAt: detail.updatedAt,
  };
  refreshAgenticSearchMeta(detail);
  detail.searchStats = computeAgenticSearchStats(detail);
  state.agenticRuns[runId] = detail;
};

seedAgenticShowcaseRun();

export const resetMockState = () => {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    blobCache.forEach(url => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
  }
  blobCache.clear();
  state = makeInitialState();
  seedAgenticShowcaseRun();
};

export const createMockApi = (_apiBaseUrl: string) => ({
  login: async (_payload: { email: string; password: string }) =>
    respond({ token: 'demo-access-token', tokenType: 'Bearer', expiresAt: isoMinutesAgo(-60 * 24) }),

  getProjects: async (): Promise<Project[]> => {
    refreshProjectStats();
    return respond(byCreatedDesc(state.projects as any) as any);
  },

  getProjectById: async (id: string): Promise<Project> => {
    refreshProjectStats();
    return respond(must(state.projects.find(project => project.id === id), `project_not_found:${id}`));
  },

  createProject: async (payload: { name: string; description?: string; tags?: string[]; gitRepo?: string; gitBranch?: string }): Promise<Project> => {
    const created: Project = {
      id: `proj_${randomToken('')}`,
      name: payload.name,
      description: payload.description,
      tags: payload.tags || ['demo'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      activeRuns: 0,
      totalRuns: 0,
    };
    state.projects.unshift(created);
    return respond(created);
  },

  deleteProject: async (id: string): Promise<void> => {
    state.projects = state.projects.filter(project => project.id !== id);
    const removedRunIds = state.runs.filter(run => run.projectId === id).map(run => run.id);
    state.runs = state.runs.filter(run => run.projectId !== id);
    state.jobs = state.jobs.filter(job => !removedRunIds.includes(job.runId));
    removedRunIds.forEach(runId => {
      delete state.logs[runId];
      delete state.checkpoints[runId];
      delete state.artifacts[runId];
    });
    refreshProjectStats();
    return respond(undefined);
  },

  getRuns: async (params?: { projectId?: string; type?: string; status?: string; groupId?: string; page?: number; pageSize?: number }): Promise<Run[]> => {
    let list = state.runs.slice();
    if (params?.projectId) list = list.filter(run => run.projectId === params.projectId);
    if (params?.type) list = list.filter(run => String(run.type) === String(params.type));
    if (params?.status) list = list.filter(run => String(run.status) === String(params.status));
    if (params?.groupId) list = list.filter(run => (run as any).groupId === params.groupId || run.config?.groupId === params.groupId);
    list = byCreatedDesc(list as any) as any;
    if (params?.pageSize) {
      const page = params.page && params.page > 0 ? params.page : 1;
      const start = (page - 1) * params.pageSize;
      list = list.slice(start, start + params.pageSize);
    }
    return respond(list);
  },

  getRunById: async (id: string): Promise<Run> => respond(must(state.runs.find(run => run.id === id), `run_not_found:${id}`)),

  getRunGroupSummary: async (groupId: string): Promise<any> => respond(computeGroupSummary(state, groupId)),

  exportRunTemplate: async (runId: string, payload: { templateId?: string; name?: string; version?: string; description?: string }) => {
    const run = must(state.runs.find(item => item.id === runId), `run_not_found:${runId}`);
    const templateId = payload.templateId || `tmpl_export_${randomToken('')}`;

    let template = state.templates.find(item => item.id === templateId);
    if (!template) {
      template = {
        id: templateId,
        projectId: run.projectId,
        name: payload.name || `Template from ${run.name}`,
        description: payload.description || `Exported from ${run.id}`,
        type: 'Multi-Agent',
        defaultConfig: {
          train: (run.config as any)?.train || {},
          datasetId: (run.config as any)?.datasetId,
        },
        archived: false,
      };
      state.templates.unshift(template);
    }

    const version: TemplateVersion = {
      id: `${template.id}_v_${randomToken('')}`,
      templateId: template.id,
      algoVersionId: (run.config as any)?.algo?.algoVersionId,
      version: payload.version || `run-${shortId(run.id)}`,
      defaultConfig: template.defaultConfig,
      createdAt: new Date().toISOString(),
      frozen: true,
    };

    const list = state.templateVersions[template.id] || [];
    list.unshift(version);
    state.templateVersions[template.id] = list;

    return respond({ templateId: template.id, versionId: version.id });
  },

  getRunJob: async (runId: string) => {
    const existing = state.jobs.find(job => job.runId === runId);
    if (existing) return respond(existing as any);
    const run = must(state.runs.find(item => item.id === runId), `run_not_found:${runId}`);
    const synthetic: JobRecord = {
      id: `job_${shortId(runId)}`,
      runId,
      status: run.status,
      createdAt: run.created,
      updatedAt: new Date().toISOString(),
      message: run.status === JobStatus.RUNNING ? 'running' : run.status.toLowerCase(),
    };
    state.jobs.unshift(synthetic);
    return respond(synthetic as any);
  },

  getRunMetrics: async (runId: string, params?: { keys?: string[]; fromStep?: number }): Promise<RunMetricsResponse> => {
    const run = must(state.runs.find(item => item.id === runId), `run_not_found:${runId}`);
    const series: Record<string, Array<{ step: number; value: number }>> = {};
    const keys = params?.keys && params.keys.length > 0
      ? params.keys
      : Object.keys(run.metrics || {});

    keys.forEach(key => {
      const values = ((run.metrics as any)?.[key] || []) as Array<{ step: number; value: number }>;
      series[key] = typeof params?.fromStep === 'number'
        ? values.filter(item => item.step >= params.fromStep!)
        : values;
    });

    return respond({ runId, series });
  },

  getRunLogs: async (runId: string, params?: { page?: number; pageSize?: number }): Promise<LogPage> => {
    const lines = state.logs[runId] || [];
    const page = params?.page && params.page > 0 ? params.page : 1;
    const pageSize = params?.pageSize && params.pageSize > 0 ? params.pageSize : 200;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return respond({
      lines: lines.slice(start, end),
      page,
      pageSize,
      hasMore: end < lines.length,
    });
  },

  getSettings: async (): Promise<SettingsResponse> => respond(state.settings),

  updateSettings: async (payload: SettingsUpdate): Promise<SettingsResponse> => {
    if (payload.checkpointPolicy) {
      state.settings.retention.checkpointPolicy = payload.checkpointPolicy;
    }
    return respond(state.settings);
  },

  rotateToken: async (): Promise<TokenRotateResponse> => {
    state.settings.apiToken = `sk-demo-${randomToken('token')}`;
    return respond({ apiToken: state.settings.apiToken });
  },

  applyRetention: async (): Promise<RetentionApplyResponse> =>
    respond({ runsProcessed: state.runs.length, checkpointsRemoved: 6, artifactsRemoved: 18 }),

  bootstrapDefaults: async (): Promise<BootstrapResponse> => {
    resetMockState();
    return respond({
      created: {
        projects: state.projects.length,
        envs: state.envs.length,
        envVersions: Object.values(state.envVersions).reduce((sum, list) => sum + list.length, 0),
        algos: state.algos.length,
        algoVersions: Object.values(state.algoVersions).reduce((sum, list) => sum + list.length, 0),
        templates: state.templates.length,
        templateVersions: Object.values(state.templateVersions).reduce((sum, list) => sum + list.length, 0),
      },
      defaults: {
        projectId: 'proj_hackathon',
        envId: 'smac',
        envVersion: '2.4.0',
        algoId: 'mappo',
        algoVersionId: 'algo_mappo_v3',
        templateId: 'tmpl_competitive_mappo',
        templateVersionId: 'tmpl_comp_mappo_v2',
      },
    });
  },

  getCheckpoints: async (runId: string): Promise<Checkpoint[]> => respond(state.checkpoints[runId] || []),

  tagCheckpoint: async (runId: string, checkpointId: string, payload: { tag: string }): Promise<Checkpoint> => {
    const items = state.checkpoints[runId] || [];
    const target = must(items.find(item => item.id === checkpointId), `checkpoint_not_found:${checkpointId}`);
    if (!target.tags.includes(payload.tag)) {
      target.tags.push(payload.tag);
    }
    return respond(target);
  },

  deleteRun: async (runId: string): Promise<void> => {
    state.runs = state.runs.filter(run => run.id !== runId);
    state.jobs = state.jobs.filter(job => job.runId !== runId);
    delete state.logs[runId];
    delete state.checkpoints[runId];
    delete state.artifacts[runId];
    refreshProjectStats();
    return respond(undefined);
  },

  deleteRunsBatch: async (runIds: string[]): Promise<{ deleted: number }> => {
    const idSet = new Set(runIds);
    const deleted = state.runs.filter(run => idSet.has(run.id)).length;
    state.runs = state.runs.filter(run => !idSet.has(run.id));
    state.jobs = state.jobs.filter(job => !idSet.has(job.runId));
    runIds.forEach(runId => {
      delete state.logs[runId];
      delete state.checkpoints[runId];
      delete state.artifacts[runId];
    });
    refreshProjectStats();
    return respond({ deleted });
  },

  getTemplates: async (params?: { projectId?: string; includeArchived?: boolean }): Promise<Template[]> => {
    let list = state.templates.slice();
    if (params?.projectId) list = list.filter(item => item.projectId === params.projectId);
    if (!params?.includeArchived) list = list.filter(item => !item.archived);
    return respond(list);
  },

  getTemplateById: async (id: string): Promise<TemplateDetail> => {
    const template = must(state.templates.find(item => item.id === id), `template_not_found:${id}`);
    return respond({ ...template, versions: byCreatedDesc((state.templateVersions[id] || []) as any) as any });
  },

  createTemplate: async (
    projectId: string,
    payload: { name: string; description?: string; type: 'Single-Agent' | 'Multi-Agent'; defaultConfig?: Record<string, unknown> },
  ) => {
    const created: Template = {
      id: `tmpl_${randomToken('')}`,
      projectId,
      name: payload.name,
      description: payload.description,
      type: payload.type,
      defaultConfig: (payload.defaultConfig || {}) as Record<string, any>,
      archived: false,
    };
    state.templates.unshift(created);
    state.templateVersions[created.id] = [];
    return respond(created);
  },

  updateTemplate: async (
    templateId: string,
    payload: { name?: string; description?: string; defaultConfig?: Record<string, unknown>; archived?: boolean },
  ): Promise<Template> => {
    const template = must(state.templates.find(item => item.id === templateId), `template_not_found:${templateId}`);
    if (payload.name !== undefined) template.name = payload.name;
    if (payload.description !== undefined) template.description = payload.description;
    if (payload.defaultConfig !== undefined) template.defaultConfig = payload.defaultConfig as Record<string, any>;
    if (payload.archived !== undefined) template.archived = payload.archived;
    return respond(template);
  },

  archiveTemplate: async (templateId: string): Promise<void> => {
    const template = must(state.templates.find(item => item.id === templateId), `template_not_found:${templateId}`);
    template.archived = true;
    return respond(undefined);
  },

  createTemplateVersion: async (
    templateId: string,
    payload: { version: string; algoVersionId: string; defaultConfig?: Record<string, unknown> },
  ) => {
    const template = must(state.templates.find(item => item.id === templateId), `template_not_found:${templateId}`);
    const created: TemplateVersion = {
      id: `${templateId}_ver_${randomToken('')}`,
      templateId,
      algoVersionId: payload.algoVersionId,
      version: payload.version,
      defaultConfig: (payload.defaultConfig ?? template.defaultConfig) as Record<string, any>,
      createdAt: new Date().toISOString(),
      frozen: false,
    };
    const list = state.templateVersions[templateId] || [];
    list.unshift(created);
    state.templateVersions[templateId] = list;
    return respond(created);
  },

  freezeTemplateVersion: async (templateId: string, versionId: string) => {
    const versions = state.templateVersions[templateId] || [];
    const version = must(versions.find(item => item.id === versionId), `template_version_not_found:${versionId}`);
    version.frozen = true;
    return respond(version);
  },

  getAlgos: async (params?: { includeArchived?: boolean }): Promise<Algo[]> => {
    const list = params?.includeArchived ? state.algos.slice() : state.algos.filter(item => !item.archived);
    return respond(list);
  },

  getAlgoVersions: async (algoId: string): Promise<AlgoVersion[]> => respond(byCreatedDesc((state.algoVersions[algoId] || []) as any) as any),

  upsertAlgo: async (payload: { id: string; name: string; description?: string }): Promise<Algo> => {
    let algo = state.algos.find(item => item.id === payload.id);
    if (!algo) {
      algo = { id: payload.id, name: payload.name, description: payload.description, archived: false };
      state.algos.unshift(algo);
      state.algoVersions[payload.id] = [];
    } else {
      algo.name = payload.name;
      algo.description = payload.description;
    }
    return respond(algo);
  },

  updateAlgo: async (
    algoId: string,
    payload: { name?: string; description?: string; archived?: boolean },
  ): Promise<Algo> => {
    const algo = must(state.algos.find(item => item.id === algoId), `algo_not_found:${algoId}`);
    if (payload.name !== undefined) algo.name = payload.name;
    if (payload.description !== undefined) algo.description = payload.description;
    if (payload.archived !== undefined) algo.archived = payload.archived;
    return respond(algo);
  },

  archiveAlgo: async (algoId: string): Promise<void> => {
    const algo = must(state.algos.find(item => item.id === algoId), `algo_not_found:${algoId}`);
    algo.archived = true;
    return respond(undefined);
  },

  createAlgoVersion: async (
    algoId: string,
    payload: {
      version: string;
      entrypoint: string;
      code?: string;
      package?: string;
      artifactUri?: string;
      configSchema?: Record<string, unknown>;
      defaultConfig?: Record<string, unknown>;
      resourceProfile?: Record<string, unknown>;
      envConstraints?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      active?: boolean;
    },
  ) => {
    const created: AlgoVersion = {
      id: `${algoId}_${payload.version}_${randomToken('')}`,
      algoId,
      version: payload.version,
      entrypoint: payload.entrypoint,
      package: payload.package,
      artifactUri: payload.artifactUri,
      configSchema: payload.configSchema as any,
      defaultConfig: payload.defaultConfig as any,
      resourceProfile: payload.resourceProfile as any,
      envConstraints: payload.envConstraints as any,
      metadata: payload.metadata as any,
      active: payload.active ?? true,
      frozen: false,
      createdAt: new Date().toISOString(),
    };
    const list = state.algoVersions[algoId] || [];
    list.unshift(created);
    state.algoVersions[algoId] = list;
    return respond(created);
  },

  updateAlgoVersion: async (
    algoId: string,
    version: string,
    payload: {
      entrypoint?: string;
      code?: string;
      package?: string;
      artifactUri?: string;
      configSchema?: Record<string, unknown>;
      defaultConfig?: Record<string, unknown>;
      resourceProfile?: Record<string, unknown>;
      envConstraints?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      active?: boolean;
    },
  ) => {
    const list = state.algoVersions[algoId] || [];
    const target = must(list.find(item => item.version === version || item.id === version), `algo_version_not_found:${algoId}:${version}`);
    if (payload.entrypoint !== undefined) target.entrypoint = payload.entrypoint;
    if (payload.package !== undefined) target.package = payload.package;
    if (payload.artifactUri !== undefined) target.artifactUri = payload.artifactUri;
    if (payload.configSchema !== undefined) target.configSchema = payload.configSchema as any;
    if (payload.defaultConfig !== undefined) target.defaultConfig = payload.defaultConfig as any;
    if (payload.resourceProfile !== undefined) target.resourceProfile = payload.resourceProfile as any;
    if (payload.envConstraints !== undefined) target.envConstraints = payload.envConstraints as any;
    if (payload.metadata !== undefined) target.metadata = payload.metadata as any;
    if (payload.active !== undefined) target.active = payload.active;
    return respond(target);
  },

  freezeAlgoVersion: async (algoId: string, version: string): Promise<AlgoVersion> => {
    const list = state.algoVersions[algoId] || [];
    const target = must(list.find(item => item.version === version || item.id === version), `algo_version_not_found:${algoId}:${version}`);
    target.frozen = true;
    return respond(target);
  },

  getEnvs: async (params?: { includeArchived?: boolean }): Promise<EnvSpec[]> => {
    const list = params?.includeArchived ? state.envs.slice() : state.envs.filter(item => !item.archived);
    return respond(list);
  },

  getEnvVersions: async (envId: string) => respond(byCreatedDesc((state.envVersions[envId] || []) as any) as any),

  updateEnv: async (envId: string, payload: { archived?: boolean }): Promise<EnvSpec> => {
    const env = must(state.envs.find(item => item.id === envId), `env_not_found:${envId}`);
    if (payload.archived !== undefined) env.archived = payload.archived;
    return respond(env);
  },

  archiveEnv: async (envId: string): Promise<void> => {
    const env = must(state.envs.find(item => item.id === envId), `env_not_found:${envId}`);
    env.archived = true;
    return respond(undefined);
  },

  upsertEnv: async (payload: {
    envId: string;
    version: string;
    apiMode: string;
    entrypoint: string;
    package?: string;
    mapSets?: { id: string; maps: string[] }[];
    scenarioSchema?: Record<string, unknown>;
  }) => {
    let env = state.envs.find(item => item.id === payload.envId);
    if (!env) {
      env = { id: payload.envId, versions: [payload.version], maps: payload.mapSets?.map(item => item.id) || ['default'], archived: false };
      state.envs.unshift(env);
      state.envVersions[payload.envId] = [];
    }

    const list = state.envVersions[payload.envId] || [];
    const existing = list.find(item => item.version === payload.version);
    if (existing) {
      existing.apiMode = payload.apiMode;
      existing.entrypoint = payload.entrypoint;
      existing.package = payload.package;
      existing.mapSets = payload.mapSets as any;
      existing.scenarioSchema = payload.scenarioSchema as any;
      existing.active = true;
    } else {
      list.unshift({
        envId: payload.envId,
        version: payload.version,
        apiMode: payload.apiMode,
        entrypoint: payload.entrypoint,
        package: payload.package,
        active: true,
        frozen: false,
        mapSets: payload.mapSets as any,
        scenarioSchema: payload.scenarioSchema as any,
      });
    }
    state.envVersions[payload.envId] = list;

    if (!env.versions.includes(payload.version)) {
      env.versions.unshift(payload.version);
    }

    const mapIds = payload.mapSets?.map(item => item.id) || [];
    if (mapIds.length > 0) {
      env.maps = Array.from(new Set([...env.maps, ...mapIds]));
    }

    return respond(list[0]);
  },

  createEnvVersion: async (
    envId: string,
    payload: {
      version: string;
      apiMode: string;
      entrypoint: string;
      package?: string;
      mapSets?: { id: string; maps: string[] }[];
      scenarioSchema?: Record<string, unknown>;
    },
  ) => {
    const env = must(state.envs.find(item => item.id === envId), `env_not_found:${envId}`);
    const created: EnvVersion = {
      envId,
      version: payload.version,
      apiMode: payload.apiMode,
      entrypoint: payload.entrypoint,
      package: payload.package,
      active: true,
      frozen: false,
      mapSets: payload.mapSets as any,
      scenarioSchema: payload.scenarioSchema as any,
    };
    const list = state.envVersions[envId] || [];
    list.unshift(created);
    state.envVersions[envId] = list;
    if (!env.versions.includes(payload.version)) env.versions.unshift(payload.version);
    return respond(created);
  },

  updateEnvVersion: async (
    envId: string,
    version: string,
    payload: {
      apiMode?: string;
      entrypoint?: string;
      package?: string;
      active?: boolean;
      mapSets?: { id: string; maps: string[] }[];
      scenarioSchema?: Record<string, unknown>;
    },
  ) => {
    const list = state.envVersions[envId] || [];
    const target = must(list.find(item => item.version === version), `env_version_not_found:${envId}:${version}`);
    if (payload.apiMode !== undefined) target.apiMode = payload.apiMode;
    if (payload.entrypoint !== undefined) target.entrypoint = payload.entrypoint;
    if (payload.package !== undefined) target.package = payload.package;
    if (payload.active !== undefined) target.active = payload.active;
    if (payload.mapSets !== undefined) target.mapSets = payload.mapSets as any;
    if (payload.scenarioSchema !== undefined) target.scenarioSchema = payload.scenarioSchema as any;
    return respond(target);
  },

  freezeEnvVersion: async (envId: string, version: string): Promise<EnvVersion> => {
    const list = state.envVersions[envId] || [];
    const target = must(list.find(item => item.version === version), `env_version_not_found:${envId}:${version}`);
    target.frozen = true;
    return respond(target);
  },

  getPools: async (): Promise<OpponentPool[]> => respond(state.pools.map(pool => normalizePoolSummary(pool))),

  getPoolById: async (id: string): Promise<OpponentPool> => {
    const pool = must(state.pools.find(item => item.id === id), `pool_not_found:${id}`);
    return respond({ ...normalizePoolSummary(pool), memberSnapshotIds: pool.memberSnapshotIds } as any);
  },

  createPool: async (payload: { name: string; env: string; version?: string; memberSnapshotIds?: string[] }) => {
    const normalizedKey = payload.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const created = {
      id: `pool_${randomToken('')}`,
      poolKey: normalizedKey || `pool_${shortId(randomToken(''))}`,
      name: payload.name,
      env: payload.env,
      version: payload.version || '1.0.0',
      size: payload.memberSnapshotIds?.length || 0,
      frozen: false,
      created: new Date().toISOString(),
      memberSnapshotIds: payload.memberSnapshotIds || [],
    } as OpponentPool & { memberSnapshotIds: string[] };
    state.pools.unshift(created);
    state.poolVersions[created.id] = [normalizePoolSummary(created)];
    return respond(normalizePoolSummary(created) as any);
  },

  createPoolVersion: async (poolId: string, payload?: { version?: string; memberSnapshotIds?: string[] }) => {
    const pool = must(state.pools.find(item => item.id === poolId), `pool_not_found:${poolId}`);
    if (payload?.memberSnapshotIds) {
      pool.memberSnapshotIds = Array.from(new Set(payload.memberSnapshotIds));
    }
    const history = state.poolVersions[poolId] || [];
    const nextVersion = payload?.version || nextVersionLabel(history.map(item => item.version));
    pool.version = nextVersion;
    pool.size = pool.memberSnapshotIds.length;
    pool.created = new Date().toISOString();
    history.unshift({ ...normalizePoolSummary(pool), version: nextVersion, size: pool.memberSnapshotIds.length });
    state.poolVersions[poolId] = history;
    return respond({ ...normalizePoolSummary(pool), memberSnapshotIds: pool.memberSnapshotIds } as any);
  },

  listPoolVersions: async (poolId: string): Promise<OpponentPool[]> => respond(state.poolVersions[poolId] || []),

  updatePoolMembers: async (poolId: string, payload: { snapshotIds: string[]; mode: 'append' | 'remove' }) => {
    const pool = must(state.pools.find(item => item.id === poolId), `pool_not_found:${poolId}`);
    if (payload.mode === 'append') {
      pool.memberSnapshotIds = Array.from(new Set([...pool.memberSnapshotIds, ...payload.snapshotIds]));
    } else {
      const removeSet = new Set(payload.snapshotIds);
      pool.memberSnapshotIds = pool.memberSnapshotIds.filter(item => !removeSet.has(item));
    }
    pool.size = pool.memberSnapshotIds.length;
    return respond({ ...normalizePoolSummary(pool), memberSnapshotIds: pool.memberSnapshotIds } as any);
  },

  freezePool: async (poolId: string): Promise<OpponentPool> => {
    const pool = must(state.pools.find(item => item.id === poolId), `pool_not_found:${poolId}`);
    pool.frozen = true;
    return respond({ ...normalizePoolSummary(pool), memberSnapshotIds: pool.memberSnapshotIds } as any);
  },

  deletePool: async (poolId: string): Promise<void> => {
    state.pools = state.pools.filter(item => item.id !== poolId);
    delete state.poolVersions[poolId];
    return respond(undefined);
  },

  getProtocols: async (): Promise<EvalProtocol[]> => respond(state.protocols),

  getProtocolById: async (id: string) => respond(must(state.protocolDetails[id], `protocol_not_found:${id}`)),

  createProtocol: async (payload: {
    name: string;
    version?: string;
    env: { envId: string; version: string; mapSet: string };
    evalSeeds: number[];
    episodesPerMatch: number;
    scenarioGrid?: Record<string, unknown>;
    opponentSampling?: Record<string, unknown>;
    opponentPoolRef?: { poolId: string; version: string };
  }) => {
    const id = `proto_${randomToken('')}`;
    const protocolKey = payload.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || id;
    const detail: EvalProtocolDetail = {
      id,
      protocolKey,
      name: payload.name,
      version: payload.version || '1.0.0',
      env: payload.env,
      evalSeeds: payload.evalSeeds,
      episodesPerMatch: payload.episodesPerMatch,
      scenarioGrid: payload.scenarioGrid,
      opponentSampling: payload.opponentSampling,
      opponentPoolRef: payload.opponentPoolRef,
      frozen: false,
      createdAt: new Date().toISOString(),
    } as any;
    const summary = normalizeProtocolSummary(detail);
    state.protocolDetails[id] = detail;
    state.protocols.unshift(summary);
    state.protocolVersions[id] = [summary];
    return respond(detail as any);
  },

  updateProtocol: async (
    protocolId: string,
    payload: {
      name?: string;
      env?: { envId: string; version: string; mapSet: string };
      evalSeeds?: number[];
      episodesPerMatch?: number;
      scenarioGrid?: Record<string, unknown> | null;
      opponentSampling?: Record<string, unknown> | null;
      opponentPoolRef?: { poolId: string; version: string } | null;
    },
  ) => {
    const detail = must(state.protocolDetails[protocolId], `protocol_not_found:${protocolId}`);
    if (payload.name !== undefined) detail.name = payload.name;
    if (payload.env !== undefined) detail.env = payload.env;
    if (payload.evalSeeds !== undefined) detail.evalSeeds = payload.evalSeeds;
    if (payload.episodesPerMatch !== undefined) detail.episodesPerMatch = payload.episodesPerMatch;
    if (payload.scenarioGrid !== undefined) (detail as any).scenarioGrid = payload.scenarioGrid || undefined;
    if (payload.opponentSampling !== undefined) (detail as any).opponentSampling = payload.opponentSampling || undefined;
    if (payload.opponentPoolRef !== undefined) detail.opponentPoolRef = payload.opponentPoolRef || undefined;

    const summary = normalizeProtocolSummary(detail);
    state.protocols = state.protocols.map(item => (item.id === protocolId ? summary : item));
    return respond(detail as any);
  },

  createProtocolVersion: async (
    protocolId: string,
    payload?: {
      version?: string;
      name?: string;
      env?: { envId: string; version: string; mapSet: string };
      evalSeeds?: number[];
      episodesPerMatch?: number;
      scenarioGrid?: Record<string, unknown>;
      opponentSampling?: Record<string, unknown>;
      opponentPoolRef?: { poolId: string; version: string };
    },
  ) => {
    const detail = must(state.protocolDetails[protocolId], `protocol_not_found:${protocolId}`);
    const history = state.protocolVersions[protocolId] || [];
    const nextVersion = payload?.version || nextVersionLabel(history.map(item => item.version));
    detail.version = nextVersion;
    detail.name = payload?.name || detail.name;
    if (payload?.env) detail.env = payload.env;
    if (payload?.evalSeeds) detail.evalSeeds = payload.evalSeeds;
    if (payload?.episodesPerMatch) detail.episodesPerMatch = payload.episodesPerMatch;
    if (payload?.scenarioGrid !== undefined) (detail as any).scenarioGrid = payload.scenarioGrid;
    if (payload?.opponentSampling !== undefined) (detail as any).opponentSampling = payload.opponentSampling;
    if (payload?.opponentPoolRef !== undefined) detail.opponentPoolRef = payload.opponentPoolRef;
    detail.createdAt = new Date().toISOString();

    const summary = normalizeProtocolSummary(detail);
    state.protocols = state.protocols.map(item => (item.id === protocolId ? summary : item));
    history.unshift(clone(summary));
    state.protocolVersions[protocolId] = history;
    return respond(detail as any);
  },

  listProtocolVersions: async (protocolId: string): Promise<EvalProtocol[]> => respond(state.protocolVersions[protocolId] || []),

  freezeProtocol: async (protocolId: string) => {
    const detail = must(state.protocolDetails[protocolId], `protocol_not_found:${protocolId}`);
    detail.frozen = true;
    const summary = normalizeProtocolSummary(detail);
    summary.frozen = true;
    state.protocols = state.protocols.map(item => (item.id === protocolId ? summary : item));
    return respond(detail as any);
  },

  deleteProtocol: async (protocolId: string): Promise<void> => {
    state.protocols = state.protocols.filter(item => item.id !== protocolId);
    delete state.protocolDetails[protocolId];
    delete state.protocolVersions[protocolId];
    return respond(undefined);
  },

  submitEvalJob: async (payload: { policySnapshotId: string; protocolId: string; resources?: { gpus: number } }) => {
    const runId = `run_eval_${randomToken('')}`;
    const evalResultId = `eval_${randomToken('')}`;
    const protocol = must(state.protocolDetails[payload.protocolId], `protocol_not_found:${payload.protocolId}`);
    const run: Run = {
      id: runId,
      projectId: state.projects[0]?.id || 'proj_hackathon',
      name: `Eval ${shortId(payload.policySnapshotId)} on ${protocol.name}`,
      type: RunType.EVAL,
      status: JobStatus.SUCCEEDED,
      algo: 'eval',
      env: `${protocol.env.envId}:${protocol.env.mapSet}`,
      gpu: payload.resources?.gpus || 1,
      created: new Date().toISOString(),
      config: {
        protocolId: payload.protocolId,
        evalResultId,
        policySnapshotId: payload.policySnapshotId,
      },
      metrics: {
        returnMean: makeSeries(16, 12.1, 13.2, 0.1),
        winRate: makeSeries(16, 0.72, 0.83, 0.02),
        entropy: makeSeries(16, 0.31, 0.25, 0.01),
      },
    };
    state.runs.unshift(run);
    state.evalResults[evalResultId] = {
      id: evalResultId,
      runId,
      protocolId: payload.protocolId,
      metrics: { winRate: 0.813, returnMean: 13.2 },
      summary: { mean: 0.813, std: 0.042, n: 96 },
      ci: { low: 0.787, high: 0.842, level: 0.95 },
      createdAt: new Date().toISOString(),
    };
    const job: JobRecord = {
      id: `job_${shortId(runId)}`,
      runId,
      status: JobStatus.SUCCEEDED,
      createdAt: run.created,
      updatedAt: run.created,
      message: 'completed',
    };
    state.jobs.unshift(job);
    state.logs[runId] = buildRunLogs(run.name, run.status);
    upsertArtifacts(runId, makeArtifactsForRun(runId, 'eval_auto', true));
    refreshProjectStats();
    return respond({ runId, jobId: job.id, evalResultId });
  },

  getDatasets: async (): Promise<Dataset[]> => respond(byCreatedDesc((state.datasets as any)) as any),

  getDatasetPreview: async (datasetId: string) => {
    const preview = state.datasetPreviews[datasetId];
    if (!preview) throw new Error(`dataset_preview_not_found:${datasetId}`);
    return respond(preview);
  },

  getDatasetDownloadUrl: async (datasetId: string) => {
    const dataset = must(state.datasets.find(item => item.id === datasetId), `dataset_not_found:${datasetId}`);
    return respond({ url: downloadDatasetAsJsonl(dataset) });
  },

  registerDataset: async (payload: { name: string; description?: string; path: string; format?: string }): Promise<Dataset> => {
    const created: Dataset = {
      id: `ds_${randomToken('')}`,
      name: payload.name,
      description: payload.description,
      path: payload.path,
      format: payload.format || 'jsonl',
      sizeBytes: 1024 * 1024 * 64,
      createdAt: new Date().toISOString(),
    };
    state.datasets.unshift(created);
    state.datasetPreviews[created.id] = {
      columns: ['sample', 'value'],
      rows: [{ sample: 1, value: 'mock' }, { sample: 2, value: 'preview' }],
      totalRows: 2,
    };
    return respond(created);
  },

  uploadDataset: async (payload: { name: string; description?: string; format?: string; file: File }): Promise<Dataset> => {
    const created: Dataset = {
      id: `ds_${randomToken('')}`,
      name: payload.name,
      description: payload.description,
      path: `/uploads/${payload.file.name}`,
      format: payload.format || 'jsonl',
      sizeBytes: payload.file.size || 1024 * 1024,
      createdAt: new Date().toISOString(),
    };
    state.datasets.unshift(created);
    state.datasetPreviews[created.id] = {
      columns: ['file', 'size_bytes'],
      rows: [{ file: payload.file.name, size_bytes: payload.file.size || 0 }],
      totalRows: 1,
    };
    return respond(created);
  },

  submitTrainJob: async (payload: {
    projectId: string;
    templateVersionId: string;
    env: { envId: string; version: string; mapSet: string; wrappers?: string[] } & Record<string, unknown>;
    algo: { algoId: string; algoVersionId: string; preset?: string } & Record<string, unknown>;
    train: { totalEnvSteps: number; rolloutLen: number; batchSize: number; lr: number } & Record<string, unknown>;
    network?: Record<string, unknown>;
    resources: { gpus: number; priority?: number };
    seedSet?: number[];
    plugin?: { pluginId: string; version: string };
    git?: { repo?: string; branch?: string; commit?: string };
    groupId?: string;
    datasetId?: string;
  }) => {
    const runId = `run_train_${randomToken('')}`;
    const jobId = `job_${shortId(runId)}`;
    const run = createTrainRunSkeleton(runId, payload, `Train ${payload.algo.algoId.toUpperCase()} ${shortId(runId)}`);
    run.config = { ...run.config, groupId: payload.groupId, datasetId: payload.datasetId };
    (run as any).groupId = payload.groupId;

    state.runs.unshift(run);
    state.jobs.unshift({ id: jobId, runId, status: JobStatus.RUNNING, createdAt: run.created, updatedAt: run.created, message: 'running' });
    state.logs[runId] = buildRunLogs(run.name, run.status);
    state.checkpoints[runId] = [
      { id: `${runId}_ckpt_200000`, runId, step: 200000, metrics: { returnMean: 7.1, winRate: 0.53 }, path: '/checkpoints/ckpt_200000.json', tags: [], createdAt: isoMinutesAgo(1) },
    ];
    upsertArtifacts(runId, makeArtifactsForRun(runId, shortId(runId), false));

    if (payload.groupId) {
      const list = state.runGroupIndex[payload.groupId] || [];
      list.push(runId);
      state.runGroupIndex[payload.groupId] = list;
    }

    refreshProjectStats();
    return respond({ runId, jobId });
  },

  getTuningStudy: async (studyName: string) => {
    if (!studyName) {
      return respond({ error: true, details: 'study_name_required' });
    }
    return respond(tuneStudy(studyName));
  },

  submitMatrixJob: async (payload: {
    poolId?: string;
    policySnapshotIds: string[];
    protocolId: string;
    gamesPerPair?: number;
    metric?: string;
    resources?: { gpus: number };
  }) => {
    const matrixId = `matrix_${randomToken('')}`;
    const labels = payload.policySnapshotIds.length > 0
      ? payload.policySnapshotIds.map(item => shortId(item))
      : ['policy_a', 'policy_b', 'policy_c'];
    const metric = payload.metric || 'winRate';
    const cells = matrixCellsFromLabels(labels, metric);
    const createdAt = new Date().toISOString();
    const matrix: MatrixResult = {
      id: matrixId,
      protocolId: payload.protocolId,
      poolId: payload.poolId,
      createdAt,
      cells,
      labels,
      matrix: labels.map(row => labels.map(col => cells.find(cell => cell.row === row && cell.col === col)?.value || 0)),
      meta: {
        gamesPerPair: payload.gamesPerPair || 10,
        seeds: [1, 2, 3],
        metric,
      },
      ranking: labels.map((id, idx) => ({ id, score: Number((1 - idx * 0.1).toFixed(3)) })),
      exportUrl: `data:text/csv;charset=utf-8,${encodeURIComponent(toCsv(cells))}`,
      summary: {
        generatedBy: 'mock',
        replay: buildAdversarialReplay(`Matrix ${shortId(matrixId)} replay`, 'SMAC 3s5z', `${matrixId}_summary`, 'matrix'),
      },
    };
    state.matrixResults.unshift(matrix);

    const runId = `run_matrix_${randomToken('')}`;
    const run: Run = {
      id: runId,
      projectId: state.projects[0]?.id || 'proj_hackathon',
      name: `Matrix ${shortId(matrixId)}`,
      type: RunType.MATRIX,
      status: JobStatus.SUCCEEDED,
      algo: 'matrix',
      env: `${payload.protocolId || 'protocol'}:${metric}`,
      gpu: payload.resources?.gpus || 1,
      created: createdAt,
      config: {
        matrixId,
        protocolId: payload.protocolId,
        poolId: payload.poolId,
      },
      metrics: {
        returnMean: [],
        winRate: [],
        entropy: [],
      },
    };
    state.runs.unshift(run);
    const jobId = `job_${shortId(runId)}`;
    state.jobs.unshift({ id: jobId, runId, status: JobStatus.SUCCEEDED, createdAt, updatedAt: createdAt, message: 'completed' });
    state.logs[runId] = buildRunLogs(run.name, run.status);
    upsertArtifacts(runId, makeArtifactsForRun(runId, shortId(runId), true));
    refreshProjectStats();

    return respond({ matrixId, jobId });
  },

  getEvalResultById: async (id: string) => respond(must(state.evalResults[id], `eval_result_not_found:${id}`)),

  getMatrixResults: async (params?: { runId?: string; protocolId?: string; poolId?: string }): Promise<MatrixResult[]> => {
    let list = state.matrixResults.slice();
    if (params?.runId) {
      const run = state.runs.find(item => item.id === params.runId);
      const matrixId = (run?.config as any)?.matrixId;
      list = list.filter(item => item.id === matrixId);
    }
    if (params?.protocolId) list = list.filter(item => item.protocolId === params.protocolId);
    if (params?.poolId) list = list.filter(item => item.poolId === params.poolId);
    return respond(byCreatedDesc((list as any)) as any);
  },

  getMatrixResultById: async (id: string): Promise<MatrixResult> => respond(must(state.matrixResults.find(item => item.id === id), `matrix_not_found:${id}`)),

  getJobById: async (jobId: string) => respond(must(state.jobs.find(item => item.id === jobId), `job_not_found:${jobId}`) as any),

  pauseJob: async (jobId: string, payload?: { reason?: string }) => {
    const job = must(state.jobs.find(item => item.id === jobId), `job_not_found:${jobId}`);
    job.message = `paused${payload?.reason ? `: ${payload.reason}` : ''}`;
    job.updatedAt = new Date().toISOString();
    job.status = JobStatus.RUNNING;
    return respond(job as any);
  },

  resumeJob: async (jobId: string, payload?: { reason?: string }) => {
    const job = must(state.jobs.find(item => item.id === jobId), `job_not_found:${jobId}`);
    job.message = payload?.reason ? `running: ${payload.reason}` : 'running';
    job.updatedAt = new Date().toISOString();
    job.status = JobStatus.RUNNING;
    return respond(job as any);
  },

  cancelJob: async (jobId: string, payload?: { reason?: string }) => {
    const job = must(state.jobs.find(item => item.id === jobId), `job_not_found:${jobId}`);
    job.status = JobStatus.CANCELED;
    job.message = payload?.reason || 'canceled';
    job.updatedAt = new Date().toISOString();
    const run = state.runs.find(item => item.id === job.runId);
    if (run) run.status = JobStatus.CANCELED;
    return respond(job as any);
  },

  downloadRunArtifactsArchive: async (runId: string): Promise<Blob> => {
    const list = state.artifacts[runId] || [];
    const content = [
      `# Artifacts for ${runId}`,
      ...list.map(item => `${item.path} (${item.size || '-'})`),
    ].join('\n');
    return new Blob([content], { type: 'text/plain' });
  },

  getPlugins: async (params?: { includeArchived?: boolean }): Promise<Plugin[]> => {
    const list = params?.includeArchived ? state.plugins.slice() : state.plugins.filter(item => !item.archived);
    return respond(list);
  },

  getPluginVersions: async (pluginId: string): Promise<PluginVersion[]> => respond(state.pluginVersions[pluginId] || []),

  createPluginVersion: async (payload: {
    pluginId: string;
    version: string;
    wheelUri: string;
    sha256: string;
    manifest?: Record<string, unknown>;
  }) => {
    const created: PluginVersion = {
      pluginId: payload.pluginId,
      version: payload.version,
      wheelUri: payload.wheelUri,
      sha256: payload.sha256,
      manifest: payload.manifest,
      frozen: false,
    };
    const list = state.pluginVersions[payload.pluginId] || [];
    list.unshift(created);
    state.pluginVersions[payload.pluginId] = list;

    if (!state.plugins.find(item => item.id === payload.pluginId)) {
      state.plugins.unshift({
        id: payload.pluginId,
        name: payload.pluginId,
        version: payload.version,
        type: 'Model' as any,
        installed: true,
        archived: false,
        description: 'Created in demo mode',
      });
    }

    return respond(created);
  },

  updatePlugin: async (pluginId: string, payload: { name?: string; description?: string; author?: string; type?: string; installed?: boolean; archived?: boolean }): Promise<Plugin> => {
    const plugin = must(state.plugins.find(item => item.id === pluginId), `plugin_not_found:${pluginId}`);
    if (payload.name !== undefined) plugin.name = payload.name;
    if (payload.description !== undefined) plugin.description = payload.description;
    if (payload.author !== undefined) plugin.author = payload.author;
    if (payload.type !== undefined) plugin.type = payload.type as any;
    if (payload.installed !== undefined) plugin.installed = payload.installed;
    if (payload.archived !== undefined) plugin.archived = payload.archived;
    return respond(plugin);
  },

  archivePlugin: async (pluginId: string): Promise<void> => {
    const plugin = must(state.plugins.find(item => item.id === pluginId), `plugin_not_found:${pluginId}`);
    plugin.archived = true;
    return respond(undefined);
  },

  freezePluginVersion: async (pluginId: string, version: string) => {
    const list = state.pluginVersions[pluginId] || [];
    const target = must(list.find(item => item.version === version), `plugin_version_not_found:${pluginId}:${version}`);
    target.frozen = true;
    return respond(target);
  },

  getArtifacts: async (runId: string): Promise<ArtifactFile[]> => respond(state.artifacts[runId] || []),

  getArtifactDownloadUrl: async (artifactId: string) => {
    const artifact = must(state.artifactById[artifactId], `artifact_not_found:${artifactId}`);
    if (artifact.externalUrl) {
      return respond({ url: artifact.externalUrl, expiresAt: isoMinutesAgo(-30) });
    }
    const url = urlFromContent(artifact.id, artifact.content || JSON.stringify({ id: artifact.id, path: artifact.path }), artifact.mime || 'text/plain');
    return respond({ url, expiresAt: isoMinutesAgo(-30) });
  },

  getReproBundle: async (runId: string) => {
    const run = must(state.runs.find(item => item.id === runId), `run_not_found:${runId}`);
    const script = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `echo "Reproducing ${run.name}"`,
      `echo "Run ID: ${run.id}"`,
      'echo "This is a mock repro bundle."',
    ].join('\n');
    return respond({
      url: urlFromContent(`repro_${runId}`, script, 'text/x-shellscript'),
      manifest: {
        runId: run.id,
        projectId: run.projectId,
        algo: run.algo,
        env: run.env,
        createdAt: run.created,
        config: run.config,
      },
    });
  },

  createNotebook: async (projectId: string, name?: string) => {
    const runId = `run_notebook_${randomToken('')}`;
    const created: Run = {
      id: runId,
      projectId,
      name: name || `Notebook ${shortId(runId)}`,
      type: 'NOTEBOOK' as any,
      status: JobStatus.RUNNING,
      algo: 'notebook',
      env: 'python',
      gpu: 0,
      created: new Date().toISOString(),
      config: {
        url: 'https://jupyter.org/try-jupyter/lab/',
        token: 'demo-token',
      },
      metrics: {
        returnMean: [],
        winRate: [],
        entropy: [],
      },
    };
    state.runs.unshift(created);
    state.jobs.unshift({
      id: `job_${shortId(runId)}`,
      runId,
      status: JobStatus.RUNNING,
      createdAt: created.created,
      updatedAt: created.created,
      message: 'workspace alive',
    });
    state.logs[runId] = ['JupyterLab ready.', 'Kernel warmed up.'];
    refreshProjectStats();
    return respond({ runId, url: created.config.url, token: created.config.token });
  },

  deleteNotebook: async (runId: string) => {
    state.runs = state.runs.filter(run => run.id !== runId);
    state.jobs = state.jobs.filter(job => job.runId !== runId);
    delete state.logs[runId];
    refreshProjectStats();
    return respond(undefined);
  },

  getModels: async (): Promise<RegisteredModel[]> => respond(state.models),

  createModel: async (name: string, description?: string): Promise<RegisteredModel> => {
    const created: RegisteredModel = {
      id: `model_${randomToken('')}`,
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.models.unshift(created);
    state.modelVersions[created.id] = [];
    return respond(created);
  },

  getModelVersions: async (modelId: string): Promise<ModelVersion[]> => respond(state.modelVersions[modelId] || []),

  registerModelVersion: async (modelId: string, checkpointId: string): Promise<ModelVersion> => {
    const list = state.modelVersions[modelId] || [];
    const highest = list.reduce((max, item) => Math.max(max, Number(item.version) || 0), 0);
    const created: ModelVersion = {
      id: `model_ver_${randomToken('')}`,
      modelId,
      version: highest + 1,
      checkpointId,
      stage: 'None',
      createdAt: new Date().toISOString(),
    };
    list.unshift(created);
    state.modelVersions[modelId] = list;
    const model = state.models.find(item => item.id === modelId);
    if (model) model.updatedAt = new Date().toISOString();
    return respond(created);
  },

  updateModelStage: async (versionId: string, stage: string): Promise<ModelVersion> => {
    const entry = Object.values(state.modelVersions)
      .flat()
      .find(version => version.id === versionId);
    const target = must(entry, `model_version_not_found:${versionId}`);
    target.stage = stage;
    return respond(target);
  },

  listAgenticApprovalPolicyTemplates: async (): Promise<AgenticApprovalPolicyTemplateListResponse> =>
    respond(agenticApprovalPolicyTemplates()),
  suggestAgenticApprovalPolicyTemplates: async (idea: AgenticIdeaInput): Promise<AgenticApprovalPolicyTemplateListResponse> =>
    respond(agenticApprovalPolicyTemplates(idea)),
  listAgenticApprovers: async (): Promise<AgenticApproverListResponse> =>
    respond(AGENTIC_APPROVERS_FALLBACK),

  validateAgenticSpec: async (idea: AgenticIdeaInput): Promise<AgenticSpecValidationResponse> => {
    const drafts = buildAgenticDraftsFromIdea(idea);
    return respond({
      valid: true,
      normalizedSpec: drafts.normalizedSpec,
      rootConfigDraft: drafts.rootConfigDraft,
      evalProtocolDraft: drafts.evalProtocolDraft,
      riskStatement: drafts.riskStatement,
      retrievalContext: drafts.retrievalContext,
    });
  },

  createAgenticRun: async (payload: {
    idea: AgenticIdeaInput;
    autoExecute?: boolean;
    induceFailure?: boolean;
  }): Promise<AgenticRunCreateResponse> => {
    const runId = `agentic_${randomToken('run')}`;
    const detail = makeAgenticRunDetail(runId, payload.idea);
    if (payload.induceFailure) {
      const integrationNode = detail.totTree.find(node => node.agent === 'IntegrationAgent');
      if (integrationNode) {
        integrationNode.status = 'FAILED';
        integrationNode.evidence = {
          reason: "ModuleNotFoundError: No module named 'pettingzoo'",
          fixSuggestion: 'switch_offline_stub',
        };
        const repairNode = createAgenticNode(
          `n${detail.totTree.length}`,
          'IntegrationAgent',
          `Repair Branch for ${integrationNode.nodeId}`,
          integrationNode.nodeId,
          'medium',
          'PENDING',
        );
        detail.totTree.push(repairNode);
      }
    }
    if (payload.autoExecute) {
      detail.status = 'SUCCEEDED';
      detail.totTree = detail.totTree.map(node => ({
        ...node,
        status: node.status === 'FAILED' ? 'SUCCEEDED' : (node.status === 'PENDING' ? 'SUCCEEDED' : node.status),
      }));
      detail.events.push({
        ts: new Date().toISOString(),
        event: 'run_completed',
        message: 'Auto-executed in demo mode',
        payload: { runId },
      });
    }
    refreshAgenticSearchMeta(detail);
    detail.searchStats = computeAgenticSearchStats(detail);
    state.agenticRuns[runId] = detail;
    return respond({ runId, status: detail.status, detail });
  },

  listAgenticRuns: async (params?: { page?: number; pageSize?: number }): Promise<AgenticListResponse> => {
    const pageSize = Math.max(1, params?.pageSize || 20);
    const page = Math.max(1, params?.page || 1);
    const list = Object.values(state.agenticRuns)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(detail => summarizeAgenticRun(detail));
    const start = (page - 1) * pageSize;
    return respond({
      page,
      pageSize,
      total: list.length,
      items: list.slice(start, start + pageSize),
    });
  },

  getAgenticRun: async (runId: string): Promise<AgenticRunDetail> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    return respond(detail);
  },
  getAgenticRunReport: async (runId: string): Promise<AgenticRunReportResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    const generatedAt = new Date().toISOString();
    const approvals = (detail.pendingApprovals || []).reduce(
      (acc, item) => {
        const status = String((item as Record<string, unknown>).status || '').toUpperCase();
        if (status === 'PENDING') acc.pending += 1;
        else if (status === 'APPROVED') acc.approved += 1;
        else if (status === 'REJECTED') acc.rejected += 1;
        else if (status === 'EXPIRED') acc.expired += 1;
        else if (status === 'REOPENED') acc.reopened += 1;
        return acc;
      },
      { pending: 0, approved: 0, rejected: 0, expired: 0, reopened: 0 },
    );
    const subAgents = (detail.totTree || []).flatMap(node => (node.subAgents || []));
    const roleMap = new Map<string, number>();
    const subStats = { total: 0, running: 0, succeeded: 0, failed: 0 };
    subAgents.forEach(item => {
      const row = item as Record<string, unknown>;
      const status = String(row.status || '').toUpperCase();
      subStats.total += 1;
      if (status === 'RUNNING') subStats.running += 1;
      else if (status === 'SUCCEEDED') subStats.succeeded += 1;
      else if (status === 'FAILED') subStats.failed += 1;
      const role = String(row.role || 'SubAgent');
      roleMap.set(role, (roleMap.get(role) || 0) + 1);
    });
    const topRoles = Array.from(roleMap.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const timelineEvents = (detail.timeline?.length || 0) + (detail.events?.length || 0);
    const eventBlob = (detail.events || []).map(evt => `${String(evt.event || '')} ${String(evt.message || '')}`.toLowerCase());
    const timelineBlob = (detail.timeline || []).map(item => `${String((item as any).phase || '')} ${String((item as any).status || '')}`.toLowerCase());
    const allBlob = [...eventBlob, ...timelineBlob];
    const countByTokens = (tokens: string[]) => allBlob.filter(text => tokens.some(token => text.includes(token))).length;
    const ranking = (detail.matrix?.ranking || []).slice(0, 5).map((item, idx) => ({
      rank: idx + 1,
      id: item.id,
      score: Number(item.score || 0),
    }));

    const report = {
      runId,
      title: String((detail.idea as Record<string, unknown>)?.title || 'Agentic Demo Run'),
      status: detail.status,
      generatedAt,
      objective: String((detail.idea as Record<string, unknown>)?.taskGoal || ''),
      contractPassRate: Number((detail.contract?.passRate || 0)),
      contractMissing: (detail.contract?.missing || []).map(item => String(item)),
      totNodes: detail.totTree.length,
      timelineEvents,
      failureEvents: countByTokens(['fail', 'blocked', 'error']),
      recoveryEvents: countByTokens(['repair', 'retry', 'recover', 'reopen']),
      safetyEvents: countByTokens(['approval', 'safety', 'policy', 'audit']),
      leagueEvents: countByTokens(['matrix', 'league', 'ranking']),
      approvals,
      subAgents: {
        ...subStats,
        topRoles,
      },
      matrix: {
        labels: detail.matrix?.labels?.length || 0,
        topRanking: ranking,
      },
      reproScript: `.local/agentic_os/runs/${runId}/repro_bundle/reproduce.sh`,
      replayCommand: `python scripts/agentic_marl_os.py replay --run-id ${runId}`,
      nodeStatus: {
        pending: detail.totTree.filter(node => ['PENDING', 'RETRY_PENDING'].includes(String(node.status).toUpperCase())).length,
        running: detail.totTree.filter(node => String(node.status).toUpperCase() === 'RUNNING').length,
        blocked: detail.totTree.filter(node => String(node.status).toUpperCase() === 'BLOCKED').length,
        failed: detail.totTree.filter(node => String(node.status).toUpperCase() === 'FAILED').length,
        succeeded: detail.totTree.filter(node => String(node.status).toUpperCase() === 'SUCCEEDED').length,
      },
      registryRecord: detail.registryRecord || {},
      approvalPolicyMeta: ((detail.researchSpec as Record<string, unknown>)?.approvalPolicyMeta || {}) as Record<string, unknown>,
    };

    const markdown = [
      `# Agentic Run Report - ${runId}`,
      '',
      `- generated_at: ${generatedAt}`,
      `- title: ${report.title}`,
      `- status: ${report.status}`,
      `- objective: ${report.objective}`,
      `- contract_pass_rate: ${Number(report.contractPassRate).toFixed(2)}%`,
      '',
      '## Repro & Replay',
      `- reproduce_script: ${report.reproScript}`,
      `- replay_command: ${report.replayCommand}`,
      '',
    ].join('\n');

    return respond({
      runId,
      generatedAt,
      report,
      markdown,
      artifactJsonPath: `demo://agentic/${runId}/run_report.json`,
      artifactMarkdownPath: `demo://agentic/${runId}/run_report.md`,
    });
  },

  listAgenticSubAgents: async (
    runId: string,
    params?: { page?: number; pageSize?: number; nodeId?: string; status?: string },
  ): Promise<AgenticSubAgentListResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    const pageSize = Math.max(1, params?.pageSize || 50);
    const page = Math.max(1, params?.page || 1);
    const rows = detail.totTree.flatMap(node =>
      (node.subAgents || []).map((sa, idx) => {
        const rec = sa as Record<string, unknown>;
        return {
          subAgentId: String(rec.subAgentId || `${node.nodeId}-sa-${idx}`),
          parentNodeId: String(rec.parentNodeId || node.nodeId),
          parentSubAgentId: (rec.parentSubAgentId as string | undefined) || null,
          ownerAgent: String(rec.ownerAgent || node.agent),
          role: String(rec.role || 'SubAgent'),
          objective: String(rec.objective || ''),
          depth: Number(rec.depth || 1),
          status: String(rec.status || 'SUCCEEDED'),
          startedAt: String(rec.startedAt || detail.updatedAt),
          finishedAt: (rec.finishedAt as string | undefined) || null,
          evidence: (rec.evidence as Record<string, unknown>) || {},
          children: Array.isArray(rec.children) ? rec.children.map(v => String(v)) : [],
        };
      }),
    );
    const filtered = rows
      .filter(row => !params?.nodeId || row.parentNodeId === params.nodeId)
      .filter(row => !params?.status || row.status.toUpperCase() === String(params.status).toUpperCase())
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    const start = (page - 1) * pageSize;
    return respond({
      runId,
      page,
      pageSize,
      total: filtered.length,
      items: filtered.slice(start, start + pageSize),
    });
  },

  executeAgenticRun: async (runId: string, payload?: { mode?: 'all' | 'next' }): Promise<AgenticActionResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    const mode = payload?.mode || 'all';
    refreshAgenticSearchMeta(detail);
    const pending = detail.totTree
      .filter(node => node.status === 'PENDING' || node.status === 'RETRY_PENDING')
      .sort((a, b) => {
        const sa = Number((((a.evidence || {}) as Record<string, unknown>).search as any)?.frontierScore || 0);
        const sb = Number((((b.evidence || {}) as Record<string, unknown>).search as any)?.frontierScore || 0);
        return sb - sa;
      });
    const targetNodes = mode === 'next' ? pending.slice(0, 1) : pending;
    const forbidden = new Set(((detail.researchSpec as any)?.constraints?.forbiddenActions as string[]) || []);
    const requested = ((detail.researchSpec as any)?.requestedActions as string[]) || [];
    const executionMode = String((detail.researchSpec as any)?.execution?.mode || 'offline_stub');
    const approvalPolicy = ((detail.researchSpec as any)?.approvalPolicy || {}) as Record<string, unknown>;
    const minApprovals = Math.max(1, Math.min(3, Number(approvalPolicy.minApprovals || 1)));
    const requireDistinctRoles = Boolean(approvalPolicy.requireDistinctRoles || approvalPolicy.require_distinct_roles || false);
    const approvalTtlMinutes = Math.max(5, Math.min(10080, Number(approvalPolicy.approvalTtlMinutes || approvalPolicy.approval_ttl_minutes || 120)));
    const highRiskRoles = Array.isArray(approvalPolicy.highRiskActionRoles)
      ? (approvalPolicy.highRiskActionRoles as string[])
      : ['admin', 'ops', 'security'];

    const ensurePendingApproval = (nodeId: string, action: string, reason: string, requiredRoles: string[]) => {
      const existing = detail.pendingApprovals.find(item => item.action === action && item.status === 'PENDING');
      if (existing) return;
      detail.pendingApprovals.push({
        id: randomToken('appr'),
        nodeId,
        action,
        reason,
        status: 'PENDING',
        requiredApprovals: minApprovals,
        requireDistinctRoles,
        approvalTtlMinutes,
        approvalVotes: 0,
        requiredRoles,
        approvals: [],
        expiresAt: new Date(Date.now() + approvalTtlMinutes * 60 * 1000).toISOString(),
      } as any);
    };

    const nodeExists = (nodeId: string) => detail.totTree.some(node => node.nodeId === nodeId);
    const nextNodeId = () => {
      let idx = detail.totTree.length;
      let nodeId = `n${idx}`;
      while (nodeExists(nodeId)) {
        idx += 1;
        nodeId = `n${idx}`;
      }
      return nodeId;
    };

    targetNodes.forEach(node => {
      const nodeTs = new Date().toISOString();
      const evidence = (node.evidence || {}) as Record<string, unknown>;
      const search = ((evidence.search as Record<string, unknown>) || {}) as Record<string, unknown>;
      const depth = Number(search.depth || 0);
      const prevVisits = Number(search.visits || 0);
      const prevValue = Number(search.value || 0);
      const prevSelected = Number(search.selectedCount || 0);
      const frontierBase = clampNumber(0.55 + depth * 0.09 + Math.random() * 0.22, 0.35, 0.98);
      node.evidence = {
        ...evidence,
        search: {
          ...search,
          selectedCount: prevSelected + 1,
          frontierScore: Number(frontierBase.toFixed(4)),
          updatedAt: nodeTs,
        },
      };
      detail.events.push({
        ts: nodeTs,
        event: 'search_node_selected',
        message: `${node.nodeId} selected from search frontier`,
        payload: {
          nodeId: node.nodeId,
          depth,
          frontierScore: Number(frontierBase.toFixed(4)),
        },
      });

      if (node.agent === 'SafetyAgent') {
        const blocked = requested.filter(action => forbidden.has(action));
        if (blocked.length > 0) {
          node.status = 'BLOCKED';
          detail.status = 'BLOCKED';
          blocked.forEach(action => ensurePendingApproval(node.nodeId, action, 'policy_blocked', highRiskRoles));
          detail.events.push({
            ts: new Date().toISOString(),
            event: 'approval_required',
            message: 'Safety gate blocked high-risk actions',
            payload: { blocked },
          });
          return;
        }
      }
      if (node.title === 'Execute Candidate Run' && executionMode === 'local_shell') {
        const hasApprovedScript = detail.pendingApprovals.some(
          item => item.action === 'unknown_script_execution' && item.status === 'APPROVED',
        );
        if (!hasApprovedScript) {
          node.status = 'BLOCKED';
          detail.status = 'BLOCKED';
          ensurePendingApproval(node.nodeId, 'unknown_script_execution', 'high_risk_requires_approval', highRiskRoles);
          detail.events.push({
            ts: new Date().toISOString(),
            event: 'approval_required',
            message: 'Execution adapter requires unknown_script_execution approval',
            payload: { blocked: ['unknown_script_execution'] },
          });
          return;
        }
      }
      node.status = 'SUCCEEDED';
      const reward = clampNumber(0.45 + Math.random() * 0.5 - depth * 0.05, 0.18, 0.95);
      const nextVisits = prevVisits + 1;
      const value = ((prevValue * prevVisits) + reward) / Math.max(1, nextVisits);
      node.evidence = {
        ...node.evidence,
        executedAt: nodeTs,
        mode: executionMode,
        search: {
          ...(((node.evidence || {}) as Record<string, unknown>).search as Record<string, unknown>),
          visits: nextVisits,
          value: Number(value.toFixed(4)),
          frontierScore: Number((frontierBase * 0.86).toFixed(4)),
          updatedAt: nodeTs,
        },
        ...(executionMode === 'mle_runner'
          ? {
              mle: {
                dryRun: true,
                summary: { bestRunId: 'mle-mock-001', bestScore: 0.63, runCount: 3 },
              },
            }
          : {}),
      };
      const spawned = spawnSubAgentsForNode(detail, node);
      if (spawned.length > 0) {
        node.evidence = {
          ...node.evidence,
          subAgentsSpawned: spawned.length,
          subAgentIds: spawned.map(item => String(item.subAgentId || '')).filter(Boolean),
        };
      }
      detail.timeline.push({
        ts: nodeTs,
        nodeId: node.nodeId,
        phase: 'executed',
        status: node.status,
        cost: Number((0.01 + spawned.length * 0.006).toFixed(3)),
      });
      detail.events.push({
        ts: nodeTs,
        event: 'node_succeeded',
        message: `${node.nodeId} succeeded`,
        payload: { nodeId: node.nodeId, subAgentsSpawned: spawned.length },
      });
      if (spawned.length > 0) {
        detail.timeline.push({
          ts: nodeTs,
          nodeId: node.nodeId,
          phase: 'sub_agents_spawned',
          status: 'SUCCEEDED',
          cost: Number((spawned.length * 0.003).toFixed(3)),
        });
        detail.events.push({
          ts: nodeTs,
          event: 'sub_agents_spawned',
          message: `${node.nodeId} spawned ${spawned.length} sub-agents`,
          payload: {
            nodeId: node.nodeId,
            count: spawned.length,
            subAgents: spawned.map(item => ({
              subAgentId: item.subAgentId,
              role: item.role,
              depth: item.depth,
              parentSubAgentId: item.parentSubAgentId || null,
            })),
          },
        });
      }

      const hasChildren = (node.children || []).length > 0;
      const canExpand = !hasChildren && depth < 3 && detail.totTree.length < 36;
      if (canExpand) {
        const childCount = depth <= 1 ? 2 : 1;
        const childAgentPool = ['ResearchAgent', 'IntegrationAgent', 'EvalAgent', 'OpsAgent', 'SafetyAgent'];
        const createdIds: string[] = [];
        for (let i = 0; i < childCount; i += 1) {
          const childId = nextNodeId();
          const childAgent = childAgentPool[(depth + i + childId.length) % childAgentPool.length];
          const child = createAgenticNode(
            childId,
            childAgent,
            `${node.title} · branch ${i + 1}`,
            node.nodeId,
            depth >= 2 ? 'low' : 'medium',
            'PENDING',
          );
          child.hypothesis = `Branch ${i + 1}: test an alternative assumption under ${node.nodeId}.`;
          child.executionPlan = `Run branch ${i + 1} derived from ${node.nodeId}, then compare evidence.`;
          child.nextSuggestions = ['Execute branch', 'Compare sibling branches', 'Keep best branch'];
          child.expectedMetrics = { ...(node.expectedMetrics || {}) };
          child.budget = {
            gpuHours: Number(Math.max(0.05, Number((node.budget as any)?.gpuHours || 0.15) * 0.72).toFixed(2)),
            wallclockMinutes: Math.max(4, Math.round(Number((node.budget as any)?.wallclockMinutes || 12) * 0.7)),
          };
          ensureNodeSearchMeta(child, depth + 1);
          const childEvidence = (child.evidence || {}) as Record<string, unknown>;
          const childSearch = ((childEvidence.search as Record<string, unknown>) || {}) as Record<string, unknown>;
          child.evidence = {
            ...childEvidence,
            search: {
              ...childSearch,
              frontierScore: Number(clampNumber(frontierBase + (i + 1) * 0.07, 0.25, 0.99).toFixed(4)),
              updatedAt: nodeTs,
            },
          };
          detail.totTree.push(child);
          createdIds.push(childId);
        }
        node.children = [...(node.children || []), ...createdIds];
        const currentEvidence = (node.evidence || {}) as Record<string, unknown>;
        const currentSearch = ((currentEvidence.search as Record<string, unknown>) || {}) as Record<string, unknown>;
        node.evidence = {
          ...currentEvidence,
          search: {
            ...currentSearch,
            expanded: true,
            expandedAt: nodeTs,
            updatedAt: nodeTs,
          },
        };
        detail.timeline.push({
          ts: nodeTs,
          nodeId: node.nodeId,
          phase: 'search_expanded',
          status: 'SUCCEEDED',
          cost: 0.007,
        });
        detail.events.push({
          ts: nodeTs,
          event: 'tot_node_expanded',
          message: `${node.nodeId} expanded into ${createdIds.length} branches`,
          payload: {
            nodeId: node.nodeId,
            childIds: createdIds,
            depth,
          },
        });
      }
    });

    if (!detail.totTree.some(node => node.status === 'PENDING' || node.status === 'RETRY_PENDING' || node.status === 'BLOCKED')) {
      detail.status = 'SUCCEEDED';
    } else if (detail.status !== 'BLOCKED') {
      detail.status = 'RUNNING';
    }
    detail.updatedAt = new Date().toISOString();
    detail.registryRecord = {
      ...(detail.registryRecord || {}),
      status: detail.status,
      updatedAt: detail.updatedAt,
    };
    refreshAgenticSearchMeta(detail);
    detail.searchStats = computeAgenticSearchStats(detail);
    state.agenticRuns[runId] = detail;
    return respond({ ok: true, message: `run_status=${detail.status}`, detail });
  },

  approveAgenticActions: async (
    runId: string,
    payload: {
      approvalIds: string[];
      decision: 'approve' | 'reject' | 'reopen';
      actorId: string;
      actorRole: 'admin' | 'ops' | 'security';
      idempotencyKey?: string;
      comment?: string;
    },
  ): Promise<AgenticActionResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    const decidedAt = new Date().toISOString();
    if (payload.decision === 'reopen') {
      detail.pendingApprovals = detail.pendingApprovals.map(item => {
        if (!payload.approvalIds.includes(item.id)) return item;
        if (!['REJECTED', 'EXPIRED', 'APPROVED'].includes(String(item.status || ''))) return item;
        return {
          ...item,
          status: 'PENDING',
          approvals: [],
          approvalVotes: 0,
          reopenedAt: decidedAt,
          reopenedBy: payload.actorId,
          reopenedRole: payload.actorRole,
        } as any;
      });
      detail.status = 'BLOCKED';
      detail.updatedAt = decidedAt;
      detail.events.push({
        ts: detail.updatedAt,
        event: 'approval_reopened',
        message: 'Approvals reopened',
        payload: { approvalIds: payload.approvalIds, actorId: payload.actorId, actorRole: payload.actorRole, comment: payload.comment || '' },
      });
      refreshAgenticSearchMeta(detail);
      detail.searchStats = computeAgenticSearchStats(detail);
      state.agenticRuns[runId] = detail;
      return respond({ ok: true, message: 'approval_reopened', detail });
    }

    detail.pendingApprovals = detail.pendingApprovals.map(item => {
      if (!payload.approvalIds.includes(item.id)) {
        return item;
      }
      if (item.status !== 'PENDING') {
        return item;
      }
      if (payload.decision === 'reject') {
        return {
          ...item,
          status: 'REJECTED',
          decidedAt,
          decidedBy: payload.actorId,
          decidedRole: payload.actorRole,
          decisionComment: payload.comment || undefined,
        };
      }

      const requiredRoles = Array.isArray((item as any).requiredRoles) ? ((item as any).requiredRoles as string[]) : [];
      if (requiredRoles.length > 0 && !requiredRoles.includes(payload.actorRole)) {
        return item;
      }
      const approvalRows = Array.isArray((item as any).approvals) ? ([...(item as any).approvals] as any[]) : [];
      const actorVoted = approvalRows.some(row => String(row?.actorId || row?.actor_id || '') === payload.actorId);
      if (!actorVoted) {
        approvalRows.push({
          actorId: payload.actorId,
          actorRole: payload.actorRole,
          at: decidedAt,
          comment: payload.comment || '',
        });
      }
      const requiredApprovals = Math.max(1, Math.min(3, Number((item as any).requiredApprovals || 1)));
      const approvalVotes = approvalRows.length;
      const requireDistinctRoles = Boolean((item as any).requireDistinctRoles || (item as any).require_distinct_roles);
      const distinctRoles = new Set(approvalRows.map(row => String(row?.actorRole || row?.actor_role || '').trim()).filter(Boolean));
      const roleQuorumMet = !requireDistinctRoles || distinctRoles.size >= requiredApprovals;
      if (approvalVotes >= requiredApprovals && roleQuorumMet) {
        return {
          ...item,
          status: 'APPROVED',
          approvals: approvalRows,
          approvalVotes,
          requiredApprovals,
          requireDistinctRoles,
          approvalRoles: Array.from(distinctRoles),
          decidedAt,
          decidedBy: payload.actorId,
          decidedRole: payload.actorRole,
          decisionComment: payload.comment || undefined,
        };
      }
      return {
        ...item,
        approvals: approvalRows,
        approvalVotes,
        requiredApprovals,
        requireDistinctRoles,
        approvalRoles: Array.from(distinctRoles),
      };
    });
    if (payload.decision === 'approve') {
      const pendingExists = detail.pendingApprovals.some(item => item.status === 'PENDING');
      if (!pendingExists) {
        detail.totTree = detail.totTree.map(node =>
          node.status === 'BLOCKED' ? { ...node, status: 'RETRY_PENDING' } : node,
        );
        detail.status = 'RUNNING';
      } else {
        detail.status = 'BLOCKED';
      }
    }
    detail.updatedAt = new Date().toISOString();
    detail.events.push({
      ts: detail.updatedAt,
      event: 'approval_updated',
      message: `Approval decision=${payload.decision}`,
      payload: {
        approvalIds: payload.approvalIds,
        actorId: payload.actorId,
        actorRole: payload.actorRole,
        comment: payload.comment || '',
      },
    });
    refreshAgenticSearchMeta(detail);
    detail.searchStats = computeAgenticSearchStats(detail);
    state.agenticRuns[runId] = detail;
    return respond({ ok: true, message: 'approval_updated', detail });
  },
  recoverAgenticRun: async (runId: string): Promise<AgenticActionResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    const pending = detail.totTree.some(node => node.status === 'PENDING' || node.status === 'RETRY_PENDING');
    const blocked = detail.totTree.some(node => node.status === 'BLOCKED') || detail.pendingApprovals.some(item => item.status === 'PENDING');
    const failed = detail.totTree.some(node => node.status === 'FAILED');
    if (blocked) detail.status = 'BLOCKED';
    else if (failed && !pending) detail.status = 'FAILED';
    else if (pending) detail.status = 'RUNNING';
    else detail.status = 'SUCCEEDED';
    detail.updatedAt = new Date().toISOString();
    detail.events.push({
      ts: detail.updatedAt,
      event: 'run_recovered',
      message: `Recovered run status to ${detail.status}`,
      payload: { runId },
    });
    refreshAgenticSearchMeta(detail);
    detail.searchStats = computeAgenticSearchStats(detail);
    state.agenticRuns[runId] = detail;
    return respond({ ok: true, message: `run_recovered status=${detail.status}`, detail });
  },

  addAgenticBranch: async (
    runId: string,
    nodeId: string,
    payload: {
      title: string;
      hypothesis: string;
      executionPlan: string;
      expectedMetrics?: Record<string, unknown>;
      budget?: Record<string, unknown>;
      risk?: string;
    },
  ): Promise<AgenticActionResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    const newNodeId = `n${detail.totTree.length + 1}`;
    const node: AgenticNode = {
      nodeId: newNodeId,
      parentId: nodeId,
      agent: 'ResearchAgent',
      title: payload.title,
      hypothesis: payload.hypothesis,
      executionPlan: payload.executionPlan,
      expectedMetrics: payload.expectedMetrics || {},
      budget: payload.budget || {},
      risk: payload.risk || 'medium',
      status: 'PENDING',
      rationale: 'User-added branch in demo mode',
      evidence: {},
      nextSuggestions: ['Execute branch', 'Compare branch'],
      children: [],
    };
    detail.totTree.push(node);
    const parent = detail.totTree.find(item => item.nodeId === nodeId);
    if (parent) parent.children = [...(parent.children || []), newNodeId];
    detail.updatedAt = new Date().toISOString();
    refreshAgenticSearchMeta(detail);
    detail.searchStats = computeAgenticSearchStats(detail);
    state.agenticRuns[runId] = detail;
    return respond({ ok: true, message: 'branch_added', detail });
  },

  deleteAgenticBranch: async (runId: string, nodeId: string): Promise<AgenticActionResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    if (nodeId === 'n0') {
      throw new Error('cannot_delete_root');
    }
    const removeIds = new Set<string>([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      detail.totTree.forEach(node => {
        if (node.parentId && removeIds.has(node.parentId) && !removeIds.has(node.nodeId)) {
          removeIds.add(node.nodeId);
          changed = true;
        }
      });
    }
    detail.totTree = detail.totTree.filter(node => !removeIds.has(node.nodeId));
    detail.totTree = detail.totTree.map(node => ({
      ...node,
      children: (node.children || []).filter(child => !removeIds.has(child)),
    }));
    detail.updatedAt = new Date().toISOString();
    refreshAgenticSearchMeta(detail);
    detail.searchStats = computeAgenticSearchStats(detail);
    state.agenticRuns[runId] = detail;
    return respond({ ok: true, message: 'branch_deleted', detail });
  },

  generateAgenticMatrix: async (
    runId: string,
    payload?: { checkpointIds?: string[]; maxSize?: number; downsample?: boolean },
  ): Promise<AgenticMatrixResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    const labels = payload?.checkpointIds?.length ? payload.checkpointIds : ['ckpt_0', 'ckpt_1', 'ckpt_2'];
    const matrix = labels.map((row, rowIdx) =>
      labels.map((col, colIdx) => (rowIdx === colIdx ? 0.5 : Number((0.35 + Math.abs(rowIdx - colIdx) * 0.12).toFixed(3)))),
    );
    const cells = labels.flatMap((row, rowIdx) =>
      labels.map((col, colIdx) => ({
        row,
        col,
        value: matrix[rowIdx][colIdx],
        winRate: matrix[rowIdx][colIdx],
        confidence: Number((0.5 + Math.abs(matrix[rowIdx][colIdx] - 0.5)).toFixed(3)),
        verdict: rowIdx === colIdx ? 'draw' : `${row}>${col}`,
        logUri: `demo://agentic/${row}__${col}.log`,
        replayUri: `demo://agentic/${row}__${col}.replay.json`,
      })),
    );
    const ranking = labels.map((id, idx) => ({ id, score: Number((1024 - idx * 17).toFixed(3)) }));
    detail.matrix = {
      labels,
      matrix,
      cells,
      ranking,
      meta: { metric: 'winRate', gamesPerPair: 1, generatedAt: new Date().toISOString() },
    };
    detail.updatedAt = new Date().toISOString();
    state.agenticRuns[runId] = detail;
    return respond({ runId, matrix: detail.matrix });
  },

  exportAgenticReproBundle: async (runId: string): Promise<AgenticReproResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    const script = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `echo \"Replay agentic run ${runId}\"`,
      'echo \"Demo bundle script\"',
    ].join('\n');
    const bundlePath = urlFromContent(`agentic_bundle_${runId}`, script, 'text/x-shellscript');
    const manifest = {
      runId,
      status: detail.status,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      decisionSnapshot: 'demo://decision_snapshot.json',
    };
    detail.reproBundle = { bundlePath, manifest };
    state.agenticRuns[runId] = detail;
    return respond({ runId, bundlePath, manifest });
  },
  replayAgenticAudit: async (runId: string, uptoEventSeq?: number): Promise<AgenticAuditReplayResponse> => {
    const detail = must(state.agenticRuns[runId], `agentic_run_not_found:${runId}`);
    const replayedEvents = (detail.events || []).length;
    return respond({
      runId,
      verified: true,
      checkedEvents: replayedEvents,
      chainHead: `demo_audit_${runId}_${replayedEvents}`,
      failureReason: null,
      replay: {
        uptoEventSeq: typeof uptoEventSeq === 'number' ? uptoEventSeq : null,
        replayedEvents,
        replayStatus: detail.status,
        matchesCurrentState: true,
        semanticValid: true,
        semanticIssues: [],
      },
    });
  },

  getSystemResources: async (): Promise<any> => {
    const base = state.baseSystemResources as any;
    const cpuPercent = Math.max(6, Math.min(97, (base.cpuPercent as number) + (Math.random() - 0.5) * 6));
    const memoryPercent = Math.max(24, Math.min(96, (base.memoryPercent as number) + (Math.random() - 0.5) * 3));

    const gpus = (base.gpus as any[]).map((gpu, idx) => ({
      ...gpu,
      utilizationGpu: Math.round(Math.max(1, Math.min(100, gpu.utilizationGpu + (Math.random() - 0.5) * (idx === 0 ? 8 : 6)))),
      memoryUsed: Math.round(Math.max(1, Math.min(gpu.memoryTotal, gpu.memoryUsed + (Math.random() - 0.5) * 1024 * 1024 * 1024))),
      temperature: Math.round(Math.max(35, Math.min(86, gpu.temperature + (Math.random() - 0.5) * 2.5))),
      power_draw: Math.round(Math.max(60_000, Math.min(360_000, gpu.power_draw + (Math.random() - 0.5) * 11_000))),
      fan_speed: Math.round(Math.max(10, Math.min(95, gpu.fan_speed + (Math.random() - 0.5) * 3))),
    }));

    return respond({
      ...base,
      cpuPercent: Number(cpuPercent.toFixed(2)),
      memoryPercent: Number(memoryPercent.toFixed(2)),
      memoryUsed: Math.round((memoryPercent / 100) * (base.memoryTotal as number)),
      gpus,
      net_bytes_sent: (base.net_bytes_sent as number) + Math.round(Math.random() * 250_000),
      net_bytes_recv: (base.net_bytes_recv as number) + Math.round(Math.random() * 400_000),
      load_avg: (base.load_avg as number[]).map(value => Number((value + (Math.random() - 0.5) * 0.2).toFixed(2))),
    });
  },
});
