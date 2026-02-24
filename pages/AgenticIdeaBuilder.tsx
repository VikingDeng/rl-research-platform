import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, RefreshCcw } from 'lucide-react';
import { api } from '../services/api';
import { useI18n } from '../services/i18n';
import type { AgenticIdeaInput } from '../types';

const buildIdeaPayload = (input: {
  title: string;
  taskGoal: string;
  environment: string;
  targetWinRate: string;
  gpuHours: string;
  wallclockMinutes: string;
  allowNetwork: boolean;
  allowDependencyInstall: boolean;
  requestedActions: string;
}): AgenticIdeaInput => ({
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
  executionMode: 'offline_stub',
  requestedActions: input.requestedActions
    .split(',')
    .map(item => item.trim())
    .filter(Boolean),
});

const toErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const AgenticIdeaBuilder: React.FC = () => {
  const navigate = useNavigate();
  const { tx } = useI18n();
  const [busy, setBusy] = useState<'none' | 'validate' | 'create'>('none');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    title: 'SMAC budget-constrained uplift',
    taskGoal: 'Improve MARL win rate under strict GPU/time budget while keeping auditability.',
    environment: 'pettingzoo.smac_v2:3s5z',
    targetWinRate: '0.62',
    gpuHours: '2',
    wallclockMinutes: '90',
    allowNetwork: false,
    allowDependencyInstall: false,
    requestedActions: '',
  });

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
      setMessage(toErrorMessage(error));
    } finally {
      setBusy('none');
    }
  };

  const handleCreate = async () => {
    setBusy('create');
    setMessage('');
    try {
      const result = await api.createAgenticRun({ idea: buildIdeaPayload(form), autoExecute: false });
      setMessage(tx(`已创建 Run ${result.runId}`, `Run ${result.runId} created.`));
      navigate('/agentic');
    } catch (error) {
      setMessage(toErrorMessage(error));
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
            onClick={() => navigate('/agentic')}
            className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {tx('返回 ToT 图面', 'Back to ToT Canvas')}
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {tx('在这里定义任务与约束，生成标准化 Research Spec。创建后请到 ToT 图面执行搜索。', 'Define task and constraints here to generate a normalized Research Spec. After creation, execute search from ToT Canvas.')}
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
        </div>

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
