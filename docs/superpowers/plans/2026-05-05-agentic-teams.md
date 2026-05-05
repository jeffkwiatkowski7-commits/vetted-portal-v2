# Agentic Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users bundle existing projects into a named **Team**, activate the team in any chat, and have the chat orchestrate those projects as sub-agents — Claude Code-style — with live, expandable inline cards for each sub-agent run.

**Architecture:** Three new DB things (`teams`, `team_members`, two additive columns), one new tool registered with the orchestrator (`dispatch_agent`), and one new server lib (`server/lib/dispatch-agent.js`) that runs a sub-agent inference loop bound to a project's system prompt / model / MCP / RAG. Sub-agent runs persist as `messages` rows with `kind="agent_run"`, so reload-replay is automatic. The frontend adds a Teams CRUD section, a team dropdown above the chat input, and an `AgentRunCard` component that streams over the existing SSE pipe.

**Tech Stack:** React + TypeScript (Vite), Node.js + Express, SQLite via `sql.js`, `@anthropic-ai/sdk` (direct), Server-Sent Events, Tailwind. Spec: [docs/superpowers/specs/2026-05-05-agentic-teams-design.md](../specs/2026-05-05-agentic-teams-design.md).

**Notes for the implementer:**
- This codebase has **no test runner**. "Verification" for each task is a smoke check (curl, browser steps, or `node -e`), not pytest/jest. Run smoke checks before each commit.
- All schema changes are **additive** — `CREATE TABLE IF NOT EXISTS` plus try/catch `ALTER TABLE` for new columns. No migrations to existing rows. Same pattern as `mcp_servers`, `pptx_template_id`.
- The dev server is `npm run dev` (frontend on 5173 + backend on 3000). Backend hot-reloads via nodemon if running; otherwise restart it after server-side changes.
- Auth uses the `X-User-Id` header; smoke-test with a real seeded user id (`admin@vetted.com` resolves to a known id — see `server/seed.js`).

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `server/lib/teams.js` | DB helpers for teams + members; system-prompt augmentation block builder |
| `server/lib/dispatch-agent.js` | Runs a single sub-agent inference loop bound to a project; emits typed events; persists `agent_run` message row |
| `src/pages/TeamsPage.tsx` | List + create teams |
| `src/pages/TeamEditPage.tsx` | Editor: identity + members (project picker) + playbook |
| `src/components/chat/AgentRunCard.tsx` | Inline card rendering an agent run (queued/running/done/error states) |
| `src/components/chat/TeamDropdown.tsx` | Active-team selector above chat input |

### Modified files
| Path | Change |
|---|---|
| `server/database.js` | Add `teams`, `team_members` tables; `ALTER TABLE` for `chats.active_team_id`, `messages.kind` |
| `server/seed.js` | Seed one demo team using existing seeded projects |
| `server/index.js` | New `/api/teams*` routes; `PUT /api/chats/:id/team`; in chat endpoint, register `dispatch_agent` when active team; emit `agent_run.*` SSE events |
| `src/api/index.ts` | New `teams` API client |
| `src/types/index.ts` | `Team`, `TeamMember`, `AgentRunMessage` types; extend `Chat` with `active_team_id`; extend `Message` with `kind` |
| `src/components/sidebar/Sidebar.tsx` | Add `Teams` nav entry; bump version string |
| `src/pages/MainChatPage.tsx` (and `ProjectDetailPage.tsx` if it shares chat UI) | Render `kind="agent_run"` messages with `AgentRunCard`; subscribe to `agent_run.*` SSE events; mount `TeamDropdown` |
| `src/App.tsx` | Routes for `/teams`, `/teams/new`, `/teams/:id/edit` |

---

# SLICE 1 — Teams as data

Goal: users can build, save, and load Teams. Nothing dispatches yet.

### Task 1: Database schema

**Files:**
- Modify: `server/database.js` (add to schema init + ALTER block at the bottom of `initializeDatabase`)

- [ ] **Step 1: Add `teams` and `team_members` table definitions to the schema-init block**

In `server/database.js`, locate the schema-init block where `CREATE TABLE IF NOT EXISTS skills` is defined. Below the skills/project_skills tables, add:

```javascript
db.run(`
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    playbook TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    purpose TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);`);
db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_team_project ON team_members(team_id, project_id);`);
db.run(`CREATE INDEX IF NOT EXISTS idx_teams_owner_id ON teams(owner_id);`);
```

- [ ] **Step 2: Add the `chats.active_team_id` and `messages.kind` ALTER blocks**

In the same file, find the additive-ALTER block near where `mcp_servers` is added. Append:

```javascript
try { db.run(`ALTER TABLE chats ADD COLUMN active_team_id TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }
try { db.run(`ALTER TABLE messages ADD COLUMN kind TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }
try { db.run(`CREATE INDEX IF NOT EXISTS idx_chats_active_team_id ON chats(active_team_id)`); } catch (e) { /* already exists */ }
```

- [ ] **Step 3: Restart the backend and verify the schema applied**

```bash
# kill any running dev server, then:
npm run dev:backend
```

In a separate shell:

```bash
sqlite3 ./data/vetted_portal.db ".schema teams"
sqlite3 ./data/vetted_portal.db ".schema team_members"
sqlite3 ./data/vetted_portal.db "PRAGMA table_info(chats);" | grep active_team_id
sqlite3 ./data/vetted_portal.db "PRAGMA table_info(messages);" | grep kind
```

Expected: schema printed for both new tables, and `active_team_id` + `kind` columns present.

> If `sqlite3` CLI is unavailable, run a small Node script that imports `getDatabase` from `server/database.js` and queries `PRAGMA table_info(...)` via `dbAll`.

- [ ] **Step 4: Commit**

```bash
git add server/database.js
git commit -m "feat(db): teams + team_members schema + chats.active_team_id + messages.kind"
```

---

### Task 2: Team backend lib

**Files:**
- Create: `server/lib/teams.js`

- [ ] **Step 1: Create the lib with CRUD helpers + system-prompt augmentation builder**

Write `server/lib/teams.js`:

```javascript
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun } from '../database.js';

export function listTeamsForUser(db, userId) {
  return dbAll(db, `
    SELECT t.*, COUNT(tm.id) AS member_count
    FROM teams t
    LEFT JOIN team_members tm ON tm.team_id = t.id
    WHERE t.owner_id = ? AND t.status = 'active'
    GROUP BY t.id
    ORDER BY t.updated_at DESC
  `, [userId]);
}

export function getTeam(db, teamId) {
  const team = dbGet(db, 'SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!team) return null;
  const members = dbAll(db, `
    SELECT tm.id, tm.team_id, tm.project_id, tm.purpose, tm.display_order,
           p.name AS project_name, p.description AS project_description,
           p.default_model, p.system_prompt
    FROM team_members tm
    JOIN projects p ON p.id = tm.project_id
    WHERE tm.team_id = ?
    ORDER BY tm.display_order ASC, tm.created_at ASC
  `, [teamId]);
  return { ...team, members };
}

export function createTeam(db, ownerId, { name, description = null, playbook = null }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  dbRun(db, `
    INSERT INTO teams (id, owner_id, name, description, playbook, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `, [id, ownerId, name, description, playbook, now, now]);
  return getTeam(db, id);
}

export function updateTeam(db, teamId, { name, description, playbook }) {
  const t = dbGet(db, 'SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!t) return null;
  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE teams SET name = ?, description = ?, playbook = ?, updated_at = ?
    WHERE id = ?
  `, [
    name !== undefined ? name : t.name,
    description !== undefined ? description : t.description,
    playbook !== undefined ? playbook : t.playbook,
    now,
    teamId,
  ]);
  return getTeam(db, teamId);
}

export function archiveTeam(db, teamId) {
  const now = new Date().toISOString();
  dbRun(db, `UPDATE teams SET status = 'archived', updated_at = ? WHERE id = ?`, [now, teamId]);
}

export function addMember(db, teamId, { project_id, purpose = null, display_order = null }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  let order = display_order;
  if (order === null) {
    const row = dbGet(db, 'SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM team_members WHERE team_id = ?', [teamId]);
    order = row?.next ?? 0;
  }
  dbRun(db, `
    INSERT INTO team_members (id, team_id, project_id, purpose, display_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, teamId, project_id, purpose, order, now]);
  return dbGet(db, 'SELECT * FROM team_members WHERE id = ?', [id]);
}

export function updateMember(db, memberId, { purpose, display_order }) {
  const m = dbGet(db, 'SELECT * FROM team_members WHERE id = ?', [memberId]);
  if (!m) return null;
  dbRun(db, `
    UPDATE team_members SET purpose = ?, display_order = ?
    WHERE id = ?
  `, [
    purpose !== undefined ? purpose : m.purpose,
    display_order !== undefined ? display_order : m.display_order,
    memberId,
  ]);
  return dbGet(db, 'SELECT * FROM team_members WHERE id = ?', [memberId]);
}

export function removeMember(db, memberId) {
  dbRun(db, 'DELETE FROM team_members WHERE id = ?', [memberId]);
}

/**
 * Build the system-prompt augmentation injected when a team is active.
 * Returns a string to be appended to the orchestrator's system prompt, or '' if no team.
 */
export function buildTeamSystemPromptBlock(team) {
  if (!team || !team.members || team.members.length === 0) return '';
  const playbook = (team.playbook || '').trim();
  const roster = team.members.map((m, i) => {
    const purpose = (m.purpose || m.project_description || '').trim() || '(no description)';
    return `${i + 1}. **${m.project_name}** (project_id: \`${m.project_id}\`) — ${purpose}`;
  }).join('\n');

  const sections = [
    `## Team: ${team.name}`,
    team.description ? team.description.trim() : null,
    playbook ? `### Playbook\n${playbook}` : null,
    `### Available sub-agents\nYou have a \`dispatch_agent\` tool. Each member below is a sub-agent you can dispatch by passing its \`project_id\`. The sub-agent runs in its own context window with the project's system prompt, model, files, and tools. It returns one final message string. Multiple \`dispatch_agent\` calls in the same response run in parallel; calls in separate responses run sequentially.\n\n${roster}\n\nRules:\n- One level deep — sub-agents cannot dispatch other agents.\n- The \`prompt\` you pass to a sub-agent is the only context it gets. If a sub-agent needs another sub-agent's output, write it into the prompt yourself.\n- Always summarize the final synthesis for the user after sub-agents return.`,
  ].filter(Boolean);

  return sections.join('\n\n');
}
```

- [ ] **Step 2: Smoke-check the lib loads**

```bash
node --input-type=module -e "import('./server/lib/teams.js').then(m => console.log(Object.keys(m)))"
```

Expected: prints array including `listTeamsForUser`, `createTeam`, `buildTeamSystemPromptBlock`, etc.

- [ ] **Step 3: Commit**

```bash
git add server/lib/teams.js
git commit -m "feat(teams): backend lib for team CRUD + system prompt builder"
```

---

### Task 3: Team REST API

**Files:**
- Modify: `server/index.js` — add a new route block, conventionally placed below the skills routes (after line ~1850, before the lease routes).

- [ ] **Step 1: Import the lib at the top of `server/index.js`**

Find the imports at the top of `server/index.js` (look for `import { mcpManager }`) and add:

```javascript
import {
  listTeamsForUser, getTeam, createTeam, updateTeam, archiveTeam,
  addMember, updateMember, removeMember,
} from './lib/teams.js';
```

- [ ] **Step 2: Add the routes block**

Locate the end of the skills routes (search for `app.put('/api/projects/:id/skills'` to find the area). After that block, add:

```javascript
// -- Teams ---------------------------------------------------------------

app.get('/api/teams', requireAuth, (req, res) => {
  const teams = listTeamsForUser(db, req.user.id);
  res.json({ teams });
});

app.post('/api/teams', requireAuth, (req, res) => {
  const { name, description, playbook } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const team = createTeam(db, req.user.id, {
    name: String(name).trim(),
    description: description ?? null,
    playbook: playbook ?? null,
  });
  res.json({ team });
});

app.get('/api/teams/:id', requireAuth, (req, res) => {
  const team = getTeam(db, req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your team' });
  res.json({ team });
});

app.put('/api/teams/:id', requireAuth, (req, res) => {
  const team = getTeam(db, req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your team' });
  const updated = updateTeam(db, req.params.id, req.body || {});
  res.json({ team: updated });
});

app.delete('/api/teams/:id', requireAuth, (req, res) => {
  const team = getTeam(db, req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your team' });
  archiveTeam(db, req.params.id);
  res.json({ success: true });
});

app.post('/api/teams/:id/members', requireAuth, (req, res) => {
  const team = getTeam(db, req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your team' });
  const { project_id, purpose } = req.body || {};
  if (!project_id) return res.status(400).json({ error: 'project_id is required' });
  // Verify the project exists
  const proj = dbGet(db, 'SELECT id FROM projects WHERE id = ?', [project_id]);
  if (!proj) return res.status(400).json({ error: 'project_id does not exist' });
  try {
    const member = addMember(db, req.params.id, { project_id, purpose: purpose ?? null });
    res.json({ member });
  } catch (err) {
    // unique index violation — already a member
    res.status(409).json({ error: 'Project is already a member of this team' });
  }
});

app.put('/api/teams/:id/members/:memberId', requireAuth, (req, res) => {
  const team = getTeam(db, req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your team' });
  const m = updateMember(db, req.params.memberId, req.body || {});
  if (!m) return res.status(404).json({ error: 'Member not found' });
  res.json({ member: m });
});

app.delete('/api/teams/:id/members/:memberId', requireAuth, (req, res) => {
  const team = getTeam(db, req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (team.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your team' });
  removeMember(db, req.params.memberId);
  res.json({ success: true });
});

app.put('/api/chats/:id/team', requireAuth, (req, res) => {
  const chat = dbGet(db, 'SELECT * FROM chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const { team_id } = req.body || {};
  if (team_id) {
    const team = getTeam(db, team_id);
    if (!team || team.owner_id !== req.user.id) return res.status(400).json({ error: 'Invalid team_id' });
  }
  dbRun(db, 'UPDATE chats SET active_team_id = ? WHERE id = ?', [team_id || null, req.params.id]);
  res.json({ success: true, active_team_id: team_id || null });
});
```

- [ ] **Step 3: Smoke-test the routes**

Restart the backend (`npm run dev:backend`). In another shell, set `UID` to a real seeded user id (find one with `sqlite3 ./data/vetted_portal.db "SELECT id FROM users WHERE email='admin@vetted.com'"` — copy the value):

```bash
UID="<paste-admin-id>"

# create
curl -s -H "X-User-Id: $UID" -H "Content-Type: application/json" \
  -d '{"name":"Test team","description":"smoke","playbook":"Step 1: do a thing"}' \
  http://localhost:3000/api/teams | jq

# list
curl -s -H "X-User-Id: $UID" http://localhost:3000/api/teams | jq

# add a member — find a project id first
PID=$(sqlite3 ./data/vetted_portal.db "SELECT id FROM projects LIMIT 1")
TID=$(curl -s -H "X-User-Id: $UID" http://localhost:3000/api/teams | jq -r '.teams[0].id')
curl -s -H "X-User-Id: $UID" -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PID\",\"purpose\":\"smoke test\"}" \
  http://localhost:3000/api/teams/$TID/members | jq

# read full team
curl -s -H "X-User-Id: $UID" http://localhost:3000/api/teams/$TID | jq
```

Expected: each call returns a 200 with the corresponding object. The final read shows the team with one member populated with `project_name` and `purpose`.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(teams): REST API for team CRUD + member ops + chat activation"
```

---

### Task 4: Frontend types and API client

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/index.ts`

- [ ] **Step 1: Add types**

In `src/types/index.ts`, append:

```typescript
export interface Team {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  playbook?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  member_count?: number;
  members?: TeamMember[];
}

export interface TeamMember {
  id: string;
  team_id: string;
  project_id: string;
  purpose?: string | null;
  display_order: number;
  project_name?: string;
  project_description?: string | null;
  default_model?: string;
  system_prompt?: string;
}

export interface AgentRunMessage {
  run_id: string;
  project_id: string;
  project_name: string;
  prompt: string;
  final_message?: string;
  events: AgentRunEvent[];
  duration_ms?: number;
  tokens?: { input: number; output: number };
  error?: string | null;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
}

export type AgentRunEvent =
  | { type: 'started'; ts: string; prompt_summary: string }
  | { type: 'thinking'; ts: string; delta: string }
  | { type: 'tool_call'; ts: string; tool: string; args_summary: string }
  | { type: 'tool_result'; ts: string; tool: string; result_summary: string }
  | { type: 'text'; ts: string; delta: string }
  | { type: 'finished'; ts: string; final_message: string; duration_ms: number; tokens: { input: number; output: number }; error?: string };
```

Then extend the existing `Chat` and `Message` interfaces. Find `export interface Chat` and add (preserving existing fields):

```typescript
  active_team_id?: string | null;
```

Find `export interface Message` and add:

```typescript
  kind?: 'agent_run' | null;
```

> If the existing `Message` interface does not exist (the codebase uses `ChatMessage` instead in some files), grep for `interface Message` first and add the field on whichever interface is the source of truth.

- [ ] **Step 2: Add the API client**

In `src/api/index.ts`, find the `skills = { ... }` block and add a similar block below it:

```typescript
export const teams = {
  list: () => request('/teams').then(d => d.teams || d || []),
  create: (data: { name: string; description?: string; playbook?: string }) =>
    request('/teams', { method: 'POST', body: JSON.stringify(data) }).then(d => d.team || d),
  get: (id: string) => request(`/teams/${id}`).then(d => d.team || d),
  update: (id: string, data: any) =>
    request(`/teams/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.team || d),
  delete: (id: string) => request(`/teams/${id}`, { method: 'DELETE' }),
  addMember: (id: string, data: { project_id: string; purpose?: string }) =>
    request(`/teams/${id}/members`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.member || d),
  updateMember: (id: string, memberId: string, data: any) =>
    request(`/teams/${id}/members/${memberId}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.member || d),
  removeMember: (id: string, memberId: string) =>
    request(`/teams/${id}/members/${memberId}`, { method: 'DELETE' }),
};

export const chatTeam = {
  set: (chatId: string, teamId: string | null) =>
    request(`/chats/${chatId}/team`, { method: 'PUT', body: JSON.stringify({ team_id: teamId }) }),
};
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. (If errors mention pre-existing files unrelated to your changes, that's the existing project state — focus on errors in `src/types/index.ts` and `src/api/index.ts`.)

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/api/index.ts
git commit -m "feat(teams): frontend types + API client"
```

---

### Task 5: Sidebar entry + routes

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add Teams nav entry to the sidebar**

In `src/components/sidebar/Sidebar.tsx`, find the imports from `lucide-react` and add `Users`:

```typescript
import {
  Plus,
  FolderOpen,
  BookOpen,
  Sparkles,
  Grid3X3,
  Puzzle,
  Shield,
  Users,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Trash2,
  Pencil,
} from 'lucide-react';
```

Find the nav array (lines ~131-139) and add Teams below Skills:

```typescript
{[
  { path: '/projects', icon: FolderOpen, label: 'Projects' },
  { path: '/library', icon: BookOpen, label: 'Library' },
  { path: '/skills', icon: Sparkles, label: 'Skills' },
  { path: '/teams', icon: Users, label: 'Teams' },
  { path: '/apps', icon: Grid3X3, label: 'Apps' },
  { path: '/integrations', icon: Puzzle, label: 'Integrations' },
  ...
```

Also bump the sidebar version string (the user prefers this — see auto-memory `feedback_version`). Search for the version footer and increment it.

- [ ] **Step 2: Register the routes**

In `src/App.tsx`, find the `<Route ...>` block. Locate where `/skills` and `/skills/:id/edit` are registered, and add:

```tsx
<Route path="/teams" element={<TeamsPage />} />
<Route path="/teams/new" element={<TeamEditPage />} />
<Route path="/teams/:id/edit" element={<TeamEditPage />} />
```

Add the imports near the other page imports:

```typescript
import TeamsPage from './pages/TeamsPage';
import TeamEditPage from './pages/TeamEditPage';
```

> Tasks 6 and 7 create those page components. Until then the imports will error — that's expected; we'll resolve by completing the next tasks before running the dev server again.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx src/App.tsx
git commit -m "feat(teams): sidebar entry + routes for /teams"
```

---

### Task 6: Teams list page

**Files:**
- Create: `src/pages/TeamsPage.tsx`

- [ ] **Step 1: Write the page**

Mirror the visual structure of `src/pages/SkillsPage.tsx` (read it first if you need the styling cues):

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, Trash2 } from 'lucide-react';
import * as api from '../api';
import type { Team } from '../types';

export default function TeamsPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.teams.list().then((rows) => { setTeams(rows); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Archive team "${name}"?`)) return;
    await api.teams.delete(id);
    setTeams((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="flex-1 overflow-y-auto bg-vetted-bg">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-serif text-vetted-primary">Teams</h1>
            <p className="text-sm text-vetted-text-muted mt-1">
              Bundle projects into a coordinated agentic workflow.
            </p>
          </div>
          <button
            onClick={() => navigate('/teams/new')}
            className="flex items-center gap-2 px-4 py-2 bg-vetted-primary text-white rounded-lg hover:bg-black transition-colors text-sm"
          >
            <Plus size={14} /> New Team
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-vetted-text-muted">Loading…</p>
        ) : teams.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-vetted-border rounded-xl">
            <Users size={28} className="mx-auto text-vetted-text-muted mb-3" />
            <p className="text-sm text-vetted-text-muted">No teams yet. Click <strong>New Team</strong> to build one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {teams.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-4 px-5 py-4 bg-white rounded-xl border border-vetted-border hover:border-vetted-accent transition-colors cursor-pointer"
                onClick={() => navigate(`/teams/${t.id}/edit`)}
              >
                <Users size={18} className="text-vetted-accent" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-vetted-primary truncate">{t.name}</div>
                  {t.description && (
                    <div className="text-xs text-vetted-text-muted truncate mt-0.5">{t.description}</div>
                  )}
                </div>
                <span className="text-xs text-vetted-text-muted whitespace-nowrap">
                  {t.member_count ?? 0} sub-agent{(t.member_count ?? 0) === 1 ? '' : 's'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(t.id, t.name); }}
                  className="p-2 hover:bg-vetted-surface rounded-lg text-vetted-text-muted"
                  title="Archive"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit (don't run UI yet — we still need the editor page)**

```bash
git add src/pages/TeamsPage.tsx
git commit -m "feat(teams): list page"
```

---

### Task 7: Team editor page

**Files:**
- Create: `src/pages/TeamEditPage.tsx`

- [ ] **Step 1: Write the page**

```tsx
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
```

- [ ] **Step 2: Run the dev server and verify the editor end-to-end**

```bash
npm run dev
```

Open http://localhost:5173, log in as `admin@vetted.com`, click **Teams** in the sidebar. Verify:

- Teams list page loads and shows empty state
- "New Team" button opens the editor
- Entering a name and clicking "Create team" creates the team and navigates to `/teams/<id>/edit`
- Members section now visible — clicking "Add project" opens picker, selecting a project adds it
- Editing the purpose inline saves on blur
- Editing the playbook saves on blur
- Reload the editor page — values persist
- Going back to Teams list shows the team with correct member count

- [ ] **Step 3: Commit**

```bash
git add src/pages/TeamEditPage.tsx
git commit -m "feat(teams): editor page (identity + members + playbook)"
```

---

### Task 8: Demo seed

**Files:**
- Modify: `server/seed.js`

- [ ] **Step 1: Add a demo team to the seed**

In `server/seed.js`, find the section where projects are seeded. After projects are inserted, add (adapt user/project ids to whatever the existing seed code uses):

```javascript
// Demo team — wires the first three projects together as a sample
try {
  const adminUser = dbGet(db, "SELECT id FROM users WHERE email = 'admin@vetted.com'");
  const sampleProjects = dbAll(db, 'SELECT id, name, description FROM projects ORDER BY created_at ASC LIMIT 3');
  if (adminUser && sampleProjects.length >= 2) {
    const teamId = uuidv4();
    const now = new Date().toISOString();
    dbRun(db, `
      INSERT INTO teams (id, owner_id, name, description, playbook, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `, [
      teamId, adminUser.id,
      'Sample Investment Team',
      'A demo team showing how projects chain into an agentic workflow.',
      `When the user asks for an investment analysis:
1. Dispatch the first sub-agent to gather background context.
2. Dispatch the second sub-agent in parallel to analyze any data the user supplied.
3. Synthesize their findings into a final report.`,
      now, now,
    ]);
    sampleProjects.forEach((p, i) => {
      dbRun(db, `
        INSERT INTO team_members (id, team_id, project_id, purpose, display_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [uuidv4(), teamId, p.id, p.description || `Sub-agent role ${i + 1}`, i, now]);
    });
    console.log('  ✓ Seeded sample team with', sampleProjects.length, 'sub-agents');
  }
} catch (err) {
  console.error('  ✗ Sample team seed failed:', err.message);
}
```

> If `seed.js` already imports `uuidv4`, `dbGet`, `dbAll`, `dbRun` — reuse those imports. Otherwise add them at the top.

- [ ] **Step 2: Reseed and verify**

```bash
rm ./data/vetted_portal.db
npm run dev:backend
# Wait for "Server listening" then ctrl-c if needed
sqlite3 ./data/vetted_portal.db "SELECT name FROM teams"
sqlite3 ./data/vetted_portal.db "SELECT t.name, COUNT(tm.id) FROM teams t LEFT JOIN team_members tm ON tm.team_id=t.id GROUP BY t.id"
```

Expected: shows "Sample Investment Team" with 2 or 3 members.

- [ ] **Step 3: Commit**

```bash
git add server/seed.js
git commit -m "feat(teams): seed a demo team on first boot"
```

---

### Slice 1 STATUS gate

Stop. Run the dev server, click around as `admin@vetted.com`. Verify the demo team is in the Teams list, editable, members add/remove, playbook persists. Report STATUS:

```
## STATUS — Slice 1 complete
Teams list, editor, demo seed all working.
Files: server/database.js, server/lib/teams.js, server/index.js,
       server/seed.js, src/types/index.ts, src/api/index.ts,
       src/components/sidebar/Sidebar.tsx, src/App.tsx,
       src/pages/TeamsPage.tsx, src/pages/TeamEditPage.tsx
Tests: smoke checks pass.
Commits: <list slice-1 commit hashes>
Next: Slice 2 — orchestrator + dispatch.
```

---

# SLICE 2 — Orchestrator + dispatch

Goal: teams actually run end-to-end. Cards are post-hoc (collapsed only), no live streaming yet.

### Task 9: Sub-agent runner lib

**Files:**
- Create: `server/lib/dispatch-agent.js`

- [ ] **Step 1: Write the lib**

```javascript
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun, getDatabase } from '../database.js';
import { chatWithDocuments as claudeChatWithDocuments } from './claude-direct.js';
import { chatWithDocuments as geminiChatWithDocuments } from './gemini.js';
import { queryProject, formatRetrievedContext } from './rag.js';
import { mcpManager } from './mcp-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';

const RUN_TIMEOUT_MS = parseInt(process.env.AGENT_RUN_TIMEOUT_MS || '300000', 10); // 5 min

function resolveFilePath(relPath) {
  if (path.isAbsolute(relPath)) return relPath;
  return path.join(process.cwd(), relPath);
}

async function readLibraryFile(file) {
  const filePath = resolveFilePath(file.file_path);
  if (file.file_type === 'pdf' || file.mime_type === 'application/pdf') {
    try {
      const buffer = fs.readFileSync(filePath);
      return { name: file.original_name, mimeType: 'application/pdf', base64: buffer.toString('base64') };
    } catch { return { name: file.original_name, text: `[Could not read ${file.original_name}]` }; }
  } else if (file.file_type === 'docx') {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      return { name: file.original_name, text: result.value };
    } catch { return { name: file.original_name, text: `[Could not read ${file.original_name}]` }; }
  } else {
    try { return { name: file.original_name, text: fs.readFileSync(filePath, 'utf8') }; }
    catch { return { name: file.original_name, text: `[Could not read ${file.original_name}]` }; }
  }
}

/**
 * Run one sub-agent dispatch.
 *   project: row from projects table (caller validates membership in active team)
 *   prompt: string from the orchestrator
 *   onEvent: optional callback for typed events ({type, ...payload})
 *   userId: caller's user id (for usage logging)
 *   signal: AbortSignal — propagates orchestrator stop
 *
 * Returns { run_id, final_message, duration_ms, tokens, events, error?, status }
 */
export async function runDispatch({ project, prompt, onEvent = null, userId = null, signal = null }) {
  const db = getDatabase();
  const run_id = uuidv4();
  const events = [];
  const startedAt = Date.now();
  const emit = (type, payload = {}) => {
    const event = { type, ts: new Date().toISOString(), ...payload };
    events.push(event);
    if (onEvent) try { onEvent(event); } catch (e) { /* swallow */ }
  };

  const summarize = (s, n = 200) => (typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : '');

  emit('started', { run_id, project_id: project.id, project_name: project.name, prompt_summary: summarize(prompt) });

  try {
    const preamble = `You are a sub-agent named "${project.name}" dispatched by an orchestrator. Use your tools and knowledge to handle the prompt below. Return ONE final assistant message — no recursion, no further dispatch. Be thorough and direct.`;
    const systemPromptOverride = `${preamble}\n\n${(project.system_prompt || '').trim()}`.trim();

    const projectFiles = dbAll(db, 'SELECT * FROM library_files WHERE project_id = ?', [project.id]);
    const docs = [];
    for (const f of projectFiles) docs.push(await readLibraryFile(f));

    let retrievedContext = '';
    try {
      const chunks = await queryProject(project.id, prompt);
      if (chunks && chunks.length > 0) retrievedContext = formatRetrievedContext(chunks);
    } catch { /* RAG is best-effort */ }
    const finalSystem = retrievedContext
      ? `${systemPromptOverride}\n\n## Retrieved Context\n${retrievedContext}`
      : systemPromptOverride;

    let mcpToolDeclarations = [];
    let mcpToolMap = {};
    let activeMcpIds = [];
    try {
      const parsed = JSON.parse(project.mcp_servers || '[]');
      activeMcpIds = Array.isArray(parsed) ? parsed : [];
    } catch { activeMcpIds = []; }
    if (activeMcpIds.length > 0) {
      const mcpServers = dbAll(db,
        `SELECT * FROM mcp_servers WHERE id IN (${activeMcpIds.map(() => '?').join(',')}) AND enabled = 1`,
        activeMcpIds,
      );
      for (const server of mcpServers) {
        try {
          const tools = await mcpManager.getTools(server);
          for (const tool of tools) {
            const prefixedName = `${server.id}__${tool.name}`;
            mcpToolMap[prefixedName] = { serverId: server.id, serverName: server.name, originalName: tool.name, serverConfig: server };
            const declaration = { name: prefixedName, description: tool.description || '' };
            if (tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0) {
              declaration.parameters = {
                type: tool.inputSchema.type || 'object',
                properties: tool.inputSchema.properties || {},
              };
              if (tool.inputSchema.required) declaration.parameters.required = tool.inputSchema.required;
            }
            mcpToolDeclarations.push(declaration);
          }
        } catch (err) {
          emit('tool_call', { tool: server.name, args_summary: `failed to start: ${err.message}` });
        }
      }
    }

    const onStep = (msg) => emit('thinking', { delta: msg + '\n' });

    const timeout = setTimeout(() => {
      try { signal?.dispatchEvent?.(new Event('abort')); } catch { /* signal may be a basic AbortController.signal */ }
    }, RUN_TIMEOUT_MS);

    let result;
    try {
      const isClaudeModel = project.default_model && (project.default_model.startsWith('claude-') || project.default_model.includes('claude'));
      if (isClaudeModel) {
        const claudeTools = mcpToolDeclarations.map(decl => ({
          name: decl.name,
          description: decl.description || '',
          input_schema: {
            type: 'object',
            properties: decl.parameters?.properties || {},
            ...(decl.parameters?.required ? { required: decl.parameters.required } : {}),
          },
        }));
        result = await claudeChatWithDocuments(
          docs, prompt, [], finalSystem, userId, onStep, project.default_model,
          { claudeTools, mcpToolMap, mcpManager, builtinToolMap: {}, images: [], signal },
        );
      } else {
        const geminiTools = mcpToolDeclarations.length > 0
          ? [{ functionDeclarations: mcpToolDeclarations }]
          : [];
        result = await geminiChatWithDocuments(
          docs, prompt, [], finalSystem, userId, onStep, project.default_model, geminiTools, [], signal,
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    const final_message = (result?.text || '').trim();
    emit('text', { delta: final_message });
    const duration_ms = Date.now() - startedAt;
    const tokens = { input: result?.usage?.input_tokens || 0, output: result?.usage?.output_tokens || 0 };
    emit('finished', { final_message, duration_ms, tokens });

    return { run_id, project_id: project.id, project_name: project.name, prompt, final_message, events, duration_ms, tokens, error: null, status: 'done' };
  } catch (err) {
    const isAbort = err?.name === 'AbortError' || err?.message === 'aborted' || signal?.aborted;
    const duration_ms = Date.now() - startedAt;
    const errMsg = isAbort ? 'cancelled' : (err?.message || 'unknown error');
    emit('finished', { final_message: '', duration_ms, tokens: { input: 0, output: 0 }, error: errMsg });
    return {
      run_id, project_id: project.id, project_name: project.name, prompt,
      final_message: '', events, duration_ms, tokens: { input: 0, output: 0 },
      error: errMsg, status: isAbort ? 'cancelled' : 'error',
    };
  }
}

/**
 * Persist a completed run as a `messages` row with kind="agent_run".
 */
export function persistAgentRun(db, chatId, run) {
  const msgId = uuidv4();
  const now = new Date().toISOString();
  dbRun(db, `
    INSERT INTO messages (id, chat_id, role, content, model_used, token_count, reasoning, attachments, images, created_at, kind)
    VALUES (?, ?, 'assistant', ?, ?, ?, NULL, NULL, NULL, ?, 'agent_run')
  `, [
    msgId, chatId, JSON.stringify(run),
    null,
    (run.tokens?.input || 0) + (run.tokens?.output || 0),
    now,
  ]);
  return msgId;
}
```

- [ ] **Step 2: Smoke-check the lib loads**

```bash
node --input-type=module -e "import('./server/lib/dispatch-agent.js').then(m => console.log(Object.keys(m)))"
```

Expected: `['runDispatch', 'persistAgentRun']`.

- [ ] **Step 3: Commit**

```bash
git add server/lib/dispatch-agent.js
git commit -m "feat(teams): dispatch-agent lib for sub-agent inference loops"
```

---

### Task 10: Wire `dispatch_agent` into the chat tool loop

The chat endpoint currently registers MCP + builtin + tavily tools. We add `dispatch_agent` when a team is active.

**Files:**
- Modify: `server/index.js` — both inside the chat-message handler and at the top imports

- [ ] **Step 1: Import what we need**

At the top of `server/index.js`, add (alongside other lib imports):

```javascript
import { getTeam, buildTeamSystemPromptBlock } from './lib/teams.js';
import { runDispatch, persistAgentRun } from './lib/dispatch-agent.js';
```

- [ ] **Step 2: Load the active team and augment the system prompt**

Inside the `app.post('/api/chats/:id/messages', ...)` handler, locate the place where `systemPromptOverride = parts.join('\n\n');` is built (around line ~970). Just *before* that line, add:

```javascript
// Active team — augment system prompt and prepare dispatch tool
let activeTeam = null;
if (chat.active_team_id) {
  activeTeam = getTeam(db, chat.active_team_id);
  if (activeTeam) {
    step(`Team active: ${activeTeam.name}`);
    const block = buildTeamSystemPromptBlock(activeTeam);
    if (block) parts.push(block);
  }
}
```

- [ ] **Step 3: Add the dispatch tool declaration**

Find where `builtinToolDeclarations` is defined (around line ~1080). Right after that line, add:

```javascript
// Dispatch tool — only when an active team is present
const dispatchToolDeclaration = activeTeam ? {
  name: 'dispatch_agent',
  description: 'Dispatch a sub-agent (one of the team members) to handle a sub-task. Returns the sub-agent\'s final message. Use multiple times in one response to run sub-agents in parallel.',
  parameters: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: 'Must be a project_id listed in the team roster.' },
      prompt: { type: 'string', description: 'The full prompt to pass to the sub-agent. Be specific — this is the only context it sees.' },
    },
    required: ['project_id', 'prompt'],
  },
} : null;
```

- [ ] **Step 4: Include the declaration in tool lists**

Find the line `const allFunctionDeclarations = [...mcpToolDeclarations, ...builtinToolDeclarations];` and change to:

```javascript
const allFunctionDeclarations = [...mcpToolDeclarations, ...builtinToolDeclarations];
if (dispatchToolDeclaration) allFunctionDeclarations.push(dispatchToolDeclaration);
```

Find the corresponding `claudeTools = [...mcpToolDeclarations, ...builtinToolDeclarations].map(...)` (around line ~1127). Change to:

```javascript
const claudeBaseDecls = [...mcpToolDeclarations, ...builtinToolDeclarations];
if (dispatchToolDeclaration) claudeBaseDecls.push(dispatchToolDeclaration);
const claudeTools = claudeBaseDecls.map(decl => {
  // (keep existing normalize logic here)
  ...
});
```

(Preserve the existing `normalizeSchema` mapping body — only the source array changes.)

- [ ] **Step 5: Add the dispatch handler**

The handler runs alongside the existing `builtinToolMap`. Find the call site where `claudeDirectChatWithDocuments` is invoked. Just before that call, define:

```javascript
const builtinToolMapWithDispatch = activeTeam
  ? {
      ...builtinToolMap,
      dispatch_agent: async (args) => {
        const projectId = args?.project_id;
        const promptArg = args?.prompt;
        if (!projectId || typeof promptArg !== 'string' || !promptArg.trim()) {
          return 'Error: dispatch_agent requires { project_id, prompt }.';
        }
        const member = (activeTeam.members || []).find(m => m.project_id === projectId);
        if (!member) {
          return `Error: project_id "${projectId}" is not a member of team "${activeTeam.name}". Available: ${(activeTeam.members||[]).map(m=>m.project_id).join(', ')}.`;
        }
        const proj = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [projectId]);
        if (!proj) return `Error: project not found.`;
        step(`Dispatching sub-agent: ${proj.name}`);
        const run = await runDispatch({
          project: proj,
          prompt: promptArg,
          userId: req.user?.id || null,
          signal: aiAbort.signal,
        });
        persistAgentRun(db, chat.id, run);
        if (run.error) return `Sub-agent error: ${run.error}`;
        return run.final_message || '(sub-agent returned no text)';
      },
    }
  : builtinToolMap;
```

Then in the `claudeDirectChatWithDocuments` call, replace `builtinToolMap` with `builtinToolMapWithDispatch`:

```javascript
result = await claudeDirectChatWithDocuments(
  docs, content, history, systemPromptOverride, req.user?.id || null, step, modelId,
  { claudeTools, mcpToolMap, mcpManager, builtinToolMap: builtinToolMapWithDispatch, images, signal: aiAbort.signal },
);
```

- [ ] **Step 6: Mirror the wiring on the Gemini path**

Find the corresponding Gemini section (around line ~1175 — the `if (builtinToolMap[prefixedName])` branch in the function-call loop). Replace `builtinToolMap` references with `builtinToolMapWithDispatch` (so the same merged map is checked). The handler is identical because the dispatch tool returns a string either way.

> Concrete: at the top of the `else { step('Calling Gemini'); ... }` branch, define `builtinToolMapWithDispatch` the same way as in step 5, and pass it through. Then change every `builtinToolMap[prefixedName]` reference inside the Gemini loop to use `builtinToolMapWithDispatch` instead.

- [ ] **Step 7: Smoke-test**

Restart the backend. Activate the demo team manually:

```bash
UID="<admin-user-id>"
TID=$(sqlite3 ./data/vetted_portal.db "SELECT id FROM teams WHERE name='Sample Investment Team'")
# Create a chat
CHAT_ID=$(curl -s -H "X-User-Id: $UID" -H "Content-Type: application/json" \
  -d '{"title":"Team smoke","model":"claude-opus-4-20250514"}' \
  http://localhost:3000/api/chats | jq -r '.chat.id')
# Activate the team
curl -s -H "X-User-Id: $UID" -H "Content-Type: application/json" \
  -d "{\"team_id\":\"$TID\"}" \
  http://localhost:3000/api/chats/$CHAT_ID/team | jq

# Send a message that should trigger dispatch
curl -N -H "X-User-Id: $UID" -H "Content-Type: application/json" \
  -d '{"content":"Use your team to summarize what each sub-agent does, dispatching them once each in parallel."}' \
  http://localhost:3000/api/chats/$CHAT_ID/messages
```

Expected: SSE stream, `step` events including `Dispatching sub-agent: <project name>` for each member. Final assistant message references each sub-agent's response.

```bash
# Verify agent_run rows were persisted
sqlite3 ./data/vetted_portal.db "SELECT id, kind, length(content) FROM messages WHERE chat_id='$CHAT_ID' AND kind='agent_run'"
```

Expected: rows with `kind='agent_run'` and a non-trivial JSON body length.

- [ ] **Step 8: Commit**

```bash
git add server/index.js
git commit -m "feat(teams): wire dispatch_agent tool into chat orchestrator loop"
```

---

### Task 11: Per-turn dispatch caps

**Files:**
- Modify: `server/index.js` (extend the `dispatch_agent` handler)

- [ ] **Step 1: Add caps**

In the `dispatch_agent` handler from Task 10, introduce a per-turn counter. At the top of the request handler (where you declared `activeTeam`), add:

```javascript
const AGENT_MAX_PER_TURN = parseInt(process.env.AGENT_MAX_PER_TURN || '10', 10);
let agentDispatchCount = 0;
```

In the `dispatch_agent` handler body, before calling `runDispatch`, add:

```javascript
if (agentDispatchCount >= AGENT_MAX_PER_TURN) {
  return `Error: dispatch limit reached (${AGENT_MAX_PER_TURN} per turn). Synthesize results so far instead.`;
}
agentDispatchCount += 1;
```

> The parallel cap is harder to enforce strictly without a queue; in v1 we rely on the orchestrator's natural batching (it tends to dispatch ~3-5 at a time). Add a one-line comment: `// AGENT_MAX_PARALLEL is observational in v1; enforced by orchestrator batching.`

- [ ] **Step 2: Smoke-test**

Manually drop `AGENT_MAX_PER_TURN=2` in `.env`, restart, send a prompt that asks for 4 dispatches. Verify the third returns the limit-reached error.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(teams): per-turn dispatch cap"
```

---

### Task 12: Return `kind` from chat-history API

**Files:**
- Modify: `server/index.js` — `app.get('/api/chats/:id', ...)` handler

- [ ] **Step 1: Include kind + parsed agent_run content**

Find the `messagesWithParsedReasoning` map (line ~644). Extend it:

```javascript
const messagesWithParsedReasoning = messages.map((m, i) => ({
  ...m,
  reasoning: m.reasoning ? JSON.parse(m.reasoning) : null,
  attachments: parsedAttachments[i]
    ? parsedAttachments[i].map(id => attachmentMap[id]).filter(Boolean)
    : null,
  images: m.images ? JSON.parse(m.images) : null,
  kind: m.kind || null,
  agent_run: m.kind === 'agent_run'
    ? (() => { try { return JSON.parse(m.content); } catch { return null; } })()
    : null,
}));
```

- [ ] **Step 2: Smoke-test**

```bash
curl -s -H "X-User-Id: $UID" http://localhost:3000/api/chats/$CHAT_ID | jq '.messages[] | select(.kind=="agent_run") | {kind, run_id: .agent_run.run_id, project_name: .agent_run.project_name, status: .agent_run.status}'
```

Expected: prints one line per agent_run with project_name and status.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(teams): expose agent_run messages on chat read"
```

---

### Task 13: Active-team dropdown

**Files:**
- Create: `src/components/chat/TeamDropdown.tsx`
- Modify: `src/pages/MainChatPage.tsx` (and `ProjectDetailPage.tsx` if it has a separate ChatInput surface — search both)

- [ ] **Step 1: Write the dropdown component**

```tsx
import { useEffect, useState } from 'react';
import { Users, ChevronDown } from 'lucide-react';
import * as api from '../../api';
import type { Team } from '../../types';

export default function TeamDropdown({
  chatId,
  activeTeamId,
  onChange,
}: {
  chatId: string | null;
  activeTeamId: string | null;
  onChange: (teamId: string | null) => void;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.teams.list().then(setTeams).catch(() => setTeams([]));
  }, []);

  const active = teams.find((t) => t.id === activeTeamId) || null;

  const select = async (teamId: string | null) => {
    setOpen(false);
    onChange(teamId);
    if (chatId) await api.chatTeam.set(chatId, teamId);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
          active
            ? 'bg-vetted-accent/10 border-vetted-accent text-vetted-primary'
            : 'bg-white border-vetted-border text-vetted-text-muted hover:border-vetted-accent'
        }`}
        title={active ? `${active.name} is active` : 'No team active'}
      >
        <Users size={12} />
        <span className="font-medium">{active ? active.name : 'No team'}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 bg-white border border-vetted-border rounded-lg shadow-lg min-w-[200px] py-1">
          <button
            onClick={() => select(null)}
            className={`w-full text-left px-3 py-2 text-xs hover:bg-vetted-surface ${activeTeamId === null ? 'font-medium' : ''}`}
          >
            None
          </button>
          {teams.length === 0 ? (
            <div className="px-3 py-2 text-xs text-vetted-text-muted">No teams. Create one in /teams.</div>
          ) : (
            teams.map((t) => (
              <button
                key={t.id}
                onClick={() => select(t.id)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-vetted-surface ${activeTeamId === t.id ? 'font-medium' : ''}`}
              >
                <div>{t.name}</div>
                <div className="text-[11px] text-vetted-text-muted">{t.member_count ?? 0} sub-agent{(t.member_count ?? 0) === 1 ? '' : 's'}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it next to the model picker**

In `src/pages/MainChatPage.tsx`, find where `ModelPickerMenu` is rendered above/around the chat input. Add `TeamDropdown` adjacent. When a chat is loaded, read its `active_team_id` into local state. Sketch:

```tsx
import TeamDropdown from '../components/chat/TeamDropdown';
// ...
const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
// On chat load:
useEffect(() => {
  if (currentChatId) {
    api.chats.get(currentChatId).then((d) => {
      setActiveTeamId(d.chat?.active_team_id || null);
    });
  }
}, [currentChatId]);

// In the JSX near ModelPickerMenu:
<TeamDropdown
  chatId={currentChatId}
  activeTeamId={activeTeamId}
  onChange={setActiveTeamId}
/>
```

> Adapt variable names (`currentChatId`, etc.) to whatever the file uses. If `ProjectDetailPage.tsx` has its own chat surface, mirror the same change there.

- [ ] **Step 3: Smoke-test**

`npm run dev`, open a chat, see the new dropdown, pick the seeded team, send a message. Verify in the network tab that `PUT /api/chats/:id/team` was called.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/TeamDropdown.tsx src/pages/MainChatPage.tsx
git commit -m "feat(teams): active-team dropdown above chat input"
```

---

### Task 14: Render `agent_run` messages as collapsed cards

**Files:**
- Create: `src/components/chat/AgentRunCard.tsx`
- Modify: `src/pages/MainChatPage.tsx` (the message rendering block)

- [ ] **Step 1: Write a minimal AgentRunCard (collapsed-only for slice 2)**

```tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X as XIcon, Loader2 } from 'lucide-react';
import type { AgentRunMessage } from '../../types';

export default function AgentRunCard({ run }: { run: AgentRunMessage }) {
  const [open, setOpen] = useState(false);
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
          {run.prompt && (
            <details className="mb-2">
              <summary className="cursor-pointer text-vetted-text-muted">Prompt</summary>
              <pre className="font-mono text-[11px] whitespace-pre-wrap mt-1 text-vetted-text-secondary">{run.prompt}</pre>
            </details>
          )}
          {run.final_message && (
            <div className="whitespace-pre-wrap text-vetted-primary">{run.final_message}</div>
          )}
          {run.events && run.events.length > 0 && (
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
```

- [ ] **Step 2: Render it from the message stream**

In `src/pages/MainChatPage.tsx`, find where messages are mapped/rendered. Replace the assistant-message rendering block with a branch:

```tsx
{messages.map((m) => {
  if (m.role === 'assistant' && m.kind === 'agent_run' && m.agent_run) {
    return <AgentRunCard key={m.id} run={m.agent_run} />;
  }
  return /* existing renderer */;
})}
```

Add the import:

```tsx
import AgentRunCard from '../components/chat/AgentRunCard';
```

> The `m.agent_run` field comes from Task 12's API extension. Ensure your `ChatMessage` / `Message` type in the page reflects that — extend locally if needed.

- [ ] **Step 3: Smoke-test**

`npm run dev`, open the smoke chat from Task 10, see one card per dispatched sub-agent, click to expand and see the prompt + final_message + event log.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/AgentRunCard.tsx src/pages/MainChatPage.tsx
git commit -m "feat(teams): render agent_run messages as inline cards"
```

---

### Slice 2 STATUS gate

Verify end-to-end:

1. Activate the seeded team in a chat
2. Send "Briefly summarize what each sub-agent does, dispatching them all in parallel"
3. Watch network/logs — see `Dispatching sub-agent:` step events for each
4. After the run, see one `AgentRunCard` per sub-agent, expandable to its prompt + final_message
5. Reload the page — cards still there from history

Report STATUS:

```
## STATUS — Slice 2 complete
Sub-agent dispatch end-to-end. Cards are post-hoc only (no live streaming yet).
Files: server/lib/dispatch-agent.js, server/index.js (chat handler + routes),
       src/components/chat/TeamDropdown.tsx, src/components/chat/AgentRunCard.tsx,
       src/pages/MainChatPage.tsx
Tests: smoke checks pass. agent_run rows persisted; UI renders.
Commits: <list slice-2 commit hashes>
Next: Slice 3 — live streaming.
```

---

# SLICE 3 — Live execution UX

Goal: agent cards stream live thinking + tool calls + output during the run.

### Task 15: Stream sub-agent events through the chat SSE pipe

**Files:**
- Modify: `server/index.js` — `dispatch_agent` handler

- [ ] **Step 1: Forward events as `agent_run.*` SSE messages**

In the `dispatch_agent` handler from Task 10, pass an `onEvent` callback that writes to the SSE response. Replace the body with:

```javascript
dispatch_agent: async (args) => {
  const projectId = args?.project_id;
  const promptArg = args?.prompt;
  if (!projectId || typeof promptArg !== 'string' || !promptArg.trim()) {
    return 'Error: dispatch_agent requires { project_id, prompt }.';
  }
  const member = (activeTeam.members || []).find(m => m.project_id === projectId);
  if (!member) {
    return `Error: project_id "${projectId}" is not on this team.`;
  }
  const proj = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!proj) return `Error: project not found.`;
  if (agentDispatchCount >= AGENT_MAX_PER_TURN) {
    return `Error: dispatch limit reached (${AGENT_MAX_PER_TURN} per turn).`;
  }
  agentDispatchCount += 1;

  step(`Dispatching sub-agent: ${proj.name}`);
  const run = await runDispatch({
    project: proj,
    prompt: promptArg,
    userId: req.user?.id || null,
    signal: aiAbort.signal,
    onEvent: (ev) => {
      sendEvent({ type: `agent_run.${ev.type}`, ...ev });
    },
  });
  persistAgentRun(db, chat.id, run);
  if (run.error) return `Sub-agent error: ${run.error}`;
  return run.final_message || '(sub-agent returned no text)';
},
```

> `sendEvent` is already defined at the top of the chat handler (line ~722) and is in scope here because the handler is a closure inside the request.

- [ ] **Step 2: Smoke-test the SSE stream**

Re-run the curl from Task 10 step 7. In the SSE output, you should now see lines like:

```
data: {"type":"agent_run.started","run_id":"...","project_id":"...",...}
data: {"type":"agent_run.thinking","run_id":"...","delta":"..."}
data: {"type":"agent_run.finished","run_id":"...",...}
```

interleaved with the orchestrator's normal `step` events.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(teams): stream agent_run events on the chat SSE pipe"
```

---

### Task 16: Frontend live-card state machine

**Files:**
- Modify: `src/components/chat/AgentRunCard.tsx` (or augment with a thin wrapper)
- Modify: `src/pages/MainChatPage.tsx` — SSE event handler

- [ ] **Step 1: Track in-flight runs in chat state**

In `MainChatPage.tsx`, find the SSE event handler (the function that processes `data:` lines from the chat-message endpoint). Add a state map for in-flight runs:

```tsx
const [liveRuns, setLiveRuns] = useState<Record<string, AgentRunMessage>>({});
```

In the SSE handler, branch on `type`:

```tsx
if (parsed.type === 'agent_run.started') {
  setLiveRuns((prev) => ({
    ...prev,
    [parsed.run_id]: {
      run_id: parsed.run_id,
      project_id: parsed.project_id,
      project_name: parsed.project_name,
      prompt: '',
      events: [parsed],
      status: 'running',
    } as AgentRunMessage,
  }));
} else if (parsed.type === 'agent_run.thinking' || parsed.type === 'agent_run.tool_call' || parsed.type === 'agent_run.tool_result' || parsed.type === 'agent_run.text') {
  setLiveRuns((prev) => {
    const cur = prev[parsed.run_id];
    if (!cur) return prev;
    return { ...prev, [parsed.run_id]: { ...cur, events: [...cur.events, parsed] } };
  });
} else if (parsed.type === 'agent_run.finished') {
  setLiveRuns((prev) => {
    const cur = prev[parsed.run_id];
    if (!cur) return prev;
    return {
      ...prev,
      [parsed.run_id]: {
        ...cur,
        events: [...cur.events, parsed],
        final_message: parsed.final_message,
        duration_ms: parsed.duration_ms,
        tokens: parsed.tokens,
        error: parsed.error,
        status: parsed.error ? (parsed.error === 'cancelled' ? 'cancelled' : 'error') : 'done',
      },
    };
  });
}
```

- [ ] **Step 2: Render live runs at the bottom of the message stream while the orchestrator is responding**

Below the existing `messages.map(...)` (and before `messagesEndRef`), add:

```tsx
{Object.values(liveRuns)
  .filter((r) => r.status === 'running' || r.status === 'queued')
  .map((r) => (
    <AgentRunCard key={`live-${r.run_id}`} run={r} />
  ))}
```

When the orchestrator's final `done` SSE event fires, the existing code path already refetches chat history. After the refetch, the persisted cards from the API replace the live ones; clear `liveRuns`:

```tsx
// In the existing `done` handler:
setLiveRuns({});
```

- [ ] **Step 3: Add a live-running visual treatment to AgentRunCard**

Already present in Task 14's component (`isRunning && animate-pulse`). For live runs, the latest event's delta should appear in the expanded card body. Replace the expanded body's "final_message" section in `AgentRunCard.tsx` with:

```tsx
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
```

Default `open=true` for running cards:

```tsx
const [open, setOpen] = useState(run.status === 'running');
```

- [ ] **Step 4: Smoke-test**

`npm run dev`, send a multi-dispatch prompt, watch cards appear live and stream their thinking. Verify they collapse to the persisted form on done.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MainChatPage.tsx src/components/chat/AgentRunCard.tsx
git commit -m "feat(teams): live streaming for agent run cards"
```

---

### Task 17: Stop button cancels in-flight runs

**Files:**
- Verify: `server/index.js` — the existing `aiAbort` controller is already passed to `runDispatch` (Task 10 step 5). Sub-agents check `signal.aborted` inside `claude-direct.js`'s tool loop. Verify behavior end-to-end.

- [ ] **Step 1: Verify abort propagation in dispatch lib**

Re-read `server/lib/dispatch-agent.js`. The `signal` parameter is forwarded into `claudeChatWithDocuments` / `geminiChatWithDocuments`. Both libraries already throw on abort. The `runDispatch` `catch` block detects abort and returns `{ status: 'cancelled', error: 'cancelled' }`. No code changes needed if Task 10 was implemented correctly — confirm by reading.

- [ ] **Step 2: Smoke-test stop**

Activate the team, send a prompt, click the stop button mid-stream. Verify:

- Backend logs show `AI request aborted by client`
- Live cards show `cancelled` state
- After reload, the persisted `agent_run` rows have `status: "cancelled"`

- [ ] **Step 3: Commit (if any code changes were needed)**

```bash
# Only if changes needed; otherwise skip
git add ...
git commit -m "fix(teams): propagate abort signal into in-flight dispatches"
```

---

### Task 18: Retry-this-agent button

**Files:**
- Modify: `src/components/chat/AgentRunCard.tsx`
- Modify: `src/pages/MainChatPage.tsx`

- [ ] **Step 1: Add retry button to errored cards**

In `AgentRunCard`, accept an `onRetry` prop:

```tsx
export default function AgentRunCard({ run, onRetry }: { run: AgentRunMessage; onRetry?: (run: AgentRunMessage) => void }) {
```

In the expanded body, when `run.status === 'error'`:

```tsx
{run.status === 'error' && onRetry && (
  <button
    onClick={() => onRetry(run)}
    className="mt-2 px-3 py-1.5 text-xs bg-vetted-primary text-white rounded-lg hover:bg-black"
  >
    Retry this sub-agent
  </button>
)}
```

- [ ] **Step 2: Wire retry from the page**

In `MainChatPage.tsx`, when rendering each card pass an `onRetry`:

```tsx
const handleRetry = (run: AgentRunMessage) => {
  // Compose a new orchestrator prompt that re-dispatches this one project.
  const text = `Please retry the ${run.project_name} sub-agent with this prompt:\n\n${run.prompt}`;
  sendMessage(text); // whatever the existing send-message function is named
};
// In render:
<AgentRunCard run={agent_run} onRetry={handleRetry} />
```

> Why orchestrator-mediated retry rather than a direct re-dispatch endpoint: the orchestrator's continued context window is the right place to react to the retried result. A direct endpoint would create an orphan run.

- [ ] **Step 3: Smoke-test**

Manually break a sub-agent (e.g., set its `default_model` to a non-existent model in the DB), trigger a dispatch, see the error card, click Retry, see the orchestrator re-dispatch.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/AgentRunCard.tsx src/pages/MainChatPage.tsx
git commit -m "feat(teams): retry-this-agent on errored cards"
```

---

### Task 19: History reload replays cards correctly

This should already work because:
1. Task 12 returns `kind` and `agent_run` on `GET /api/chats/:id`
2. Task 14 renders these cards
3. Task 16 clears `liveRuns` on `done`, so reloads use persisted state

- [ ] **Step 1: Verify**

In a chat with completed dispatches, reload the page. Cards must:
- Render in the same chronological position they appeared during the run
- Be collapsed by default
- Expand to show prompt, final_message, and full event log
- Show no spinner / pulsing dot

- [ ] **Step 2: If anything is off, fix it inline and commit**

```bash
# only if needed
git commit -m "fix(teams): history-reload card rendering"
```

---

### Slice 3 STATUS gate

Final verification:

1. Activate seeded team in a fresh chat
2. Send "Dispatch all sub-agents in parallel and synthesize their answers"
3. Watch live: all cards appear, pulse, stream thinking, collapse on done
4. Hit stop mid-run on a fresh request — verify cards show `cancelled`
5. Trigger an error scenario — verify retry button works
6. Reload the chat page — all cards persist correctly

Report STATUS:

```
## STATUS — Slice 3 complete (full feature shipped)
Live streaming, stop, retry, replay all working.
Files: server/index.js, src/pages/MainChatPage.tsx, src/components/chat/AgentRunCard.tsx
Commits: <list slice-3 commit hashes>
Next: ship.
```

---

## Self-review (already applied to this plan)

- **Spec coverage:** every section of the spec maps to a task. Schema → Task 1; team CRUD lib → Task 2; API → Task 3; types/client → Task 4; sidebar/routes → Task 5; list page → Task 6; editor → Task 7; seed → Task 8; sub-agent runner → Task 9; orchestrator wiring → Task 10; per-turn caps → Task 11; chat-history exposure → Task 12; activation UI → Task 13; collapsed cards → Task 14; SSE event stream → Task 15; live-card state machine → Task 16; stop → Task 17; retry → Task 18; replay → Task 19.
- **Placeholder scan:** no TBDs, every step has concrete code or commands.
- **Type consistency:** `Team`, `TeamMember`, `AgentRunMessage`, `AgentRunEvent` defined once in Task 4 and referenced consistently in Tasks 13, 14, 16, 18.
- **Function naming:** `runDispatch`, `persistAgentRun`, `buildTeamSystemPromptBlock`, `getTeam` used consistently across tasks.
