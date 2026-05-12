import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, X, GripVertical, Play, Trash2, Clock } from 'lucide-react';
import * as api from '../api';
import type { Team, TeamMember, Project, TeamSchedule } from '../types';

const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: 'Every hour',          expr: '0 * * * *'  },
  { label: 'Every day at 9am',    expr: '0 9 * * *'  },
  { label: 'Weekdays at 9am',     expr: '0 9 * * 1-5'},
  { label: 'Every Monday 9am',    expr: '0 9 * * 1'  },
  { label: '1st of month 9am',    expr: '0 9 1 * *'  },
];

function formatRelative(iso?: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const sec = Math.round(abs / 1000);
  const min = Math.round(sec / 60);
  const hr  = Math.round(min / 60);
  const day = Math.round(hr / 24);
  const v = day >= 1 ? `${day}d` : hr >= 1 ? `${hr}h` : min >= 1 ? `${min}m` : `${sec}s`;
  return ms < 0 ? `${v} ago` : `in ${v}`;
}

function ScheduleCard({
  schedule,
  teamId,
  onChange,
  onDelete,
}: {
  schedule: TeamSchedule;
  teamId: string;
  onChange: (s: TeamSchedule) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<TeamSchedule>(schedule);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setDraft(schedule); }, [schedule]);

  const dirty =
    draft.name !== schedule.name ||
    draft.cron_expression !== schedule.cron_expression ||
    draft.timezone !== schedule.timezone ||
    draft.prompt !== schedule.prompt ||
    draft.enabled !== schedule.enabled;

  const save = async () => {
    setSavingField('save');
    setErr(null);
    try {
      const updated = await api.teamSchedules.update(teamId, schedule.id, {
        name: draft.name ?? null,
        cron_expression: draft.cron_expression,
        timezone: draft.timezone,
        prompt: draft.prompt,
        enabled: draft.enabled,
      });
      onChange(updated);
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally {
      setSavingField(null);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      await api.teamSchedules.run(teamId, schedule.id);
    } catch (e: any) {
      setErr(e?.message || 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="border border-vetted-border rounded-lg p-4 bg-vetted-surface/30">
      <div className="flex items-start gap-3 mb-3">
        <input
          value={draft.name ?? ''}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Schedule name (optional)"
          className="flex-1 px-2 py-1 text-sm font-medium bg-transparent border border-transparent hover:border-vetted-border focus:border-vetted-border rounded outline-none"
        />
        <label className="flex items-center gap-1.5 text-xs text-vetted-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={!!draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked ? 1 : 0 })}
          />
          Enabled
        </label>
        <button
          onClick={runNow}
          disabled={running}
          title="Run now"
          className="p-1.5 hover:bg-vetted-border rounded text-vetted-primary disabled:opacity-50"
        >
          <Play size={14} />
        </button>
        <button
          onClick={() => onDelete(schedule.id)}
          title="Delete schedule"
          className="p-1.5 hover:bg-vetted-border rounded text-vetted-text-muted"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 mb-3">
        <label className="text-xs text-vetted-text-muted self-center">Cron</label>
        <div className="flex items-center gap-2">
          <input
            value={draft.cron_expression}
            onChange={(e) => setDraft({ ...draft, cron_expression: e.target.value })}
            placeholder="m h dom mon dow"
            className="flex-1 px-2 py-1 border border-vetted-border rounded text-xs font-mono"
          />
          <select
            value=""
            onChange={(e) => e.target.value && setDraft({ ...draft, cron_expression: e.target.value })}
            className="px-2 py-1 border border-vetted-border rounded text-xs"
          >
            <option value="">Presets…</option>
            {CRON_PRESETS.map((p) => (
              <option key={p.expr} value={p.expr}>{p.label}</option>
            ))}
          </select>
        </div>

        <label className="text-xs text-vetted-text-muted self-center">Timezone</label>
        <input
          value={draft.timezone}
          onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
          placeholder="UTC"
          className="px-2 py-1 border border-vetted-border rounded text-xs font-mono w-48"
        />

        <label className="text-xs text-vetted-text-muted">Prompt</label>
        <textarea
          value={draft.prompt}
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          placeholder="The kickoff message sent to the orchestrator each run."
          rows={3}
          className="w-full px-2 py-1 border border-vetted-border rounded text-xs"
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-vetted-text-muted">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clock size={11} /> Last: {formatRelative(schedule.last_run_at)}
          </span>
          <span>·</span>
          <span>Next: {formatRelative(schedule.next_run_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-red-600">{err}</span>}
          {dirty && (
            <button
              onClick={save}
              disabled={savingField === 'save'}
              className="px-2 py-1 bg-vetted-primary text-white rounded text-xs hover:bg-black disabled:opacity-50"
            >
              {savingField === 'save' ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SchedulesSection({ teamId }: { teamId: string }) {
  const [schedules, setSchedules] = useState<TeamSchedule[]>([]);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.teamSchedules.list(teamId).then(setSchedules).catch(() => setSchedules([]));
  }, [teamId]);

  const handleCreate = async () => {
    setCreating(true);
    setErr(null);
    try {
      const fresh = await api.teamSchedules.create(teamId, {
        name: 'New schedule',
        cron_expression: '0 9 * * *',
        timezone: 'UTC',
        prompt: '',
        enabled: 0,
      });
      setSchedules((prev) => [...prev, fresh]);
    } catch (e: any) {
      setErr(e?.message || 'Could not create schedule');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    await api.teamSchedules.delete(teamId, id);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  const handleChange = (s: TeamSchedule) =>
    setSchedules((prev) => prev.map((x) => (x.id === s.id ? s : x)));

  return (
    <section className="bg-white rounded-xl border border-vetted-border p-6 mt-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-medium text-vetted-primary">Schedules</h2>
          <p className="text-xs text-vetted-text-muted mt-0.5">
            Run this team automatically on a cron schedule. Each fire creates a new chat with the team active.
          </p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-vetted-surface rounded-lg text-xs hover:bg-vetted-border disabled:opacity-50"
        >
          <Plus size={12} /> New schedule
        </button>
      </div>
      {err && <p className="text-xs text-red-600 mb-3">{err}</p>}
      {schedules.length === 0 ? (
        <p className="text-xs text-vetted-text-muted py-4 text-center">No schedules yet.</p>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              teamId={teamId}
              onChange={handleChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}

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

        {/* Schedules */}
        {!isNew && id && <SchedulesSection teamId={id} />}

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
