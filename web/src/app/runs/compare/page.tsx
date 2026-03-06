'use client';

import { GitCompare } from 'lucide-react';

export default function CompareRuns() {
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compare Runs</h1>
          <p className="text-gray-500 text-sm mt-1">Select multiple runs to visualize differences in hyperparameters and metrics.</p>
        </div>
        <button className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 shadow-sm transition-colors">
          Select Runs
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
          <GitCompare className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No runs selected</h3>
        <p className="text-gray-500 text-sm max-w-sm">
          Please select at least two runs from the job queue or project dashboard to compare their configuration and learning curves side-by-side.
        </p>
      </div>
    </div>
  );
}
