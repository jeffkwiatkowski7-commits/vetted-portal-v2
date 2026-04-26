import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import {
  ArrowLeft,
  CheckCircle2,
  Trash2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

export default function AdminErrorsPage() {
  const navigate = useNavigate();
  const { user, addToast } = useStore();
  const [errors, setErrors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedErrorId, setExpandedErrorId] = useState<number | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'server' | 'client'>('all');

  const loadErrors = async () => {
    try {
      const data = await api.admin.errors();
      setErrors(data);
    } catch {
      addToast({ type: 'error', title: 'Failed to load errors' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'super_admin') {
      navigate('/');
      return;
    }
    loadErrors();
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(loadErrors, 30000);
    };
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    if (!document.hidden) startPolling();
    const onVisibility = () => {
      if (document.hidden) stopPolling();
      else { loadErrors(); startPolling(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, navigate]);

  const formatRelativeTime = (isoString: string) => {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const handleClearErrors = async () => {
    if (!window.confirm('Clear all errors? This cannot be undone.')) return;
    try {
      await api.admin.clearErrors();
      setExpandedErrorId(null);
      await loadErrors();
      addToast({ type: 'success', title: 'Errors cleared' });
    } catch {
      addToast({ type: 'error', title: 'Failed to clear errors' });
    }
  };

  const filtered = errors.filter((err) => {
    if (sourceFilter === 'all') return true;
    return err.source === sourceFilter;
  });

  const serverCount = errors.filter((e) => e.source === 'server').length;
  const clientCount = errors.filter((e) => e.source === 'client').length;
  const totalOccurrences = errors.reduce((sum, e) => sum + (e.count || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary">Loading errors...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-vetted-border p-6">
        <button
          onClick={() => navigate('/admin')}
          className="flex items-center gap-1.5 text-sm text-vetted-text-secondary hover:text-vetted-primary mb-3 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Admin
        </button>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-serif text-vetted-primary">Error Log</h1>
              {errors.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-medium">
                  {errors.length}
                </span>
              )}
            </div>
            <p className="text-sm text-vetted-text-secondary mt-1">
              Active server and client errors with occurrence counts
            </p>
          </div>
          {errors.length > 0 && (
            <button
              onClick={handleClearErrors}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-vetted-text-secondary hover:text-red-600 hover:bg-red-50 rounded-lg border border-vetted-border transition-colors"
            >
              <Trash2 size={14} />
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="card">
            <p className="text-xs text-vetted-text-secondary mb-1">Distinct Errors</p>
            <p className="text-3xl font-serif font-bold text-vetted-primary">{errors.length}</p>
          </div>
          <div className="card">
            <p className="text-xs text-vetted-text-secondary mb-1">Total Occurrences</p>
            <p className="text-3xl font-serif font-bold text-vetted-primary">{totalOccurrences}</p>
          </div>
          <div className="card">
            <p className="text-xs text-vetted-text-secondary mb-1">Server / Client</p>
            <p className="text-3xl font-serif font-bold text-vetted-primary">
              {serverCount} <span className="text-vetted-text-muted">/</span> {clientCount}
            </p>
          </div>
        </div>

        {/* Filters */}
        {errors.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-vetted-text-secondary mr-1">Source:</span>
            {(['all', 'server', 'client'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setSourceFilter(opt)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  sourceFilter === opt
                    ? 'bg-vetted-primary text-white border-vetted-primary'
                    : 'border-vetted-border text-vetted-text-secondary hover:border-vetted-accent'
                }`}
              >
                {opt === 'all' ? `All (${errors.length})` : `${opt} (${opt === 'server' ? serverCount : clientCount})`}
              </button>
            ))}
          </div>
        )}

        {/* Table or empty state */}
        {errors.length === 0 ? (
          <div className="card flex items-center gap-3 text-vetted-success">
            <CheckCircle2 size={20} />
            <span className="text-sm">No errors detected</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card text-sm text-vetted-text-secondary">
            No errors match the current filter.
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-vetted-surface border-b border-vetted-border sticky top-0">
                  <tr>
                    <th className="w-6 px-2 py-2"></th>
                    <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Last seen</th>
                    <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Count</th>
                    <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Source</th>
                    <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Message</th>
                    <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Route</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((err) => {
                    const isExpanded = expandedErrorId === err.id;
                    return (
                      <React.Fragment key={err.id}>
                        <tr
                          onClick={() => setExpandedErrorId(isExpanded ? null : err.id)}
                          className="border-b border-vetted-border last:border-0 hover:bg-vetted-surface/50 cursor-pointer"
                        >
                          <td className="px-2 py-2 text-vetted-text-secondary">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </td>
                          <td className="px-4 py-2 text-vetted-text-secondary whitespace-nowrap" title={err.last_seen}>
                            {formatRelativeTime(err.last_seen)}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                              err.count >= 10
                                ? 'bg-red-100 text-red-700 font-bold'
                                : 'bg-gray-100 text-gray-700'
                            }`}>
                              {err.count}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                              err.source === 'server'
                                ? 'bg-gray-200 text-gray-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {err.source}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-vetted-primary max-w-md" title={err.message}>
                            {err.message?.length > 100 ? err.message.slice(0, 100) + '…' : err.message}
                          </td>
                          <td className="px-4 py-2 text-vetted-text-secondary">
                            {err.route || '—'}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-vetted-surface/30 border-b border-vetted-border last:border-0">
                            <td></td>
                            <td colSpan={5} className="px-4 py-3 space-y-2">
                              <div className="text-xs text-vetted-text-secondary">
                                First seen: <span className="text-vetted-primary" title={err.first_seen}>{formatRelativeTime(err.first_seen)}</span>
                                {err.user_agent && (
                                  <> · UA: <span className="text-vetted-primary">{err.user_agent}</span></>
                                )}
                              </div>
                              <div className="text-xs">
                                <div className="text-vetted-text-secondary mb-1">Message</div>
                                <pre className="whitespace-pre-wrap break-words font-mono bg-vetted-bg p-2 rounded border border-vetted-border text-vetted-primary">
                                  {err.message}
                                </pre>
                              </div>
                              {err.stack && (
                                <div className="text-xs">
                                  <div className="text-vetted-text-secondary mb-1">Stack</div>
                                  <pre className="whitespace-pre-wrap break-words font-mono bg-vetted-bg p-2 rounded border border-vetted-border text-vetted-text-secondary max-h-64 overflow-y-auto">
                                    {err.stack}
                                  </pre>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
