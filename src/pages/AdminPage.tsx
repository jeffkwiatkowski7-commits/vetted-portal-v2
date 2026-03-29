import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { Wrench, Users, Zap, AlertCircle, CheckCircle, CheckCircle2, BarChart2 } from 'lucide-react';

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
    const interval = setInterval(loadAdminData, 30000);
    return () => clearInterval(interval);
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
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-medium text-vetted-primary">Active Errors</h2>
            {errors.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-medium">
                {errors.length}
              </span>
            )}
          </div>

          {errors.length === 0 ? (
            <div className="card flex items-center gap-3 text-vetted-success">
              <CheckCircle2 size={20} />
              <span className="text-sm">No errors detected</span>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-vetted-surface border-b border-vetted-border sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Time</th>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Source</th>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Level</th>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Message</th>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Route</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((err) => (
                      <tr key={err.id} className="border-b border-vetted-border last:border-0 hover:bg-vetted-surface/50">
                        <td className="px-4 py-2 text-vetted-text-secondary whitespace-nowrap" title={err.timestamp}>
                          {formatRelativeTime(err.timestamp)}
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
                        <td className="px-4 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            err.level === 'error'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {err.level}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-vetted-primary max-w-xs" title={err.message}>
                          {err.message?.length > 80 ? err.message.slice(0, 80) + '…' : err.message}
                        </td>
                        <td className="px-4 py-2 text-vetted-text-secondary">
                          {err.route || '—'}
                        </td>
                      </tr>
                    ))}
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
