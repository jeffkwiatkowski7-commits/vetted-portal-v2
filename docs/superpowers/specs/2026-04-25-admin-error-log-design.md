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
  message TEXT NOT NULL,           -- truncated to 2000 chars
  route TEXT,                      -- Express route pattern or background job name; nullable
  stack TEXT,                      -- truncated to 8000 chars
  user_agent TEXT,                 -- client errors only
  count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL,        -- ISO timestamp
  last_seen TEXT NOT NULL,         -- ISO timestamp
  dedup_key TEXT NOT NULL UNIQUE   -- SHA1 of source|message|route
);
CREATE INDEX IF NOT EXISTS idx_error_log_last_seen ON error_log(last_seen);
```

### Helper module — `server/lib/error-log.js`

Single owner of the table. Exports:

- `logError({ source, message, route, stack, userAgent })` — truncates `message`/`stack`, computes `dedup_key`, runs `INSERT ... ON CONFLICT(dedup_key) DO UPDATE SET count = count + 1, last_seen = ?, stack = COALESCE(stack, excluded.stack)`. The `ON CONFLICT` branch does not overwrite `first_seen` or `user_agent`. `stack` is filled lazily — if the first occurrence had no stack (e.g. thrown string), a later occurrence's stack is captured. Never throws (errors during error-logging are swallowed and `console.error`'d).
- `getErrors({ limit = 500 })` — returns rows ordered by `last_seen DESC`.
- `clearErrors()` — `DELETE FROM error_log`.
- `pruneOldErrors()` — `DELETE FROM error_log WHERE last_seen < datetime('now', '-24 hours')`. Also enforces a hard cap of 5000 rows by deleting the oldest beyond that.

`dedup_key` is `sha1(source + '|' + message + '|' + (route ?? ''))`. Hashing avoids a multi-column unique constraint with NULL semantics and keeps the key bounded in length.

### Coverage strategy

The goal is **one row per logical error**, captured at the layer that has the most context. To avoid double-logging, the rule is:

> **Request-bound errors are logged once, by the Express error middleware. Background/non-request errors are logged at the site that catches them.**

Two layers:

**1. `asyncRoute(handler)` wrapper** in `server/index.js`:

```js
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
```

Used to wrap route handlers that currently have **no error handling** or whose `catch` block is just `console.error` + a generic 500 response. Rejected promises then forward to the Express error middleware, which calls `logError` with `route = req.route?.path ?? req.path` (route pattern preferred — `/api/chats/:id/messages`, not `/api/chats/abc-123/messages` — so dedup collapses across resource IDs).

**Do NOT wrap**: routes whose existing `catch` shapes the response (custom 400 messages, 404s, validation errors, auth failures). Those keep their `try/catch`. They also don't need `logError` — those are intentional, client-facing responses, not the kind of errors we're trying to surface.

**2. Explicit `logError()` calls** are reserved for **background work that has no request to bubble up to**:

- `server/lib/mcp-manager.js` — server start failures, lazy startup failures, idle reaper errors (these run on timers/spawn callbacks, not in a request context)
- `server/lease-routes.js` — SSE ingestion error events that are caught and converted to `event: error` SSE frames (the response has already been streamed, so the error middleware can't catch them)
- Any `setInterval` / `setTimeout` callbacks with their own catches
- The prune interval itself

Lib functions called from request handlers (`gemini.js`, `claude-direct.js`, `rag.js`, `embeddings.js`, `gcs.js`, `firestore.js`) **rethrow** instead of swallowing — the route layer + error middleware logs them with request context. Existing `console.error` calls in those libs can stay (useful for terminal debugging) but should not also call `logError`. The exception is when a lib function is invoked from a non-request context (e.g. background ingestion) — those callers handle logging.

For background `logError` calls, `route` is the operation name: `'mcp:start:mcp-memory'`, `'mcp:reaper'`, `'lease:ingest:sse'`, `'errorlog:prune'`.

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

- Columns: `Last seen | Count | Source | Message | Route`
- Sort: `last_seen DESC` (server-side)
- Count badge in the section header reflects total rows returned
- Auto-refresh every 30s using `setInterval` inside a `useEffect` (cleared on unmount). Polling pauses while `document.hidden` is true and resumes on `visibilitychange`
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
- **Stack traces** — capped at 8000 chars. First occurrence's stack wins, but if it was missing the next non-null stack is captured (`COALESCE` in the upsert).
- **Concurrent inserts of the same error** — `INSERT ... ON CONFLICT DO UPDATE` is atomic in SQLite (`sql.js` runs single-threaded), so counts are correct under load.
- **Errors during error-logging** — the helper swallows its own exceptions and falls back to `console.error`, so a broken DB cannot take down a request path.
- **Migration** — `CREATE TABLE IF NOT EXISTS` runs at startup; no data migration needed since the current buffer is in-memory.
- **Persistence prerequisite** — `sql.js` is in-memory WASM; rows survive restarts only if `server/database.js` writes the DB file after each transaction (or close to it). The implementation pass must verify this — if the existing save policy is "on shutdown only," `logError` needs to trigger a save (or piggyback on whatever write policy the rest of the app uses) for the 24h-retention goal to hold.
- **Resource-ID dedup** — using `req.route?.path` (the Express route pattern) instead of `req.path` is what makes errors in `/api/chats/:id/messages` collapse across different chat IDs. Falling back to `req.path` when the route pattern isn't available is acceptable but degrades dedup quality.
- **VM bump version** — sidebar version number bumped per project convention.

## Files touched

- `server/database.js` — add table + index
- `server/lib/error-log.js` — new module
- `server/index.js` — replace ring buffer + `pushError`; add `asyncRoute` wrapper; add `DELETE /api/admin/errors`; register prune interval; rewrite `/api/admin/errors` and `/api/admin/client-errors` to use `logError`; wrap routes that currently lack error handling (or whose catch is just `console.error` + 500) with `asyncRoute(...)`; leave routes with response-shaping catches alone
- `server/lib/mcp-manager.js` — add `logError` for background failures (server start, idle reaper, lazy spawn callbacks)
- `server/lease-routes.js` — add `logError` in SSE error-frame catches where the response stream has already started
- `server/lib/gemini.js`, `server/lib/claude-direct.js`, `server/lib/rag.js`, `server/lib/embeddings.js`, `server/lib/gcs.js`, `server/lib/firestore.js` — **no `logError` calls added**. These rethrow from request-bound paths so the error middleware logs them with full route context. Existing `console.error` lines may stay.
- `src/api/index.ts` — add `clearErrors`
- `src/pages/AdminPage.tsx` — column changes, auto-refresh, expand-on-click, clear button
- Sidebar version bump

## Out of scope (future work)

- Filter/search UI
- Per-user error views
- 4xx/5xx response capture
- External alerting (Slack, email, Sentry)
