import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { Sparkles, Plus, Search, FileText, Trash2, Pencil } from 'lucide-react';
import type { Skill } from '../types';

export default function SkillsPage() {
  const navigate = useNavigate();
  const { addToast } = useStore();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      const data = await api.skills.list();
      setSkills(data);
    } catch {
      addToast({ type: 'error', title: 'Failed to load skills' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete skill "${name}"? This will remove it from all projects.`)) return;
    try {
      await api.skills.delete(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
      addToast({ type: 'success', title: 'Skill deleted' });
    } catch {
      addToast({ type: 'error', title: 'Failed to delete skill' });
    }
  };

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-serif font-bold text-vetted-primary">Skills</h1>
            <p className="text-sm text-vetted-text-secondary mt-1">
              Reusable instruction sets that modify AI behavior when activated in a project.
            </p>
          </div>
          <button
            onClick={() => navigate('/skills/new')}
            className="btn-primary text-sm py-2 px-4 flex items-center gap-2"
          >
            <Plus size={16} />
            New Skill
          </button>
        </div>

        {/* Search */}
        {skills.length > 0 && (
          <div className="relative mb-6">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vetted-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
            />
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-16 text-vetted-text-muted text-sm">Loading skills...</div>
        )}

        {/* Empty state */}
        {!loading && skills.length === 0 && (
          <div className="text-center py-16">
            <Sparkles size={48} className="mx-auto mb-4 text-vetted-text-muted opacity-40" />
            <h3 className="text-lg font-medium text-vetted-primary mb-2">No skills yet</h3>
            <p className="text-sm text-vetted-text-secondary mb-6">
              Create a skill to define reusable AI behaviors for your projects.
            </p>
            <button
              onClick={() => navigate('/skills/new')}
              className="btn-primary text-sm py-2 px-4 inline-flex items-center gap-2"
            >
              <Plus size={16} />
              Create your first skill
            </button>
          </div>
        )}

        {/* Skills grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((skill) => (
              <div
                key={skill.id}
                className="card p-5 cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => navigate(`/skills/${skill.id}/edit`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-vetted-accent/10 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={18} className="text-vetted-accent" />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/skills/${skill.id}/edit`);
                      }}
                      className="p-1.5 hover:bg-vetted-surface rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Pencil size={14} className="text-vetted-text-muted" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(skill.id, skill.name);
                      }}
                      className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} className="text-vetted-danger" />
                    </button>
                  </div>
                </div>
                <h3 className="text-sm font-medium text-vetted-primary mb-1 truncate">{skill.name}</h3>
                {skill.description && (
                  <p className="text-xs text-vetted-text-secondary line-clamp-2 mb-3">{skill.description}</p>
                )}
                <div className="flex items-center gap-3 text-xs text-vetted-text-muted mt-auto pt-2">
                  {(skill.file_count ?? 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <FileText size={12} />
                      {skill.file_count} file{skill.file_count !== 1 ? 's' : ''}
                    </span>
                  )}
                  <span>{new Date(skill.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No results */}
        {!loading && skills.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-vetted-text-muted">
            No skills match "{search}"
          </div>
        )}
      </div>
    </div>
  );
}
