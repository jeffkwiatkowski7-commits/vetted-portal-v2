import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { FolderOpen, Plus, Search, Pencil } from 'lucide-react';
import type { Project } from '../types';
import ProjectForm from '../components/projects/ProjectForm';

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { user, addToast } = useStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sharedProjects, setSharedProjects] = useState<Project[]>([]);
  const [tab, setTab] = useState<'all' | 'mine' | 'shared'>('mine');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      // Fetch all relevant projects in one call (server-side filter via scope=all returns owned + shared)
      const data = await api.projects.list('all');
      const myProjects = data.filter((p: Project) => p.owner_id === user?.id);
      const shared = data.filter((p: Project) => p.owner_id !== user?.id);
      setProjects(myProjects);
      setSharedProjects(shared);
    } catch {
      addToast({ type: 'error', title: 'Failed to load projects' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (data: { name: string; description: string; system_prompt: string; tool_sets: string[]; mcp_servers: string[]; default_model: string }) => {
    setSaving(true);
    try {
      const project = await api.projects.create({
        name: data.name,
        description: data.description,
        system_prompt: data.system_prompt,
        mcp_servers: data.mcp_servers || [],
        default_model: data.default_model,
        temperature: 0.7,
      });
      setShowModal(false);
      loadProjects();
      addToast({ type: 'success', title: 'Project created' });
      return project;
    } catch {
      addToast({ type: 'error', title: 'Failed to create project' });
    } finally {
      setSaving(false);
    }
  };

  const visibleProjects = tab === 'all' ? [...projects, ...sharedProjects] : tab === 'mine' ? projects : sharedProjects;
  const filtered = visibleProjects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary">Loading projects...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Header */}
      <div className="border-b border-vetted-border p-6 shrink-0">
        <h1 className="text-xl font-serif text-vetted-primary mb-4">Projects</h1>

        {/* Tabs & Search */}
        <div className="flex gap-4 items-center justify-between">
          <div className="flex gap-2">
            {[
              { id: 'all', label: `All (${projects.length + sharedProjects.length})` },
              { id: 'mine', label: `My Projects (${projects.length})` },
              { id: 'shared', label: `Shared With Me (${sharedProjects.length})` },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id as 'all' | 'mine' | 'shared')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  tab === id
                    ? 'bg-vetted-accent text-vetted-primary'
                    : 'bg-vetted-surface text-vetted-text-secondary hover:bg-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3"
          >
            <Plus size={14} />
            New Project
          </button>
        </div>

        {/* Search */}
        <div className="mt-3 relative max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-vetted-text-muted"
          />
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent input-field"
          />
        </div>
      </div>

      {/* Projects Grid */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <FolderOpen size={48} className="mx-auto text-vetted-text-muted mb-4 opacity-50" />
            <p className="text-vetted-text-secondary">No projects found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((project) => {
              const isOwn = project.owner_id === user?.id;
              return (
                <div
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="group relative bg-white border border-vetted-border rounded-xl p-4 hover:shadow-md hover:border-vetted-accent/40 cursor-pointer transition-all"
                >
                  {(isOwn || project.permission === 'editor') && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}?settings=1`); }}
                      title="Edit project"
                      className="absolute top-3 right-3 p-1.5 rounded-md text-vetted-text-muted hover:bg-vetted-surface hover:text-vetted-accent opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  <div className="flex items-baseline gap-2 flex-wrap pr-8">
                    <h3 className="font-medium text-vetted-primary truncate">{project.name}</h3>
                    {isOwn ? (
                      <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded bg-vetted-accent/20 text-vetted-primary">
                        Owner
                      </span>
                    ) : project.permission && (
                      <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-vetted-accent/15 text-vetted-accent border border-vetted-accent/30">
                        {project.permission}
                      </span>
                    )}
                    {!isOwn && project.owner_name && (
                      <span className="text-xs text-vetted-text-muted">· {project.owner_name}</span>
                    )}
                  </div>

                  <p className="text-xs text-vetted-text-secondary mt-1 line-clamp-1">
                    {project.description || 'No description'}
                  </p>

                  <div className="flex gap-3 text-[11px] text-vetted-text-muted mt-2">
                    <span>{project.chat_count || 0} chats</span>
                    <span>{project.file_count || 0} files</span>
                    <span>{project.member_count || 1} {(project.member_count || 1) === 1 ? 'member' : 'members'}</span>
                    <span className="ml-auto">Updated {new Date(project.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <ProjectForm
          title="New Project"
          onSave={handleCreateProject}
          onCancel={() => setShowModal(false)}
          saving={saving}
        />
      )}
    </div>
  );
}
