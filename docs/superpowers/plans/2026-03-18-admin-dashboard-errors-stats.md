# Admin Dashboard: Error Monitoring & Enhanced Stats — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-memory error capture (server + client), surface all errors in the Admin Dashboard, and add a total library files stat card.

**Architecture:** A ring buffer in `server/index.js` captures all server-side errors via Express middleware and process handlers, and accepts client errors via a POST endpoint. The Admin Dashboard polls this buffer every 30 seconds and renders a table. A React ErrorBoundary + global window listeners send frontend errors to the same buffer.

**Tech Stack:** Node.js/Express (backend), React 18 + TypeScript (frontend), Tailwind CSS, Zustand, Lucide icons, no test runner.

---

## File Map

| File | Change |
|------|--------|
| `server/index.js` | Add ring buffer, update `requireAdmin`, add 2 endpoints, extend `/api/admin/stats` |
| `src/api/index.ts` | Add `admin.errors()` and `admin.reportClientError()` |
| `src/components/ErrorBoundary.tsx` | **Create** — class component, catches render errors |
| `src/main.tsx` | Wrap app in ErrorBoundary, register global error listeners |
| `src/pages/AdminPage.tsx` | Add 4th stat card, Active Errors panel, auto-refresh, header badge |

---

## Task 1: Add ring buffer and update `requireAdmin` in `server/index.js`

**Files:**
- Modify: `server/index.js` (lines ~1–30 for buffer, line 870 for requireAdmin)

- [ ] **Step 1: Add the ring buffer near the top of `server/index.js`**

Open `server/index.js`. Find the block of `const` declarations after the imports (around line 25–35). Add immediately after the last top-level `const`:

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

- [ ] **Step 2: Update `requireAdmin` to accept `super_admin`**

Find the `requireAdmin` function at line ~869:

```js
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
```

Replace with:

```js
function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
```

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(admin): add in-memory error ring buffer and fix requireAdmin for super_admin"
```

---

## Task 2: Register server-side error capture in `server/index.js`

**Files:**
- Modify: `server/index.js` (process handlers at startup, Express error middleware at end)

- [ ] **Step 1: Add process-level error handlers**

Find the `// START SERVER` section near the bottom of `server/index.js` (around line 1352). Add these two handlers **before** `app.listen`. Note: `uncaughtException` is captured for logging only — the process continues, which is acceptable for this demo but not production:

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

- [ ] **Step 2: Replace the existing Express error middleware**

There is already an error handler in `server/index.js` at lines 1345–1350 inside the `// ERROR HANDLING` section:

```js
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});
```

**Replace** this existing handler (do not add a second one — Express only calls the first matching error handler). The replacement preserves the `err.status` fallback and adds ring buffer capture:

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

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(admin): register server error capture (process handlers + Express middleware)"
```

---

## Task 3: Add `/api/admin/errors` and `/api/admin/client-errors` endpoints

**Files:**
- Modify: `server/index.js` (add two routes in the ADMIN ROUTES section)

- [ ] **Step 1: Add the two new endpoints**

Find the ADMIN ROUTES section (around line 865). After the existing `/api/admin/health` endpoint, add:

```js
app.get('/api/admin/errors', requireAuth, requireAdmin, (req, res) => {
  res.json({ errors: errorLog });
});

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

- [ ] **Step 2: Extend `/api/admin/stats` to include total library files**

Find the `/api/admin/stats` handler (around line 876). Inside the handler, after the existing `dbGet` calls, add:

```js
const libraryFileCount = dbGet(db, 'SELECT COUNT(*) as count FROM library_files');
```

Then add `total_library_files: libraryFileCount.count` to the `stats` object in the response:

```js
res.json({
  stats: {
    total_users: userCount.count,
    active_users: userCount.count,
    active_today: activeTodayCount.count,
    total_chats: chatCount.count,
    total_projects: projectCount.count,
    total_messages: messageCount.count,
    tool_sets: toolSetCount.count,
    models: modelCount.count,
    system_prompts: promptCount.count,
    total_library_files: libraryFileCount.count,  // ← add this
    timestamp: new Date().toISOString()
  }
});
```

- [ ] **Step 3: Verify the server starts without errors**

```bash
npm run dev:backend
```

Expected: server starts, no crash on startup. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(admin): add /api/admin/errors and /api/admin/client-errors endpoints; add total_library_files to stats"
```

---

## Task 4: Add API methods to `src/api/index.ts`

**Files:**
- Modify: `src/api/index.ts` (lines ~81–96, the `admin` export)

- [ ] **Step 1: Add the two new methods to the `admin` export**

Open `src/api/index.ts`. Find the `export const admin = {` block (around line 81). Add these two entries at the end of the object, before the closing `};`:

```ts
  errors: () => request('/admin/errors').then((d: any) => d.errors || []),
  reportClientError: (payload: { message: string; stack?: string; url?: string; userAgent?: string }) =>
    request('/admin/client-errors', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {}),
```

Note: `.catch(() => {})` on `reportClientError` is intentional — it prevents a failed POST from triggering another global error event.

- [ ] **Step 2: Commit**

```bash
git add src/api/index.ts
git commit -m "feat(admin): add admin.errors() and admin.reportClientError() to API layer"
```

---

## Task 5: Create `src/components/ErrorBoundary.tsx`

**Files:**
- Create: `src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Create the file**

```tsx
import React from 'react';
import * as api from '../api';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: React.ErrorInfo) {
    if (!localStorage.getItem('userId')) return;
    api.admin.reportClientError({
      message: error.message,
      stack: error.stack,
      url: window.location.href,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4">
          <p className="text-vetted-primary text-lg">Something went wrong.</p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ErrorBoundary.tsx
git commit -m "feat(admin): add React ErrorBoundary component"
```

---

## Task 6: Update `src/main.tsx` — wrap app and register global listeners

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Update `main.tsx`**

Replace the entire file contents with:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import * as api from './api';
import './index.css';

window.addEventListener('error', (event) => {
  if (!localStorage.getItem('userId')) return;
  api.admin.reportClientError({
    message: String(event.message),
    stack: event.error?.stack,
    url: window.location.href,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  if (!localStorage.getItem('userId')) return;
  api.admin.reportClientError({
    message: String(event.reason),
    url: window.location.href,
  });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
```

- [ ] **Step 2: Commit**

```bash
git add src/main.tsx
git commit -m "feat(admin): wrap app in ErrorBoundary and register global error listeners"
```

---

## Task 7: Update `src/pages/AdminPage.tsx` — stats, errors panel, auto-refresh

**Files:**
- Modify: `src/pages/AdminPage.tsx`

This is the largest change. Work through it in sub-steps.

- [ ] **Step 1: Add `total_library_files` to the `Stats` interface and add `errors` state**

Find the `Stats` interface at the top of the file and add the new field:

```ts
interface Stats {
  total_users?: number;
  active_today?: number;
  total_projects?: number;
  total_library_files?: number;  // ← add this
  tool_sets?: number;
  models?: number;
  system_prompts?: number;
}
```

Add an `errors` state variable alongside the existing state declarations:

```ts
const [errors, setErrors] = useState<any[]>([]);
```

- [ ] **Step 2: Add `AlertTriangle` and `CheckCircle2` to the lucide-react import**

The existing import line is:

```ts
import { Wrench, Users, BarChart3, Activity, Zap, AlertCircle, CheckCircle } from 'lucide-react';
```

Update to:

```ts
import { Wrench, Users, Zap, AlertCircle, CheckCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
```

- [ ] **Step 3: Replace `loadAdminData` and add auto-refresh**

In `AdminPage.tsx`, the `useEffect` is at lines 28–34 and `loadAdminData` is at lines 36–50. They are not adjacent — replace **both blocks** together. Find and replace the `useEffect` block first:

```ts
// OLD — remove this
useEffect(() => {
  if (user?.role !== 'admin' && user?.role !== 'super_admin') {
    navigate('/');
    return;
  }
  loadAdminData();
}, [user, navigate]);
```

And replace the `loadAdminData` function:

```ts
// OLD — remove this
const loadAdminData = async () => {
  try {
    const statsData = await api.admin.stats();
    const healthData = await api.admin.health();
    setStats(statsData);
    setHealth(healthData);
  } catch (err) {
    addToast({
      type: 'error',
      title: 'Failed to load admin data',
    });
  } finally {
    setLoading(false);
  }
};
```

Replace both with:

```ts
const loadAdminData = async () => {
  try {
    const [statsData, healthData, errorsData] = await Promise.all([
      api.admin.stats(),
      api.admin.health(),
      api.admin.errors(),
    ]);
    setStats(statsData);
    setHealth(healthData);
    setErrors(errorsData);
  } catch (err) {
    addToast({ type: 'error', title: 'Failed to load admin data' });
  } finally {
    setLoading(false);
  }
};

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

- [ ] **Step 4: Update the `statCards` array and grid columns**

Find the `statCards` array and replace it:

```ts
const statCards = [
  { label: 'Total Users', value: stats?.total_users || 0 },
  { label: 'Active Today', value: stats?.active_today || 0 },
  { label: 'Projects', value: stats?.total_projects || 0 },
  { label: 'Library Files', value: stats?.total_library_files || 0 },
];
```

Also find the Quick Stats grid `div` in the JSX and change `md:grid-cols-3` to `md:grid-cols-4` so the 4 cards display in a single row on wider screens:

```tsx
// OLD
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
// NEW
<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
```

- [ ] **Step 5: Add the error time formatter helper**

Add this helper function inside the component (before the `return`):

```ts
const formatRelativeTime = (isoString: string) => {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};
```

- [ ] **Step 6: Update the page header to show the error badge**

Find the `<h1>` tag in the header:

```tsx
<h1 className="text-3xl font-serif text-vetted-primary">Admin Dashboard</h1>
```

Replace with:

```tsx
<div className="flex items-center gap-3">
  <h1 className="text-3xl font-serif text-vetted-primary">Admin Dashboard</h1>
  {errors.length > 0 && (
    <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-medium">
      {errors.length}
    </span>
  )}
</div>
```

- [ ] **Step 7: Add the Active Errors section to the JSX**

Find the existing `{/* Support Tools */}` section in the JSX. Add the new errors section **before** it:

```tsx
{/* Active Errors */}
<div>
  <div className="flex items-center gap-2 mb-4">
    <h2 className="text-lg font-medium text-vetted-primary">Active Errors</h2>
    {errors.length > 0 && (
      <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-medium">
        {errors.length}
      </span>
    )}
  </div>

  {errors.length === 0 ? (
    <div className="card flex items-center gap-3 text-vetted-success">
      <CheckCircle2 size={20} />
      <span className="text-sm">No errors detected</span>
    </div>
  ) : (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-vetted-surface border-b border-vetted-border sticky top-0">
            <tr>
              <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Time</th>
              <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Source</th>
              <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Level</th>
              <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Message</th>
              <th className="text-left px-4 py-2 text-vetted-text-secondary font-medium">Route</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((err) => (
              <tr key={err.id} className="border-b border-vetted-border last:border-0 hover:bg-vetted-surface/50">
                <td className="px-4 py-2 text-vetted-text-secondary whitespace-nowrap" title={err.timestamp}>
                  {formatRelativeTime(err.timestamp)}
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
                <td className="px-4 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    err.level === 'error'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {err.level}
                  </span>
                </td>
                <td className="px-4 py-2 text-vetted-primary max-w-xs" title={err.message}>
                  {err.message?.length > 80 ? err.message.slice(0, 80) + '…' : err.message}
                </td>
                <td className="px-4 py-2 text-vetted-text-secondary">
                  {err.route || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 8: Verify the app compiles and the admin page loads**

```bash
npm run dev
```

Navigate to `http://localhost:5173`, log in as `admin@vetted.com`, go to Admin. Verify:
- 4 stat cards show (Total Users, Active Today, Projects, Library Files)
- "Active Errors" section is visible with green "No errors detected" (or real errors if any exist)
- No TypeScript errors in the terminal

- [ ] **Step 9: Commit**

```bash
git add src/pages/AdminPage.tsx
git commit -m "feat(admin): add Active Errors panel, 4th stat card, error badge, and auto-refresh"
```

---

## Task 8: Smoke test the full error flow

- [ ] **Step 1: Trigger a client error manually to verify end-to-end**

In the browser console (while logged in), run:

```js
window.dispatchEvent(new ErrorEvent('error', { message: 'Test client error', error: new Error('Test') }));
```

Reload the admin page. The error should appear in the Active Errors table with `source: client`.

- [ ] **Step 2: Verify the 30-second auto-refresh works**

Open the Admin page and watch the Network tab in DevTools. Every 30 seconds you should see requests to `/api/admin/errors`, `/api/admin/stats`, and `/api/admin/health`.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete admin dashboard error monitoring and enhanced stats"
```
