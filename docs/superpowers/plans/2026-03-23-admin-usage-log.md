# Admin Usage Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Usage Log screen under Admin that shows all real LLM activity (main chat + lease bot) with user, timestamp, prompt, token count, and estimated cost.

**Architecture:** A new `usage_log` SQLite table captures one row per real AI call, written at the call site via a shared `logUsage` helper. Three new admin API endpoints serve the frontend. A new `AdminUsagePage.tsx` renders the stat cards, filters, and sortable table.

**Tech Stack:** Node.js/Express + sql.js (SQLite), React/TypeScript, Tailwind CSS, lucide-react, React Router v6

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `server/database.js` | Add `usage_log` table, indexes, export `logUsage` helper |
| Modify | `server/index.js` | Call `logUsage` after main chat AI response; add 3 admin endpoints |
| Modify | `server/lib/gemini.js` | Add `userId` param to all 5 functions; call `logUsage` after each Vertex AI call |
| Modify | `server/lease-routes.js` | Pass `req.headers['x-user-id']` to all Gemini function calls |
| Modify | `src/api/index.ts` | Add TypeScript types + `admin.usage` API methods |
| Create | `src/pages/AdminUsagePage.tsx` | New admin page: stat cards, filters, table, pagination, CSV export |
| Modify | `src/pages/AdminPage.tsx` | Add "Usage Log" nav button |
| Modify | `src/App.tsx` | Add `/admin/usage` route |

---

## Task 1: Database schema + `logUsage` helper

**Files:**
- Modify: `server/database.js`

### Background

`server/database.js` uses sql.js (in-memory SQLite). All tables are created in one `db.exec()` block inside `initializeDatabase()`. The `dbRun` helper (already exported) automatically calls `saveDatabase(db)` after every mutation — so `logUsage` just needs to call `dbRun`.

The cost rate table uses `model.startsWith(prefix)` matching evaluated in the order listed.

- [ ] **Step 1: Add `usage_log` table + indexes to `initializeDatabase()`**

In `server/database.js`, find the block that ends with `CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);` (around line 256) and add the following immediately after it, before the closing backtick of the `db.exec()` call:

```sql
    CREATE TABLE IF NOT EXISTS usage_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      source TEXT NOT NULL,
      prompt TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      estimated_cost REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON usage_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_log_user_id ON usage_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_log_source ON usage_log(source);
    CREATE INDEX IF NOT EXISTS idx_usage_log_model ON usage_log(model);
```

- [ ] **Step 2: Export the `logUsage` helper**

Add this function to `server/database.js` after the `getDatabase()` export (around line 266):

```js
const COST_RATES = [
  { prefix: 'gemini-2.0-flash', input: 0.075, output: 0.30 },
  { prefix: 'gemini-1.5-flash', input: 0.075, output: 0.30 },
  { prefix: 'gemini-1.5-pro',   input: 1.25,  output: 5.00 },
  { prefix: 'gpt-4o',           input: 2.50,  output: 10.00 },
  { prefix: 'claude-sonnet',    input: 3.00,  output: 15.00 },
];
const DEFAULT_RATE = { input: 1.00, output: 4.00 };

function computeCost(model, inputTokens, outputTokens) {
  const rate = COST_RATES.find(r => (model || '').startsWith(r.prefix)) || DEFAULT_RATE;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

export function logUsage(db, { userId, source, prompt, model, inputTokens, outputTokens }) {
  if (!db) return;
  const totalTokens = (inputTokens || 0) + (outputTokens || 0);
  const estimatedCost = computeCost(model, inputTokens || 0, outputTokens || 0);
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  dbRun(db, `
    INSERT INTO usage_log (id, user_id, source, prompt, model, input_tokens, output_tokens, total_tokens, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, userId || null, source, prompt || null, model || null,
      inputTokens || 0, outputTokens || 0, totalTokens,
      Math.round(estimatedCost * 100000) / 100000,
      new Date().toISOString()]);
}
```

- [ ] **Step 3: Start the dev server to confirm no startup errors**

```bash
npm run dev:backend
```

Expected: server starts, no errors about `usage_log`.

- [ ] **Step 4: Commit**

```bash
git add server/database.js
git commit -m "feat: add usage_log table and logUsage helper"
```

---

## Task 2: Main chat logging

**Files:**
- Modify: `server/index.js`

### Background

The main chat route is `POST /api/chats/:id/messages`. It always calls a real AI model. After the AI response is saved to `messages` (around line 511–526), `chat.model` and a `token_count` estimate are already in scope. The estimate is word-count based (output only), so use `input_tokens = 0`, `output_tokens = tokenCount`. Skip logging if the response is an error string (the catch block sets `aiContent` to a human-readable error starting with "The AI service..." etc.).

- [ ] **Step 1: Import `logUsage` and `getDatabase` in `server/index.js`**

Find the imports at the top of `server/index.js`. Add `logUsage` and `getDatabase` to the existing import from `./database.js`:

```js
import { initializeDatabase, dbRun, dbGet, dbAll, getDatabase, logUsage } from './database.js';
```

(The exact existing import may differ — just add `getDatabase` and `logUsage` to whatever is already imported from `./database.js`.)

- [ ] **Step 2: Add `logUsage` call after the messages INSERT**

Find the AI message INSERT (around line 513). After the INSERT `dbRun` call and before `dbRun(db, 'UPDATE chats SET updated_at...')`, add:

```js
  // Log usage (skip if AI returned an error message)
  const isErrorResponse = aiContent.startsWith('The AI service') ||
    aiContent.startsWith('Sorry, I was unable') ||
    aiContent.startsWith('The AI model');
  if (!isErrorResponse) {
    const tokenCount = Math.ceil(aiContent.split(/\s+/).length * 1.3);
    logUsage(getDatabase(), {
      userId: req.user?.id || null,
      source: 'chat',
      prompt: content,
      model: chat.model,
      inputTokens: 0,
      outputTokens: tokenCount,
    });
  }
```

Note: `content` is the user's message (already in scope from `const { content } = req.body`). `chat.model` is the model identifier.

- [ ] **Step 3: Test manually**

Start `npm run dev:backend`, send a chat message via the UI, then verify a row was inserted by temporarily adding a `console.log` inside `logUsage` or checking the admin usage endpoint once it's built.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat: log usage for main chat AI responses"
```

---

## Task 3: Gemini function `userId` param + lease bot logging

**Files:**
- Modify: `server/lib/gemini.js`

### Background

`gemini.js` uses ESM (`export async function`). The Vertex AI response object contains `result.response.usageMetadata` with `promptTokenCount` and `candidatesTokenCount`. The internal `generate()` helper (line 29) returns the raw Vertex AI result. Callers use `extractGroundedResponse(result)` to get `{ text, searchQueries }`. The `usageMetadata` must be read from the raw result before extracting — so split any single-expression call into two steps.

For `ocrPdf` and `extractLeaseData` there is no user message — use a descriptor string as the prompt value.

- [ ] **Step 1: Import `logUsage` and `getDatabase` in `server/lib/gemini.js`**

At the top of `server/lib/gemini.js`, add:

```js
import { logUsage, getDatabase } from '../database.js';
```

- [ ] **Step 2: Add `userId` parameter to `ocrPdf` and add logging**

Change the signature from:
```js
export async function ocrPdf(pdfBase64) {
```
to:
```js
export async function ocrPdf(pdfBase64, userId = null) {
```

Inside `ocrPdf`, find the `generate()` call. If it currently looks like:
```js
return extractGroundedResponse(await generate(...));
```
Split it and add logging:
```js
const result = await generate(/* existing args */);
const usageMeta = result?.response?.usageMetadata;
if (usageMeta) {
  logUsage(getDatabase(), {
    userId,
    source: 'lease',
    prompt: '[OCR: PDF upload]',
    model: config.modelId,
    inputTokens: usageMeta.promptTokenCount || 0,
    outputTokens: usageMeta.candidatesTokenCount || 0,
  });
}
return extractGroundedResponse(result);
```

- [ ] **Step 3: Add `userId` to `extractLeaseData` and add logging**

Change signature to:
```js
export async function extractLeaseData(fullText, sourceFile, userId = null) {
```
Apply the same split pattern. Use:
```js
prompt: `[Extract: ${sourceFile || 'lease document'}]`
```

- [ ] **Step 4: Add `userId` to `chatWithLeases` and add logging**

Change signature to:
```js
export async function chatWithLeases(leaseTexts, userMessage, chatHistory, useSearch = false, persona, userId = null) {
```
Apply the same split pattern. Use `prompt: userMessage`.

- [ ] **Step 5: Add `userId` to `chatWithDocuments` and add logging**

Change signature to:
```js
export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null, userId = null) {
```
Apply the same split pattern. Use `prompt: userMessage`.

- [ ] **Step 6: Add `userId` to `chatCrossPortfolio` and add logging**

Change signature to:
```js
export async function chatCrossPortfolio(leaseSummaries, userMessage, chatHistory = [], useSearch = false, persona, userId = null) {
```
Apply the same split pattern. Use `prompt: userMessage`.

- [ ] **Step 7: Verify no syntax errors**

```bash
npm run dev:backend
```

Confirm the server starts without import errors.

- [ ] **Step 8: Commit**

```bash
git add server/lib/gemini.js
git commit -m "feat: add userId param and usage logging to all Gemini functions"
```

---

## Task 4: Pass `userId` through lease route callers

**Files:**
- Modify: `server/lease-routes.js`
- Modify: `server/index.js`

### Background

Lease routes don't use `requireAuth`, so `req.user` is undefined. Use `req.headers['x-user-id']` as the `userId` value — the frontend always sends this header. Find every call to the 5 Gemini functions and append `userId` as the last argument.

- [ ] **Step 1: Find all Gemini function calls in `server/lease-routes.js`**

```bash
grep -n "ocrPdf\|extractLeaseData\|chatWithLeases\|chatCrossPortfolio" server/lease-routes.js
```

- [ ] **Step 2: Add `userId` to each call in `server/lease-routes.js`**

For every call found, add `req.headers['x-user-id'] || null` as the last argument. For example:

```js
// Before:
await ocrPdf(pdfBase64)
// After:
await ocrPdf(pdfBase64, req.headers['x-user-id'] || null)

// Before:
await extractLeaseData(fullText, sourceFile)
// After:
await extractLeaseData(fullText, sourceFile, req.headers['x-user-id'] || null)

// Before:
await geminiChatWithLeases(leaseTexts, userMessage, chatHistory, useSearch, persona)
// After:
await geminiChatWithLeases(leaseTexts, userMessage, chatHistory, useSearch, persona, req.headers['x-user-id'] || null)
```

- [ ] **Step 3: Update `chatWithDocuments` call in `server/index.js`**

In `server/index.js`, find (around line 488):
```js
const result = await chatWithDocuments(docs, content, history, systemPromptOverride);
```
Change to:
```js
const result = await chatWithDocuments(docs, content, history, systemPromptOverride, req.user?.id || null);
```

- [ ] **Step 4: Commit**

```bash
git add server/lease-routes.js server/index.js
git commit -m "feat: pass userId to Gemini functions from lease and chat routes"
```

---

## Task 5: Admin API endpoints

**Files:**
- Modify: `server/index.js`

### Background

Three new endpoints, all admin-only. Use the existing inline role check pattern:
```js
if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
  return res.status(403).json({ error: 'Forbidden' });
}
```

Add these endpoints near the other admin routes (search for `app.get('/api/admin/` to find the right location).

- [ ] **Step 1: Add `GET /api/admin/usage/models`**

```js
app.get('/api/admin/usage/models', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = dbAll(db, 'SELECT DISTINCT model FROM usage_log WHERE model IS NOT NULL ORDER BY model');
  res.json(rows.map(r => r.model));
});
```

- [ ] **Step 2: Add `GET /api/admin/usage/summary`**

```js
app.get('/api/admin/usage/summary', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();

  const row = dbGet(db, `
    SELECT
      COUNT(*) as total_prompts,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COALESCE(SUM(estimated_cost), 0) as estimated_cost,
      COUNT(DISTINCT user_id) as active_users
    FROM usage_log
    WHERE created_at >= ? AND created_at <= ?
  `, [monthStart, monthEnd]);

  res.json({
    total_prompts: row?.total_prompts || 0,
    total_tokens: row?.total_tokens || 0,
    estimated_cost: row?.estimated_cost || 0,
    active_users: row?.active_users || 0,
  });
});
```

- [ ] **Step 3: Add `GET /api/admin/usage`**

```js
app.get('/api/admin/usage', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (req.query.user_id) { conditions.push('ul.user_id = ?'); params.push(req.query.user_id); }
  if (req.query.source) { conditions.push('ul.source = ?'); params.push(req.query.source); }
  if (req.query.model) { conditions.push('ul.model = ?'); params.push(req.query.model); }
  if (req.query.from) { conditions.push('ul.created_at >= ?'); params.push(req.query.from + 'T00:00:00.000Z'); }
  if (req.query.to) { conditions.push('ul.created_at <= ?'); params.push(req.query.to + 'T23:59:59.999Z'); }
  if (req.query.q) { conditions.push('ul.prompt LIKE ?'); params.push(`%${req.query.q}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = dbGet(db, `SELECT COUNT(*) as total FROM usage_log ul ${where}`, params);
  const total = countRow?.total || 0;

  const rows = dbAll(db, `
    SELECT ul.*, u.display_name, u.department
    FROM usage_log ul
    LEFT JOIN users u ON ul.user_id = u.id
    ${where}
    ORDER BY ul.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  res.json({ rows, total, page, limit });
});
```

- [ ] **Step 4: Test endpoints with curl**

```bash
# Get admin user id from seeded data
node -e "
import('./server/database.js').then(async m => {
  const db = await m.initializeDatabase();
  const u = m.dbGet(db, \"SELECT id FROM users WHERE email = 'admin@vetted.com'\");
  console.log(u.id);
});
"
# Then test:
curl -s "http://localhost:3000/api/admin/usage/summary" -H "X-User-Id: <id-from-above>" | node -e "process.stdin|>JSON.parse|>console.log" 2>/dev/null || curl -s "http://localhost:3000/api/admin/usage/summary" -H "X-User-Id: <id-from-above>"
```

Expected: JSON with `total_prompts`, `total_tokens`, `estimated_cost`, `active_users`.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: add admin usage API endpoints (list, summary, models)"
```

---

## Task 6: Frontend API layer + TypeScript types

**Files:**
- Modify: `src/api/index.ts`

### Background

The existing `admin` export (line 133) uses the shared `request()` helper. Add types at the top of the file and the `usage` sub-object inside the `admin` export.

- [ ] **Step 1: Add TypeScript types at the top of `src/api/index.ts`**

Add these exported interfaces before `const BASE = '/api';`:

```ts
export interface UsageListParams {
  page?: number;
  limit?: number;
  user_id?: string;
  source?: 'chat' | 'lease';
  model?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface UsageRow {
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

export interface UsageListResponse {
  rows: UsageRow[];
  total: number;
  page: number;
  limit: number;
}

export interface UsageSummary {
  total_prompts: number;
  total_tokens: number;
  estimated_cost: number;
  active_users: number;
}
```

- [ ] **Step 2: Add `usage` to the `admin` export**

Inside `export const admin = { ... }` (line 133), add a `usage` property before the closing `};`:

```ts
  usage: {
    list: (params?: UsageListParams): Promise<UsageListResponse> => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.user_id) qs.set('user_id', params.user_id);
      if (params?.source) qs.set('source', params.source);
      if (params?.model) qs.set('model', params.model);
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      if (params?.q) qs.set('q', params.q);
      const query = qs.toString();
      return request(`/admin/usage${query ? '?' + query : ''}`);
    },
    summary: (): Promise<UsageSummary> => request('/admin/usage/summary'),
    models: (): Promise<string[]> => request('/admin/usage/models'),
  },
```

- [ ] **Step 3: Commit**

```bash
git add src/api/index.ts
git commit -m "feat: add admin usage API types and methods"
```

---

## Task 7: AdminUsagePage component

**Files:**
- Create: `src/pages/AdminUsagePage.tsx`

### Background

Follow the same layout pattern as `AdminUsersPage.tsx`: full-height flex column, header with back button, content area with `overflow-y-auto`. No test runner — verify visually.

The `initials()` helper (same as in `AdminUsersPage.tsx`) generates 2-letter avatar text. The model badge uses the same pill style as the source/level badges in the errors table in `AdminPage.tsx` (`px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700`).

Date range options produce `from`/`to` strings in `YYYY-MM-DD` format. "All Time" sends no from/to.

- [ ] **Step 1: Create `src/pages/AdminUsagePage.tsx`**

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import type { UsageListParams, UsageRow, UsageSummary } from '../api';
import { ArrowLeft, Search, Download } from 'lucide-react';

function initials(name: string) {
  return (name || '?').split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

function formatDateRange(option: string): { from?: string; to?: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const toDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (option === 'today') { const t = toDate(now); return { from: t, to: t }; }
  if (option === '7d') { const f = new Date(now); f.setDate(now.getDate() - 6); return { from: toDate(f), to: toDate(now) }; }
  if (option === '30d') { const f = new Date(now); f.setDate(now.getDate() - 29); return { from: toDate(f), to: toDate(now) }; }
  if (option === 'month') {
    const f = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const t = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
    return { from: toDate(f), to: toDate(t) };
  }
  return {};
}

const DATE_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'month', label: 'This Month' },
];

export default function AdminUsagePage() {
  const navigate = useNavigate();
  const { user, addToast } = useStore();

  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [model, setModel] = useState('');
  const [source, setSource] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const [rows, setRows] = useState<UsageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [users, setUsers] = useState<{ id: string; display_name: string }[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const buildParams = useCallback((overrides: Partial<UsageListParams> = {}): UsageListParams => {
    const dateFilter = formatDateRange(dateRange);
    return {
      page, limit: LIMIT,
      ...(search ? { q: search } : {}),
      ...(userId ? { user_id: userId } : {}),
      ...(model ? { model } : {}),
      ...(source ? { source: source as 'chat' | 'lease' } : {}),
      ...dateFilter,
      ...overrides,
    };
  }, [page, search, userId, model, source, dateRange]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.usage.list(buildParams());
      setRows(data.rows);
      setTotal(data.total);
    } catch {
      addToast({ type: 'error', title: 'Failed to load usage data' });
    } finally {
      setLoading(false);
    }
  }, [buildParams, addToast]);

  const loadSummary = useCallback(async () => {
    try { setSummary(await api.admin.usage.summary()); } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'super_admin') { navigate('/'); return; }
    Promise.all([
      api.admin.users.list().then(setUsers).catch(() => {}),
      api.admin.usage.models().then(setModels).catch(() => {}),
      loadSummary(),
    ]);
  }, [user, navigate, loadSummary]);

  useEffect(() => { loadRows(); }, [loadRows]);

  useEffect(() => {
    const interval = setInterval(loadSummary, 30_000);
    return () => clearInterval(interval);
  }, [loadSummary]);

  const prevFilters = useRef({ search, userId, model, source, dateRange });
  useEffect(() => {
    const p = prevFilters.current;
    if (p.search !== search || p.userId !== userId || p.model !== model ||
        p.source !== source || p.dateRange !== dateRange) {
      setPage(1);
      prevFilters.current = { search, userId, model, source, dateRange };
    }
  }, [search, userId, model, source, dateRange]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await api.admin.usage.list(buildParams({ page: 1, limit: 500 }));
      const headers = ['User', 'Date', 'Source', 'Prompt', 'Model', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Est. Cost'];
      const csvRows = data.rows.map(r => [
        r.display_name || '',
        r.created_at,
        r.source,
        `"${(r.prompt || '').replace(/"/g, '""')}"`,
        r.model || '',
        r.input_tokens,
        r.output_tokens,
        r.total_tokens,
        r.estimated_cost.toFixed(5),
      ].join(','));
      const csv = [headers.join(','), ...csvRows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usage-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast({ type: 'error', title: 'Export failed' });
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startEntry = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endEntry = Math.min(page * LIMIT, total);
  const maxTokens = Math.max(1, ...rows.map(r => r.total_tokens));

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };
  };

  const fieldClass = 'px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent text-sm bg-white';

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return null;

  const statCards = [
    { label: 'Total Prompts', value: summary?.total_prompts?.toLocaleString() ?? '—' },
    { label: 'Total Tokens', value: summary ? (summary.total_tokens >= 1_000_000 ? `${(summary.total_tokens / 1_000_000).toFixed(1)}M` : summary.total_tokens.toLocaleString()) : '—' },
    { label: 'Est. Cost (Month)', value: summary ? `$${summary.estimated_cost.toFixed(2)}` : '—', gold: true },
    { label: 'Active Users', value: summary?.active_users?.toLocaleString() ?? '—' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/admin')} className="p-2 hover:bg-vetted-surface rounded-lg transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-3xl font-serif text-vetted-primary">Usage Log</h1>
          </div>
          <span className="text-xs text-vetted-text-secondary">Stats refresh every 30s</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map(({ label, value, gold }) => (
            <div key={label} className="card text-center py-4">
              <p className={`text-3xl font-serif font-bold ${gold ? 'text-vetted-accent' : 'text-vetted-primary'}`}>{value}</p>
              <p className="text-xs text-vetted-text-secondary mt-1">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-vetted-text-muted" />
            <input type="text" placeholder="Search prompts…" value={search}
              onChange={e => setSearch(e.target.value)}
              className={`${fieldClass} pl-8 w-56`} />
          </div>
          <select value={userId} onChange={e => setUserId(e.target.value)} className={fieldClass}>
            <option value="">All Users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
          <select value={model} onChange={e => setModel(e.target.value)} className={fieldClass}>
            <option value="">All Models</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={source} onChange={e => setSource(e.target.value)} className={fieldClass}>
            <option value="">All Sources</option>
            <option value="chat">Chat</option>
            <option value="lease">Lease</option>
          </select>
          <select value={dateRange} onChange={e => setDateRange(e.target.value)} className={fieldClass}>
            {DATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={handleExport} disabled={exporting || total === 0}
            className="ml-auto flex items-center gap-2 px-4 py-2 border border-vetted-border rounded-lg text-sm hover:bg-vetted-surface transition-colors disabled:opacity-50">
            <Download size={14} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>

        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-vetted-text-secondary text-sm">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="bg-vetted-surface border-b border-vetted-border">
                  <tr className="text-left text-xs font-medium text-vetted-text-muted uppercase tracking-wide">
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3 whitespace-nowrap">Date / Time</th>
                    <th className="px-4 py-3">Prompt</th>
                    <th className="px-4 py-3">Tokens</th>
                    <th className="px-4 py-3">Est. Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vetted-border">
                  {rows.map(row => {
                    const { date, time } = formatDate(row.created_at);
                    const barPct = Math.round((row.total_tokens / maxTokens) * 100);
                    return (
                      <tr key={row.id} className="hover:bg-vetted-surface/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-vetted-accent flex items-center justify-center text-vetted-primary font-bold text-xs shrink-0">
                              {initials(row.display_name || '?')}
                            </div>
                            <div>
                              <p className="font-medium text-vetted-primary text-sm">{row.display_name || '—'}</p>
                              {row.department && <p className="text-xs text-vetted-text-secondary">{row.department}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm text-vetted-primary">{date}</p>
                          <p className="text-xs text-vetted-text-secondary">{time}</p>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <p className="text-sm text-vetted-primary line-clamp-2">{row.prompt || '—'}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {row.model && <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">{row.model}</span>}
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${row.source === 'lease' ? 'bg-blue-100 text-blue-700' : 'bg-indigo-100 text-indigo-800'}`}>{row.source}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-semibold text-vetted-primary">{row.total_tokens.toLocaleString()}</p>
                          <div className="w-16 h-1 bg-vetted-border rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-vetted-accent rounded-full" style={{ width: `${barPct}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-semibold text-vetted-primary">${row.estimated_cost.toFixed(4)}</p>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-vetted-text-muted text-sm">No usage data found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-vetted-border bg-vetted-surface/50">
              <span className="text-xs text-vetted-text-secondary">
                Showing {startEntry}–{endEntry} of {total.toLocaleString()} entries
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-2 py-1 text-xs border border-vetted-border rounded hover:bg-vetted-surface disabled:opacity-40">‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = page <= 3 ? i + 1 : page + i - 2;
                  if (p < 1 || p > totalPages) return null;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`px-2 py-1 text-xs border rounded ${p === page ? 'bg-vetted-primary text-white border-vetted-primary' : 'border-vetted-border hover:bg-vetted-surface'}`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-2 py-1 text-xs border border-vetted-border rounded hover:bg-vetted-surface disabled:opacity-40">›</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/pages/AdminUsagePage.tsx
git commit -m "feat: add AdminUsagePage component"
```

---

## Task 8: Wire up route + navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/AdminPage.tsx`

- [ ] **Step 1: Add route to `src/App.tsx`**

Find the admin routes block (around line 113). Add the import at the top with other admin page imports:

```tsx
import AdminUsagePage from './pages/AdminUsagePage';
```

Add the route after `<Route path="/admin/tool-sets" ...`:

```tsx
<Route path="/admin/usage" element={<AdminUsagePage />} />
```

- [ ] **Step 2: Add "Usage Log" nav button to `src/pages/AdminPage.tsx`**

Add `BarChart2` to the lucide-react import:

```tsx
import { Wrench, Users, Zap, AlertCircle, CheckCircle, CheckCircle2, BarChart2 } from 'lucide-react';
```

In the Navigation Buttons section (around line 243), add a button after "Manage Users":

```tsx
<button
  onClick={() => navigate('/admin/usage')}
  className="w-full btn-primary flex items-center justify-between"
>
  <span className="flex items-center gap-2">
    <BarChart2 size={18} />
    Usage Log
  </span>
</button>
```

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/pages/AdminPage.tsx
git commit -m "feat: add /admin/usage route and nav button"
```

---

## Task 9: Bump version

- [ ] **Step 1: Find the sidebar version string**

```bash
grep -rn "v1\." src/ --include="*.tsx" | grep -i "version\|v1\." | head -10
```

- [ ] **Step 2: Increment patch version** (e.g. `v1.2.0` → `v1.2.1`)

- [ ] **Step 3: Commit**

```bash
git add <version file>
git commit -m "chore: bump version to v1.2.1"
```

---

## Verification Checklist

After all tasks are complete, verify manually:

- [ ] Send a chat message → row appears in Usage Log page (after login as admin)
- [ ] Upload a lease PDF → rows appear for OCR + extract steps
- [ ] Send a lease chat message → row appears with `source = 'lease'`
- [ ] Stat cards populate with real numbers
- [ ] Filters (user, model, source, date) narrow results correctly
- [ ] Pagination works (next/prev page)
- [ ] Export CSV downloads a file with correct columns
- [ ] Back button returns to `/admin`
- [ ] Non-admin user is redirected away from `/admin/usage`
