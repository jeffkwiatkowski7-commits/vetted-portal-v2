import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { Wrench, Users, BarChart3, Activity, Zap, AlertCircle, CheckCircle } from 'lucide-react';

interface Stats {
  total_users?: number;
  active_today?: number;
  total_projects?: number;
  tool_sets?: number;
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

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'super_admin') {
      navigate('/');
      return;
    }
    loadAdminData();
  }, [user, navigate]);

  const loadAdminData = async () => {
    try {
      const statsData = await api.admin.stats();
      const healthData = await api.admin.health();
      setStats(statsData);
      setHealth(healthData);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to load admin data',
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary">Loading admin dashboard...</p>
      </div>
    );
  }

  const resourceCards = [
    {
      label: 'AI Tool Sets',
      count: stats?.tool_sets || 0,
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
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-vetted-border p-6">
        <h1 className="text-3xl font-serif text-vetted-primary">Admin Dashboard</h1>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {statCards.map(({ label, value }) => (
              <div key={label} className="card text-center">
                <p className="text-vetted-text-secondary text-sm mb-2">{label}</p>
                <p className="text-4xl font-serif font-bold text-vetted-primary">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Support Tools */}
        <div>
          <h2 className="text-lg font-medium text-vetted-primary mb-4">Support Tools</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: 'AI Tool Sets Health', icon: Wrench },
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
        </div>
      </div>
    </div>
  );
}
