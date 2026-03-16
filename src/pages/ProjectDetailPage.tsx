import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { ArrowLeft, Settings, Upload, Users, BookOpen, Cpu } from 'lucide-react';
import type { Project } from '../types';
import ChatInput from '../components/chat/ChatInput';
import ProjectForm from '../components/projects/ProjectForm';

const QUICK_ACTIONS = [
  { label: 'Summarize files', icon: BookOpen },
  { label: 'Draft with persona', icon: Users },
  { label: 'Run MCP tool', icon: Cpu },
  { label: 'Upload context', icon: Upload },
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useStore();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) loadProject();
  }, [id]);

  const loadProject = async () => {
    try {
      const proj = await api.projects.get(id!);
      setProject(proj);
    } catch {
      addToast({ type: 'error', title: 'Failed to load project' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProject = async (data: { name: string; description: string; system_prompt: string; tool_sets: string[] }) => {
    if (!project || !id) return;
    setSaving(true);
    try {
      await api.projects.update(id, {
        name: data.name,
        description: data.description,
        system_prompt: data.system_prompt,
        tool_sets: JSON.stringify(data.tool_sets),
      });
      setProject({ ...project, name: data.name, description: data.description, system_prompt: data.system_prompt });
      setShowSettings(false);
      addToast({ type: 'success', title: 'Project updated' });
    } catch {
      addToast({ type: 'error', title: 'Failed to update project' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!project || !id) return;
    if (!window.confirm('Delete this project?')) return;
    try {
      await api.projects.delete(id);
      navigate('/projects');
    } catch {
      addToast({ type: 'error', title: 'Failed to delete project' });
    }
  };

  if (loading || !project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary text-sm">Loading project...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Slim project header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-vetted-border">
        <button
          onClick={() => navigate('/projects')}
          className="p-1 hover:bg-vetted-surface rounded transition-colors"
        >
          <ArrowLeft size={15} className="text-vetted-text-secondary" />
        </button>
        <span className="text-sm font-medium text-vetted-primary flex-1">{project.name}</span>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1 hover:bg-vetted-surface rounded transition-colors"
          title="Project settings"
        >
          <Settings size={15} className="text-vetted-text-secondary" />
        </button>
      </div>

      {showSettings && project && (
        <ProjectForm
          title={`Edit: ${project.name}`}
          initialData={{
            name: project.name,
            description: project.description,
            system_prompt: project.system_prompt,
            tool_sets: project.tool_sets as unknown as string[],
          }}
          onSave={handleUpdateProject}
          onCancel={() => setShowSettings(false)}
          onDelete={handleDeleteProject}
          saving={saving}
        />
      )}

      {/* Chat area — same layout as main chat empty state */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
        <h2 className="text-3xl font-playfair text-vetted-primary mb-8">{project.name}</h2>
        {project.description && (
          <p className="text-sm text-vetted-text-secondary mb-6 max-w-md text-center">{project.description}</p>
        )}
        <div className="w-full max-w-3xl">
          <ChatInput centered projectId={id} />
        </div>
        <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
          {QUICK_ACTIONS.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-vetted-border text-sm text-vetted-text-secondary hover:border-vetted-accent hover:text-vetted-primary transition-colors bg-white"
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
