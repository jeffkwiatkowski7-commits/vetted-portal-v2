# Agent Stage Design

**Date:** 2026-05-05
**Status:** Approved

## Overview

Replace the current sequence of stacked `AgentRunCard`s — emitted by the Agentic Teams feature when an orchestrator dispatches sub-agents — with a single rich inline **Stage** block per assistant turn. Each Stage renders all sub-agents that ran in that turn as side-by-side tiles. Tiles show the live thinking + tool-call trail in a compact monospace feed (medium fidelity), pulse while running, and freeze when done. The orchestrator's prose response renders as a normal assistant bubble immediately after the Stage.

Built on top of the existing Agentic Teams plumbing: same SSE event stream, same persisted `messages` rows with `kind="agent_run"`, same `AgentRunMessage` type. No new schema, no new event types, no backend changes.

## Goals

- Make team execution feel visual and dramatic without leaving the chat flow
- Show parallelism at a glance (tiles side-by-side, not vertically stacked)
- Reuse the existing event log + persistence so reload-replay is automatic
- Single inline component — no side panel, no modal, no fight with the existing canvas pane
- Ship in one slice (~1.5 days)

## Non-Goals (v1)

- Side-panel or full-screen takeover renderings of the Stage (option B and C from brainstorming)
- Drag-to-reorder tiles
- Keyboard navigation between tiles
- Mobile-specific layout
- Exporting a Stage as a screenshot or shareable image
- Streaming-aware progress bars per tool call (just the activity feed)

## Concepts

### Stage

A grouping container for one or more `agent_run` messages that came from the same assistant turn. One Stage per orchestrator response that contains dispatch calls. If the orchestrator dispatches three agents in turn 1 and one more in turn 2, the user sees two Stages — one with three tiles, one with one — each followed by the orchestrator's text bubble.

### Tile

One agent's view inside a Stage. Medium fidelity: header (status dot + project name + elapsed time + current tool name) plus a 3-line monospace activity feed showing the most recent tool calls and thinking deltas, auto-scrolling. Pulses while running, freezes on finish. Click to expand the existing `AgentRunCard` view inline (full event log + final output).

### Stage block grouping

The grouping rule is positional: any contiguous run of `kind="agent_run"` messages in the chat history forms one Stage. Backend already inserts these in order during the orchestrator's tool loop, so the rule is reliable without adding a `parent_message_id` or similar foreign key.

## Architecture

### New components

| Component | File | Responsibility |
|---|---|---|
| `AgentStage` | `src/components/chat/AgentStage.tsx` (new) | Container that lays out child tiles in a responsive grid. Accepts `runs: AgentRunMessage[]`. Renders a thin header band ("3 sub-agents · Investment Memo team") and below it the tile grid. |
| `AgentTile` | `src/components/chat/AgentTile.tsx` (new) | One tile. Header (dot + name + elapsed + current tool). Body: 3-line monospace scrolling activity feed (auto-scrolls to bottom). Click body or chevron to expand inline. |
| `AgentRunCard` | `src/components/chat/AgentRunCard.tsx` (kept, unchanged) | Now used only as the "expanded detail" view inside a tile. Same props, same internal state machine. No edits needed. |

### Modified components

| File | Change |
|---|---|
| `src/pages/MainChatPage.tsx` | Replace the per-message `AgentRunCard` render branch with a grouping pass that collects consecutive `kind="agent_run"` messages and renders one `<AgentStage runs={group} />` per group. The orchestrator's normal assistant message rendering stays unchanged. |

### Layout

```
┌──────────────────────────────────────────────────┐
│ User: Build the IC memo for Highland MOB.        │
└──────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────┐
│ ▣ Investment Memo team — 3 sub-agents            │  ← AgentStage
│ ┌──────────┬──────────┬──────────┐               │
│ │ ●Researcher│●Analyst │○Writer   │               │  ← AgentTile × 3
│ │ 14s · web │11s·python│queued    │               │
│ │ ─────────│─────────│─────────  │               │
│ │ web_search│python_repl│         │               │
│ │ reading 4│pandas.read│         │               │  ← scrolling
│ │ "Found 3…│computing…│         │               │     activity feed
│ └──────────┴──────────┴──────────┘               │
└──────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────┐
│ Orchestrator: Based on the research and analysis,│  ← normal bubble
│ here is the investment memo…                     │
└──────────────────────────────────────────────────┘
```

Tile grid uses CSS grid with `repeat(auto-fit, minmax(180px, 1fr))` — wraps cleanly to two rows when the team has 4+ agents on a narrow viewport.

### Tile state visuals

| Status | Dot | Header label | Body |
|---|---|---|---|
| `queued` | gray (#3a3f4a) | name + "queued" | empty placeholder |
| `running` | gold pulsing | name + elapsed + current tool | last 3 lines of activity feed |
| `done` | emerald (#10b981) | name + final elapsed + token count | frozen last 3 lines; subtle "✓" |
| `error` | red | name + "error" | short error message |
| `cancelled` | gray | name + "cancelled" | frozen last 3 lines (whatever was last) |

### Expand-to-detail behavior

Clicking a tile reveals the full `AgentRunCard` (event log + prompt + final message + retry button) **stacked below the tile grid**, not inside the grid. Implementation: the open tile's index is tracked in `AgentStage` state; when at least one tile is open, the corresponding `AgentRunCard`s render in a vertical list directly below the grid, in tile order. Multiple tiles can be open at once. Click the same tile again (or a "close" affordance on the detail card) to collapse.

This avoids the layout-thrash of trying to make one tile span the grid full-width and reflow siblings, and keeps the grid visually stable as users browse details.

**Retry on errored runs:** the retry button lives only in the expanded detail view, not on the tile face. Errored tiles show enough info to know something failed (red dot, short error message); user clicks to expand and sees the existing retry control inside `AgentRunCard`.

## Data Flow

### During a live run

1. User sends a message in a team-active chat → orchestrator starts.
2. Orchestrator emits a `dispatch_agent` tool call → `agent_run.started` event arrives over SSE → `liveRuns[run_id]` populated → a new in-flight Stage block appears at the bottom of the message stream.
3. Subsequent `agent_run.thinking` / `tool_call` / `tool_result` / `text` events append to `liveRuns[run_id].events`. The corresponding tile's activity feed re-renders.
4. `agent_run.finished` flips the tile from `running` to `done` / `error` / `cancelled`. **Tile stays visible in the live Stage even after finishing** (any non-terminal state). This is a deliberate change from the current `AgentRunCard` rendering, which filters live runs to `running`/`queued` only — the new live Stage renders all `liveRuns` entries regardless of status, so a 3-tile Stage doesn't briefly become a 2-tile Stage when one finishes early.
5. When the orchestrator's `done` event fires, `MainChatPage` refetches the chat. The persisted `agent_run` messages now appear in `messages` state. `liveRuns` clears. The Stage seamlessly switches from "live" rendering (driven by `liveRuns`) to "static" rendering (driven by persisted messages) — same component, same data shape, and tiles keyed by `run_id` so React preserves expanded-detail state across the swap.

### On chat reload

1. `GET /api/chats/:id` returns messages including `kind` and `agent_run` (server change from Task 12 of the previous spec).
2. The grouping pass in `MainChatPage` scans messages and produces an array like `[{ type: 'message', msg }, { type: 'stage', runs: [...] }, { type: 'message', msg }]`.
3. Each `stage` group renders as `<AgentStage runs={runs} />`. Tiles render with `status='done'` etc. as already-frozen.

### Stage grouping algorithm

```typescript
function groupMessagesIntoStages(messages: ChatMessage[]): RenderItem[] {
  const out: RenderItem[] = [];
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

Live runs (`liveRuns`) form one additional in-progress Stage rendered below the persisted message list while `chatting` is true.

## What Replaces / Stays

**Replaced:** The current `messages.map` branch that renders one `<AgentRunCard run={m.agent_run} />` per `agent_run` message. Cards no longer stack vertically in chat history.

**Kept unchanged:**
- All backend code (`server/lib/dispatch-agent.js`, the `dispatch_agent` tool wiring in `server/index.js`, persistence as `messages` rows with `kind="agent_run"`, SSE event types).
- All types (`AgentRunMessage`, `AgentRunEvent`, `Team`, etc.).
- `AgentRunCard` itself — its props and behavior are unchanged. It just gets a new caller (the tile, on click-expand, instead of being rendered directly per message).
- `liveRuns` state machine in `MainChatPage` — exact same shape; only the consumer changes.
- Stop, retry, replay, history reload — all keep working as-is.

## UI Details

### Tile activity feed

The feed is a fixed-height container (3 lines) showing the **last 3 derived lines** from the run's events. No internal scrolling — when a new line arrives, the oldest drops off the top. (Older lines remain in the persisted log accessible via the expanded view.)

A "line" is derived from one event:

- `→ {tool_name} {args_summary}` — for `tool_call` events
- `↓ {tool_name} returned ({result_summary})` — for `tool_result` events
- `{delta}` — for `thinking` and `text` events, truncated to ~60 chars

**Summarization rule for `args_summary` and `result_summary`:** stringify the value as JSON, take the first 50 characters, append `…` if truncated. Newlines collapsed to single spaces. Cheap and consistent — no per-tool special-casing.

**Performance:** for tile rendering, slice `run.events` to the last 10 entries before deriving lines. Long-running agents can accumulate hundreds of events; the tile only ever displays a handful, so re-rendering against the full array on every event would thrash. The full event list stays in memory for the expanded detail view.

### Stage header

```
▣ Investment Memo team — 3 sub-agents · 24s elapsed
```

- Name comes from `chat.active_team_id → teams.name`, fetched once per chat load via `GET /api/teams/:id`. (If that endpoint doesn't exist yet, list-and-find from `GET /api/teams` is acceptable for v1.)
- **Missing-team fallback:** if the team lookup 404s (team was deleted), or `chat.active_team_id` is null, render the header as `▣ Sub-agents — N running` (or `N done`, etc., per state). During the brief window before the team-fetch resolves, suppress the header text and keep the tile grid alone — avoids a flash.
- Counts and elapsed update live during the run. Elapsed = wall-clock from the first tile's start to the last tile's finish (or "now" if any tile is still running).

### Empty / single-agent edge cases

- If a Stage has 1 tile, render a single full-width tile (no grid).
- If the orchestrator dispatches 0 agents, no Stage renders (the existing flow doesn't insert any `agent_run` rows in that case).

## Phasing

Single slice, no checkpoints required. Optional pause point after step 2 if the static path is enough to demo.

| Step | Estimated effort | Done when |
|---|---|---|
| 1. Build `AgentStage` + `AgentTile` standalone | ~3 hrs | Renders correctly with hand-built fixtures in a sandbox or a test page |
| 2. Add grouping logic in `MainChatPage`; replace existing card-per-message branch with one `AgentStage` per group | ~2 hrs | Reload of an existing team chat shows Stage blocks with all tiles already-frozen, expandable to full detail |
| 3. Wire live `liveRuns` data through the same component | ~3 hrs | Sending a new team prompt shows a live in-flight Stage with pulsing tiles, scrolling feeds, and clean transition to persisted state on done |
| 4. Polish — tile expand/collapse animation, sticky header, performance for long activity feeds, final QA | ~2 hrs | Browser test passes for 2-, 3-, and 5-agent teams; no jank on rapid event streams |

**Total:** ~1.5 days. No new tests (codebase has no test runner — verification is in-browser).

## Testing

Manual browser checks per step:

- Step 1: render a Stage with hand-built `AgentRunMessage` fixtures (queued, running, done, error, cancelled tiles). Verify each visual state.
- Step 2: open an existing chat that already has `agent_run` messages from prior runs. Verify a Stage replaces the old stacked cards. Click a tile, verify expanded `AgentRunCard` view appears inline.
- Step 3: activate the seeded team. Send a 2-agent dispatch prompt. Verify live tiles appear, pulse, stream their feeds, freeze on done. Verify orchestrator's final synthesis appears as a normal bubble below.
- Step 3: hit stop mid-run; tile shows `cancelled`.
- Step 3: reload the page after a run. Persisted Stage replaces the live one; identical layout, no live pulsing.
- Step 4: 5-agent team prompt. Tiles wrap to two rows; activity feeds remain readable.

## Open questions

None blocking. Settled during brainstorming:
- Placement: rich inline stage (not side panel, not modal)
- Tile fidelity: medium (3-line scrolling activity feed)
- Sequential rounds: separate Stage per assistant turn
- Lifecycle on done: stays expanded, no auto-collapse
- History/reload: static reconstruction from persisted events
- Orchestrator synthesis: normal bubble below the Stage (not inside)
