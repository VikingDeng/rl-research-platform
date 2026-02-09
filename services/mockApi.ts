import {
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
