import React, { useState, useEffect } from 'react';
import { X, Upload, ChevronDown, ChevronUp, FileText, Check, Sparkles } from 'lucide-react';
import * as api from '../../api';
import type { LibraryFile, ProjectSkill } from '../../types';
import TemplatePickerModal from '../templates/TemplatePickerModal';

export interface ProjectFormData {
  name: string;
  description: string;
  system_prompt: string;
  tool_sets: string[];
  mcp_servers: string[];
  default_model: string;
  file_ids: string[];
  pptx_template_id: string | null;
}

interface Props {
  initialData?: Partial<ProjectFormData>;
  onSave: (data: ProjectFormData) => Promise<{ id: string } | void>;
  onCancel: () => void;
  onDelete?: () => void;
  title: string;
  saving?: boolean;
  projectId?: string;
}

// Library picker modal
function LibraryPicker({
  selected,
  onClose,
  onConfirm,
}: {
  selected: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [checked, setChecked] = useState<string[]>(selected);

  useEffect(() => { api.library.list().then(setFiles).catch(() => {}); }, []);

  const toggle = (id: string) =>
    setChecked((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-vetted-border">
          <h3 className="text-base font-medium text-vetted-primary">Select Files from Library</h3>
          <button onClick={onClose} className="p-1 hover:bg-vetted-surface rounded-lg">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-vetted-border">
          {files.length === 0 ? (
            <p className="text-sm text-vetted-text-muted text-center py-8">No files in library yet.</p>
          ) : files.map((file) => (
            <label key={file.id} className="flex items-center gap-3 px-5 py-3 hover:bg-vetted-surface cursor-pointer">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${checked.includes(file.id) ? 'bg-vetted-accent border-vetted-accent' : 'border-vetted-border'}`}>
                {checked.includes(file.id) && <Check size={10} className="text-white" strokeWidth={3} />}
              </div>
              <input type="checkbox" hidden checked={checked.includes(file.id)} onChange={() => toggle(file.id)} />
              <FileText size={15} className="text-vetted-text-muted flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{file.original_name}</p>
                <p className="text-xs text-vetted-text-muted">{(file.file_size / 1024).toFixed(1)} KB</p>
              </div>
            </label>
          ))}
        </div>
        <div className="flex gap-2 justify-end px-5 py-4 border-t border-vetted-border">
          <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-3">Cancel</button>
          <button onClick={() => onConfirm(checked)} className="btn-primary text-sm py-1.5 px-3">
            Attach {checked.length > 0 ? `(${checked.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectForm({ initialData, onSave, onCancel, onDelete, title, saving, projectId }: Props) {
  const [models, setModels] = useState<{ id: string; name: string; isDefault: boolean }[]>([]);

  useEffect(() => {
    api.models.list().then((data: any[]) => {
      setModels(data.map((m) => ({
        id: m.id,
        name: m.display_name,
        isDefault: !!m.is_default,
      })));
    }).catch(() => {});
  }, []);

  const defaultModel = models.find((m) => m.isDefault)?.name ?? models[0]?.name ?? '';

  const [name, setName] = useState(initialData?.name ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initialData?.system_prompt ?? '');
  const [sysExpanded, setSysExpanded] = useState(false);
  const [selectedModel, setSelectedModel] = useState(initialData?.default_model ?? '');

  // Set default model once models load
  useEffect(() => {
    if (!selectedModel && defaultModel) setSelectedModel(defaultModel);
  }, [defaultModel]);

  const [enabledMcps, setEnabledMcps] = useState<string[]>(() => {
    const raw = initialData?.mcp_servers;
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw) return ['mcp-memory'];
    try {
      let parsed = JSON.parse(raw);
      // Handle double-encoded JSON (string instead of array)
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  const [availableMcps, setAvailableMcps] = useState<{ id: string; name: string; description: string; icon: string }[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>(initialData?.file_ids ?? []);
  const [allFiles, setAllFiles] = useState<LibraryFile[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [projectSkills, setProjectSkills] = useState<ProjectSkill[]>([]);
  const [pptxTemplateId, setPptxTemplateId] = useState<string | null>(initialData?.pptx_template_id ?? null);
  const [pptxTemplateName, setPptxTemplateName] = useState<string>('');
  const [pptxTemplateStatus, setPptxTemplateStatus] = useState<string>('active');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Hydrate the chip with the template's name when initialData provides an id.
  useEffect(() => {
    if (!pptxTemplateId) { setPptxTemplateName(''); return; }
    api.pptxTemplates.list({ includeArchived: true })
      .then((data: any) => {
        const list = data.templates || data || [];
        const tpl = list.find((t: any) => t.id === pptxTemplateId);
        if (tpl) {
          setPptxTemplateName(tpl.name);
          setPptxTemplateStatus(tpl.status);
        }
      })
      .catch(() => {});
  }, [pptxTemplateId]);

  useEffect(() => { api.library.list().then(setAllFiles).catch(() => {}); }, []);
  useEffect(() => { api.mcpServers.list().then(setAvailableMcps).catch(() => {}); }, []);

  useEffect(() => {
    if (projectId) {
      api.skills.forProject(projectId).then(setProjectSkills).catch(() => {});
    } else {
      // For new projects, just load all skills as disabled
      api.skills.list().then((skills: any[]) => {
        setProjectSkills(skills.map((s) => ({ skill_id: s.id, skill_name: s.name, skill_description: s.description, enabled: false })));
      }).catch(() => {});
    }
  }, [projectId]);

  const toggleSkill = (skillId: string) => {
    setProjectSkills((prev) =>
      prev.map((s) => (s.skill_id === skillId ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  const toggleMcp = (id: string) =>
    setEnabledMcps((prev) => prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const result = await onSave({ name, description, system_prompt: systemPrompt, tool_sets: [], mcp_servers: enabledMcps, default_model: selectedModel, file_ids: selectedFileIds, pptx_template_id: pptxTemplateId });
    // Save project skills — use existing projectId or the newly created one
    const resolvedId = projectId || (result as any)?.id;
    const enabledSkills = projectSkills.filter((s) => s.enabled);
    if (resolvedId && enabledSkills.length > 0) {
      try {
        await api.skills.updateProjectSkills(resolvedId, projectSkills.map((s) => ({ skill_id: s.skill_id, enabled: s.enabled })));
      } catch {}
    }
  };

  const attachedFiles = allFiles.filter((f) => selectedFileIds.includes(f.id));

  return (
    <>
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-vetted-border">
            <h2 className="text-lg font-medium text-vetted-primary">{title}</h2>
            <button onClick={onCancel} className="p-1.5 hover:bg-vetted-surface rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
            <div className="px-6 py-5 space-y-5">

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-1.5">
                  Project Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Q2 Product Roadmap"
                  required
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-1.5">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this project about?"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent resize-none"
                />
              </div>

              {/* Default Model */}
              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-1.5">Default Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}{m.isDefault ? ' (system default)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* System Instructions — expandable */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <label className="text-sm font-medium text-vetted-primary">System Instructions</label>
                    <p className="text-xs text-vetted-text-muted mt-0.5">Define a persona or set behavior for the AI.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSysExpanded((v) => !v)}
                    className="flex items-center gap-1 text-xs text-vetted-text-secondary hover:text-vetted-primary transition-colors"
                  >
                    {sysExpanded ? <><ChevronUp size={13} /> Collapse</> : <><ChevronDown size={13} /> Expand</>}
                  </button>
                </div>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a product strategist helping a team plan and prioritize features..."
                  rows={sysExpanded ? 12 : 3}
                  className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent resize-none font-mono transition-all"
                />
              </div>

              {/* Files from Library */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <label className="text-sm font-medium text-vetted-primary">Files from Library</label>
                    <p className="text-xs text-vetted-text-muted mt-0.5">Attach files as context for all chats.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLibrary(true)}
                    className="flex items-center gap-1.5 text-xs text-vetted-accent hover:text-vetted-primary border border-vetted-accent/40 hover:border-vetted-accent px-2.5 py-1 rounded-lg transition-colors"
                  >
                    <Upload size={12} /> Browse Library
                  </button>
                </div>
                {attachedFiles.length === 0 ? (
                  <div className="px-3 py-3 border border-dashed border-vetted-border rounded-lg text-sm text-vetted-text-muted text-center">
                    No files attached
                  </div>
                ) : (
                  <div className="border border-vetted-border rounded-lg divide-y divide-vetted-border">
                    {attachedFiles.map((file) => (
                      <div key={file.id} className="flex items-center gap-3 px-3 py-2">
                        <FileText size={14} className="text-vetted-text-muted flex-shrink-0" />
                        <p className="text-sm flex-1 truncate">{file.original_name}</p>
                        <button
                          type="button"
                          onClick={() => setSelectedFileIds((prev) => prev.filter((id) => id !== file.id))}
                          className="p-0.5 hover:bg-vetted-surface rounded transition-colors"
                        >
                          <X size={13} className="text-vetted-text-muted" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* MCP Tools */}
              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-1">MCP Tools</label>
                <p className="text-xs text-vetted-text-muted mb-2">Enable tools the AI can use in this project.</p>
                <div className="space-y-2">
                  {availableMcps.map((mcp) => {
                    const enabled = enabledMcps.includes(mcp.id);
                    return (
                      <div
                        key={mcp.id}
                        onClick={() => toggleMcp(mcp.id)}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                          enabled ? 'border-vetted-accent bg-vetted-accent/5' : 'border-vetted-border hover:border-vetted-accent/50'
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium text-vetted-primary">{mcp.name}</p>
                          <p className="text-xs text-vetted-text-muted">{mcp.description}</p>
                        </div>
                        <div className={`w-9 h-5 rounded-full relative flex-shrink-0 transition-colors ${enabled ? 'bg-vetted-accent' : 'bg-vetted-border'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Branding Template */}
              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-1">Branding template</label>
                <p className="text-xs text-vetted-text-muted mb-2">When set, presentation-style requests render as a branded slide deck.</p>
                {pptxTemplateId ? (
                  <div className="flex items-center gap-3 px-3 py-2 border border-vetted-border rounded-lg">
                    <FileText size={14} className="text-vetted-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        {pptxTemplateName || pptxTemplateId}
                        {pptxTemplateStatus === 'archived' && <span className="ml-2 text-xs text-vetted-text-muted">(archived)</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPptxTemplateId(null)}
                      className="p-0.5 hover:bg-vetted-surface rounded"
                      title="Detach template"
                    >
                      <X size={13} className="text-vetted-text-muted" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowTemplatePicker(true)}
                    className="text-sm px-3 py-2 border border-dashed border-vetted-border rounded-lg w-full text-vetted-text-muted hover:border-vetted-accent hover:text-vetted-primary transition-colors"
                  >
                    Choose template…
                  </button>
                )}
              </div>

              {/* Skills */}
              {projectSkills.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-vetted-primary mb-1">Skills</label>
                  <p className="text-xs text-vetted-text-muted mb-2">Activate skills to inject custom instructions into the AI prompt.</p>
                  <div className="space-y-2">
                    {projectSkills.map((skill) => (
                      <div
                        key={skill.skill_id}
                        onClick={() => toggleSkill(skill.skill_id)}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                          skill.enabled ? 'border-vetted-accent bg-vetted-accent/5' : 'border-vetted-border hover:border-vetted-accent/50'
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium text-vetted-primary">{skill.skill_name}</p>
                          {skill.skill_description && (
                            <p className="text-xs text-vetted-text-muted">{skill.skill_description}</p>
                          )}
                        </div>
                        <div className={`w-9 h-5 rounded-full relative flex-shrink-0 transition-colors ${skill.enabled ? 'bg-vetted-accent' : 'bg-vetted-border'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${skill.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-vetted-border flex items-center justify-between gap-3">
              {onDelete ? (
                <button type="button" onClick={onDelete} className="text-sm text-red-500 hover:text-red-600 transition-colors">
                  Delete project
                </button>
              ) : <div />}
              <div className="flex gap-2">
                <button type="button" onClick={onCancel} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
                <button type="submit" disabled={saving || !name.trim()} className="btn-primary text-sm py-1.5 px-4">
                  {saving ? 'Saving…' : 'Save Project'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {showLibrary && (
        <LibraryPicker
          selected={selectedFileIds}
          onClose={() => setShowLibrary(false)}
          onConfirm={(ids) => { setSelectedFileIds(ids); setShowLibrary(false); }}
        />
      )}

      {showTemplatePicker && (
        <TemplatePickerModal
          selectedId={pptxTemplateId}
          onClose={() => setShowTemplatePicker(false)}
          onSelect={(tpl) => {
            setPptxTemplateId(tpl.id);
            setPptxTemplateName(tpl.name);
            setPptxTemplateStatus(tpl.status);
          }}
        />
      )}
    </>
  );
}
