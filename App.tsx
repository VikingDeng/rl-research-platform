import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { CreateJob } from './pages/CreateJob';
import { RunDetail } from './pages/RunDetail';
import { MatrixView } from './pages/MatrixView';
import { EvalProtocols } from './pages/EvalProtocols';
import { OpponentPools } from './pages/OpponentPools';
import { CompareRuns } from './pages/CompareRuns';
import { ProjectDetail } from './pages/ProjectDetail';
import { Settings } from './pages/Settings';
import { JobQueue } from './pages/JobQueue';
import { TemplateLibrary } from './pages/TemplateLibrary';
import { EnvironmentRegistry } from './pages/EnvironmentRegistry';
import { AlgorithmRegistry } from './pages/AlgorithmRegistry';
import { PluginRegistry } from './pages/PluginRegistry';
import { ModelRegistry } from './pages/ModelRegistry';
import { DatasetRegistry } from './pages/DatasetRegistry';
import { TuningDashboard } from './pages/TuningDashboard';
import { Workspaces } from './pages/Workspaces';
import { Login } from './pages/Login';
import { GroupSummary } from './pages/GroupSummary';
import { CommandPalette } from './components/CommandPalette';
import { ToastProvider } from './components/Toast.tsx';

// Wrapper to apply Layout to all routes
const AppLayout: React.FC = () => {
    return (
        <Layout>
            <Outlet />
        </Layout>
    );
};

const App: React.FC = () => {
  return (
    <ToastProvider>
        <Router>
            {/* Global Components */}
            <CommandPalette />
            
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
                    <Route path="*" element={<div className="p-8 text-center text-gray-500">Page under construction</div>} />
                </Route>
            </Routes>
        </Router>
    </ToastProvider>
  );
};

export default App;
