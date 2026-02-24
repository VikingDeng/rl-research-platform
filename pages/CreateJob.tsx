import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { Project, EnvSpec, Algo, AlgoVersion, Template, TemplateVersion, EnvVersion, Plugin, EvalProtocol } from '../types';
import { Play, Settings, Cpu, ChevronRight, GitFork, Info, Layers, Code, Box, Check, GitBranch, Zap, PlayCircle, Copy, Plus, Database } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useI18n } from '../services/i18n';

const BASE_STEPS = [
  { id: 'project', title: 'Project', icon: Layers },
  { id: 'template', title: 'Template', icon: Code },
  { id: 'env', title: 'Environment', icon: Box },
  { id: 'config', title: 'Configuration', icon: Settings },
  { id: 'resources', title: 'Resources', icon: Cpu },
] as const;

const isSystemTemplate = (tmpl: Template) => tmpl.name === 'Quick Run';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mergeDeep = (base: any, override: any): any => {
  if (!isPlainObject(base)) return isPlainObject(override) ? { ...override } : override ?? base;
  const result: Record<string, any> = { ...base };
  if (!isPlainObject(override)) return result;
  Object.entries(override).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeDeep(result[key], value);
    } else {
      result[key] = value;
    }
  });
  return result;
};

const parseArrayInput = (value: any) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to comma parsing
  }
  return trimmed
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .map(item => {
      const numeric = Number(item);
      return Number.isNaN(numeric) ? item : numeric;
    });
};

const DEFAULT_TRAIN_FIELDS = [
  { key: 'totalEnvSteps', label: 'Total Env Steps', type: 'number' },
  { key: 'rolloutLen', label: 'Rollout Length', type: 'number' },
  { key: 'batchSize', label: 'Batch Size', type: 'number' },
  { key: 'lr', label: 'Learning Rate', type: 'number' },
  { key: 'entropyCoef', label: 'Entropy Coef', type: 'number' },
  { key: 'gamma', label: 'Gamma', type: 'number' },
  { key: 'gaeLambda', label: 'GAE Lambda', type: 'number' },
] as const;

const DEFAULT_NETWORK_FIELDS = [
  { key: 'hidden', label: 'Hidden Layers', type: 'array' },
  { key: 'activation', label: 'Activation', type: 'string', options: ['tanh', 'relu', 'gelu', 'elu', 'leaky_relu'] },
] as const;

const DEFAULT_ENV_FIELDS = [
  { key: 'maxCycles', label: 'Max Cycles', type: 'number' },
  { key: 'continuousActions', label: 'Continuous Actions', type: 'boolean' },
] as const;

const extractSectionFieldSpecs = (
  schema: Record<string, unknown> | undefined,
  sectionKey: string,
  fallback: Array<{ key: string; label: string; type: string }>,
) => {
  if (!schema || !isPlainObject(schema)) return [...fallback];
  const sectionSchema = isPlainObject((schema as any).properties?.[sectionKey])
    ? (schema as any).properties[sectionKey]
    : null;
  const sectionProps = isPlainObject(sectionSchema?.properties) ? sectionSchema?.properties : null;
  if (!sectionProps) return [...fallback];
  const specs = Object.entries(sectionProps).map(([key, spec]) => {
    const resolved = isPlainObject(spec) ? spec : {};
    const type = typeof resolved.type === 'string' ? resolved.type : 'string';
    const label = typeof resolved.title === 'string' ? resolved.title : key;
    const options = Array.isArray(resolved.enum) ? resolved.enum : undefined;
    return { key, label, type, options };
  });
  return specs.length > 0 ? specs : [...fallback];
};

const validateAgainstSchema = (schema: any, value: any, path = ''): string[] => {
  if (!schema || !isPlainObject(schema)) return [];
  const errors: string[] = [];

  const pushError = (message: string) => {
    if (errors.length < 8) errors.push(message);
  };

  const expectedType = schema.type;
  if (expectedType) {
    const typeOk =
      (expectedType === 'object' && isPlainObject(value)) ||
      (expectedType === 'array' && Array.isArray(value)) ||
      (expectedType === 'string' && typeof value === 'string') ||
      (expectedType === 'number' && typeof value === 'number') ||
      (expectedType === 'integer' && Number.isInteger(value)) ||
      (expectedType === 'boolean' && typeof value === 'boolean');
    if (!typeOk) {
      pushError(`${path || 'config'}: expected ${expectedType}`);
      return errors;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    pushError(`${path || 'config'}: must be one of ${schema.enum.join(', ')}`);
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      pushError(`${path || 'config'}: must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      pushError(`${path || 'config'}: must be <= ${schema.maximum}`);
    }
  }

  if (isPlainObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    required.forEach((key: string) => {
      if (value[key] === undefined) {
        pushError(`${path ? `${path}.` : ''}${key}: required`);
      }
    });
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    Object.entries(properties).forEach(([key, subschema]) => {
      if (value[key] !== undefined) {
        errors.push(
          ...validateAgainstSchema(
            subschema,
            value[key],
            path ? `${path}.${key}` : key,
          ),
        );
      }
    });
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, idx) => {
      errors.push(...validateAgainstSchema(schema.items, item, `${path}[${idx}]`));
    });
  }

  return errors;
};

type DatasetRecord = {
  id: string;
  name: string;
  format: string;
  path: string;
  createdAt: string;
};

export const CreateJob: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { t, tx } = useI18n();
  const [currentStep, setCurrentStep] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateVersions, setTemplateVersions] = useState<TemplateVersion[]>([]);
  const [envs, setEnvs] = useState<EnvSpec[]>([]);
  const [envVersions, setEnvVersions] = useState<EnvVersion[]>([]);
  const [envVersionsEnvId, setEnvVersionsEnvId] = useState('');
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [evalProtocols, setEvalProtocols] = useState<EvalProtocol[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [algos, setAlgos] = useState<Algo[]>([]);
  const [algoVersions, setAlgoVersions] = useState<Record<string, AlgoVersion[]>>({});
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
  const [launchMode, setLaunchMode] = useState<'template' | 'quick'>('template');
  const [selectedAlgoId, setSelectedAlgoId] = useState('');
  const [selectedAlgoVersionId, setSelectedAlgoVersionId] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [configOverride, setConfigOverride] = useState('');
  const [parsedOverride, setParsedOverride] = useState<Record<string, any>>({});
  const [configParseError, setConfigParseError] = useState<string | null>(null);
  const [configSchemaErrors, setConfigSchemaErrors] = useState<string[]>([]);
  const [configTouched, setConfigTouched] = useState(false);
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
  const [gpuCount, setGpuCount] = useState(1);
  const [priority, setPriority] = useState(2);
  const [timeoutSec, setTimeoutSec] = useState(0);
  const [seedCount, setSeedCount] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoEvalEnabled, setAutoEvalEnabled] = useState(false);
  const [autoEvalProtocolId, setAutoEvalProtocolId] = useState('');
  const [autoEvalTrigger, setAutoEvalTrigger] = useState('train_succeeded');
  
  // Data Collection
  const [enableDataCollection, setEnableDataCollection] = useState(false);
  
  // Sweep State
  const [isSweepMode, setIsSweepMode] = useState(false);
  const [sweepCombinations, setSweepCombinations] = useState(1);
  const [forkSource, setForkSource] = useState<string | null>(null);
  const [templatePrefill, setTemplatePrefill] = useState<string | null>(null);
  
  // Git State
  const [useGit, setUseGit] = useState(false);
  const [gitBranch, setGitBranch] = useState('main');
  const [gitCommit, setGitCommit] = useState('');
  const visibleTemplates = templates.filter(t => !isSystemTemplate(t));

  const steps = useMemo(() => {
    const next = BASE_STEPS.map(step => ({ ...step, title: t(`createJob.step.${step.id}`, step.title) }));
    if (launchMode === 'quick') {
      next[1] = { ...next[1], title: t('createJob.step.algorithm', 'Algorithm'), icon: Play };
    }
    return next;
  }, [launchMode, t]);

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

  const resolveTemplateDefaultConfig = (templateId: string, versionId: string) => {
    const version = templateVersions.find(v => v.id === versionId);
    if (version?.defaultConfig) return version.defaultConfig;
    const template = templates.find(t => t.id === templateId);
    return template?.defaultConfig ?? {};
  };

  const resolveAlgoDefaultConfig = (algoId: string, algoVersionId: string) => {
    const versions = algoVersions[algoId] || [];
    const version = versions.find(v => v.id === algoVersionId);
    return version?.defaultConfig ?? {};
  };

  useEffect(() => {
    Promise.all([api.getProjects(), api.getEnvs(), api.getPlugins(), api.getProtocols(), api.getDatasets()]).then(([ps, es, pls, eps, ds]) => {
      setProjects(ps);
      setEnvs(es);
      setPlugins(pls);
      setEvalProtocols(eps);
      setDatasets((ds as DatasetRecord[]) || []);

      const state = (location.state ?? {}) as any;
      const savedProject = localStorage.getItem('last_project_id');
      const defaultProject =
        state.projectId || (savedProject && ps.some(p => p.id === savedProject) ? savedProject : ps[0]?.id) || '';
      setSelectedProject(defaultProject);

      if (state.templateId) {
        setTemplatePrefill(state.templateId);
      }
      if (state.algoId) {
        setLaunchMode('quick');
        setSelectedAlgoId(state.algoId);
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
    api.getAlgos({ includeArchived: true }).then((items: Algo[]) => {
      setAlgos(items);
      if (items.length === 0) {
        setAlgoVersionIndex({});
        setAlgoVersions({});
        return;
      }
      Promise.all(
        items.map(algo =>
          api.getAlgoVersions(algo.id).then((versions: AlgoVersion[]) => ({ algo, versions })),
        ),
      ).then(entries => {
        const nextIndex: Record<string, { algoId: string; algoName: string; version: string }> = {};
        const nextVersions: Record<string, AlgoVersion[]> = {};
        entries.forEach(({ algo, versions }) => {
          nextVersions[algo.id] = versions;
          versions.forEach(version => {
            nextIndex[version.id] = { algoId: algo.id, algoName: algo.name, version: version.version };
          });
        });
        setAlgoVersionIndex(nextIndex);
        setAlgoVersions(nextVersions);
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
    if (!selectedAlgoId) {
      setSelectedAlgoVersionId('');
      return;
    }
    const versions = algoVersions[selectedAlgoId] || [];
    const sorted = [...versions].sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
      if (aTime !== bTime) return bTime - aTime;
      return (b.version || '').localeCompare(a.version || '');
    });
    setSelectedAlgoVersionId(sorted[0]?.id || '');
  }, [selectedAlgoId, algoVersions]);

  const algoVersionById = useMemo(() => {
    const map = new Map<string, AlgoVersion>();
    Object.values(algoVersions).forEach(list => {
      list.forEach(version => map.set(version.id, version));
    });
    return map;
  }, [algoVersions]);

  const activeAlgoVersion = useMemo(() => {
    if (launchMode === 'quick') {
      return algoVersionById.get(selectedAlgoVersionId) || null;
    }
    const templateVersion = templateVersions.find(v => v.id === selectedTemplateVersionId);
    if (!templateVersion?.algoVersionId) return null;
    return algoVersionById.get(templateVersion.algoVersionId) || null;
  }, [launchMode, selectedAlgoVersionId, selectedTemplateVersionId, templateVersions, algoVersionById]);

  const activeEnvVersion = useMemo(
    () => envVersions.find(v => v.version === selectedEnvVersion) || null,
    [envVersions, selectedEnvVersion],
  );

  const baseConfig = useMemo(() => {
    if (launchMode === 'template') {
      if (!selectedTemplate || !selectedTemplateVersionId) return {};
      return resolveTemplateDefaultConfig(selectedTemplate, selectedTemplateVersionId);
    }
    if (!selectedAlgoId || !selectedAlgoVersionId) return {};
    return resolveAlgoDefaultConfig(selectedAlgoId, selectedAlgoVersionId);
  }, [launchMode, selectedTemplate, selectedTemplateVersionId, selectedAlgoId, selectedAlgoVersionId, templates, templateVersions, algoVersions]);

  const resolvedConfig = useMemo(() => mergeDeep(baseConfig || {}, parsedOverride || {}), [baseConfig, parsedOverride]);

  const trainFieldSpecs = useMemo(
    () => extractSectionFieldSpecs(activeAlgoVersion?.configSchema as Record<string, unknown> | undefined, 'train', DEFAULT_TRAIN_FIELDS as any),
    [activeAlgoVersion],
  );

  const algoFieldSpecs = useMemo(
    () => extractSectionFieldSpecs(activeAlgoVersion?.configSchema as Record<string, unknown> | undefined, 'algo', []),
    [activeAlgoVersion],
  );

  const networkFieldSpecs = useMemo(
    () => extractSectionFieldSpecs(activeAlgoVersion?.configSchema as Record<string, unknown> | undefined, 'network', DEFAULT_NETWORK_FIELDS as any),
    [activeAlgoVersion],
  );

  const envFieldSpecs = useMemo(
    () =>
      extractSectionFieldSpecs(
        activeAlgoVersion?.configSchema as Record<string, unknown> | undefined,
        'env',
        (activeEnvVersion?.apiMode === 'pettingzoo' ? DEFAULT_ENV_FIELDS : []) as any,
      ),
    [activeAlgoVersion, activeEnvVersion],
  );

  useEffect(() => {
    if (forkSource) return;
    if (configTouched) return;
    if (launchMode === 'template') {
      if (!selectedTemplate) return;
      const defaultConfig = resolveTemplateDefaultConfig(selectedTemplate, selectedTemplateVersionId);
      setConfigOverride(JSON.stringify(defaultConfig || {}, null, 2));
      return;
    }
    if (!selectedAlgoId || !selectedAlgoVersionId) return;
    const defaultConfig = resolveAlgoDefaultConfig(selectedAlgoId, selectedAlgoVersionId);
    setConfigOverride(JSON.stringify(defaultConfig || {}, null, 2));
  }, [
    launchMode,
    selectedTemplate,
    selectedTemplateVersionId,
    selectedAlgoId,
    selectedAlgoVersionId,
    templates,
    templateVersions,
    algoVersions,
    forkSource,
    configTouched,
  ]);

  useEffect(() => {
    if (!configOverride || configOverride.trim().length === 0) {
      setParsedOverride({});
      setConfigParseError(null);
      return;
    }
    try {
      const parsed = JSON.parse(configOverride);
      setParsedOverride(isPlainObject(parsed) ? parsed : {});
      setConfigParseError(null);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Invalid JSON';
      setParsedOverride({});
      setConfigParseError(detail);
    }
  }, [configOverride]);

  useEffect(() => {
    const datasetId = (parsedOverride as any)?.datasetId;
    if (datasetId && datasetId !== selectedDatasetId) {
      setSelectedDatasetId(datasetId);
    }
    if (!datasetId && selectedDatasetId) {
      setSelectedDatasetId('');
    }
  }, [parsedOverride, selectedDatasetId]);

  useEffect(() => {
    if (configParseError) {
      setConfigSchemaErrors([]);
      return;
    }
    const schema = activeAlgoVersion?.configSchema;
    if (!schema || !isPlainObject(schema) || Object.keys(schema).length === 0) {
      setConfigSchemaErrors([]);
      return;
    }
    const errors = validateAgainstSchema(schema, resolvedConfig);
    setConfigSchemaErrors(errors);
  }, [activeAlgoVersion, resolvedConfig, configParseError]);

  useEffect(() => {
    if (launchMode === 'template' && selectedTemplate) {
      setConfigTouched(false);
    }
    if (launchMode === 'quick' && selectedAlgoVersionId) {
      setConfigTouched(false);
    }
  }, [launchMode, selectedTemplate, selectedTemplateVersionId, selectedAlgoVersionId]);

  useEffect(() => {
    if (launchMode !== 'template') return;
    if (!selectedTemplate) return;
    const tmpl = templates.find(t => t.id === selectedTemplate);
    if (tmpl && isSystemTemplate(tmpl)) {
      setSelectedTemplate('');
      setSelectedTemplateVersionId('');
    }
  }, [launchMode, selectedTemplate, templates]);

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
      const config = parsedOverride || {};
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
  }, [parsedOverride, isSweepMode]);

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
    const extraTrain = Object.fromEntries(
      Object.entries(train).filter(([key]) => !allowedSweepKeys.has(key)),
    );
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
      return [{ ...baseTrain, ...extraTrain }];
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
      ...extraTrain,
      ...Object.fromEntries(
        Object.entries(combo).map(([key, value]) => [key, typeof value === 'number' ? value : Number(value)]),
      ),
    }));
  };

  const ensureQuickRunTemplateVersion = async (algoVersion: AlgoVersion) => {
    if (!selectedProject) {
      throw new Error('Select a project first.');
    }
    let quickTemplate = templates.find(t => t.name === 'Quick Run');
    if (!quickTemplate) {
      quickTemplate = await api.createTemplate(selectedProject, {
        name: 'Quick Run',
        description: 'Auto-generated template for quick runs.',
        type: 'Multi-Agent',
        defaultConfig: algoVersion.defaultConfig || {},
      });
      setTemplates(prev => [quickTemplate!, ...prev]);
    }
    const detail = await api.getTemplateById(quickTemplate.id);
    const existing = (detail.versions || []).find(v => v.algoVersionId === algoVersion.id);
    if (existing) return existing.id;
    const versionLabel = `quick-${algoVersion.version}`;
    const created = await api.createTemplateVersion(quickTemplate.id, {
      version: versionLabel,
      algoVersionId: algoVersion.id,
      defaultConfig: algoVersion.defaultConfig || {},
    });
    return created.id;
  };

  const updateConfigOverride = (updater: (draft: Record<string, any>) => Record<string, any>) => {
    let current: Record<string, any> = {};
    try {
      current = JSON.parse(configOverride || '{}');
    } catch {
      current = {};
    }
    const next = updater(current) || current;
    setConfigOverride(JSON.stringify(next, null, 2));
    setConfigTouched(true);
  };

  const updateDatasetOverride = (datasetId: string) => {
    updateConfigOverride(current => {
      const next = { ...current };
      if (!datasetId) {
        delete next.datasetId;
        return next;
      }
      next.datasetId = datasetId;
      return next;
    });
  };

  const updateTrainOverride = (key: string, value: any, type?: string) => {
    updateConfigOverride(current => {
      const next = { ...current };
      if (!isPlainObject(next.train)) {
        next.train = {};
      }
      if (value === '' || value === null || value === undefined) {
        delete next.train[key];
        return next;
      }
      if (type === 'number' || type === 'integer') {
        const numeric = Number(value);
        next.train[key] = Number.isNaN(numeric) ? value : numeric;
      } else if (type === 'boolean') {
        next.train[key] = Boolean(value);
      } else if (type === 'array') {
        next.train[key] = parseArrayInput(value);
      } else {
        next.train[key] = value;
      }
      return next;
    });
  };

  const updateAlgoOverride = (key: string, value: any, type?: string) => {
    updateConfigOverride(current => {
      const next = { ...current };
      if (!isPlainObject(next.algo)) {
        next.algo = {};
      }
      if (value === '' || value === null || value === undefined) {
        delete next.algo[key];
        return next;
      }
      if (type === 'number' || type === 'integer') {
        const numeric = Number(value);
        next.algo[key] = Number.isNaN(numeric) ? value : numeric;
      } else if (type === 'boolean') {
        next.algo[key] = Boolean(value);
      } else if (type === 'array') {
        next.algo[key] = parseArrayInput(value);
      } else {
        next.algo[key] = value;
      }
      return next;
    });
  };

  const updateNetworkOverride = (key: string, value: any, type?: string) => {
    updateConfigOverride(current => {
      const next = { ...current };
      if (!isPlainObject(next.network)) {
        next.network = {};
      }
      if (value === '' || value === null || value === undefined) {
        delete next.network[key];
        return next;
      }
      if (type === 'number' || type === 'integer') {
        const numeric = Number(value);
        next.network[key] = Number.isNaN(numeric) ? value : numeric;
      } else if (type === 'boolean') {
        next.network[key] = Boolean(value);
      } else if (type === 'array') {
        next.network[key] = parseArrayInput(value);
      } else {
        next.network[key] = value;
      }
      return next;
    });
  };

  const updateEnvOverride = (key: string, value: any, type?: string) => {
    updateConfigOverride(current => {
      const next = { ...current };
      if (!isPlainObject(next.env)) {
        next.env = {};
      }
      if (value === '' || value === null || value === undefined) {
        delete next.env[key];
        return next;
      }
      if (type === 'number' || type === 'integer') {
        const numeric = Number(value);
        next.env[key] = Number.isNaN(numeric) ? value : numeric;
      } else if (type === 'boolean') {
        next.env[key] = Boolean(value);
      } else if (type === 'array') {
        next.env[key] = parseArrayInput(value);
      } else {
        next.env[key] = value;
      }
      return next;
    });
  };

  const handleNext = async () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(c => c + 1);
      return;
    }
    let templateVersionId = selectedTemplateVersionId;
    let algoVersionId: string | undefined;
    let algoInfo = null as null | { algoId: string; algoName: string; version: string };
    let templateVersion: TemplateVersion | null = null;
    if (launchMode === 'template') {
      if (!selectedTemplateVersionId) {
        showToast('Template version not found. Create a version first.', 'error');
        return;
      }
      templateVersion = templateVersions.find(v => v.id === selectedTemplateVersionId) || null;
      if (!templateVersion?.algoVersionId) {
        showToast('Template version must be linked to an algorithm version.', 'error');
        return;
      }
      algoVersionId = templateVersion.algoVersionId;
      algoInfo = algoVersionIndex[templateVersion.algoVersionId];
      if (!algoInfo) {
        showToast('Algorithm not found for this template version. Check registry.', 'error');
        return;
      }
    } else {
      if (!selectedAlgoId || !selectedAlgoVersionId) {
        showToast('Select an algorithm and version to continue.', 'error');
        return;
      }
      const versions = algoVersions[selectedAlgoId] || [];
      const algoVersion = versions.find(v => v.id === selectedAlgoVersionId);
      if (!algoVersion) {
        showToast('Algorithm version not found. Check registry.', 'error');
        return;
      }
      try {
        templateVersionId = await ensureQuickRunTemplateVersion(algoVersion);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(`Failed to prepare quick run template: ${detail}`, 'error');
        return;
      }
      algoVersionId = algoVersion.id;
      algoInfo = { algoId: algoVersion.algoId, algoName: algos.find(a => a.id === algoVersion.algoId)?.name || algoVersion.algoId, version: algoVersion.version };
    }
    if (autoEvalEnabled && !autoEvalProtocolId) {
      showToast('Select an evaluation protocol for auto-eval.', 'error');
      return;
    }
    const envVersion = selectedEnvVersion || envs.find(e => e.id === selectedEnv)?.versions?.[0] || '1.0.0';
    const parsedConfig: any = parsedOverride || {};
    const trainConfigs = buildSweepTrainConfigs(parsedConfig);
    const plugin = selectedPlugins.length
      ? plugins.find(p => p.id === selectedPlugins[0])
      : null;
    
    // Inject Data Collection config if enabled
    if (enableDataCollection) {
        trainConfigs.forEach(cfg => {
            cfg.saveReplayBuffer = true;
        });
    }
    
    // Extract algo overrides
    const algoOverride = parsedConfig?.algo && typeof parsedConfig.algo === 'object' ? parsedConfig.algo : {};
    const networkOverride = parsedConfig?.network && typeof parsedConfig.network === 'object' ? parsedConfig.network : undefined;
    const rawEnvOverride = parsedConfig?.env && typeof parsedConfig.env === 'object' ? parsedConfig.env : {};
    const {
      envId: _envId,
      env_id: _envIdAlt,
      version: _envVersion,
      mapSet: _mapSet,
      map_set: _mapSetAlt,
      mapSets: _mapSets,
      entrypoint: _entrypoint,
      package: _pkg,
      apiMode: _apiMode,
      api_mode: _apiModeAlt,
      scenarioSchema: _scenarioSchema,
      scenario_schema: _scenarioSchemaAlt,
      ...envOverride
    } = isPlainObject(rawEnvOverride) ? rawEnvOverride : {};
    // Extract dataset overrides (if any)
    const datasetId = parsedConfig?.datasetId || undefined;

    setIsSubmitting(true);
    try {
      const seeds = Array.from({ length: seedCount }, (_, idx) => idx + 1);
      const autoEval = autoEvalEnabled && autoEvalProtocolId
        ? { protocolId: autoEvalProtocolId, triggerOn: autoEvalTrigger }
        : undefined;
      
      // Git Config
      let gitConfig = undefined;
      if (useGit) {
          const project = projects.find(p => p.id === selectedProject);
          if (project?.gitRepo) {
               gitConfig = {
                  repo: project.gitRepo,
                  branch: gitBranch || 'main',
                  commit: gitCommit || undefined
              };
          }
      }

      // Generate Group ID for Sweeps
      const isSweep = trainConfigs.length > 1 || seedCount > 1;
      const groupId = isSweep ? `sweep-${Date.now()}` : undefined;

      const results = [];
      for (const config of trainConfigs) {
        for (const seed of seeds) {
          const res = await api.submitTrainJob({
            projectId: selectedProject,
            templateVersionId: templateVersionId!,
            env: { envId: selectedEnv, version: envVersion, mapSet: selectedMap, ...envOverride },
            algo: { 
                algoId: algoInfo!.algoId, 
                algoVersionId: algoVersionId!,
                ...algoOverride 
            },
            train: config,
            ...(networkOverride ? { network: networkOverride } : {}),
            resources: { gpus: gpuCount, priority, ...(timeoutSec > 0 ? { timeoutSec } : {}) },
            seedSet: [seed],
            ...(autoEval ? { autoEval } : {}),
            ...(plugin ? { plugin: { pluginId: plugin.id, version: plugin.version } } : {}),
            ...(gitConfig ? { git: gitConfig } : {}),
            ...(groupId ? { groupId } : {}),
            ...(datasetId ? { datasetId } : {}),
          });
          results.push(res);
        }
      }
      if (results.length > 1) {
        showToast(`Submitted ${results.length} jobs in sweep ${groupId}.`, 'success');
        navigate(`/projects/${selectedProject}`);
      } else if (results[0]?.runId) {
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

  const setupChecklist = useMemo(() => {
    const visibleTemplateCount = templates.filter(t => !isSystemTemplate(t)).length;
    const base = [
      {
        id: 'project',
        label: t('createJob.check.project', 'Project'),
        ready: projects.length > 0,
        actionLabel: t('createJob.check.createProject', 'Create project'),
        onAction: () => navigate('/', { state: { openCreateProject: true } }),
      },
      {
        id: 'template',
        label: t('createJob.check.template', 'Template'),
        ready: visibleTemplateCount > 0,
        actionLabel: t('createJob.check.openTemplates', 'Open templates'),
        onAction: () => navigate('/registries/templates', { state: { projectId: selectedProject, openCreate: true } }),
      },
      {
        id: 'environment',
        label: t('createJob.check.environment', 'Environment'),
        ready: envs.length > 0,
        actionLabel: t('createJob.check.openEnvs', 'Open environments'),
        onAction: () => navigate('/registries/environments', { state: { openCreate: true } }),
      },
      {
        id: 'algorithm',
        label: t('createJob.check.algorithm', 'Algorithm'),
        ready: algos.length > 0,
        actionLabel: t('createJob.check.openAlgos', 'Open algorithms'),
        onAction: () => navigate('/registries/algorithms'),
      },
    ];
    if (launchMode === 'quick') {
      return base.filter(item => item.id !== 'template');
    }
    return base.filter(item => item.id !== 'algorithm');
  }, [projects.length, templates, envs.length, algos.length, launchMode, navigate, selectedProject, t]);

  const missingSetup = setupChecklist.filter(item => !item.ready);
  const hasConfigError = Boolean(configParseError) || configSchemaErrors.length > 0;

  const togglePlugin = (id: string) => {
      if (selectedPlugins.includes(id)) {
          setSelectedPlugins(selectedPlugins.filter(p => p !== id));
      } else {
          setSelectedPlugins([...selectedPlugins, id]);
      }
  }

  const isStepValid = () => {
    if (currentStep === 0) return !!selectedProject;
    if (currentStep === 1) {
      if (launchMode === 'quick') {
        return !!selectedAlgoId && !!selectedAlgoVersionId;
      }
      return !!selectedTemplate && !!selectedTemplateVersionId;
    }
    if (currentStep === 2) return !!selectedEnv && !!selectedEnvVersion && !!selectedMap;
    if (currentStep === 3) return !hasConfigError;
    return true;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 flex justify-between items-end">
        <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('createJob.title', 'Create New Job')}</h1>
            <p className="text-gray-500 mt-1">{t('createJob.subtitle', 'Configure and launch a new training or evaluation run.')}</p>
        </div>
        {forkSource && (
            <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-md text-sm font-medium border border-blue-200 flex items-center animate-in fade-in">
                <Copy className="w-3 h-3 mr-2" />
                {t('createJob.cloningFrom', 'Cloning from')} {forkSource}
            </div>
        )}
      </div>

      {/* Setup checklist */}
      <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
          <Info className="w-4 h-4 text-blue-500" />
          {t('createJob.setupChecklist', 'Setup checklist')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {setupChecklist.map(item => (
            <div
              key={item.id}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border ${
                item.ready ? 'bg-green-50 border-green-200 text-green-800' : 'bg-gray-50 border-gray-200 text-gray-700'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className={`inline-flex w-2 h-2 rounded-full ${item.ready ? 'bg-green-500' : 'bg-gray-400'}`} />
                {item.label}
              </div>
              {!item.ready && (
                <button
                  type="button"
                  onClick={item.onAction}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  {item.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
        {missingSetup.length === 0 && (
          <div className="mt-3 text-xs text-green-700">{t('createJob.setupReady', 'All prerequisites are ready. Continue the wizard below.')}</div>
        )}
      </div>

      {/* Stepper */}
      <div className="flex items-center justify-between mb-8 relative px-4">
        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-200 -z-10 rounded"></div>
        {steps.map((step, idx) => {
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
            <h2 className="text-lg font-semibold">{t('createJob.selectProject', 'Select Project')}</h2>
            {projects.length === 0 && (
              <div className="p-4 rounded-lg border border-dashed border-blue-200 bg-blue-50 text-sm text-blue-700 flex items-center justify-between">
                <div>{t('createJob.noProjects', 'No projects yet. Create one to organize runs and templates.')}</div>
                <button
                  type="button"
                  onClick={() => navigate('/', { state: { openCreateProject: true } })}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  {t('createJob.check.createProject', 'Create project')}
                </button>
              </div>
            )}
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
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{p.activeRuns} {tx('个运行中任务', 'active runs')}</span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    {p.tags.map(t => <span key={t} className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">#{t}</span>)}
                  </div>
                </div>
              ))}
              <div
                className="p-4 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 cursor-pointer hover:border-blue-400 hover:text-blue-500"
                onClick={() => navigate('/', { state: { openCreateProject: true } })}
                role="button"
              >
                <div className="text-center">
                    <Plus className="w-6 h-6 mx-auto mb-1"/>
                    <span className="text-sm font-medium">{t('dashboard.createNewProject', 'Create New Project')}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 1 && (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{launchMode === 'quick' ? t('createJob.selectAlgorithm', 'Select Algorithm') : t('createJob.selectTemplate', 'Select Template')}</h2>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-1">
                        <button
                          type="button"
                          onClick={() => setLaunchMode('template')}
                          className={`px-3 py-1 text-xs font-semibold rounded ${launchMode === 'template' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                          {t('createJob.mode.template', 'Template')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setLaunchMode('quick')}
                          className={`px-3 py-1 text-xs font-semibold rounded ${launchMode === 'quick' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                          {t('createJob.mode.quick', 'Quick Run')}
                        </button>
                    </div>
                </div>
                {launchMode === 'template' && (
                  <>
                    <div className="grid grid-cols-1 gap-3">
                    {visibleTemplates.map(t => (
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
                        {visibleTemplates.length === 0 && (
                          <div className="p-4 rounded-lg border border-dashed border-gray-200 text-sm text-gray-500 flex items-center justify-between">
                            <span>{tx('该项目暂无模板。', 'No templates found for this project.')}</span>
                            <button
                              type="button"
                              onClick={() => navigate('/registries/templates', { state: { projectId: selectedProject, openCreate: true } })}
                              className="text-xs font-semibold text-blue-600 hover:underline"
                            >
                              {tx('创建模板', 'Create template')}
                            </button>
                          </div>
                        )}
                    </div>
                    {selectedTemplate && (
                      <div className="space-y-3 pt-4 border-t border-gray-100">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{tx('模板版本', 'Template Version')}</label>
                          <select
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={selectedTemplateVersionId}
                            onChange={(e) => setSelectedTemplateVersionId(e.target.value)}
                          >
                            <option value="">{tx('-- 选择版本 --', '-- Select Version --')}</option>
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
                              return tx('该模板版本未绑定算法。', 'No algorithm linked to this template version.');
                            }
                            const algoInfo = algoVersionIndex[version.algoVersionId];
                            if (!algoInfo) {
                              return tx(
                                `注册表中未找到算法版本 ${version.algoVersionId.slice(0, 8)}。`,
                                `Algo version ${version.algoVersionId.slice(0, 8)} not found in registry.`,
                              );
                            }
                            return tx(
                              `关联算法：${algoInfo.algoName} (v${algoInfo.version})`,
                              `Linked algorithm: ${algoInfo.algoName} (v${algoInfo.version})`,
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {launchMode === 'quick' && (
                  <>
                    <div className="grid grid-cols-1 gap-3">
                      {algos.map(a => (
                        <div
                          key={a.id}
                          onClick={() => setSelectedAlgoId(a.id)}
                          className={`p-4 rounded-lg border cursor-pointer hover:shadow-sm transition-all ${
                            selectedAlgoId === a.id ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-gray-200'
                          }`}
                        >
                          <h3 className="font-medium text-gray-900">{a.name}</h3>
                          <p className="text-sm text-gray-500 mt-1">{a.description}</p>
                        </div>
                      ))}
                      {algos.length === 0 && (
                        <div className="p-4 rounded-lg border border-dashed border-gray-200 text-sm text-gray-500 flex items-center justify-between">
                          <span>{tx('尚未注册算法。', 'No algorithms registered yet.')}</span>
                          <button
                            type="button"
                            onClick={() => navigate('/registries/algorithms')}
                            className="text-xs font-semibold text-blue-600 hover:underline"
                          >
                            {tx('打开注册中心', 'Open registry')}
                          </button>
                        </div>
                      )}
                    </div>
                    {selectedAlgoId && (
                      <div className="space-y-3 pt-4 border-t border-gray-100">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{tx('算法版本', 'Algorithm Version')}</label>
                          <select
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                            value={selectedAlgoVersionId}
                            onChange={(e) => setSelectedAlgoVersionId(e.target.value)}
                          >
                            <option value="">{tx('-- 选择版本 --', '-- Select Version --')}</option>
                            {([...((algoVersions[selectedAlgoId] || []))].sort((a, b) => {
                              const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
                              const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
                              if (aTime !== bTime) return bTime - aTime;
                              return (b.version || '').localeCompare(a.version || '');
                            })).map(v => (
                              <option key={v.id} value={v.id}>
                                v{v.version} ({v.id.slice(0, 8)})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="text-xs text-gray-500">
                          {tx(
                            '快速运行会自动为该算法创建模板版本，便于后续复现实验。',
                            'Quick Run will auto-create a template version for this algorithm so you can reproduce the run later.',
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
            </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-6">
            <div className="space-y-2">
                <h2 className="text-lg font-semibold">{tx('选择环境', 'Select Environment')}</h2>
                {envs.length === 0 && (
                  <div className="p-4 rounded-lg border border-dashed border-gray-200 text-sm text-gray-500 flex items-center justify-between">
                    <span>{tx('尚未注册环境。', 'No environments registered yet.')}</span>
                    <button
                      type="button"
                      onClick={() => navigate('/registries/environments', { state: { openCreate: true } })}
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      {tx('注册环境', 'Register environment')}
                    </button>
                  </div>
                )}
                <select 
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={selectedEnv}
                    onChange={(e) => setSelectedEnv(e.target.value)}
                >
                    <option value="">{tx('-- 选择环境 --', '-- Select Env --')}</option>
                    {envs.map(e => <option key={e.id} value={e.id}>{e.id} ({e.versions[0]})</option>)}
                </select>
            </div>
            
            {selectedEnv && (
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold">{tx('选择版本', 'Select Version')}</h2>
                    <select
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        value={selectedEnvVersion}
                        onChange={(e) => setSelectedEnvVersion(e.target.value)}
                    >
                        <option value="">{tx('-- 选择版本 --', '-- Select Version --')}</option>
                        {envVersionsEnvId === selectedEnv && envVersions.map(v => (
                            <option key={v.version} value={v.version}>{v.version} ({v.apiMode})</option>
                        ))}
                    </select>
                </div>
            )}

            {selectedEnv && selectedEnvVersion && (
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold">{tx('选择地图 / 场景', 'Select Map / Scenario')}</h2>
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
                            {tx('默认', 'default')}
                          </div>
                        )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {resolveMapOptions(
                        envVersions.find(v => v.version === selectedEnvVersion),
                        envs.find(e => e.id === selectedEnv),
                      ).length > 0
                        ? tx('请选择预定义地图集。', 'Select a predefined map set.')
                        : tx('未注册地图集，使用默认值。', 'No map sets registered; using default.')}
                    </p>
                </div>
            )}
          </div>
        )}

        {currentStep === 3 && (
            <div className="space-y-6 h-full flex flex-col">
                {/* Sweep Mode Toggle */}
                <div className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <span className="text-sm font-medium text-gray-700">{tx('任务模式：', 'Job Mode:')}</span>
                    <div className="flex bg-white rounded-md border border-gray-300 p-1">
                        <button 
                            onClick={() => { setIsSweepMode(false); setConfigOverride(configOverride.replace(/\[|\]/g, '')); setConfigTouched(true); }} // quick dirty reset
                            className={`px-3 py-1 text-xs font-medium rounded ${!isSweepMode ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            {tx('单次运行', 'Single Run')}
                        </button>
                        <button 
                            onClick={() => setIsSweepMode(true)}
                            className={`px-3 py-1 text-xs font-medium rounded flex items-center ${isSweepMode ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            <GitBranch className="w-3 h-3 mr-1" />
                            {tx('超参数搜索', 'Hyperparameter Sweep')}
                        </button>
                    </div>
                    {isSweepMode && (
                        <span className="text-xs text-purple-600 flex items-center">
                            <Zap className="w-3 h-3 mr-1" /> {tx('检测到：', 'Detected:')} <strong>{sweepCombinations}</strong> {tx('种组合', 'combinations')}
                        </span>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
                    {/* Params Editor */}
                    <div className="flex flex-col h-full">
                        <h3 className="text-sm font-bold text-gray-700 mb-2">{tx('超参数覆盖', 'Hyperparameter Overrides')}</h3>
                        <div className="relative flex-1">
                            <textarea 
                                value={configOverride}
                                onChange={(e) => { setConfigOverride(e.target.value); setConfigTouched(true); }}
                                className={`w-full h-64 lg:h-full p-4 font-mono text-sm border rounded-lg focus:ring-2 focus:outline-none resize-none ${
                                    isSweepMode ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-300'
                                } ${hasConfigError ? 'border-red-400 focus:ring-red-200' : 'focus:ring-blue-500'}`}
                                spellCheck={false}
                            />
                            <span className="absolute top-2 right-2 text-xs text-gray-400 bg-white px-2 py-1 rounded border border-gray-200">JSON</span>
                        </div>
                        {configParseError && (
                          <div className="mt-2 text-xs text-red-600">{tx('JSON 错误', 'JSON error')}: {configParseError}</div>
                        )}
                        {!configParseError && configSchemaErrors.length > 0 && (
                          <div className="mt-2 text-xs text-amber-600">
                            {tx('Schema 校验', 'Schema check')}: {configSchemaErrors.slice(0, 3).join(' • ')}
                          </div>
                        )}
                         <p className="text-xs text-gray-500 mt-2">
                             {isSweepMode 
                                ? tx(
                                    '搜索模式：对需要搜索的参数使用数组，例如 "lr": [0.001, 0.0005]。',
                                    'Sweep Mode: Use arrays for parameters you want to sweep. E.g., "lr": [0.001, 0.0005]',
                                  )
                                : tx('修改本次运行的默认参数。', 'Modify the default parameters for this specific run.')}
                         </p>
                    </div>

                    {/* Plugins & Features */}
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-sm font-bold text-gray-700 mb-2">{tx('训练参数引导覆盖', 'Guided Train Overrides')}</h3>
                            <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
                                {trainFieldSpecs.map(spec => {
                                  const trainConfig = (resolvedConfig as any)?.train || {};
                                  const rawValue = trainConfig?.[spec.key];
                                  const value =
                                    rawValue === undefined || rawValue === null
                                      ? ''
                                      : typeof rawValue === 'number'
                                      ? String(rawValue)
                                      : String(rawValue);
                                  return (
                                    <div key={spec.key} className="flex items-center justify-between gap-3">
                                      <label className="text-xs font-medium text-gray-600">{spec.label}</label>
                                      {spec.options ? (
                                        <select
                                          value={value}
                                          onChange={e => updateTrainOverride(spec.key, e.target.value, spec.type)}
                                          className="text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                        >
                                          <option value="">{tx('（默认）', '(default)')}</option>
                                          {spec.options.map(opt => (
                                            <option key={String(opt)} value={String(opt)}>
                                              {String(opt)}
                                            </option>
                                          ))}
                                        </select>
                                      ) : spec.type === 'boolean' ? (
                                        <input
                                          type="checkbox"
                                          checked={Boolean(rawValue)}
                                          onChange={e => updateTrainOverride(spec.key, e.target.checked, spec.type)}
                                          className="h-4 w-4"
                                        />
                                      ) : spec.type === 'number' || spec.type === 'integer' ? (
                                        <input
                                          type="number"
                                          value={value}
                                          onChange={e => updateTrainOverride(spec.key, e.target.value, spec.type)}
                                          className="w-32 text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                          placeholder={tx('（默认）', '(default)')}
                                        />
                                      ) : (
                                        <input
                                          type="text"
                                          value={value}
                                          onChange={e => updateTrainOverride(spec.key, e.target.value, spec.type)}
                                          className="w-40 text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                          placeholder={tx('（默认）', '(default)')}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                                <div className="text-[11px] text-gray-500">
                                  {tx('如需搜索或嵌套覆盖，请直接编辑 JSON。', 'For sweeps or nested overrides, edit JSON directly.')}
                                </div>
                            </div>
                        </div>
                        {algoFieldSpecs.length > 0 && (
                          <div>
                              <h3 className="text-sm font-bold text-gray-700 mb-2">{tx('算法参数覆盖', 'Algorithm Overrides')}</h3>
                              <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
                                  {algoFieldSpecs.map(spec => {
                                    const algoConfig = (resolvedConfig as any)?.algo || {};
                                    const rawValue = algoConfig?.[spec.key];
                                    const value =
                                      rawValue === undefined || rawValue === null
                                        ? ''
                                        : typeof rawValue === 'number'
                                        ? String(rawValue)
                                        : String(rawValue);
                                    return (
                                      <div key={spec.key} className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-medium text-gray-600">{spec.label}</label>
                                        {spec.options ? (
                                          <select
                                            value={value}
                                            onChange={e => updateAlgoOverride(spec.key, e.target.value, spec.type)}
                                            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                          >
                                            <option value="">{tx('（默认）', '(default)')}</option>
                                            {spec.options.map(opt => (
                                              <option key={String(opt)} value={String(opt)}>
                                                {String(opt)}
                                              </option>
                                            ))}
                                          </select>
                                        ) : spec.type === 'boolean' ? (
                                          <input
                                            type="checkbox"
                                            checked={Boolean(rawValue)}
                                            onChange={e => updateAlgoOverride(spec.key, e.target.checked, spec.type)}
                                            className="h-4 w-4"
                                          />
                                        ) : spec.type === 'number' || spec.type === 'integer' ? (
                                          <input
                                            type="number"
                                            value={value}
                                            onChange={e => updateAlgoOverride(spec.key, e.target.value, spec.type)}
                                            className="w-32 text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                            placeholder={tx('（默认）', '(default)')}
                                          />
                                        ) : (
                                          <input
                                            type="text"
                                            value={value}
                                            onChange={e => updateAlgoOverride(spec.key, e.target.value, spec.type)}
                                            className="w-40 text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                            placeholder={tx('（默认）', '(default)')}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                  <div className="text-[11px] text-gray-500">
                                    {tx('算法专项覆盖为可选项。', 'Algorithm-specific overrides are optional.')}
                                  </div>
                              </div>
                          </div>
                        )}
                        {networkFieldSpecs.length > 0 && (
                          <div>
                              <h3 className="text-sm font-bold text-gray-700 mb-2">{tx('网络参数覆盖', 'Network Overrides')}</h3>
                              <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
                                  {networkFieldSpecs.map(spec => {
                                    const networkConfig = (resolvedConfig as any)?.network || {};
                                    const rawValue = networkConfig?.[spec.key];
                                    const value =
                                      rawValue === undefined || rawValue === null
                                        ? ''
                                        : typeof rawValue === 'number'
                                        ? String(rawValue)
                                        : String(rawValue);
                                    return (
                                      <div key={spec.key} className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-medium text-gray-600">{spec.label}</label>
                                        {spec.options ? (
                                          <select
                                            value={value}
                                            onChange={e => updateNetworkOverride(spec.key, e.target.value, spec.type)}
                                            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                          >
                                            <option value="">{tx('（默认）', '(default)')}</option>
                                            {spec.options.map(opt => (
                                              <option key={String(opt)} value={String(opt)}>
                                                {String(opt)}
                                              </option>
                                            ))}
                                          </select>
                                        ) : spec.type === 'boolean' ? (
                                          <input
                                            type="checkbox"
                                            checked={Boolean(rawValue)}
                                            onChange={e => updateNetworkOverride(spec.key, e.target.checked, spec.type)}
                                            className="h-4 w-4"
                                          />
                                        ) : spec.type === 'number' || spec.type === 'integer' ? (
                                          <input
                                            type="number"
                                            value={value}
                                            onChange={e => updateNetworkOverride(spec.key, e.target.value, spec.type)}
                                            className="w-32 text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                            placeholder={tx('（默认）', '(default)')}
                                          />
                                        ) : (
                                          <input
                                            type="text"
                                            value={value}
                                            onChange={e => updateNetworkOverride(spec.key, e.target.value, spec.type)}
                                            className="w-40 text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                            placeholder={tx('（默认）', '(default)')}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                  <div className="text-[11px] text-gray-500">
                                    {tx(
                                      '网络覆盖作用于 policy/critic 结构参数。数组支持逗号分隔或 JSON（例如 64,64 或 [64,64]）。',
                                      'Network overrides apply to policy/critic architecture settings. Arrays accept comma-separated or JSON (e.g. 64,64 or [64,64]).',
                                    )}
                                  </div>
                              </div>
                          </div>
                        )}
                        {envFieldSpecs.length > 0 && (
                          <div>
                              <h3 className="text-sm font-bold text-gray-700 mb-2">{tx('环境参数覆盖', 'Env Overrides')}</h3>
                              <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
                                  {envFieldSpecs.map(spec => {
                                    const envConfig = (resolvedConfig as any)?.env || {};
                                    const rawValue = envConfig?.[spec.key];
                                    const value =
                                      rawValue === undefined || rawValue === null
                                        ? ''
                                        : typeof rawValue === 'number'
                                        ? String(rawValue)
                                        : String(rawValue);
                                    return (
                                      <div key={spec.key} className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-medium text-gray-600">{spec.label}</label>
                                        {spec.options ? (
                                          <select
                                            value={value}
                                            onChange={e => updateEnvOverride(spec.key, e.target.value, spec.type)}
                                            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                          >
                                            <option value="">{tx('（默认）', '(default)')}</option>
                                            {spec.options.map(opt => (
                                              <option key={String(opt)} value={String(opt)}>
                                                {String(opt)}
                                              </option>
                                            ))}
                                          </select>
                                        ) : spec.type === 'boolean' ? (
                                          <input
                                            type="checkbox"
                                            checked={Boolean(rawValue)}
                                            onChange={e => updateEnvOverride(spec.key, e.target.checked, spec.type)}
                                            className="h-4 w-4"
                                          />
                                        ) : spec.type === 'number' || spec.type === 'integer' ? (
                                          <input
                                            type="number"
                                            value={value}
                                            onChange={e => updateEnvOverride(spec.key, e.target.value, spec.type)}
                                            className="w-32 text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                            placeholder={tx('（默认）', '(default)')}
                                          />
                                        ) : (
                                          <input
                                            type="text"
                                            value={value}
                                            onChange={e => updateEnvOverride(spec.key, e.target.value, spec.type)}
                                            className="w-40 text-xs px-2 py-1 rounded border border-gray-300 bg-white"
                                            placeholder={tx('（默认）', '(default)')}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                  <div className="text-[11px] text-gray-500">
                                    {tx(
                                      '用于环境特定参数（例如 PettingZoo 的 maxCycles/continuousActions）。',
                                      'Use these for env-specific knobs (e.g., PettingZoo maxCycles/continuousActions).',
                                    )}
                                  </div>
                              </div>
                          </div>
                        )}
                        <div>
                            <h3 className="text-sm font-bold text-gray-700 mb-2">{tx('数据集（Offline RL）', 'Dataset (Offline RL)')}</h3>
                            <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">{tx('数据集', 'Dataset')}</label>
                                <select
                                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                  value={selectedDatasetId}
                                  onChange={(e) => {
                                    const next = e.target.value;
                                    setSelectedDatasetId(next);
                                    updateDatasetOverride(next);
                                  }}
                                >
                                  <option value="">{tx('不使用数据集', 'No dataset')}</option>
                                  {datasets.map(ds => (
                                    <option key={ds.id} value={ds.id}>
                                      {ds.name} ({ds.format})
                                    </option>
                                  ))}
                                </select>
                                {datasets.length === 0 && (
                                  <p className="text-xs text-gray-500 mt-2">
                                    {tx('尚未注册数据集，请在数据集注册中心添加。', 'No datasets registered yet. Add one in the Dataset Registry.')}
                                  </p>
                                )}
                                <p className="text-[11px] text-gray-500 mt-2">
                                  {tx('选择数据集后会将 ', 'Selecting a dataset injects ')}
                                  <code className="font-mono">datasetId</code>
                                  {tx(' 注入配置。', ' into the config.')}
                                </p>
                              </div>
                            </div>
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-gray-700 mb-2">{tx('功能开关', 'Features')}</h3>
                            <div 
                                onClick={() => setEnableDataCollection(!enableDataCollection)}
                                className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between transition-colors ${
                                    enableDataCollection ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${enableDataCollection ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                                        <Database className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-bold text-gray-900">{tx('数据采集', 'Data Collection')}</div>
                                        <div className="text-xs text-gray-500">{tx('为 Offline RL 保存回放缓冲区', 'Save Replay Buffers for Offline RL')}</div>
                                    </div>
                                </div>
                                <div className={`w-10 h-5 rounded-full relative transition-colors ${enableDataCollection ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                                    <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${enableDataCollection ? 'translate-x-5' : ''}`} />
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-bold text-gray-700 mb-2">{tx('启用插件', 'Enable Plugins')}</h3>
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
                            {plugins.length === 0 && <div className="p-4 text-center text-sm text-gray-500">{tx('暂无已安装插件。', 'No plugins installed.')}</div>}
                        </div>
                    </div>
                </div>
            </div>
                <div className="border-t border-gray-100 pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-bold text-gray-700">{tx('自动评估', 'Auto Evaluation')}</h3>
                            <p className="text-xs text-gray-500">{tx('训练成功后自动触发评估。', 'Trigger evaluation after training succeeds.')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAutoEvalEnabled(!autoEvalEnabled)}
                          className={`px-3 py-1 text-xs rounded-full border ${
                            autoEvalEnabled ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'
                          }`}
                        >
                          {autoEvalEnabled ? tx('已启用', 'Enabled') : tx('已禁用', 'Disabled')}
                        </button>
                    </div>
                    {autoEvalEnabled && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">{tx('协议', 'Protocol')}</label>
                          <select
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={autoEvalProtocolId}
                            onChange={(e) => setAutoEvalProtocolId(e.target.value)}
                          >
                            <option value="">{tx('选择协议', 'Select protocol')}</option>
                            {evalProtocols.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} (v{p.version})
                              </option>
                            ))}
                          </select>
                          {evalProtocols.length === 0 && (
                            <p className="text-xs text-gray-500 mt-1">{tx('暂无协议，请先在评估协议页创建。', 'No protocols available. Create one in Eval Protocols.')}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">{tx('触发条件', 'Trigger')}</label>
                          <select
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            value={autoEvalTrigger}
                            onChange={(e) => setAutoEvalTrigger(e.target.value)}
                          >
                            <option value="train_succeeded">{tx('训练成功后', 'On Train Success')}</option>
                          </select>
                        </div>
                      </div>
                    )}
                </div>
            </div>
        )}

        {currentStep === 4 && (
            <div className="space-y-6">
                <h2 className="text-lg font-semibold">{tx('资源分配', 'Resource Allocation')}</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-gray-700">{tx('GPU 资源（每个 trial）', 'GPU Resources (per trial)')}</label>
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
                        <p className="text-xs text-gray-500">{tx('当前集群负载下最多可立即分配 4 张 GPU。', 'Current Cluster load allows up to 4 GPUs immediately.')}</p>
                    </div>

                    <div className="space-y-4">
                         <label className="block text-sm font-medium text-gray-700">{tx('调度优先级', 'Scheduling Priority')}</label>
                         <div className="flex gap-4">
                            {[
                                { val: 1, label: tx('低', 'Low'), color: 'bg-gray-100 text-gray-700 border-gray-200' },
                                { val: 2, label: tx('普通', 'Normal'), color: 'bg-blue-50 text-blue-700 border-blue-200' },
                                { val: 3, label: tx('高', 'High'), color: 'bg-red-50 text-red-700 border-red-200' }
                            ].map(opt => (
                                <button
                                    key={opt.val}
                                    onClick={() => setPriority(opt.val)}
                                    className={`px-4 py-2 rounded-lg border text-sm font-bold transition-all ${
                                        priority === opt.val ? `${opt.color} ring-2 ring-offset-1 ring-blue-100` : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                         </div>
                         <p className="text-xs text-gray-500">{tx('高优先级任务会抢占空闲资源。', 'High priority jobs preempt idle resources.')}</p>
                    </div>

                    <div className="space-y-4">
                         <label className="block text-sm font-medium text-gray-700">{tx('任务超时（秒）', 'Job Timeout (seconds)')}</label>
                         <input
                            type="number"
                            value={timeoutSec}
                            onChange={(e) => setTimeoutSec(Number(e.target.value))}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min={0}
                            step={60}
                        />
                         <p className="text-xs text-gray-500">{tx('0 表示使用平台默认超时。', '0 uses the platform default timeout.')}</p>
                    </div>

                    <div className="space-y-4">
                         <label className="block text-sm font-medium text-gray-700">{tx('随机种子数', 'Random Seeds')}</label>
                         <input 
                            type="number" 
                            value={seedCount}
                            onChange={(e) => setSeedCount(parseInt(e.target.value))}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min={1}
                            max={10}
                        />
                         <p className="text-xs text-gray-500">{tx(`每个配置将启动 ${seedCount} 个 trial。`, `Will launch ${seedCount} trials for each configuration.`)}</p>
                    </div>
                </div>

                <div className="mt-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h3 className="text-sm font-bold text-gray-900 mb-2">{tx('任务摘要', 'Job Summary')}</h3>
                    <ul className="text-sm text-gray-600 space-y-1">
                        <li>{tx('项目', 'Project')}: <span className="font-mono text-gray-900">{projects.find(p => p.id === selectedProject)?.name}</span></li>
                        <li>{tx('环境', 'Environment')}: <span className="font-mono text-gray-900">{selectedEnv} / {selectedEnvVersion} / {selectedMap}</span></li>
                        <li>{tx('启动模式', 'Launch Mode')}: <span className="font-mono text-gray-900">{launchMode === 'quick' ? tx('快速运行', 'Quick Run') : tx('模板', 'Template')}</span></li>
                        {launchMode === 'template' ? (
                          <>
                            <li>{tx('模板', 'Template')}: <span className="font-mono text-gray-900">{templates.find(t => t.id === selectedTemplate)?.name}</span></li>
                            <li>{tx('模板版本', 'Template Version')}: <span className="font-mono text-gray-900">{templateVersions.find(v => v.id === selectedTemplateVersionId)?.version || '-'}</span></li>
                            <li>{tx('算法', 'Algorithm')}: <span className="font-mono text-gray-900">
                              {(() => {
                                const version = templateVersions.find(v => v.id === selectedTemplateVersionId);
                                if (!version?.algoVersionId) return '-';
                                const info = algoVersionIndex[version.algoVersionId];
                                if (!info) return version.algoVersionId;
                                return `${info.algoName} (v${info.version})`;
                              })()}
                            </span></li>
                          </>
                        ) : (
                          <>
                            <li>{tx('模板', 'Template')}: <span className="font-mono text-gray-900">{tx('Quick Run（自动）', 'Quick Run (auto)')}</span></li>
                            <li>{tx('算法', 'Algorithm')}: <span className="font-mono text-gray-900">
                              {(() => {
                                const algo = algos.find(a => a.id === selectedAlgoId);
                                const version = (algoVersions[selectedAlgoId] || []).find(v => v.id === selectedAlgoVersionId);
                                if (!algo || !version) return '-';
                                return `${algo.name} (v${version.version})`;
                              })()}
                            </span></li>
                          </>
                        )}
                        <li>{tx('自动评估', 'Auto Eval')}: <span className="font-mono text-gray-900">
                          {autoEvalEnabled
                            ? evalProtocols.find(p => p.id === autoEvalProtocolId)?.name || autoEvalProtocolId || tx('已启用', 'Enabled')
                            : tx('关闭', 'Off')}
                        </span></li>
                        <li>{tx('数据集', 'Dataset')}: <span className="font-mono text-gray-900">
                          {selectedDatasetId
                            ? datasets.find(d => d.id === selectedDatasetId)?.name || selectedDatasetId
                            : tx('无', 'None')}
                        </span></li>
                        <li>{tx('任务类型', 'Job Type')}: <span className={`font-bold ${isSweepMode ? 'text-purple-600' : 'text-gray-900'}`}>{isSweepMode ? tx('超参数搜索', 'Hyperparameter Sweep') : tx('单次运行', 'Single Run')}</span></li>
                        <li>{tx('超时', 'Timeout')}: <span className="font-mono text-gray-900">{timeoutSec > 0 ? `${timeoutSec}s` : tx('默认', 'Default')}</span></li>
                        <li>{tx('任务总数', 'Total Jobs')}: <span className="font-bold text-gray-900">
                            {sweepCombinations} {tx('个配置', 'Configs')} × {seedCount} {tx('个种子', 'Seeds')} = {sweepCombinations * seedCount} {tx('个试验', 'Trials')}
                        </span></li>
                        <li>{tx('预估算力', 'Est. Compute')}: <span className="font-mono text-gray-900">{(sweepCombinations * seedCount * gpuCount)} {tx('张 GPU 申请', 'GPUs requested')}</span></li>
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
            {tx('返回', 'Back')}
        </button>
        <button 
            onClick={handleNext}
            disabled={!isStepValid() || isSubmitting}
            className="px-6 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {currentStep === steps.length - 1 ? (
                <>
                    <PlayCircle className="w-5 h-5 mr-2" />
                    {isSubmitting ? tx('提交中...', 'Submitting...') : tx('启动任务', 'Launch Job')}
                </>
            ) : (
                <>
                    {tx('下一步', 'Next')} <ChevronRight className="w-5 h-5 ml-1" />
                </>
            )}
        </button>
      </div>
    </div>
  );
};
