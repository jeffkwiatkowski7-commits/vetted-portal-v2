import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import * as api from '../api';
import { Clock, Plus, Play, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { ScheduledTask, ScheduledTaskRun } from '../types';

/**
 * /tasks — Claude-desktop-style scheduled task manager.
 *
 * Each task is { name, prompt, schedule, mcp_servers }. Cloud Scheduler is the
 * thing that actually fires them on a cron — the UI here just creates/edits the
 * definition and lets the user trigger a manual run.
 */
export default function TasksPage() {
  const { addToast } = useStore();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScheduledTask | null>(null);
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([]);

  useEffect(() => { loadTasks(); }, []);

  const loadTasks = async () => {
    try {
      const data = await api.tasks.list();
      setTasks(data);
    } catch {
      addToast({ type: 'error', title: 'Failed to load tasks' });
    } finally {
      setLoading(false);
    }
  };

  const openTask = async (task: ScheduledTask) => {
    setSelected(task);
    try {
      const data = await api.tasks.runs(task.id);
      setRuns(data);
    } catch {
      setRuns([]);
    }
  };

  const handleRun = async (task: ScheduledTask) => {
    setRunning(task.id);
    try {
      await api.tasks.run(task.id);
      addToast({ type: 'success', title: `Ran "${task.name}"` });
      await loadTasks();
      if (selected?.id === task.id) await openTask(task);
    } catch (err: any) {
      addToast({ type: 'error', title: 'Run failed', detail: err.message });
    } finally {
      setRunning(null);
    }
  };

  const handleDelete = async (task: ScheduledTask) => {
    if (!confirm(`Delete task "${task.name}"?`)) return;
    try {
      await api.tasks.delete(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      if (selected?.id === task.id) setSelected(null);
      addToast({ type: 'success', title: 'Task deleted' });
    } catch {
      addToast({ type: 'error', title: 'Delete failed' });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-serif font-bold text-vetted-primary">Scheduled Tasks</h1>
            <p className="text-sm text-vetted-text-secondary mt-1">
              Recurring prompts that Claude runs on a schedule. Triggered by Cloud Scheduler.
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary text-sm py-2 px-4 flex items-center gap-2"
          >
            <Plus size={16} /> New task
          </button>
        </div>

        {loading ? (
          <div className="text-vetted-text-secondary">Loading…</div>
        ) : tasks.length === 0 ? (
          <EmptyState onCreate={() => setShowForm(true)} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {tasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  active={selected?.id === t.id}
                  running={running === t.id}
                  onOpen={() => openTask(t)}
                  onRun={() => handleRun(t)}
                  onDelete={() => handleDelete(t)}
                />
              ))}
            </div>
            <div>
              {selected ? (
                <RunHistory task={selected} runs={runs} />
              ) : (
                <div className="rounded-lg border border-vetted-border p-6 text-sm text-vetted-text-secondary">
                  Select a task to see run history.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <NewTaskModal
          onClose={() => setShowForm(false)}
          onCreated={async () => { setShowForm(false); await loadTasks(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-vetted-border p-12 text-center">
      <Clock className="mx-auto mb-4 text-vetted-accent" size={32} />
      <h2 className="text-lg font-serif font-semibold text-vetted-primary">No scheduled tasks yet</h2>
      <p className="text-sm text-vetted-text-secondary mt-2 mb-6">
        Create a task to have Claude run a prompt on a recurring schedule — daily reports,
        weekly digests, end-of-month summaries.
      </p>
      <button onClick={onCreate} className="btn-primary text-sm py-2 px-4">Create your first task</button>
    </div>
  );
}

function TaskCard({
  task, active, running, onOpen, onRun, onDelete,
}: {
  task: ScheduledTask;
  active: boolean;
  running: boolean;
  onOpen: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      className={`rounded-lg border p-4 cursor-pointer transition ${
        active ? 'border-vetted-accent bg-vetted-accent/5' : 'border-vetted-border hover:border-vetted-accent/50'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-vetted-primary truncate">{task.name}</h3>
            {!task.enabled && (
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">paused</span>
            )}
          </div>
          <p className="text-sm text-vetted-text-secondary mt-1 line-clamp-2">{task.prompt}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-vetted-text-secondary">
            <span className="font-mono">{task.cron_expression || task.schedule_type}</span>
            {task.last_run_at && (
              <span className="flex items-center gap-1">
                {task.last_status === 'success' ? (
                  <CheckCircle2 size={12} className="text-green-600" />
                ) : task.last_status === 'error' ? (
                  <AlertCircle size={12} className="text-red-600" />
                ) : null}
                last: {new Date(task.last_run_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onRun}
            disabled={running}
            className="p-2 rounded hover:bg-vetted-accent/10 text-vetted-accent disabled:opacity-50"
            title="Run now"
          >
            <Play size={16} />
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded hover:bg-red-50 text-red-600"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function RunHistory({ task, runs }: { task: ScheduledTask; runs: ScheduledTaskRun[] }) {
  return (
    <div className="rounded-lg border border-vetted-border p-4">
      <h3 className="font-medium text-vetted-primary mb-3">Run history — {task.name}</h3>
      {runs.length === 0 ? (
        <p className="text-sm text-vetted-text-secondary">No runs yet.</p>
      ) : (
        <ul className="space-y-3">
          {runs.map((r) => (
            <li key={r.id} className="text-sm border-l-2 pl-3" style={{
              borderColor: r.status === 'success' ? '#16a34a' : r.status === 'error' ? '#dc2626' : '#9ca3af',
            }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs">
                  {new Date(r.started_at).toLocaleString()}
                </span>
                <span className="text-xs capitalize text-vetted-text-secondary">
                  {r.status}{r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ''}
                </span>
              </div>
              {r.status === 'error' && r.error_message && (
                <p className="text-xs text-red-600 mt-1">{r.error_message}</p>
              )}
              {r.result_text && (
                <p className="text-xs text-vetted-text-secondary mt-1 line-clamp-3 whitespace-pre-wrap">
                  {r.result_text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { addToast } = useStore();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scheduleType, setScheduleType] = useState<'cron' | 'manual'>('cron');
  const [cron, setCron] = useState('0 9 * * MON-FRI');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || !prompt.trim()) {
      addToast({ type: 'error', title: 'Name and prompt are required' });
      return;
    }
    setSaving(true);
    try {
      await api.tasks.create({
        name,
        prompt,
        schedule_type: scheduleType,
        cron_expression: scheduleType === 'cron' ? cron : null,
        enabled: true,
        delivery: { type: 'notification' },
      });
      addToast({ type: 'success', title: 'Task created' });
      onCreated();
    } catch (err: any) {
      addToast({ type: 'error', title: 'Create failed', detail: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-serif font-semibold text-vetted-primary mb-4">New scheduled task</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Name</label>
            <input
              className="w-full border border-vetted-border rounded px-3 py-2 text-sm"
              placeholder="Daily lease portfolio summary"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Prompt</label>
            <textarea
              className="w-full border border-vetted-border rounded px-3 py-2 text-sm font-mono"
              rows={4}
              placeholder="Summarize any leases that expire in the next 90 days and flag negotiation priorities."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-vetted-text-secondary mb-1">Schedule</label>
            <div className="flex gap-3">
              <select
                className="border border-vetted-border rounded px-2 py-2 text-sm"
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value as any)}
              >
                <option value="cron">Cron</option>
                <option value="manual">Manual / on-demand</option>
              </select>
              {scheduleType === 'cron' && (
                <input
                  className="flex-1 border border-vetted-border rounded px-3 py-2 text-sm font-mono"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="0 9 * * MON-FRI"
                />
              )}
            </div>
            {scheduleType === 'cron' && (
              <p className="text-xs text-vetted-text-secondary mt-1">
                5-field cron in your container's timezone. Cloud Scheduler is what actually fires this.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-vetted-border">Cancel</button>
          <button onClick={submit} disabled={saving} className="btn-primary text-sm px-4 py-2">
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
