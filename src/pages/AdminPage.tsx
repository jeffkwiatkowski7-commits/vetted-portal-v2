import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { Wrench, Users, Zap, AlertCircle, CheckCircle, CheckCircle2, BarChart2, MessageSquare, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

interface Stats {
  total_users?: number;
  active_today?: number;
  total_projects?: number;
  total_library_files?: number;
  tool_sets?: number;
  mcp_servers?: number;
  models?: number;
  system_prompts?: number;
}

interface HealthStatus {
  tool_sets?: { status: string };
  models?: { status: string };
}

export default function AdminPage() {
  const navigate = useNavigate();
  const { user, addToast } = useStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<any[]>([]);
  const [expandedErrorId, setExpandedErrorId] = useState<number | null>(null);

  const loadAdminData = async () => {
    try {
      const [statsData, healthData, errorsData] = await Promise.all([
        api.admin.stats(),
        api.admin.health(),
        api.admin.errors(),
      ]);
      setStats(statsData);
      setHealth(healthData);
      setErrors(errorsData);
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to load admin data' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'super_admin') {
      navigate('/');
      return;
    }
    loadAdminData();
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(loadAdminData, 30000);
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
      else { loadAdminData(); startPolling(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary">Loading admin dashboard...</p>
      </div>
    );
  }

  const resourceCards = [
    {
      label: 'MCP Servers',
      count: stats?.mcp_servers || 0,
      icon: Wrench,
      path: '/admin/tool-sets',
    },
    {
      label: 'Model Configuration',
      count: stats?.models || 0,
      icon: Zap,
      path: '/admin/models',
    },
    {
      label: 'System Prompts',
      count: stats?.system_prompts || 0,
      icon: AlertCircle,
      path: '/admin/system-prompts',
    },
  ];

  const statCards = [
    { label: 'Total Users', value: stats?.total_users || 0 },
    { label: 'Active Today', value: stats?.active_today || 0 },
    { label: 'Projects', value: stats?.total_projects || 0 },
    { label: 'Library Files', value: stats?.total_library_files || 0 },
  ];

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
      await loadAdminData();
      addToast({ type: 'success', title: 'Errors cleared' });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to clear errors' });
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-vetted-border p-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-serif text-vetted-primary">Admin Dashboard</h1>
          {errors.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-medium">
              {errors.length}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Resources Section */}
        <div>
          <h2 className="text-lg font-medium text-vetted-primary mb-4">Resources</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {resourceCards.map(({ label, count, icon: Icon, path }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="card text-left hover:shadow-lg transition-all hover:border-vetted-accent"
              >
                <div className="flex items-center justify-between mb-3">
                  <Icon size={24} className="text-vetted-accent" />
                </div>
                <p className="text-sm text-vetted-text-secondary mb-1">{label}</p>
                <p className="text-2xl font-serif font-bold text-vetted-primary">{count}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Quick Stats */}
        <div>
          <h2 className="text-lg font-medium text-vetted-primary mb-4">Quick Stats</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map(({ label, value }) => (
              <div key={label} className="card text-center">
                <p className="text-vetted-text-secondary text-sm mb-2">{label}</p>
                <p className="text-4xl font-serif font-bold text-vetted-primary">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Active Errors */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium text-vetted-primary">Active Errors</h2>
              {errors.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-medium">
                  {errors.length}
                </span>
              )}
            </div>
            {errors.length > 0 && (
              <button
                onClick={handleClearErrors}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-vetted-text-secondary hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              >
                <Trash2 size={14} />
                Clear all
              </button>
            )}
          </div>

          {errors.length === 0 ? (
            <div className="card flex items-center gap-3 text-vetted-success">
              <CheckCircle2 size={20} />
              <span className="text-sm">No errors detected</span>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
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
                    {errors.map((err) => {
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

        {/* Support Tools */}
        <div>
          <h2 className="text-lg font-medium text-vetted-primary mb-4">Support Tools</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: 'MCP Servers Health', icon: Wrench },
              { label: 'Model Health', icon: Zap },
            ].map(({ label, icon: Icon }) => (
              <div key={label} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-vetted-primary">{label}</h3>
                  <Icon size={20} className="text-vetted-accent" />
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} className="text-vetted-success" />
                  <span className="text-sm text-vetted-success">Operational</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Navigation Buttons */}
        <div className="pt-4 space-y-2">
          <button
            onClick={() => navigate('/admin/users')}
            className="w-full btn-primary flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <Users size={18} />
              Manage Users
            </span>
          </button>
          <button
            onClick={() => navigate('/admin/chats')}
            className="w-full btn-primary flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <MessageSquare size={18} />
              Chat History
            </span>
          </button>
          <button
            onClick={() => navigate('/admin/usage')}
            className="w-full btn-primary flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <BarChart2 size={18} />
              Usage Log
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
