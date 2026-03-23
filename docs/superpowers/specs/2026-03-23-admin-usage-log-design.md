# Admin Usage Log — Design Spec

**Date:** 2026-03-23
**Status:** Approved

## Overview

Add a Usage Log screen under the Admin section that shows all real LLM activity across the app. Covers both the main chat (when `DEMO_MODE=false`) and the lease bot (always real Vertex AI calls). Admins can see who sent what, when, how many tokens were used, and the estimated cost.

Note: `server/lib/gemini.js` exports exactly five async functions with these current signatures:
- `ocrPdf(pdfBase64)`
- `extractLeaseData(fullText, sourceFile)`
- `chatWithLeases(leaseTexts, userMessage, chatHistory, useSearch = false, persona)`
- `chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null)`
- `chatCrossPortfolio(leaseSummaries, userMessage, chatHistory = [], useSearch = false, persona)`

The new optional `userId` argument is appended as the last parameter in each function.

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

**Indexes:** Create indexes on `created_at`, `user_id`, `source`, and `model` to support filtering and pagination on a large table.

**Migration:** `CREATE TABLE IF NOT EXISTS` handles existing databases — no manual migration needed.

### Cost rate table (initial values)

Matching rule: use `model.startsWith(prefix)` against the model identifier string.

| Model prefix | Input ($/1M tokens) | Output ($/1M tokens) |
|---|---|---|
| `gemini-2.0-flash` | $0.075 | $0.30 |
| `gemini-1.5-flash` | $0.075 | $0.30 |
| `gemini-1.5-pro` | $1.25 | $5.00 |
| `gpt-4o` | $2.50 | $10.00 |
| `claude-sonnet` | $3.00 | $15.00 |
| default (fallback) | $1.00 | $4.00 |

Evaluate prefixes in the order listed (most specific first) and use the first match.

---

## Backend

### 1. Schema (`server/database.js`)

Add `usage_log` table creation to `initializeDatabase()`. Export a `logUsage(db, entry)` helper function from `server/database.js` that inserts a row and immediately persists the database to disk (the existing `saveDatabase(db)` pattern used elsewhere in the file). This centralises the write-and-persist logic so neither `server/index.js` nor `server/lib/gemini.js` need to know about the persistence mechanism.

```js
// Signature
function logUsage(db, { userId, source, prompt, model, inputTokens, outputTokens, estimatedCost })
```

### 2. Main chat logging (`server/index.js`)

In `POST /api/chat`, after a real LLM response is received and saved to `messages`, call `logUsage`. Only fires when `DEMO_MODE` is `false` (the env flag already controls this path). The `model_used` and `token_count` values are already in scope as local variables at the point of the `messages` INSERT — read them from there (no db read-back needed). Since the main chat API does not return a split of input vs output tokens, use the approximation: `input_tokens = Math.round(token_count * 0.6)`, `output_tokens = Math.round(token_count * 0.4)`. If `token_count` is null or 0, skip the `logUsage` call.

Admin role check pattern: use the same inline check used in other admin endpoints — `if (req.user.role !== 'admin' && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' })`.

### 3. Lease bot logging (`server/lib/gemini.js`)

`gemini.js` currently does not import the database. Add imports of `getDatabase` and `logUsage` from `../database.js`. `getDatabase()` is already exported and returns the singleton db instance — no db threading through function signatures needed.

All five functions (`ocrPdf`, `extractLeaseData`, `chatWithLeases`, `chatWithDocuments`, `chatCrossPortfolio`) accept a new optional `userId` parameter as their last argument (defaults to `null`). When a Vertex AI response is received, call `logUsage(getDatabase(), { userId, source: 'lease', prompt: userMessage, model: config.modelId, inputTokens, outputTokens, estimatedCost })`.

- `inputTokens` = `response.usageMetadata.promptTokenCount`
- `outputTokens` = `response.usageMetadata.candidatesTokenCount`
- For `ocrPdf` and `extractLeaseData`, there is no `userMessage` — store the filename or a short descriptor (e.g. `"[OCR: filename.pdf]"`) as the `prompt` value.
- **Missing usageMetadata:** If `response.usageMetadata` is absent or undefined (e.g. on a partial/error response), skip the `logUsage` call — do not insert a row with null token counts.
- **Callers:** `POST /api/leases/ingest` and `POST /api/leases/chat` in `server/index.js` already use `requireAuth`. Pass `req.user.id` as the `userId` argument to all Gemini function calls. The ingestion route is authenticated, so `req.user.id` is available for `ocrPdf` and `extractLeaseData` calls too.

### 4. Admin API endpoints

**`GET /api/admin/usage`** — admin-only (requires `requireAuth` + role check).

Query params:
- `page` (default: 1)
- `limit` (default: 50, max: 500)
- `user_id` — filter by user
- `source` — filter by `'chat'` or `'lease'`
- `model` — filter by model
- `from` — ISO date string (`YYYY-MM-DD`), start of range — backend appends `T00:00:00.000Z`
- `to` — ISO date string (`YYYY-MM-DD`), end of range — backend appends `T23:59:59.999Z` to make the day inclusive
- `q` — substring search on `prompt` text only (not user name; use `user_id` filter to filter by user)

Response shape:
```json
{
  "rows": [
    {
      "id": "...",
      "user_id": "...",
      "display_name": "James Wilson",
      "department": "Finance",
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

Joins `usage_log` with `users` on `user_id` to include `display_name` and `department`.

**`GET /api/admin/usage/models`** — admin-only. Returns `SELECT DISTINCT model FROM usage_log ORDER BY model` as a string array, e.g. `["gemini-2.0-flash", "gpt-4o"]`. Used to populate the model filter dropdown.

**`GET /api/admin/usage/summary`** — admin-only. Always returns stats for the current calendar month (no date range params). Month boundaries are evaluated in UTC. `active_users` = `COUNT(DISTINCT user_id)` from `usage_log` where `created_at` falls within the current calendar month. Returns aggregate stats:
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

1. **Header** — "Usage Log" title, back arrow to `/admin`, small secondary note "Stats refresh every 30s".
2. **Stat cards** (4-up grid): Total Prompts, Total Tokens, Est. Cost (Month), Active Users. Stat cards auto-refresh every 30 seconds via `setInterval`.
3. **Filter bar**: search input (searches prompt text only), user dropdown (populated from `GET /api/admin/users` on mount; shows display_name), model dropdown (populated from `GET /api/admin/usage/models` — a new lightweight endpoint that returns `SELECT DISTINCT model FROM usage_log ORDER BY model`), source dropdown (`All / Chat / Lease`), date range dropdown, Export CSV button.

   **Date range dropdown options:** Today, Last 7 Days, Last 30 Days, This Month, All Time. No custom date picker needed.
4. **Table** with columns:
   - User (avatar initials + display name + department)
   - Date / Time (sortable, default sort: newest first)
   - Prompt (truncated to 2 lines, with a small pill badge below showing the model name — match the existing badge style used in the admin errors table)
   - Tokens (count + mini progress bar relative to max in current page)
   - Est. Cost
5. **Pagination** — page controls, "Showing X–Y of Z entries" label.

**Export CSV:** Client-side. Re-fetches with `limit=500` (the API maximum) and all currently active filters (user, source, model, date range, search query) forwarded, then triggers a `<a download>` browser download. Note: exports are capped at 500 rows — this is an accepted limitation given the demo scope.

### TypeScript types (`src/api/index.ts`)

```ts
interface UsageListParams {
  page?: number;
  limit?: number;
  user_id?: string;
  source?: 'chat' | 'lease';
  model?: string;
  from?: string; // ISO date string
  to?: string;   // ISO date string
  q?: string;
}

interface UsageRow {
  id: string;
  user_id: string;
  display_name: string;
  department: string | null;
  source: 'chat' | 'lease';
  prompt: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  created_at: string;
}

interface UsageListResponse {
  rows: UsageRow[];
  total: number;
  page: number;
  limit: number;
}

interface UsageSummary {
  total_prompts: number;
  total_tokens: number;
  estimated_cost: number;
  active_users: number;
}
```

Add to `admin` namespace in `src/api/index.ts`. All four types (`UsageListParams`, `UsageRow`, `UsageListResponse`, `UsageSummary`) should be exported so `AdminUsagePage.tsx` can import them.

```ts
usage: {
  list: (params?: UsageListParams): Promise<UsageListResponse> => ...,
  summary: (): Promise<UsageSummary> => ...,
}
```

### Navigation (`src/pages/AdminPage.tsx`)

Add a "Usage Log" navigation button alongside the existing "Manage Users" button in the Navigation Buttons section. Links to `/admin/usage`. Uses the `BarChart2` icon from lucide-react.

### Router (`src/App.tsx`)

Add: `<Route path="/admin/usage" element={<AdminUsagePage />} />`

---

## Out of Scope

- Per-user drill-down pages
- Real-time cost alerts or budget thresholds
- Billing integration
- Storing AI response text (only the prompt is stored)
- Export beyond 500 rows
