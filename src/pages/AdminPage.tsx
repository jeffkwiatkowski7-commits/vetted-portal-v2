import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import {
  Wrench,
  Users,
  Zap,
  AlertCircle,
  CheckCircle2,
  BarChart2,
  MessageSquare,
  FolderOpen,
  BookOpen,
  Activity,
  AlertTriangle,
} from 'lucide-react';

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

  const configCards = [
    {
      label: 'MCP Servers',
      description: 'Connected tool servers and integrations',
      count: stats?.mcp_servers || 0,
      icon: Wrench,
      path: '/admin/tool-sets',
      healthy: health?.tool_sets?.status !== 'down',
    },
    {
      label: 'Model Configuration',
      description: 'Active AI models and routing',
      count: stats?.models || 0,
      icon: Zap,
      path: '/admin/models',
      healthy: health?.models?.status !== 'down',
    },
    {
      label: 'System Prompts',
      description: 'Custom system instructions and guardrails',
      count: stats?.system_prompts || 0,
      icon: AlertCircle,
      path: '/admin/system-prompts',
      healthy: true,
    },
  ];

  const statCards = [
    { label: 'Total Users', value: stats?.total_users || 0, path: '/admin/users' },
    { label: 'Active Today', value: stats?.active_today || 0, path: '/admin/usage' },
    { label: 'Projects', value: stats?.total_projects || 0, path: '/projects' },
    { label: 'Library Files', value: stats?.total_library_files || 0, path: '/library' },
  ];

  const userManagementCards = [
    {
      label: 'Manage Users',
      description: 'Add, edit, and remove user accounts',
      icon: Users,
      path: '/admin/users',
      meta: stats?.total_users != null ? `${stats.total_users} users` : null,
    },
    {
      label: 'Chat History',
      description: 'Audit conversations across the workspace',
      icon: MessageSquare,
      path: '/admin/chats',
      meta: null,
    },
    {
      label: 'Usage Log',
      description: 'Activity and usage analytics',
      icon: BarChart2,
      path: '/admin/usage',
      meta: stats?.active_today != null ? `${stats.active_today} active today` : null,
    },
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

  const statIcon = (label: string) => {
    if (label === 'Total Users') return Users;
    if (label === 'Active Today') return Activity;
    if (label === 'Projects') return FolderOpen;
    if (label === 'Library Files') return BookOpen;
    return Activity;
  };

  const errorCount = errors.length;
  const totalOccurrences = errors.reduce((sum, e) => sum + (e.count || 0), 0);
  const mostRecent = errors.length > 0 ? errors[0] : null;
  const hasErrors = errorCount > 0;

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
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Quick Stats — top */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-medium text-vetted-primary">Quick Stats</h2>
            <p className="text-sm text-vetted-text-secondary">At-a-glance workspace metrics</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map(({ label, value, path }) => {
              const Icon = statIcon(label);
              return (
                <button
                  key={label}
                  onClick={() => navigate(path)}
                  className="card text-left hover:shadow-lg transition-all hover:border-vetted-accent group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Icon size={16} className="text-vetted-accent" />
                    <span className="text-[10px] uppercase tracking-wide text-vetted-text-muted group-hover:text-vetted-accent transition-colors">
                      View →
                    </span>
                  </div>
                  <p className="text-vetted-text-secondary text-xs mb-1">{label}</p>
                  <p className="text-3xl font-serif font-bold text-vetted-primary leading-none">{value}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Configuration */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-medium text-vetted-primary">Configuration</h2>
            <p className="text-sm text-vetted-text-secondary">Workspace-wide AI and tooling settings</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {configCards.map(({ label, description, count, icon: Icon, path, healthy }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="card text-left hover:shadow-lg transition-all hover:border-vetted-accent group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-vetted-accent/10 flex items-center justify-center text-vetted-accent">
                    <Icon size={20} />
                  </div>
                  <span
                    className={`flex items-center gap-1 text-xs font-medium ${
                      healthy ? 'text-vetted-success' : 'text-red-600'
                    }`}
                    title={healthy ? 'Operational' : 'Issue detected'}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        healthy ? 'bg-vetted-success' : 'bg-red-600'
                      }`}
                    />
                    {healthy ? 'Operational' : 'Down'}
                  </span>
                </div>
                <p className="font-medium text-vetted-primary mb-0.5">{label}</p>
                <p className="text-xs text-vetted-text-secondary mb-3 line-clamp-2">{description}</p>
                <div className="flex items-end justify-between">
                  <p className="text-3xl font-serif font-bold text-vetted-primary leading-none">{count}</p>
                  <span className="text-xs text-vetted-text-muted group-hover:text-vetted-accent transition-colors">
                    Manage →
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* System Health (Errors card) */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-medium text-vetted-primary">System Health</h2>
            <p className="text-sm text-vetted-text-secondary">Operational status and error log</p>
          </div>
          <button
            onClick={() => navigate('/admin/errors')}
            className={`card text-left w-full hover:shadow-lg transition-all group ${
              hasErrors
                ? 'border-red-200 hover:border-red-400 bg-red-50/30'
                : 'hover:border-vetted-accent'
            }`}
          >
            <div className="flex items-start gap-4">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                  hasErrors ? 'bg-red-100 text-red-600' : 'bg-vetted-success/10 text-vetted-success'
                }`}
              >
                {hasErrors ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-vetted-primary">Error Log</p>
                  {hasErrors && (
                    <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-medium">
                      {errorCount}
                    </span>
                  )}
                </div>
                {hasErrors ? (
                  <>
                    <p className="text-xs text-vetted-text-secondary mb-2">
                      {errorCount} distinct {errorCount === 1 ? 'error' : 'errors'} · {totalOccurrences} total{' '}
                      {totalOccurrences === 1 ? 'occurrence' : 'occurrences'}
                    </p>
                    {mostRecent && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-vetted-text-muted whitespace-nowrap">
                          {formatRelativeTime(mostRecent.last_seen)}
                        </span>
                        <span className="text-vetted-text-muted">·</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            mostRecent.source === 'server'
                              ? 'bg-gray-200 text-gray-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {mostRecent.source}
                        </span>
                        <span className="text-vetted-primary truncate" title={mostRecent.message}>
                          {mostRecent.message?.length > 80
                            ? mostRecent.message.slice(0, 80) + '…'
                            : mostRecent.message}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-vetted-text-secondary">All systems operational. No errors detected.</p>
                )}
              </div>
              <span className="text-xs text-vetted-text-muted group-hover:text-vetted-accent transition-colors shrink-0">
                View log →
              </span>
            </div>
          </button>
        </section>

        {/* User Management */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-medium text-vetted-primary">User Management</h2>
            <p className="text-sm text-vetted-text-secondary">Accounts, conversations, and activity</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {userManagementCards.map(({ label, description, icon: Icon, path, meta }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="card text-left hover:shadow-lg transition-all hover:border-vetted-accent group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-vetted-accent/10 flex items-center justify-center text-vetted-accent">
                    <Icon size={20} />
                  </div>
                  {meta && (
                    <span className="text-xs text-vetted-text-muted">{meta}</span>
                  )}
                </div>
                <p className="font-medium text-vetted-primary mb-0.5">{label}</p>
                <p className="text-xs text-vetted-text-secondary mb-4 line-clamp-2">{description}</p>
                <span className="text-xs text-vetted-text-muted group-hover:text-vetted-accent transition-colors">
                  Open →
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
