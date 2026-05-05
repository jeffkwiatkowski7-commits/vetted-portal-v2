import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X as XIcon, Loader2 } from 'lucide-react';
import type { AgentRunMessage } from '../../types';

export default function AgentRunCard({
  run,
  onRetry,
}: {
  run: AgentRunMessage;
  onRetry?: (run: AgentRunMessage) => void;
}) {
  const [open, setOpen] = useState(run.status === 'running');
  const isError = run.status === 'error' || run.error;
  const isRunning = run.status === 'running' || run.status === 'queued';
  const isCancelled = run.status === 'cancelled';
  const totalTokens = (run.tokens?.input ?? 0) + (run.tokens?.output ?? 0);
  const seconds = Math.round((run.duration_ms ?? 0) / 1000);

  const dotColor = isError
    ? 'bg-red-500'
    : isCancelled
    ? 'bg-gray-400'
    : isRunning
    ? 'bg-vetted-accent'
    : 'bg-emerald-500';

  return (
    <div className={`border rounded-lg my-2 ${isError ? 'border-red-300 bg-red-50/40' : 'border-vetted-border bg-white'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-vetted-surface/40"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${isRunning ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-medium text-vetted-primary">{run.project_name}</span>
        <span className="text-[11px] text-vetted-text-muted">
          {isRunning ? 'running…' : isCancelled ? 'cancelled' : isError ? 'error' : `${seconds}s · ${totalTokens.toLocaleString()} tok`}
        </span>
        <span className="ml-auto text-vetted-text-muted">
          {isError ? <XIcon size={12} /> : isRunning ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        </span>
        <span className="text-vetted-text-muted">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>
      {open && (
        <div className="border-t border-vetted-border px-3 py-2 text-xs">
          {run.error && <div className="text-red-600 mb-2">Error: {run.error}</div>}
          {run.status === 'error' && onRetry && (
            <button
              onClick={() => onRetry(run)}
              className="mt-2 mb-3 px-3 py-1.5 text-xs bg-vetted-primary text-white rounded-lg hover:bg-black"
            >
              Retry this sub-agent
            </button>
          )}
          {run.prompt && (
            <details className="mb-2">
              <summary className="cursor-pointer text-vetted-text-muted">Prompt</summary>
              <pre className="font-mono text-[11px] whitespace-pre-wrap mt-1 text-vetted-text-secondary">{run.prompt}</pre>
            </details>
          )}
          {run.status === 'running' && run.events && run.events.length > 0 && (
            <div className="font-mono text-[11px] text-vetted-text-muted whitespace-pre-wrap max-h-40 overflow-y-auto border border-dashed border-vetted-border rounded p-2 my-2">
              {run.events
                .filter((e: any) => e.delta || e.tool)
                .slice(-30)
                .map((e: any, i: number) => (
                  <div key={i}>{e.tool ? `→ ${e.tool} ${e.args_summary || ''}` : e.delta}</div>
                ))}
            </div>
          )}
          {run.final_message && (
            <div className="whitespace-pre-wrap text-vetted-primary">{run.final_message}</div>
          )}
          {run.events && run.events.length > 0 && run.status !== 'running' && (
            <details className="mt-2">
              <summary className="cursor-pointer text-vetted-text-muted">Event log ({run.events.length})</summary>
              <pre className="font-mono text-[10px] whitespace-pre-wrap mt-1 max-h-60 overflow-y-auto bg-vetted-surface p-2 rounded">{run.events.map((e: any) => `[${e.type}] ${e.delta ?? e.tool ?? e.prompt_summary ?? ''}`.trim()).join('\n')}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
