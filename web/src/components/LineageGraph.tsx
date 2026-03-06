'use client';

import React, { useMemo } from 'react';
import ReactFlow, { 
  Background, 
  Node, 
  Edge,
  MarkerType,
  ConnectionLineType,
  Handle,
  Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import { LineagePayload } from '@/types';
import { abbreviateVenue, shortenPaperTitle } from '@/lib/utils';

// --- Zen Style Node ---
const PaperNode = ({ data }: { data: any }) => {
  const shortVenue = abbreviateVenue(data.venue);
  const shortTitle = shortenPaperTitle(data.title || data.label);

  return (
    <div className={`group px-4 py-2.5 rounded-xl transition-all duration-500 shadow-sm ${
      data.is_mainline 
        ? 'bg-zinc-900 text-white shadow-zinc-200' 
        : 'bg-white border border-zinc-100 text-zinc-800'
    }`}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="space-y-1 text-left">
        <div className="flex justify-between items-center gap-2">
          <span className={`text-[7px] font-black uppercase tracking-widest ${data.is_mainline ? 'text-zinc-500' : 'text-zinc-300'}`}>
            {shortVenue} {data.year}
          </span>
          {data.is_mainline && <div className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" />}
        </div>
        <h3 className="text-[10px] font-bold leading-tight tracking-tight whitespace-nowrap truncate max-w-[100px]">
          {shortTitle}
        </h3>
      </div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
};

const nodeTypes = { paper: PaperNode };

interface LineageGraphProps {
  data: LineagePayload;
  onEdgeClick: (edge: Edge) => void;
  onNodeClick: (node: Node) => void;
}

export default function LineageGraph({ data, onEdgeClick, onNodeClick }: LineageGraphProps) {
  
  const { nodes, edges } = useMemo(() => {
    // 按年份分组节点
    const years = Array.from(new Set(data.nodes.map(n => n.year))).sort();
    const yearMap = new Map(years.map((y, i) => [y, i]));

    // 计算布局：即便没有 Edge，也要强制按年份分列
    const layoutedNodes: Node[] = data.nodes.map((n) => {
      const yearIdx = yearMap.get(n.year) || 0;
      const nodesInYear = data.nodes.filter(curr => curr.year === n.year);
      const siblingIdx = nodesInYear.indexOf(n);
      
      // 每一列内部最多放 10 个节点，多了就开启新的“子列”
      const subColumnIdx = Math.floor(siblingIdx / 10);
      const rowIdx = siblingIdx % 10;

      return {
        id: n.id,
        type: 'paper',
        position: { 
          // 横向间距：大年份间距 600px + 子列偏移 180px
          x: yearIdx * 600 + subColumnIdx * 180, 
          // 纵向间 dare：固定 100px 紧凑排列
          y: rowIdx * 100 + (subColumnIdx % 2 === 0 ? 0 : 50) // 错落排开减少呆板感
        },
        data: n,
      };
    });

    const rfEdges = data.edges.map((e, idx) => ({
      id: `e-${idx}`,
      source: e.source,
      target: e.target,
      animated: e.edge_type === 'semantic',
      // 强化视觉反馈：引用线用深蓝，语义线用淡紫动效
      style: { 
        stroke: e.edge_type === 'semantic' ? '#818cf8' : '#6366f1', 
        strokeWidth: 2.5,
        opacity: 0.8
      },
      markerEnd: { 
        type: MarkerType.ArrowClosed, 
        color: e.edge_type === 'semantic' ? '#818cf8' : '#6366f1',
        width: 20,
        height: 20
      },
    }));

    return { nodes: layoutedNodes, edges: rfEdges };
  }, [data]);

  return (
    <div className="w-full h-full bg-white overflow-hidden relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onEdgeClick={(_, edge) => onEdgeClick(edge)}
        onNodeClick={(_, node) => onNodeClick(node)}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        minZoom={0.05}
        maxZoom={1.5}
      >
        <Background color="#fafafa" gap={100} size={1} />
      </ReactFlow>
      
      <div className="absolute top-6 left-10 pointer-events-none opacity-[0.03] select-none">
        <p className="text-[120px] font-black text-zinc-900 tracking-tighter uppercase italic leading-none">Timeline</p>
      </div>
    </div>
  );
}
