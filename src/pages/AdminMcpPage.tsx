import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, X, Check, Cpu, Globe, Key } from 'lucide-react';

interface McpServer {
  id: string;
  name: string;
  description: string;
  url: string;
  apiKey: string;
  enabled: boolean;
  createdAt: string;
}

const STORAGE_KEY = 'admin_mcps';

const PRESET_MCPS: McpServer[] = [
  { id: 'web_search', name: 'Web Search', description: 'Search the web in real time via Brave or Google', url: '', apiKey: '', enabled: false, createdAt: new Date().toISOString() },
  { id: 'code_execution', name: 'Code Execution', description: 'Run Python, JS, and shell scripts in a sandbox', url: '', apiKey: '', enabled: false, createdAt: new Date().toISOString() },
  { id: 'file_browser', name: 'File Browser', description: 'Browse and read project files', url: '', apiKey: '', enabled: false, createdAt: new Date().toISOString() },
  { id: 'database_query', name: 'Database Query', description: 'Query connected databases via SQL', url: '', apiKey: '', enabled: false, createdAt: new Date().toISOString() },
  { id: 'email', name: 'Email', description: 'Send and read emails via SMTP/IMAP', url: '', apiKey: '', enabled: false, createdAt: new Date().toISOString() },
  { id: 'calendar', name: 'Calendar', description: 'Access and manage calendar events', url: '', apiKey: '', enabled: false, createdAt: new Date().toISOString() },
];

const MCP_VERSION = 'v2'; // bump to reset stale localStorage
function loadMcps(): McpServer[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const version = localStorage.getItem(STORAGE_KEY + '_version');
    if (!stored || version !== MCP_VERSION) return PRESET_MCPS;
    return JSON.parse(stored);
  } catch { return PRESET_MCPS; }
}

function saveMcps(mcps: McpServer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mcps));
  localStorage.setItem(STORAGE_KEY + '_version', MCP_VERSION);
}

const BLANK = { name: '', description: '', url: '', apiKey: '' };

export default function AdminMcpPage() {
  const navigate = useNavigate();
  const [mcps, setMcps] = useState<McpServer[]>(loadMcps);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const update = (updated: McpServer[]) => { setMcps(updated); saveMcps(updated); };

  const toggleEnabled = (id: string) => {
    update(mcps.map((m) => m.id === id ? { ...m, enabled: !m.enabled } : m));
  };

  const remove = (id: string) => {
    if (!window.confirm('Remove this MCP server?')) return;
    update(mcps.filter((m) => m.id !== id));
  };

  const addMcp = () => {
    if (!form.name.trim()) return;
    const newMcp: McpServer = {
      id: crypto.randomUUID(),
      ...form,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    update([...mcps, newMcp]);
    setShowForm(false);
    setForm(BLANK);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/admin')} className="p-1 hover:bg-vetted-surface rounded transition-colors">
          <ArrowLeft size={16} className="text-vetted-text-secondary" />
        </button>
        <h1 className="text-xl font-serif text-vetted-primary flex-1">MCP Servers</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3">
          <Plus size={14} /> Add MCP
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
        <p className="text-sm text-vetted-text-secondary">
          Configure MCP (Model Context Protocol) servers that can be enabled per project. Enabled servers appear as toggleable tools in the project settings.
        </p>

        {/* Add form */}
        {showForm && (
          <div className="border border-vetted-accent/40 rounded-xl bg-white p-5 space-y-4">
            <h3 className="text-sm font-medium text-vetted-primary">Add MCP Server</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Slack Integration"
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What this MCP does"
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-vetted-text-secondary mb-1 flex items-center gap-1">
                <Globe size={11} /> Endpoint URL
              </label>
              <input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://your-mcp-server.com/endpoint"
                className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-vetted-text-secondary mb-1 flex items-center gap-1">
                <Key size={11} /> API Key (optional)
              </label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent font-mono"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowForm(false); setForm(BLANK); }} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
                <X size={13} /> Cancel
              </button>
              <button onClick={addMcp} disabled={!form.name.trim()} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
                <Check size={13} /> Add
              </button>
            </div>
          </div>
        )}

        {/* MCP list */}
        {mcps.map((mcp) => (
          <div key={mcp.id} className={`border rounded-xl bg-white p-4 ${mcp.enabled ? 'border-vetted-border' : 'border-vetted-border opacity-60'}`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 p-2 rounded-lg ${mcp.enabled ? 'bg-vetted-accent/10' : 'bg-vetted-surface'}`}>
                <Cpu size={16} className={mcp.enabled ? 'text-vetted-accent' : 'text-vetted-text-muted'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-vetted-primary">{mcp.name}</p>
                  <div className="flex items-center gap-2">
                    <div
                      onClick={() => toggleEnabled(mcp.id)}
                      className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors ${mcp.enabled ? 'bg-vetted-accent' : 'bg-vetted-border'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${mcp.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    <button onClick={() => remove(mcp.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={13} className="text-red-400" />
                    </button>
                  </div>
                </div>
                {mcp.description && <p className="text-xs text-vetted-text-muted mt-0.5">{mcp.description}</p>}
                {mcp.url && (
                  <p className="text-xs text-vetted-text-muted mt-1 font-mono truncate flex items-center gap-1">
                    <Globe size={10} /> {mcp.url}
                  </p>
                )}
                {mcp.apiKey && (
                  <div className="mt-1 flex items-center gap-1">
                    <Key size={10} className="text-vetted-text-muted" />
                    <button
                      onClick={() => setShowKey((prev) => ({ ...prev, [mcp.id]: !prev[mcp.id] }))}
                      className="text-xs text-vetted-text-muted hover:text-vetted-primary transition-colors font-mono"
                    >
                      {showKey[mcp.id] ? mcp.apiKey : '••••••••••••'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
