import React, { useEffect, useState } from 'react';
import { api, isDemoMode } from '../services/api';
import { Download, Database, Plus, X, UploadCloud, Link as LinkIcon, Eye } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useI18n } from '../services/i18n';

interface Dataset {
    id: string;
    name: string;
    path: string;
    format: string;
    createdAt: string;
    sizeBytes?: number;
    description?: string;
}

export const DatasetRegistry: React.FC = () => {
    const { tx, locale } = useI18n();
    const [datasets, setDatasets] = useState<Dataset[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [mode, setMode] = useState<'upload' | 'register'>('upload');
    const [uploadName, setUploadName] = useState('');
    const [uploadDescription, setUploadDescription] = useState('');
    const [uploadFormat, setUploadFormat] = useState('jsonl');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [registerName, setRegisterName] = useState('');
    const [registerDescription, setRegisterDescription] = useState('');
    const [registerFormat, setRegisterFormat] = useState('jsonl');
    const [registerPath, setRegisterPath] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [previewTarget, setPreviewTarget] = useState<Dataset | null>(null);
    const [previewData, setPreviewData] = useState<any>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        api.getDatasets()
          .then(items => setDatasets(items as Dataset[]))
          .catch(() => setDatasets([]));
    }, []);

    const refresh = () => api.getDatasets().then(items => setDatasets(items as Dataset[]));

    const openPreview = async (ds: Dataset) => {
        setPreviewTarget(ds);
        setPreviewLoading(true);
        setPreviewData(null);
        try {
            const data = await api.getDatasetPreview(ds.id);
            setPreviewData(data);
        } catch (err) {
            const detail = err instanceof Error ? err.message : tx('预览失败', 'Preview failed');
            showToast(detail, 'error');
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleDownload = async (ds: Dataset) => {
        try {
            const { url } = await api.getDatasetDownloadUrl(ds.id);
            window.open(url, '_blank', 'noreferrer');
        } catch (err) {
            const detail = err instanceof Error ? err.message : tx('下载失败', 'Download failed');
            showToast(detail, 'error');
        }
    };

    const resetModal = () => {
        setUploadName('');
        setUploadDescription('');
        setUploadFormat('jsonl');
        setUploadFile(null);
        setRegisterName('');
        setRegisterDescription('');
        setRegisterFormat('jsonl');
        setRegisterPath('');
    };

    const handleUpload = async () => {
        if (!uploadName.trim() || !uploadFile) {
            showToast(tx('请填写名称并选择文件。', 'Please provide a name and select a file.'), 'error');
            return;
        }
        setIsSubmitting(true);
        try {
            await api.uploadDataset({
                name: uploadName.trim(),
                description: uploadDescription.trim() || undefined,
                format: uploadFormat,
                file: uploadFile,
            });
            showToast(tx('数据集上传成功。', 'Dataset uploaded successfully.'), 'success');
            await refresh();
            setIsModalOpen(false);
            resetModal();
        } catch (err) {
            const detail = err instanceof Error ? err.message : tx('上传失败', 'Upload failed');
            showToast(detail, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRegister = async () => {
        if (!registerName.trim() || !registerPath.trim()) {
            showToast(tx('请填写名称和数据集路径。', 'Please provide a name and dataset path.'), 'error');
            return;
        }
        setIsSubmitting(true);
        try {
            await api.registerDataset({
                name: registerName.trim(),
                description: registerDescription.trim() || undefined,
                path: registerPath.trim(),
                format: registerFormat,
            });
            showToast(tx('数据集注册成功。', 'Dataset registered successfully.'), 'success');
            await refresh();
            setIsModalOpen(false);
            resetModal();
        } catch (err) {
            const detail = err instanceof Error ? err.message : tx('注册失败', 'Registration failed');
            showToast(detail, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-gray-900">{tx('数据集仓库', 'Dataset Registry')}</h1>
                    {isDemoMode && (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            {tx('演示数据', 'Demo Data')}
                        </span>
                    )}
                </div>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center hover:bg-blue-700"
                >
                    <Plus className="w-4 h-4 mr-2" /> {tx('上传数据集', 'Upload Dataset')}
                </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 text-xs text-gray-500 font-semibold uppercase">
                        <tr>
                            <th className="px-6 py-3">{tx('名称', 'Name')}</th>
                            <th className="px-6 py-3">{tx('格式', 'Format')}</th>
                            <th className="px-6 py-3">{tx('路径 / S3 Key', 'Path / S3 Key')}</th>
                            <th className="px-6 py-3">{tx('创建时间', 'Created')}</th>
                            <th className="px-6 py-3">{tx('操作', 'Actions')}</th>
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
                                <td className="px-6 py-4 text-sm text-gray-500">{new Date(ds.createdAt).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US')}</td>
                                <td className="px-6 py-4 flex items-center gap-3">
                                    <button
                                      className="text-gray-600 hover:text-gray-900"
                                      onClick={() => openPreview(ds)}
                                      title={tx('预览', 'Preview')}
                                    >
                                      <Eye className="w-4 h-4" />
                                    </button>
                                    <button
                                      className="text-blue-600 hover:text-blue-800"
                                      onClick={() => handleDownload(ds)}
                                      title={tx('下载', 'Download')}
                                    >
                                        <Download className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {datasets.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                                    {tx('未找到数据集，先上传一个开始。', 'No datasets found. Upload one to get started.')}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
              <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                <div className="bg-white w-full max-w-xl rounded-xl shadow-xl border border-gray-200">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">{tx('添加数据集', 'Add Dataset')}</h2>
                    <button
                      onClick={() => { setIsModalOpen(false); resetModal(); }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="px-6 py-4 space-y-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setMode('upload')}
                        className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg border ${
                          mode === 'upload' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1"><UploadCloud className="w-3 h-3" /> {tx('上传文件', 'Upload file')}</span>
                      </button>
                      <button
                        onClick={() => setMode('register')}
                        className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg border ${
                          mode === 'register' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1"><LinkIcon className="w-3 h-3" /> {tx('注册路径', 'Register path')}</span>
                      </button>
                    </div>

                    {mode === 'upload' ? (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">{tx('名称', 'Name')}</label>
                          <input
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            value={uploadName}
                            onChange={e => setUploadName(e.target.value)}
                            placeholder={tx('例如：mujoco-buffer-v1', 'e.g., mujoco-buffer-v1')}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">{tx('描述', 'Description')}</label>
                          <input
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            value={uploadDescription}
                            onChange={e => setUploadDescription(e.target.value)}
                            placeholder={tx('可选备注', 'Optional notes')}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">{tx('格式', 'Format')}</label>
                            <select
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              value={uploadFormat}
                              onChange={e => setUploadFormat(e.target.value)}
                            >
                              <option value="jsonl">jsonl</option>
                              <option value="npz">npz</option>
                              <option value="hdf5">hdf5</option>
                              <option value="pkl">pkl</option>
                              <option value="d4rl">d4rl</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">{tx('文件', 'File')}</label>
                            <input
                              type="file"
                              onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                              className="w-full text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">{tx('名称', 'Name')}</label>
                          <input
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            value={registerName}
                            onChange={e => setRegisterName(e.target.value)}
                            placeholder={tx('例如：s3-marl-dataset', 'e.g., s3-marl-dataset')}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">{tx('描述', 'Description')}</label>
                          <input
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            value={registerDescription}
                            onChange={e => setRegisterDescription(e.target.value)}
                            placeholder={tx('可选备注', 'Optional notes')}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">{tx('格式', 'Format')}</label>
                            <select
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              value={registerFormat}
                              onChange={e => setRegisterFormat(e.target.value)}
                            >
                              <option value="jsonl">jsonl</option>
                              <option value="npz">npz</option>
                              <option value="hdf5">hdf5</option>
                              <option value="pkl">pkl</option>
                              <option value="d4rl">d4rl</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">{tx('路径 / URL / S3', 'Path / URL / S3')}</label>
                            <input
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                              value={registerPath}
                              onChange={e => setRegisterPath(e.target.value)}
                              placeholder={tx('s3://bucket/key 或 /data/file.npz', 's3://bucket/key or /data/file.npz')}
                            />
                          </div>
                        </div>
                        <p className="text-xs text-gray-500">
                          {tx('本地路径在服务端解析；S3 请使用 s3://bucket/key 格式。', 'Local paths are resolved on the server. For S3, use the s3://bucket/key format.')}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                      className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                      onClick={() => { setIsModalOpen(false); resetModal(); }}
                      disabled={isSubmitting}
                    >
                      {tx('取消', 'Cancel')}
                    </button>
                    {mode === 'upload' ? (
                      <button
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        onClick={handleUpload}
                        disabled={isSubmitting}
                      >
                        {tx('上传', 'Upload')}
                      </button>
                    ) : (
                      <button
                        className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                        onClick={handleRegister}
                        disabled={isSubmitting}
                      >
                        {tx('注册', 'Register')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {previewTarget && (
              <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                <div className="bg-white w-full max-w-2xl rounded-xl shadow-xl border border-gray-200">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">{tx('数据集预览', 'Dataset Preview')}</h2>
                      <p className="text-xs text-gray-500">{previewTarget.name}</p>
                    </div>
                    <button
                      onClick={() => { setPreviewTarget(null); setPreviewData(null); }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    {previewLoading && (
                      <div className="text-sm text-gray-500">{tx('加载预览中...', 'Loading preview...')}</div>
                    )}
                    {!previewLoading && previewData && (
                      <>
                        <div className="grid grid-cols-2 gap-4 text-xs text-gray-600">
                          <div><span className="font-semibold">{tx('格式：', 'Format:')}</span> {previewData.format}</div>
                          <div><span className="font-semibold">{tx('大小：', 'Size:')}</span> {previewData.sizeBytes} {tx('字节', 'bytes')}</div>
                          {previewData.sha256 && (
                            <div className="col-span-2">
                              <span className="font-semibold">{tx('SHA256：', 'SHA256:')}</span> <span className="font-mono">{previewData.sha256}</span>
                            </div>
                          )}
                          {previewData.error && (
                            <div className="col-span-2 text-amber-600">
                              {previewData.error}
                            </div>
                          )}
                        </div>
                        {previewData.summary && (
                          <div>
                            <h3 className="text-xs font-semibold text-gray-600 uppercase mb-2">{tx('摘要', 'Summary')}</h3>
                            <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto">
{JSON.stringify(previewData.summary, null, 2)}
                            </pre>
                          </div>
                        )}
                        {previewData.sample && (
                          <div>
                            <h3 className="text-xs font-semibold text-gray-600 uppercase mb-2">{tx('样例', 'Sample')}</h3>
                            <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto">
{JSON.stringify(previewData.sample, null, 2)}
                            </pre>
                          </div>
                        )}
                        {!previewData.summary && !previewData.sample && (
                          <div className="text-xs text-gray-500">{tx('暂无可用预览数据。', 'No preview data available.')}</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
        </div>
    );
};
