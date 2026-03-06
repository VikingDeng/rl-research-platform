'use client';

import { motion } from 'framer-motion';
import { Database, ArrowRight } from 'lucide-react';

export default function EnvironmentRegistry() {
  return (
    <div className="flex-1 overflow-y-auto bg-white p-12 lg:p-20">
      <div className="max-w-6xl mx-auto space-y-12">
        <header>
          <motion.h1 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-black tracking-tighter text-zinc-900"
          >
            Environments
          </motion.h1>
          <p className="text-zinc-400 mt-2 text-sm">Gym and PettingZoo environments ready for training.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {['CartPole-v1', 'StarCraft II (SMAC)', 'Hide and Seek (OpenAI)', 'Go (19x19)'].map((env, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              key={i}
              className="group p-6 rounded-3xl bg-white border border-zinc-100 hover:border-indigo-600 transition-all duration-500 cursor-pointer flex flex-col justify-between h-48"
            >
              <div className="space-y-4">
                <div className="flex justify-between items-center text-editorial-mono">
                  <Database className="w-4 h-4 text-zinc-300 group-hover:text-indigo-500 transition-colors" />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-zinc-800 leading-tight">
                  {env}
                </h3>
              </div>
              
              <div className="mt-8 flex justify-end">
                <div className="p-2.5 rounded-full border border-zinc-100 group-hover:bg-indigo-600 group-hover:border-indigo-600 group-hover:text-white transition-all duration-500">
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
