'use client';

import { PaperDiff } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { 
  AlertTriangle, Quote, Trophy, Activity, Zap, Cpu, 
  ShieldCheck, Target, FlaskConical, ArrowRight
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DiffMatrixProps {
  diff: PaperDiff;
}

export default function DiffMatrix({ diff }: DiffMatrixProps) {
  const { showEvidence } = useAppStore();
  const { delta_json: delta, evidence_index_json: evidenceIndex } = diff;

  const handleEvidenceClick = (key: string) => {
    const spans = evidenceIndex[key];
    if (spans && spans.length > 0) showEvidence(spans);
  };

  const DissectionAxis = ({ 
    label, 
    keyName, 
    icon: Icon,
    children,
    urgent = false 
  }: { 
    label: string, 
    keyName: string, 
    icon: any,
    children: React.ReactNode,
    urgent?: boolean
  }) => (
    <div className="group py-10 border-b border-zinc-50 last:border-0">
      <div className="flex items-center gap-3 mb-6">
        <Icon className={cn("w-3 h-3", urgent ? "text-indigo-600" : "text-zinc-300")} />
        <span className="text-editorial-mono">{label}</span>
      </div>
      <div className={cn("left-accent space-y-4", urgent && "border-indigo-600")}>
        <div className="text-editorial-body text-zinc-800 leading-relaxed font-semibold">
          {children}
        </div>
        {evidenceIndex[keyName] && (
          <button 
            onClick={() => handleEvidenceClick(keyName)}
            className="text-[9px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-1.5 hover:underline"
          >
            Trace Evidence <ArrowRight className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-10 pb-32">
      {/* Comparison Context */}
      <header className="mb-16 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded uppercase tracking-widest">
            {delta.novelty_tag || 'Mutation'}
          </span>
        </div>
        <h3 className="text-3xl font-black tracking-tighter text-zinc-900 leading-none">
          Logic Dissection.
        </h3>
      </header>

      {diff.protocol_shift_flag === 1 && (
        <div className="mb-12 p-6 bg-amber-50/50 border-l-2 border-amber-500 text-amber-800">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">Protocol Shift detected</span>
          </div>
          <p className="text-xs font-bold leading-relaxed opacity-80">{diff.protocol_shift_reason}</p>
        </div>
      )}

      {/* Dissection Stream */}
      <div className="space-y-2">
        <DissectionAxis label="Mechanism" keyName="mechanism_delta" icon={Cpu} urgent>
          <p className="text-xl font-black tracking-tight text-zinc-900 mb-2">
            One-Knife: {delta.mechanism_delta.one_knife_kind.toUpperCase()}
          </p>
          <p>{delta.mechanism_delta.llm_summary || "机制演进描述缺失"}</p>
        </DissectionAxis>

        <DissectionAxis label="Assumptions" keyName="assumption_delta" icon={FlaskConical}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <p className="text-[9px] font-bold text-zinc-300 uppercase">Introduced</p>
              <ul className="space-y-1 text-xs font-bold">
                {delta.assumption_delta.added_assumptions?.map((a: string, i: number) => (
                  <li key={i}>+ {a}</li>
                )) || <li className="opacity-20 italic">None</li>}
              </ul>
            </div>
            <div className="space-y-2">
              <p className="text-[9px] font-bold text-zinc-300 uppercase">Discarded</p>
              <ul className="space-y-1 text-xs font-bold opacity-40 line-through">
                {delta.assumption_delta.removed_assumptions?.map((a: string, i: number) => (
                  <li key={i}>- {a}</li>
                )) || <li className="opacity-20 italic">None</li>}
              </ul>
            </div>
          </div>
        </DissectionAxis>

        <DissectionAxis label="Objective" keyName="objective_delta" icon={Target}>
          <p className={delta.objective_delta.changed ? "text-zinc-900" : "text-zinc-400 opacity-50"}>
            {delta.objective_delta.llm_summary || "目标对齐正常"}
          </p>
        </DissectionAxis>

        <DissectionAxis label="Tradeoff" keyName="tradeoff_delta" icon={ShieldCheck}>
          <div className="space-y-4">
            <p className="italic opacity-70">{delta.tradeoff_delta.llm_summary || "无明显权衡变动"}</p>
            {delta.tradeoff_delta.limitations_b && (
              <div className="p-4 bg-zinc-50 border-l border-zinc-200">
                <span className="text-[9px] font-black text-amber-600 uppercase block mb-2 tracking-widest">Idea Seed / Opportunity</span>
                <ul className="space-y-2 text-xs font-bold text-zinc-700">
                  {delta.tradeoff_delta.limitations_b.map((l: string, i: number) => (
                    <li key={i} className="flex gap-2"><span>•</span> {l}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </DissectionAxis>

        <DissectionAxis label="Results" keyName="result_delta" icon={Trophy}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
            {delta.result_delta.rows?.map((row: any, idx: number) => (
              <div key={idx} className="p-4 bg-zinc-50/50 flex flex-col items-center">
                <span className="text-[8px] font-bold text-zinc-300 uppercase mb-1">{row.benchmark}</span>
                <span className={cn(
                  "text-lg font-black font-mono tracking-tighter",
                  row.delta_b_minus_a > 0 ? "text-emerald-600" : "text-rose-500"
                )}>
                  {row.delta_b_minus_a > 0 ? '+' : ''}{row.delta_b_minus_a.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </DissectionAxis>
      </div>
    </div>
  );
}
