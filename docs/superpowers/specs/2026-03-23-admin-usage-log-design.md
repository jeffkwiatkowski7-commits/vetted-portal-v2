# Admin Usage Log — Design Spec

**Date:** 2026-03-23
**Status:** Approved

## Overview

Add a Usage Log screen under the Admin section that shows all real LLM activity across the app. Covers both the main chat (when `DEMO_MODE=false`) and the lease bot (always real Vertex AI calls). Admins can see who sent what, when, how many tokens were used, and the estimated cost.

---

## Data Model

New table: `usage_log` in SQLite (`server/database.js`).

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | UUID primary key |
| `user_id` | TEXT | FK to `users.id` |
| `source` | TEXT | `'chat'` or `'lease'` |
| `prompt` | TEXT | The user's message text |
| `model` | TEXT | Model identifier, e.g. `gemini-2.0-flash` |
| `input_tokens` | INTEGER | |
| `output_tokens` | INTEGER | |
| `total_tokens` | INTEGER | Computed: input + output |
| `estimated_cost` | REAL | USD, computed at insert time |
| `created_at` | TEXT | ISO 8601 timestamp |

Cost is computed on insert using a static rate table in the server. Rates are rough estimates and stored as-computed — no recomputation at read time.

### Cost rate table (initial values)

| Model prefix | Input ($/1M tokens) | Output ($/1M tokens) |
|---|---|---|
| `gemini-2.0-flash` | $0.075 | $0.30 |
| `gemini-1.5-flash` | $0.075 | $0.30 |
| `gemini-1.5-pro` | $1.25 | $5.00 |
| `gpt-4o` | $2.50 | $10.00 |
| `claude-sonnet` | $3.00 | $15.00 |
| default (fallback) | $1.00 | $4.00 |

---

## Backend

### 1. Schema (`server/database.js`)

Add `usage_log` table creation to `initializeDatabase()`.

### 2. Main chat logging (`server/index.js`)

In `POST /api/chat`, after a real LLM response is received and saved to `messages`, insert one row into `usage_log`. Only fires when a real model call is made (i.e., `DEMO_MODE=false` or the request explicitly uses a real model). The `token_count` already stored on `messages` is reused; split as `input_tokens = token_count * 0.6`, `output_tokens = token_count * 0.4` if the API doesn't return a split (rough approximation).

### 3. Lease bot logging (`server/lib/gemini.js`)

The Vertex AI SDK response includes `usageMetadata` with `promptTokenCount` and `candidatesTokenCount`. After each of the four Gemini functions (`ocrPdf`, `extractLeaseData`, `chatWithLeases`, `chatWithDocuments`, `chatCrossPortfolio`) completes, insert a row into `usage_log`. The `user_id` is passed in as a parameter to these functions (currently not passed — add as optional param; callers in `server/index.js` provide `req.user.id`).

### 4. Admin API endpoints

**`GET /api/admin/usage`** — admin-only (requires `requireAuth` + role check).

Query params:
- `page` (default: 1)
- `limit` (default: 50, max: 500)
- `user_id` — filter by user
- `model` — filter by model
- `from` — ISO date, start of range
- `to` — ISO date, end of range
- `q` — substring search on `prompt`

Returns:
```json
{
  "rows": [
    {
      "id": "...",
      "user_id": "...",
      "display_name": "James Wilson",
      "source": "lease",
      "prompt": "Summarize the key financial risks...",
      "model": "gemini-2.0-flash",
      "input_tokens": 2305,
      "output_tokens": 1537,
      "total_tokens": 3842,
      "estimated_cost": 0.031,
      "created_at": "2026-03-23T14:41:00.000Z"
    }
  ],
  "total": 2847,
  "page": 1,
  "limit": 50
}
```

Joins `usage_log` with `users` on `user_id` to include `display_name`.

**`GET /api/admin/usage/summary`** — admin-only.

Returns aggregate stats for the current calendar month:
```json
{
  "total_prompts": 2847,
  "total_tokens": 4200000,
  "estimated_cost": 84.30,
  "active_users": 26
}
```

---

## Frontend

### New page: `src/pages/AdminUsagePage.tsx`

Route: `/admin/usage`

**Layout (top to bottom):**

1. **Header** — "Usage Log" title, back arrow to `/admin`, auto-refresh note.
2. **Stat cards** (4-up grid): Total Prompts, Total Tokens, Est. Cost (Month), Active Users.
3. **Filter bar**: search input (user or prompt text), user dropdown, model dropdown, date range dropdown, Export CSV button.
4. **Table** with columns:
   - User (avatar initials + display name + department)
   - Date / Time (sortable, default sort: newest first)
   - Prompt (truncated to 2 lines, with model badge below)
   - Tokens (count + mini progress bar relative to max in current page)
   - Est. Cost
5. **Pagination** — page controls, "Showing X–Y of Z entries" label.

**Export CSV:** Client-side. Re-fetches with `limit=500` (or all, up to a reasonable cap), maps rows to CSV string, triggers `<a download>`. No server-side file generation.

**Auto-refresh:** Stat cards refresh every 30 seconds via `setInterval`.

### API layer (`src/api/index.ts`)

Add to `admin` namespace:
```ts
usage: {
  list: (params?: UsageListParams) => fetch('/api/admin/usage?...'),
  summary: () => fetch('/api/admin/usage/summary'),
}
```

### Navigation (`src/pages/AdminPage.tsx`)

Add a "Usage Log" navigation button alongside the existing "Manage Users" button in the Navigation Buttons section at the bottom of the admin dashboard. Links to `/admin/usage`. Uses a `BarChart2` icon from lucide-react.

### Router (`src/App.tsx`)

Add: `<Route path="/admin/usage" element={<AdminUsagePage />} />`

---

## Out of Scope

- Per-user drill-down pages
- Real-time cost alerts or budget thresholds
- Billing integration
- Storing AI response text (only the prompt is stored)
