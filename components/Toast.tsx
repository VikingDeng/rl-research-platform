import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center p-4 rounded-lg shadow-lg border min-w-[300px] animate-in slide-in-from-right fade-in duration-300 ${
              toast.type === 'success' ? 'bg-white border-green-200 text-green-800' :
              toast.type === 'error' ? 'bg-white border-red-200 text-red-800' :
              'bg-white border-blue-200 text-blue-800'
            }`}
          >
            <div className={`p-1 rounded-full mr-3 ${
                toast.type === 'success' ? 'bg-green-100' :
                toast.type === 'error' ? 'bg-red-100' : 'bg-blue-100'
            }`}>
                {toast.type === 'success' && <CheckCircle className="w-4 h-4" />}
                {toast.type === 'error' && <AlertCircle className="w-4 h-4" />}
                {toast.type === 'info' && <Info className="w-4 h-4" />}
            </div>
            <p className="text-sm font-medium flex-1">{toast.message}</p>
            <button onClick={() => removeToast(toast.id)} className="ml-2 opacity-50 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};