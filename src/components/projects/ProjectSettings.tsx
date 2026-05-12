import React, { useEffect, useState } from 'react';
import * as api from '../../api';
import { useStore } from '../../store';
import type { Project, ProjectAccess } from '../../types';
import AccordionSection from './AccordionSection';
import AccessSection from './AccessSection';

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
}

export default function ProjectSettings({ project, onUpdated }: Props) {
  const { addToast } = useStore();
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [systemPrompt, setSystemPrompt] = useState(project.system_prompt || '');
  const model = project.default_model || 'claude-opus-4-7';
  const temperature = project.temperature ?? 0.7;
  const [saving, setSaving] = useState(false);

  const isOwner = access?.your_level === 'owner' || access?.your_level === 'admin';
  const isWriter = isOwner || access?.your_level === 'editor';

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
    <div className="flex flex-col gap-3 max-w-5xl mx-auto py-6 px-6">
      <h1 className="font-serif font-bold text-3xl text-vetted-primary mb-2">{project.name}</h1>

      <AccordionSection
        num="i"
        title="Access & Sharing"
        summary={access
          ? `${access.members.filter(m => m.permission === 'editor').length} collaborators · ${access.members.filter(m => m.permission === 'viewer').length} viewers`
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
        summary="Use the ⚙ Settings button (top-right) to manage these for now"
      >
        <p className="text-sm text-vetted-text-muted">
          Detailed editors for tool sets, MCP servers, skills, branded templates, and project files
          are available in the existing project Settings dialog. They will be migrated into this
          accordion in a follow-up.
        </p>
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
  );
}
