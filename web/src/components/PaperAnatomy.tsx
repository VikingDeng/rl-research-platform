'use client';

import { useQuery } from '@tanstack/react-query';
import { getPaperAnatomy } from '@/lib/actions';
import { useAppStore } from '@/store/useAppStore';
import { motion } from 'framer-motion';
import { 
  Zap, Target, Cpu, FlaskConical, Quote, 
  BarChart2, ChevronRight, Bookmark, GitBranch, AlertCircle,
  FileText, Activity, ShieldCheck, Microscope, ArrowRight,
  ExternalLink
} from 'lucide-react';
import { PaperLedgerV2, EvidenceSpan } from '@/types';
import { getPdfUrl } from '@/lib/utils';

export default function PaperAnatomy({ paperUid }: { paperUid: string }) {
  const { showEvidence } = useAppStore();
  const { data, isLoading } = useQuery({
    queryKey: ['anatomy', paperUid],
    queryFn: () => getPaperAnatomy(paperUid),
  });

  if (isLoading) return <div className="p-12 space-y-12 animate-pulse">
    <div className="h-4 w-32 bg-zinc-50 rounded" />
    <div className="space-y-4">
      <div className="h-32 w-full bg-zinc-50 rounded-3xl" />
      <div className="h-32 w-full bg-zinc-50 rounded-3xl" />
    </div>
  </div>;

  if (data?.mode === 'legacy') {
    return <LegacyAnatomy data={data} paperUid={paperUid} showEvidence={showEvidence} />;
  }

  const systematicData = data as any;
  const ledger: PaperLedgerV2 = systematicData?.ledger;
  if (!ledger || !data) return <div className="p-20 text-center text-zinc-300 font-bold uppercase tracking-widest">No Analysis Found</div>;

  const pdfUrl = getPdfUrl(paperUid);

  return (
    <div className="flex flex-col h-full bg-white selection:bg-indigo-50">
      
      {/* 1. Header: The Identity & PDF Button */}
      <header className="p-10 border-b border-zinc-50 space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-editorial-mono text-indigo-600">
            <Microscope className="w-3 h-3" /> <span>Systematic Ledger V2</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${
              systematicData.status === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {systematicData.status === 'ok' ? '解析完整' : '解析受限'}
            </span>
            <span className="text-[9px] font-black px-2 py-0.5 rounded bg-zinc-900 text-white uppercase">
              置信度: {Math.round(systematicData.readiness)}%
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-3xl font-black tracking-tighter text-zinc-900 leading-tight">
            {ledger.paper_identity.title}
          </h2>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-editorial-mono text-zinc-400">
              <span>{ledger.paper_identity.venue} {ledger.paper_identity.year}</span>
            </div>
            {pdfUrl && (
              <a 
                href={pdfUrl} 
                target="_blank" 
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
              >
                阅读原文 PDF <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-hide p-10 space-y-24 pb-40">
        
        {/* 如果解析状态不佳，显示警告 */}
        {systematicData.status !== 'ok' && (
          <div className="p-6 bg-amber-50 rounded-[2rem] border border-amber-100 space-y-2">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="w-4 h-4" />
              <span className="text-xs font-black uppercase tracking-widest">分析不完整</span>
            </div>
            <p className="text-xs font-bold text-amber-800/60 leading-relaxed">
              后端引擎在提取该论文时未能获得足够的上下文或证据（原因: {systematicData.ledger?.extraction_meta?.notes || '未知'}）。以下展示的信息可能不完整。
            </p>
          </div>
        )}

        {/* 2. Abstract Logic: Problem & Contribution */}
        <section className="space-y-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-4">
              <h3 className="text-editorial-mono text-zinc-300">Problem Statement</h3>
              <p className="text-sm font-bold text-zinc-800 leading-relaxed">
                {ledger.problem_statement.text || 'N/A'}
              </p>
              {ledger.problem_statement.evidence.length > 0 && (
                <button onClick={() => showEvidence(ledger.problem_statement.evidence)} className="text-[9px] font-black text-indigo-600 uppercase hover:underline">View Evidence</button>
              )}
            </div>
            <div className="space-y-4">
              <h3 className="text-editorial-mono text-zinc-300">Core Contribution</h3>
              <p className="text-sm font-bold text-zinc-800 leading-relaxed">
                {ledger.contribution_summary.text || 'N/A'}
              </p>
              {ledger.contribution_summary.evidence.length > 0 && (
                <button onClick={() => showEvidence(ledger.contribution_summary.evidence)} className="text-[9px] font-black text-indigo-600 uppercase hover:underline">View Evidence</button>
              )}
            </div>
          </div>
        </section>

        {/* 3. Method Signature: The "Knife" */}
        <section className="space-y-8">
          <div className="flex items-center gap-3">
            <Cpu className="w-4 h-4 text-zinc-300" />
            <h3 className="text-editorial-mono">Methodology Signature</h3>
          </div>
          <div className="left-accent space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-zinc-400 uppercase">Knife Types</p>
                <div className="flex flex-wrap gap-2">
                  {ledger.method_signature.knife_types.length > 0 ? ledger.method_signature.knife_types.map((t, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-widest">{t}</span>
                  )) : <span className="text-xs text-zinc-300 italic">None</span>}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-zinc-400 uppercase">Key Operators</p>
                <div className="flex flex-wrap gap-2">
                  {ledger.method_signature.key_operators.length > 0 ? ledger.method_signature.key_operators.map((t, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest">{t}</span>
                  )) : <span className="text-xs text-zinc-300 italic">None</span>}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">Core Objective Form</p>
              <div className="p-6 bg-zinc-50 rounded-3xl italic text-sm font-medium text-zinc-600 leading-relaxed text-center">
                {ledger.method_signature.core_objective_form.text ? `"${ledger.method_signature.core_objective_form.text}"` : '未解析到具体公式/目标'}
              </div>
            </div>
          </div>
        </section>

        {/* 4. Protocol & Results: The Evidence */}
        <section className="space-y-10">
          <div className="flex items-center gap-3">
            <BarChart2 className="w-4 h-4 text-zinc-300" />
            <h3 className="text-editorial-mono">Protocol & Empirical Evidence</h3>
          </div>
          <div className="space-y-12">
            <div className="p-8 rounded-[2rem] border border-zinc-100 bg-white shadow-sm flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[9px] font-black text-zinc-300 uppercase tracking-widest">Primary Budget Axis</span>
                <p className="text-lg font-black text-zinc-900 uppercase italic tracking-tighter">
                  {ledger.protocol_signature.budget.budget_type}
                </p>
              </div>
              <div className="text-right space-y-1">
                <span className="text-[9px] font-black text-zinc-300 uppercase tracking-widest">Stated Value</span>
                <p className="text-lg font-black text-indigo-600">
                  {ledger.protocol_signature.budget.budget_value || 'N/A'} {ledger.protocol_signature.budget.budget_value_unit}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {ledger.results_facts.map((f, i) => (
                <div key={i} className="p-6 bg-zinc-50 flex items-center justify-between group hover:bg-zinc-900 hover:text-white transition-all duration-500">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-tighter opacity-40">{f.benchmark}</p>
                    <p className="text-sm font-bold truncate max-w-[150px]">{f.metric}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-black tracking-tighter tabular-nums">{f.score}</span>
                    <span className="text-[10px] ml-1 font-bold opacity-40">{f.score_unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. Gaps & Limitations: The Innovation Seed */}
        <section className="space-y-8">
          <div className="flex items-center gap-3 text-amber-600">
            <Target className="w-4 h-4" />
            <h3 className="text-editorial-mono text-amber-600">Limitations & Open Problems</h3>
          </div>
          <div className="space-y-4">
            {ledger.limitations_failures.map((lf, i) => (
              <motion.div 
                whileHover={{ x: 5 }}
                key={i} 
                className="p-8 rounded-[2.5rem] bg-amber-50/20 border border-amber-100 transition-all cursor-default"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="px-2 py-0.5 rounded-full bg-white border border-amber-200 text-[9px] font-black text-amber-600 uppercase tracking-widest">
                    {lf.type}
                  </span>
                  <span className="text-[9px] font-bold text-amber-400 uppercase tracking-tighter">Confidence: {Math.round(lf.confidence * 100)}%</span>
                </div>
                <p className="text-base font-black text-amber-900 leading-tight tracking-tight">
                  {lf.statement.text}
                </p>
                {lf.falsifiable_hook && (
                  <p className="mt-4 text-xs font-bold text-amber-700/60 uppercase tracking-tighter border-t border-amber-100 pt-4">
                    Hook: {lf.falsifiable_hook}
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        </section>

        {/* 6. Context: Who else? */}
        {data.relations.length > 0 && (
          <section className="space-y-8 pb-20">
            <div className="flex items-center gap-3">
              <GitBranch className="w-4 h-4 text-zinc-300" />
              <h3 className="text-editorial-mono">脉络关联 (Evolutionary Context)</h3>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {data.relations.map((rel: any, i: number) => {
                const isTarget = rel.paper_b_uid === paperUid;
                const relatedTitle = isTarget ? rel.title_a : rel.title_b;
                const shortRelatedTitle = relatedTitle ? (relatedTitle.includes(':') ? relatedTitle.split(':')[0] : relatedTitle.slice(0, 40) + '...') : '未知论文';
                
                return (
                  <div key={i} className="p-5 rounded-3xl border border-zinc-100 flex items-center justify-between group hover:border-indigo-500 transition-all duration-500 cursor-pointer">
                    <div className="flex items-center gap-6 overflow-hidden">
                      <div className={isTarget ? "text-indigo-600" : "text-zinc-300"}>
                        <ArrowRight className={`w-4 h-4 transform ${isTarget ? 'rotate-0' : 'rotate-180'}`} />
                      </div>
                      <div className="space-y-1 overflow-hidden">
                        <p className="text-xs font-bold text-zinc-800 truncate">
                          {isTarget ? `改进自 ${shortRelatedTitle}` : `被 ${shortRelatedTitle} 改进`}
                        </p>
                        <span className="text-[9px] font-black text-zinc-300 uppercase tracking-widest">{rel.diff_type}</span>
                      </div>
                    </div>
                    {rel.protocol_shift_flag === 1 && (
                      <div className="flex items-center gap-1.5 text-amber-500 shrink-0">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span className="text-[8px] font-black uppercase">Shift</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}

function LegacyAnatomy({ data, paperUid, showEvidence }: any) {
  return (
    <div className="p-20 text-center space-y-6">
      <Microscope className="w-12 h-12 text-zinc-100 mx-auto" />
      <p className="text-editorial-mono">Running legacy analysis mode...</p>
      <button onClick={() => window.location.reload()} className="text-xs font-bold text-indigo-600">Click to Upgrade Ledger</button>
    </div>
  );
}
