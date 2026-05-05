import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, X, GripVertical } from 'lucide-react';
import * as api from '../api';
import type { Team, TeamMember, Project } from '../types';

function ProjectPickerModal({
  excludeIds,
  onClose,
  onPick,
}: {
  excludeIds: string[];
  onClose: () => void;
  onPick: (project: Project) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    api.projects.list().then(setProjects).catch(() => setProjects([]));
  }, []);
  const available = useMemo(
    () => projects.filter((p) => !excludeIds.includes(p.id)),
    [projects, excludeIds],
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-vetted-border">
          <h3 className="text-base font-medium text-vetted-primary">Add a sub-agent</h3>
          <button onClick={onClose} className="p-1 hover:bg-vetted-surface rounded-lg"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-vetted-border">
          {available.length === 0 ? (
            <p className="text-sm text-vetted-text-muted text-center py-8">No more projects to add.</p>
          ) : (
            available.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="w-full text-left px-5 py-3 hover:bg-vetted-surface"
              >
                <div className="text-sm font-medium text-vetted-primary">{p.name}</div>
                {p.description && (
                  <div className="text-xs text-vetted-text-muted mt-0.5 line-clamp-1">{p.description}</div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeamEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isNew = !id;

  const [team, setTeam] = useState<Partial<Team>>({ name: '', description: '', playbook: '' });
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return;
    api.teams.get(id!).then((t) => {
      setTeam(t);
      setMembers(t.members || []);
    });
  }, [id, isNew]);

  const handleSaveIdentity = async (): Promise<string> => {
    if (!team.name?.trim()) {
      alert('Name is required');
      throw new Error('name required');
    }
    setSaving(true);
    try {
      if (isNew) {
        const created = await api.teams.create({
          name: team.name.trim(),
          description: team.description ?? undefined,
          playbook: team.playbook ?? undefined,
        });
        navigate(`/teams/${created.id}/edit`, { replace: true });
        return created.id;
      } else {
        await api.teams.update(id!, {
          name: team.name.trim(),
          description: team.description,
          playbook: team.playbook,
        });
        return id!;
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async (project: Project) => {
    if (isNew) {
      const newId = await handleSaveIdentity();
      const m = await api.teams.addMember(newId, { project_id: project.id });
      setMembers((prev) => [...prev, { ...m, project_name: project.name }]);
    } else {
      const m = await api.teams.addMember(id!, { project_id: project.id });
      setMembers((prev) => [...prev, { ...m, project_name: project.name }]);
    }
    setPicking(false);
  };

  const handleRemoveMember = async (memberId: string) => {
    await api.teams.removeMember(id!, memberId);
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  const handleUpdatePurpose = async (memberId: string, purpose: string) => {
    await api.teams.updateMember(id!, memberId, { purpose });
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, purpose } : m)));
  };

  return (
    <div className="flex-1 overflow-y-auto bg-vetted-bg">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <button
          onClick={() => navigate('/teams')}
          className="flex items-center gap-1.5 text-xs text-vetted-text-muted hover:text-vetted-primary mb-4"
        >
          <ArrowLeft size={14} /> Back to Teams
        </button>

        {/* Identity */}
        <section className="bg-white rounded-xl border border-vetted-border p-6 mb-4">
          <h2 className="text-sm font-medium text-vetted-primary mb-4">Identity</h2>
          <label className="block text-xs text-vetted-text-muted mb-1">Name</label>
          <input
            value={team.name ?? ''}
            onChange={(e) => setTeam({ ...team, name: e.target.value })}
            placeholder="Investment memo team"
            className="w-full px-3 py-2 border border-vetted-border rounded-lg text-sm mb-3"
          />
          <label className="block text-xs text-vetted-text-muted mb-1">Description</label>
          <input
            value={team.description ?? ''}
            onChange={(e) => setTeam({ ...team, description: e.target.value })}
            placeholder="One-line description"
            className="w-full px-3 py-2 border border-vetted-border rounded-lg text-sm mb-3"
          />
          <button
            onClick={handleSaveIdentity}
            disabled={saving}
            className="px-4 py-2 bg-vetted-primary text-white rounded-lg text-sm hover:bg-black disabled:opacity-50"
          >
            {isNew ? 'Create team' : 'Save'}
          </button>
        </section>

        {/* Members */}
        {!isNew && (
          <section className="bg-white rounded-xl border border-vetted-border p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-vetted-primary">Sub-agents</h2>
              <button
                onClick={() => setPicking(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-vetted-surface rounded-lg text-xs hover:bg-vetted-border"
              >
                <Plus size={12} /> Add project
              </button>
            </div>
            {members.length === 0 ? (
              <p className="text-xs text-vetted-text-muted py-4 text-center">No sub-agents yet.</p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-3 border border-vetted-border rounded-lg">
                    <GripVertical size={14} className="text-vetted-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-vetted-primary">{m.project_name}</div>
                      <input
                        value={m.purpose ?? ''}
                        onChange={(e) => setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, purpose: e.target.value } : x)))}
                        onBlur={(e) => handleUpdatePurpose(m.id, e.target.value)}
                        placeholder={m.project_description || 'Purpose for this team'}
                        className="w-full text-xs text-vetted-text-muted bg-transparent outline-none mt-0.5"
                      />
                    </div>
                    <button
                      onClick={() => handleRemoveMember(m.id)}
                      className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Playbook */}
        {!isNew && (
          <section className="bg-white rounded-xl border border-vetted-border p-6">
            <h2 className="text-sm font-medium text-vetted-primary mb-2">Playbook</h2>
            <p className="text-xs text-vetted-text-muted mb-3">
              Markdown instructions injected into the orchestrator's system prompt when this team is active. Describe the recommended sequence of sub-agents.
            </p>
            <textarea
              value={team.playbook ?? ''}
              onChange={(e) => setTeam({ ...team, playbook: e.target.value })}
              onBlur={() => api.teams.update(id!, { playbook: team.playbook ?? '' })}
              rows={10}
              className="w-full px-3 py-2 border border-vetted-border rounded-lg text-sm font-mono"
              placeholder="1. Run Researcher to gather market comps.&#10;2. Run Analyst with the rent roll.&#10;3. Run Writer to produce the IC memo."
            />
          </section>
        )}

        {picking && (
          <ProjectPickerModal
            excludeIds={members.map((m) => m.project_id)}
            onClose={() => setPicking(false)}
            onPick={handleAddMember}
          />
        )}
      </div>
    </div>
  );
}
