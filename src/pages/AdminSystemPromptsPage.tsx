import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import { ArrowLeft, Plus, Pencil, Trash2, X, Check, Globe, Loader2 } from 'lucide-react';

interface SystemPrompt {
  id: string;
  name: string;
  prompt_text: string;
  scope: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const BLANK = { name: '', prompt_text: '', scope: 'custom' };

export default function AdminSystemPromptsPage() {
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.systemPrompts();
      setPrompts(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const globalPrompt = prompts.find(p => p.scope === 'global');
  const otherPrompts = prompts.filter(p => p.scope !== 'global');

  const startNew = () => { setEditing('new'); setForm(BLANK); };
  const startEdit = (p: SystemPrompt) => {
    setEditing(p.id);
    setForm({ name: p.name, prompt_text: p.prompt_text, scope: p.scope });
  };
  const startEditGlobal = () => {
    if (globalPrompt) {
      setEditing(globalPrompt.id);
      setForm({ name: globalPrompt.name, prompt_text: globalPrompt.prompt_text, scope: 'global' });
    } else {
      setEditing('new-global');
      setForm({ name: 'Global Default', prompt_text: '', scope: 'global' });
    }
  };
  const cancel = () => { setEditing(null); setForm(BLANK); };

  const save = async () => {
    if (!form.name.trim() || !form.prompt_text.trim()) return;
    setSaving(true);
    try {
      if (editing === 'new' || editing === 'new-global') {
        const result = await api.admin.createSystemPrompt(form);
        setPrompts(prev => [result.prompt || result, ...prev]);
      } else {
        const result = await api.admin.updateSystemPrompt(editing!, form);
        setPrompts(prev => prev.map(p => p.id === editing ? (result.prompt || result) : p));
      }
      cancel();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this system prompt?')) return;
    await api.admin.deleteSystemPrompt(id);
    setPrompts(prev => prev.filter(p => p.id !== id));
  };

  const isEditingGlobal = editing === 'new-global' || (editing && editing !== 'new' && prompts.find(p => p.id === editing)?.scope === 'global');

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

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-vetted-accent" />
          </div>
        ) : (
          <>
            {/* Global Default — always shown */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Globe size={15} className="text-vetted-accent" />
                <h2 className="text-sm font-semibold text-vetted-primary">Global Default</h2>
                <span className="text-xs text-vetted-text-muted">— applied to all chats unless overridden by a project</span>
              </div>

              {isEditingGlobal ? (
                <PromptForm form={form} setForm={setForm} saving={saving} onSave={save} onCancel={cancel} />
              ) : globalPrompt ? (
                <div className="border border-vetted-accent/30 rounded-xl bg-amber-50/30 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-xs text-vetted-text-muted font-mono whitespace-pre-wrap line-clamp-4 flex-1">{globalPrompt.prompt_text}</p>
                    <button onClick={startEditGlobal} className="p-1.5 hover:bg-vetted-surface rounded-lg transition-colors shrink-0">
                      <Pencil size={14} className="text-vetted-text-secondary" />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={startEditGlobal}
                  className="border-2 border-dashed border-vetted-border rounded-xl p-6 text-center cursor-pointer hover:border-vetted-accent hover:bg-amber-50/20 transition-colors"
                >
                  <p className="text-sm text-vetted-text-muted">No global default set — click to create one</p>
                  <p className="text-xs text-vetted-text-muted mt-1">The built-in Gemini prompt will be used until you set one here.</p>
                </div>
              )}
            </div>

            {/* New prompt form */}
            {editing === 'new' && (
              <PromptForm form={form} setForm={setForm} saving={saving} onSave={save} onCancel={cancel} showScope />
            )}

            {/* Other prompts */}
            {otherPrompts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-vetted-primary mb-3">Saved Prompts</h2>
                <div className="space-y-3">
                  {otherPrompts.map(p => (
                    <div key={p.id}>
                      {editing === p.id ? (
                        <PromptForm form={form} setForm={setForm} saving={saving} onSave={save} onCancel={cancel} showScope />
                      ) : (
                        <div className="border border-vetted-border rounded-xl bg-white p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium text-vetted-primary text-sm">{p.name}</p>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-vetted-surface text-vetted-text-muted font-mono">{p.scope}</span>
                              </div>
                              <p className="text-xs text-vetted-text-muted font-mono line-clamp-2 whitespace-pre-wrap">{p.prompt_text}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => startEdit(p)} className="p-1.5 hover:bg-vetted-surface rounded-lg transition-colors">
                                <Pencil size={14} className="text-vetted-text-secondary" />
                              </button>
                              <button onClick={() => remove(p.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 size={14} className="text-red-400" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PromptForm({
  form, setForm, saving, onSave, onCancel, showScope = false,
}: {
  form: { name: string; prompt_text: string; scope: string };
  setForm: (f: any) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  showScope?: boolean;
}) {
  return (
    <div className="border border-vetted-accent/40 rounded-xl bg-white p-5 space-y-4">
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Name *</label>
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Customer Support Agent"
            className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
          />
        </div>
        {showScope && (
          <div className="w-36">
            <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Scope</label>
            <input
              value={form.scope}
              onChange={e => setForm({ ...form, scope: e.target.value })}
              placeholder="e.g. custom"
              className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
            />
          </div>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Prompt *</label>
        <textarea
          value={form.prompt_text}
          onChange={e => setForm({ ...form, prompt_text: e.target.value })}
          placeholder="You are a helpful assistant that..."
          rows={8}
          className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent resize-y font-mono"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
          <X size={13} /> Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!form.name.trim() || !form.prompt_text.trim() || saving}
          className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save
        </button>
      </div>
    </div>
  );
}
