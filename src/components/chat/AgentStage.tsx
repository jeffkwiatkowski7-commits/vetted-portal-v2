import { useEffect, useMemo, useState } from 'react';
import type { AgentRunMessage } from '../../types';
import AgentTile from './AgentTile';
import AgentRunCard from './AgentRunCard';

function stageElapsedSeconds(runs: AgentRunMessage[], now: number): number {
  let earliest = Infinity;
  let latest = 0;
  let anyRunning = false;
  for (const r of runs) {
    const startedEv = r.events.find((e) => e.type === 'started');
    if (!startedEv) continue;
    const started = new Date(startedEv.ts).getTime();
    if (started < earliest) earliest = started;
    if (r.status === 'running' || r.status === 'queued') {
      anyRunning = true;
    } else {
      const finishedEv = r.events.find((e) => e.type === 'finished');
      const ended = finishedEv ? new Date(finishedEv.ts).getTime() : started + (r.duration_ms ?? 0);
      if (ended > latest) latest = ended;
    }
  }
  if (earliest === Infinity) return 0;
  const end = anyRunning ? now : latest;
  return Math.max(0, Math.round((end - earliest) / 1000));
}

export default function AgentStage({
  runs,
  teamName,
  onRetry,
}: {
  runs: AgentRunMessage[];
  teamName?: string | null;
  onRetry?: (run: AgentRunMessage) => void;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  const anyRunning = runs.some((r) => r.status === 'running' || r.status === 'queued');
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const elapsed = stageElapsedSeconds(runs, now);
  const total = runs.length;
  const running = runs.filter((r) => r.status === 'running' || r.status === 'queued').length;

  const headerLabel = useMemo(() => {
    const teamPart = teamName ? `${teamName} team — ` : '';
    const countPart = anyRunning ? `${total} sub-agents · ${running} running` : `${total} sub-agents`;
    return `${teamPart}${countPart}`;
  }, [teamName, total, running, anyRunning]);

  if (runs.length === 0) return null;

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openRuns = runs.filter((r) => openIds.has(r.run_id));

  return (
    <div className="border border-vetted-border rounded-lg bg-vetted-surface/30 p-3 my-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-3 h-3 rounded-sm bg-vetted-primary/80" />
        <span className="text-xs font-medium text-vetted-primary">{headerLabel}</span>
        {elapsed > 0 && (
          <span className="ml-auto text-[11px] text-vetted-text-muted">{elapsed}s elapsed</span>
        )}
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
      >
        {runs.map((r) => (
          <AgentTile
            key={r.run_id}
            run={r}
            expanded={openIds.has(r.run_id)}
            onToggle={() => toggle(r.run_id)}
          />
        ))}
      </div>
      {openRuns.length > 0 && (
        <div className="mt-3 space-y-2">
          {openRuns.map((r) => (
            <AgentRunCard key={`detail-${r.run_id}`} run={r} onRetry={onRetry} />
          ))}
        </div>
      )}
    </div>
  );
}
