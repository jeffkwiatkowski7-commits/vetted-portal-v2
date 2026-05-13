import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { ArrowLeft, Plus, Copy, Trash2, LogOut } from 'lucide-react';
import type { UserPreferences, ApiKey } from '../types';

const DEFAULT_PREFERENCES: UserPreferences = {
  default_model: 'Claude',
  default_temperature: 0.7,
  show_reasoning: 0,
  auto_scroll: 1,
  compact_view: 0,
  code_theme: 'Light',
  notify_shared_chat: 1,
  notify_project_updates: 1,
  notify_system: 1,
  notify_weekly_summary: 0,
};

type TabId = 'profile' | 'preferences' | 'notifications' | 'api' | 'security';
const TAB_IDS: TabId[] = ['profile', 'preferences', 'notifications', 'api', 'security'];

export default function SettingsPage() {
  const navigate = useNavigate();
  const params = useParams<{ tab?: string }>();
  const { user, addToast } = useStore();
  const urlTab = params.tab && (TAB_IDS as string[]).includes(params.tab) ? (params.tab as TabId) : 'profile';
  const [tab, setTab] = useState<TabId>(urlTab);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Keep tab in sync with URL when the user navigates via the address bar or back/forward.
  useEffect(() => {
    setTab(urlTab);
  }, [urlTab]);

  const selectTab = (id: TabId) => {
    setTab(id);
    navigate(id === 'profile' ? '/settings' : `/settings/${id}`, { replace: false });
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const prefs = await api.settings.preferences().catch(() => null);
      const keys = await api.settings.apiKeys().catch(() => [] as ApiKey[]);
      if (prefs) setPreferences(prefs);
      setApiKeys(keys || []);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    try {
      await api.settings.updatePreferences(preferences);
      addToast({
        type: 'success',
        title: 'Preferences saved',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to save preferences',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateApiKey = async () => {
    try {
      const newKey = await api.settings.createApiKey({
        name: `Key ${new Date().toLocaleDateString()}`,
      });
      setApiKeys([...apiKeys, newKey]);
      addToast({
        type: 'success',
        title: 'API key created',
        detail: 'Save the key securely - you won\'t see it again',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to create API key',
      });
    }
  };

  const handleDeleteApiKey = async (keyId: string) => {
    if (!window.confirm('Delete this API key?')) return;
    try {
      await api.settings.deleteApiKey(keyId);
      setApiKeys(apiKeys.filter((k) => k.id !== keyId));
      addToast({
        type: 'success',
        title: 'API key deleted',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to delete API key',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 border-r border-vetted-border bg-vetted-surface p-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 p-2 mb-4 hover:bg-white rounded-lg transition-colors"
        >
          <ArrowLeft size={18} />
          Back
        </button>

        <nav className="space-y-1">
          {[
            { id: 'profile', label: 'Profile' },
            { id: 'preferences', label: 'Preferences' },
            { id: 'notifications', label: 'Notifications' },
            { id: 'api', label: 'API Keys' },
            { id: 'security', label: 'Security' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => selectTab(id as TabId)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                tab === id
                  ? 'bg-white text-vetted-primary font-medium border-l-2 border-vetted-accent'
                  : 'text-vetted-text-secondary hover:bg-white hover:bg-opacity-50'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          {tab === 'profile' && user && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-serif text-vetted-primary mb-4">Profile Settings</h2>
              </div>

              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  defaultValue={user.display_name}
                  className="w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-2">
                  Email (Read-only)
                </label>
                <input
                  type="email"
                  value={user.email}
                  disabled
                  className="w-full px-3 py-2 border border-vetted-border rounded-lg bg-vetted-surface input-field"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-vetted-primary mb-2">
                    Job Title
                  </label>
                  <input
                    type="text"
                    defaultValue={user.job_title || ''}
                    className="w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent input-field"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-vetted-primary mb-2">
                    Department
                  </label>
                  <input
                    type="text"
                    defaultValue={user.department || ''}
                    className="w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent input-field"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50">
                  Save Profile
                </button>
              </div>
            </div>
          )}

          {tab === 'preferences' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-serif text-vetted-primary mb-4">Preferences</h2>
              </div>

              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-2">
                  Default Model
                </label>
                <select
                  value={preferences.default_model}
                  onChange={(e) =>
                    setPreferences({ ...preferences, default_model: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent input-field"
                >
                  <option>Claude</option>
                  <option>ChatGPT</option>
                  <option>Gemini</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-2">
                  Default Temperature: {preferences.default_temperature.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={preferences.default_temperature}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      default_temperature: parseFloat(e.target.value),
                    })
                  }
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!preferences.show_reasoning}
                    onChange={(e) =>
                      setPreferences({ ...preferences, show_reasoning: e.target.checked ? 1 : 0 })
                    }
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-vetted-primary">Show model reasoning</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!preferences.auto_scroll}
                    onChange={(e) =>
                      setPreferences({ ...preferences, auto_scroll: e.target.checked ? 1 : 0 })
                    }
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-vetted-primary">Auto-scroll to latest message</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!preferences.compact_view}
                    onChange={(e) =>
                      setPreferences({ ...preferences, compact_view: e.target.checked ? 1 : 0 })
                    }
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-vetted-primary">Compact view</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-2">
                  Code Theme
                </label>
                <select
                  value={preferences.code_theme}
                  onChange={(e) =>
                    setPreferences({ ...preferences, code_theme: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent input-field"
                >
                  <option>Light</option>
                  <option>Dark</option>
                </select>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSavePreferences}
                  disabled={saving}
                  className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Preferences'}
                </button>
              </div>
            </div>
          )}

          {tab === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-serif text-vetted-primary mb-4">Notifications</h2>
              </div>

              <div className="space-y-3">
                {([
                  { label: 'Shared chat notifications', key: 'notify_shared_chat' },
                  { label: 'Project updates', key: 'notify_project_updates' },
                  { label: 'System notifications', key: 'notify_system' },
                  { label: 'Weekly summary', key: 'notify_weekly_summary' },
                ] as { label: string; key: keyof UserPreferences }[]).map(({ label, key }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!preferences[key]}
                      onChange={(e) =>
                        setPreferences({ ...preferences, [key]: e.target.checked ? 1 : 0 })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-vetted-primary">{label}</span>
                  </label>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSavePreferences}
                  disabled={saving}
                  className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Notification Preferences'}
                </button>
              </div>
            </div>
          )}

          {tab === 'api' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-serif text-vetted-primary">API Keys</h2>
                <button onClick={handleCreateApiKey} className="btn-primary flex items-center gap-2">
                  <Plus size={18} />
                  Generate Key
                </button>
              </div>

              <div className="space-y-3">
                {apiKeys.map((key) => (
                  <div key={key.id} className="card p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-vetted-primary">{key.name}</p>
                      <p className="text-sm text-vetted-text-secondary font-mono">{key.key_preview}...</p>
                      <p className="text-xs text-vetted-text-muted mt-1">
                        Created {new Date(key.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteApiKey(key.id)}
                      className="p-2 hover:bg-red-50 rounded-lg transition-colors text-vetted-danger"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-serif text-vetted-primary mb-4">Security</h2>
              </div>

              <div className="card p-4">
                <h3 className="font-medium text-vetted-primary mb-3">Active Sessions</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between pb-2 border-b border-vetted-border">
                    <div>
                      <p className="text-sm font-medium text-vetted-primary">Current Device</p>
                      <p className="text-xs text-vetted-text-secondary">Last active now</p>
                    </div>
                    <span className="text-xs bg-vetted-success text-white px-2 py-1 rounded">
                      Active
                    </span>
                  </div>
                </div>
              </div>

              <button className="btn-danger flex items-center gap-2">
                <LogOut size={18} />
                Sign Out of All Devices
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
