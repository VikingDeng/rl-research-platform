import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useI18n } from '../services/i18n';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const { t } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);
  const headerLabel = useMemo(() => {
    const path = location.pathname || '/';
    if (path === '/') return t('layout.header.dashboard', 'Dashboard');
    if (path.startsWith('/agentic')) return t('layout.header.agentic', 'ToT Canvas');
    if (path.startsWith('/projects/')) return t('layout.header.project', 'Project Workspace');
    if (path.startsWith('/registries/')) return t('layout.header.registries', 'Registries');
    if (path.startsWith('/matrix')) return t('layout.header.matrix', 'Matrix');
    if (path.startsWith('/compare')) return t('layout.header.compare', 'Compare');
    if (path.startsWith('/tuning')) return t('layout.header.tuning', 'Tuning');
    if (path.startsWith('/settings')) return t('layout.header.settings', 'Settings');
    return t('layout.header.default', 'RL Platform');
  }, [location.pathname, t]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileNavOpen]);

  return (
    <div className="platform-shell relative flex min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-24 left-80 h-72 w-72 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-teal-200/25 blur-3xl" />

      <div className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:block">
        <Sidebar />
      </div>

      <div className={`fixed inset-y-0 left-0 z-40 md:hidden ${mobileNavOpen ? '' : 'pointer-events-none'}`} aria-hidden={!mobileNavOpen}>
        <div className={`h-full w-[17.5rem] max-w-[88vw] transform transition-transform duration-300 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <Sidebar className="h-full shadow-2xl" onNavigate={() => setMobileNavOpen(false)} />
        </div>
      </div>
      {mobileNavOpen && (
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/35 backdrop-blur-[1px] md:hidden"
          aria-label={t('common.cancel', 'Close')}
        />
      )}

      <main className="platform-main flex-1 min-h-screen overflow-y-auto p-4 sm:p-6 md:ml-64 md:p-8">
        <div className="sticky top-0 z-20 mb-4 flex items-center justify-between rounded-2xl border border-slate-200/70 bg-white/85 px-3 py-2 shadow-sm backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(prev => !prev)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700"
            aria-label={mobileNavOpen ? t('common.cancel', 'Close') : t('sidebar.workspace', 'Workspace')}
          >
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <div className="text-sm font-semibold text-slate-700">{headerLabel}</div>
          <div className="w-9" />
        </div>
        <div className="platform-content mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};
