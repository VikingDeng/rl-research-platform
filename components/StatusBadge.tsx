import React from 'react';
import { JobStatus, RunType } from '../types';
import { CheckCircle2, Clock, XCircle, PlayCircle, StopCircle, RefreshCw } from 'lucide-react';

interface Props {
  status?: JobStatus;
  type?: RunType;
  className?: string;
}

const statusConfig = {
  [JobStatus.RUNNING]: { color: 'text-blue-600 bg-blue-50 border-blue-200', icon: RefreshCw, spin: true },
  [JobStatus.SUCCEEDED]: { color: 'text-green-600 bg-green-50 border-green-200', icon: CheckCircle2, spin: false },
  [JobStatus.FAILED]: { color: 'text-red-600 bg-red-50 border-red-200', icon: XCircle, spin: false },
  [JobStatus.PENDING]: { color: 'text-yellow-600 bg-yellow-50 border-yellow-200', icon: Clock, spin: false },
  [JobStatus.CANCELED]: { color: 'text-gray-500 bg-gray-50 border-gray-200', icon: StopCircle, spin: false },
};

const typeConfig = {
  [RunType.TRAIN]: { color: 'text-indigo-600 bg-indigo-50 border-indigo-200', label: 'TRAIN' },
  [RunType.EVAL]: { color: 'text-purple-600 bg-purple-50 border-purple-200', label: 'EVAL' },
  [RunType.MATRIX]: { color: 'text-orange-600 bg-orange-50 border-orange-200', label: 'MATRIX' },
};

export const StatusBadge: React.FC<Props> = ({ status, type, className = '' }) => {
  if (status) {
    const config = statusConfig[status];
    const Icon = config.icon;
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.color} ${className}`}>
        <Icon className={`w-3 h-3 mr-1 ${config.spin ? 'animate-spin' : ''}`} />
        {status}
      </span>
    );
  }
  if (type) {
    const config = typeConfig[type];
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.color} ${className}`}>
        {config.label}
      </span>
    );
  }
  return null;
};
