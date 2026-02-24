import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Run, Job, JobStatus, RunType, Checkpoint, EvalProtocol, ArtifactFile, MatrixCell, EvalResult, MatrixResult } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { Heatmap } from '../components/Heatmap';
import { AdversarialReplayPlayer, isAdversarialReplayData, type AdversarialReplayData } from '../components/AdversarialReplayPlayer';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Terminal, Download, RefreshCw, FileText, Tag, PlayCircle, Folder, ChevronRight, GitFork, Grid3X3, Search, ArrowDownCircle, Calculator, Copy, X, HardDrive, AlertTriangle, Package } from 'lucide-react';
import { useToast } from '../components/Toast.tsx';
import { useI18n } from '../services/i18n';

const LOG_PAGE_SIZE = 200;
const LOG_HINT_WINDOW = 400;
const LOG_LINE_HEIGHT = 20;
const LOG_OVERSCAN = 18;

type LogHint = {
  id: string;
  title: string;
  detail: string;
  action?: string;
};

const smoothSeries = (
  series: { step: number; value: number }[] | undefined,
  windowSize: number,
) => {
  if (!series || series.length === 0) return [];
  if (windowSize <= 1) return series;
  const output: { step: number; value: number }[] = [];
  const window: number[] = [];
  let sum = 0;
  series.forEach(point => {
    window.push(point.value);
    sum += point.value;
    if (window.length > windowSize) {
      const removed = window.shift();
      if (removed !== undefined) sum -= removed;
    }
    const denom = window.length || 1;
    output.push({ step: point.step, value: sum / denom });
  });
  return output;
};

const deriveLogHints = (
  lines: string[],
  tx: (zh: string, en: string) => string,
): LogHint[] => {
  const recent = lines.slice(-LOG_HINT_WINDOW);
  const hints: LogHint[] = [];
  const missingModules = new Set<string>();
  const missingFiles = new Set<string>();
  let entrypointError = false;
  let cudaOom = false;
  let killed = false;

  const addHint = (hint: LogHint) => {
    if (!hints.some(existing => existing.id === hint.id)) {
      hints.push(hint);
    }
  };

  recent.forEach(line => {
    const moduleMatch = line.match(/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/);
    if (moduleMatch?.[1]) {
      missingModules.add(moduleMatch[1]);
    }
    const fileMatch = line.match(/FileNotFoundError: \[Errno 2\] No such file or directory: ['"]([^'"]+)['"]/);
    if (fileMatch?.[1]) {
      missingFiles.add(fileMatch[1]);
    }
    if (/env entrypoint error/i.test(line)) {
      entrypointError = true;
    }
    if (/CUDA out of memory|CUDNN_STATUS|out of memory/i.test(line)) {
      cudaOom = true;
    }
    if (/Killed|SIGKILL|Exit code 137|OOM killer/i.test(line)) {
      killed = true;
    }
  });

  if (missingModules.size > 0) {
    const list = Array.from(missingModules).slice(0, 4).join(', ');
    addHint({
      id: 'missing-modules',
      title: tx('缺少 Python 依赖', 'Missing Python dependency'),
      detail: tx(
        `Python 导入失败：${list}${missingModules.size > 4 ? '…' : ''}。`,
        `Python failed to import: ${list}${missingModules.size > 4 ? '…' : ''}.`,
      ),
      action: tx(
        '请在 runner 环境安装依赖，或加入算法依赖清单。',
        'Install the package in the runner env or add it to your algo requirements.',
      ),
    });
  }

  if (entrypointError) {
    addHint({
      id: 'entrypoint-error',
      title: tx('算法入口加载失败', 'Algorithm entrypoint not loading'),
      detail: tx('Runner 无法导入入口模块/函数。', 'The runner could not import the entrypoint module/function.'),
      action: tx(
        '检查入口是否为 `module:function`，并确认模块位于算法源码路径中。',
        'Check that entrypoint is `module:function` and that the module is inside your algo source path.',
      ),
    });
  }

  if (missingFiles.size > 0) {
    const list = Array.from(missingFiles).slice(0, 3).join(', ');
    addHint({
      id: 'missing-files',
      title: tx('缺少文件或数据集路径', 'Missing file or dataset path'),
      detail: tx(
        `未找到文件：${list}${missingFiles.size > 3 ? '…' : ''}。`,
        `File not found: ${list}${missingFiles.size > 3 ? '…' : ''}.`,
      ),
      action: tx('请检查数据路径、挂载与工作目录。', 'Verify dataset paths, mounts, and working directory.'),
    });
  }

  if (cudaOom) {
    addHint({
      id: 'cuda-oom',
      title: tx('CUDA 显存不足', 'CUDA out of memory'),
      detail: tx('训练期间 GPU 显存耗尽。', 'GPU memory exhausted during training.'),
      action: tx('请降低 batch size、模型规模或申请更多 GPU。', 'Reduce batch size, model size, or request more GPUs.'),
    });
  }

  if (killed) {
    addHint({
      id: 'killed',
      title: tx('进程被终止（SIGKILL）', 'Process terminated (SIGKILL)'),
      detail: tx('进程被操作系统或调度器强制终止。', 'The process was killed by the OS or scheduler.'),
      action: tx('请检查内存限制、抢占策略或超时守护。', 'Check memory limits, preemption, or long-running watchdogs.'),
    });
  }

  return hints;
};

export const RunDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { tx, locale } = useI18n();
  const [run, setRun] = useState<Run | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [protocols, setProtocols] = useState<EvalProtocol[]>([]);
  const [matrixData, setMatrixData] = useState<MatrixCell[]>([]);
  const [matrixResult, setMatrixResult] = useState<MatrixResult | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [metricsSeries, setMetricsSeries] = useState<Record<string, { step: number; value: number }[]>>({});
  const [activeTab, setActiveTab] = useState<'metrics' | 'logs' | 'config' | 'checkpoints' | 'matrix' | 'source' | 'tensorboard' | 'video'>('metrics');
  
  // Log Viewer State
  const [logSearch, setLogSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logHasMore, setLogHasMore] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logScrollTop, setLogScrollTop] = useState(0);

  // Repro Bundle State
  const [reproBundleUrl, setReproBundleUrl] = useState<string | null>(null);
  const [reproManifest, setReproManifest] = useState<Record<string, unknown> | null>(null);
  const [smoothWindow, setSmoothWindow] = useState(1);

  // Modal State
  const [showEvalModal, setShowEvalModal] = useState(false);
  const [selectedCkpt, setSelectedCkpt] = useState<Checkpoint | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState('');
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saveTemplateDescription, setSaveTemplateDescription] = useState('');
  const [saveTemplateType, setSaveTemplateType] = useState<'Single-Agent' | 'Multi-Agent'>('Multi-Agent');
  const [saveTemplateConfig, setSaveTemplateConfig] = useState('');
  const [saveTemplateSubmitting, setSaveTemplateSubmitting] = useState(false);

  // Model Registry State
  const [showRegisterModelModal, setShowRegisterModelModal] = useState(false);
  const [registerModelId, setRegisterModelId] = useState('');
  const [registerNewModelName, setRegisterNewModelName] = useState('');
  const [registerNewModelDesc, setRegisterNewModelDesc] = useState('');
  const [models, setModels] = useState<{id: string, name: string}[]>([]);
  const [isRegisteringModel, setIsRegisteringModel] = useState(false);

  // Artifact Browser State
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactFile[]>([]);
  const [videoFiles, setVideoFiles] = useState<ArtifactFile[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<{timestamp: number, cpu_percent: number, memory_percent: number}[]>([]);

  const loadLogs = (page: number, append: boolean) => {
      if (!id) return;
      setLogLoading(true);
      api.getRunLogs(id, { page, pageSize: LOG_PAGE_SIZE })
        .then(res => {
            setLogLines(prev => append ? [...prev, ...res.lines] : res.lines);
            setLogHasMore(res.hasMore);
            setLogPage(res.page);
        })
        .finally(() => setLogLoading(false));
  }
  
  // Fetch System Metrics from Artifact
  const loadSystemMetrics = async (files: ArtifactFile[]) => {
      const sysMetricFile = files.find(f => f.name === 'system_metrics.jsonl');
      if (sysMetricFile) {
          try {
              const res = await api.getArtifactDownloadUrl(sysMetricFile.id);
              const contentRes = await fetch(res.url);
              const text = await contentRes.text();
              const lines = text.trim().split('\n');
              const parsed = lines.map(line => JSON.parse(line));
              // Downsample if too many
              const sampled = parsed.length > 500 ? parsed.filter((_, i) => i % Math.ceil(parsed.length / 500) === 0) : parsed;
              setSystemMetrics(sampled);
          } catch (e) {
              console.error("Failed to load system metrics", e);
          }
      }
      
      const vids = files.filter(f => f.name.endsWith('.mp4') || f.name.endsWith('.replay.json'));
      setVideoFiles(vids.sort((a, b) => a.name.localeCompare(b.name)));
  }

  const buildMatrixCells = (result: MatrixResult | null): MatrixCell[] => {
      if (!result) return [];
      if (result.cells && result.cells.length > 0) return result.cells;
      if (result.matrix && result.labels) {
          return result.matrix.flatMap((row, rowIdx) =>
              row.map((value, colIdx) => ({
                  row: result.labels?.[rowIdx] || `row-${rowIdx}`,
                  col: result.labels?.[colIdx] || `col-${colIdx}`,
                  value,
              })),
          );
      }
      return [];
  }

  useEffect(() => {
    if (!id) return;
    setLogLines([]);
    setLogPage(1);
    setLogHasMore(false);
    setMatrixResult(null);
    setMatrixData([]);
    setEvalResult(null);
    setJob(null);
    setMetricsSeries({});
    api.getRunById(id).then(r => {
        setRun(r);
        if (r.type === RunType.MATRIX) {
            setActiveTab('matrix');
        }
    });
    api.getRunJob(id).then(setJob).catch(() => setJob(null));
    api.getCheckpoints(id).then(setCheckpoints);
    api.getProtocols().then(setProtocols);
    api.getArtifacts(id).then(files => {
        setArtifacts(files);
        loadSystemMetrics(files);
    });
    api.getRunMetrics(id).then(res => setMetricsSeries(res.series || {})).catch(() => setMetricsSeries({}));
    loadLogs(1, false);
    api.getReproBundle(id)
      .then(res => {
          setReproBundleUrl(res.url ?? null);
          setReproManifest(res.manifest ?? null);
      })
      .catch(() => {
          setReproBundleUrl(null);
          setReproManifest(null);
      });
  }, [id]);

  useEffect(() => {
      if (!run) return;
      if (run.type === RunType.MATRIX) {
          const matrixId = (run.config as any)?.matrixId as string | undefined;
          if (matrixId) {
              api.getMatrixResultById(matrixId).then(result => {
                  setMatrixResult(result);
                  setMatrixData(buildMatrixCells(result));
              });
          } else {
              api.getMatrixResults({ runId: run.id }).then(results => {
                  const sorted = [...results].sort((a, b) => {
                      const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
                      const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
                      return bTime - aTime;
                  });
                  const latest = sorted[0] || null;
                  setMatrixResult(latest);
                  setMatrixData(buildMatrixCells(latest));
              });
          }
      }
      if (run.type === RunType.EVAL) {
          const evalResultId = (run.config as any)?.evalResultId as string | undefined;
          if (evalResultId) {
              api.getEvalResultById(evalResultId).then(setEvalResult);
          }
      }
  }, [run]);

  useEffect(() => {
      if (!id) return;
      let interval: ReturnType<typeof setInterval> | null = null;
      const refresh = () => {
          api.getRunMetrics(id).then(res => setMetricsSeries(res.series || {})).catch(() => undefined);
          api.getRunJob(id).then(setJob).catch(() => undefined);
          api.getRunById(id).then(setRun).catch(() => undefined);
      };
      refresh();
      if (run?.status === JobStatus.RUNNING) {
          interval = setInterval(refresh, 2000);
      }
      return () => {
          if (interval) clearInterval(interval);
      };
  }, [id, run?.status]);

  useEffect(() => {
      // Auto-scroll effect
      if (activeTab === 'logs' && autoScroll && logContainerRef.current) {
          const el = logContainerRef.current;
          el.scrollTop = el.scrollHeight;
          setLogScrollTop(el.scrollTop);
      }
  }, [activeTab, autoScroll, logLines]);

  useEffect(() => {
      if (!logContainerRef.current) return;
      logContainerRef.current.scrollTop = 0;
      setLogScrollTop(0);
  }, [logSearch, id]);

  const handleLaunchEval = () => {
      if (!selectedCkpt || !selectedProtocol) return;
      api.submitEvalJob({ policySnapshotId: selectedCkpt.id, protocolId: selectedProtocol, resources: { gpus: 1 } })
        .then(res => api.getJobById(res.jobId))
        .then(job => {
            setShowEvalModal(false);
            showToast(tx('评估任务提交成功。', 'Evaluation job submitted successfully.'), 'success');
            if (job?.runId) navigate(`/runs/${job.runId}`);
        });
  }

  const handlePause = () => {
      if (!job) return;
      api.pauseJob(job.id, { reason: 'paused' })
        .then(setJob)
        .then(() => showToast(tx('任务已暂停。', 'Job paused.'), 'success'))
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(tx(`暂停任务失败：${detail}`, `Failed to pause job: ${detail}`), 'error');
        });
  }

  const handleResume = () => {
      if (!job) return;
      api.resumeJob(job.id)
        .then(setJob)
        .then(() => showToast(tx('任务已恢复。', 'Job resumed.'), 'success'))
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(tx(`恢复任务失败：${detail}`, `Failed to resume job: ${detail}`), 'error');
        });
  }

  const handleCancel = () => {
      if (!job) return;
      if (!window.confirm(tx('确认取消该任务？', 'Cancel this job?'))) return;
      api.cancelJob(job.id, { reason: 'canceled' })
        .then(setJob)
        .then(() => showToast(tx('任务已取消。', 'Job canceled.'), 'success'))
        .catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(tx(`取消任务失败：${detail}`, `Failed to cancel job: ${detail}`), 'error');
        });
  }
  
  const handleFork = () => {
      if (!run) return;
      navigate('/create-job', { 
          state: { 
              forkedFrom: run.id,
              projectId: run.projectId,
              algoId: run.algo,
              envId: run.env,
              config: JSON.stringify({ lr: 5e-4, notes: tx(`由 ${run.name} 分叉`, `Forked from ${run.name}`) }, null, 2)
          }
      });
  }

  const openSaveTemplateModal = () => {
      if (!run) return;
      const suggested = buildTemplateConfigFromRun(run);
      setSaveTemplateName(tx(`来自 ${run.name} 的模板`, `Template from ${run.name}`));
      setSaveTemplateDescription(tx(`保存自运行 ${run.id}`, `Saved from run ${run.id}`));
      setSaveTemplateType('Multi-Agent');
      setSaveTemplateConfig(JSON.stringify(suggested || {}, null, 2));
      setShowSaveTemplateModal(true);
  };

  const handleSaveTemplate = async () => {
      if (!run) return;
      const algoVersionId = (run.config as any)?.algo?.algoVersionId as string | undefined;
      if (!algoVersionId) {
          showToast(tx('无法推断该运行对应的算法版本。', 'Cannot infer algorithm version for this run.'), 'error');
          return;
      }
      let parsedConfig: Record<string, unknown> | undefined = undefined;
      try {
          parsedConfig = saveTemplateConfig.trim() ? JSON.parse(saveTemplateConfig) : {};
      } catch {
          showToast(tx('默认配置不是合法 JSON。', 'Default config is not valid JSON.'), 'error');
          return;
      }
      if (!saveTemplateName.trim()) {
          showToast(tx('模板名称不能为空。', 'Template name is required.'), 'error');
          return;
      }
      setSaveTemplateSubmitting(true);
      try {
          const tmpl = await api.createTemplate(run.projectId, {
              name: saveTemplateName.trim(),
              description: saveTemplateDescription.trim() || undefined,
              type: saveTemplateType,
              defaultConfig: parsedConfig,
          });
          const versionLabel = `run-${run.id.slice(0, 8)}`;
          await api.createTemplateVersion(tmpl.id, {
              version: versionLabel,
              algoVersionId,
              defaultConfig: parsedConfig,
          });
          showToast(tx('模板保存成功。', 'Template saved successfully.'), 'success');
          setShowSaveTemplateModal(false);
      } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(tx(`保存模板失败：${detail}`, `Failed to save template: ${detail}`), 'error');
      } finally {
          setSaveTemplateSubmitting(false);
      }
  };

  const handleCopyId = () => {
      if(run) {
          navigator.clipboard.writeText(run.id);
          showToast(tx(`运行 ID ${run.id} 已复制`, `Run ID ${run.id} copied to clipboard`), 'success');
      }
  }

  const handleArtifactDownload = (artifactId: string) => {
      api.getArtifactDownloadUrl(artifactId).then(res => {
          window.open(res.url, '_blank', 'noreferrer');
      });
  }

  const openRegisterModelModal = (ckpt: Checkpoint) => {
      setSelectedCkpt(ckpt);
      api.getModels().then(ms => {
          setModels(ms);
          if (ms.length > 0) setRegisterModelId(ms[0].id);
      });
      setShowRegisterModelModal(true);
  };

  const handleRegisterModel = async () => {
      if (!selectedCkpt) return;
      setIsRegisteringModel(true);
      try {
          let modelId = registerModelId;
          if (registerNewModelName) {
              const newModel = await api.createModel(registerNewModelName, registerNewModelDesc);
              modelId = newModel.id;
          }
          if (!modelId) {
              showToast(tx('请选择或创建模型家族。', 'Please select or create a model family.'), 'error');
              return;
          }
          await api.registerModelVersion(modelId, selectedCkpt.id);
          showToast(tx('检查点已注册为新模型版本。', 'Checkpoint registered as new model version.'), 'success');
          setShowRegisterModelModal(false);
          setRegisterNewModelName('');
          setRegisterNewModelDesc('');
      } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          showToast(tx(`注册模型失败：${detail}`, `Failed to register model: ${detail}`), 'error');
      } finally {
          setIsRegisteringModel(false);
      }
  };

  const handleCheckpointDownload = (ckpt: Checkpoint) => {
      const path = `/checkpoints/ckpt_${ckpt.step}.json`;
      const artifact = artifacts.find(item => item.path === path || item.name === `ckpt_${ckpt.step}.json`);
      if (!artifact) {
          showToast(tx('尚未找到该检查点产物。', 'Checkpoint artifact not found yet.'), 'error');
          return;
      }
      handleArtifactDownload(artifact.id);
  }

  const handleTagBest = (ckpt: Checkpoint) => {
      if (!run) return;
      api.tagCheckpoint(run.id, ckpt.id, { tag: 'best' })
        .then(updated => {
            setCheckpoints(prev => prev.map(item => item.id === updated.id ? updated : item));
            showToast(tx('已将检查点标记为 best。', 'Tagged checkpoint as best.'), 'success');
        })
        .catch(err => {
            const detail = err instanceof Error ? err.message : String(err);
            showToast(tx(`标记检查点失败：${detail}`, `Failed to tag checkpoint: ${detail}`), 'error');
        });
  }

  const handleDownloadAllArtifacts = () => {
      if (!run) return;
      api.downloadRunArtifactsArchive(run.id)
        .then((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${run.id}_artifacts.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        })
        .catch((err) => {
            const detail = err instanceof Error ? err.message : String(err);
            showToast(tx(`下载产物失败：${detail}`, `Failed to download artifacts: ${detail}`), 'error');
        });
  }

  const openEvalModal = (ckpt: Checkpoint) => {
      setSelectedCkpt(ckpt);
      if (protocols.length > 0) setSelectedProtocol(protocols[0].id);
      setShowEvalModal(true);
  }

  // Helper to calculate basic stats
  const getStats = (points: {value: number}[]) => {
      if (!points || points.length === 0) return { mean: 0, max: 0, std: 0 };
      const values = points.map(p => p.value);
      const mean = values.reduce((a,b) => a+b, 0) / values.length;
      const max = Math.max(...values);
      const variance = values.reduce((a,b) => a + Math.pow(b - mean, 2), 0) / values.length;
      return { mean, max, std: Math.sqrt(variance) };
  }
  
  // Video Component
  const VideoPlayer = ({ file }: { file: ArtifactFile }) => {
      const [url, setUrl] = useState<string | null>(null);
      const [replayData, setReplayData] = useState<AdversarialReplayData | null>(null);
      useEffect(() => {
          let cancelled = false;
          api.getArtifactDownloadUrl(file.id).then(async (res) => {
              if (cancelled) return;
              setUrl(res.url);
              if (!file.name.endsWith('.replay.json')) {
                  setReplayData(null);
                  return;
              }
              try {
                  const text = await fetch(res.url).then(r => r.text());
                  const parsed = JSON.parse(text);
                  if (!cancelled && isAdversarialReplayData(parsed)) {
                      setReplayData(parsed);
                  }
              } catch {
                  if (!cancelled) setReplayData(null);
              }
          });
          return () => {
              cancelled = true;
          };
      }, [file.id, file.name]);
      
      if (!url) return <div className="w-full h-48 bg-gray-100 animate-pulse rounded-lg"></div>;
      return (
          <div className="bg-black/5 p-2 rounded-lg space-y-2">
             <div className="text-xs text-gray-500 mb-1 truncate font-mono">{file.name}</div>
	             {replayData ? (
	               <div className="space-y-2">
	                 <div className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
	                   {tx('已生成对抗回放', 'Generated Adversarial Replay')}
	                 </div>
	                 <AdversarialReplayPlayer replay={replayData} />
	               </div>
	             ) : file.name.endsWith('.mp4') ? (
	               <video controls className="w-full rounded shadow-sm border border-gray-200" src={url} preload="metadata" />
	             ) : (
	               <div className="text-xs text-gray-500 p-3 bg-white border border-gray-200 rounded">
	                 {tx('回放数据不可用。', 'Replay payload unavailable.')}
	               </div>
	             )}
          </div>
      );
  }

  // Log filtering logic
  const logHints = useMemo(() => deriveLogHints(logLines, tx), [logLines, tx]);
  const videoGroups = useMemo(() => {
      const groups: Record<string, { label: string; files: ArtifactFile[] }> = {
          train: { label: tx('训练', 'Training'), files: [] },
          eval: { label: tx('评估', 'Evaluation'), files: [] },
          matrix: { label: tx('矩阵', 'Matrix'), files: [] },
          other: { label: tx('其他', 'Other'), files: [] },
      };
      videoFiles.forEach(file => {
          const ref = `${file.path || ''}/${file.name}`.toLowerCase();
          if (ref.includes('eval')) {
              groups.eval.files.push(file);
          } else if (ref.includes('train')) {
              groups.train.files.push(file);
          } else if (ref.includes('matrix')) {
              groups.matrix.files.push(file);
          } else {
              groups.other.files.push(file);
          }
      });
      return Object.values(groups).filter(group => group.files.length > 0);
  }, [videoFiles]);
  const logQuery = logSearch.trim().toLowerCase();
  const filteredLogLines = useMemo(
    () => (logQuery ? logLines.filter(line => line.toLowerCase().includes(logQuery)) : logLines),
    [logLines, logQuery],
  );
  const logViewportHeight = 540;
  const logStartIdx = Math.max(0, Math.floor(logScrollTop / LOG_LINE_HEIGHT) - LOG_OVERSCAN);
  const logVisibleCount = Math.ceil(logViewportHeight / LOG_LINE_HEIGHT) + LOG_OVERSCAN * 2;
  const logEndIdx = Math.min(filteredLogLines.length, logStartIdx + logVisibleCount);
  const logVisibleRows = filteredLogLines.slice(logStartIdx, logEndIdx);
  const logTotalHeight = filteredLogLines.length * LOG_LINE_HEIGHT;
  const logOffsetY = logStartIdx * LOG_LINE_HEIGHT;

  const buildTemplateConfigFromRun = (run: Run) => {
    const cfg = run.config || {};
    const result: Record<string, unknown> = {};
    const train = (cfg as any).train;
    if (train) result.train = train;
    const datasetId = (cfg as any).datasetId;
    if (datasetId) result.datasetId = datasetId;
    return result;
  };

  if (!run) return <div className="p-10 flex justify-center"><RefreshCw className="animate-spin text-blue-600" /></div>;

  const isMatrix = run.type === RunType.MATRIX;
  const isEval = run.type === RunType.EVAL;
  const metricSeries = {
      returnMean: metricsSeries.returnMean || run.metrics.returnMean || [],
      winRate: metricsSeries.winRate || run.metrics.winRate || [],
      entropy: metricsSeries.entropy || run.metrics.entropy || [],
  };
  const chartSeries = {
      returnMean: smoothSeries(metricSeries.returnMean, smoothWindow),
      winRate: smoothSeries(metricSeries.winRate, smoothWindow),
      entropy: smoothSeries(metricSeries.entropy, smoothWindow),
  };
  const matrixMetric = matrixResult?.meta?.metric || 'winRate';
  const matrixLabel = matrixMetric === 'returnMean'
    ? tx('平均回报', 'Return Mean')
    : matrixMetric === 'survivalTime'
      ? tx('生存时长', 'Survival Time')
      : tx('胜率', 'Win Rate');
  const matrixFormatter = matrixMetric === 'winRate'
    ? (value: number) => `${(value * 100).toFixed(1)}%`
    : matrixMetric === 'survivalTime'
      ? (value: number) => `${value.toFixed(1)}s`
      : (value: number) => value.toFixed(2);
  const matrixDomain = matrixMetric === 'winRate' ? [0, 1] as [number, number] : undefined;
  const returnStats = getStats(metricSeries.returnMean);
  const winRateStats = getStats(metricSeries.winRate);
  const evalSummary = evalResult?.summary;
  const evalCi = evalResult?.ci;
  const matrixLabels = matrixResult?.labels || [];
  const matrixRanking = matrixResult?.ranking
    ? [...matrixResult.ranking].sort((a, b) => b.score - a.score)
    : [];
  const topRank = matrixRanking[0];
  const matrixProtocolName = matrixResult?.protocolId
    ? protocols.find(p => p.id === matrixResult?.protocolId)?.name
    : undefined;
  const matrixTotalMatches = matrixLabels.length ? matrixLabels.length * matrixLabels.length : 0;
  const selectedProtocolDetail = protocols.find(p => p.id === selectedProtocol);
  const isPaused = !!job?.message && job.message.toLowerCase().startsWith('paused');
  const canSaveTemplate = !!(run.config as any)?.algo?.algoVersionId;

  return (
    <div className="space-y-6 relative">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex justify-between items-start">
            <div>
                <div className="flex items-center gap-3">
                    <h1 className="text-xl font-bold text-gray-900">{run.name}</h1>
                    <StatusBadge status={run.status} type={run.type} />
                    <button
                      onClick={handleCopyId}
                      className="text-xs text-gray-400 font-mono hover:text-blue-600 hover:bg-blue-50 px-1 py-0.5 rounded transition-colors flex items-center gap-1"
                      title={tx('复制 ID', 'Copy ID')}
                    >
                        <Copy className="w-3 h-3" /> {run.id}
                    </button>
                </div>
                <div className="mt-2 flex gap-4 text-sm text-gray-600">
                    <div className="flex items-center"><span className="font-semibold mr-1">{tx('算法：', 'Algo:')}</span> {run.algo}</div>
                    <div className="flex items-center"><span className="font-semibold mr-1">{tx('环境：', 'Env:')}</span> {run.env}</div>
                    <div className="flex items-center"><span className="font-semibold mr-1">{tx('GPU：', 'GPU:')}</span> {run.gpu}</div>
                    <div className="flex items-center"><span className="font-semibold mr-1">{tx('时长：', 'Duration:')}</span> {run.duration}</div>
                    {isPaused && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200">
                        {tx('已暂停', 'Paused')}
                      </span>
                    )}
                </div>
            </div>
            <div className="flex gap-2">
                <button 
                  onClick={handleFork}
                  className="px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center shadow-sm"
                  title={tx('克隆该实验配置', 'Clone this experiment configuration')}
                >
                    <GitFork className="w-4 h-4 mr-2" /> {tx('分叉 / 克隆', 'Fork / Clone')}
                </button>
                <button 
                  onClick={openSaveTemplateModal}
                  disabled={!canSaveTemplate}
                  className={`px-3 py-1.5 bg-white border rounded-md text-sm font-medium flex items-center shadow-sm ${
                    canSaveTemplate
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      : 'border-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  title={canSaveTemplate ? tx('将运行配置保存为模板', 'Save run configuration as a template') : tx('当前运行无法保存模板', 'Template saving unavailable for this run')}
                >
                    <FileText className="w-4 h-4 mr-2" /> {tx('保存为模板', 'Save as Template')}
                </button>
                <button 
                  onClick={() => setShowArtifacts(true)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center"
                >
                    <Folder className="w-4 h-4 mr-2" /> {tx('产物', 'Artifacts')}
                </button>
                {run.status === JobStatus.RUNNING && (
                  <>
                    {isPaused ? (
                      <button
                        onClick={handleResume}
                        className="px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-md text-sm font-medium hover:bg-green-100"
                      >
                        {tx('恢复', 'Resume')}
                      </button>
                    ) : (
                      <button
                        onClick={handlePause}
                        className="px-3 py-1.5 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-md text-sm font-medium hover:bg-yellow-100"
                      >
                        {tx('暂停', 'Pause')}
                      </button>
                    )}
                    <button
                      onClick={handleCancel}
                      className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-md text-sm font-medium hover:bg-red-100"
                    >
                      {tx('停止运行', 'Stop Run')}
                    </button>
                  </>
                )}
            </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
              {/* Show different tabs based on Run Type */}
              {isMatrix ? (
                  <>
                    <button onClick={() => setActiveTab('matrix')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'matrix' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('热力图分析', 'Heatmap Analysis')}</button>
                    {videoFiles.length > 0 && <button onClick={() => setActiveTab('video')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'video' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx(`回放画廊 (${videoFiles.length})`, `Replay Gallery (${videoFiles.length})`)}</button>}
                    <button onClick={() => setActiveTab('config')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'config' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('配置', 'Configuration')}</button>
                    <button onClick={() => setActiveTab('logs')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'logs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('任务日志', 'Job Logs')}</button>
                  </>
              ) : isEval ? (
                   <>
                    <button onClick={() => setActiveTab('metrics')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'metrics' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('评估指标', 'Evaluation Metrics')}</button>
                    {videoFiles.length > 0 && <button onClick={() => setActiveTab('video')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'video' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx(`回放画廊 (${videoFiles.length})`, `Replay Gallery (${videoFiles.length})`)}</button>}
                    <button onClick={() => setActiveTab('logs')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'logs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('系统日志', 'System Logs')}</button>
                    <button onClick={() => setActiveTab('config')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'config' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('配置', 'Configuration')}</button>
                  </>
              ) : (
                  <>
                    <button onClick={() => setActiveTab('metrics')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'metrics' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('训练指标', 'Training Metrics')}</button>
                    <button onClick={() => setActiveTab('tensorboard')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'tensorboard' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('TensorBoard', 'TensorBoard')}</button>
                    {videoFiles.length > 0 && <button onClick={() => setActiveTab('video')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'video' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx(`回放画廊 (${videoFiles.length})`, `Replay Gallery (${videoFiles.length})`)}</button>}
                    <button onClick={() => setActiveTab('logs')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'logs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('系统日志', 'System Logs')}</button>
                    <button onClick={() => setActiveTab('checkpoints')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'checkpoints' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('检查点', 'Checkpoints')}</button>
                    <button onClick={() => setActiveTab('config')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'config' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('配置', 'Configuration')}</button>
                    <button onClick={() => setActiveTab('source')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'source' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{tx('源码', 'Source Code')}</button>
                  </>
              )}
          </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[500px]">
          {activeTab === 'matrix' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex justify-center">
                        <Heatmap
                          data={matrixData}
                          width={600}
                          height={500}
                          valueLabel={matrixLabel}
                          valueFormatter={matrixFormatter}
                          valueDomain={matrixDomain}
                        />
                    </div>
                </div>
                <div className="space-y-6">
                     <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="font-bold text-gray-900 mb-2 flex items-center">
                            <Grid3X3 className="w-4 h-4 mr-2 text-gray-500"/> {tx('矩阵摘要', 'Matrix Summary')}
                        </h3>
                        <div className="text-sm text-gray-600 space-y-2">
                            <div className="flex justify-between"><span>{tx('池规模：', 'Pool Size:')}</span> <span className="font-medium">{matrixLabels.length || '-'}</span></div>
                            <div className="flex justify-between"><span>{tx('总对局：', 'Total Matches:')}</span> <span className="font-medium">{matrixTotalMatches || '-'}</span></div>
                            <div className="flex justify-between"><span>{tx('指标：', 'Metric:')}</span> <span className="font-medium">{matrixResult?.meta?.metric || 'winRate'}</span></div>
                            <div className="flex justify-between"><span>{tx('评估协议：', 'Eval Protocol:')}</span> <span className="font-medium">{matrixProtocolName || matrixResult?.protocolId || '-'}</span></div>
                        </div>
                        <div className="mt-4 pt-4 border-t border-gray-100">
                             <h4 className="font-bold text-gray-900 text-sm mb-2">{tx('排名第一', 'Top Ranked')}</h4>
                             {topRank ? (
                               <>
                                 <div className="flex items-center gap-2">
                                     <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                     <span className="text-sm font-medium">{topRank.id}</span>
                                 </div>
                                 <div className="text-xs text-gray-500 mt-1">{tx('分数：', 'Score:')} {topRank.score.toFixed(2)}</div>
                               </>
                             ) : (
                               <div className="text-xs text-gray-500">{tx('暂无排名数据。', 'No ranking data yet.')}</div>
                             )}
                        </div>
                     </div>
                     <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                         <h4 className="text-blue-800 font-bold text-sm mb-1">{tx('解读', 'Interpretation')}</h4>
                         <p className="text-xs text-blue-700 leading-relaxed">
                             {matrixResult
                               ? tx('该矩阵来自评估协议结果，可结合排名与热力图比较相对强弱。', 'Matrix generated from evaluation protocol results. Use ranking and heatmap to compare relative strengths.')
                               : tx('当前暂无矩阵结果，请先运行矩阵任务。', 'Matrix result not available yet. Run a matrix job to populate this view.')}
                         </p>
                     </div>
                </div>
              </div>
          )}
          
          {activeTab === 'video' && videoFiles.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {videoFiles.map(file => (
                      <VideoPlayer key={file.id} file={file} />
                  ))}
              </div>
          )}

          {activeTab === 'tensorboard' && (
              <div className="w-full h-[800px] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <iframe 
                    src={`http://${window.location.hostname}:6006/?darkMode=false#scalars&regexInput=${run.id}`} 
                    className="w-full h-full border-0"
                    title={tx('TensorBoard 面板', 'TensorBoard')}
                  />
              </div>
          )}

          {activeTab === 'metrics' && (
            <div className="space-y-6">
                {/* Result Summary Card (Statistics) */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {isEval ? (
                      <>
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="text-xs text-gray-500 font-medium uppercase mb-1 flex items-center">
                                <Calculator className="w-3 h-3 mr-1"/> {tx('平均胜率', 'Mean Win Rate')}
                            </div>
                            <div className="text-2xl font-bold text-gray-900">{evalSummary ? (evalSummary.mean * 100).toFixed(1) : '--'}%</div>
                            <div className="text-xs text-gray-400 mt-1">n = {evalSummary?.n ?? '--'}</div>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="text-xs text-gray-500 font-medium uppercase mb-1">{tx('标准差', 'Std Dev')}</div>
                            <div className="text-2xl font-bold text-gray-900">{evalSummary ? (evalSummary.std * 100).toFixed(1) : '--'}%</div>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="text-xs text-gray-500 font-medium uppercase mb-1">{tx('置信区间', 'Confidence Interval')}</div>
                            <div className="text-sm font-bold text-gray-900">
                              {evalCi ? `${(evalCi.low * 100).toFixed(1)}% - ${(evalCi.high * 100).toFixed(1)}%` : '--'}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">{evalCi ? tx(`${Math.round(evalCi.level * 100)}% 置信区间`, `${Math.round(evalCi.level * 100)}% CI`) : ''}</div>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-center">
                             <div className="text-xs text-gray-500 font-medium uppercase mb-1">{tx('状态', 'Status')}</div>
                             {run.status === JobStatus.SUCCEEDED ? (
                                 <div className="text-green-600 font-bold flex items-center"><ChevronRight className="w-4 h-4"/> {tx('已完成', 'Completed')}</div>
                             ) : (
                                 <div className="text-gray-500 font-medium">{tx('进行中 / 失败', 'In Progress / Failed')}</div>
                             )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="text-xs text-gray-500 font-medium uppercase mb-1 flex items-center">
                                <Calculator className="w-3 h-3 mr-1"/> {tx('平均回报', 'Avg Return')}
                            </div>
                            <div className="text-2xl font-bold text-gray-900">{returnStats.mean.toFixed(2)}</div>
                            <div className="text-xs text-gray-400 mt-1">{tx('±', '±')} {returnStats.std.toFixed(2)} {tx('（标准差）', '(std)')}</div>
                        </div>
                         <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="text-xs text-gray-500 font-medium uppercase mb-1">{tx('最大回报', 'Max Return')}</div>
                            <div className="text-2xl font-bold text-gray-900">{returnStats.max.toFixed(2)}</div>
                        </div>
                         <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="text-xs text-gray-500 font-medium uppercase mb-1">{tx('平均胜率', 'Avg Win Rate')}</div>
                            <div className="text-2xl font-bold text-gray-900">{(winRateStats.mean * 100).toFixed(1)}%</div>
                             <div className="text-xs text-gray-400 mt-1">{tx('±', '±')} {(winRateStats.std * 100).toFixed(1)}% {tx('（标准差）', '(std)')}</div>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-center">
                             <div className="text-xs text-gray-500 font-medium uppercase mb-1">{tx('状态', 'Status')}</div>
                             {run.status === JobStatus.SUCCEEDED && winRateStats.mean > 0.5 ? (
                                 <div className="text-green-600 font-bold flex items-center"><ChevronRight className="w-4 h-4"/> {tx('已解决', 'Solved')}</div>
                             ) : (
                                 <div className="text-gray-500 font-medium">{tx('进行中 / 失败', 'In Progress / Failed')}</div>
                             )}
                        </div>
                      </>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="text-sm font-semibold text-gray-900 mb-4">{isEval ? tx('成功率 / 胜率', 'Success Rate / Win Rate') : tx('平均回报', 'Return Mean')}</h3>
                        <div className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={isEval ? metricSeries.winRate : metricSeries.returnMean}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="step" fontSize={12} tickFormatter={(val) => `${val/1000}k`} />
                                    <YAxis fontSize={12} />
                                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                    <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {!isEval && (
                        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                            <h3 className="text-sm font-semibold text-gray-900 mb-4">{tx('胜率', 'Win Rate')}</h3>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={metricSeries.winRate}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="step" fontSize={12} tickFormatter={(val) => `${val/1000}k`} />
                                        <YAxis fontSize={12} />
                                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                        <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="text-sm font-semibold text-gray-900 mb-4">{isEval ? tx('回合长度', 'Episodes Length') : tx('熵', 'Entropy')}</h3>
                        <div className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={metricSeries.entropy}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="step" fontSize={12} tickFormatter={(val) => `${val/1000}k`} />
                                    <YAxis fontSize={12} />
                                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                    <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
                
                {/* System Metrics Section */}
                {systemMetrics.length > 0 && (
                    <div className="pt-6 border-t border-gray-200">
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2"><HardDrive className="w-5 h-5 text-gray-500"/> {tx('系统资源', 'System Resources')}</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 className="text-sm font-semibold text-gray-900 mb-4">{tx('CPU 使用率 (%)', 'CPU Usage (%)')}</h4>
                                <div className="h-[200px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={systemMetrics}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                            <XAxis dataKey="timestamp" hide />
                                            <YAxis fontSize={12} domain={[0, 100]} />
                                            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none' }} labelFormatter={() => ''} />
                                            <Line type="monotone" dataKey="cpu_percent" stroke="#dc2626" strokeWidth={1} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <h4 className="text-sm font-semibold text-gray-900 mb-4">{tx('内存使用率 (%)', 'Memory Usage (%)')}</h4>
                                <div className="h-[200px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={systemMetrics}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                            <XAxis dataKey="timestamp" hide />
                                            <YAxis fontSize={12} domain={[0, 100]} />
                                            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none' }} labelFormatter={() => ''} />
                                            <Line type="monotone" dataKey="memory_percent" stroke="#7c3aed" strokeWidth={1} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                        
                        {/* GPU Metrics (Dynamic) */}
                        {systemMetrics.length > 0 && (systemMetrics[0] as any).gpus && (systemMetrics[0] as any).gpus.length > 0 && (
                            <div className="mt-6">
                                <h4 className="text-sm font-semibold text-gray-900 mb-4">{tx('GPU 利用率 (%)', 'GPU Utilization (%)')}</h4>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {(systemMetrics[0] as any).gpus.map((gpu: any, idx: number) => (
                                        <div key={idx} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                            <div className="text-xs text-gray-500 mb-2">GPU {gpu.index}</div>
                                            <div className="h-[200px]">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={systemMetrics}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                        <XAxis dataKey="timestamp" hide />
                                                        <YAxis fontSize={12} domain={[0, 100]} />
                                                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none' }} labelFormatter={() => ''} />
                                                        <Line type="monotone" dataKey={`gpus[${idx}].util_gpu`} stroke="#059669" strokeWidth={1} dot={false} name={tx('计算', 'Compute')} />
                                                        <Line type="monotone" dataKey={`gpus[${idx}].util_mem`} stroke="#d97706" strokeWidth={1} dot={false} name={tx('显存控制器', 'Mem Controller')} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
          )}

          {activeTab === 'logs' && (
              <div className="space-y-4">
                  {logHints.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                          <div className="flex items-center gap-2 text-amber-900 font-semibold mb-3">
                              <AlertTriangle className="w-4 h-4" />
                              {tx('日志中检测到问题', 'Detected issues in logs')}
                          </div>
                          <div className="space-y-3">
                              {logHints.map(hint => (
                                  <div key={hint.id} className="flex gap-3">
                                      <div className="mt-1 w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                                      <div className="text-sm text-amber-900">
                                          <div className="font-medium">{hint.title}</div>
                                          <div className="text-amber-800">{hint.detail}</div>
                                          {hint.action && (
                                              <div className="text-amber-700">{tx('修复建议：', 'Fix:')} {hint.action}</div>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}

                  <div className="bg-gray-900 rounded-xl overflow-hidden shadow-inner border border-gray-800 flex flex-col h-[600px]">
                      {/* Log Toolbar */}
                      <div className="bg-gray-800 p-2 flex items-center justify-between border-b border-gray-700">
                          <div className="flex items-center gap-2 text-gray-400 text-sm">
                              <Terminal className="w-4 h-4" />
                              <span>{tx('标准输出日志', 'stdout.log')}</span>
                              <span className="text-[11px] text-gray-500">
                                {tx(`${filteredLogLines.length.toLocaleString()} 行`, `${filteredLogLines.length.toLocaleString()} lines`)}
                              </span>
                          </div>
                          <div className="flex items-center gap-3">
                              <div className="relative">
                                  <Search className="w-3 h-3 text-gray-500 absolute left-2 top-1.5" />
                                  <input 
                                    type="text" 
                                    placeholder={tx('筛选日志...', 'Filter logs...')}
                                    value={logSearch}
                                    onChange={(e) => setLogSearch(e.target.value)}
                                    className="bg-gray-900 text-gray-300 text-xs rounded-md pl-7 pr-3 py-1 border border-gray-700 focus:ring-1 focus:ring-blue-500 focus:outline-none w-48"
                                  />
                              </div>
                              <button 
                                onClick={() => setAutoScroll(!autoScroll)}
                                className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${autoScroll ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                                title={tx('自动滚动到底部', 'Auto-scroll to bottom')}
                              >
                                  <ArrowDownCircle className="w-3 h-3" /> {tx('追踪', 'Tail')}
                              </button>
                              <button
                                onClick={() => loadLogs(logPage + 1, true)}
                                disabled={!logHasMore || logLoading}
                                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-700 text-gray-200 disabled:opacity-50"
                                title={tx('加载更多日志', 'Load more logs')}
                              >
                                  {logLoading ? tx('加载中...', 'Loading...') : tx('加载更多', 'Load More')}
                              </button>
                          </div>
                      </div>
                      
                      {/* Log Content */}
                      <div
                        ref={logContainerRef}
                        className="font-mono text-xs text-gray-300 overflow-auto flex-1"
                        onScroll={(e) => setLogScrollTop(e.currentTarget.scrollTop)}
                      >
                          {filteredLogLines.length === 0 ? (
                            <div className="p-4 text-gray-500 italic">
                              {logLines.length === 0 ? tx('暂无日志。', 'No logs available yet.') : tx('没有匹配筛选条件的日志。', 'No logs match your filter.')}
                            </div>
                          ) : (
                            <div className="relative" style={{ height: `${logTotalHeight}px` }}>
                              <div
                                className="absolute left-0 right-0"
                                style={{ transform: `translateY(${logOffsetY}px)` }}
                              >
                                {logVisibleRows.map((line, localIdx) => {
                                  const lineIndex = logStartIdx + localIdx;
                                  return (
                                    <div
                                      key={`log-${lineIndex}`}
                                      className="flex min-h-[20px] items-center border-b border-gray-800/70 px-3 leading-5"
                                      style={{ height: `${LOG_LINE_HEIGHT}px` }}
                                      title={line}
                                    >
                                      <div className="w-16 shrink-0 pr-3 text-right text-[10px] text-gray-500">
                                        {lineIndex + 1}
                                      </div>
                                      <pre className="m-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                                        {line}
                                      </pre>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                      </div>
                  </div>
              </div>
          )}

          {activeTab === 'config' && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center gap-2 mb-4">
                      <FileText className="w-5 h-5 text-gray-500" />
                      <h3 className="font-semibold text-gray-900">{tx('解析后配置', 'Resolved Configuration')}</h3>
                  </div>
                  <pre className="bg-gray-50 p-4 rounded-lg text-sm text-gray-700 font-mono overflow-auto border border-gray-100">
{`# run_config.json
${JSON.stringify(run?.config || {}, null, 2)}`}
                  </pre>
                  {reproBundleUrl && (
                    <div className="mt-4">
                      <button
                        onClick={() => window.open(reproBundleUrl, '_blank', 'noreferrer')}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        {tx('下载复现包', 'Download Repro Bundle')}
                      </button>
                    </div>
                  )}
              </div>
          )}

          {activeTab === 'checkpoints' && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                          <tr>
                              <th className="px-6 py-3 font-semibold text-gray-500">{tx('步数', 'Step')}</th>
                              <th className="px-6 py-3 font-semibold text-gray-500">{tx('胜率', 'Win Rate')}</th>
                              <th className="px-6 py-3 font-semibold text-gray-500">{tx('回报', 'Return')}</th>
                              <th className="px-6 py-3 font-semibold text-gray-500">{tx('标签', 'Tags')}</th>
                              <th className="px-6 py-3 font-semibold text-gray-500">{tx('创建时间', 'Created')}</th>
                              <th className="px-6 py-3 font-semibold text-gray-500">{tx('操作', 'Actions')}</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                          {checkpoints.map((ckpt) => (
                              <tr key={ckpt.id} className="hover:bg-gray-50">
                                  <td className="px-6 py-4 font-mono">{ckpt.step.toLocaleString()}</td>
                                  <td className="px-6 py-4 font-medium text-green-600">{(ckpt.metrics.winRate * 100).toFixed(1)}%</td>
                                  <td className="px-6 py-4 font-medium text-blue-600">{ckpt.metrics.returnMean.toFixed(2)}</td>
                                  <td className="px-6 py-4">
                                      <div className="flex gap-1">
                                          {ckpt.tags.map(t => (
                                              <span key={t} className="px-2 py-0.5 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-full text-xs font-medium">
                                                  {t}
                                              </span>
                                          ))}
                                      </div>
                                  </td>
                                  <td className="px-6 py-4 text-gray-500">{new Date(ckpt.createdAt).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US')}</td>
                                  <td className="px-6 py-4">
                                      <div className="flex gap-2">
                                          <button
                                            onClick={() => handleCheckpointDownload(ckpt)}
                                            className="text-gray-500 hover:text-blue-600"
                                            title={tx('下载', 'Download')}
                                          >
                                              <Download className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() => handleTagBest(ckpt)}
                                            className="text-gray-500 hover:text-yellow-600"
                                            title={tx('标记为最佳', 'Tag as Best')}
                                          >
                                              <Tag className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() => openRegisterModelModal(ckpt)}
                                            className="text-gray-500 hover:text-purple-600"
                                            title={tx('注册到模型仓库', 'Register to Model Registry')}
                                          >
                                              <Package className="w-4 h-4" />
                                          </button>
                                          <button 
                                            onClick={() => openEvalModal(ckpt)}
                                            className="text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 px-2 py-1 rounded border border-blue-100"
                                            title={tx('发起评估', 'Launch Eval')}
                                          >
                                              <PlayCircle className="w-3 h-3 mr-1" /> {tx('评估', 'Eval')}
                                          </button>
                                      </div>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          )}

          {activeTab === 'source' && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
                  <div className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-gray-500" />
                      <h3 className="font-semibold text-gray-900">{tx('复现包', 'Repro Bundle')}</h3>
                  </div>
                  {reproManifest ? (
                    <pre className="bg-gray-50 p-4 rounded-lg text-sm text-gray-700 font-mono overflow-auto border border-gray-100">
{JSON.stringify(reproManifest, null, 2)}
                    </pre>
                  ) : (
                    <div className="text-sm text-gray-500">{tx('暂无复现清单。', 'No repro manifest available yet.')}</div>
                  )}
                  {reproBundleUrl && (
                    <div>
                      <button
                        onClick={() => window.open(reproBundleUrl, '_blank', 'noreferrer')}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        {tx('下载复现包', 'Download Repro Bundle')}
                      </button>
                    </div>
                  )}
              </div>
          )}
      </div>

      {/* Save Template Modal */}
      {showSaveTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100">
                    <h2 className="text-lg font-bold text-gray-900">{tx('保存为模板', 'Save as Template')}</h2>
                    <p className="text-sm text-gray-500 mt-1">{tx('将该运行保存为可复用模板。', 'Create a reusable template from this run.')}</p>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{tx('模板名称', 'Template Name')}</label>
                        <input
                          className="w-full p-2 border border-gray-300 rounded-lg"
                          value={saveTemplateName}
                          onChange={(e) => setSaveTemplateName(e.target.value)}
                          placeholder={tx('例如：MAPPO baseline', 'e.g. MAPPO baseline')}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{tx('描述', 'Description')}</label>
                        <input
                          className="w-full p-2 border border-gray-300 rounded-lg"
                          value={saveTemplateDescription}
                          onChange={(e) => setSaveTemplateDescription(e.target.value)}
                          placeholder={tx('可选描述', 'Optional description')}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{tx('类型', 'Type')}</label>
                        <select
                          className="w-full p-2 border border-gray-300 rounded-lg"
                          value={saveTemplateType}
                          onChange={(e) => setSaveTemplateType(e.target.value as 'Single-Agent' | 'Multi-Agent')}
                        >
                          <option value="Single-Agent">{tx('单智能体', 'Single-Agent')}</option>
                          <option value="Multi-Agent">{tx('多智能体', 'Multi-Agent')}</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{tx('默认配置', 'Default Config')}</label>
                        <textarea
                          className="w-full h-40 p-3 border border-gray-300 rounded-lg font-mono text-xs"
                          value={saveTemplateConfig}
                          onChange={(e) => setSaveTemplateConfig(e.target.value)}
                        />
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                        <button onClick={() => setShowSaveTemplateModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg">{tx('取消', 'Cancel')}</button>
                        <button
                          onClick={handleSaveTemplate}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          disabled={saveTemplateSubmitting}
                        >
                          {saveTemplateSubmitting ? tx('保存中...', 'Saving...') : tx('保存模板', 'Save Template')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Register Model Modal */}
      {showRegisterModelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
                  <div className="p-6 border-b border-gray-100">
                      <h2 className="text-lg font-bold text-gray-900">{tx('注册模型', 'Register Model')}</h2>
                      <p className="text-sm text-gray-500 mt-1">{tx(`将检查点 ${selectedCkpt?.step} 晋升为受管模型版本。`, `Promote checkpoint ${selectedCkpt?.step} to a managed model version.`)}</p>
                  </div>
                  <div className="p-6 space-y-4">
                      <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-700">{tx('选择已有家族', 'Select Existing Family')}</label>
                          <select 
                              className="w-full p-2 border border-gray-300 rounded-lg"
                              value={registerModelId}
                              onChange={(e) => { setRegisterModelId(e.target.value); setRegisterNewModelName(''); }}
                              disabled={!!registerNewModelName}
                          >
                              <option value="">{tx('-- 选择模型家族 --', '-- Select Model Family --')}</option>
                              {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                      </div>
                      
                      <div className="relative flex py-2 items-center">
                          <div className="flex-grow border-t border-gray-200"></div>
                          <span className="flex-shrink-0 mx-4 text-gray-400 text-xs">{tx('或新建', 'OR CREATE NEW')}</span>
                          <div className="flex-grow border-t border-gray-200"></div>
                      </div>

                      <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-700">{tx('新家族名称', 'New Family Name')}</label>
                          <input 
                              className="w-full p-2 border border-gray-300 rounded-lg"
                              placeholder={tx('例如：Production-PPO', 'e.g. Production-PPO')}
                              value={registerNewModelName}
                              onChange={(e) => { setRegisterNewModelName(e.target.value); setRegisterModelId(''); }}
                          />
                      </div>
                      {registerNewModelName && (
                          <div>
                              <input 
                                  className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                                  placeholder={tx('描述（可选）', 'Description (optional)')}
                                  value={registerNewModelDesc}
                                  onChange={(e) => setRegisterNewModelDesc(e.target.value)}
                              />
                          </div>
                      )}

                      <div className="flex justify-end gap-3 pt-4">
                          <button onClick={() => setShowRegisterModelModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg">{tx('取消', 'Cancel')}</button>
                          <button 
                              onClick={handleRegisterModel} 
                              disabled={isRegisteringModel || (!registerModelId && !registerNewModelName)}
                              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                          >
                              {isRegisteringModel ? tx('注册中...', 'Registering...') : tx('注册', 'Register')}
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Eval Modal */}
      {showEvalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100">
                    <h2 className="text-lg font-bold text-gray-900">{tx('启动评估', 'Launch Evaluation')}</h2>
                    <p className="text-sm text-gray-500 mt-1">{tx(`评估检查点：${selectedCkpt?.step}`, `Evaluating checkpoint: ${selectedCkpt?.step}`)}</p>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{tx('评估协议', 'Eval Protocol')}</label>
                        <select 
                            className="w-full p-2 border border-gray-300 rounded-lg"
                            value={selectedProtocol}
                            onChange={(e) => setSelectedProtocol(e.target.value)}
                        >
                            {protocols.map(p => <option key={p.id} value={p.id}>{p.name} ({p.envId})</option>)}
                        </select>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-lg flex gap-3">
                         <Calculator className="w-5 h-5 text-blue-600" />
                         <p className="text-xs text-blue-700">
                             {tx(
                               `将启动 ${selectedProtocolDetail?.episodes || '--'} 个回合，覆盖 ${selectedProtocolDetail?.evalSeeds?.length || '--'} 个随机种子。`,
                               `This will launch ${selectedProtocolDetail?.episodes || '--'} episodes across ${selectedProtocolDetail?.evalSeeds?.length || '--'} seeds.`,
                             )}
                         </p>
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                        <button onClick={() => setShowEvalModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-lg">{tx('取消', 'Cancel')}</button>
                        <button onClick={handleLaunchEval} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{tx('启动任务', 'Launch Job')}</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Artifact Browser Modal (Missing implemented here) */}
      {showArtifacts && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl animate-in fade-in zoom-in duration-200 flex flex-col max-h-[80vh]">
                 <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">{tx('产物浏览器', 'Artifact Browser')}</h2>
                        <p className="text-sm text-gray-500 mt-1">{tx('本次运行生成的文件（存储于 MinIO）。', 'Files generated by this run (stored in MinIO).')}</p>
                    </div>
                    <button onClick={() => setShowArtifacts(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-500">
                            <tr>
                                <th className="px-4 py-2 font-medium">{tx('名称', 'Name')}</th>
                                <th className="px-4 py-2 font-medium">{tx('类型', 'Type')}</th>
                                <th className="px-4 py-2 font-medium">{tx('大小', 'Size')}</th>
                                <th className="px-4 py-2 font-medium">{tx('最后修改', 'Last Modified')}</th>
                                <th className="px-4 py-2"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {artifacts.map((file, idx) => (
                                <tr key={idx} className="hover:bg-gray-50 group">
                                    <td className="px-4 py-3 flex items-center gap-2">
                                        {file.type === 'folder' ? <Folder className="w-4 h-4 text-blue-500" /> : <FileText className="w-4 h-4 text-gray-400" />}
                                        <span className="font-medium text-gray-700">{file.name}</span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-500 capitalize">{file.type}</td>
                                    <td className="px-4 py-3 text-gray-500 font-mono">{file.size || '-'}</td>
                                    <td className="px-4 py-3 text-gray-500">{file.lastModified || file.createdAt || '-'}</td>
                                    <td className="px-4 py-3 text-right">
                                        {file.type === 'file' && (
                                            <button
                                              onClick={() => handleArtifactDownload(file.id)}
                                              className="text-blue-600 hover:text-blue-800 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <Download className="w-4 h-4" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <HardDrive className="w-3 h-3" />
                        <span>s3://runs/{run?.id}</span>
                    </div>
                    <button
                      onClick={handleDownloadAllArtifacts}
                      className="text-sm text-blue-600 font-medium hover:underline"
                    >
                      {tx('下载全部 (.zip)', 'Download All (.zip)')}
                    </button>
                </div>
            </div>
         </div>
      )}
    </div>
  );
};
