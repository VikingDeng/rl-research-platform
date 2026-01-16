import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { Run } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, ZAxis } from 'recharts';
import { X, BarChart2, GitBranch, Zap } from 'lucide-react';

type MetricKey = 'returnMean' | 'winRate' | 'entropy';
type ViewMode = 'timeseries' | 'correlation';

export const CompareRuns: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [allRuns, setAllRuns] = useState<Run[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('returnMean');
  const [viewMode, setViewMode] = useState<ViewMode>('timeseries');
  
  // Scatter Plot State
  const [xAxisParam, setXAxisParam] = useState('lr');
  const [paramKeys, setParamKeys] = useState<string[]>([]);
  
  useEffect(() => {
    api.getRuns().then(runs => {
        setAllRuns(runs);
        
        // Extract all available config keys
        const keys = new Set<string>();
        runs.forEach(r => {
            if (r.config) Object.keys(r.config).forEach(k => keys.add(k));
        });
        setParamKeys(Array.from(keys));

        // Auto-select logic
        const urlRuns = searchParams.get('runs');
        if (urlRuns) {
            const ids = urlRuns.split(',');
            setSelectedRunIds(ids);
            // If many runs selected via URL, hint at correlation view if they seem like a sweep
            if (ids.length > 3) setViewMode('correlation');
        } else {
            // Default behavior if no URL params
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

  const toggleRun = (id: string) => {
    if (selectedRunIds.includes(id)) {
      setSelectedRunIds(selectedRunIds.filter(r => r !== id));
    } else {
      if (selectedRunIds.length < 10) setSelectedRunIds([...selectedRunIds, id]);
    }
  };

  const selectedRuns = allRuns.filter(r => selectedRunIds.includes(r.id));
  
  // --- Time Series Data Prep ---
  const timeSeriesData: any[] = [];
  if (selectedRuns.length > 0 && viewMode === 'timeseries') {
      const baseSteps = selectedRuns[0].metrics[selectedMetric]?.map(m => m.step) || [];
      baseSteps.forEach((step, idx) => {
          const point: any = { step };
          selectedRuns.forEach(r => {
              const val = r.metrics[selectedMetric]?.[idx]?.value;
              if (val !== undefined) point[r.name] = val;
          });
          timeSeriesData.push(point);
      });
  }

  // --- Scatter Data Prep ---
  const scatterData = selectedRuns.map(r => {
      const finalMetric = r.metrics[selectedMetric];
      const lastValue = finalMetric && finalMetric.length > 0 ? finalMetric[finalMetric.length - 1].value : 0;
      return {
          id: r.id,
          name: r.name,
          x: r.config?.[xAxisParam] || 0,
          y: lastValue,
      };
  });

  const colors = ["#2563eb", "#16a34a", "#db2777", "#ea580c", "#7c3aed", "#0891b2", "#be185d"];

  const metricOptions: { key: MetricKey; label: string }[] = [
      { key: 'returnMean', label: 'Return Mean (Final)' },
      { key: 'winRate', label: 'Win Rate (Final)' },
      { key: 'entropy', label: 'Entropy' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
           <h1 className="text-2xl font-bold text-gray-900">Compare Runs</h1>
           <p className="text-gray-500 mt-1">Visualize performance differences across algorithms and hyperparameters.</p>
        </div>
        <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
            <button 
                onClick={() => setViewMode('timeseries')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'timeseries' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                Learning Curves
            </button>
            <button 
                onClick={() => setViewMode('correlation')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-1 transition-colors ${viewMode === 'correlation' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                <Zap className="w-3 h-3" /> Hyperparams
            </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Selector Panel */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm h-fit">
            <h3 className="font-semibold text-gray-900 mb-3">Select Runs</h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {allRuns.filter(r => r.type === 'TRAIN').map(run => (
                    <div 
                        key={run.id} 
                        onClick={() => toggleRun(run.id)}
                        className={`p-3 rounded-lg border text-sm cursor-pointer transition-all ${
                            selectedRunIds.includes(run.id) 
                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' 
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                    >
                        <div className="font-medium text-gray-900 truncate">{run.name}</div>
                        <div className="text-xs text-gray-500 mt-1 flex justify-between">
                            <span>{run.algo}</span>
                            <span>{run.env}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>

        {/* Charts Area */}
        <div className="lg:col-span-3 space-y-6">
            {selectedRuns.length === 0 ? (
                <div className="bg-gray-50 rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-500 flex flex-col items-center">
                    <BarChart2 className="w-12 h-12 mb-4 opacity-20" />
                    <p>Select runs from the left panel to compare.</p>
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
                    
                    {/* Controls Row */}
                    <div className="bg-white p-4 rounded-t-xl border border-gray-200 border-b-0 flex gap-6 items-center">
                         <div>
                            <span className="text-xs font-semibold text-gray-500 uppercase block mb-1">Y-Axis Metric</span>
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
                                <span className="text-xs font-semibold text-gray-500 uppercase block mb-1">X-Axis Parameter</span>
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
                                        <YAxis fontSize={12} />
                                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
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
                                        <YAxis type="number" dataKey="y" name={selectedMetric} label={{ value: selectedMetric, angle: -90, position: 'insideLeft' }} />
                                        <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const data = payload[0].payload;
                                                return (
                                                    <div className="bg-white p-2 border border-gray-200 shadow-lg rounded text-sm">
                                                        <p className="font-bold mb-1">{data.name}</p>
                                                        <p>{xAxisParam}: {data.x}</p>
                                                        <p>{selectedMetric}: {data.y.toFixed(4)}</p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }} />
                                        <Scatter name="Runs" data={scatterData} fill="#2563eb" />
                                    </ScatterChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
      </div>
    </div>
  );
};