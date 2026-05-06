import { useEffect, useState } from 'react';
import type { AgentRunMessage } from '../../types';
import { deriveFeedLines, currentToolName } from './agent-stage-utils';

function statusDotClass(run: AgentRunMessage): string {
  if (run.status === 'error') return 'bg-red-500';
  if (run.status === 'cancelled') return 'bg-gray-400';
  if (run.status === 'queued') return 'bg-gray-400';
  if (run.status === 'running') return 'bg-vetted-accent animate-pulse';
  return 'bg-emerald-500'; // done
}

function elapsedSeconds(run: AgentRunMessage, now: number): number {
  if (run.duration_ms != null) return Math.round(run.duration_ms / 1000);
  const startedEv = run.events.find((e) => e.type === 'started');
  if (!startedEv) return 0;
  const started = new Date(startedEv.ts).getTime();
  return Math.max(0, Math.round((now - started) / 1000));
}

export default function AgentTile({
  run,
  expanded,
  onToggle,
}: {
  run: AgentRunMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (run.status !== 'running' && run.status !== 'queued') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [run.status]);

  const seconds = elapsedSeconds(run, now);
  const tool = currentToolName(run.events);
  const lines = deriveFeedLines(run.events, 3);
  const isError = run.status === 'error';
  const isQueued = run.status === 'queued';
  const isCancelled = run.status === 'cancelled';
  const totalTokens = (run.tokens?.input ?? 0) + (run.tokens?.output ?? 0);

  let headerLabel: string;
  if (isQueued) headerLabel = 'queued';
  else if (isError) headerLabel = 'error';
  else if (isCancelled) headerLabel = 'cancelled';
  else if (run.status === 'running') headerLabel = tool ? `${seconds}s · ${tool}` : `${seconds}s`;
  else headerLabel = `${seconds}s · ${totalTokens.toLocaleString()} tok`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`text-left w-full bg-white border rounded-lg p-3 transition-colors hover:border-vetted-primary ${
        isError ? 'border-red-300 bg-red-50/40' : expanded ? 'border-vetted-primary' : 'border-vetted-border'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(run)}`} />
        <span className="text-xs font-medium text-vetted-primary truncate">{run.project_name}</span>
        <span className="ml-auto text-[11px] text-vetted-text-muted whitespace-nowrap">{headerLabel}</span>
      </div>
      {isError ? (
        <div className="font-mono text-[11px] text-red-600 leading-tight h-[3.6rem] overflow-hidden">
          {run.error || 'Unknown error'}
        </div>
      ) : (
        <div className="font-mono text-[11px] text-vetted-text-secondary leading-tight h-[3.6rem] overflow-hidden flex flex-col justify-end">
          {lines.length === 0 ? (
            <span className="text-vetted-text-muted/60">{isQueued ? 'queued…' : 'starting…'}</span>
          ) : (
            lines.map((l, i) => (
              <div key={i} className="truncate">{l}</div>
            ))
          )}
        </div>
      )}
    </button>
  );
}
