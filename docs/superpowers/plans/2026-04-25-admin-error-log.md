# Admin Error Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 100-slot in-memory error ring buffer with a SQLite-backed, deduplicated, 24h-retained error log, and broaden coverage so route-handler and SSE/background errors actually show up in the admin UI.

**Architecture:** New `error_log` table owned by a thin helper module `server/lib/error-log.js`. Request-bound errors flow through an `asyncRoute` wrapper to the existing Express error middleware (single logging point with route-pattern context). Background/SSE-after-flush sites call `logError` directly. Hourly prune + 5000-row cap enforces retention. Admin UI reads `last_seen DESC`, polls every 30s (paused when tab hidden), supports row-expand for stack traces and "Clear all".

**Tech Stack:** Node 18+, Express, sql.js (in-memory SQLite with auto-save via `dbRun`), React 18, TypeScript, Tailwind. No test runner is configured for this project — verification is via `npm run dev` + curl + browser.

**Spec:** `docs/superpowers/specs/2026-04-25-admin-error-log-design.md`

---

## Pre-flight notes

- **No test runner:** CLAUDE.md states "No test runner or linter is configured." TDD's "write failing test first" steps are replaced with **manual verification steps** (curl, dev-server smoke tests, browser checks). Each task ends with explicit verification commands and expected output.
- **Persistence is already covered:** [server/database.js:471-479](server/database.js#L471-L479) — `dbRun` calls `saveDatabase(db)` after every mutation, so rows survive restarts. No extra save logic is needed.
- **Branch:** Work on a feature branch (e.g. `feat/admin-error-log`). Commit after each task.
- **Sidebar version:** Bump `v1.8.5` → `v1.9.0` at [src/components/sidebar/Sidebar.tsx:211](src/components/sidebar/Sidebar.tsx#L211) at the end (Task 8), per project convention.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/database.js` | Modify | Add `error_log` table + index in the main schema-creation block |
| `server/lib/error-log.js` | Create | Sole owner of `error_log` table — `logError`, `getErrors`, `clearErrors`, `pruneOldErrors` |
| `server/index.js` | Modify | Remove ring buffer; add `asyncRoute` wrapper; rewrite error middleware + `uncaughtException` + `unhandledRejection` + `/api/admin/client-errors` to use `logError`; add `DELETE /api/admin/errors`; register prune interval + initial prune; wrap risky async routes with `asyncRoute` |
| `server/lease-routes.js` | Modify | Add `logError` calls in two SSE catches where the response stream has already started (ingest line 135, chat line 298) |
| `src/api/index.ts` | Modify | Add `admin.clearErrors()` |
| `src/pages/AdminPage.tsx` | Modify | Drop `Level` column, add `Last seen` + `Count`, row-click expand, "Clear all" button, pause polling when `document.hidden` |
| `src/components/sidebar/Sidebar.tsx` | Modify | Bump version `v1.8.5` → `v1.9.0` |

---

## Task 1: Add `error_log` table to schema

**Files:**
- Modify: `server/database.js` (add inside the main schema-creation block before the closing backtick at line 325)

- [ ] **Step 1: Add table + index**

In [server/database.js](server/database.js), find the line `CREATE TABLE IF NOT EXISTS mcp_servers (` (around line 313) and add the following block **immediately before** it (so it lives inside the same SQL string passed to the schema-creation call):

```sql
    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      route TEXT,
      stack TEXT,
      user_agent TEXT,
      count INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      dedup_key TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_error_log_last_seen ON error_log(last_seen);
```

- [ ] **Step 2: Verify the schema applies cleanly**

Run:
```bash
rm -f data/vetted_portal.db && npm run dev:backend
```
Wait until you see `Server running on port 3000`, then Ctrl-C.

Then verify the table exists:
```bash
node --input-type=module -e "import('sql.js').then(async ({default: initSqlJs}) => { const SQL = await initSqlJs(); const fs = await import('fs'); const db = new SQL.Database(fs.readFileSync('./data/vetted_portal.db')); const stmt = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='error_log'\"); stmt.step(); console.log(stmt.getAsObject()); stmt.free(); });"
```
Expected: output contains `{ name: 'error_log' }`.

- [ ] **Step 3: Commit**

```bash
git add server/database.js
git commit -m "feat(error-log): add error_log table to schema"
```

---

## Task 2: Create the `error-log.js` helper module

**Files:**
- Create: `server/lib/error-log.js`

- [ ] **Step 1: Write the helper module**

Create [server/lib/error-log.js](server/lib/error-log.js):

```js
import crypto from 'crypto';
import { dbRun, dbAll, dbGet, getDatabase } from '../database.js';

const MESSAGE_MAX = 2000;
const STACK_MAX = 8000;
const ROW_CAP = 5000;

function truncate(value, max) {
  if (value == null) return null;
  const str = String(value);
  return str.length > max ? str.slice(0, max) : str;
}

function dedupKey(source, message, route) {
  return crypto
    .createHash('sha1')
    .update(`${source}|${message}|${route ?? ''}`)
    .digest('hex');
}

/**
 * Insert or upsert an error row. Never throws.
 *  - source: 'server' | 'client'
 *  - message: required (truncated to 2000)
 *  - route: Express route pattern or background-job name (nullable)
 *  - stack: optional (truncated to 8000); filled lazily via COALESCE
 *  - userAgent: optional (client errors only); first occurrence wins
 */
export function logError({ source, message, route, stack, userAgent }) {
  try {
    const db = getDatabase();
    if (!db) return;

    const safeMessage = truncate(message ?? 'Unknown error', MESSAGE_MAX);
    const safeStack = truncate(stack, STACK_MAX);
    const safeRoute = route ?? null;
    const safeUserAgent = userAgent ?? null;
    const key = dedupKey(source, safeMessage, safeRoute);
    const now = new Date().toISOString();

    dbRun(
      db,
      `
      INSERT INTO error_log (source, message, route, stack, user_agent, count, first_seen, last_seen, dedup_key)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(dedup_key) DO UPDATE SET
        count = count + 1,
        last_seen = excluded.last_seen,
        stack = COALESCE(error_log.stack, excluded.stack)
      `,
      [source, safeMessage, safeRoute, safeStack, safeUserAgent, now, now, key]
    );
  } catch (err) {
    // Never let error-logging break a request path
    // eslint-disable-next-line no-console
    console.error('[error-log] logError failed:', err);
  }
}

export function getErrors({ limit = 500 } = {}) {
  const db = getDatabase();
  if (!db) return [];
  return dbAll(
    db,
    `SELECT id, source, message, route, stack, user_agent, count, first_seen, last_seen
     FROM error_log
     ORDER BY last_seen DESC
     LIMIT ?`,
    [limit]
  );
}

export function clearErrors() {
  const db = getDatabase();
  if (!db) return;
  dbRun(db, `DELETE FROM error_log`, []);
}

/**
 * Delete rows older than 24h, then enforce a hard cap of ROW_CAP rows
 * (deletes the oldest beyond the cap). Never throws.
 */
export function pruneOldErrors() {
  try {
    const db = getDatabase();
    if (!db) return;

    dbRun(db, `DELETE FROM error_log WHERE last_seen < datetime('now', '-24 hours')`, []);

    const countRow = dbGet(db, `SELECT COUNT(*) AS c FROM error_log`, []);
    const total = countRow?.c ?? 0;
    if (total > ROW_CAP) {
      const overflow = total - ROW_CAP;
      dbRun(
        db,
        `DELETE FROM error_log
         WHERE id IN (SELECT id FROM error_log ORDER BY last_seen ASC LIMIT ?)`,
        [overflow]
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[error-log] pruneOldErrors failed:', err);
    logError({
      source: 'server',
      message: `errorlog:prune failed: ${err?.message ?? err}`,
      route: 'errorlog:prune',
      stack: err?.stack,
    });
  }
}
```

- [ ] **Step 2: Sanity-check imports resolve**

Run:
```bash
node --input-type=module -e "import('./server/lib/error-log.js').then(m => console.log(Object.keys(m)));"
```
Expected: `[ 'logError', 'getErrors', 'clearErrors', 'pruneOldErrors' ]`

- [ ] **Step 3: Smoke test — direct insert + dedup**

```bash
node --input-type=module -e "
import { initializeDatabase } from './server/database.js';
import { logError, getErrors, clearErrors } from './server/lib/error-log.js';
await initializeDatabase();
clearErrors();
logError({ source: 'server', message: 'boom', route: '/api/test' });
logError({ source: 'server', message: 'boom', route: '/api/test' });
logError({ source: 'server', message: 'different', route: '/api/test' });
const rows = getErrors();
console.log('rows:', rows.length, 'first count:', rows.find(r => r.message === 'boom')?.count);
"
```
Expected: `rows: 2 first count: 2`

- [ ] **Step 4: Smoke test — prune row cap**

(Skip the 24h test since rows are fresh. Verify the cap enforcement code at least imports and runs without throwing.)

```bash
node --input-type=module -e "
import { initializeDatabase } from './server/database.js';
import { pruneOldErrors, getErrors } from './server/lib/error-log.js';
await initializeDatabase();
pruneOldErrors();
console.log('post-prune rows:', getErrors().length);
"
```
Expected: prints a number, no exception. (Recently-inserted rows from Step 3 should remain; nothing is older than 24h yet.)

- [ ] **Step 5: Commit**

```bash
git add server/lib/error-log.js
git commit -m "feat(error-log): add error-log helper module"
```

---

## Task 3: Replace ring buffer in `server/index.js`

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add import + remove ring buffer**

At the top of [server/index.js](server/index.js), add this import alongside the other `./lib/*` imports (around line 22):

```js
import { logError, getErrors, clearErrors, pruneOldErrors } from './lib/error-log.js';
```

Then **delete** lines 32-40 (the in-memory error buffer):

```js
// In-memory error ring buffer
const errorLog = [];
const ERROR_LOG_MAX = 100;
let errorCounter = 0;

function pushError(entry) {
  errorLog.unshift({ id: ++errorCounter, ...entry });
  if (errorLog.length > ERROR_LOG_MAX) errorLog.length = ERROR_LOG_MAX;
}
```

- [ ] **Step 2: Add `asyncRoute` helper**

Just below the `app` / `PORT` / `NODE_ENV` declarations (where the deleted ring buffer used to be, around line 32), add:

```js
// Wrap async route handlers so rejected promises forward to the error middleware.
// Use this for handlers that DON'T have a custom try/catch shaping the response.
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
```

- [ ] **Step 3: Rewrite the error middleware**

Find the error middleware at [server/index.js:2609-2622](server/index.js#L2609-L2622):

```js
app.use((err, req, res, next) => {
  console.error('Error:', err);
  pushError({
    timestamp: new Date().toISOString(),
    source: 'server',
    level: 'error',
    message: err.message || 'Internal server error',
    stack: err.stack,
    route: req.path,
  });
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
});
```

Replace it with:

```js
app.use((err, req, res, next) => {
  console.error('Error:', err);
  logError({
    source: 'server',
    message: err.message || 'Internal server error',
    route: req.route?.path ?? req.path,
    stack: err.stack,
  });
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
});
```

- [ ] **Step 4: Rewrite `uncaughtException` and `unhandledRejection` handlers**

Find at [server/index.js:2628-2645](server/index.js#L2628-L2645):

```js
process.on('uncaughtException', (err) => {
  pushError({
    timestamp: new Date().toISOString(),
    source: 'server',
    level: 'error',
    message: err.message,
    stack: err.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  pushError({
    timestamp: new Date().toISOString(),
    source: 'server',
    level: 'error',
    message: String(reason),
  });
});
```

Replace with:

```js
process.on('uncaughtException', (err) => {
  logError({
    source: 'server',
    message: err.message || String(err),
    route: 'process:uncaughtException',
    stack: err.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  logError({
    source: 'server',
    message: reason?.message ?? String(reason),
    route: 'process:unhandledRejection',
    stack: reason?.stack,
  });
});
```

- [ ] **Step 5: Rewrite `GET /api/admin/errors`**

Find at [server/index.js:2225-2227](server/index.js#L2225-L2227):

```js
app.get('/api/admin/errors', requireAuth, requireAdmin, (req, res) => {
  res.json({ errors: errorLog });
});
```

Replace with:

```js
app.get('/api/admin/errors', requireAuth, requireAdmin, (req, res) => {
  res.json({ errors: getErrors({ limit: 500 }) });
});
```

- [ ] **Step 6: Add `DELETE /api/admin/errors`**

Immediately after the GET handler from Step 5, add:

```js
app.delete('/api/admin/errors', requireAuth, requireAdmin, (req, res) => {
  clearErrors();
  res.json({ ok: true });
});
```

- [ ] **Step 7: Rewrite `POST /api/admin/client-errors`**

Find at [server/index.js:2229-2241](server/index.js#L2229-L2241):

```js
app.post('/api/admin/client-errors', requireAuth, (req, res) => {
  const { message, stack, url, userAgent } = req.body;
  pushError({
    timestamp: new Date().toISOString(),
    source: 'client',
    level: 'error',
    message: message || 'Unknown client error',
    stack,
    route: url,
    userAgent,
  });
  res.json({ ok: true });
});
```

Replace with:

```js
app.post('/api/admin/client-errors', requireAuth, (req, res) => {
  const { message, stack, url, userAgent } = req.body || {};
  logError({
    source: 'client',
    message: message || 'Unknown client error',
    route: url,
    stack,
    userAgent,
  });
  res.json({ ok: true });
});
```

- [ ] **Step 8: Register prune interval + initial prune**

Find the `app.listen(PORT, ...)` call at [server/index.js:2647](server/index.js#L2647). Add the prune setup **immediately above** it:

```js
// Prune error_log every hour; also run once at startup so a long-down server clears stale rows on boot.
pruneOldErrors();
setInterval(pruneOldErrors, 60 * 60 * 1000);
```

- [ ] **Step 9: Verify no remaining `pushError` / `errorLog` references**

```bash
grep -n "pushError\|errorLog\|errorCounter\|ERROR_LOG_MAX" /Users/jeffkwiatkowski/vetted_portal_v2/server/index.js
```
Expected: **no output** (all references removed).

- [ ] **Step 10: Smoke test — round-trip via API**

In one terminal:
```bash
npm run dev:backend
```

In another, find the seeded admin user id:
```bash
node --input-type=module -e "
import { initializeDatabase, dbGet } from './server/database.js';
const db = await initializeDatabase();
console.log(dbGet(db, \"SELECT id FROM users WHERE email='admin@vetted.com'\"));
"
```

Set `ADMIN_ID` from that output, then:

```bash
ADMIN_ID="<paste id>"

# Submit a fake client error
curl -s -X POST http://localhost:3000/api/admin/client-errors \
  -H "X-User-Id: $ADMIN_ID" -H "Content-Type: application/json" \
  -d '{"message":"hello from curl","url":"/test","stack":"at line 1"}'

# Submit it again to trigger dedup
curl -s -X POST http://localhost:3000/api/admin/client-errors \
  -H "X-User-Id: $ADMIN_ID" -H "Content-Type: application/json" \
  -d '{"message":"hello from curl","url":"/test","stack":"at line 1"}'

# List
curl -s -H "X-User-Id: $ADMIN_ID" http://localhost:3000/api/admin/errors | python3 -m json.tool | head -20
```
Expected: one row with `"count": 2`, `"message": "hello from curl"`, `"route": "/test"`, `"source": "client"`.

- [ ] **Step 11: Smoke test — DELETE clears**

```bash
curl -s -X DELETE -H "X-User-Id: $ADMIN_ID" http://localhost:3000/api/admin/errors
curl -s -H "X-User-Id: $ADMIN_ID" http://localhost:3000/api/admin/errors
```
Expected first call: `{"ok":true}`. Second call: `{"errors":[]}`.

Stop the dev server (Ctrl-C).

- [ ] **Step 12: Commit**

```bash
git add server/index.js
git commit -m "feat(error-log): replace ring buffer with sqlite-backed log"
```

---

## Task 4: Wrap risky async routes with `asyncRoute`

**Goal:** Catch errors that currently die silently in async route handlers — i.e. routes whose only error handling is `console.error` + a generic 500. Routes whose `catch` shapes a meaningful response (400, 404, custom messages) are left alone.

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Identify candidate routes**

Run:
```bash
grep -nE "^app\.(get|post|put|delete|patch)\b" /Users/jeffkwiatkowski/vetted_portal_v2/server/index.js | head -80
```

For each route, look at its `catch` block. Wrap with `asyncRoute(...)` **only if** the catch block looks like one of these:
- `catch (err) { console.error(...); res.status(500).json({ error: err.message }); }`
- No try/catch at all on an async handler
- `catch (e) { res.status(500).json({ error: 'Something went wrong' }); }` (generic 500)

**Do NOT wrap** if the catch:
- Returns 400/404/403 with a specific message
- Branches on error type (e.g. `if (err.code === 'ENOENT')`)
- Cleans up resources (closes streams, deletes temp files)
- Sends a partial-response error event (SSE)

For the routes you wrap, **also remove** the now-redundant try/catch — `asyncRoute` will forward rejections to the error middleware. Keep `try/finally` if there's cleanup.

- [ ] **Step 2: Apply wrapping route-by-route**

For each candidate, the transform is:

**Before:**
```js
app.post('/api/foo', requireAuth, async (req, res) => {
  try {
    const result = await doStuff();
    res.json(result);
  } catch (err) {
    console.error('foo failed:', err);
    res.status(500).json({ error: err.message });
  }
});
```

**After:**
```js
app.post('/api/foo', requireAuth, asyncRoute(async (req, res) => {
  const result = await doStuff();
  res.json(result);
}));
```

Apply this transform conservatively — only to routes where the catch is purely `console.error + 500`. **When in doubt, leave it.** False positives regress visible error messages; false negatives just mean the error still slips through (which is the status quo).

- [ ] **Step 3: Verify the dev server still boots**

```bash
npm run dev:backend
```
Expected: `Server running on port 3000`. Hit Ctrl-C.

- [ ] **Step 4: Smoke test — trigger a real error and confirm it's logged**

Start the server with `npm run dev:backend`. With your `$ADMIN_ID` set from Task 3, hit one of the wrapped routes with bad input until it 500s. (For example, an admin endpoint that takes a JSON body — send malformed data, or hit it with a missing required field.)

After triggering, query the log:
```bash
curl -s -H "X-User-Id: $ADMIN_ID" http://localhost:3000/api/admin/errors | python3 -m json.tool | head -30
```
Expected: at least one `source: "server"` row with the route pattern as `route` (e.g. `/api/projects/:id`, **not** `/api/projects/abc-123`).

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(error-log): wrap risky async routes with asyncRoute"
```

---

## Task 5: Add `logError` to SSE catches in `lease-routes.js`

**Goal:** Two SSE handlers stream the response and catch errors locally to emit an `event: error` SSE frame. Because the response has already been written to, the Express error middleware can't see them — they need explicit `logError` calls.

**Files:**
- Modify: `server/lease-routes.js`

- [ ] **Step 1: Add the import**

At the top of [server/lease-routes.js](server/lease-routes.js), add (next to other imports):

```js
import { logError } from './lib/error-log.js';
```

- [ ] **Step 2: Update the ingest catch (around line 135)**

Find:
```js
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    emit(`ERROR: ${message}`, "error");
    res.write(sseEvent("error", { message }));
  }
```

Replace with:
```js
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    emit(`ERROR: ${message}`, "error");
    res.write(sseEvent("error", { message }));
    logError({
      source: 'server',
      message,
      route: 'lease:ingest:sse',
      stack: error?.stack,
    });
  }
```

- [ ] **Step 3: Update the chat catch (around line 298)**

Find:
```js
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    addLog("chat", `ERROR: ${msg}`, "error");
    res.write(sseEvent("error", { message: msg }));
  }
```

Replace with:
```js
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    addLog("chat", `ERROR: ${msg}`, "error");
    res.write(sseEvent("error", { message: msg }));
    logError({
      source: 'server',
      message: msg,
      route: 'lease:chat:sse',
      stack: error?.stack,
    });
  }
```

- [ ] **Step 4: Verify the file still parses**

```bash
node --check /Users/jeffkwiatkowski/vetted_portal_v2/server/lease-routes.js
```
Expected: no output (clean parse).

- [ ] **Step 5: Commit**

```bash
git add server/lease-routes.js
git commit -m "feat(error-log): log SSE errors in lease-routes after response flush"
```

---

## Task 6: Add `clearErrors` to the API client

**Files:**
- Modify: `src/api/index.ts`

- [ ] **Step 1: Add the method**

In [src/api/index.ts](src/api/index.ts), find the line:
```ts
  errors: () => request('/admin/errors').then((d: any) => d.errors || []),
```
(around line 272).

Add immediately below it:
```ts
  clearErrors: () => request('/admin/errors', { method: 'DELETE' }),
```

- [ ] **Step 2: Verify TS compiles**

```bash
npm run build 2>&1 | tail -20
```
Expected: build succeeds. (If `tsc` errors fire, the most likely cause is a typo — re-check the line.)

- [ ] **Step 3: Commit**

```bash
git add src/api/index.ts
git commit -m "feat(error-log): add admin.clearErrors API client"
```

---

## Task 7: Update `AdminPage.tsx` — columns, expand, clear button

**Files:**
- Modify: `src/pages/AdminPage.tsx`

- [ ] **Step 1: Add new state for expanded row + import Trash icon**

In [src/pages/AdminPage.tsx](src/pages/AdminPage.tsx), find the lucide-react import at line 5:
```ts
import { Wrench, Users, Zap, AlertCircle, CheckCircle, CheckCircle2, BarChart2, MessageSquare } from 'lucide-react';
```
Replace with:
```ts
import { Wrench, Users, Zap, AlertCircle, CheckCircle, CheckCircle2, BarChart2, MessageSquare, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
```

Find the state declarations (lines 26-29):
```ts
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<any[]>([]);
```

Replace with:
```ts
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<any[]>([]);
  const [expandedErrorId, setExpandedErrorId] = useState<number | null>(null);
```

- [ ] **Step 2: Pause polling when tab hidden**

Find the `useEffect` block at lines 48-56:
```ts
  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'super_admin') {
      navigate('/');
      return;
    }
    loadAdminData();
    const interval = setInterval(loadAdminData, 30000);
    return () => clearInterval(interval);
  }, [user, navigate]);
```

Replace with:
```ts
  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'super_admin') {
      navigate('/');
      return;
    }
    loadAdminData();
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(loadAdminData, 30000);
    };
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    if (!document.hidden) startPolling();
    const onVisibility = () => {
      if (document.hidden) stopPolling();
      else { loadAdminData(); startPolling(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, navigate]);
```

- [ ] **Step 3: Add `handleClearErrors` helper**

Just below the `formatRelativeTime` function (around line 102), add:

```ts
  const handleClearErrors = async () => {
    if (!window.confirm('Clear all errors? This cannot be undone.')) return;
    try {
      await api.admin.clearErrors();
      setExpandedErrorId(null);
      await loadAdminData();
      addToast({ type: 'success', title: 'Errors cleared' });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to clear errors' });
    }
  };
```

- [ ] **Step 4: Replace the Active Errors section**

Find lines 153-219 (the entire `{/* Active Errors */}` block). Replace it with:

```tsx
        {/* Active Errors */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium text-vetted-primary">Active Errors</h2>
              {errors.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-medium">
                  {errors.length}
                </span>
              )}
            </div>
            {errors.length > 0 && (
              <button
                onClick={handleClearErrors}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-vetted-text-secondary hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              >
                <Trash2 size={14} />
                Clear all
              </button>
            )}
          </div>

          {errors.length === 0 ? (
            <div className="card flex items-center gap-3 text-vetted-success">
              <CheckCircle2 size={20} />
              <span className="text-sm">No errors detected</span>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-vetted-surface border-b border-vetted-border sticky top-0">
                    <tr>
                      <th className="w-6 px-2 py-2"></th>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Last seen</th>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Count</th>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Source</th>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Message</th>
                      <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Route</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map((err) => {
                      const isExpanded = expandedErrorId === err.id;
                      return (
                        <React.Fragment key={err.id}>
                          <tr
                            onClick={() => setExpandedErrorId(isExpanded ? null : err.id)}
                            className="border-b border-vetted-border last:border-0 hover:bg-vetted-surface/50 cursor-pointer"
                          >
                            <td className="px-2 py-2 text-vetted-text-secondary">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </td>
                            <td className="px-4 py-2 text-vetted-text-secondary whitespace-nowrap" title={err.last_seen}>
                              {formatRelativeTime(err.last_seen)}
                            </td>
                            <td className="px-4 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                err.count >= 10
                                  ? 'bg-red-100 text-red-700 font-bold'
                                  : 'bg-gray-100 text-gray-700'
                              }`}>
                                {err.count}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                err.source === 'server'
                                  ? 'bg-gray-200 text-gray-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}>
                                {err.source}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-vetted-primary max-w-md" title={err.message}>
                              {err.message?.length > 100 ? err.message.slice(0, 100) + '…' : err.message}
                            </td>
                            <td className="px-4 py-2 text-vetted-text-secondary">
                              {err.route || '—'}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-vetted-surface/30 border-b border-vetted-border last:border-0">
                              <td></td>
                              <td colSpan={5} className="px-4 py-3 space-y-2">
                                <div className="text-xs text-vetted-text-secondary">
                                  First seen: <span className="text-vetted-primary">{err.first_seen}</span>
                                  {err.user_agent && (
                                    <> · UA: <span className="text-vetted-primary">{err.user_agent}</span></>
                                  )}
                                </div>
                                <div className="text-xs">
                                  <div className="text-vetted-text-secondary mb-1">Message</div>
                                  <pre className="whitespace-pre-wrap break-words font-mono bg-vetted-bg p-2 rounded border border-vetted-border text-vetted-primary">
                                    {err.message}
                                  </pre>
                                </div>
                                {err.stack && (
                                  <div className="text-xs">
                                    <div className="text-vetted-text-secondary mb-1">Stack</div>
                                    <pre className="whitespace-pre-wrap break-words font-mono bg-vetted-bg p-2 rounded border border-vetted-border text-vetted-text-secondary max-h-64 overflow-y-auto">
                                      {err.stack}
                                    </pre>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
```

- [ ] **Step 5: Verify the build**

```bash
npm run build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 6: Smoke test in the browser**

```bash
npm run dev
```

In the browser:
1. Log in as `admin@vetted.com`
2. Open DevTools → in console, paste (replacing `<admin id>` with the id from Task 3 step 10):
   ```js
   await fetch('/api/admin/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': '<admin id>' }, body: JSON.stringify({ message: 'browser test', url: location.pathname, stack: 'fake stack' }) });
   ```
3. Repeat 3 times to bump count to 3
4. Navigate to `/admin`
5. Confirm the error appears with `count: 3`, source `client`, route `/admin` (or wherever you ran it)
6. Click the row — expand panel shows full message + stack + first-seen
7. Switch to a different tab for 60s, come back — `last_seen` should still be ~recent (no polling fired while hidden, but the most recent is still cached)
8. Click "Clear all" → confirm dialog → list empties to "No errors detected"

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/pages/AdminPage.tsx
git commit -m "feat(error-log): admin UI — last-seen sort, count badge, row expand, clear all"
```

---

## Task 8: Bump sidebar version

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Bump version**

In [src/components/sidebar/Sidebar.tsx](src/components/sidebar/Sidebar.tsx), find line 211:
```tsx
        <p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.8.5</p>
```
Replace with:
```tsx
        <p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.9.0</p>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "chore: bump sidebar version to v1.9.0"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Fresh DB, full stack up**

```bash
rm -f data/vetted_portal.db
npm run dev
```

- [ ] **Step 2: Trigger a real route error**

In the browser, log in as admin. Then in DevTools console, hit a route that's likely to throw — e.g. an admin endpoint with bad input, or hit `/api/leases/ingest` without a file:

```js
await fetch('/api/leases/ingest', { method: 'POST', headers: { 'X-User-Id': '<admin id>' } });
```

- [ ] **Step 3: Trigger a recurring error**

Hit it a few more times to confirm dedup. Confirm the `count` increases on `/admin`.

- [ ] **Step 4: Verify route-pattern dedup**

If you can hit `/api/chats/:id/messages` for two different chat ids and both throw the same error, confirm they collapse to ONE row in the admin UI (not two). If `req.route` is undefined for some routes (rare — typically only middleware-only paths), the code falls back to `req.path` and they'd appear as separate rows; that's acceptable.

- [ ] **Step 5: Confirm DB persists across restart**

Stop the server. Restart:
```bash
npm run dev
```
Reload `/admin` — the error rows should still be there.

- [ ] **Step 6: Confirm sidebar version**

The sidebar in the bottom-left should read `v1.9.0`.

- [ ] **Step 7: Commit any cleanup**

If anything was missed during testing, fix and commit. Otherwise nothing to do.

---

## Self-Review Checklist (run after writing the plan)

Spec coverage:

- [x] **Storage table + index** — Task 1
- [x] **`error-log.js` helper** with `logError`/`getErrors`/`clearErrors`/`pruneOldErrors`, truncation, dedup hash, COALESCE-stack — Task 2
- [x] **`asyncRoute` wrapper added** — Task 3 step 2
- [x] **Existing `pushError` sites rewritten** (error middleware, uncaughtException, unhandledRejection, client-errors endpoint) — Task 3 steps 3-7
- [x] **Ring buffer removed** (`errorLog`/`errorCounter`/`pushError`/`ERROR_LOG_MAX`) — Task 3 step 1, verified step 9
- [x] **Prune interval + initial prune** — Task 3 step 8
- [x] **GET / DELETE / POST endpoints** — Task 3 steps 5-7
- [x] **`asyncRoute` wrapping pass** with rules for when to wrap — Task 4
- [x] **SSE catches in `lease-routes.js`** — Task 5
- [x] **API client `clearErrors`** — Task 6
- [x] **UI columns / expand / clear button / pause-polling-when-hidden / count-badge-red-when-≥10** — Task 7
- [x] **Sidebar version bump** — Task 8
- [x] **Persistence prerequisite verified** — pre-flight notes (database.js auto-saves)
- [x] **Lib functions rethrow rather than dual-log** — pre-flight + spec; not a code task because the libs already throw, we just don't add `logError` to them

Placeholder scan: no "TBD", no "fill in", every code block is complete code.

Type/name consistency: `logError`, `getErrors`, `clearErrors`, `pruneOldErrors` are used consistently across all tasks. `expandedErrorId` is the only new state name and only appears in Task 7.

---

## Out of scope (future)

- Filter/search UI on the errors table
- 4xx/5xx capture
- Per-user error views
- External alerting
