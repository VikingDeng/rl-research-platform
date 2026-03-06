import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, RefreshCcw } from 'lucide-react';
import { api } from '../services/api';
import { useI18n } from '../services/i18n';
import type { AgenticIdeaInput } from '../types';

type ExecutionMode = 'offline_stub' | 'local_shell' | 'mle_runner';

type IdeaBuilderForm = {
  title: string;
  taskGoal: string;
  environment: string;
  targetWinRate: string;
  gpuHours: string;
  wallclockMinutes: string;
  allowNetwork: boolean;
  allowDependencyInstall: boolean;
  requestedActions: string;
  executionMode: ExecutionMode;
  localCommand: string;
  llmPlanning: boolean;
  llmCoding: boolean;
  llmExperiment: boolean;
  llmReview: boolean;
  llmSafety: boolean;
};

const DEFAULT_FORM: IdeaBuilderForm = {
  title: 'SMAC budget-constrained uplift',
  taskGoal: 'Improve MARL win rate under strict GPU/time budget while keeping auditability.',
  environment: 'pettingzoo.smac_v2:3s5z',
  targetWinRate: '0.62',
  gpuHours: '2',
  wallclockMinutes: '90',
  allowNetwork: false,
  allowDependencyInstall: false,
  requestedActions: '',
  executionMode: 'local_shell',
  localCommand: '',
  llmPlanning: true,
  llmCoding: true,
  llmExperiment: true,
  llmReview: true,
  llmSafety: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const extractIdeaJsonObject = (raw: string): Record<string, unknown> | null => {
  const text = String(raw || '').trim();
  if (!text) return null;

  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const direct = fenced ? fenced[1].trim() : text;

  try {
    const parsed = JSON.parse(direct);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // Fallback to the first likely JSON object.
  }

  const first = direct.indexOf('{');
  const last = direct.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const snippet = direct.slice(first, last + 1);
    try {
      const parsed = JSON.parse(snippet);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

const toExecutionMode = (value: unknown): ExecutionMode | null => {
  const raw = String(value || '').trim();
  if (raw === 'offline_stub' || raw === 'local_shell' || raw === 'mle_runner') {
    return raw;
  }
  return null;
};

const parseTargetWinRate = (value: unknown, fallback: string): string => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const matched = trimmed.match(/-?\d+(\.\d+)?/);
  return matched ? matched[0] : trimmed;
};

const parseNumberish = (value: unknown, fallback: string): string => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const matched = trimmed.match(/-?\d+(\.\d+)?/);
  return matched ? matched[0] : fallback;
};

const applyJsonIdeaToForm = (raw: Record<string, unknown>, prev: IdeaBuilderForm): IdeaBuilderForm => {
  const budget = isRecord(raw.budget) ? raw.budget : {};
  const constraints = isRecord(raw.constraints) ? raw.constraints : {};
  const successMetrics = isRecord(raw.successMetrics)
    ? raw.successMetrics
    : (isRecord(raw.success_metrics) ? raw.success_metrics : {});
  const llmPolicy = isRecord(raw.llmPolicy)
    ? raw.llmPolicy
    : (isRecord(raw.llm_policy) ? raw.llm_policy : {});
  const envObj = isRecord(raw.environment) ? raw.environment : null;

  const requestedActions = Array.isArray(raw.requestedActions)
    ? raw.requestedActions
    : (Array.isArray(raw.requested_actions) ? raw.requested_actions : null);
  const executionMode = toExecutionMode(raw.executionMode ?? raw.execution_mode);

  return {
    ...prev,
    title: String(raw.title || prev.title),
    taskGoal: String(raw.taskGoal ?? raw.task_goal ?? prev.taskGoal),
    environment: String((typeof raw.environment === 'string' ? raw.environment : envObj?.name) || prev.environment),
    targetWinRate: parseTargetWinRate(successMetrics.winRate ?? successMetrics.win_rate, prev.targetWinRate),
    gpuHours: parseNumberish(budget.gpuHours ?? budget.gpu_hours, prev.gpuHours),
    wallclockMinutes: parseNumberish(budget.wallclockMinutes ?? budget.wallclock_minutes, prev.wallclockMinutes),
    allowNetwork: typeof constraints.allowNetwork === 'boolean'
      ? constraints.allowNetwork
      : (typeof constraints.allow_network === 'boolean' ? constraints.allow_network : prev.allowNetwork),
    allowDependencyInstall: typeof constraints.allowDependencyInstall === 'boolean'
      ? constraints.allowDependencyInstall
      : (typeof constraints.allow_dependency_install === 'boolean' ? constraints.allow_dependency_install : prev.allowDependencyInstall),
    requestedActions: requestedActions
      ? requestedActions.map(item => String(item || '').trim()).filter(Boolean).join(', ')
      : prev.requestedActions,
    executionMode: executionMode || prev.executionMode,
    localCommand: String(raw.localCommand ?? raw.local_command ?? prev.localCommand),
    llmPlanning: typeof llmPolicy.planning === 'boolean' ? llmPolicy.planning : prev.llmPlanning,
    llmCoding: typeof llmPolicy.coding === 'boolean' ? llmPolicy.coding : prev.llmCoding,
    llmExperiment: typeof llmPolicy.experiment === 'boolean' ? llmPolicy.experiment : prev.llmExperiment,
    llmReview: typeof llmPolicy.review === 'boolean' ? llmPolicy.review : prev.llmReview,
    llmSafety: typeof llmPolicy.safety === 'boolean' ? llmPolicy.safety : prev.llmSafety,
  };
};

const applyTextIdeaToForm = (text: string, prev: IdeaBuilderForm): IdeaBuilderForm => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return prev;

  const lines = trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const firstMeaningful = lines.find(line => !line.startsWith('```')) || '';
  const title = firstMeaningful.replace(/^#+\s*/, '').slice(0, 120) || prev.title;
  const next: IdeaBuilderForm = {
    ...prev,
    title,
    taskGoal: trimmed,
  };

  for (const line of lines) {
    const matched = line.match(/^[-*]?\s*([A-Za-z_\u4e00-\u9fa5 ]+)\s*[:：=]\s*(.+)$/);
    if (!matched) continue;
    const key = matched[1].toLowerCase().replace(/\s+/g, '');
    const value = matched[2].trim();
    if (!value) continue;

    if (key.includes('environment') || key === 'env' || key.includes('环境')) {
      next.environment = value;
      continue;
    }
    if (key.includes('winrate') || key.includes('targetwin') || key.includes('胜率')) {
      next.targetWinRate = parseTargetWinRate(value, next.targetWinRate);
      continue;
    }
    if (key.includes('gpuhours') || key === 'gpu' || key.includes('gpu时长')) {
      next.gpuHours = parseNumberish(value, next.gpuHours);
      continue;
    }
    if (key.includes('wallclock') || key.includes('minutes') || key.includes('时长') || key.includes('分钟')) {
      next.wallclockMinutes = parseNumberish(value, next.wallclockMinutes);
      continue;
    }
    if (key.includes('executionmode') || key.includes('执行模式') || key === 'mode') {
      const mode = toExecutionMode(value);
      if (mode) next.executionMode = mode;
      continue;
    }
    if (key.includes('requestedactions') || key.includes('动作')) {
      next.requestedActions = value
        .split(/[,\uff0c]/)
        .map(item => item.trim())
        .filter(Boolean)
        .join(', ');
    }
  }

  return next;
};

const buildIdeaPayload = (input: IdeaBuilderForm): AgenticIdeaInput => ({
  title: input.title.trim() || 'Agentic MARL objective',
  taskGoal: input.taskGoal.trim() || input.title.trim() || 'Improve win-rate under constrained budget.',
  environment: input.environment.trim() || 'pettingzoo.smac_v2:3s5z',
  dataSources: ['registry://baseline_runs'],
  successMetrics: {
    winRate: `>=${input.targetWinRate.trim() || '0.62'}`,
  },
  budget: {
    gpuHours: Number(input.gpuHours) > 0 ? Number(input.gpuHours) : 2,
    wallclockMinutes: Number(input.wallclockMinutes) > 0 ? Number(input.wallclockMinutes) : 90,
  },
  constraints: {
    compliance: ['no_pii', 'no_external_data_push'],
    forbiddenActions: ['data_exfiltration'],
    allowNetwork: input.allowNetwork,
    allowDependencyInstall: input.allowDependencyInstall,
  },
  executionMode: input.executionMode,
  localCommand: input.executionMode === 'local_shell'
    ? (input.localCommand.trim() || null)
    : null,
  requestedActions: input.requestedActions
    .split(',')
    .map(item => item.trim())
    .filter(Boolean),
  llmPolicy: {
    planning: input.llmPlanning,
    coding: input.llmCoding,
    experiment: input.llmExperiment,
    review: input.llmReview,
    safety: input.llmSafety,
  },
});

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const normalizeLlmIssue = (raw: string, tx: (zh: string, en: string) => string): string => {
  const detail = String(raw || '');
  if (detail.includes('llm_required_missing_api_key')) {
    return tx(
      '未配置 LLM API Key（可用 AGENTIC_LLM_API_KEY / LLM_API_KEY / MODEL_API_KEY / OPENAI_API_KEY）。请先在后端环境变量中配置，再重试。',
      'LLM API key is missing (use AGENTIC_LLM_API_KEY / LLM_API_KEY / MODEL_API_KEY / OPENAI_API_KEY). Configure backend env and retry.',
    );
  }
  if (detail.includes('llm_required_missing_model')) {
    return tx(
      '未配置 LLM 模型（可用 AGENTIC_LLM_MODEL / LLM_MODEL）。请先配置模型名，再重试。',
      'LLM model is missing (use AGENTIC_LLM_MODEL / LLM_MODEL). Configure model and retry.',
    );
  }
  if (detail.includes('llm_required_missing_provider')) {
    return tx(
      '未配置 LLM Provider（可用 AGENTIC_LLM_PROVIDER / LLM_PROVIDER）。请先配置 provider，再重试。',
      'LLM provider is missing (use AGENTIC_LLM_PROVIDER / LLM_PROVIDER). Configure provider and retry.',
    );
  }
  if (detail.includes('llm_required_')) {
    return tx(
      `LLM 核心链路校验失败：${detail}`,
      `LLM core-chain check failed: ${detail}`,
    );
  }
  return detail;
};

export const AgenticIdeaBuilder: React.FC = () => {
  const navigate = useNavigate();
  const { tx } = useI18n();
  const [busy, setBusy] = useState<'none' | 'validate' | 'create' | 'create_auto'>('none');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<IdeaBuilderForm>(DEFAULT_FORM);
  const [ideaDraft, setIdeaDraft] = useState('');
  const [ideaDraftSource, setIdeaDraftSource] = useState('');

  const handleLoadIdeaFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setIdeaDraft(content);
      setIdeaDraftSource(file.name);
      setMessage(tx(`已载入 ${file.name}，点击“应用到表单”即可。`, `${file.name} loaded. Click "Apply to Form".`));
    } catch (error) {
      setMessage(tx(`读取文件失败：${toErrorMessage(error)}`, `Failed to read file: ${toErrorMessage(error)}`));
    } finally {
      event.target.value = '';
    }
  };

  const handleApplyIdeaDraft = () => {
    const raw = ideaDraft.trim();
    if (!raw) {
      setMessage(tx('请先粘贴 idea 文本或上传 idea 文件。', 'Paste idea text or upload an idea file first.'));
      return;
    }

    const parsed = extractIdeaJsonObject(raw);
    if (parsed) {
      setForm(prev => applyJsonIdeaToForm(parsed, prev));
      setMessage(tx('已从 JSON idea 填充表单。可直接校验或创建 Run。', 'Form filled from JSON idea. You can validate or create a run.'));
      return;
    }

    setForm(prev => applyTextIdeaToForm(raw, prev));
    setMessage(
      tx(
        '已从文本 idea 填充标题和目标，并尝试提取环境/预算字段。请快速检查后创建 Run。',
        'Form filled from text idea (title/goal plus best-effort environment/budget extraction). Review and create the run.',
      ),
    );
  };

  const handleValidate = async () => {
    setBusy('validate');
    setMessage('');
    try {
      const result = await api.validateAgenticSpec(buildIdeaPayload(form));
      setMessage(
        tx(
          `规范校验通过，风险声明：${result.riskStatement || '无'}`,
          `Spec validated. Risk statement: ${result.riskStatement || 'none'}`,
        ),
      );
    } catch (error) {
      setMessage(normalizeLlmIssue(toErrorMessage(error), tx));
    } finally {
      setBusy('none');
    }
  };

  const handleCreate = async () => {
    setBusy('create');
    setMessage('');
    try {
      const idea = buildIdeaPayload(form);
      await api.validateAgenticSpec(idea);
      const result = await api.createAgenticRun({ idea, autoExecute: false });
      setMessage(tx(`已创建 Run ${result.runId}`, `Run ${result.runId} created.`));
      navigate(`/agentic?runId=${encodeURIComponent(result.runId)}`);
    } catch (error) {
      setMessage(normalizeLlmIssue(toErrorMessage(error), tx));
    } finally {
      setBusy('none');
    }
  };

  const handleCreateAndAutoExplore = async () => {
    setBusy('create_auto');
    setMessage('');
    try {
      const idea = buildIdeaPayload(form);
      await api.validateAgenticSpec(idea);
      const result = await api.createAgenticRun({ idea, autoExecute: true });
      setMessage(tx(`已创建并自动执行 Run ${result.runId}`, `Run ${result.runId} created and auto-executed.`));
      navigate(`/agentic?runId=${encodeURIComponent(result.runId)}`);
    } catch (error) {
      setMessage(normalizeLlmIssue(toErrorMessage(error), tx));
    } finally {
      setBusy('none');
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="display-title text-2xl font-semibold text-slate-900">{tx('Idea 输入', 'Idea Input')}</h1>
          <button
            type="button"
            onClick={() => navigate('/agentic/canvas')}
            className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {tx('返回 ToT 图面', 'Back to ToT Canvas')}
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {tx(
            '在这里定义任务与约束，生成标准化 Research Spec。创建后可在探索主页推进执行，也可切到 ToT 图面查看树结构。',
            'Define task and constraints here to generate a normalized Research Spec. After creation, continue in the exploration home or switch to ToT Canvas for tree structure.',
          )}
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-700">{tx('快速导入 Idea', 'Quick Idea Import')}</div>
            <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100">
              {tx('上传 idea 文件', 'Upload idea file')}
              <input
                type="file"
                accept=".txt,.md,.json"
                onChange={handleLoadIdeaFile}
                className="hidden"
              />
            </label>
          </div>
          <textarea
            value={ideaDraft}
            onChange={e => setIdeaDraft(e.target.value)}
            placeholder={tx('粘贴 idea 文本，或上传 idea.txt / idea.json。支持 JSON 自动映射。', 'Paste idea text, or upload idea.txt / idea.json. JSON will be auto-mapped.')}
            rows={6}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleApplyIdeaDraft}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {tx('应用到表单', 'Apply to Form')}
            </button>
            <button
              type="button"
              onClick={() => {
                setIdeaDraft('');
                setIdeaDraftSource('');
              }}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {tx('清空', 'Clear')}
            </button>
            {ideaDraftSource && (
              <span className="text-xs text-slate-500">
                {tx('已加载文件', 'Loaded file')}: {ideaDraftSource}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-6">
          <input
            value={form.title}
            onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
            placeholder={tx('研究标题', 'Research title')}
            className="lg:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={form.taskGoal}
            onChange={e => setForm(prev => ({ ...prev, taskGoal: e.target.value }))}
            placeholder={tx('任务目标', 'Task goal')}
            className="lg:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={form.environment}
            onChange={e => setForm(prev => ({ ...prev, environment: e.target.value }))}
            placeholder={tx('环境', 'Environment')}
            className="lg:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={form.targetWinRate}
            onChange={e => setForm(prev => ({ ...prev, targetWinRate: e.target.value }))}
            placeholder={tx('目标胜率', 'Target win-rate')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={form.gpuHours}
            onChange={e => setForm(prev => ({ ...prev, gpuHours: e.target.value }))}
            placeholder="GPU h"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={form.wallclockMinutes}
            onChange={e => setForm(prev => ({ ...prev, wallclockMinutes: e.target.value }))}
            placeholder={tx('时长分钟', 'Minutes')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={form.requestedActions}
            onChange={e => setForm(prev => ({ ...prev, requestedActions: e.target.value }))}
            placeholder={tx('请求动作（逗号分隔）', 'Requested actions (comma-separated)')}
            className="lg:col-span-3 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={form.executionMode}
            onChange={e => setForm(prev => ({ ...prev, executionMode: e.target.value as 'offline_stub' | 'local_shell' | 'mle_runner' }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="local_shell">{tx('真实执行（local shell）', 'Real execution (local shell)')}</option>
            <option value="mle_runner">{tx('真实执行（MLE runner）', 'Real execution (MLE runner)')}</option>
            <option value="offline_stub">{tx('模拟执行（offline stub）', 'Simulated execution (offline stub)')}</option>
          </select>
          {form.executionMode === 'local_shell' && (
            <input
              value={form.localCommand}
              onChange={e => setForm(prev => ({ ...prev, localCommand: e.target.value }))}
              placeholder={tx('本地命令（可选）如: pytest -q tests/agentic', 'Local command (optional), e.g. pytest -q tests/agentic')}
              className="lg:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          )}
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.allowNetwork}
              onChange={e => setForm(prev => ({ ...prev, allowNetwork: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300"
            />
            allowNetwork
          </label>
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.allowDependencyInstall}
              onChange={e => setForm(prev => ({ ...prev, allowDependencyInstall: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300"
            />
            allowDependencyInstall
          </label>
          <div className="lg:col-span-6 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {tx('节点 LLM 调用开关', 'Per-node LLM toggle')}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.llmPlanning} onChange={e => setForm(prev => ({ ...prev, llmPlanning: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                planning
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.llmCoding} onChange={e => setForm(prev => ({ ...prev, llmCoding: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                coding
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.llmExperiment} onChange={e => setForm(prev => ({ ...prev, llmExperiment: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                experiment
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.llmReview} onChange={e => setForm(prev => ({ ...prev, llmReview: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                review
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.llmSafety} onChange={e => setForm(prev => ({ ...prev, llmSafety: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                safety
              </label>
            </div>
          </div>
        </div>

        {form.executionMode === 'offline_stub' && (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {tx('当前是模拟执行模式，适合演示但不会真实改代码/跑实验。', 'You are in simulated mode; good for demos but it will not truly modify code or run experiments.')}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleValidate}
            disabled={busy !== 'none'}
            className="inline-flex items-center rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            <RefreshCcw className={`mr-1.5 h-4 w-4 ${busy === 'validate' ? 'animate-spin' : ''}`} />
            {busy === 'validate' ? tx('校验中...', 'Validating...') : tx('校验规范', 'Validate Spec')}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy !== 'none'}
            className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {busy === 'create' ? tx('创建中...', 'Creating...') : tx('创建 Run', 'Create Run')}
          </button>
          <button
            type="button"
            onClick={handleCreateAndAutoExplore}
            disabled={busy !== 'none'}
            className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {busy === 'create_auto' ? tx('自动探索启动中...', 'Starting auto explore...') : tx('创建并自动探索', 'Create & Auto Explore')}
          </button>
        </div>
      </section>

      {message && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </section>
      )}
    </div>
  );
};

export default AgenticIdeaBuilder;
