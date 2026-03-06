'use client';

import ReactECharts from 'echarts-for-react';
import { FrontierGroup } from '@/types';

interface FrontierChartProps {
  group: FrontierGroup;
}

export default function FrontierChart({ group }: FrontierChartProps) {
  const { benchmark, budget_type, frontier, points } = group;

  // Prepare frontier line data (sorted by x for smooth line)
  const frontierData = [...frontier]
    .sort((a, b) => a.budget_value - b.budget_value)
    .map(p => [p.budget_value, p.score]);

  // Prepare all points data
  const pointsData = points.map(p => ({
    name: p.paper_uid,
    value: [p.budget_value, p.score],
    title: p.title
  }));

  const option = {
    title: {
      text: `${benchmark} (${budget_type})`,
      left: 'center',
      textStyle: { fontSize: 14, fontWeight: 'bold', color: '#64748b' }
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        const data = params.data;
        const title = data.title || data.name || 'Unknown Paper';
        return `
          <div style="font-family: sans-serif; padding: 8px; max-width: 300px; white-space: normal;">
            <div style="font-weight: bold; border-bottom: 1px solid #eee; margin-bottom: 6px; padding-bottom: 4px; line-height: 1.2;">
              ${title.length > 100 ? title.slice(0, 100) + '...' : title}
            </div>
            <div style="font-size: 11px; color: #666;">
              Budget (${budget_type}): <b style="color: #333;">${data.value[0] || 'N/A'}</b><br/>
              Score (${benchmark}): <b style="color: #333;">${data.value[1]}</b>
            </div>
          </div>
        `;
      }
    },
    grid: { left: '10%', right: '10%', bottom: '15%', top: '20%' },
    xAxis: {
      name: `Budget (${budget_type})`,
      nameLocation: 'middle',
      nameGap: 30,
      type: 'value',
      splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }
    },
    yAxis: {
      name: 'Score',
      type: 'value',
      splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } }
    },
    series: [
      {
        name: 'Frontier',
        type: 'line',
        data: frontierData,
        step: 'end', // Step line for Pareto front
        lineStyle: { color: '#3b82f6', width: 3 },
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: { color: '#3b82f6' },
        z: 10
      },
      {
        name: 'All Papers',
        type: 'scatter',
        data: pointsData,
        symbolSize: 10,
        itemStyle: {
          color: '#94a3b8',
          opacity: 0.6
        }
      }
    ]
  };

  return (
    <div className="w-full h-80 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
