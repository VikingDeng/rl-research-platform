'use client';

import { useAppStore } from '@/store/useAppStore';
import { X, ExternalLink, Bookmark } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function EvidenceDrawer() {
  const { evidence, drawerOpen, setDrawerOpen } = useAppStore();

  if (!drawerOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl z-50 flex flex-col transition-transform duration-300">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2">
          <Bookmark className="w-5 h-5 text-blue-500" />
          <h2 className="font-semibold">证据回溯 (Evidence)</h2>
        </div>
        <button 
          onClick={() => setDrawerOpen(false)}
          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md transition-colors"
        >
          <X className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {evidence && evidence.length > 0 ? (
          evidence.map((span, idx) => (
            <div key={`${span.paper_uid}-${idx}`} className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-500">
                  Paper: {span.paper_uid.slice(0, 12)}...
                </span>
                <button className="text-xs text-blue-500 flex items-center gap-1 hover:underline">
                  查看原文 <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              
              <div className="relative p-3 bg-blue-50/50 dark:bg-blue-900/10 border-l-4 border-blue-500 rounded-r-md italic text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                "{span.quote}"
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500 font-mono">
                <div className="flex flex-col">
                  <span>CHUNK HASH</span>
                  <span className="text-slate-700 dark:text-slate-400 truncate">{span.chunk_hash}</span>
                </div>
                <div className="flex flex-col">
                  <span>PAGE / OFFSET</span>
                  <span className="text-slate-700 dark:text-slate-400">
                    {span.page ? `P${span.page}` : 'N/A'} @ {span.offset_start}
                  </span>
                </div>
              </div>
              <hr className="border-slate-100 dark:border-slate-800" />
            </div>
          ))
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 opacity-50">
            <X className="w-12 h-12 stroke-1" />
            <p className="text-sm">当前无选中证据</p>
          </div>
        )}
      </div>

      <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800">
        <p className="text-[10px] text-slate-400 text-center uppercase tracking-widest">
          Evidence-First Verification Layer
        </p>
      </div>
    </div>
  );
}
