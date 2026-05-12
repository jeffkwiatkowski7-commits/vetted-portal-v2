import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, X, Check, Search, Globe, Brain, Terminal, Link, Lightbulb, Cpu } from 'lucide-react';
import { mcpServers as mcpApi } from '../api';
import type { McpServer } from '../types';

const ICON_OPTIONS = [
  { value: 'search', label: 'Search', Icon: Search },
  { value: 'globe', label: 'Globe', Icon: Globe },
  { value: 'brain', label: 'Brain', Icon: Brain },
  { value: 'terminal', label: 'Terminal', Icon: Terminal },
  { value: 'link', label: 'Link', Icon: Link },
  { value: 'lightbulb', label: 'Lightbulb', Icon: Lightbulb },
];

function getIcon(icon: string) {
  const match = ICON_OPTIONS.find(o => o.value === icon);
  return match ? match.Icon : Cpu;
}

interface EnvVar { key: string; value: string; preview?: string; }

const BLANK_FORM = {
  name: '', description: '', icon: 'search', command: '', args: '[]',
  envVars: [] as EnvVar[], enabled: true,
};

export default function AdminMcpPage() {
  const navigate = useNavigate();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);

  const load = () => {
    mcpApi.adminList().then(setServers).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
    setShowForm(true);
  };

  const openEdit = (server: McpServer) => {
    setEditingId(server.id);
    // env_vars from the admin endpoint is a preview map ({KEY: "sk-a…XYZ9"}),
    // never the real values. Show previews as placeholders; the admin types
    // a new value only when they want to change a credential.
    const previews = server.env_vars || {};
    setForm({
      name: server.name,
      description: server.description || '',
      icon: server.icon || 'search',
      command: server.command,
      args: server.args || '[]',
      envVars: Object.entries(previews).map(([key, preview]) => ({ key, value: '', preview: preview as string })),
      enabled: !!server.enabled,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.command.trim()) return;
    // Blank value on an existing key = "keep current". Server merges with the
    // decrypted existing env_vars: empty string keeps, non-empty replaces,
    // omitted keys are removed.
    const envObj: Record<string, string> = {};
    for (const { key, value } of form.envVars) {
      if (key.trim()) envObj[key.trim()] = value;
    }
    const data = {
      name: form.name, description: form.description, icon: form.icon,
      command: form.command, args: form.args,
      env_vars: envObj, enabled: form.enabled,
    };
    if (editingId) {
      await mcpApi.adminUpdate(editingId, data);
    } else {
      await mcpApi.adminCreate(data);
    }
    setShowForm(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this MCP server?')) return;
    await mcpApi.adminDelete(id);
    load();
  };

  const handleToggle = async (server: McpServer) => {
    await mcpApi.adminUpdate(server.id, { enabled: !server.enabled });
    load();
  };

  const addEnvVar = () => setForm({ ...form, envVars: [...form.envVars, { key: '', value: '' }] });
  const removeEnvVar = (i: number) => setForm({ ...form, envVars: form.envVars.filter((_, idx) => idx !== i) });
  const updateEnvVar = (i: number, field: 'key' | 'value', val: string) => {
    const updated = [...form.envVars];
    updated[i] = { ...updated[i], [field]: val };
    setForm({ ...form, envVars: updated });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/admin')} className="p-1 hover:bg-vetted-surface rounded transition-colors">
          <ArrowLeft size={16} className="text-vetted-text-secondary" />
        </button>
        <h1 className="text-xl font-serif text-vetted-primary flex-1">MCP Servers</h1>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3">
          <Plus size={14} /> Add MCP Server
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
        <p className="text-sm text-vetted-text-secondary">
          Configure MCP (Model Context Protocol) servers that provide AI tools. Enabled servers are available to users in project settings and standalone chats.
        </p>

        {showForm && (
          <div className="border border-vetted-accent/40 rounded-xl bg-white p-5 space-y-4">
            <h3 className="text-sm font-medium text-vetted-primary">{editingId ? 'Edit' : 'Add'} MCP Server</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Brave Search" className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Icon</label>
                <select value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent">
                  {ICON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="What this MCP server does" rows={2}
                className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Command *</label>
                <input value={form.command} onChange={e => setForm({ ...form, command: e.target.value })}
                  placeholder="npx" className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Arguments (JSON array)</label>
                <input value={form.args} onChange={e => setForm({ ...form, args: e.target.value })}
                  placeholder='["-y", "@anthropic-ai/mcp-server-brave-search"]'
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent font-mono" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-vetted-text-secondary">Environment Variables</label>
                <button type="button" onClick={addEnvVar} className="text-xs text-vetted-accent hover:text-vetted-primary transition-colors">+ Add Variable</button>
              </div>
              {form.envVars.length === 0 && <p className="text-xs text-vetted-text-muted">No environment variables configured.</p>}
              {form.envVars.length > 0 && (
                <p className="text-[11px] text-vetted-text-muted mt-0.5">
                  Existing values are encrypted. Leave the value blank to keep it; type a new value to replace.
                </p>
              )}
              {form.envVars.map((ev, i) => (
                <div key={i} className="flex gap-2 mt-1.5">
                  <input value={ev.key} onChange={e => updateEnvVar(i, 'key', e.target.value)} placeholder="KEY"
                    className="flex-1 px-2 py-1.5 text-xs border border-vetted-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-vetted-accent" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={ev.value}
                    onChange={e => updateEnvVar(i, 'value', e.target.value)}
                    placeholder={ev.preview ? `current: ${ev.preview} — leave blank to keep` : 'value'}
                    className="flex-1 px-2 py-1.5 text-xs border border-vetted-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                  />
                  <button onClick={() => removeEnvVar(i)} className="p-1 hover:bg-red-50 rounded-lg"><Trash2 size={12} className="text-red-400" /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-vetted-text-secondary">Enabled</label>
              <div onClick={() => setForm({ ...form, enabled: !form.enabled })}
                className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors ${form.enabled ? 'bg-vetted-accent' : 'bg-vetted-border'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"><X size={13} /> Cancel</button>
              <button onClick={handleSave} disabled={!form.name.trim() || !form.command.trim()} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5"><Check size={13} /> {editingId ? 'Update' : 'Add'}</button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-vetted-text-muted">Loading...</p>
        ) : servers.length === 0 ? (
          <p className="text-sm text-vetted-text-muted">No MCP servers configured.</p>
        ) : servers.map((server) => {
          const IconComp = getIcon(server.icon);
          return (
            <div key={server.id} className={`border rounded-xl bg-white p-4 ${server.enabled ? 'border-vetted-border' : 'border-vetted-border opacity-60'}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 p-2 rounded-lg ${server.enabled ? 'bg-vetted-accent/10' : 'bg-vetted-surface'}`}>
                  <IconComp size={16} className={server.enabled ? 'text-vetted-accent' : 'text-vetted-text-muted'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-vetted-primary">{server.name}</p>
                    <div className="flex items-center gap-2">
                      <div onClick={() => handleToggle(server)}
                        className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors ${server.enabled ? 'bg-vetted-accent' : 'bg-vetted-border'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${server.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <button onClick={() => openEdit(server)} className="p-1.5 hover:bg-vetted-surface rounded-lg transition-colors text-xs text-vetted-text-secondary">Edit</button>
                      <button onClick={() => handleDelete(server.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={13} className="text-red-400" /></button>
                    </div>
                  </div>
                  {server.description && <p className="text-xs text-vetted-text-muted mt-0.5 line-clamp-2">{server.description}</p>}
                  <p className="text-xs text-vetted-text-muted mt-1 font-mono">{server.command} {JSON.parse(server.args || '[]').join(' ')}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
