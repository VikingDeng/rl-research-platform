import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Project, Template, EnvSpec, Plugin, TemplateVersion, EnvVersion, Algo, AlgoVersion, EvalProtocol } from '../types';
import { ChevronRight, Layers, Box, Cpu, PlayCircle, Check, Code, Settings, Plus, GitBranch, Zap, Copy } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '../components/Toast';

const STEPS = [
  { id: 'project', title: 'Project', icon: Layers },
  { id: 'template', title: 'Template', icon: Code },
  { id: 'env', title: 'Environment', icon: Box },
  { id: 'config', title: 'Configuration', icon: Settings },
  { id: 'resources', title: 'Resources', icon: Cpu },
];

export const CreateJob: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateVersions, setTemplateVersions] = useState<TemplateVersion[]>([]);
  const [envs, setEnvs] = useState<EnvSpec[]>([]);
  const [envVersions, setEnvVersions] = useState<EnvVersion[]>([]);
  const [envVersionsEnvId, setEnvVersionsEnvId] = useState('');
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [evalProtocols, setEvalProtocols] = useState<EvalProtocol[]>([]);
  const [algoVersionIndex, setAlgoVersionIndex] = useState<
    Record<string, { algoId: string; algoName: string; version: string }>
  >({});

  // Form State
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedEnv, setSelectedEnv] = useState('');
  const [selectedEnvVersion, setSelectedEnvVersion] = useState('');
  const [selectedMap, setSelectedMap] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedTemplateVersionId, setSelectedTemplateVersionId] = useState('');
  const [configOverride, setConfigOverride] = useState('');
  const [configTouched, setConfigTouched] = useState(false);
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
  const [gpuCount, setGpuCount] = useState(1);
  const [seedCount, setSeedCount] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoEvalEnabled, setAutoEvalEnabled] = useState(false);
  const [autoEvalProtocolId, setAutoEvalProtocolId] = useState('');
  const [autoEvalTrigger, setAutoEvalTrigger] = useState('train_succeeded');
  
  // Sweep State
  const [isSweepMode, setIsSweepMode] = useState(false);
  const [sweepCombinations, setSweepCombinations] = useState(1);
  const [forkSource, setForkSource] = useState<string | null>(null);
  const [templatePrefill, setTemplatePrefill] = useState<string | null>(null);

  const resolveMapOptions = (version?: EnvVersion, env?: EnvSpec) => {
    if (version?.mapSets && version.mapSets.length > 0) {
      return version.mapSets.map(ms => ms.id);
    }
    if (env?.maps && env.maps.length > 0) {
      return env.maps;
    }
    return [];
  };

  const selectDefaultMap = (version?: EnvVersion, env?: EnvSpec) => {
    const options = resolveMapOptions(version, env);
    return options[0] ?? 'default';
  };

  const resolveDefaultConfig = (templateId: string, versionId: string) => {
    const version = templateVersions.find(v => v.id === versionId);
    if (version?.defaultConfig) return version.defaultConfig;
    const template = templates.find(t => t.id === templateId);
    return template?.defaultConfig ?? {};
  };

  useEffect(() => {
    Promise.all([api.getProjects(), api.getEnvs(), api.getPlugins(), api.getProtocols()]).then(([ps, es, pls, eps]) => {
      setProjects(ps);
      setEnvs(es);
      setPlugins(pls);
      setEvalProtocols(eps);

      const state = (location.state ?? {}) as any;
      const savedProject = localStorage.getItem('last_project_id');
      const defaultProject =
        state.projectId || (savedProject && ps.some(p => p.id === savedProject) ? savedProject : ps[0]?.id) || '';
      setSelectedProject(defaultProject);

      if (state.templateId || state.algoId) {
        setTemplatePrefill(state.templateId || state.algoId);
      }

      if (state.envId) {
        const matchedEnv = es.find(e => state.envId.includes(e.id));
        if (matchedEnv) setSelectedEnv(matchedEnv.id);
      }

      if (state.config) setConfigOverride(state.config);
      if (state.forkedFrom) setForkSource(state.forkedFrom);
    });
  }, [location.state]);

  useEffect(() => {
    api.getAlgos({ includeArchived: true }).then((algos: Algo[]) => {
      if (algos.length === 0) {
        setAlgoVersionIndex({});
        return;
      }
      Promise.all(
        algos.map(algo =>
          api.getAlgoVersions(algo.id).then((versions: AlgoVersion[]) => ({ algo, versions })),
        ),
      ).then(entries => {
        const next: Record<string, { algoId: string; algoName: string; version: string }> = {};
        entries.forEach(({ algo, versions }) => {
          versions.forEach(version => {
            next[version.id] = { algoId: algo.id, algoName: algo.name, version: version.version };
          });
        });
        setAlgoVersionIndex(next);
      });
    });
  }, []);

  useEffect(() => {
    if (selectedProject) {
      localStorage.setItem('last_project_id', selectedProject);
    }
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setTemplates([]);
      setSelectedTemplate('');
      setTemplateVersions([]);
      setSelectedTemplateVersionId('');
      return;
    }
    setSelectedTemplate('');
    setTemplateVersions([]);
    setSelectedTemplateVersionId('');
    api.getTemplates({ projectId: selectedProject }).then(ts => {
      setTemplates(ts);
      if (templatePrefill) {
        const matchedTemplate = ts.find(t => t.id === templatePrefill || t.name.includes(templatePrefill));
        if (matchedTemplate) {
          setSelectedTemplate(matchedTemplate.id);
        }
        setTemplatePrefill(null);
      }
    });
  }, [selectedProject, templatePrefill]);

  useEffect(() => {
    if (!selectedTemplate) {
      setTemplateVersions([]);
      setSelectedTemplateVersionId('');
      return;
    }
    api.getTemplateById(selectedTemplate).then(detail => {
      const versions = detail.versions || [];
      setTemplateVersions(versions);
      const sorted = [...versions].sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        if (aTime !== bTime) return bTime - aTime;
        return (b.version || '').localeCompare(a.version || '');
      });
      setSelectedTemplateVersionId(sorted[0]?.id || versions[0]?.id || '');
    });
  }, [selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate) return;
    if (forkSource) return;
    if (configTouched) return;
    const defaultConfig = resolveDefaultConfig(selectedTemplate, selectedTemplateVersionId);
    setConfigOverride(JSON.stringify(defaultConfig || {}, null, 2));
  }, [selectedTemplate, selectedTemplateVersionId, templates, templateVersions, forkSource, configTouched]);

  useEffect(() => {
    if (selectedTemplate) {
      setConfigTouched(false);
    }
  }, [selectedTemplate, selectedTemplateVersionId]);

  useEffect(() => {
    if (!selectedEnv) {
      setEnvVersions([]);
      setEnvVersionsEnvId('');
      setSelectedEnvVersion('');
      setSelectedMap('');
      return;
    }
    api.getEnvVersions(selectedEnv).then(versions => {
      const enabled = versions.filter(v => v.active !== false);
      const usable = enabled.length ? enabled : versions;
      const sorted = [...usable].sort((a, b) => (b.version || '').localeCompare(a.version || ''));
      const chosenVersion = sorted[0] || versions[0];
      const env = envs.find(e => e.id === selectedEnv);
      setEnvVersions(sorted);
      setEnvVersionsEnvId(selectedEnv);
      setSelectedEnvVersion(chosenVersion?.version || '');
      setSelectedMap(selectDefaultMap(chosenVersion, env));
    });
  }, [selectedEnv]);

  useEffect(() => {
    if (!selectedEnv || !selectedEnvVersion) return;
    const env = envs.find(e => e.id === selectedEnv);
    const version = envVersions.find(v => v.version === selectedEnvVersion);
    const options = resolveMapOptions(version, env);
    if (options.length === 0) {
      if (selectedMap !== 'default') {
        setSelectedMap('default');
      }
      return;
    }
    if (!options.includes(selectedMap)) {
      setSelectedMap(options[0]);
    }
  }, [selectedEnvVersion, envVersions, envs, selectedEnv, selectedMap]);

  // Detect sweep config
  useEffect(() => {
      try {
          const config = JSON.parse(configOverride);
          let combinations = 1;
          let foundList = false;
          
          const checkSweep = (obj: any) => {
              for (const key in obj) {
                  if (Array.isArray(obj[key]) && isSweepMode) {
                      combinations *= obj[key].length;
                      foundList = true;
                  } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                      checkSweep(obj[key]);
                  }
              }
          };
          
          if (isSweepMode) {
            checkSweep(config);
          }
          setSweepCombinations(foundList ? combinations : 1);

      } catch (e) {
          // ignore invalid json
      }
  }, [configOverride, isSweepMode]);

  const buildSweepTrainConfigs = (parsedConfig: any) => {
    const train = parsedConfig?.train && typeof parsedConfig.train === 'object' ? parsedConfig.train : {};
    const allowedSweepKeys = new Set([
      'totalEnvSteps',
      'rolloutLen',
      'batchSize',
      'lr',
      'entropyCoef',
      'gamma',
      'gaeLambda',
    ]);
    const baseTrain = {
      totalEnvSteps: Number(train?.totalEnvSteps ?? 100000),
      rolloutLen: Number(train?.rolloutLen ?? 10),
      batchSize: Number(train?.batchSize ?? 32),
      lr: Number(train?.lr ?? 0.0003),
      entropyCoef: train?.entropyCoef,
      gamma: train?.gamma,
      gaeLambda: train?.gaeLambda,
    };
    const sweepKeys = Object.keys(train).filter(
      key => allowedSweepKeys.has(key) && Array.isArray(train[key]),
    );
    if (!isSweepMode || sweepKeys.length === 0) {
      return [baseTrain];
    }
    let combos: Array<Record<string, any>> = [{}];
    sweepKeys.forEach(key => {
      const values = train[key];
      const next: Array<Record<string, any>> = [];
      combos.forEach(combo => {
        values.forEach((value: any) => {
          next.push({ ...combo, [key]: value });
        });
      });
      combos = next;
    });
    return combos.map(combo => ({
      ...baseTrain,
      ...Object.fromEntries(
        Object.entries(combo).map(([key, value]) => [key, typeof value === 'number' ? value : Number(value)]),
      ),
    }));
  };

  const handleNext = async () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(c => c + 1);
      return;
    }
    if (!selectedTemplateVersionId) {
      showToast('Template version not found. Create a version first.', 'error');
      return;
    }
    const templateVersion = templateVersions.find(v => v.id === selectedTemplateVersionId);
    if (!templateVersion?.algoVersionId) {
      showToast('Template version must be linked to an algorithm version.', 'error');
      return;
    }
    const algoInfo = algoVersionIndex[templateVersion.algoVersionId];
    if (!algoInfo) {
      showToast('Algorithm not found for this template version. Check registry.', 'error');
      return;
    }
    if (autoEvalEnabled && !autoEvalProtocolId) {
      showToast('Select an evaluation protocol for auto-eval.', 'error');
      return;
    }
    const envVersion = selectedEnvVersion || envs.find(e => e.id === selectedEnv)?.versions?.[0] || '1.0.0';
    let parsedConfig: any = {};
    try {
      parsedConfig = JSON.parse(configOverride || '{}');
    } catch {
      parsedConfig = {};
    }
    const trainConfigs = buildSweepTrainConfigs(parsedConfig);
    const plugin = selectedPlugins.length
      ? plugins.find(p => p.id === selectedPlugins[0])
      : null;
    setIsSubmitting(true);
    try {
      const seeds = Array.from({ length: seedCount }, (_, idx) => idx + 1);
      const autoEval = autoEvalEnabled && autoEvalProtocolId
        ? { protocolId: autoEvalProtocolId, triggerOn: autoEvalTrigger }
        : undefined;
      const results = [];
      for (const config of trainConfigs) {
        for (const seed of seeds) {
          const res = await api.submitTrainJob({
            projectId: selectedProject,
            templateVersionId: selectedTemplateVersionId,
            env: { envId: selectedEnv, version: envVersion, mapSet: selectedMap },
            algo: { algoId: algoInfo.algoId, algoVersionId: templateVersion.algoVersionId },
            train: config,
            resources: { gpus: gpuCount },
            seedSet: [seed],
            ...(autoEval ? { autoEval } : {}),
            ...(plugin ? { plugin: { pluginId: plugin.id, version: plugin.version } } : {}),
          });
          results.push(res);
        }
      }
      if (results.length > 1) {
        showToast(`Submitted ${results.length} jobs.`, 'success');
      }
      if (results[0]?.runId) {
        navigate(`/runs/${results[0].runId}`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      showToast(`Failed to submit job: ${detail}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => setCurrentStep(c => Math.max(0, c - 1));

  const togglePlugin = (id: string) => {
      if (selectedPlugins.includes(id)) {
          setSelectedPlugins(selectedPlugins.filter(p => p !== id));
      } else {
          setSelectedPlugins([...selectedPlugins, id]);
      }
  }

  const isStepValid = () => {
    if (currentStep === 0) return !!selectedProject;
    if (currentStep === 1) return !!selectedTemplate && !!selectedTemplateVersionId;
    if (currentStep === 2) return !!selectedEnv && !!selectedEnvVersion && !!selectedMap;
    return true;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 flex justify-between items-end">
        <div>
            <h1 className="text-2xl font-bold text-gray-900">Create New Job</h1>
            <p className="text-gray-500 mt-1">Configure and launch a new training or evaluation run.</p>
        </div>
        {forkSource && (
            <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-md text-sm font-medium border border-blue-200 flex items-center animate-in fade-in">
                <Copy className="w-3 h-3 mr-2" />
                Cloning from {forkSource}
            </div>
        )}
      </div>

      {/* Stepper */}
      <div className="flex items-center justify-between mb-8 relative px-4">
        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-200 -z-10 rounded"></div>
        {STEPS.map((step, idx) => {
          const isActive = idx === currentStep;
          const isCompleted = idx < currentStep;
          const Icon = step.icon;
          return (
            <div key={step.id} className="flex flex-col items-center bg-gray-50 px-2 min-w-[80px]">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                isActive ? 'border-blue-600 bg-blue-600 text-white shadow-md scale-110' :
                isCompleted ? 'border-green-500 bg-green-500 text-white' :
                'border-gray-300 bg-white text-gray-400'
              }`}>
                {isCompleted ? <Check className="w-6 h-6" /> : <Icon className="w-5 h-5" />}
              </div>
              <span className={`text-xs font-semibold mt-2 ${isActive ? 'text-blue-700' : 'text-gray-500'}`}>
                {step.title}
              </span>
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 min-h-[400px]">
        {currentStep === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Select Project</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map(p => (
                <div 
                  key={p.id}
                  onClick={() => setSelectedProject(p.id)}
                  className={`p-4 rounded-lg border cursor-pointer hover:shadow-md transition-all ${
                    selectedProject === p.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between">
                    <h3 className="font-medium text-gray-900">{p.name}</h3>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{p.activeRuns} active runs</span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    {p.tags.map(t => <span key={t} className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">#{t}</span>)}
                  </div>
                </div>
              ))}
              <div className="p-4 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 cursor-pointer hover:border-blue-400 hover:text-blue-500">
                <div className="text-center">
                    <Plus className="w-6 h-6 mx-auto mb-1"/>
                    <span className="text-sm font-medium">Create New Project</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 1 && (
            <div className="space-y-4">
                <h2 className="text-lg font-semibold">Select Template</h2>
                <div className="grid grid-cols-1 gap-3">
                    {templates.map(t => (
                        <div 
                            key={t.id}
                            onClick={() => setSelectedTemplate(t.id)}
                            className={`p-4 rounded-lg border cursor-pointer hover:shadow-sm flex items-center justify-between transition-all ${
                                selectedTemplate === t.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200'
                            }`}
                        >
                            <div>
                                <h3 className="font-medium text-gray-900">{t.name}</h3>
                                <p className="text-sm text-gray-500 mt-1">{t.description}</p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs font-bold ${t.type === 'Multi-Agent' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                                {t.type}
                            </span>
                        </div>
                    ))}
                    {templates.length === 0 && (
                      <div className="p-4 rounded-lg border border-dashed border-gray-200 text-sm text-gray-500">
                        No templates found for this project. Create one in the Template Library.
                      </div>
                    )}
                </div>
                {selectedTemplate && (
                  <div className="space-y-3 pt-4 border-t border-gray-100">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Template Version</label>
                      <select
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={selectedTemplateVersionId}
                        onChange={(e) => setSelectedTemplateVersionId(e.target.value)}
                      >
                        <option value="">-- Select Version --</option>
                        {templateVersions.map(v => (
                          <option key={v.id} value={v.id}>
                            v{v.version} ({v.id.slice(0, 8)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="text-xs text-gray-500">
                      {(() => {
                        const version = templateVersions.find(v => v.id === selectedTemplateVersionId);
                        if (!version?.algoVersionId) {
                          return 'No algorithm linked to this template version.';
                        }
                        const algoInfo = algoVersionIndex[version.algoVersionId];
                        if (!algoInfo) {
                          return `Algo version ${version.algoVersionId.slice(0, 8)} not found in registry.`;
                        }
                        return `Linked algorithm: ${algoInfo.algoName} (v${algoInfo.version})`;
                      })()}
                    </div>
                  </div>
                )}
            </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-6">
            <div className="space-y-2">
                <h2 className="text-lg font-semibold">Select Environment</h2>
                <select 
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={selectedEnv}
                    onChange={(e) => setSelectedEnv(e.target.value)}
                >
                    <option value="">-- Select Env --</option>
                    {envs.map(e => <option key={e.id} value={e.id}>{e.id} ({e.versions[0]})</option>)}
                </select>
            </div>
            
            {selectedEnv && (
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold">Select Version</h2>
                    <select
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={selectedEnvVersion}
                        onChange={(e) => setSelectedEnvVersion(e.target.value)}
                    >
                        <option value="">-- Select Version --</option>
                        {envVersionsEnvId === selectedEnv && envVersions.map(v => (
                            <option key={v.version} value={v.version}>{v.version} ({v.apiMode})</option>
                        ))}
                    </select>
                </div>
            )}

            {selectedEnv && selectedEnvVersion && (
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold">Select Map / Scenario</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {resolveMapOptions(
                          envVersions.find(v => v.version === selectedEnvVersion),
                          envs.find(e => e.id === selectedEnv),
                        ).length > 0 ? (
                          resolveMapOptions(
                            envVersions.find(v => v.version === selectedEnvVersion),
                            envs.find(e => e.id === selectedEnv),
                          ).map(option => (
                            <div
                              key={option}
                              onClick={() => setSelectedMap(option)}
                              className={`px-4 py-3 rounded-lg border text-sm font-medium cursor-pointer text-center ${
                                selectedMap === option ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                              }`}
                            >
                              {option}
                            </div>
                          ))
                        ) : (
                          <div
                            onClick={() => setSelectedMap('default')}
                            className={`px-4 py-3 rounded-lg border text-sm font-medium cursor-pointer text-center ${
                              selectedMap === 'default' ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            default
                          </div>
                        )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {resolveMapOptions(
                        envVersions.find(v => v.version === selectedEnvVersion),
                        envs.find(e => e.id === selectedEnv),
                      ).length > 0
                        ? 'Select a predefined map set.'
                        : 'No map sets registered; using default.'}
                    </p>
                </div>
            )}
          </div>
        )}

        {currentStep === 3 && (
            <div className="space-y-6 h-full flex flex-col">
                {/* Sweep Mode Toggle */}
                <div className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <span className="text-sm font-medium text-gray-700">Job Mode:</span>
                    <div className="flex bg-white rounded-md border border-gray-300 p-1">
                        <button 
                            onClick={() => { setIsSweepMode(false); setConfigOverride(configOverride.replace(/\[|\]/g, '')); setConfigTouched(true); }} // quick dirty reset
                            className={`px-3 py-1 text-xs font-medium rounded ${!isSweepMode ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            Single Run
                        </button>
                        <button 
                            onClick={() => setIsSweepMode(true)}
                            className={`px-3 py-1 text-xs font-medium rounded flex items-center ${isSweepMode ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            <GitBranch className="w-3 h-3 mr-1" />
                            Hyperparameter Sweep
                        </button>
                    </div>
                    {isSweepMode && (
                        <span className="text-xs text-purple-600 flex items-center">
                            <Zap className="w-3 h-3 mr-1" /> Detected: <strong>{sweepCombinations}</strong> combinations
                        </span>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
                    {/* Params Editor */}
                    <div className="flex flex-col h-full">
                        <h3 className="text-sm font-bold text-gray-700 mb-2">Hyperparameter Overrides</h3>
                        <div className="relative flex-1">
                            <textarea 
                                value={configOverride}
                                onChange={(e) => { setConfigOverride(e.target.value); setConfigTouched(true); }}
                                className={`w-full h-64 lg:h-full p-4 font-mono text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none ${
                                    isSweepMode ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-300'
                                }`}
                                spellCheck={false}
                            />
                            <span className="absolute top-2 right-2 text-xs text-gray-400 bg-white px-2 py-1 rounded border border-gray-200">JSON</span>
                        </div>
                         <p className="text-xs text-gray-500 mt-2">
                             {isSweepMode 
                                ? "Sweep Mode: Use arrays for parameters you want to sweep. E.g., \"lr\": [0.001, 0.0005]" 
                                : "Modify the default parameters for this specific run."}
                         </p>
                    </div>

                    {/* Plugins */}
                    <div>
                        <h3 className="text-sm font-bold text-gray-700 mb-2">Enable Plugins</h3>
                        <div className="space-y-2 max-h-[300px] overflow-y-auto border border-gray-200 rounded-lg p-2 bg-white">
                            {plugins.map(p => (
                                <div 
                                    key={p.id}
                                    onClick={() => togglePlugin(p.id)}
                                    className={`p-3 rounded-lg border cursor-pointer flex items-start gap-3 transition-colors ${
                                        selectedPlugins.includes(p.id) ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${
                                        selectedPlugins.includes(p.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                                    }`}>
                                        {selectedPlugins.includes(p.id) && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-gray-900">{p.name} <span className="text-gray-400 font-normal text-xs">v{p.version}</span></div>
                                        <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>
                                    </div>
                                </div>
                            ))}
                            {plugins.length === 0 && <div className="p-4 text-center text-sm text-gray-500">No plugins installed.</div>}
                        </div>
                    </div>
                </div>
                <div className="border-t border-gray-100 pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-bold text-gray-700">Auto Evaluation</h3>
                            <p className="text-xs text-gray-500">Trigger evaluation after training succeeds.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAutoEvalEnabled(!autoEvalEnabled)}
                          className={`px-3 py-1 text-xs rounded-full border ${
                            autoEvalEnabled ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'
                          }`}
                        >
                          {autoEvalEnabled ? 'Enabled' : 'Disabled'}
                        </button>
                    </div>
                    {autoEvalEnabled && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Protocol</label>
                          <select
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={autoEvalProtocolId}
                            onChange={(e) => setAutoEvalProtocolId(e.target.value)}
                          >
                            <option value="">Select protocol</option>
                            {evalProtocols.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} (v{p.version})
                              </option>
                            ))}
                          </select>
                          {evalProtocols.length === 0 && (
                            <p className="text-xs text-gray-500 mt-1">No protocols available. Create one in Eval Protocols.</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Trigger</label>
                          <select
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={autoEvalTrigger}
                            onChange={(e) => setAutoEvalTrigger(e.target.value)}
                          >
                            <option value="train_succeeded">On Train Success</option>
                          </select>
                        </div>
                      </div>
                    )}
                </div>
            </div>
        )}

        {currentStep === 4 && (
            <div className="space-y-6">
                <h2 className="text-lg font-semibold">Resource Allocation</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-gray-700">GPU Resources (per trial)</label>
                        <div className="flex gap-4">
                            {[0, 1, 2, 4].map(g => (
                                <button
                                    key={g}
                                    onClick={() => setGpuCount(g)}
                                    className={`w-16 h-12 rounded-lg border font-bold flex items-center justify-center ${
                                        gpuCount === g ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-600'
                                    }`}
                                >
                                    {g} GPU
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-gray-500">Current Cluster load allows up to 4 GPUs immediately.</p>
                    </div>

                    <div className="space-y-4">
                         <label className="block text-sm font-medium text-gray-700">Random Seeds</label>
                         <input 
                            type="number" 
                            value={seedCount}
                            onChange={(e) => setSeedCount(parseInt(e.target.value))}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min={1}
                            max={10}
                        />
                         <p className="text-xs text-gray-500">Will launch {seedCount} trials for each configuration.</p>
                    </div>
                </div>

                <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h3 className="text-sm font-bold text-gray-900 mb-2">Job Summary</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                        <li>Project: <span className="font-mono text-gray-900">{projects.find(p => p.id === selectedProject)?.name}</span></li>
                        <li>Environment: <span className="font-mono text-gray-900">{selectedEnv} / {selectedEnvVersion} / {selectedMap}</span></li>
                        <li>Template: <span className="font-mono text-gray-900">{templates.find(t => t.id === selectedTemplate)?.name}</span></li>
                        <li>Template Version: <span className="font-mono text-gray-900">{templateVersions.find(v => v.id === selectedTemplateVersionId)?.version || '-'}</span></li>
                        <li>Algorithm: <span className="font-mono text-gray-900">
                          {(() => {
                            const version = templateVersions.find(v => v.id === selectedTemplateVersionId);
                            if (!version?.algoVersionId) return '-';
                            const info = algoVersionIndex[version.algoVersionId];
                            if (!info) return version.algoVersionId;
                            return `${info.algoName} (v${info.version})`;
                          })()}
                        </span></li>
                        <li>Auto Eval: <span className="font-mono text-gray-900">
                          {autoEvalEnabled
                            ? evalProtocols.find(p => p.id === autoEvalProtocolId)?.name || autoEvalProtocolId || 'Enabled'
                            : 'Off'}
                        </span></li>
                        <li>Job Type: <span className={`font-bold ${isSweepMode ? 'text-purple-600' : 'text-gray-900'}`}>{isSweepMode ? 'Hyperparameter Sweep' : 'Single Run'}</span></li>
                        <li>Total Jobs: <span className="font-bold text-gray-900">
                            {sweepCombinations} Configs × {seedCount} Seeds = {sweepCombinations * seedCount} Trials
                        </span></li>
                        <li>Est. Compute: <span className="font-mono text-gray-900">{(sweepCombinations * seedCount * gpuCount)} GPUs requested</span></li>
                    </ul>
                </div>
            </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="mt-6 flex justify-between">
        <button 
            onClick={handleBack}
            disabled={currentStep === 0}
            className="px-6 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 font-medium disabled:opacity-50 hover:bg-gray-50"
        >
            Back
        </button>
        <button 
            onClick={handleNext}
            disabled={!isStepValid() || isSubmitting}
            className="px-6 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {currentStep === STEPS.length - 1 ? (
                <>
                    <PlayCircle className="w-5 h-5 mr-2" />
                    {isSubmitting ? 'Submitting...' : 'Launch Job'}
                </>
            ) : (
                <>
                    Next <ChevronRight className="w-5 h-5 ml-1" />
                </>
            )}
        </button>
      </div>
    </div>
  );
};
