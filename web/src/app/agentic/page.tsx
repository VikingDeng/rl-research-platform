'use client';

import { useCallback } from 'react';
import { motion } from 'framer-motion';
import { Beaker, Play, Brain, Code2, CheckCircle, Zap } from 'lucide-react';
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap,
  useNodesState, 
  useEdgesState,
  addEdge,
  Handle,
  Position,
  Connection,
  Edge
} from 'reactflow';
import 'reactflow/dist/style.css';

// Custom Node Component for that "SaaS / Sleek" look
const AgentNode = ({ data }: { data: any }) => {
  return (
    <div className="bg-white border border-zinc-200 p-4 rounded-xl shadow-lg shadow-zinc-200/50 w-64">
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-indigo-500 border-none" />
      <div className="flex items-center gap-3 mb-2">
        <div className={`p-2 rounded-lg ${data.color || 'bg-indigo-50 text-indigo-500'}`}>
          {data.icon}
        </div>
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-400">{data.typeLabel}</div>
          <h3 className="font-bold text-zinc-800 text-sm leading-tight">{data.label}</h3>
        </div>
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed">{data.description}</p>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-indigo-500 border-none" />
    </div>
  );
};

const nodeTypes = { agentNode: AgentNode };

const initialNodes = [
  {
    id: '1',
    type: 'agentNode',
    position: { x: 250, y: 50 },
    data: { 
      label: 'Idea Generator', 
      typeLabel: 'LLM Node',
      description: 'Generates novel MARL environment ideas and reward structures.',
      icon: <Brain className="w-4 h-4" />,
      color: 'bg-purple-50 text-purple-600'
    },
  },
  {
    id: '2',
    type: 'agentNode',
    position: { x: 100, y: 250 },
    data: { 
      label: 'Environment Coder', 
      typeLabel: 'Code Agent',
      description: 'Writes PettingZoo compatible environment code in Python.',
      icon: <Code2 className="w-4 h-4" />,
      color: 'bg-blue-50 text-blue-600'
    },
  },
  {
    id: '3',
    type: 'agentNode',
    position: { x: 400, y: 250 },
    data: { 
      label: 'Policy Trainer', 
      typeLabel: 'RL Agent',
      description: 'Trains baseline policies using MAPPO to evaluate environment dynamics.',
      icon: <Zap className="w-4 h-4" />,
      color: 'bg-orange-50 text-orange-600'
    },
  },
  {
    id: '4',
    type: 'agentNode',
    position: { x: 250, y: 450 },
    data: { 
      label: 'Evaluator & Critic', 
      typeLabel: 'QA Node',
      description: 'Reviews training curves and environment code, providing feedback to the Generator.',
      icon: <CheckCircle className="w-4 h-4" />,
      color: 'bg-emerald-50 text-emerald-600'
    },
  },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#818cf8', strokeWidth: 2 } },
  { id: 'e1-3', source: '1', target: '3', animated: true, style: { stroke: '#818cf8', strokeWidth: 2 } },
  { id: 'e2-4', source: '2', target: '4', style: { stroke: '#cbd5e1', strokeWidth: 2 } },
  { id: 'e3-4', source: '3', target: '4', style: { stroke: '#cbd5e1', strokeWidth: 2 } },
];

export default function AgenticLab() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback((params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#818cf8', strokeWidth: 2 } }, eds)), [setEdges]);

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] bg-zinc-50 overflow-hidden relative">
      {/* Top Bar */}
      <div className="h-16 border-b border-zinc-200 bg-white/80 backdrop-blur flex items-center px-6 shrink-0 z-10 shadow-sm relative">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <Beaker className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-base font-bold text-zinc-900 tracking-tight leading-tight">Agentic Lab Canvas</h1>
            <div className="text-[11px] font-medium text-zinc-500">Design automated RL research workflows</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-600">Idle</span>
          </div>
          <button className="flex items-center gap-2 px-5 py-2 bg-zinc-900 text-white text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-indigo-600 transition-colors shadow-lg shadow-zinc-200">
            <Play className="w-3.5 h-3.5" fill="currentColor" />
            Run Workflow
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 relative w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-zinc-50"
        >
          <Background color="#cbd5e1" gap={16} size={1} />
          <Controls className="bg-white border-zinc-200 shadow-md" />
          <MiniMap 
            nodeColor={(node) => {
              switch (node.type) {
                case 'agentNode': return '#818cf8';
                default: return '#cbd5e1';
              }
            }}
            className="border-zinc-200 rounded-xl overflow-hidden shadow-md"
          />
        </ReactFlow>
      </div>
    </div>
  );
}