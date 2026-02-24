import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { Heatmap } from '../components/Heatmap';
import { AdversarialReplayPlayer, isAdversarialReplayData } from '../components/AdversarialReplayPlayer';
import { MatrixCell, OpponentPool, EvalProtocol, MatrixResult } from '../types';
import { Download, Plus, X, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../services/i18n';

const RESULT_PAGE_SIZE = 12;
const MATRIX_DOWNSAMPLE_OPTIONS = [12, 16, 20, 24, 28, 32];

export const MatrixView: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [matrixResult, setMatrixResult] = useState<MatrixResult | null>(null);
  const [matrixResults, setMatrixResults] = useState<MatrixResult[]>([]);
  const [pools, setPools] = useState<OpponentPool[]>([]);
  const [protocols, setProtocols] = useState<EvalProtocol[]>([]);
  const [selectedPool, setSelectedPool] = useState('');
  const [selectedProtocol, setSelectedProtocol] = useState('');
  const [selectedResultId, setSelectedResultId] = useState('');
  const [selectedMetric, setSelectedMetric] = useState('winRate');
  const [historyPage, setHistoryPage] = useState(1);
  const [downsampleEnabled, setDownsampleEnabled] = useState(true);
  const [maxMatrixSize, setMaxMatrixSize] = useState(24);

  // Create Matrix Job Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [jobPool, setJobPool] = useState('');
  const [jobProtocol, setJobProtocol] = useState('');

  // Match Detail Modal
  const [selectedMatch, setSelectedMatch] = useState<MatrixCell | null>(null);
  const [hoveredCell, setHoveredCell] = useState<MatrixCell | null>(null);
  const [axisLockEnabled, setAxisLockEnabled] = useState(false);
  const [axisLockedCell, setAxisLockedCell] = useState<MatrixCell | null>(null);
  const metricFilteredResults = useMemo(
    () => matrixResults.filter(result => (result.meta?.metric || 'winRate') === selectedMetric),
    [matrixResults, selectedMetric],
  );
  const totalHistoryPages = Math.max(1, Math.ceil(metricFilteredResults.length / RESULT_PAGE_SIZE));
  const historyPageSafe = Math.min(historyPage, totalHistoryPages);
  const historyStart = (historyPageSafe - 1) * RESULT_PAGE_SIZE;
  const pagedHistoryResults = metricFilteredResults.slice(historyStart, historyStart + RESULT_PAGE_SIZE);
  const ranking = matrixResult?.ranking || [];
  const activeFocusCell = axisLockEnabled ? axisLockedCell : (hoveredCell || selectedMatch);
  const focusRow = activeFocusCell?.row || null;
  const focusCol = activeFocusCell?.col || null;

  const metricLabel = selectedMetric === 'returnMean'
    ? t('matrix.metric.returnMean', 'Return Mean')
    : selectedMetric === 'survivalTime'
      ? t('matrix.metric.survivalTime', 'Survival Time')
      : t('matrix.metric.winRate', 'Win Rate');
  const metricFormatter = selectedMetric === 'winRate'
    ? (value: number) => `${(value * 100).toFixed(1)}%`
    : selectedMetric === 'survivalTime'
      ? (value: number) => `${value.toFixed(1)}s`
      : (value: number) => value.toFixed(2);
  const metricDomain = selectedMetric === 'winRate' ? [0, 1] as [number, number] : undefined;
  const matrixDisplay = useMemo(() => {
    const labels = matrixResult?.labels || [];
    const cells = matrixResult?.cells || [];
    if (!downsampleEnabled || labels.length <= maxMatrixSize) {
      return {
        labels,
        cells,
        downsampled: false,
        originalCount: labels.length,
        step: 1,
      };
    }
    const step = Math.max(1, Math.ceil(labels.length / maxMatrixSize));
    const keepLabels = labels.filter((_, idx) => idx % step === 0 || idx === labels.length - 1);
    const keepSet = new Set(keepLabels);
    const compactCells = cells.filter(cell => keepSet.has(cell.row) && keepSet.has(cell.col));
    return {
      labels: keepLabels,
      cells: compactCells,
      downsampled: true,
      originalCount: labels.length,
      step,
    };
  }, [matrixResult, downsampleEnabled, maxMatrixSize]);
  const analysisMetric = matrixResult?.meta?.metric || selectedMetric;
  const analysisLabel = analysisMetric === 'returnMean'
    ? t('matrix.metric.returnMean', 'Return Mean')
    : analysisMetric === 'survivalTime'
      ? t('matrix.metric.survivalTime', 'Survival Time')
      : t('matrix.metric.winRate', 'Win Rate');
  const analysisText = matrixResult?.meta
    ? `${t('matrix.analysis.metric', 'Metric')}: ${analysisLabel} · ${t('matrix.analysis.gamesPerPair', 'Games/Pair')}: ${matrixResult.meta.gamesPerPair ?? '-'} · ${t('matrix.analysis.seeds', 'Seeds')}: ${matrixResult.meta.seeds?.length ?? 0}`
    : t('matrix.analysis.empty', 'No matrix analysis available yet.');
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
    setHistoryPage(1);
  }, [selectedMetric]);

  useEffect(() => {
      if (!selectedPool && !selectedProtocol) return;
      api.getMatrixResults({ poolId: selectedPool || undefined, protocolId: selectedProtocol || undefined })
        .then(results => {
            const sorted = [...results].sort((a, b) => {
                const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
                const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
                return bTime - aTime;
            });
            setMatrixResults(sorted);
            setHistoryPage(1);
            if (!selectedMetric && sorted[0]?.meta?.metric) {
              setSelectedMetric(sorted[0].meta.metric);
            }
        });
  }, [selectedPool, selectedProtocol]);

  useEffect(() => {
    if (historyPage > totalHistoryPages) {
      setHistoryPage(totalHistoryPages);
    }
  }, [historyPage, totalHistoryPages]);

  useEffect(() => {
      if (pagedHistoryResults.length === 0) {
        if (selectedResultId) setSelectedResultId('');
        return;
      }
      const existsInPage = pagedHistoryResults.some(result => result.id === selectedResultId);
      if (!existsInPage) {
        setSelectedResultId(pagedHistoryResults[0].id);
      }
  }, [pagedHistoryResults, selectedResultId]);

  useEffect(() => {
      if (!selectedResultId) {
        setMatrixResult(null);
        return;
      }
      const selected = matrixResults.find(result => result.id === selectedResultId) || null;
      setMatrixResult(selected);
      setHoveredCell(null);
  }, [selectedResultId, matrixResults]);

  useEffect(() => {
      if (!selectedMatch) return;
      const stillVisible = matrixDisplay.cells.some(cell => cell.row === selectedMatch.row && cell.col === selectedMatch.col);
      if (!stillVisible) {
        setSelectedMatch(null);
      }
  }, [matrixDisplay.cells, selectedMatch]);
  useEffect(() => {
      if (!axisLockedCell) return;
      const stillVisible = matrixDisplay.cells.some(cell => cell.row === axisLockedCell.row && cell.col === axisLockedCell.col);
      if (!stillVisible) {
        setAxisLockedCell(null);
      }
  }, [matrixDisplay.cells, axisLockedCell]);
  useEffect(() => {
      if (!axisLockEnabled) {
        setAxisLockedCell(null);
        return;
      }
      if (axisLockedCell) return;
      if (selectedMatch) {
        setAxisLockedCell(selectedMatch);
        return;
      }
      if (hoveredCell) {
        setAxisLockedCell(hoveredCell);
      }
  }, [axisLockEnabled, axisLockedCell, selectedMatch, hoveredCell]);

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
      if (axisLockEnabled) {
        setAxisLockedCell(cell);
      }
  }

  const handleToggleAxisLock = () => {
      if (axisLockEnabled) {
        setAxisLockEnabled(false);
        setAxisLockedCell(null);
        return;
      }
      const source = selectedMatch || hoveredCell;
      if (source) {
        setAxisLockedCell(source);
      }
      setAxisLockEnabled(true);
  }

  const handleClearAxisFocus = () => {
      setHoveredCell(null);
      setSelectedMatch(null);
      setAxisLockedCell(null);
      setAxisLockEnabled(false);
  }

  return (
    <div className="space-y-6 relative">
      <div className="flex justify-between items-center">
        <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('matrix.title', 'Matrix Analysis')}</h1>
            <p className="text-gray-500 text-sm mt-1">{t('matrix.subtitle', 'Cross-play win-rates between agent policies.')}</p>
        </div>
        <div className="flex gap-3">
             <button 
                onClick={() => setIsModalOpen(true)}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
             >
                <Plus className="w-4 h-4 mr-2" /> {t('matrix.newAnalysis', 'New Analysis')}
            </button>
            <button
              onClick={() => {
                if (matrixResult?.exportUrl) window.open(matrixResult.exportUrl, '_blank', 'noreferrer');
              }}
              className="flex items-center px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
                <Download className="w-4 h-4 mr-2" />
                <span>{t('matrix.exportCsv', 'Export CSV')}</span>
            </button>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-wrap items-end gap-4">
        <div className="flex-1 max-w-xs">
            <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">{t('matrix.controls.opponentPool', 'Opponent Pool')}</label>
            <select 
                value={selectedPool}
                onChange={(e) => setSelectedPool(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
                {pools.map(p => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
            </select>
        </div>
        <div className="flex-1 max-w-xs">
             <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">{t('matrix.controls.protocol', 'Protocol')}</label>
             <select
                value={selectedProtocol}
                onChange={(e) => setSelectedProtocol(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
             >
                {protocols.map(p => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
             </select>
        </div>
        <div className="flex-1 max-w-xs">
             <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">{t('matrix.controls.metric', 'Metric')}</label>
             <select
                value={selectedMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
             >
                 <option value="winRate">{t('matrix.metric.winRate', 'Win Rate')}</option>
                 <option value="returnMean">{t('matrix.metric.returnMean', 'Return Mean')}</option>
                 <option value="survivalTime">{t('matrix.metric.survivalTime', 'Survival Time')}</option>
             </select>
        </div>
        <div className="flex-1 max-w-xs">
             <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">{t('matrix.controls.resultHistory', 'Result History')}</label>
             <select
                value={selectedResultId}
                onChange={(e) => setSelectedResultId(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
             >
                {pagedHistoryResults.map(result => (
                  <option key={result.id} value={result.id}>
                    {result.id.slice(0, 6)} · {result.createdAt ? new Date(result.createdAt).toLocaleString() : t('common.unknown', 'unknown')}
                  </option>
                ))}
             </select>
        </div>
        <div className="flex flex-col gap-1 text-xs text-gray-600">
          <span className="font-medium uppercase text-gray-500">{t('matrix.controls.historyPage', 'History Page')}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={historyPageSafe <= 1}
              onClick={() => setHistoryPage(prev => Math.max(1, prev - 1))}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
            >
              {t('common.prev', 'Prev')}
            </button>
            <span>{historyPageSafe}/{totalHistoryPages}</span>
            <button
              type="button"
              disabled={historyPageSafe >= totalHistoryPages}
              onClick={() => setHistoryPage(prev => Math.min(totalHistoryPages, prev + 1))}
              className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
            >
              {t('common.next', 'Next')}
            </button>
          </div>
          <span className="text-[11px] text-gray-500">{metricFilteredResults.length} {t('matrix.controls.resultsForMetric', 'results for metric')}</span>
        </div>
        <div className="flex items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={downsampleEnabled}
              onChange={(e) => setDownsampleEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            {t('matrix.controls.downsampleDisplay', 'downsample display')}
          </label>
          <select
            value={maxMatrixSize}
            onChange={(e) => setMaxMatrixSize(Number(e.target.value || 24))}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
            disabled={!downsampleEnabled}
          >
            {MATRIX_DOWNSAMPLE_OPTIONS.map(size => (
              <option key={`size-${size}`} value={size}>{size}x{size}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Visual */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            {matrixDisplay.downsampled && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t('matrix.downsamplePrefix', 'Display downsampled')}: {matrixDisplay.labels.length}x{matrixDisplay.labels.length} {t('matrix.downsampleFrom', 'from')} {matrixDisplay.originalCount}x{matrixDisplay.originalCount}
                ({t('matrix.step', 'step')} {matrixDisplay.step}).
              </div>
            )}
            <Heatmap
              data={matrixDisplay.cells}
              width={700}
              height={600}
              onClick={handleCellClick}
              onHover={setHoveredCell}
              valueLabel={metricLabel}
              valueFormatter={metricFormatter}
              valueDomain={metricDomain}
              showCellValues={matrixDisplay.cells.length <= 900}
              focusRow={focusRow}
              focusCol={focusCol}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-600">{t('matrix.axisFocus', 'Axis Focus')}</span>
                <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">row: {focusRow || '-'}</span>
                <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-700">col: {focusCol || '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleAxisLock}
                  className={`rounded border px-2 py-1 ${
                    axisLockEnabled ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700'
                  }`}
                >
                  {axisLockEnabled ? t('matrix.unlockAxis', 'Unlock Axis') : t('matrix.lockAxis', 'Lock Axis')}
                </button>
                <button
                  type="button"
                  onClick={handleClearAxisFocus}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-700"
                >
                  {t('matrix.clearFocus', 'Clear Focus')}
                </button>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-center gap-4 text-xs text-gray-500">
                {selectedMetric === 'winRate' ? (
                    <>
                      <div className="flex items-center"><div className="w-3 h-3 bg-red-400 mr-2 rounded-sm"></div> 0% {t('matrix.metric.winRate', 'Win Rate')}</div>
                      <div className="flex items-center"><div className="w-3 h-3 bg-yellow-400 mr-2 rounded-sm"></div> 50% {t('matrix.draw', 'Draw')}</div>
                      <div className="flex items-center"><div className="w-3 h-3 bg-green-400 mr-2 rounded-sm"></div> 100% {t('matrix.metric.winRate', 'Win Rate')}</div>
                    </>
                ) : (
                    <>
                      <div className="flex items-center"><div className="w-3 h-3 bg-red-400 mr-2 rounded-sm"></div> {t('matrix.low', 'Low')} {metricLabel}</div>
                      <div className="flex items-center"><div className="w-3 h-3 bg-yellow-400 mr-2 rounded-sm"></div> {t('matrix.mid', 'Mid')} {metricLabel}</div>
                      <div className="flex items-center"><div className="w-3 h-3 bg-green-400 mr-2 rounded-sm"></div> {t('matrix.high', 'High')} {metricLabel}</div>
                    </>
                )}
            </div>
            <p className="text-center text-xs text-gray-400 mt-2">{t('matrix.clickCellHint', 'Click a cell to view match replay details')}</p>
        </div>

        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-3">{t('matrix.rankingTitle', 'Ranking (Nash Avg)')}</h3>
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
                        <div className="text-sm text-gray-400">{t('matrix.noRankingYet', 'No ranking data yet.')}</div>
                    )}
                </div>
            </div>

             <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-2">{t('matrix.analysisTitle', 'Analysis')}</h3>
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
                    <h2 className="text-lg font-bold text-gray-900">{t('matrix.modal.runTitle', 'Run Matrix Analysis')}</h2>
                    <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    {/* ... (Existing Form) ... */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('matrix.modal.targetPool', 'Target Pool')}</label>
                        <select 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={jobPool}
                            onChange={(e) => setJobPool(e.target.value)}
                        >
                            <option value="">{t('matrix.modal.selectPool', 'Select Pool')}</option>
                            {pools.map(p => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">{t('matrix.modal.poolHint', 'All agents in this pool will play against each other (NxN).')}</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('matrix.modal.evalProtocol', 'Eval Protocol')}</label>
                        <select 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={jobProtocol}
                            onChange={(e) => setJobProtocol(e.target.value)}
                        >
                             <option value="">{t('matrix.modal.selectProtocol', 'Select Protocol')}</option>
                             {protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>

                     <div>
                           <label className="block text-sm font-medium text-gray-700 mb-1">{t('matrix.modal.resources', 'Resources')}</label>
                           <div className="flex gap-2">
                               <span className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded text-sm font-medium">{t('matrix.modal.defaultGpu', '4 GPUs')}</span>
                               <span className="px-3 py-1 bg-gray-50 text-gray-600 border border-gray-200 rounded text-sm">{t('matrix.modal.autoScale', 'Cluster Auto-scale')}</span>
                           </div>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg font-medium">{t('common.cancel', 'Cancel')}</button>
                        <button onClick={handleLaunch} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">{t('matrix.modal.launchJob', 'Launch Job')}</button>
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
                            <h2 className="text-lg font-bold flex items-center"><Video className="w-5 h-5 mr-2" /> {t('matrix.matchDetail', 'Match Detail')}</h2>
                            <div className="flex items-center gap-2 text-sm">
                                <span className="px-2 py-1 bg-blue-900 rounded border border-blue-700 font-mono">{selectedMatch.row}</span>
                                <span className="text-gray-400">{t('common.vs', 'vs')}</span>
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
                          {t('matrix.replayUnavailable', 'Replay payload is not available for this matrix result.')}
                        </div>
                      )}
                   </div>
              </div>
           </div>
      )}
    </div>
  );
};
