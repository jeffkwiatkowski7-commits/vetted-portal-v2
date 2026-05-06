# Agent Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current sequence of stacked `AgentRunCard`s with a single rich inline **Stage** block per assistant turn — sub-agents render side-by-side as live tiles with a 3-line activity feed; clicking a tile reveals the existing `AgentRunCard` (event log + final output) stacked below the grid.

**Architecture:** Two new presentational React components (`AgentStage`, `AgentTile`). A grouping pass in `MainChatPage.tsx` collects consecutive `kind="agent_run"` messages into Stage blocks. `AgentRunCard` is reused unchanged for the expanded detail view. No backend changes — same SSE event types, same persisted `messages` rows. The `liveRuns` filter that drops finished runs gets removed so finishing tiles don't disappear mid-turn.

**Tech Stack:** React + TypeScript (Vite), Tailwind, Lucide icons. Spec: [docs/superpowers/specs/2026-05-05-agent-stage-design.md](../specs/2026-05-05-agent-stage-design.md).

**Notes for the implementer:**
- This codebase has **no test runner**. "Verification" for each task is a browser smoke check, not pytest/jest. Run the dev server (`npm run dev`) and click through.
- The branch is `worktree-agentic-teams`. The previous Agentic Teams work shipped `AgentRunCard.tsx` (kept), `dispatch-agent.js`, the `agent_run.*` SSE events, and the persisted `messages` rows with `kind="agent_run"`. This plan only touches frontend rendering.
- Frontend dev runs on `http://localhost:5173`. Auth uses the `X-User-Id` header; the admin user is `admin@vetted.com`.
- Brand tokens: `vetted-accent` is `#C4A962` (gold), `vetted-primary` is `#1A1A1A`. Status colors: emerald-500 (done), red-500 (error), gray-400 (queued/cancelled).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `src/components/chat/AgentStage.tsx` | Stage container: header (team name + count + elapsed) + responsive tile grid + stacked detail cards below the grid |
| `src/components/chat/AgentTile.tsx` | One tile per sub-agent run: status dot + name + elapsed + current tool + 3-line activity feed |
| `src/components/chat/agent-stage-utils.ts` | Pure helpers: `groupMessagesIntoStages`, `deriveFeedLines`, `summarize`. Easy to reason about without rendering |

### Modified files
| Path | Change |
|---|---|
| `src/pages/MainChatPage.tsx` | (1) Replace per-message `AgentRunCard` render branch with grouping pass + `AgentStage`. (2) Remove the `running`/`queued` filter on `liveRuns` — render all live runs. (3) Wire `<AgentStage runs={liveRunsArray} live />` below the persisted message list. (4) Look up the active team once per chat load and pass `teamName` to `AgentStage` |

### Unchanged
- `src/components/chat/AgentRunCard.tsx` — same props, same behavior. Just gets a new caller.
- All backend code, all SSE events, all persistence.
- `liveRuns` state shape itself — only the consumer changes.

---

## Task 1: Pure utilities (`agent-stage-utils.ts`)

Three small pure functions, easy to verify by reading them and trying inputs in the browser console. No JSX. No React.

**Files:**
- Create: `src/components/chat/agent-stage-utils.ts`

- [ ] **Step 1: Create the utility file**

```typescript
// src/components/chat/agent-stage-utils.ts
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
```

- [ ] **Step 2: Verify the file typechecks**

Run: `npx tsc --noEmit -p .`
Expected: no errors related to `agent-stage-utils.ts`. (Pre-existing errors elsewhere in the repo are fine — only watch for ones referencing the new file.)

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/agent-stage-utils.ts
git commit -m "feat(stage): pure utilities for grouping, feed derivation, summarization"
```

---

## Task 2: `AgentTile` component

One tile per sub-agent run. Pure presentation — receives a `run` plus an `onExpand` callback. The 3-line feed is a fixed-height container; newest line at the bottom; older lines simply don't render.

**Files:**
- Create: `src/components/chat/AgentTile.tsx`

- [ ] **Step 1: Create the tile component**

```typescript
// src/components/chat/AgentTile.tsx
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
      {isError && run.error ? (
        <div className="font-mono text-[11px] text-red-600 leading-tight h-[3.6rem] overflow-hidden">
          {run.error}
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
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p .`
Expected: no errors related to `AgentTile.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/AgentTile.tsx
git commit -m "feat(stage): AgentTile component — status dot, elapsed, 3-line feed"
```

---

## Task 3: `AgentStage` component (skeleton, no live)

Layout container. Header with team name + counts + elapsed. Tile grid via CSS grid `auto-fit minmax(180px, 1fr)`. Below the grid: stacked `AgentRunCard`s for any open tiles, in tile order. Multiple-open allowed.

For this task we accept a static `runs` array and a static `teamName`; live and team-fetch wiring come later.

**Files:**
- Create: `src/components/chat/AgentStage.tsx`

- [ ] **Step 1: Create the stage component**

```typescript
// src/components/chat/AgentStage.tsx
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
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p .`
Expected: no errors related to `AgentStage.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/AgentStage.tsx
git commit -m "feat(stage): AgentStage component — header, tile grid, stacked detail cards"
```

---

## Task 4: Replace static render path in `MainChatPage`

Swap the per-message `AgentRunCard` render for a grouping pass that produces `AgentStage` blocks. Don't touch the `liveRuns` rendering yet — that's Task 6.

**Files:**
- Modify: `src/pages/MainChatPage.tsx:11` (imports), `src/pages/MainChatPage.tsx:898-913` (render)

- [ ] **Step 1: Add the new imports**

Replace the existing `AgentRunCard` import:

```typescript
// Old:
import AgentRunCard from '../components/chat/AgentRunCard';

// New:
import AgentRunCard from '../components/chat/AgentRunCard';
import AgentStage from '../components/chat/AgentStage';
import { groupMessagesIntoStages } from '../components/chat/agent-stage-utils';
```

(Keep `AgentRunCard` imported — Task 5 still needs it for the team-name fetch wiring through the props in case live runs use a different component path; we also leave it imported because we'll remove that line in Task 6 once live runs go through `AgentStage`. For now, leaving both is safe and avoids a temporary unused-import warning between tasks.)

- [ ] **Step 2: Replace the persisted-message render branch**

Find this block at `src/pages/MainChatPage.tsx:899-905`:

```typescript
            <div className="max-w-[75%] mx-auto px-6 py-8 space-y-6">
              {messages.map((msg, i) => {
                if (msg.role === 'assistant' && msg.kind === 'agent_run' && msg.agent_run) {
                  return <AgentRunCard key={i} run={msg.agent_run} onRetry={handleRetryAgent} />;
                }
                return <ChatBubble key={i} msg={msg} />;
              })}
```

Replace with:

```typescript
            <div className="max-w-[75%] mx-auto px-6 py-8 space-y-6">
              {groupMessagesIntoStages(messages).map((item, i) => {
                if (item.type === 'stage') {
                  return (
                    <AgentStage
                      key={`stage-${i}-${item.runs[0]?.run_id ?? ''}`}
                      runs={item.runs}
                      onRetry={handleRetryAgent}
                    />
                  );
                }
                return <ChatBubble key={i} msg={item.msg} />;
              })}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors related to `MainChatPage.tsx`.

- [ ] **Step 4: Browser smoke check — persisted Stage renders**

Run `npm run dev` if it isn't already running. Open `http://localhost:5173`, log in as `admin@vetted.com`. Find a chat that already contains `agent_run` messages from prior team runs. (Open DevTools → Application → Local Storage to confirm the user is admin.) If no such chat exists, activate the seeded team in a new chat and send a prompt that triggers a dispatch (e.g. "Run all the agents on this question: what is 2+2?"), let it complete, then reload.

Verify:
- Sub-agent runs appear inside a single bordered Stage block instead of as separate stacked cards.
- The Stage shows "N sub-agents" in its header. (Team name not yet wired — that's Task 5.)
- Each tile shows the project name + a green dot + duration + token count.
- Clicking a tile reveals an `AgentRunCard` stacked below the grid, with the full event log. Clicking again hides it.
- Clicking multiple tiles shows multiple expanded cards in tile order.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MainChatPage.tsx
git commit -m "feat(stage): group persisted agent_run messages into AgentStage blocks"
```

---

## Task 5: Wire the team name into the Stage header

Fetch the active team once when the chat loads (or on `activeTeamId` change). Pass `teamName` down to `AgentStage`. Handle missing-team fallback per spec.

**Files:**
- Modify: `src/pages/MainChatPage.tsx` (add `teamName` state + effect; pass to `AgentStage`)

- [ ] **Step 1: Add `teamName` state**

Find the existing state declarations near `src/pages/MainChatPage.tsx:335`:

```typescript
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
```

Add directly below it:

```typescript
  const [activeTeamName, setActiveTeamName] = useState<string | null>(null);
```

- [ ] **Step 2: Add an effect that fetches the team**

Add this `useEffect` near the other `useEffect`s in `MainChatPage` (e.g. after the models-fetch effect around line 361):

```typescript
  useEffect(() => {
    if (!activeTeamId) {
      setActiveTeamName(null);
      return;
    }
    let cancelled = false;
    api.teams
      .get(activeTeamId)
      .then((t: any) => {
        if (!cancelled) setActiveTeamName(t?.name ?? null);
      })
      .catch(() => {
        // 404 (team deleted) or network error — fall back to no team name.
        if (!cancelled) setActiveTeamName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTeamId]);
```

- [ ] **Step 3: Pass `teamName` to `AgentStage`**

In the render replacement from Task 4, change:

```typescript
                  return (
                    <AgentStage
                      key={`stage-${i}-${item.runs[0]?.run_id ?? ''}`}
                      runs={item.runs}
                      onRetry={handleRetryAgent}
                    />
                  );
```

To:

```typescript
                  return (
                    <AgentStage
                      key={`stage-${i}-${item.runs[0]?.run_id ?? ''}`}
                      runs={item.runs}
                      teamName={activeTeamName}
                      onRetry={handleRetryAgent}
                    />
                  );
```

- [ ] **Step 4: Browser smoke check — team name appears**

Reload the chat from Task 4's smoke check. The Stage header should now read "{Team Name} team — N sub-agents". Test the fallback by manually editing the seeded team's row to set `name = NULL` (or test by deleting the team via the API and reloading — `DELETE /api/teams/:id`). The header should fall back to "N sub-agents" with no error.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MainChatPage.tsx
git commit -m "feat(stage): fetch and display active team name in stage header"
```

---

## Task 6: Live tiles — render `liveRuns` through `AgentStage` and stop filtering

Two changes: (a) remove the `running`/`queued` filter so finished tiles stay visible during a live turn, (b) render the live runs as one in-flight Stage instead of stacked cards.

**Files:**
- Modify: `src/pages/MainChatPage.tsx:906-910` (live render branch)

- [ ] **Step 1: Replace the live-run render branch**

Find this block at `src/pages/MainChatPage.tsx:906-910`:

```typescript
              {Object.values(liveRuns)
                .filter((r) => r.status === 'running' || r.status === 'queued')
                .map((r) => (
                  <AgentRunCard key={`live-${r.run_id}`} run={r} />
                ))}
```

Replace with:

```typescript
              {Object.values(liveRuns).length > 0 && (
                <AgentStage
                  key="live-stage"
                  runs={Object.values(liveRuns)}
                  teamName={activeTeamName}
                  onRetry={handleRetryAgent}
                />
              )}
```

(No filter — finished tiles in `liveRuns` stay visible until the orchestrator's `done` event triggers a chat refetch and `setLiveRuns({})` clears them.)

- [ ] **Step 2: Remove the now-unused `AgentRunCard` import**

If `AgentRunCard` is no longer referenced anywhere in `MainChatPage.tsx`, remove its import line. (Search the file with grep first to confirm — it should not be referenced after this change.)

```bash
grep -n "AgentRunCard" src/pages/MainChatPage.tsx
```

If grep shows zero matches outside the import line, delete the import. If any matches remain, leave it alone.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors related to `MainChatPage.tsx`.

- [ ] **Step 4: Browser smoke check — live Stage**

In a chat with the seeded team active, send a prompt that dispatches multiple sub-agents. Verify:
- A live Stage appears below the message list as soon as the first `agent_run.started` event arrives.
- Tiles pulse gold while running.
- Each tile's 3-line activity feed updates as `tool_call` / `tool_result` / `thinking` events stream.
- When one sub-agent finishes before the others, its tile freezes (emerald dot, final elapsed/token count) but stays visible in the same Stage.
- When the orchestrator's `done` event fires, the live Stage seamlessly swaps to the persisted Stage — no flicker, no layout jump.
- The orchestrator's final synthesis appears as a normal `ChatBubble` *below* the persisted Stage.
- Clicking a tile expands the `AgentRunCard` detail; the expanded state survives the live→persisted swap (because tiles are keyed by `run_id`).

Edge cases:
- Hit Stop mid-run: tiles flip to "cancelled" and stay visible.
- Reload the page after a completed run: persisted Stage renders identically to what was live, no pulsing.
- 5-agent team: tiles wrap to two rows on a wide viewport, stays readable on narrow viewports.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MainChatPage.tsx
git commit -m "feat(stage): render live runs through AgentStage; keep finished tiles visible"
```

---

## Task 7: Polish + version bump

Small finishing touches: bump the sidebar version (per `feedback_version` memory), and confirm the seeded-team scenario works end-to-end.

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx` (version string)

- [ ] **Step 1: Bump the sidebar version**

Open `src/components/sidebar/Sidebar.tsx` and find the version string (current value: `v1.13.0`). Increment to `v1.14.0`.

```bash
grep -n "v1\." src/components/sidebar/Sidebar.tsx
```

Edit that line to read the new version.

- [ ] **Step 2: Final integration sweep**

Run the full end-to-end flow once more:
1. Reload the dev server (`npm run dev`).
2. Log in as `admin@vetted.com`.
3. Start a new chat, activate the seeded team via the team dropdown above the input.
4. Send a prompt that triggers multiple dispatches (e.g. "Have each agent suggest one improvement to our pricing strategy").
5. Watch the live Stage render, tiles pulse, feeds update, finishing tiles freeze in place.
6. After the orchestrator's synthesis arrives, click a tile — the `AgentRunCard` detail appears stacked below.
7. Reload the page — the same Stage reappears in static form, with detail still expandable.
8. Open a chat with no team active — verify normal `ChatBubble` rendering still works (no Stage, no regression).

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "chore(sidebar): bump version to v1.14.0 for agent stage"
```

---

## Done criteria

- All 7 tasks committed on `worktree-agentic-teams`.
- Browser smoke check from Task 7, Step 2 passes end-to-end.
- No TypeScript errors introduced (existing pre-plan errors unchanged).
- Spec section coverage:
  - Stage block per turn — Tasks 4, 6
  - Tile fidelity (status dot, elapsed, tool, 3-line feed) — Task 2
  - Expand-to-detail stacked below grid — Task 3
  - Multiple tiles open at once, keyed by `run_id` — Task 3
  - Retry button only in expanded `AgentRunCard` — Task 3 (uses unchanged `AgentRunCard`)
  - Activity-feed summarization (50-char JSON) — Task 1
  - Last-10-event slice for tile rendering — Task 1
  - Wall-clock elapsed math — Tasks 2, 3
  - Live Stage keeps finished tiles visible — Task 6
  - Missing-team fallback header — Tasks 3, 5
  - Static reload reconstruction — Task 4
  - Single-tile / zero-tile edge cases — Task 3 (grid handles 1 tile; `runs.length === 0` returns `null`)
