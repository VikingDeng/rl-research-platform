'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, ListTodo, Settings, Box, Layers, 
  Monitor, GitCompare, Sparkles
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navGroups = [
  {
    label: '概览 (Overview)',
    items: [
      { name: '仪表盘 (Dashboard)', href: '/', icon: LayoutDashboard },
      { name: '任务队列 (Runs)', href: '/jobs', icon: ListTodo },
    ]
  },
  {
    label: '资产库 (Assets)',
    items: [
      { name: '模型库 (Models)', href: '/registry/models', icon: Box },
      { name: '算法库 (Algorithms)', href: '/registry/algorithms', icon: Layers },
      { name: '环境库 (Environments)', href: '/registry/environments', icon: Monitor },
    ]
  },
  {
    label: '研究工具 (Workspaces)',
    items: [
      { name: 'Agentic Lab', href: '/agentic', icon: Sparkles },
      { name: '运行对比 (Compare)', href: '/runs/compare', icon: GitCompare },
    ]
  }
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="w-64 flex flex-col bg-white border-r border-gray-200 h-full z-10">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-gray-100 shrink-0">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center text-white font-bold text-sm shadow-sm group-hover:bg-blue-700 transition-colors">
            RL
          </div>
          <span className="font-semibold text-gray-900 tracking-tight">科研平台 (Research)</span>
        </Link>
      </div>

      {/* Nav Links */}
      <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isStrictActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 text-sm font-medium",
                      isStrictActive 
                        ? "bg-blue-50 text-blue-700" 
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    )}
                  >
                    <item.icon className={cn(
                      "w-4 h-4", 
                      isStrictActive ? "text-blue-600" : "text-gray-400"
                    )} />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Settings */}
      <div className="p-4 border-t border-gray-100">
        <Link 
          href="/settings" 
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <Settings className="w-4 h-4 text-gray-400" />
          系统设置
        </Link>
      </div>
    </nav>
  );
}
