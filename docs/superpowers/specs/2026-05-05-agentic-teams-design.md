# Agentic Teams Design

**Date:** 2026-05-05
**Status:** Approved

## Overview

Add an "agentic" mode to the Vetted Portal that lets a user bundle existing projects into a named **Team** and activate that team in a chat. When a team is active, the chat becomes an orchestrator that can dispatch the team's projects as sub-agents — each running in its own context window with the project's system prompt, model, MCP tools, skills, and library files. Sub-agent runs render as live, expandable inline cards in the chat (pulsing while running, streaming thinking and tool calls, collapsing to a one-line summary when done). The mental model and execution pattern mirror Claude Code's `Agent` tool exactly: one level deep, strings as the inter-agent contract, parallel dispatch when the orchestrator emits multiple tool calls in one turn.

## Goals

- Reuse existing projects as agent configs — no new "agent" entity
- Allow saved, repeatable orchestration via a freeform "playbook" attached to each team
- Make execution visible: users see each sub-agent invoked, its progress, its thinking, and its result, all inline in the chat
- Ship in three independent slices, each leaving the app in a working state
- Match Claude Code's orchestration semantics so the mental model transfers

## Non-Goals (v1)

- DAG / branch-and-merge topology (Q1 option B). Possible v2.
- Sub-agents dispatching their own sub-agents (recursion). One level deep only.
- Structured artifact passing between agents — the contract is plain strings.
- Visual node-and-edge workflow canvas. The playbook + auto-generated roster *is* the orchestration spec.
- Per-team analytics dashboard.

## Concepts

### Project as agent

A project on the platform already carries everything an agent needs: `system_prompt`, `default_model`, `temperature`, `mcp_servers`, attached library files (RAG-indexed), and skills. No new model is introduced — projects *are* the sub-agent definitions.

### Team

A **Team** is a thin bundle:

- A name and description
- An ordered set of project memberships, each with an optional team-specific "purpose" line that overrides the project's description for the orchestrator's roster view
- A **playbook** — a freeform markdown instruction block injected into the orchestrator's system prompt when the team is active

In the UI we call this a Team (more intuitive than "workflow"); in the codebase we use the same word.

### Orchestrator

The orchestrator is **the active chat itself**, not a separate entity. When a team is turned on for a chat, the chat's effective system prompt becomes:

```
[base chat / app system prompt]

[team playbook]

[auto-generated agent roster:
  - Project A: <purpose>. Call via dispatch_agent({project_id: "...", prompt: "..."}).
  - Project B: <purpose>. Call via ...
  - ...]
```

The orchestrator is registered with one extra tool, `dispatch_agent`. Multiple `dispatch_agent` calls in a single assistant turn run in parallel; calls across turns run sequentially. This is identical to Claude Code's `Agent` tool semantics.

### Sub-agent run

A single `dispatch_agent` invocation. The backend spawns a fresh inference loop bound to the target project:

- **System prompt:** project's `system_prompt`, prefixed by an auto-generated preamble: *"You are a sub-agent named {project.name}. The orchestrator dispatched you with the following prompt. Return one final assistant message — no further dispatch."*
- **Model:** project's `default_model`
- **Temperature / max tokens:** project config
- **Tools:** project's MCP servers, skills, and RAG access to its own library files. **Not** `dispatch_agent` (one level deep only)
- **Context:** fresh window — only the orchestrator's prompt string. No chat history. No other sub-agents' outputs.
- **Termination:** first text-only assistant turn (no tool calls). The final assistant message is the run's `final_message`, returned to the orchestrator as the `dispatch_agent` tool result.

## Architecture

### Data model

Two new tables and one new column. No backfill needed for existing rows.

#### `teams`

| Column | Type | Description |
|---|---|---|
| id | TEXT PK | UUID |
| owner_id | TEXT NOT NULL | FK to users |
| name | TEXT NOT NULL | Display name |
| description | TEXT | Short description shown in team list |
| playbook | TEXT | Freeform markdown injected into orchestrator system prompt; nullable |
| status | TEXT | "active" / "archived" |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

#### `team_members`

| Column | Type | Description |
|---|---|---|
| id | TEXT PK | UUID |
| team_id | TEXT NOT NULL | FK to teams (cascade delete) |
| project_id | TEXT NOT NULL | FK to projects |
| purpose | TEXT | Optional override of project description for this team's roster; nullable |
| display_order | INTEGER NOT NULL | Sort order in the editor and roster |
| created_at | TEXT | ISO timestamp |

Index on `team_id`. Unique constraint on `(team_id, project_id)`.

#### `chats` — new column

| Column | Type | Description |
|---|---|---|
| active_team_id | TEXT | FK to teams; nullable. Which team is active for this chat. |

#### `messages` — new column

| Column | Type | Description |
|---|---|---|
| kind | TEXT | Nullable. Added via `ALTER TABLE` (same pattern as existing additive migrations). Distinguishes special message types. Initial value used: `"agent_run"`. NULL for all existing and ordinary messages. |

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/teams` | List teams the user owns or is a member of |
| POST | `/api/teams` | Create a team |
| GET | `/api/teams/:id` | Read a team with its members |
| PUT | `/api/teams/:id` | Update name/description/playbook |
| DELETE | `/api/teams/:id` | Archive (soft delete) |
| POST | `/api/teams/:id/members` | Add a project to a team |
| PUT | `/api/teams/:id/members/:memberId` | Update purpose / display_order |
| DELETE | `/api/teams/:id/members/:memberId` | Remove a project from a team |
| PUT | `/api/chats/:id/team` | Set or clear `active_team_id` |

### Dispatch tool

`dispatch_agent` is the only new tool registered with the orchestrator when a team is active.

```
dispatch_agent({
  project_id: string,    // must be a member of the active team
  prompt: string,        // freeform; orchestrator chooses what to pass
})

returns: {
  final_message: string,
  duration_ms: number,
  tokens: { input: number, output: number },
  error?: string,
}
```

The orchestrator calls `dispatch_agent` like any other tool. Multiple calls in one assistant turn run in parallel; the SDK / chat loop awaits all of them before returning results.

### Streaming protocol

Every dispatch emits typed events on the existing chat SSE pipe, interleaved with the orchestrator's normal events. The frontend partitions by `run_id`.

```
agent_run.started     { run_id, project_id, project_name, prompt_summary }
agent_run.thinking    { run_id, delta }                   // raw token stream
agent_run.tool_call   { run_id, tool, args_summary }
agent_run.tool_result { run_id, tool, result_summary }
agent_run.text        { run_id, delta }                   // final-message tokens
agent_run.finished    { run_id, final_message, duration_ms, tokens, error? }
```

`prompt_summary`, `args_summary`, and `result_summary` are server-truncated to keep SSE frames small; full payloads are written to the persisted run record only.

### Persistence of runs

Each completed sub-agent run is persisted as one row in the existing `messages` table:

- `role: "assistant"`
- New nullable column `kind` (TEXT) added to `messages` via additive `ALTER TABLE` (same pattern used elsewhere in `database.js` for `mcp_servers` and `pptx_template_id`). Value: `"agent_run"`. Existing rows have `kind = NULL` and render as normal messages.
- `content`: JSON with `{ run_id, project_id, project_name, prompt, final_message, events: [...], duration_ms, tokens, error }`. The frontend parses this only when `kind === "agent_run"`.

On chat history reload, inline cards reconstruct from this log — collapsed by default. No separate `agent_runs` table.

### Guardrails

- **Max parallel dispatches per turn:** 3 (configurable via env `AGENT_MAX_PARALLEL`)
- **Max total dispatches per orchestrator turn:** 10 (configurable via `AGENT_MAX_PER_TURN`)
- **One level deep** — sub-agents never receive the `dispatch_agent` tool
- **Project-membership check** — `dispatch_agent` rejects any `project_id` not on the active team
- **Per-run timeout:** 5 minutes (configurable via `AGENT_RUN_TIMEOUT_MS`)
- **Stop button** — the existing chat stop button sends an abort signal to the orchestrator and to every in-flight sub-agent inference loop

### Files & uploads

A sub-agent automatically has RAG access to its own project's library files. If the user uploaded files to the chat itself, the orchestrator may include their text (or excerpts) in the prompt string it passes to a sub-agent. There is no separate file-handle plumbing — strings are the contract end-to-end.

## UI

### Sidebar

A new entry below "Skills":

- **Teams** — icon `Users`, route `/teams`. Mirrors the Skills section's structure (`/teams`, `/teams/new`, `/teams/:id/edit`).

### Team editor (`/teams/:id/edit`)

Three regions, top to bottom:

1. **Identity** — name (required), description.
2. **Members** — add-project picker (search projects the user can read), reorderable list. Each row shows project name, model, MCP/skill summary, and an editable "purpose for this team" line that defaults to the project's description.
3. **Playbook** — markdown textarea with a live preview of the actual auto-generated agent-roster block that will be appended to the orchestrator's system prompt when this team is active.

### Activating a team in a chat

Above the chat input, next to the model picker, a new **Team** dropdown:

```
Team: [None ▾]   Model: [Claude Opus ▾]   …
```

Selecting a team writes `chats.active_team_id`. A status pill appears: *"Investment Memo team active · 3 sub-agents"*. Clicking the pill opens a popover with the playbook + roster. Set to "None" to deactivate.

### Inline agent cards

Sub-agent dispatches render inline in the chat message stream:

- **Queued** — gray dot, agent name, "queued"
- **Running** — pulsing gold dot, name, live elapsed time, expanded by default; body shows live thinking + tool-call stream in monospace, scrolls
- **Done** — collapses to one line: *"Researcher · 23s · 2.4k tokens · ✓"*. Click to re-expand the full event log.
- **Error** — red border, expanded, shows error + Retry button (re-dispatches the same `project_id` + `prompt`)

Multiple parallel cards stack vertically in the orchestrator's assistant message. The orchestrator's own commentary (its plan, its synthesis after agents return) appears between/around the cards as normal markdown.

### Stop / cancel

The existing stop button cancels the orchestrator and aborts every in-flight sub-agent run by sending an abort signal to each open inference loop. Cancelled runs persist with `error: "cancelled"` and render as a cancelled card.

## Phasing

Three slices, each independently shippable.

### Slice 1 — Teams as data

- `teams`, `team_members` tables; `chats.active_team_id` column
- Team CRUD API (`/api/teams`, `/api/teams/:id`, members endpoints, `PUT /api/chats/:id/team`)
- Sidebar "Teams" entry; `/teams` list, `/teams/new`, `/teams/:id/edit` pages with full editor (identity + members + playbook)
- Demo seed: one example team wiring 2–3 existing seeded projects so it is not empty on first run

**Done when:** users can build, save, and load a team. Nothing executes yet.

### Slice 2 — Orchestrator + dispatch

- Active-team dropdown above chat input + status pill
- Orchestrator system-prompt augmentation (playbook + auto-generated roster) when a team is active
- `dispatch_agent` tool registered with the orchestrator, executes a fresh inference loop bound to the target project (system prompt, model, MCP, RAG)
- Guardrails: max parallel = 3, max per turn = 10, one level deep, project-membership check, timeout
- Each run persisted as a `messages` row with `kind: "agent_run"`
- Frontend renders runs as **collapsed** cards showing only name + duration + token count + ✓/✗ — no live streaming yet

**Done when:** teams actually run end-to-end. Watching is post-hoc.

### Slice 3 — Live execution UX

- SSE event stream wired to inline card components: pulsing dot, live thinking + tool-call stream, expandable detail
- Stop button aborts in-flight sub-agent runs
- Error state with Retry-this-agent
- Replay-on-history-load works (event log already persisted in slice 2)

**Done when:** the dramatic version — agents lighting up, thinking scrolling, parallel cards stacking — works.

**Estimated total:** ~6 days of focused work, with usable checkpoints at the end of slices 1 and 2.

## Testing

- **Slice 1:** API CRUD round-trip; editor save/load; sidebar entry visible.
- **Slice 2:**
  - Single-agent dispatch returns the project's response with project-bound system prompt + model
  - Two `dispatch_agent` calls in one orchestrator turn run in parallel (verify wall-clock < sum of durations)
  - `dispatch_agent` to a project not on the active team is rejected
  - Sub-agent does not receive the `dispatch_agent` tool (one level deep)
  - Per-turn cap blocks the 11th call
  - Run is persisted; reloading the chat re-renders the collapsed card
- **Slice 3:**
  - Live thinking tokens stream into the card during run
  - Stop button cancels in-flight runs and persists `cancelled` state
  - Retry on an errored card re-dispatches with the original prompt
  - History reload replays the persisted event log into the expanded card view

## Open questions

None blocking. Settled during brainstorming:

- Topology: orchestrator + sub-agents (Claude Code-style), not linear or DAG
- Workflow shape: team + playbook (not loose team)
- Execution view: inline cards in chat (not side panel)
- Sub-agent recursion: not allowed
- Inter-agent contract: strings only
- Activation control: dropdown next to model picker (not sidebar button)
