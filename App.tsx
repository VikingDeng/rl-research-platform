import React, { Suspense, lazy, useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast.tsx';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { useI18n } from './services/i18n';

const Dashboard = lazy(() => import('./pages/Dashboard').then(mod => ({ default: mod.Dashboard })));
const CreateJob = lazy(() => import('./pages/CreateJob').then(mod => ({ default: mod.CreateJob })));
const RunDetail = lazy(() => import('./pages/RunDetail').then(mod => ({ default: mod.RunDetail })));
const MatrixView = lazy(() => import('./pages/MatrixView').then(mod => ({ default: mod.MatrixView })));
const EvalProtocols = lazy(() => import('./pages/EvalProtocols').then(mod => ({ default: mod.EvalProtocols })));
const OpponentPools = lazy(() => import('./pages/OpponentPools').then(mod => ({ default: mod.OpponentPools })));
const CompareRuns = lazy(() => import('./pages/CompareRuns').then(mod => ({ default: mod.CompareRuns })));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail').then(mod => ({ default: mod.ProjectDetail })));
const Settings = lazy(() => import('./pages/Settings').then(mod => ({ default: mod.Settings })));
const JobQueue = lazy(() => import('./pages/JobQueue').then(mod => ({ default: mod.JobQueue })));
const TemplateLibrary = lazy(() => import('./pages/TemplateLibrary').then(mod => ({ default: mod.TemplateLibrary })));
const EnvironmentRegistry = lazy(() => import('./pages/EnvironmentRegistry').then(mod => ({ default: mod.EnvironmentRegistry })));
const AlgorithmRegistry = lazy(() => import('./pages/AlgorithmRegistry').then(mod => ({ default: mod.AlgorithmRegistry })));
const PluginRegistry = lazy(() => import('./pages/PluginRegistry').then(mod => ({ default: mod.PluginRegistry })));
const ModelRegistry = lazy(() => import('./pages/ModelRegistry').then(mod => ({ default: mod.ModelRegistry })));
const DatasetRegistry = lazy(() => import('./pages/DatasetRegistry').then(mod => ({ default: mod.DatasetRegistry })));
const TuningDashboard = lazy(() => import('./pages/TuningDashboard').then(mod => ({ default: mod.TuningDashboard })));
const Workspaces = lazy(() => import('./pages/Workspaces').then(mod => ({ default: mod.Workspaces })));
const Login = lazy(() => import('./pages/Login').then(mod => ({ default: mod.Login })));
const GroupSummary = lazy(() => import('./pages/GroupSummary').then(mod => ({ default: mod.GroupSummary })));
const AgenticTotCanvas = lazy(() => import('./pages/AgenticTotCanvas').then(mod => ({ default: mod.AgenticTotCanvas })));
const AgenticIdeaBuilder = lazy(() => import('./pages/AgenticIdeaBuilder').then(mod => ({ default: mod.AgenticIdeaBuilder })));
const AgenticLab = lazy(() => import('./pages/AgenticLab').then(mod => ({ default: mod.AgenticLab })));
const AgenticLabClassic = lazy(() => import('./pages/AgenticLabClassic').then(mod => ({ default: mod.AgenticLab })));
const AgenticNodeEvidence = lazy(() => import('./pages/AgenticNodeEvidence').then(mod => ({ default: mod.AgenticNodeEvidence })));
const AgenticAgents = lazy(() => import('./pages/AgenticAgents').then(mod => ({ default: mod.AgenticAgents })));
const CommandPalette = lazy(() => import('./components/CommandPalette').then(mod => ({ default: mod.CommandPalette })));

const RouteFallback: React.FC = () => {
  const { tx } = useI18n();
  return <div className="p-6 text-sm text-slate-500">{tx('加载中...', 'Loading...')}</div>;
};

const RouteNotFound: React.FC = () => {
  const { tx } = useI18n();
  return <div className="p-8 text-center text-gray-500">{tx('页面建设中', 'Page under construction')}</div>;
};

// Wrapper to apply Layout to all routes
const AppLayout: React.FC = () => {
    return (
        <Layout>
            <Outlet />
        </Layout>
    );
};

const App: React.FC = () => {
  const [mountCommandPalette, setMountCommandPalette] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMountCommandPalette(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <ToastProvider>
        <Router>
            {/* Global Components */}
            {mountCommandPalette && (
              <Suspense fallback={null}>
                  <CommandPalette />
              </Suspense>
            )}
            
            <Suspense fallback={<RouteFallback />}>
                <Routes>
                    {/* Public Route */}
                    <Route path="/login" element={<Login />} />

                    {/* Protected Routes */}
                    <Route element={<AppLayout />}>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/projects" element={<Navigate to="/" replace />} />
                        <Route path="/projects/:id" element={<ProjectDetail />} />
                        <Route path="/workspaces" element={<Workspaces />} />
                        <Route path="/models" element={<ModelRegistry />} />
                        <Route path="/create-job" element={<CreateJob />} />
                        <Route path="/runs/:id" element={<RunDetail />} />
                        <Route path="/groups/:groupId" element={<GroupSummary />} />
                        <Route
                          path="/agentic"
                          element={(
                            <RouteErrorBoundary title="ToT page render failed">
                              <AgenticTotCanvas />
                            </RouteErrorBoundary>
                          )}
                        />
                        <Route path="/agentic/new" element={<AgenticIdeaBuilder />} />
                        <Route path="/agentic/workbench" element={<AgenticLab />} />
                        <Route path="/agentic/classic" element={<AgenticLabClassic />} />
                        <Route path="/agentic/runs/:runId/nodes/:nodeId" element={<AgenticNodeEvidence />} />
                        <Route path="/agentic/runs/:runId/agents" element={<AgenticAgents />} />
                        
                        {/* Analysis */}
                        <Route path="/matrix" element={<MatrixView />} />
                        <Route path="/compare" element={<CompareRuns />} />
                        <Route path="/tuning" element={<TuningDashboard />} />
                        <Route path="/queue" element={<JobQueue />} />
                        
                        {/* Registries */}
                        <Route path="/registries/environments" element={<EnvironmentRegistry />} />
                        <Route path="/registries/algorithms" element={<AlgorithmRegistry />} />
                        <Route path="/registries/templates" element={<TemplateLibrary />} />
                        <Route path="/registries/datasets" element={<DatasetRegistry />} />
                        <Route path="/registries/plugins" element={<PluginRegistry />} />
                        <Route path="/registries/protocols" element={<EvalProtocols />} />
                        <Route path="/registries/pools" element={<OpponentPools />} />
                        
                        {/* Legacy redirects for old bookmarks */}
                        <Route path="/templates" element={<Navigate to="/registries/templates" replace />} />
                        <Route path="/eval-protocols" element={<Navigate to="/registries/protocols" replace />} />
                        <Route path="/opponent-pools" element={<Navigate to="/registries/pools" replace />} />

                        {/* System */}
                        <Route path="/settings" element={<Settings />} />
                        
                        {/* Fallback */}
                        <Route path="*" element={<RouteNotFound />} />
                    </Route>
                </Routes>
            </Suspense>
        </Router>
    </ToastProvider>
  );
};

export default App;
