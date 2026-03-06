'use client';

import { motion } from 'framer-motion';
import { Layers, ArrowRight } from 'lucide-react';

export default function AlgorithmRegistry() {
  return (
    <div className="flex-1 overflow-y-auto bg-white p-12 lg:p-20">
      <div className="max-w-6xl mx-auto space-y-12">
        <header>
          <motion.h1 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-black tracking-tighter text-zinc-900"
          >
            Algorithms
          </motion.h1>
          <p className="text-zinc-400 mt-2 text-sm">Registered RL and MARL algorithm configurations.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {['PPO (Proximal Policy Optimization)', 'MAPPO (Multi-Agent PPO)', 'SAC (Soft Actor-Critic)', 'QMIX'].map((algo, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              key={i}
              className="group p-6 rounded-3xl bg-white border border-zinc-100 hover:border-indigo-600 transition-all duration-500 cursor-pointer flex items-center justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-editorial-mono">
                  <Layers className="w-4 h-4 text-zinc-300 group-hover:text-indigo-500 transition-colors" />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-zinc-800 leading-tight">
                  {algo}
                </h3>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[9px] font-black text-zinc-400 border border-zinc-100 px-1.5 py-0.5 rounded uppercase tracking-tighter">RLlib Default</span>
                </div>
              </div>
              
              <div className="p-2.5 rounded-full border border-zinc-100 group-hover:bg-indigo-600 group-hover:border-indigo-600 group-hover:text-white transition-all duration-500">
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
