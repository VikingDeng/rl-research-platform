import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LayoutDashboard, PlusCircle, Box, Activity, Grid3X3, Settings } from 'lucide-react';
import { api } from '../services/api';
import { useI18n } from '../services/i18n';

interface CommandItem {
    id: string;
    title: string;
    category: string;
    icon: React.ElementType;
    action: () => void;
}

export const CommandPalette: React.FC = () => {
  const { tx } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [items, setItems] = useState<CommandItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Load searchable data
  useEffect(() => {
    if (!isOpen) return;
    
    Promise.all([api.getProjects(), api.getRuns()]).then(([projects, runs]) => {
        const navItems: CommandItem[] = [
            { id: 'nav-home', title: tx('前往仪表盘', 'Go to Dashboard'), category: tx('导航', 'Navigation'), icon: LayoutDashboard, action: () => navigate('/') },
            { id: 'nav-create', title: tx('创建新任务', 'Create New Job'), category: tx('导航', 'Navigation'), icon: PlusCircle, action: () => navigate('/create-job') },
            { id: 'nav-matrix', title: tx('矩阵分析', 'Matrix Analysis'), category: tx('导航', 'Navigation'), icon: Grid3X3, action: () => navigate('/matrix') },
            { id: 'nav-settings', title: tx('系统设置', 'Settings'), category: tx('导航', 'Navigation'), icon: Settings, action: () => navigate('/settings') },
        ];

        const projectItems: CommandItem[] = projects.map(p => ({
            id: `proj-${p.id}`,
            title: p.name,
            category: tx('项目', 'Projects'),
            icon: Box,
            action: () => navigate(`/projects/${p.id}`)
        }));

        const runItems: CommandItem[] = runs.slice(0, 10).map(r => ({
            id: `run-${r.id}`,
            title: r.name,
            category: tx('最近运行', 'Recent Runs'),
            icon: Activity,
            action: () => navigate(`/runs/${r.id}`)
        }));

        setItems([...navItems, ...projectItems, ...runItems]);
    });
  }, [isOpen, navigate, tx]);

  // Keyboard Event Listeners
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(open => !open);
      }
      if (e.key === 'Escape') {
          setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);

  // Filter items
  const filteredItems = items.filter(item => 
      item.title.toLowerCase().includes(query.toLowerCase()) || 
      item.category.toLowerCase().includes(query.toLowerCase())
  );

  // Keyboard Navigation inside List
  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex(i => (i + 1) % filteredItems.length);
      } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex(i => (i - 1 + filteredItems.length) % filteredItems.length);
      } else if (e.key === 'Enter') {
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
              filteredItems[selectedIndex].action();
              setIsOpen(false);
          }
      }
  };

  // Focus input on open
  useEffect(() => {
      if (isOpen) {
          setTimeout(() => inputRef.current?.focus(), 50);
          setQuery('');
          setSelectedIndex(0);
      }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => setIsOpen(false)}></div>
      
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white/94 shadow-[0_24px_50px_rgba(15,23,42,0.22)] ring-1 ring-slate-200/70 backdrop-blur-md animate-in fade-in zoom-in duration-200">
        <div className="flex items-center border-b border-slate-200 px-4">
            <Search className="w-5 h-5 text-gray-400 mr-3" />
            <input 
                ref={inputRef}
                className="w-full border-none bg-transparent py-4 text-base text-slate-900 placeholder-slate-400 focus:outline-none"
                placeholder={tx('输入命令或搜索...', 'Type a command or search...')}
                value={query}
                onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                onKeyDown={handleKeyDown}
            />
            <div className="hidden sm:flex items-center gap-1">
                <kbd className="rounded border border-slate-200 bg-slate-100/90 px-2 py-0.5 text-xs font-sans text-slate-500">Esc</kbd>
            </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2" ref={listRef}>
            {filteredItems.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">{tx('无匹配结果。', 'No results found.')}</div>
            ) : (
                <>
                   {/* Group by category if needed, simplified here */}
                   {filteredItems.map((item, index) => (
                       <div 
                           key={item.id}
                           onClick={() => { item.action(); setIsOpen(false); }}
                           onMouseEnter={() => setSelectedIndex(index)}
                           className={`mx-2 flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 text-sm transition-colors ${
                               index === selectedIndex ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-[0_12px_22px_rgba(37,99,235,0.3)]' : 'text-slate-700 hover:bg-slate-100/80'
                           }`}
                       >
                           <div className="flex items-center gap-3">
                               <item.icon className={`h-4 w-4 ${index === selectedIndex ? 'text-blue-200' : 'text-slate-400'}`} />
                               <span className="font-medium">{item.title}</span>
                           </div>
                           <div className={`text-xs ${index === selectedIndex ? 'text-blue-200' : 'text-slate-400'}`}>
                               {item.category}
                           </div>
                       </div>
                   ))}
                </>
            )}
        </div>
        
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/85 px-4 py-2 text-xs text-slate-500">
            <div className="flex gap-4">
                <span><strong className="font-medium text-slate-700">↑↓</strong> {tx('切换', 'to navigate')}</span>
                <span><strong className="font-medium text-slate-700">↵</strong> {tx('确认', 'to select')}</span>
            </div>
            <div>
                {tx('RL 平台 v1.0', 'RL Platform v1.0')}
            </div>
        </div>
      </div>
    </div>
  );
};
