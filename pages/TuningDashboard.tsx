import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  ScatterChart, Scatter, ZAxis, BarChart, Bar
} from 'recharts';
import { RefreshCw, Search, Sliders, Trophy, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface StudyData {
    study_name: string;
    best_value: number;
    best_params: Record<string, any>;
    trials: Array<{
        number: number;
        value: number;
        params: Record<string, any>;
        state: string;
    }>;
    importance: Record<string, number>;
}

export const TuningDashboard: React.FC = () => {
    const navigate = useNavigate();
    const [studyName, setStudyName] = useState('');
    const [data, setData] = useState<StudyData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const loadStudy = async () => {
        if (!studyName) return;
        setLoading(true);
        setError('');
        try {
            const res = await api.getTuningStudy(studyName);
            if (res.error) {
                setError(res.details || 'Study not found');
                setData(null);
            } else {
                setData(res);
            }
        } catch (e) {
            setError('Failed to fetch study data');
        } finally {
            setLoading(false);
        }
    };

    // Parallel Coordinates Data Prep
    // We normalize all params to 0-1 range for plotting lines
    const getParallelData = () => {
        if (!data || data.trials.length === 0) return [];
        
        // Find min/max for each param
        const paramKeys = Object.keys(data.trials[0].params);
        const ranges: Record<string, {min: number, max: number}> = {};
        
        paramKeys.forEach(k => {
            const values = data.trials.map(t => t.params[k]).filter(v => typeof v === 'number');
            ranges[k] = { min: Math.min(...values), max: Math.max(...values) };
        });

        return data.trials.map(t => {
            const point: any = { trial: t.number, value: t.value };
            paramKeys.forEach(k => {
                const val = t.params[k];
                if (typeof val === 'number') {
                    // Normalize to 0-100 for consistent y-axis
                    const range = ranges[k].max - ranges[k].min;
                    point[k] = range === 0 ? 50 : ((val - ranges[k].min) / range) * 100;
                    point[`_raw_${k}`] = val; // Keep raw for tooltip
                } else {
                    // Categorical: Map to index? Skip for MVP line chart
                }
            });
            return point;
        });
    };
    
    const parallelData = getParallelData();
    const paramKeys = data?.trials[0] ? Object.keys(data.trials[0].params).filter(k => typeof data.trials[0].params[k] === 'number') : [];

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Hyperparameter Tuning</h1>
                    <p className="text-gray-500 mt-1">Analyze Optuna studies and visualize parameter relationships.</p>
                </div>
            </div>

            {/* Search Bar */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex gap-4 items-end">
                <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Study Name</label>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4"/>
                        <input 
                            type="text" 
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="e.g. ppo-cartpole-study-01"
                            value={studyName}
                            onChange={e => setStudyName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && loadStudy()}
                        />
                    </div>
                </div>
                <button 
                    onClick={loadStudy} 
                    disabled={loading || !studyName}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center gap-2"
                >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin"/> : 'Analyze'}
                </button>
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
                    {error}
                </div>
            )}

            {data && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Best Trial Card */}
                    <div className="col-span-1 lg:col-span-2 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-6 text-white shadow-lg">
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="text-blue-100 font-medium mb-1 flex items-center gap-2">
                                    <Trophy className="w-4 h-4" /> Best Result Found
                                </h3>
                                <div className="text-4xl font-bold mb-4">{data.best_value?.toFixed(4)}</div>
                                <div className="flex flex-wrap gap-3">
                                    {Object.entries(data.best_params || {}).map(([k, v]) => (
                                        <span key={k} className="px-3 py-1 bg-white/20 rounded-full text-sm backdrop-blur-sm">
                                            {k}: <strong>{String(v)}</strong>
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm text-blue-200">Total Trials</div>
                                <div className="text-2xl font-bold">{data.trials.length}</div>
                            </div>
                        </div>
                    </div>

                    {/* Parameter Importance */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <Sliders className="w-5 h-5 text-gray-500"/> Parameter Importance
                        </h3>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart layout="vertical" data={Object.entries(data.importance || {}).map(([k,v]) => ({name: k, value: v}))}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false}/>
                                    <XAxis type="number" domain={[0, 1]} hide/>
                                    <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}}/>
                                    <Tooltip />
                                    <Bar dataKey="value" fill="#4F46E5" radius={[0, 4, 4, 0]} barSize={20}/>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Optimization History */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <ArrowUpRight className="w-5 h-5 text-gray-500"/> Optimization History
                        </h3>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <ScatterChart>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" dataKey="number" name="Trial" />
                                    <YAxis type="number" dataKey="value" name="Metric" />
                                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                                    <Scatter name="Trials" data={data.trials} fill="#0ea5e9" />
                                </ScatterChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                    
                    {/* Trials Table */}
                    <div className="col-span-1 lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 font-bold text-gray-900">
                            All Trials
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-semibold">
                                    <tr>
                                        <th className="px-6 py-3">Trial #</th>
                                        <th className="px-6 py-3">Value</th>
                                        <th className="px-6 py-3">State</th>
                                        {Object.keys(data.trials[0]?.params || {}).map(k => (
                                            <th key={k} className="px-6 py-3">{k}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {data.trials.map(t => (
                                        <tr key={t.number} className="hover:bg-gray-50">
                                            <td className="px-6 py-3 font-mono text-gray-500">#{t.number}</td>
                                            <td className="px-6 py-3 font-medium text-gray-900">{t.value?.toFixed(4)}</td>
                                            <td className="px-6 py-3">
                                                <span className={`px-2 py-0.5 rounded text-xs ${t.state === 'COMPLETE' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                                                    {t.state}
                                                </span>
                                            </td>
                                            {Object.keys(data.trials[0]?.params || {}).map(k => (
                                                <td key={k} className="px-6 py-3 text-gray-600">
                                                    {String(t.params[k])}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
