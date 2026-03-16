import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, X, Check, Star } from 'lucide-react';

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'Anthropic' | 'Google' | 'OpenAI' | 'Other';
  description: string;
  enabled: boolean;
  isDefault: boolean;
}

const STORAGE_KEY = 'admin_models';

const DEFAULT_MODELS: ModelConfig[] = [
  { id: 'sonnet-4-6', name: 'Sonnet 4.6', provider: 'Anthropic', description: 'Fast and capable — best for most tasks', enabled: true, isDefault: true },
  { id: 'opus-4-6', name: 'Opus 4.6', provider: 'Anthropic', description: 'Most powerful Claude model for complex reasoning', enabled: true, isDefault: false },
  { id: 'gemini-3', name: 'Gemini 3', provider: 'Google', description: 'Google\'s flagship multimodal model', enabled: true, isDefault: false },
  { id: 'gemini-flash-3', name: 'Gemini Flash 3', provider: 'Google', description: 'Fast and efficient Gemini model', enabled: true, isDefault: false },
];

function loadModels(): ModelConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_MODELS;
  } catch { return DEFAULT_MODELS; }
}

function saveModels(models: ModelConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
}

const PROVIDERS = ['Anthropic', 'Google', 'OpenAI', 'Other'] as const;
const BLANK = { name: '', provider: 'Anthropic' as const, description: '' };

export default function AdminModelsPage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelConfig[]>(loadModels);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);

  const update = (updated: ModelConfig[]) => { setModels(updated); saveModels(updated); };

  const toggleEnabled = (id: string) => {
    update(models.map((m) => m.id === id ? { ...m, enabled: !m.enabled } : m));
  };

  const setDefault = (id: string) => {
    update(models.map((m) => ({ ...m, isDefault: m.id === id })));
  };

  const remove = (id: string) => {
    if (!window.confirm('Remove this model?')) return;
    update(models.filter((m) => m.id !== id));
  };

  const addModel = () => {
    if (!form.name.trim()) return;
    const newModel: ModelConfig = {
      id: crypto.randomUUID(),
      ...form,
      enabled: true,
      isDefault: false,
    };
    update([...models, newModel]);
    setShowForm(false);
    setForm(BLANK);
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
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Model Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. GPT-4o"
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Provider</label>
                <select
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value as typeof form.provider })}
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                >
                  {PROVIDERS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of the model"
                className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowForm(false); setForm(BLANK); }} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
                <X size={13} /> Cancel
              </button>
              <button onClick={addModel} disabled={!form.name.trim()} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5">
                <Check size={13} /> Add
              </button>
            </div>
          </div>
        )}

        {/* Model list */}
        {models.map((model) => (
          <div key={model.id} className={`border rounded-xl bg-white p-4 flex items-center gap-4 ${model.isDefault ? 'border-vetted-accent' : 'border-vetted-border'}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-medium text-vetted-primary">{model.name}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${providerColor[model.provider]}`}>
                  {model.provider}
                </span>
                {model.isDefault && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-vetted-accent/20 text-vetted-primary font-medium flex items-center gap-1">
                    <Star size={10} className="fill-current" /> Default
                  </span>
                )}
              </div>
              {model.description && (
                <p className="text-xs text-vetted-text-muted">{model.description}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!model.isDefault && (
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
                className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors ${model.enabled ? 'bg-vetted-accent' : 'bg-vetted-border'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${model.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
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
