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

The 100-entry cap also serves as a natural mitigation against runaway error loops flooding the buffer.

### Error Entry Shape

```ts
{
  id: number,           // auto-incrementing integer counter
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
let errorCounter = 0;

function pushError(entry) {
  errorLog.unshift({ id: ++errorCounter, ...entry });
  if (errorLog.length > ERROR_LOG_MAX) errorLog.length = ERROR_LOG_MAX;
}
```

Placed near the top of the file, after imports.

### 2. Admin Auth Note

The existing `requireAdmin` middleware checks `role === 'admin'` exactly, but `AdminPage.tsx` allows both `'admin'` and `'super_admin'` access. Update the shared `requireAdmin` middleware itself to accept both roles — this is additive and safe for all 16 existing routes that use it:

```js
if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
  return res.status(403).json({ error: 'Admin access required' });
}
```

Updating the shared middleware (rather than adding per-route checks) ensures consistent behavior across all admin endpoints going forward.

### 3. Capture Points

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

### 4. New Endpoints

**`GET /api/admin/errors`** — requireAdmin (admin + super_admin)
Returns `{ errors: [...] }` from the ring buffer.

**`POST /api/admin/client-errors`** — requireAuth (any authenticated user)
Accepts `{ message, stack, url, userAgent }`. The server maps `url` → `route` when calling `pushError`:

```js
app.post('/api/admin/client-errors', requireAuth, (req, res) => {
  const { message, stack, url, userAgent } = req.body;
  pushError({
    timestamp: new Date().toISOString(),
    source: 'client',
    level: 'error',
    message,
    stack,
    route: url,   // input field 'url' stored as 'route' in entry shape
    userAgent,
  });
  res.json({ ok: true });
});
```

### 5. Extend `/api/admin/stats`

Add a global library file count (intentionally unscoped — this is an admin view of total system files, not per-user):
```js
const libraryFileCount = dbGet(db, 'SELECT COUNT(*) as count FROM library_files');
```

Include in response: `total_library_files: libraryFileCount.count`.

---

## Frontend Changes

### 1. Global Error Capture — `src/main.tsx`

Register handlers after app mounts using `addEventListener` (more portable than property assignment). Guard with auth check — if no `userId` in localStorage, skip reporting (avoids 401 feedback loop from `requireAuth`):

```ts
window.addEventListener('error', (event) => {
  if (!localStorage.getItem('userId')) return;
  // Use window.location.href (current page) rather than event.filename (script chunk path)
  api.admin.reportClientError({ message: String(event.message), stack: event.error?.stack, url: window.location.href });
});
window.addEventListener('unhandledrejection', (event) => {
  if (!localStorage.getItem('userId')) return;
  api.admin.reportClientError({ message: String(event.reason), url: window.location.href });
});
```

### 2. React Error Boundary — `src/components/ErrorBoundary.tsx`

New class component wrapping `<App>` in `main.tsx`. `componentDidCatch` explicitly guards with a localStorage auth check before reporting:

```ts
componentDidCatch(error: Error, info: React.ErrorInfo) {
  if (!localStorage.getItem('userId')) return;
  api.admin.reportClientError({
    message: error.message,
    stack: error.stack,
    url: window.location.href,
  });
}
```

Fallback UI renders:
- A centered message: "Something went wrong."
- A "Reload page" button (`window.location.reload()`)

This handles crashes before or during router initialization without leaving the user on a blank screen.

### 3. API Layer — `src/api/index.ts`

Add to the `admin` object:
```ts
errors: () => request('/admin/errors').then(d => d.errors || []),
reportClientError: (payload: { message: string; stack?: string; url?: string; userAgent?: string }) =>
  request('/admin/client-errors', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {}),
```

Note: `reportClientError` swallows errors (`.catch(() => {})`) to prevent a failed POST from triggering another `window.onerror` call.

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
- **Message** truncated to 80 chars with full text on hover (`title` attribute)
- **Route** shown if present, otherwise `—`

Empty state: green checkmark icon + "No errors detected" text.

Table is scrollable if > 10 entries. No pagination needed.

### Error Badge on Header

If `errors.length > 0`, show a red pill badge next to "Admin Dashboard" title with the count.

### Auto-Refresh

A single `setInterval` (30 seconds) in `useEffect` calls one refresh function that re-fetches stats, health, and errors together. The interval is cleared on component unmount.

Note: `/api/admin/health` is intentionally public (no auth middleware) in the existing codebase. Do not add auth guards to it — the auto-refresh calls it alongside the protected endpoints and it must remain accessible.

---

## Out of Scope

- Persisting errors to SQLite or disk
- Error filtering / search
- Error resolution / acknowledgement workflow
- Alerting / notifications for new errors
- Rate limiting / debouncing on `reportClientError`
