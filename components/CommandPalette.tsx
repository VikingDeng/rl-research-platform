import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Command, LayoutDashboard, PlusCircle, Box, Activity, Grid3X3, FileStack, Settings, Hash, User, ArrowRight } from 'lucide-react';
import { api } from '../services/api';
import { Project, Run } from '../types';

interface CommandItem {
    id: string;
    title: string;
    category: string;
    icon: React.ElementType;
    action: () => void;
}

export const CommandPalette: React.FC = () => {
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
            { id: 'nav-home', title: 'Go to Dashboard', category: 'Navigation', icon: LayoutDashboard, action: () => navigate('/') },
            { id: 'nav-create', title: 'Create New Job', category: 'Navigation', icon: PlusCircle, action: () => navigate('/create-job') },
            { id: 'nav-matrix', title: 'Matrix Analysis', category: 'Navigation', icon: Grid3X3, action: () => navigate('/matrix') },
            { id: 'nav-settings', title: 'Settings', category: 'Navigation', icon: Settings, action: () => navigate('/settings') },
        ];

        const projectItems: CommandItem[] = projects.map(p => ({
            id: `proj-${p.id}`,
            title: p.name,
            category: 'Projects',
            icon: Box,
            action: () => navigate(`/projects/${p.id}`)
        }));

        const runItems: CommandItem[] = runs.slice(0, 10).map(r => ({
            id: `run-${r.id}`,
            title: r.name,
            category: 'Recent Runs',
            icon: Activity,
            action: () => navigate(`/runs/${r.id}`)
        }));

        setItems([...navItems, ...projectItems, ...runItems]);
    });
  }, [isOpen, navigate]);

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
      
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 ring-1 ring-black/5">
        <div className="flex items-center px-4 border-b border-gray-100">
            <Search className="w-5 h-5 text-gray-400 mr-3" />
            <input 
                ref={inputRef}
                className="w-full py-4 bg-transparent border-none text-gray-900 placeholder-gray-400 focus:outline-none text-base"
                placeholder="Type a command or search..."
                value={query}
                onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                onKeyDown={handleKeyDown}
            />
            <div className="hidden sm:flex items-center gap-1">
                <kbd className="px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs text-gray-500 font-sans">Esc</kbd>
            </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2" ref={listRef}>
            {filteredItems.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-500 text-sm">No results found.</div>
            ) : (
                <>
                   {/* Group by category if needed, simplified here */}
                   {filteredItems.map((item, index) => (
                       <div 
                           key={item.id}
                           onClick={() => { item.action(); setIsOpen(false); }}
                           onMouseEnter={() => setSelectedIndex(index)}
                           className={`px-4 py-3 mx-2 rounded-lg cursor-pointer flex items-center justify-between text-sm transition-colors ${
                               index === selectedIndex ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'
                           }`}
                       >
                           <div className="flex items-center gap-3">
                               <item.icon className={`w-4 h-4 ${index === selectedIndex ? 'text-blue-200' : 'text-gray-400'}`} />
                               <span className="font-medium">{item.title}</span>
                           </div>
                           <div className={`text-xs ${index === selectedIndex ? 'text-blue-200' : 'text-gray-400'}`}>
                               {item.category}
                           </div>
                       </div>
                   ))}
                </>
            )}
        </div>
        
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between items-center text-xs text-gray-500">
            <div className="flex gap-4">
                <span><strong className="font-medium text-gray-700">↑↓</strong> to navigate</span>
                <span><strong className="font-medium text-gray-700">↵</strong> to select</span>
            </div>
            <div>
                RL Platform v1.0
            </div>
        </div>
      </div>
    </div>
  );
};