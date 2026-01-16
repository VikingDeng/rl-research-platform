# Dataset Registry Page (Placeholder for MVP)
import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Download, Database, Plus } from 'lucide-react';

interface Dataset {
    id: string;
    name: string;
    path: string;
    format: string;
    createdAt: string;
}

export const DatasetRegistry: React.FC = () => {
    const [datasets, setDatasets] = useState<Dataset[]>([]);

    useEffect(() => {
        // Mock fetch or real fetch if API client updated
        // api.getDatasets().then(setDatasets); 
        // Since we didn't regenerate client, we use fetch manually for this new endpoint
        fetch('/api/v1/datasets').then(res => res.json()).then(data => {
            if (Array.isArray(data)) setDatasets(data);
        });
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-900">Dataset Registry</h1>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center hover:bg-blue-700">
                    <Plus className="w-4 h-4 mr-2" /> Upload Dataset
                </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 text-xs text-gray-500 font-semibold uppercase">
                        <tr>
                            <th className="px-6 py-3">Name</th>
                            <th className="px-6 py-3">Format</th>
                            <th className="px-6 py-3">Path / S3 Key</th>
                            <th className="px-6 py-3">Created</th>
                            <th className="px-6 py-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {datasets.map(ds => (
                            <tr key={ds.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 flex items-center gap-3">
                                    <div className="p-2 bg-purple-50 text-purple-600 rounded">
                                        <Database className="w-4 h-4"/>
                                    </div>
                                    <span className="font-medium text-gray-900">{ds.name}</span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600 uppercase">{ds.format}</td>
                                <td className="px-6 py-4 text-sm text-gray-500 font-mono">{ds.path}</td>
                                <td className="px-6 py-4 text-sm text-gray-500">{new Date(ds.createdAt).toLocaleDateString()}</td>
                                <td className="px-6 py-4">
                                    <button className="text-blue-600 hover:text-blue-800">
                                        <Download className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {datasets.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                                    No datasets found. Upload one to get started.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
