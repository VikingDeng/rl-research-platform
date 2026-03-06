'use client';

import { Box, Download, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function ModelRegistry() {
  const { data: models = [], isLoading } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.getModels(),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">模型库 (Model Registry)</h1>
          <p className="text-gray-500 text-sm mt-1">已版本化管理并准备好评估的最终策略和 Checkpoints。</p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text" 
            placeholder="搜索模型..." 
            className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full py-12 text-center text-gray-500">加载中...</div>
        ) : models.length === 0 ? (
          <div className="col-span-full py-12 text-center text-gray-500">暂无注册的模型。</div>
        ) : models.map((model: any) => (
          <div key={model.id || model.name} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:shadow-md transition-shadow flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
                <Box className="w-5 h-5" />
              </div>
              <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded">Latest</span>
            </div>
            
            <h3 className="font-bold text-gray-900 text-lg mb-1">{model.name}</h3>
            <p className="text-gray-500 text-sm line-clamp-2 mb-4">
              {model.description || '无详细描述。'}
            </p>
            
            <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between">
              <div className="flex gap-2">
                <span className="text-[10px] font-medium text-gray-500 border border-gray-200 px-2 py-0.5 rounded">PyTorch</span>
              </div>
              <button className="text-gray-400 hover:text-gray-900 transition-colors">
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
