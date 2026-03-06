'use client';

import { motion } from 'framer-motion';
import { Beaker } from 'lucide-react';

export default function AgenticLab() {
  return (
    <div className="flex-1 flex flex-col bg-zinc-50 overflow-hidden">
      {/* Top Bar */}
      <div className="h-14 border-b border-zinc-200 bg-white flex items-center px-6 shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <Beaker className="w-4 h-4 text-indigo-500" />
          <h1 className="text-sm font-bold text-zinc-800 tracking-tight">Agentic Lab Canvas</h1>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">Status: Idle</span>
          <button className="px-4 py-1.5 bg-zinc-900 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-indigo-600 transition-colors shadow-lg shadow-zinc-200">
            Run Workflow
          </button>
        </div>
      </div>

      {/* Canvas Area (Mock) */}
      <div className="flex-1 relative p-8 flex items-center justify-center">
        {/* Background Dot Pattern */}
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #e4e4e7 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="relative bg-white border border-zinc-200 p-6 rounded-2xl shadow-xl shadow-zinc-200/50 w-80 z-10"
        >
          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 mb-2">LLM Node</div>
          <h3 className="font-bold text-zinc-800 text-sm">Reward Function Generator</h3>
          <p className="text-xs text-zinc-500 mt-2 leading-relaxed">Prompts GPT-4 to generate dense reward functions based on environment code.</p>
        </motion.div>
      </div>
    </div>
  );
}
