# Admin Dashboard: Error Monitoring & Enhanced Stats

**Date:** 2026-03-18
**Status:** Approved

## Overview

Enhance the Admin Dashboard with:
1. A live active errors panel (server + client errors captured in-memory)
2. A total library files stat card
3. Auto-refresh and error badge on the dashboard header

---

## Error Capture Strategy (Option A — In-Memory Ring Buffer)

A shared in-memory array in `server/index.js` holds the last 100 error entries. Oldest entries are evicted when the buffer is full. Entries are never persisted to disk or database. The buffer resets on server restart.

### Error Entry Shape

```ts
{
  id: string,           // uuid or incrementing counter
  timestamp: string,    // ISO 8601
  source: 'server' | 'client',
  level: 'error' | 'warn',
  message: string,
  stack?: string,       // optional stack trace
  route?: string,       // URL or component path where error occurred
  userAgent?: string    // client errors only
}
```

---

## Backend Changes — `server/index.js`

### 1. In-Memory Ring Buffer

```js
const errorLog = [];
const ERROR_LOG_MAX = 100;

function pushError(entry) {
  errorLog.unshift({ id: Date.now() + Math.random(), ...entry });
  if (errorLog.length > ERROR_LOG_MAX) errorLog.length = ERROR_LOG_MAX;
}
```

Placed near the top of the file, after imports.

### 2. Capture Points

**Express error middleware** (registered after all routes):
```js
app.use((err, req, res, next) => {
  pushError({
    timestamp: new Date().toISOString(),
    source: 'server',
    level: 'error',
    message: err.message,
    stack: err.stack,
    route: req.path,
  });
  res.status(500).json({ error: 'Internal server error' });
});
```

**Process-level handlers** (registered at startup):
```js
process.on('uncaughtException', (err) => {
  pushError({ timestamp: new Date().toISOString(), source: 'server', level: 'error', message: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  pushError({ timestamp: new Date().toISOString(), source: 'server', level: 'error', message: String(reason) });
});
```

### 3. New Endpoints

**`GET /api/admin/errors`** — admin-only
Returns `{ errors: [...] }` from the ring buffer.

**`POST /api/admin/client-errors`** — requireAuth (any authenticated user)
Accepts `{ message, stack, url, userAgent }`, pushes to buffer with `source: 'client'`.

### 4. Extend `/api/admin/stats`

Add to existing stats query:
```js
const libraryFileCount = dbGet(db, 'SELECT COUNT(*) as count FROM library_files');
```

Include in response: `total_library_files: libraryFileCount.count`.

---

## Frontend Changes

### 1. Global Error Capture — `src/main.tsx`

After app mounts, register:
```ts
window.onerror = (message, source, lineno, colno, error) => {
  api.admin.reportClientError({ message: String(message), stack: error?.stack, url: source });
};
window.onunhandledrejection = (event) => {
  api.admin.reportClientError({ message: String(event.reason), url: window.location.href });
};
```

Only fires after the user is authenticated (user ID available in localStorage).

### 2. React Error Boundary — `src/components/ErrorBoundary.tsx`

New component wrapping `<App>` in `main.tsx`. On `componentDidCatch`, calls `api.admin.reportClientError({ message, stack, url })`.

Renders a minimal fallback UI (not the full admin page) so the app doesn't fully crash.

### 3. API Layer — `src/api/index.ts`

Add to the `admin` object:
```ts
errors: () => request('/admin/errors').then(d => d.errors || []),
reportClientError: (payload: { message: string; stack?: string; url?: string; userAgent?: string }) =>
  request('/admin/client-errors', { method: 'POST', body: JSON.stringify(payload) }),
```

### 4. Update Stats Interface — `src/pages/AdminPage.tsx`

Add `total_library_files?: number` to the `Stats` interface.

---

## AdminPage.tsx UI Changes

### Stats Row

Change from 3 cards to 4 cards:
- Total Users
- Active Today
- Projects
- **Library Files** ← new, sourced from `stats.total_library_files`

### Active Errors Panel

New section below Quick Stats, titled **"Active Errors"** with a count badge showing the number of errors.

**Table columns:** Time | Source | Level | Message | Route

- **Source** rendered as a badge: `server` (gray) / `client` (blue)
- **Level** rendered as a badge: `error` (red) / `warn` (yellow)
- **Time** shown as relative (e.g., "2m ago") with full ISO timestamp on hover
- **Message** truncated to 80 chars with full text on hover (title attribute)
- **Route** shown if present, otherwise `—`

Empty state: green checkmark icon + "No errors detected" text.

Table is scrollable if > 10 entries. No pagination needed.

### Error Badge on Header

If `errors.length > 0`, show a red pill badge next to "Admin Dashboard" title with the count.

### Auto-Refresh

Both errors and stats re-fetch every 30 seconds via `setInterval` in `useEffect`. Interval cleared on component unmount.

---

## Out of Scope

- Persisting errors to SQLite or disk
- Error filtering / search
- Error resolution / acknowledgement workflow
- Alerting / notifications for new errors
- Frontend error rate limiting (no debounce on `reportClientError`)
