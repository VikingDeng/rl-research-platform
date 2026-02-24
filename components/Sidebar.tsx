import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, Box, Activity, Grid3X3, FileStack, Settings, Database, BarChart2, List, Cpu, Layers, Package, LogOut, BookOpen, Terminal, Sliders, WandSparkles, ChevronDown, ChevronRight, Globe2, FileText } from 'lucide-react';
import { isDemoMode, setDemoMode } from '../services/api';
import { useI18n } from '../services/i18n';

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

export const Sidebar: React.FC<SidebarProps> = ({ className = '', onNavigate }) => {
  const navigate = useNavigate();
  const { t, locale, setLocale } = useI18n();
  const navClass = ({ isActive }: { isActive: boolean }) => 
    `flex items-center px-4 py-2.5 text-sm font-medium transition-colors rounded-lg mx-2 my-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
      isActive 
        ? 'bg-blue-50 text-blue-700' 
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`;
  const subNavClass = (active: boolean) =>
    `ml-8 mr-2 flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      active ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
    }`;
  
  const location = useLocation();
  const isProjectActive = location.pathname.startsWith('/projects');
  const panel = new URLSearchParams(location.search).get('panel') || '';
  const isLanguageActive = location.pathname === '/settings' && panel === 'language';
  const isDocsActive = location.pathname === '/settings' && panel === 'docs';
  
  const lastProjectId = localStorage.getItem('last_project_id') || 'proj_01';
  const match = location.pathname.match(/^\/projects\/([^/]+)/);
  const currentLinkTarget = match ? match[1] : lastProjectId;
  const [openSections, setOpenSections] = useState(() => {
    try {
      const raw = localStorage.getItem('sidebar_open_sections');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<'workspace' | 'analysis' | 'registries' | 'system', boolean>>;
        return {
          workspace: parsed.workspace ?? true,
          analysis: parsed.analysis ?? false,
          registries: parsed.registries ?? false,
          system: parsed.system ?? true,
        };
      }
    } catch {
      // fall back to defaults
    }
    return {
      workspace: true,
      analysis: false,
      registries: false,
      system: true,
    };
  });

  React.useEffect(() => {
    try {
      localStorage.setItem('sidebar_open_sections', JSON.stringify(openSections));
    } catch {
      // no-op for private mode/localStorage disabled
    }
  }, [openSections]);

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const SectionHeader = ({ id, title }: { id: keyof typeof openSections; title: string }) => {
    const open = openSections[id];
    return (
      <button
        type="button"
        onClick={() => toggleSection(id)}
        className="mb-1 flex w-full items-center justify-between px-6 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-500"
      >
        <span>{title}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
    );
  };

  const handleLogout = () => {
      // Clear tokens
      localStorage.removeItem('auth_token');
      navigate('/login');
      if (onNavigate) onNavigate();
  };
  const handleNavItemClick = () => onNavigate?.();

  return (
    <aside className={`w-64 bg-white border-r border-gray-200 h-full flex flex-col ${className}`}>
      <div className="p-6 flex items-center gap-3 border-b border-gray-100">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Activity className="text-white w-5 h-5" />
        </div>
        <div>
            <h1 className="text-lg font-bold text-gray-900">{t('sidebar.platformName', 'RL Platform')}</h1>
            <span className="text-xs text-gray-400 font-medium">{t('sidebar.researchEdition', 'Research Edition')}</span>
        </div>
      </div>
      
      <nav className="flex-1 overflow-y-auto py-4">
        {/* Workspace */}
        <SectionHeader id="workspace" title={t('sidebar.workspace', 'Workspace')} />
        {openSections.workspace && (
          <>
            <NavLink to="/" className={navClass} onClick={handleNavItemClick}>
              <LayoutDashboard className="w-4 h-4 mr-3" />
              {t('sidebar.dashboard', 'Dashboard')}
            </NavLink>
            <NavLink
                to={`/projects/${currentLinkTarget}`}
                onClick={() => onNavigate?.()}
                className={() => `flex items-center px-4 py-2.5 text-sm font-medium transition-colors rounded-lg mx-2 my-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                    isProjectActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
            >
              <Layers className="w-4 h-4 mr-3" />
              {t('sidebar.currentProject', 'Current Project')}
            </NavLink>
            <NavLink to="/workspaces" className={navClass} onClick={handleNavItemClick}>
              <Terminal className="w-4 h-4 mr-3" />
              {t('sidebar.workspaces', 'Workspaces')}
            </NavLink>
            <NavLink to="/create-job" className={navClass} onClick={handleNavItemClick}>
              <PlusCircle className="w-4 h-4 mr-3" />
              {t('sidebar.newJob', 'New Job')}
            </NavLink>
            <NavLink to="/queue" className={navClass} onClick={handleNavItemClick}>
              <List className="w-4 h-4 mr-3" />
              {t('sidebar.clusterQueue', 'Cluster & Queue')}
            </NavLink>
          </>
        )}

        {/* Analysis Tools */}
        <div className="mt-5">
          <SectionHeader id="analysis" title={t('sidebar.analysisTools', 'Analysis Tools')} />
          {openSections.analysis && (
            <>
              <NavLink to="/compare" className={navClass} onClick={handleNavItemClick}>
                <BarChart2 className="w-4 h-4 mr-3" />
                {t('sidebar.compareRuns', 'Compare Runs')}
              </NavLink>
              <NavLink to="/agentic" className={navClass} onClick={handleNavItemClick}>
                <WandSparkles className="w-4 h-4 mr-3" />
                {t('sidebar.agenticLab', 'Agentic Lab')}
              </NavLink>
              <NavLink to="/tuning" className={navClass} onClick={handleNavItemClick}>
                <Sliders className="w-4 h-4 mr-3" />
                {t('sidebar.hyperparamTuning', 'Hyperparameter Tuning')}
              </NavLink>
              <NavLink to="/matrix" className={navClass} onClick={handleNavItemClick}>
                <Grid3X3 className="w-4 h-4 mr-3" />
                {t('sidebar.matrixCrossPlay', 'Matrix & Cross-Play')}
              </NavLink>
              <NavLink to="/models" className={navClass} onClick={handleNavItemClick}>
                <Package className="w-4 h-4 mr-3" />
                {t('sidebar.modelRegistry', 'Model Registry')}
              </NavLink>
            </>
          )}
        </div>

        {/* Registries (The user's requested consolidation) */}
        <div className="mt-5">
          <SectionHeader id="registries" title={t('sidebar.registries', 'Registries')} />
          {openSections.registries && (
            <>
              <NavLink to="/registries/environments" className={navClass} onClick={handleNavItemClick}>
                  <Box className="w-4 h-4 mr-3" />
                  {t('sidebar.environments', 'Environments')}
              </NavLink>
              <NavLink to="/registries/algorithms" className={navClass} onClick={handleNavItemClick}>
                  <Cpu className="w-4 h-4 mr-3" />
                  {t('sidebar.algorithms', 'Algorithms')}
              </NavLink>
              <NavLink to="/registries/templates" className={navClass} onClick={handleNavItemClick}>
                  <BookOpen className="w-4 h-4 mr-3" />
                  {t('sidebar.templates', 'Templates')}
              </NavLink>
              <NavLink to="/registries/datasets" className={navClass} onClick={handleNavItemClick}>
                  <Database className="w-4 h-4 mr-3" />
                  {t('sidebar.datasets', 'Datasets')}
              </NavLink>
              <NavLink to="/registries/plugins" className={navClass} onClick={handleNavItemClick}>
                  <Package className="w-4 h-4 mr-3" />
                  {t('sidebar.plugins', 'Plugins')}
              </NavLink>
              <NavLink to="/registries/protocols" className={navClass} onClick={handleNavItemClick}>
                  <FileStack className="w-4 h-4 mr-3" />
                  {t('sidebar.evalProtocols', 'Eval Protocols')}
              </NavLink>
              <NavLink to="/registries/pools" className={navClass} onClick={handleNavItemClick}>
                  <Database className="w-4 h-4 mr-3" />
                  {t('sidebar.opponentPools', 'Opponent Pools')}
              </NavLink>
            </>
          )}
        </div>

        {/* System */}
        <div className="mt-5">
          <SectionHeader id="system" title={t('sidebar.system', 'System')} />
          {openSections.system && (
            <>
              <NavLink to="/settings" className={navClass} onClick={handleNavItemClick}>
                <Settings className="w-4 h-4 mr-3" />
                {t('sidebar.settings', 'Settings')}
              </NavLink>
              <NavLink
                to="/settings?panel=language"
                className={() => subNavClass(isLanguageActive)}
                onClick={handleNavItemClick}
              >
                <Globe2 className="mr-2 h-3.5 w-3.5" />
                {t('sidebar.language', 'Language')}
              </NavLink>
              <div className="mx-2 mt-1 mb-1 flex overflow-hidden rounded-md border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setLocale('zh-CN');
                    onNavigate?.();
                  }}
                  className={`flex-1 px-2 py-1 text-[11px] font-semibold transition-colors ${
                    locale === 'zh-CN'
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}
                  aria-label={t('sidebar.language.switchChinese', 'Switch to Chinese')}
                >
                  中
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLocale('en-US');
                    onNavigate?.();
                  }}
                  className={`flex-1 border-l border-gray-200 px-2 py-1 text-[11px] font-semibold transition-colors ${
                    locale === 'en-US'
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}
                  aria-label={t('sidebar.language.switchEnglish', 'Switch to English')}
                >
                  EN
                </button>
              </div>
              <NavLink
                to="/settings?panel=docs"
                className={() => subNavClass(isDocsActive)}
                onClick={handleNavItemClick}
              >
                <FileText className="mr-2 h-3.5 w-3.5" />
                {t('sidebar.docs', 'Docs')}
              </NavLink>
            </>
          )}
        </div>
      </nav>

      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <div className="mb-3 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
            <div className="text-xs font-semibold text-gray-600">
                {isDemoMode ? t('sidebar.demoData', 'Demo Data') : t('sidebar.liveApi', 'Live API')}
            </div>
            <button
                onClick={() => setDemoMode(!isDemoMode)}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded"
            >
                {isDemoMode ? t('sidebar.useLive', 'Use Live') : t('sidebar.useDemo', 'Use Demo')}
            </button>
        </div>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                RS
            </div>
            <div>
                <p className="text-sm font-medium text-gray-900">{t('sidebar.researcher', 'Researcher')}</p>
                <p className="text-xs text-gray-500">{t('sidebar.orgName', 'Determined AI')}</p>
            </div>
            </div>
            <button 
                onClick={handleLogout}
                className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded-md hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                title={t('sidebar.logout', 'Logout')}
                aria-label={t('sidebar.logout', 'Logout')}
            >
                <LogOut className="w-4 h-4" />
            </button>
        </div>
      </div>
    </aside>
  );
};
