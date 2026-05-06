import type { AgentRunMessage, AgentRunEvent } from '../../types';

/** Truncate a stringified value to ~50 chars with ellipsis. */
export function summarize(value: unknown, max = 50): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Derive up to N display lines from a run's events (most recent last). */
export function deriveFeedLines(events: AgentRunEvent[], take = 3): string[] {
  // Slice to last 10 raw events for performance, then derive, then take last N.
  const recent = events.slice(-10);
  const lines: string[] = [];
  for (const ev of recent) {
    if (ev.type === 'tool_call') {
      lines.push(`→ ${ev.tool} ${summarize(ev.args_summary)}`);
    } else if (ev.type === 'tool_result') {
      lines.push(`↓ ${ev.tool} returned (${summarize(ev.result_summary)})`);
    } else if (ev.type === 'thinking' || ev.type === 'text') {
      const t = ev.delta.trim();
      if (t) lines.push(t.length > 60 ? t.slice(0, 60) + '…' : t);
    }
    // 'started' and 'finished' contribute no feed line.
  }
  return lines.slice(-take);
}

/** Find the most recent in-flight tool name, for the tile header. */
export function currentToolName(events: AgentRunEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'tool_call') return ev.tool;
    if (ev.type === 'tool_result') return null; // last action was a return — between calls
  }
  return null;
}

export type StageRenderItem =
  | { type: 'message'; msg: any }
  | { type: 'stage'; runs: AgentRunMessage[] };

/** Group consecutive kind="agent_run" messages into stages. */
export function groupMessagesIntoStages<M extends { role: string; kind?: string | null; agent_run?: AgentRunMessage | null }>(
  messages: M[],
): Array<{ type: 'message'; msg: M } | { type: 'stage'; runs: AgentRunMessage[] }> {
  const out: Array<{ type: 'message'; msg: M } | { type: 'stage'; runs: AgentRunMessage[] }> = [];
  let buffer: AgentRunMessage[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      out.push({ type: 'stage', runs: buffer });
      buffer = [];
    }
  };
  for (const m of messages) {
    if (m.role === 'assistant' && m.kind === 'agent_run' && m.agent_run) {
      buffer.push(m.agent_run);
    } else {
      flush();
      out.push({ type: 'message', msg: m });
    }
  }
  flush();
  return out;
}
