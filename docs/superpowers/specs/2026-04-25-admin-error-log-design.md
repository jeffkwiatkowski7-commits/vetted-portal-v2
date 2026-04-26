# Admin Error Log — Design

**Date:** 2026-04-25
**Status:** Approved for implementation

## Problem

The admin page's "Active Errors" panel shows almost nothing in practice, even when the app is clearly hitting errors (failed AI calls, MCP tool failures, lease ingestion problems, etc.). Two reasons:

1. **Coverage is too narrow.** The in-memory ring buffer is only fed by the Express error middleware, `uncaughtException`, `unhandledRejection`, and a `/api/admin/client-errors` endpoint. Most async route handlers in `server/index.js` and `server/lease-routes.js` use `try/catch` and return a 500 directly, so they never call `next(err)` and never reach the buffer. Errors in `server/lib/*` (Gemini, Claude direct, MCP, RAG, GCS, Firestore) are typically logged with `console.error` and swallowed.
2. **No retention or dedup.** The buffer is a 100-slot in-memory array. A hot-loop error fills it in seconds and pushes everything else out. There is no time window. Server restarts (including pm2 restarts caused by the very errors we want to see) wipe it.

The user wants to see what's happening — especially errors — over the last 24 hours, with recurring errors collapsed so the log doesn't drown in duplicates.

## Goals

- Capture errors from route handlers and AI/integration backends, not just unhandled exceptions
- Deduplicate so a recurring error shows as a single row with a count and timestamps
- Retain for 24 hours, surviving server restarts
- Surface clearly in the admin UI with auto-refresh and a way to drill into stack traces

## Non-goals

- Filters or search in the UI (table is bounded by 24h dedup; can be added later)
- Capturing 4xx/5xx response codes as errors
- Monkey-patching `console.error`
- Email/Slack alerting
- Distributed log aggregation (single-VM deployment)

## Architecture

### Storage

New SQLite table `error_log` defined in `server/database.js`:

```sql
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,            -- 'server' | 'client'
  level TEXT NOT NULL,             -- 'error' | 'warn'
  message TEXT NOT NULL,           -- truncated to 2000 chars
  route TEXT,                      -- request path or background job name; nullable
  stack TEXT,                      -- truncated to 8000 chars; first occurrence only
  user_agent TEXT,                 -- client errors only
  count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL,        -- ISO timestamp
  last_seen TEXT NOT NULL,         -- ISO timestamp
  dedup_key TEXT NOT NULL UNIQUE   -- SHA1 of source|level|message|route
);
CREATE INDEX IF NOT EXISTS idx_error_log_last_seen ON error_log(last_seen);
```

### Helper module — `server/lib/error-log.js`

Single owner of the table. Exports:

- `logError({ source, level, message, route, stack, userAgent })` — truncates `message`/`stack`, computes `dedup_key`, runs `INSERT ... ON CONFLICT(dedup_key) DO UPDATE SET count = count + 1, last_seen = ?`. The `ON CONFLICT` branch does not overwrite `stack`, `first_seen`, or `user_agent` — first occurrence keeps its diagnostic context. Never throws (errors during error-logging are swallowed and `console.error`'d).
- `getErrors({ limit = 500 })` — returns rows ordered by `last_seen DESC`.
- `clearErrors()` — `DELETE FROM error_log`.
- `pruneOldErrors()` — `DELETE FROM error_log WHERE last_seen < datetime('now', '-24 hours')`.

`dedup_key` is `sha1(source + '|' + level + '|' + message + '|' + (route ?? ''))`. Hashing avoids a multi-column unique constraint with NULL semantics and keeps the key bounded in length.

### Coverage strategy

Two layers:

**1. `asyncRoute(handler)` wrapper** in `server/index.js`:

```js
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
```

Async route handlers that currently use `try/catch` to return 500s can opt in by being wrapped with `asyncRoute(...)`; rejected promises then forward to the existing Express error middleware, which already calls `logError`. This is the backstop — it catches anything that wasn't explicitly logged.

**2. Explicit `logError()` calls** in catch blocks of:

- `server/lib/gemini.js` — `ocrPdf`, `extractLeaseData`, `chatWithLeases`, `chatCrossPortfolio`, `chatWithDocuments`
- `server/lib/claude-direct.js` — `chatWithDocuments` and tool dispatch failures
- `server/lib/mcp-manager.js` — server start failures, tool listing failures, tool invocation failures
- `server/lib/rag.js`, `server/lib/embeddings.js`, `server/lib/gcs.js`, `server/lib/firestore.js` — every catch that currently `console.error`s and continues
- `server/lease-routes.js` — SSE ingestion and chat error events

Implementation pass: grep for `catch` in `server/lib/**` and `server/lease-routes.js` and add a `logError({ source: 'server', level: 'error', message: err.message, route: '<context>', stack: err.stack })` to each block that previously only logged or silently continued. The `route` field is set to the function/operation name for background work (e.g. `'mcp:start:mcp-memory'`, `'gemini:ocrPdf'`).

### Existing capture sites

The four current `pushError` sites in `server/index.js` (Express error middleware, `uncaughtException`, `unhandledRejection`, client-error endpoint) are rewritten to call `logError`. The in-memory `errorLog` array, `errorCounter`, `pushError`, and `ERROR_LOG_MAX` constant are removed.

### Retention

`setInterval(pruneOldErrors, 60 * 60 * 1000)` registered at startup. Also called once synchronously at startup so a long-down server clears stale rows on boot.

### Endpoints

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/api/admin/errors` | admin | Returns `{ errors: [...] }` ordered by `last_seen DESC`, default limit 500. Rows include all columns. |
| DELETE | `/api/admin/errors` | admin | Calls `clearErrors()`, returns `{ ok: true }`. |
| POST | `/api/admin/client-errors` | auth | Unchanged shape `{ message, stack, url, userAgent }`; writes via `logError`. |

## Admin UI — `src/pages/AdminPage.tsx`

The "Active Errors" section gets these changes:

- Columns: `Last seen | Count | Source | Level | Message | Route`
- Sort: `last_seen DESC` (server-side)
- Count badge in the section header reflects total rows returned
- Auto-refresh every 30s using `setInterval` inside a `useEffect` (cleared on unmount)
- Row click expands an inline panel showing: full message, stack trace (monospace), first-seen timestamp, user agent (if present)
- "Clear all" button next to the section header. Confirms via a dialog/`window.confirm`, then calls `DELETE /api/admin/errors` and refreshes
- Empty state unchanged ("No errors detected")

`Count` column renders as a small badge — bold red when `count >= 10`, neutral otherwise — so recurring problems stand out.

## API client — `src/api/index.ts`

Add `api.admin.clearErrors()` calling `DELETE /api/admin/errors`.

## Data flow

1. Something throws (route handler, AI backend, MCP tool, ingestion job, client-side exception)
2. Caught by:
   - explicit `logError` in a `catch` block, or
   - the `asyncRoute` wrapper → Express error middleware → `logError`, or
   - `uncaughtException` / `unhandledRejection` → `logError`
3. `logError` upserts into `error_log` keyed by `dedup_key` — first hit inserts, subsequent hits bump `count` and `last_seen`
4. Admin page polls `GET /api/admin/errors` every 30s and re-renders the table
5. Hourly `pruneOldErrors` deletes rows where `last_seen` is older than 24h

## Edge cases

- **Long messages** — truncated to 2000 chars *before* hashing, so a runaway message can't bloat a row and dedup is stable across truncation.
- **Stack traces** — capped at 8000 chars; only stored on the first occurrence of a dedup_key.
- **Concurrent inserts of the same error** — `INSERT ... ON CONFLICT DO UPDATE` is atomic in SQLite (`sql.js` runs single-threaded), so counts are correct under load.
- **Errors during error-logging** — the helper swallows its own exceptions and falls back to `console.error`, so a broken DB cannot take down a request path.
- **Migration** — `CREATE TABLE IF NOT EXISTS` runs at startup; no data migration needed since the current buffer is in-memory.
- **VM bump version** — sidebar version number bumped per project convention.

## Files touched

- `server/database.js` — add table + index
- `server/lib/error-log.js` — new module
- `server/index.js` — replace ring buffer + `pushError`; add `asyncRoute` wrapper; add `DELETE /api/admin/errors`; register prune interval; rewrite `/api/admin/errors` and `/api/admin/client-errors` to use `logError`; convert risky async routes to `asyncRoute(...)` wrapping
- `server/lib/gemini.js`, `server/lib/claude-direct.js`, `server/lib/mcp-manager.js`, `server/lib/rag.js`, `server/lib/embeddings.js`, `server/lib/gcs.js`, `server/lib/firestore.js`, `server/lease-routes.js` — add `logError` calls in catch blocks
- `src/api/index.ts` — add `clearErrors`
- `src/pages/AdminPage.tsx` — column changes, auto-refresh, expand-on-click, clear button
- Sidebar version bump

## Out of scope (future work)

- Filter/search UI
- Per-user error views
- 4xx/5xx response capture
- External alerting (Slack, email, Sentry)
