import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import * as api from '../../api';
import { useStore } from '../../store';
import type { Project, ProjectAccess } from '../../types';
import AccordionSection from './AccordionSection';
import AccessSection from './AccessSection';
import ProjectForm from './ProjectForm';

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
}

export default function ProjectSettings({ project, onUpdated }: Props) {
  const { addToast, projectFiles, setProjectFiles, setRightPanelOpen } = useStore();
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [systemPrompt, setSystemPrompt] = useState(project.system_prompt || '');
  const model = project.default_model || 'claude-opus-4-7';
  const temperature = project.temperature ?? 0.7;
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isOwner = access?.your_level === 'owner' || access?.your_level === 'admin';
  const isWriter = isOwner || access?.your_level === 'editor';

  async function handleAdvancedSave(data: { name: string; description: string; system_prompt: string; tool_sets: string[]; mcp_servers: string[]; file_ids: string[]; pptx_template_id: string | null }) {
    setSaving(true);
    try {
      const updated = await api.projects.update(project.id, {
        name: data.name,
        description: data.description,
        system_prompt: data.system_prompt,
        mcp_servers: data.mcp_servers || [],
        pptx_template_id: data.pptx_template_id,
      });
      // Sync file assignments
      const oldIds = new Set(projectFiles.map((f) => f.id));
      const newIds = new Set(data.file_ids);
      const toAdd = data.file_ids.filter((fid) => !oldIds.has(fid));
      const toRemove = projectFiles.filter((f) => !newIds.has(f.id)).map((f) => f.id);
      await Promise.all([
        ...toAdd.map((fid) => api.library.assignProject(fid, project.id)),
        ...toRemove.map((fid) => api.library.assignProject(fid, null)),
      ]);
      const updatedFiles = await api.library.list(project.id);
      setProjectFiles(updatedFiles);
      if (updatedFiles.length > 0) setRightPanelOpen(true);
      onUpdated(updated);
      setShowAdvanced(false);
      addToast({ type: 'success', title: 'Project updated' });
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Save failed' });
    } finally { setSaving(false); }
  }

  async function saveGeneral() {
    setSaving(true);
    try {
      const updated = await api.projects.update(project.id, {
        name, description, system_prompt: systemPrompt,
      });
      onUpdated(updated);
      addToast({ type: 'success', title: 'Project saved' });
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Save failed' });
    } finally { setSaving(false); }
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="flex flex-col gap-3 mx-auto py-6 px-8 max-w-[1400px]">
      <h1 className="font-serif font-bold text-3xl text-vetted-primary mb-2">{project.name}</h1>

      <AccordionSection
        num="i"
        title="Access & Sharing"
        summary={access
          ? (() => {
              const c = access.members.filter(m => m.permission === 'editor').length;
              const v = access.members.filter(m => m.permission === 'viewer').length;
              return `${c} ${c === 1 ? 'collaborator' : 'collaborators'} · ${v} ${v === 1 ? 'viewer' : 'viewers'}`;
            })()
          : 'Loading…'}
        defaultOpen
      >
        <AccessSection projectId={project.id} onAccessChange={setAccess} />
      </AccordionSection>

      <AccordionSection
        num="ii"
        title="General"
        summary={`${project.name}${project.status ? ` · ${project.status}` : ''}`}
        defaultOpen
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-vetted-primary mb-1">Project name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isWriter}
              className="w-full border border-vetted-border rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-vetted-primary mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isWriter}
              rows={3}
              className="w-full border border-vetted-border rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
            />
          </div>
          {isWriter && (
            <button
              type="button"
              onClick={saveGeneral}
              disabled={saving}
              className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </AccordionSection>

      <AccordionSection
        num="iii"
        title="AI Defaults"
        summary={`${model} · temp ${temperature.toFixed(2)}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-vetted-primary mb-1">System prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={!isWriter}
              rows={6}
              className="w-full border border-vetted-border rounded-lg px-3 py-2 text-sm font-mono bg-white disabled:opacity-50"
            />
          </div>
          {isWriter && (
            <button
              type="button"
              onClick={saveGeneral}
              disabled={saving}
              className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </AccordionSection>

      <AccordionSection
        num="iv"
        title="Tools, Skills, Templates, Files"
        summary={`${projectFiles.length} ${projectFiles.length === 1 ? 'file' : 'files'} attached`}
      >
        <div className="space-y-3">
          <p className="text-sm text-vetted-text-muted">
            Manage tool sets, MCP servers, skills, branded PPTX templates, and project files
            (including adding files from the Library) in the full editor.
          </p>
          {isWriter && (
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              className="inline-flex items-center gap-2 bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary transition-colors"
            >
              <SettingsIcon size={14} />
              Open full editor
            </button>
          )}
        </div>
      </AccordionSection>

      {isOwner && (
        <AccordionSection num="—" title="Danger Zone" summary="Archive or delete the project. Owner only." danger>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={async () => {
                if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
                await api.projects.delete(project.id);
                window.location.href = '/projects';
              }}
              className="text-sm text-red-600 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-600 hover:text-white"
            >
              Delete project…
            </button>
          </div>
        </AccordionSection>
      )}
      </div>

      {showAdvanced && (
        <ProjectForm
          title={`Edit: ${project.name}`}
          initialData={{
            name: project.name,
            description: project.description,
            system_prompt: project.system_prompt,
            tool_sets: project.tool_sets as unknown as string[],
            mcp_servers: project.mcp_servers as unknown as string[],
            file_ids: projectFiles.map((f) => f.id),
            pptx_template_id: (project as any).pptx_template_id ?? null,
          }}
          projectId={project.id}
          onSave={handleAdvancedSave}
          onCancel={() => setShowAdvanced(false)}
          saving={saving}
        />
      )}
    </div>
  );
}
