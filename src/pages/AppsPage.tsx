import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { Plus, Search, Grid3X3, Zap, X } from 'lucide-react';
import type { App } from '../types';

export default function AppsPage() {
  const navigate = useNavigate();
  const { user, addToast, setActiveChat } = useStore();
  const [apps, setApps] = useState<App[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', category: 'general', system_prompt: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadApps();
  }, []);

  const loadApps = async () => {
    try {
      const appData = await api.apps.list();
      const catData = await api.apps.categories();
      setApps(appData);
      setCategories(catData);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to load apps',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAppClick = async (app: App) => {
    try {
      const newChat = await api.chats.create({
        title: `${app.name} - ${new Date().toLocaleDateString()}`,
        model: app.model,
        temperature: app.temperature,
        system_prompt: app.system_prompt,
      });
      setActiveChat(newChat);
      navigate(`/chat/${newChat.id}`);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to start chat',
      });
    }
  };

  const handleCreateApp = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const newApp = await api.apps.create({
        ...createForm,
        model: 'Gemini 3',
        temperature: 0.7,
        visibility: 'all',
        status: 'active',
      });
      setApps((prev) => [newApp, ...prev]);
      setShowCreate(false);
      setCreateForm({ name: '', description: '', category: 'general', system_prompt: '' });
      addToast({ type: 'success', title: 'App created' });
    } catch {
      addToast({ type: 'error', title: 'Failed to create app' });
    } finally {
      setCreating(false);
    }
  };

  const filtered = apps.filter((app) => {
    const matchesSearch = app.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !selectedCategory || app.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary">Loading apps...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-vetted-border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-serif text-vetted-primary">Apps</h1>
          {(user?.role === 'admin' || user?.role === 'super_admin') && (
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
              <Plus size={18} />
              Create App
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search
            size={18}
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-vetted-text-muted"
          />
          <input
            type="text"
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent input-field"
          />
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
              selectedCategory === null
                ? 'bg-vetted-accent text-vetted-primary'
                : 'bg-vetted-surface text-vetted-text-secondary hover:bg-white'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? 'bg-vetted-accent text-vetted-primary'
                  : 'bg-vetted-surface text-vetted-text-secondary hover:bg-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Apps Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Grid3X3 size={48} className="mx-auto text-vetted-text-muted mb-4 opacity-50" />
              <p className="text-vetted-text-secondary">No apps found</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((app) => (
              <div
                key={app.id}
                onClick={() => handleAppClick(app)}
                className="card hover:shadow-lg cursor-pointer transition-all group"
              >
                {/* Icon */}
                <div className="w-12 h-12 rounded-lg bg-vetted-accent flex items-center justify-center text-vetted-primary mb-3 group-hover:scale-110 transition-transform">
                  <Zap size={24} />
                </div>

                {/* Title & Category */}
                <div className="mb-2">
                  <h3 className="font-medium text-vetted-primary">{app.name}</h3>
                  <span className="inline-block mt-1 px-2 py-0.5 bg-vetted-surface text-vetted-text-secondary text-xs rounded">
                    {app.category}
                  </span>
                </div>

                {/* Description */}
                <p className="text-sm text-vetted-text-secondary mb-4 line-clamp-2">
                  {app.description}
                </p>

                {/* Stats */}
                <div className="flex items-center justify-between text-xs text-vetted-text-muted">
                  <span>Used {app.usage_count} times</span>
                  <span className={`px-2 py-1 rounded ${
                    app.status === 'active'
                      ? 'bg-green-100 text-vetted-success'
                      : 'bg-yellow-100 text-vetted-warning'
                  }`}>
                    {app.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Create App Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-vetted-border">
              <h2 className="text-lg font-serif text-vetted-primary">Create App</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-vetted-surface rounded-lg transition-colors">
                <X size={18} className="text-vetted-text-secondary" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Name *</label>
                <input value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Customer Support Bot"
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Description</label>
                <input value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What does this app do?"
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Category</label>
                <input value={createForm.category} onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. productivity"
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">System Prompt</label>
                <textarea value={createForm.system_prompt} onChange={e => setCreateForm(f => ({ ...f, system_prompt: e.target.value }))}
                  placeholder="You are a helpful assistant that..."
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent resize-y font-mono" />
              </div>
            </div>
            <div className="flex gap-2 justify-end px-6 py-4 border-t border-vetted-border">
              <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
              <button onClick={handleCreateApp} disabled={!createForm.name.trim() || creating}
                className="btn-primary text-sm py-1.5 px-4">
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
