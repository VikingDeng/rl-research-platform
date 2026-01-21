import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, Box, Activity, Grid3X3, FileStack, Settings, Database, BarChart2, List, Cpu, Layers, Package, LogOut, BookOpen, Terminal } from 'lucide-react';

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const navClass = ({ isActive }: { isActive: boolean }) => 
    `flex items-center px-4 py-2.5 text-sm font-medium transition-colors rounded-lg mx-2 my-0.5 ${
      isActive 
        ? 'bg-blue-50 text-blue-700' 
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`;
  
  const location = useLocation();
  const isProjectActive = location.pathname.startsWith('/projects');
  
  const lastProjectId = localStorage.getItem('last_project_id') || 'proj_01';
  const match = location.pathname.match(/^\/projects\/([^/]+)/);
  const currentLinkTarget = match ? match[1] : lastProjectId;

  const handleLogout = () => {
      // Clear tokens
      localStorage.removeItem('auth_token');
      navigate('/login');
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 h-full flex flex-col fixed left-0 top-0 bottom-0 z-10">
      <div className="p-6 flex items-center gap-3 border-b border-gray-100">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Activity className="text-white w-5 h-5" />
        </div>
        <div>
            <h1 className="text-lg font-bold text-gray-900">RL Platform</h1>
            <span className="text-xs text-gray-400 font-medium">Research Edition</span>
        </div>
      </div>
      
      <nav className="flex-1 overflow-y-auto py-4">
        {/* Workspace */}
        <div className="px-6 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Workspace
        </div>
        <NavLink to="/" className={navClass}>
          <LayoutDashboard className="w-4 h-4 mr-3" />
          Dashboard
        </NavLink>
        <NavLink 
            to={`/projects/${currentLinkTarget}`}
            className={() => `flex items-center px-4 py-2.5 text-sm font-medium transition-colors rounded-lg mx-2 my-0.5 ${
                isProjectActive
                    ? 'bg-blue-50 text-blue-700' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
        >
          <Layers className="w-4 h-4 mr-3" />
          Current Project
        </NavLink>
        <NavLink to="/workspaces" className={navClass}>
          <Terminal className="w-4 h-4 mr-3" />
          Workspaces
        </NavLink>
        <NavLink to="/create-job" className={navClass}>
          <PlusCircle className="w-4 h-4 mr-3" />
          New Job
        </NavLink>
        <NavLink to="/queue" className={navClass}>
          <List className="w-4 h-4 mr-3" />
          Cluster & Queue
        </NavLink>

        {/* Analysis Tools */}
        <div className="px-6 mt-6 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Analysis Tools
        </div>
        <NavLink to="/compare" className={navClass}>
          <BarChart2 className="w-4 h-4 mr-3" />
          Compare Runs
        </NavLink>
        <NavLink to="/matrix" className={navClass}>
          <Grid3X3 className="w-4 h-4 mr-3" />
          Matrix & Cross-Play
        </NavLink>
        <NavLink to="/models" className={navClass}>
          <Package className="w-4 h-4 mr-3" />
          Model Registry
        </NavLink>

        {/* Registries (The user's requested consolidation) */}
        <div className="px-6 mt-6 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Registries
        </div>
        <NavLink to="/registries/environments" className={navClass}>
            <Box className="w-4 h-4 mr-3" />
            Environments
        </NavLink>
        <NavLink to="/registries/algorithms" className={navClass}>
            <Cpu className="w-4 h-4 mr-3" />
            Algorithms
        </NavLink>
        <NavLink to="/registries/templates" className={navClass}>
            <BookOpen className="w-4 h-4 mr-3" />
            Templates
        </NavLink>
        <NavLink to="/registries/plugins" className={navClass}>
            <Package className="w-4 h-4 mr-3" />
            Plugins
        </NavLink>
        <NavLink to="/registries/protocols" className={navClass}>
            <FileStack className="w-4 h-4 mr-3" />
            Eval Protocols
        </NavLink>
        <NavLink to="/registries/pools" className={navClass}>
            <Database className="w-4 h-4 mr-3" />
            Opponent Pools
        </NavLink>

        {/* System */}
        <div className="px-6 mt-6 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          System
        </div>
        <NavLink to="/settings" className={navClass}>
          <Settings className="w-4 h-4 mr-3" />
          Settings
        </NavLink>
      </nav>

      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                RS
            </div>
            <div>
                <p className="text-sm font-medium text-gray-900">Researcher</p>
                <p className="text-xs text-gray-500">Determined AI</p>
            </div>
            </div>
            <button 
                onClick={handleLogout}
                className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded-md hover:bg-red-50"
                title="Logout"
            >
                <LogOut className="w-4 h-4" />
            </button>
        </div>
      </div>
    </div>
  );
};
