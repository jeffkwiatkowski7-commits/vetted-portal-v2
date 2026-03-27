import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, X, Check, Star } from 'lucide-react';
import * as api from '../api';

export interface ModelConfig {
  id: string;
  model_name: string;
  display_name: string;
  provider: string;
  description?: string;
  icon_color: string;
  is_enabled: number;
  is_default: number;
  max_tokens: number;
  rate_limit: number;
}

const PROVIDERS = ['Anthropic', 'Google', 'OpenAI', 'Other'] as const;
const BLANK = { display_name: '', model_name: '', provider: 'Anthropic' as string, description: '' };

export default function AdminModelsPage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [loading, setLoading] = useState(true);

  const fetchModels = async () => {
    try {
      const data = await api.admin.getModels();
      setModels(data.models || []);
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchModels(); }, []);

  const toggleEnabled = async (id: string) => {
    const model = models.find((m) => m.id === id);
    if (!model) return;
    await api.admin.updateModel(id, { is_enabled: !model.is_enabled });
    fetchModels();
  };

  const setDefault = async (id: string) => {
    // Unset all defaults first, then set the new one
    for (const m of models) {
      if (m.is_default) await api.admin.updateModel(m.id, { is_default: false });
    }
    await api.admin.updateModel(id, { is_default: true });
    fetchModels();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Remove this model?')) return;
    await api.admin.deleteModel(id);
    fetchModels();
  };

  const addModel = async () => {
    if (!form.display_name.trim()) return;
    await api.admin.createModel({
      model_name: form.model_name || form.display_name,
      display_name: form.display_name,
      provider: form.provider,
      is_enabled: true,
    });
    setShowForm(false);
    setForm(BLANK);
    fetchModels();
  };

  const providerColor: Record<string, string> = {
    Anthropic: 'text-orange-500 bg-orange-50',
    Google: 'text-blue-500 bg-blue-50',
    OpenAI: 'text-green-500 bg-green-50',
    Other: 'text-gray-500 bg-gray-50',
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/admin')} className="p-1 hover:bg-vetted-surface rounded transition-colors">
          <ArrowLeft size={16} className="text-vetted-text-secondary" />
        </button>
        <h1 className="text-xl font-serif text-vetted-primary flex-1">Model Configuration</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3">
          <Plus size={14} /> Add Model
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
        <p className="text-sm text-vetted-text-secondary">
          Configure which models are available to users. The default model is pre-selected in the chat input.
        </p>

        {/* Add form */}
        {showForm && (
          <div className="border border-vetted-accent/40 rounded-xl bg-white p-5 space-y-4">
            <h3 className="text-sm font-medium text-vetted-primary">Add Model</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Display Name *</label>
                <input
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  placeholder="e.g. GPT-4o"
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Provider</label>
                <select
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                >
                  {PROVIDERS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Model ID</label>
              <input
                value={form.model_name}
                onChange={(e) => setForm({ ...form, model_name: e.target.value })}
                placeholder="e.g. gemini-2.5-flash (Vertex AI model name)"
                className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowForm(false); setForm(BLANK); }} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
                <X size={13} /> Cancel
              </button>
              <button onClick={addModel} disabled={!form.display_name.trim()} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
                <Check size={13} /> Add
              </button>
            </div>
          </div>
        )}

        {loading && <p className="text-sm text-vetted-text-muted">Loading models...</p>}

        {/* Model list */}
        {models.map((model) => (
          <div key={model.id} className={`border rounded-xl bg-white p-4 flex items-center gap-4 ${model.is_default ? 'border-vetted-accent' : 'border-vetted-border'}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-medium text-vetted-primary">{model.display_name}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${providerColor[model.provider] || providerColor.Other}`}>
                  {model.provider}
                </span>
                {!!model.is_default && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-vetted-accent/20 text-vetted-primary font-medium flex items-center gap-1">
                    <Star size={10} className="fill-current" /> Default
                  </span>
                )}
              </div>
              <p className="text-xs text-vetted-text-muted">{model.model_name}</p>
            </div>

            <div className="flex items-center gap-2">
              {!model.is_default && (
                <button
                  onClick={() => setDefault(model.id)}
                  className="text-xs text-vetted-text-secondary hover:text-vetted-accent px-2 py-1 rounded border border-vetted-border hover:border-vetted-accent transition-colors"
                >
                  Set default
                </button>
              )}

              {/* Enable toggle */}
              <div
                onClick={() => toggleEnabled(model.id)}
                className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors ${model.is_enabled ? 'bg-vetted-accent' : 'bg-vetted-border'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${model.is_enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>

              <button onClick={() => remove(model.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 size={14} className="text-red-400" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
