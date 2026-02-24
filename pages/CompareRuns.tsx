import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { Run } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { X, BarChart2, Zap, FileText } from 'lucide-react';
import { useI18n } from '../services/i18n';

type MetricKey = 'returnMean' | 'winRate' | 'entropy';
type ViewMode = 'timeseries' | 'correlation' | 'config';
const RUN_SELECTOR_ROW_HEIGHT = 68;
const RUN_SELECTOR_OVERSCAN = 8;
const RUN_SELECTOR_VIEWPORT_HEIGHT = 560;
const CONFIG_DIFF_ROW_HEIGHT = 38;
const CONFIG_DIFF_OVERSCAN = 12;
const CONFIG_DIFF_VIEWPORT_HEIGHT = 520;

// Helper to flatten object
const flattenObject = (obj: any, prefix = ''): Record<string, any> => {
    return Object.keys(obj).reduce((acc: any, k) => {
        const pre = prefix.length ? prefix + '.' : '';
        if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
            Object.assign(acc, flattenObject(obj[k], pre + k));
        } else {
            acc[pre + k] = obj[k];
        }
        return acc;
    }, {});
}

export const CompareRuns: React.FC = () => {
  const { tx } = useI18n();
  const [searchParams] = useSearchParams();
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [runDetails, setRunDetails] = useState<Record<string, Run>>({});
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('returnMean');
  const [viewMode, setViewMode] = useState<ViewMode>('timeseries');
  const [runSearch, setRunSearch] = useState('');
  const [runSelectorScrollTop, setRunSelectorScrollTop] = useState(0);
  const [configDiffScrollTop, setConfigDiffScrollTop] = useState(0);
  
  // Scatter Plot State
  const [xAxisParam, setXAxisParam] = useState('lr');
  const [paramKeys, setParamKeys] = useState<string[]>([]);
  
  useEffect(() => {
    // Fetch summaries first
    api.getRuns({ pageSize: 100 }).then(runs => {
        setAllRuns(runs);
        
        // Auto-select logic
        const urlRuns = searchParams.get('runs');
        if (urlRuns) {
            const ids = urlRuns.split(',');
            setSelectedRunIds(ids);
            if (ids.length > 3) setViewMode('correlation');
        } else {
            const sweepRuns = runs.filter(r => r.name.includes('Sweep'));
            if (sweepRuns.length > 0) {
                setSelectedRunIds(sweepRuns.map(r => r.id));
                if (sweepRuns.length > 2) setViewMode('correlation');
            } else {
                 const trainRuns = runs.filter(r => r.type === 'TRAIN');
                 if (trainRuns.length >= 2) setSelectedRunIds([trainRuns[0].id, trainRuns[1].id]);
            }
        }
    });
  }, [searchParams]);

  // Fetch full details for selected runs
  useEffect(() => {
      const missingIds = selectedRunIds.filter(id => !runDetails[id]);
      if (missingIds.length === 0) return;

      Promise.all(missingIds.map(id => api.getRunById(id))).then(fetchedRuns => {
          setRunDetails(prev => {
              const next = { ...prev };
              fetchedRuns.forEach(r => next[r.id] = r);
              return next;
          });
          setParamKeys(prev => {
            const keys = new Set<string>(prev);
            fetchedRuns.forEach(run => {
              if (run.config) Object.keys(run.config).forEach(key => keys.add(key));
            });
            return Array.from(keys);
          });
      });
  }, [selectedRunIds, runDetails]);

  const toggleRun = (id: string) => {
    if (selectedRunIds.includes(id)) {
      setSelectedRunIds(selectedRunIds.filter(r => r !== id));
    } else {
      if (selectedRunIds.length < 10) setSelectedRunIds([...selectedRunIds, id]);
    }
  };
  const clearSelectedRuns = () => setSelectedRunIds([]);
  const selectTopVisibleRuns = () => {
    const picks = filteredTrainRuns.slice(0, 5).map(run => run.id);
    if (picks.length === 0) return;
    const merged = [...selectedRunIds];
    picks.forEach(id => {
      if (!merged.includes(id) && merged.length < 10) {
        merged.push(id);
      }
    });
    setSelectedRunIds(merged);
  };

  // Use full details if available, else summary (which might lack metrics)
  const selectedRuns = selectedRunIds.map(id => runDetails[id] || allRuns.find(r => r.id === id)).filter(Boolean) as Run[];
  const trainRuns = useMemo(
    () => allRuns.filter(r => r.type === 'TRAIN').sort((a, b) => Date.parse(b.created || '') - Date.parse(a.created || '')),
    [allRuns],
  );
  const runQuery = runSearch.trim().toLowerCase();
  const filteredTrainRuns = useMemo(() => {
    if (!runQuery) return trainRuns;
    return trainRuns.filter(run =>
      `${run.id} ${run.name} ${run.algo} ${run.env}`.toLowerCase().includes(runQuery),
    );
  }, [trainRuns, runQuery]);
  const selectorStart = Math.max(0, Math.floor(runSelectorScrollTop / RUN_SELECTOR_ROW_HEIGHT) - RUN_SELECTOR_OVERSCAN);
  const selectorVisibleCount = Math.ceil(RUN_SELECTOR_VIEWPORT_HEIGHT / RUN_SELECTOR_ROW_HEIGHT) + RUN_SELECTOR_OVERSCAN * 2;
  const selectorEnd = Math.min(filteredTrainRuns.length, selectorStart + selectorVisibleCount);
  const visibleSelectorRuns = filteredTrainRuns.slice(selectorStart, selectorEnd);
  const selectorOffsetY = selectorStart * RUN_SELECTOR_ROW_HEIGHT;
  const selectorTotalHeight = filteredTrainRuns.length * RUN_SELECTOR_ROW_HEIGHT;

  useEffect(() => {
    setRunSelectorScrollTop(0);
  }, [runSearch]);
  useEffect(() => {
    setConfigDiffScrollTop(0);
  }, [selectedRunIds, viewMode]);
  
  // --- Time Series Data Prep ---
  const timeSeriesData: any[] = [];
  if (selectedRuns.length > 0 && viewMode === 'timeseries') {
      // Find a run with metrics loaded to establish base steps
      const baseRun = selectedRuns.find(r => r.metrics?.[selectedMetric]?.length);
      const baseSteps = baseRun?.metrics?.[selectedMetric]?.map(m => m.step) || [];
      
      baseSteps.forEach((step, idx) => {
          const point: any = { step };
          selectedRuns.forEach(r => {
              const val = r.metrics?.[selectedMetric]?.[idx]?.value;
              if (val !== undefined) point[r.name] = val;
          });
          timeSeriesData.push(point);
      });
  }

  // --- Scatter Data Prep ---
  const scatterData = selectedRuns.map(r => {
      const finalMetric = r.metrics?.[selectedMetric];
      const lastValue = finalMetric && finalMetric.length > 0 ? finalMetric[finalMetric.length - 1].value : 0;
      return {
          id: r.id,
          name: r.name,
          x: r.config?.[xAxisParam] || 0,
          y: lastValue,
      };
  });

  // --- Config Diff Data Prep ---
  const configDiffData: { key: string; values: Record<string, any>; diff: boolean }[] = [];
  if (selectedRuns.length > 0) {
      const allKeys = new Set<string>();
      const flattenedConfigs = selectedRuns.map(r => ({ id: r.id, cfg: flattenObject(r.config || {}) }));
      
      flattenedConfigs.forEach(fc => Object.keys(fc.cfg).forEach(k => allKeys.add(k)));
      
      Array.from(allKeys).sort().forEach(key => {
          const values: Record<string, any> = {};
          const distinctValues = new Set();
          
          flattenedConfigs.forEach(fc => {
              const val = fc.cfg[key];
              values[fc.id] = val;
              distinctValues.add(JSON.stringify(val)); // Simple distinct check
          });
          
          // Filter out internal keys
          if (!key.startsWith('git.') && !key.startsWith('autoEval') && !key.includes('Id')) {
             configDiffData.push({
                 key,
                 values,
                 diff: distinctValues.size > 1
             });
          }
      });
  }
  const changedConfigCount = configDiffData.filter(row => row.diff).length;
  const configStart = Math.max(0, Math.floor(configDiffScrollTop / CONFIG_DIFF_ROW_HEIGHT) - CONFIG_DIFF_OVERSCAN);
  const configVisibleCount = Math.ceil(CONFIG_DIFF_VIEWPORT_HEIGHT / CONFIG_DIFF_ROW_HEIGHT) + CONFIG_DIFF_OVERSCAN * 2;
  const configEnd = Math.min(configDiffData.length, configStart + configVisibleCount);
  const visibleConfigRows = configDiffData.slice(configStart, configEnd);
  const configTopPad = configStart * CONFIG_DIFF_ROW_HEIGHT;
  const configBottomPad = Math.max(0, (configDiffData.length - configEnd) * CONFIG_DIFF_ROW_HEIGHT);

  const colors = ["#2563eb", "#16a34a", "#db2777", "#ea580c", "#7c3aed", "#0891b2", "#be185d"];

  const metricOptions: { key: MetricKey; label: string }[] = [
      { key: 'returnMean', label: tx('回报均值（最终）', 'Return Mean (Final)') },
      { key: 'winRate', label: tx('胜率（最终）', 'Win Rate (Final)') },
      { key: 'entropy', label: tx('熵', 'Entropy') },
  ];

  const formatMetricValue = (metric: MetricKey, value: number) =>
    metric === 'winRate' ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
           <h1 className="text-2xl font-bold text-gray-900">{tx('运行对比', 'Compare Runs')}</h1>
           <p className="text-gray-500 mt-1">{tx('可视化不同算法与超参数下的性能差异。', 'Visualize performance differences across algorithms and hyperparameters.')}</p>
        </div>
        <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
            <button 
                onClick={() => setViewMode('timeseries')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'timeseries' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                {tx('学习曲线', 'Learning Curves')}
            </button>
            <button 
                onClick={() => setViewMode('correlation')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1 transition-colors ${viewMode === 'correlation' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                <Zap className="w-3 h-3" /> {tx('超参数关系', 'Hyperparams')}
            </button>
            <button 
                onClick={() => setViewMode('config')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1 transition-colors ${viewMode === 'config' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                <FileText className="w-3 h-3" /> {tx('配置差异', 'Config Diff')}
            </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Selector Panel */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm h-fit">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{tx('选择运行', 'Select Runs')}</h3>
              <span className="text-[11px] font-medium text-gray-500">{selectedRunIds.length}/10 {tx('已选', 'selected')}</span>
            </div>
            <div className="mb-2">
              <input
                value={runSearch}
                onChange={e => setRunSearch(e.target.value)}
                placeholder={tx('按名称/算法/环境/ID 搜索', 'Search by name/algo/env/id')}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={selectTopVisibleRuns}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                {tx('选择前 5', 'Select Top 5')}
              </button>
              <button
                type="button"
                onClick={clearSelectedRuns}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                {tx('清空', 'Clear')}
              </button>
              <span className="text-[11px] text-gray-500">{filteredTrainRuns.length} {tx('个运行', 'runs')}</span>
            </div>
            <div
              className="max-h-[560px] overflow-y-auto rounded-lg border border-gray-200"
              onScroll={(e) => setRunSelectorScrollTop(e.currentTarget.scrollTop)}
            >
                {filteredTrainRuns.length === 0 ? (
                  <div className="p-3 text-xs text-gray-500">{tx('未找到运行。', 'No runs found.')}</div>
                ) : (
                  <div className="relative" style={{ height: `${selectorTotalHeight}px` }}>
                    <div className="absolute left-0 right-0" style={{ transform: `translateY(${selectorOffsetY}px)` }}>
                      {visibleSelectorRuns.map(run => (
                          <button
                              key={run.id}
                              type="button"
                              onClick={() => toggleRun(run.id)}
                              className={`block h-[68px] w-full border-b border-gray-100 px-3 py-2 text-left text-sm transition-all ${
                                  selectedRunIds.includes(run.id)
                                  ? 'bg-blue-50 ring-1 ring-inset ring-blue-400'
                                  : 'hover:bg-gray-50'
                              }`}
                          >
                              <div className="font-medium text-gray-900 truncate">{run.name}</div>
                              <div className="text-xs text-gray-500 mt-1 flex justify-between">
                                  <span className="truncate pr-2">{run.algo}</span>
                                  <span className="truncate">{run.env}</span>
                              </div>
                          </button>
                      ))}
                    </div>
                  </div>
                )}
            </div>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-3 space-y-6">
            {selectedRuns.length === 0 ? (
                <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-500 flex flex-col items-center">
                    <BarChart2 className="w-12 h-12 mb-4 opacity-20" />
                    <p>{tx('从左侧选择运行开始对比。', 'Select runs from the left panel to compare.')}</p>
                </div>
            ) : (
                <>
                     {/* Tags/Legend */}
                    <div className="flex flex-wrap gap-2">
                        {selectedRuns.map((r, idx) => (
                            <span key={r.id} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-white border shadow-sm" style={{borderColor: colors[idx % colors.length], color: colors[idx % colors.length]}}>
                                <span className="w-2 h-2 rounded-full mr-2" style={{backgroundColor: colors[idx % colors.length]}}></span>
                                {r.name}
                                <button onClick={() => toggleRun(r.id)} className="ml-2 hover:text-gray-900"><X className="w-3 h-3"/></button>
                            </span>
                        ))}
                    </div>
                    
                    {/* View Content */}
                    {viewMode === 'config' ? (
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
                                <div>
                                  {tx('参数总数', 'Parameters')}: <span className="font-semibold text-gray-800">{configDiffData.length}</span>
                                </div>
                                <div>
                                  {tx('差异参数', 'Changed')}: <span className="font-semibold text-amber-700">{changedConfigCount}</span>
                                </div>
                            </div>
                            <div
                              className="max-h-[520px] overflow-auto"
                              onScroll={(e) => setConfigDiffScrollTop(e.currentTarget.scrollTop)}
                            >
                                <table className="w-full text-sm text-left">
                                    <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold text-gray-500 w-48">{tx('参数', 'Parameter')}</th>
                                            {selectedRuns.map((r, idx) => (
                                                <th key={r.id} className="px-4 py-3 font-semibold" style={{color: colors[idx % colors.length]}}>
                                                    {r.name}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {configTopPad > 0 && (
                                          <tr aria-hidden>
                                            <td colSpan={selectedRuns.length + 1} style={{ height: `${configTopPad}px` }} />
                                          </tr>
                                        )}
                                        {visibleConfigRows.map((row) => (
                                            <tr
                                              key={row.key}
                                              className={`hover:bg-gray-50 ${row.diff ? 'bg-yellow-50/50' : ''}`}
                                              style={{ height: `${CONFIG_DIFF_ROW_HEIGHT}px` }}
                                            >
                                                <td className="px-4 py-2 font-mono text-gray-600 truncate" title={row.key}>{row.key}</td>
                                                {selectedRuns.map((r) => (
                                                    <td key={r.id} className={`px-4 py-2 font-mono ${row.diff ? 'font-bold text-gray-900' : 'text-gray-500'}`}>
                                                        {row.values[r.id] !== undefined ? JSON.stringify(row.values[r.id]) : '-'}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                        {configBottomPad > 0 && (
                                          <tr aria-hidden>
                                            <td colSpan={selectedRuns.length + 1} style={{ height: `${configBottomPad}px` }} />
                                          </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Chart Controls */}
                            <div className="bg-white p-4 rounded-t-xl border border-gray-200 border-b-0 flex gap-6 items-center">
                                <div>
                                    <span className="text-xs font-semibold text-gray-500 uppercase block mb-1">{tx('Y 轴指标', 'Y-Axis Metric')}</span>
                                    <select 
                                        value={selectedMetric}
                                        onChange={(e) => setSelectedMetric(e.target.value as MetricKey)}
                                        className="p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    >
                                        {metricOptions.map(opt => (
                                            <option key={opt.key} value={opt.key}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                
                                {viewMode === 'correlation' && (
                                    <div>
                                        <span className="text-xs font-semibold text-gray-500 uppercase block mb-1">{tx('X 轴参数', 'X-Axis Parameter')}</span>
                                        <select 
                                            value={xAxisParam}
                                            onChange={(e) => setXAxisParam(e.target.value)}
                                            className="p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none min-w-[150px]"
                                        >
                                            {paramKeys.map(k => (
                                                <option key={k} value={k}>{k}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="bg-white p-6 rounded-b-xl border border-gray-200 shadow-sm border-t-0 mt-0">
                                <div className="h-[400px]">
                                    {viewMode === 'timeseries' ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={timeSeriesData}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                <XAxis dataKey="step" fontSize={12} tickFormatter={(val) => `${val/1000}k`} />
                                                <YAxis fontSize={12} tickFormatter={(value) => formatMetricValue(selectedMetric, Number(value))} />
                                                <Tooltip
                                                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                  formatter={(value: number | string) => formatMetricValue(selectedMetric, Number(value))}
                                                />
                                                {selectedRuns.map((r, idx) => (
                                                    <Line 
                                                        key={r.id} 
                                                        type="monotone" 
                                                        dataKey={r.name} 
                                                        stroke={colors[idx % colors.length]} 
                                                        strokeWidth={2} 
                                                        dot={false} 
                                                    />
                                                ))}
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis type="number" dataKey="x" name={xAxisParam} label={{ value: xAxisParam, position: 'insideBottom', offset: -10 }} />
                                                <YAxis
                                                  type="number"
                                                  dataKey="y"
                                                  name={selectedMetric}
                                                  tickFormatter={(value) => formatMetricValue(selectedMetric, Number(value))}
                                                  label={{ value: selectedMetric, angle: -90, position: 'insideLeft' }}
                                                />
                                                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                                                    if (active && payload && payload.length) {
                                                        const data = payload[0].payload;
                                                    return (
                                                            <div className="bg-white p-2 border border-gray-200 shadow-lg rounded text-sm">
                                                                <p className="font-bold mb-1">{data.name}</p>
                                                                <p>{xAxisParam}: {data.x}</p>
                                                                <p>{selectedMetric}: {formatMetricValue(selectedMetric, Number(data.y))}</p>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }} />
                                                <Scatter name={tx('运行', 'Runs')} data={scatterData} fill="#2563eb" />
                                            </ScatterChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
      </div>
    </div>
  );
};
