import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { Heatmap } from '../components/Heatmap';
import { AdversarialReplayPlayer, isAdversarialReplayData } from '../components/AdversarialReplayPlayer';
import { MatrixCell, OpponentPool, EvalProtocol, MatrixResult } from '../types';
import { Download, Plus, X, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const MatrixView: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<MatrixCell[]>([]);
  const [matrixResult, setMatrixResult] = useState<MatrixResult | null>(null);
  const [matrixResults, setMatrixResults] = useState<MatrixResult[]>([]);
  const [pools, setPools] = useState<OpponentPool[]>([]);
  const [protocols, setProtocols] = useState<EvalProtocol[]>([]);
  const [selectedPool, setSelectedPool] = useState('');
  const [selectedProtocol, setSelectedProtocol] = useState('');
  const [selectedResultId, setSelectedResultId] = useState('');
  const [selectedMetric, setSelectedMetric] = useState('winRate');

  // Create Matrix Job Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [jobPool, setJobPool] = useState('');
  const [jobProtocol, setJobProtocol] = useState('');

  // Match Detail Modal
  const [selectedMatch, setSelectedMatch] = useState<MatrixCell | null>(null);
  const ranking = matrixResult?.ranking || [];
  const analysisMetric = matrixResult?.meta?.metric || selectedMetric;
  const analysisLabel = analysisMetric === 'returnMean'
    ? 'Return Mean'
    : analysisMetric === 'survivalTime'
      ? 'Survival Time'
      : 'Win Rate';
  const analysisText = matrixResult?.meta
    ? `Metric: ${analysisLabel} · Games/Pair: ${matrixResult.meta.gamesPerPair ?? '-'} · Seeds: ${matrixResult.meta.seeds?.length ?? 0}`
    : 'No matrix analysis available yet.';

  const metricLabel = selectedMetric === 'returnMean'
    ? 'Return Mean'
    : selectedMetric === 'survivalTime'
      ? 'Survival Time'
      : 'Win Rate';
  const metricFormatter = selectedMetric === 'winRate'
    ? (value: number) => `${(value * 100).toFixed(1)}%`
    : selectedMetric === 'survivalTime'
      ? (value: number) => `${value.toFixed(1)}s`
      : (value: number) => value.toFixed(2);
  const metricDomain = selectedMetric === 'winRate' ? [0, 1] as [number, number] : undefined;
  const replayData = useMemo(() => {
    const candidate = (matrixResult?.summary as any)?.replay;
    return isAdversarialReplayData(candidate) ? candidate : null;
  }, [matrixResult]);

  useEffect(() => {
    api.getPools().then(p => {
        setPools(p);
        if (p.length > 0) setSelectedPool(p[0].id);
    });
    api.getProtocols().then(p => {
        setProtocols(p);
        if (p.length > 0) setSelectedProtocol(p[0].id);
    });
  }, []);

  useEffect(() => {
      if (!selectedPool && !selectedProtocol) return;
      api.getMatrixResults({ poolId: selectedPool || undefined, protocolId: selectedProtocol || undefined })
        .then(results => {
            const sorted = [...results].sort((a, b) => {
                const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
                const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
                return bTime - aTime;
            });
            const latest = sorted[0] || null;
            setMatrixResults(sorted);
            if (!selectedMetric && latest?.meta?.metric) {
              setSelectedMetric(latest.meta.metric);
            }
            const nextResult = sorted.find(result => (result.meta?.metric || 'winRate') === selectedMetric) || latest;
            setSelectedResultId(nextResult?.id || '');
            setMatrixResult(latest);
            setData(latest?.cells || []);
        });
  }, [selectedPool, selectedProtocol, selectedMetric]);

  useEffect(() => {
      if (!selectedResultId) {
        setMatrixResult(null);
        setData([]);
        return;
      }
      const selected = matrixResults.find(result => result.id === selectedResultId) || null;
      setMatrixResult(selected);
      setData(selected?.cells || []);
  }, [selectedResultId, matrixResults]);

  useEffect(() => {
      const filtered = matrixResults.filter(result => (result.meta?.metric || 'winRate') === selectedMetric);
      if (filtered.length > 0) {
        setSelectedResultId(filtered[0].id);
        return;
      }
      if (matrixResults.length > 0) {
        const fallbackMetric = matrixResults[0].meta?.metric || 'winRate';
        if (fallbackMetric !== selectedMetric) {
          setSelectedMetric(fallbackMetric);
        }
        setSelectedResultId(matrixResults[0].id);
        return;
      }
      setSelectedResultId('');
  }, [selectedMetric, matrixResults]);

  const handleLaunch = () => {
      if (!jobPool || !jobProtocol) return;
      api.getPoolById(jobPool).then(pool => {
        const members = pool.memberSnapshotIds || [];
        return api.submitMatrixJob({
            poolId: jobPool,
            policySnapshotIds: members,
            protocolId: jobProtocol,
            gamesPerPair: 10,
            metric: selectedMetric,
            resources: { gpus: 1 },
        });
      }).then(res => api.getJobById(res.jobId))
        .then(job => {
            setIsModalOpen(false);
            if (job?.runId) {
                navigate(`/runs/${job.runId}`);
            }
        });
  }

  const handleCellClick = (cell: MatrixCell) => {
      setSelectedMatch(cell);
  }

  return (
    <div className="space-y-6 relative">
      <div className="flex justify-between items-center">
        <div>
            <h1 className="text-2xl font-bold text-gray-900">Matrix Analysis</h1>
            <p className="text-gray-500 text-sm mt-1">Cross-play win-rates between agent policies.</p>
        </div>
        <div className="flex gap-3">
             <button 
                onClick={() => setIsModalOpen(true)}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
             >
                <Plus className="w-4 h-4 mr-2" /> New Analysis
            </button>
            <button
              onClick={() => {
                if (matrixResult?.exportUrl) window.open(matrixResult.exportUrl, '_blank', 'noreferrer');
              }}
              className="flex items-center px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
                <Download className="w-4 h-4 mr-2" />
                <span>Export CSV</span>
            </button>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
        <div className="flex-1 max-w-xs">
            <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Opponent Pool</label>
            <select 
                value={selectedPool}
                onChange={(e) => setSelectedPool(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
                {pools.map(p => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
            </select>
        </div>
        <div className="flex-1 max-w-xs">
             <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Protocol</label>
             <select
                value={selectedProtocol}
                onChange={(e) => setSelectedProtocol(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
             >
                {protocols.map(p => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
             </select>
        </div>
        <div className="flex-1 max-w-xs">
             <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Metric</label>
             <select
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
             >
                 <option value="winRate">Win Rate</option>
                 <option value="returnMean">Return Mean</option>
                 <option value="survivalTime">Survival Time</option>
             </select>
        </div>
        <div className="flex-1 max-w-xs">
             <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">Result History</label>
             <select
                value={selectedResultId}
                onChange={(e) => setSelectedResultId(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
             >
                <option value="">Latest</option>
                {matrixResults
                  .filter(result => (result.meta?.metric || 'winRate') === selectedMetric)
                  .map(result => (
                  <option key={result.id} value={result.id}>
                    {result.id.slice(0, 6)} · {result.createdAt ? new Date(result.createdAt).toLocaleString() : 'unknown'}
                  </option>
                ))}
             </select>
        </div>
      </div>

      {/* Main Visual */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            <Heatmap
              data={data}
              width={700}
              height={600}
              onClick={handleCellClick}
              valueLabel={metricLabel}
              valueFormatter={metricFormatter}
              valueDomain={metricDomain}
            />
            <div className="mt-4 flex items-center justify-center gap-4 text-xs text-gray-500">
                {selectedMetric === 'winRate' ? (
                    <>
                      <div className="flex items-center"><div className="w-3 h-3 bg-red-400 mr-2 rounded-sm"></div> 0% Win Rate</div>
                      <div className="flex items-center"><div className="w-3 h-3 bg-yellow-400 mr-2 rounded-sm"></div> 50% Draw</div>
                      <div className="flex items-center"><div className="w-3 h-3 bg-green-400 mr-2 rounded-sm"></div> 100% Win Rate</div>
                    </>
                ) : (
                    <>
                      <div className="flex items-center"><div className="w-3 h-3 bg-red-400 mr-2 rounded-sm"></div> Low {metricLabel}</div>
                      <div className="flex items-center"><div className="w-3 h-3 bg-yellow-400 mr-2 rounded-sm"></div> Mid {metricLabel}</div>
                      <div className="flex items-center"><div className="w-3 h-3 bg-green-400 mr-2 rounded-sm"></div> High {metricLabel}</div>
                    </>
                )}
            </div>
            <p className="text-center text-xs text-gray-400 mt-2">Click a cell to view match replay details</p>
        </div>

        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-3">Ranking (Nash Avg)</h3>
                <div className="space-y-3">
                    {ranking.map((entry, idx) => (
                        <div key={entry.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                            <div className="flex items-center gap-3">
                                <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${idx===0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-200 text-gray-600'}`}>
                                    {idx + 1}
                                </span>
                                <span className="text-sm font-medium text-gray-700">{entry.id}</span>
                            </div>
                            <span className="text-sm font-bold text-gray-900">{entry.score.toFixed(2)}</span>
                        </div>
                    ))}
                    {ranking.length === 0 && (
                        <div className="text-sm text-gray-400">No ranking data yet.</div>
                    )}
                </div>
            </div>

             <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-2">Analysis</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                    {analysisText}
                </p>
             </div>
        </div>
      </div>

      {/* Launch Job Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-gray-900">Run Matrix Analysis</h2>
                    <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    {/* ... (Existing Form) ... */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Target Pool</label>
                        <select 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={jobPool}
                            onChange={(e) => setJobPool(e.target.value)}
                        >
                            <option value="">Select Pool</option>
                            {pools.map(p => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">All agents in this pool will play against each other (NxN).</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Eval Protocol</label>
                        <select 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={jobProtocol}
                            onChange={(e) => setJobProtocol(e.target.value)}
                        >
                             <option value="">Select Protocol</option>
                             {protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>

                     <div>
                           <label className="block text-sm font-medium text-gray-700 mb-1">Resources</label>
                           <div className="flex gap-2">
                               <span className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded text-sm font-medium">4 GPUs</span>
                               <span className="px-3 py-1 bg-gray-50 text-gray-600 border border-gray-200 rounded text-sm">Cluster Auto-scale</span>
                           </div>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">Cancel</button>
                        <button onClick={handleLaunch} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Launch Job</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Match Detail (Drill-down) Modal */}
      {selectedMatch && (
           <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in duration-200 overflow-hidden">
                   <div className="bg-gray-900 text-white p-4 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <h2 className="text-lg font-bold flex items-center"><Video className="w-5 h-5 mr-2" /> Match Detail</h2>
                            <div className="flex items-center gap-2 text-sm">
                                <span className="px-2 py-1 bg-blue-900 rounded border border-blue-700 font-mono">{selectedMatch.row}</span>
                                <span className="text-gray-400">vs</span>
                                <span className="px-2 py-1 bg-red-900 rounded border border-red-700 font-mono">{selectedMatch.col}</span>
                            </div>
                        </div>
                        <button onClick={() => setSelectedMatch(null)} className="text-gray-400 hover:text-white"><X className="w-6 h-6" /></button>
                   </div>
                   <div className="p-6 space-y-4">
                      <div className="text-sm text-gray-600">
                        {metricLabel}: <span className="font-semibold text-gray-900">{metricFormatter(selectedMatch.value)}</span>
                      </div>
                      {replayData ? (
                        <AdversarialReplayPlayer replay={replayData} />
                      ) : (
                        <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
                          Replay payload is not available for this matrix result.
                        </div>
                      )}
                   </div>
              </div>
           </div>
      )}
    </div>
  );
};
