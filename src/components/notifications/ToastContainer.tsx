import React from 'react';
import { useStore } from '../../store';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export default function ToastContainer() {
  const { toasts, removeToast } = useStore();

  const iconMap = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const colorMap = {
    success: { border: 'border-l-vetted-success', bg: 'bg-green-50' },
    error: { border: 'border-l-vetted-danger', bg: 'bg-red-50' },
    warning: { border: 'border-l-vetted-warning', bg: 'bg-amber-50' },
    info: { border: 'border-l-vetted-info', bg: 'bg-blue-50' },
  };

  return (
    <div className="fixed top-6 right-6 z-40 space-y-3 max-w-sm">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        const colors = colorMap[toast.type];

        return (
          <div
            key={toast.id}
            className={`${colors.bg} border ${colors.border} border-l-4 rounded-lg p-4 shadow-lg animate-slide-in-right flex gap-3`}
          >
            <Icon size={20} className={`flex-shrink-0 mt-0.5 ${
              toast.type === 'success' ? 'text-vetted-success' :
              toast.type === 'error' ? 'text-vetted-danger' :
              toast.type === 'warning' ? 'text-vetted-warning' :
              'text-vetted-info'
            }`} />

            <div className="flex-1 min-w-0">
              <p className="font-medium text-vetted-primary text-sm">{toast.title}</p>
              {toast.detail && (
                <p className="text-xs text-vetted-text-secondary mt-1">{toast.detail}</p>
              )}
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action?.onClick();
                    removeToast(toast.id);
                  }}
                  className="text-xs font-medium mt-2 text-vetted-primary hover:underline"
                >
                  {toast.action.label}
                </button>
              )}
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 p-1 hover:bg-black/10 rounded transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
