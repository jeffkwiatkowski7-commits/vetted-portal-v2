import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, X, Check } from 'lucide-react';

interface SystemPrompt {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
}

const STORAGE_KEY = 'admin_system_prompts';

function loadPrompts(): SystemPrompt[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}

function savePrompts(prompts: SystemPrompt[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
}

const BLANK = { name: '', description: '', content: '' };

export default function AdminSystemPromptsPage() {
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState<SystemPrompt[]>(loadPrompts);
  const [editing, setEditing] = useState<string | null>(null); // id or 'new'
  const [form, setForm] = useState(BLANK);

  const startNew = () => { setEditing('new'); setForm(BLANK); };
  const startEdit = (p: SystemPrompt) => {
    setEditing(p.id);
    setForm({ name: p.name, description: p.description, content: p.content });
  };
  const cancel = () => { setEditing(null); setForm(BLANK); };

  const save = () => {
    if (!form.name.trim() || !form.content.trim()) return;
    let updated: SystemPrompt[];
    if (editing === 'new') {
      const newPrompt: SystemPrompt = {
        id: crypto.randomUUID(),
        ...form,
        createdAt: new Date().toISOString(),
      };
      updated = [newPrompt, ...prompts];
    } else {
      updated = prompts.map((p) =>
        p.id === editing ? { ...p, ...form } : p
      );
    }
    setPrompts(updated);
    savePrompts(updated);
    cancel();
  };

  const remove = (id: string) => {
    if (!window.confirm('Delete this system prompt?')) return;
    const updated = prompts.filter((p) => p.id !== id);
    setPrompts(updated);
    savePrompts(updated);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/admin')} className="p-1 hover:bg-vetted-surface rounded transition-colors">
          <ArrowLeft size={16} className="text-vetted-text-secondary" />
        </button>
        <h1 className="text-xl font-serif text-vetted-primary flex-1">System Prompts</h1>
        <button onClick={startNew} className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3">
          <Plus size={14} /> New Prompt
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
        {/* New / Edit form */}
        {editing && (
          <div className="border border-vetted-accent/40 rounded-xl bg-white p-5 space-y-4">
            <h3 className="text-sm font-medium text-vetted-primary">
              {editing === 'new' ? 'New System Prompt' : 'Edit System Prompt'}
            </h3>
            <div>
              <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Customer Support Agent"
                className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of when to use this prompt"
                className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Content *</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="You are a helpful assistant that..."
                rows={6}
                className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent resize-none font-mono"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={cancel} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
                <X size={13} /> Cancel
              </button>
              <button onClick={save} disabled={!form.name.trim() || !form.content.trim()} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
                <Check size={13} /> Save
              </button>
            </div>
          </div>
        )}

        {/* List */}
        {prompts.length === 0 && !editing ? (
          <div className="text-center py-16 text-vetted-text-muted text-sm">
            No system prompts yet. Create one to reuse across projects.
          </div>
        ) : (
          prompts.map((p) => (
            <div key={p.id} className="border border-vetted-border rounded-xl bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-vetted-primary text-sm">{p.name}</p>
                  {p.description && (
                    <p className="text-xs text-vetted-text-secondary mt-0.5">{p.description}</p>
                  )}
                  <p className="text-xs text-vetted-text-muted mt-2 font-mono line-clamp-2">{p.content}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(p)} className="p-1.5 hover:bg-vetted-surface rounded-lg transition-colors">
                    <Pencil size={14} className="text-vetted-text-secondary" />
                  </button>
                  <button onClick={() => remove(p.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
