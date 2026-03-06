'use client';

import { useState } from 'react';
import { GitCompare, Plus, Trash2, ArrowRightLeft } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function CompareRuns() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.getRuns(),
  });

  const [selectedRuns, setSelectedRuns] = useState<any[]>([]);

  // Auto-select first two runs for demo purposes if available
  if (selectedRuns.length === 0 && runs.length >= 2) {
    setSelectedRuns([runs[0], runs[1]]);
  }

  const generateMockData = (baseVal: number, trend: 'up' | 'down', noise: number, steps = 100) => {
    let current = baseVal;
    return Array.from({ length: steps }).map((_, i) => {
      const step = i * 100;
      current += (trend === 'up' ? 0.05 : -0.01) + (Math.random() - 0.5) * noise;
      return [step, current];
    });
  };

  const getChartOption = (metric: string) => {
    if (selectedRuns.length === 0) return {};

    const series = selectedRuns.map((run, i) => {
      // Generate different curves for each run to show "diff"
      const isUp = metric === 'Reward';
      const base = isUp ? 10 : 2.5;
      const data = generateMockData(
        base + i * (isUp ? -5 : 0.5), 
        isUp ? 'up' : 'down', 
        isUp ? 2 : 0.1, 
        100
      );
      
      return {
        name: run.name || `Run ${run.id.substring(0, 6)}`,
        type: 'line',
        showSymbol: false,
        smooth: true,
        data: data,
      };
    });

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: series.map(s => s.name), bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: { type: 'value', name: 'Step' },
      yAxis: { type: 'value', name: metric },
      series,
    };
  };

  if (selectedRuns.length < 2) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">运行对比 (Compare Runs)</h1>
            <p className="text-gray-500 text-sm mt-1">选择多个运行记录以比较它们的超参数和指标曲线。</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <GitCompare className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">加载数据中...</h3>
          <p className="text-gray-500 text-sm max-w-sm">
            如果长时间停留，请确保系统中有至少两个任务记录。
          </p>
        </div>
      </div>
    );
  }

  // Mock hyperparameter diff
  const diffKeys = ['learning_rate', 'batch_size', 'gamma', 'entropy_coef'];
  const mockDiff = diffKeys.map(key => {
    return {
      key,
      val1: key === 'learning_rate' ? '3e-4' : key === 'batch_size' ? '64' : key === 'gamma' ? '0.99' : '0.01',
      val2: key === 'learning_rate' ? '1e-4' : key === 'batch_size' ? '128' : key === 'gamma' ? '0.995' : '0.05',
    }
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">运行对比 (Compare Runs)</h1>
          <p className="text-gray-500 text-sm mt-1">深度分析模型参数与表现差异</p>
        </div>
      </div>

      {/* Selected Runs Pill */}
      <div className="flex items-center gap-4">
        {selectedRuns.map((run, i) => (
          <div key={run.id} className="flex items-center gap-3 bg-white border border-gray-200 px-4 py-2 rounded-lg shadow-sm">
            <div className={`w-3 h-3 rounded-full ${i === 0 ? 'bg-blue-500' : 'bg-green-500'}`} />
            <span className="font-medium text-gray-700">{run.name || `Run-${run.id.substring(0, 6)}`}</span>
            <button className="text-gray-400 hover:text-red-500 ml-2"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium px-4 py-2 border border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition-colors">
          <Plus className="w-4 h-4" />
          添加对比项
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Hyperparam Diff Matrix */}
        <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-100 bg-gray-50">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              配置差异 (Config Diff)
            </h2>
          </div>
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white border-b border-gray-100 text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">参数</th>
                  <th className="px-4 py-3 font-medium text-blue-600">Run A</th>
                  <th className="px-4 py-3 font-medium text-green-600">Run B</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {mockDiff.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-gray-600">{row.key}</td>
                    <td className="px-4 py-3 font-mono text-gray-900 bg-blue-50/30">{row.val1}</td>
                    <td className="px-4 py-3 font-mono text-gray-900 bg-green-50/30">{row.val2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Charts */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-medium text-gray-800 mb-4">Episode Reward (Mean)</h3>
            <div className="h-[300px]">
              <ReactECharts option={getChartOption('Reward')} style={{ height: '100%', width: '100%' }} />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-medium text-gray-800 mb-4">Value Loss</h3>
            <div className="h-[300px]">
              <ReactECharts option={getChartOption('Loss')} style={{ height: '100%', width: '100%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}