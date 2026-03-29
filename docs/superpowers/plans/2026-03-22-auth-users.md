# Password Auth & User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email-only login with bcrypt password auth and build a full admin user management UI (create/edit/delete users, set passwords).

**Architecture:** Add `password_hash` to the users table; verify it at login with bcrypt. New admin REST endpoints for CRUD + password management. Replace the existing bare-bones `AdminUsersPage.tsx` with a full-featured UI (stats, table, modals). Auth session mechanism (X-User-Id header + localStorage) unchanged.

**Tech Stack:** Node.js/Express backend, bcrypt, sql.js SQLite (WebAssembly), React/TypeScript frontend, Tailwind CSS, Lucide icons.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `server/database.js` | Modify line 41 | Add `password_hash TEXT` to `CREATE TABLE users` DDL |
| `server/seed.js` | Modify | Hash and set jeffk's password in seed INSERT |
| `server/index.js` | Modify lines 1, 64–80, 117–146, 939–969 | bcrypt import; migration; async login; new admin user endpoints |
| `src/api/index.ts` | Modify lines 21–22, 135–137 | Update `auth.login`; replace `admin.users`/`updateRole`/`updateStatus` |
| `src/components/auth/LoginPage.tsx` | Modify (full rewrite) | Email + password form, show/hide toggle |
| `src/pages/AdminUsersPage.tsx` | Modify (full rewrite) | Full user management UI with modals |
| `src/components/sidebar/Sidebar.tsx` | Modify line 248 | Version bump to v1.1.1 |

---

## Task 1: Schema — add `password_hash` column to DDL and seed

**Files:**
- Modify: `server/database.js:30-42`
- Modify: `server/seed.js:23-44`

**Context:** `server/database.js` line 41 has `last_login_at TEXT` as the last column of the users table — add `password_hash` after it. `server/seed.js` line 40–44 inserts users with an explicit column list and values array — both must include `password_hash`. The `seedDatabase` function is already `async` so `await bcrypt.hash(...)` works.

- [ ] **Step 1: Install bcrypt**

```bash
cd /Users/jeffkwiatkowski/vetted_portal_v2
npm install bcrypt
npm install --save-dev @types/bcrypt
```

Expected: `bcrypt` appears in `package.json` dependencies.

- [ ] **Step 2: Add `password_hash` to users table DDL in `server/database.js`**

Find line 41 (`last_login_at TEXT`) and add the new column after it:

```js
// Before (line 41):
      last_login_at TEXT
    );

// After:
      last_login_at TEXT,
      password_hash TEXT
    );
```

- [ ] **Step 3: Update seed.js to hash and insert jeffk's password**

At the top of `server/seed.js`, add the bcrypt import:
```js
import bcrypt from 'bcrypt';
```

In the `seedDatabase` function, before the `users` array definition, add:
```js
const jeffkPasswordHash = await bcrypt.hash('Vetted@3:16', 10);
```

In the `users` array object for jeffk, add:
```js
password_hash: jeffkPasswordHash,
```

Update the INSERT statement (around line 40–43) to include `password_hash` in the column list and `user.password_hash` in the values array:

```js
dbRun(db, `
  INSERT INTO users (id, email, display_name, job_title, department, role, avatar_path, status, created_at, updated_at, last_login_at, password_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [user.id, user.email, user.display_name, user.job_title, user.department, user.role, user.avatar_path, user.status, user.created_at, user.updated_at, user.last_login_at, user.password_hash]);
```

- [ ] **Step 4: Verify server starts without error**

```bash
npm run dev:backend 2>&1 | head -20
```

Expected: Server starts, no crash, `Listening on port 3000`.

- [ ] **Step 5: Commit**

```bash
git add server/database.js server/seed.js package.json package-lock.json
git commit -m "feat: add password_hash column to users schema and seed"
```

---

## Task 2: Backend migration + async login with password check

**Files:**
- Modify: `server/index.js:1` (import)
- Modify: `server/index.js:64-80` (startup block — add migration)
- Modify: `server/index.js:117-146` (login handler)

**Context:** The startup block at lines 64–80 already uses top-level `await` (ES module). The login handler at line 117 is currently synchronous and only checks email. The `runMigrations` function handles *existing* databases that lack the column — on fresh DBs the DDL already has it.

- [ ] **Step 1: Add bcrypt import to `server/index.js`**

Find the existing imports at the top of the file. Add after the last import line:

```js
import bcrypt from 'bcrypt';
```

- [ ] **Step 2: Add `runMigrations` helper and call it at startup**

Add this function somewhere before the startup `try` block (around line 62):

```js
async function runMigrations(db) {
  const cols = dbAll(db, "PRAGMA table_info('users')");
  const hasPwHash = cols.some(c => c.name === 'password_hash');
  if (!hasPwHash) {
    dbRun(db, 'ALTER TABLE users ADD COLUMN password_hash TEXT');
    const hash = await bcrypt.hash('Vetted@3:16', 10);
    dbRun(db, "UPDATE users SET password_hash = ? WHERE email = 'jeffk@vettedbot.com'", [hash]);
    console.log('Migration: added password_hash column and set jeffk password');
  }
}
```

Inside the existing startup `try` block, after `db = await initializeDatabase()` (line 66) and after the seed check block, add:

```js
await runMigrations(db);
```

So the block looks like:
```js
try {
  db = await initializeDatabase();
  const userCount = dbGet(db, 'SELECT COUNT(*) as count FROM users');
  if (!userCount || userCount.count === 0) {
    await seedDatabase();
    db = getDatabase();
    console.log('Database initialized and seeded');
  } else {
    console.log('Database already seeded, skipping seed process');
  }
  await runMigrations(db);   // <-- add this line
} catch (error) {
  console.error('Database initialization error:', error);
  process.exit(1);
}
```

- [ ] **Step 3: Rewrite the login handler (lines 117–146) to be async and check password**

Replace the entire `app.post('/api/auth/login', ...)` handler:

```js
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = dbGet(db, 'SELECT * FROM users WHERE email = ?', [email]);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'User account is not active' });
  }

  if (!user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Update last login
  dbRun(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);

  // Return same shape as before — strip password_hash, keep everything else
  const { password_hash, ...safeUser } = user;
  res.json({ user: safeUser });
});
```

- [ ] **Step 4: Verify login works**

```bash
npm run dev:backend &
sleep 3
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jeffk@vettedbot.com","password":"Vetted@3:16"}' | jq .
```

Expected: `{ "user": { "id": "...", "email": "jeffk@vettedbot.com", ... } }`

Then test wrong password:
```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jeffk@vettedbot.com","password":"wrong"}' | jq .
```

Expected: `{ "error": "Invalid password" }` with HTTP 401.

Kill the background server: `kill %1`

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: add password auth to login endpoint and startup migration"
```

---

## Task 3: Admin user CRUD endpoints

**Files:**
- Modify: `server/index.js:939-969` (admin user endpoints)

**Context:** Lines 939–969 contain `GET /api/admin/users`, `PUT /api/admin/users/:id/role`, and `PUT /api/admin/users/:id/status`. The GET needs to include `has_password`. The two PUT sub-routes get replaced by one unified PUT. Three new endpoints are added: POST (create), unified PUT (update), PUT password, DELETE. All use existing `requireAuth` + `requireAdmin` middleware.

- [ ] **Step 1: Verify the old route block before replacing**

```bash
grep -n "users/:id/role\|users/:id/status\|GET.*admin/users\|POST.*admin/users" server/index.js | head -10
```

Confirm that both `PUT /api/admin/users/:id/role` and `PUT /api/admin/users/:id/status` are within lines 939–969. If they extend beyond line 969, adjust the replacement range accordingly to include their closing `});`.

- [ ] **Step 2: Replace the admin user endpoints block (lines 939–969)**

Delete everything from `app.get('/api/admin/users'` through the closing `});` of `app.put('/api/admin/users/:id/status'` (lines 939–969), and replace with:

```js
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const rows = dbAll(db, 'SELECT * FROM users ORDER BY created_at DESC');
  const users = rows.map(({ password_hash, ...u }) => ({ ...u, has_password: !!password_hash }));
  res.json({ users });
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, display_name, job_title, department, role = 'user', password, status = 'active' } = req.body;
  if (!email || !display_name) return res.status(400).json({ error: 'Email and name required' });
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const now = new Date().toISOString();
  const id = (await import('uuid')).v4();
  const password_hash = password ? await bcrypt.hash(password, 10) : null;
  try {
    dbRun(db, `
      INSERT INTO users (id, email, display_name, job_title, department, role, status, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, email, display_name, job_title || null, department || null, role, status, password_hash, now, now]);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
  const user = dbGet(db, 'SELECT * FROM users WHERE id = ?', [id]);
  const { password_hash: _, ...safeUser } = user;
  res.status(201).json({ user: { ...safeUser, has_password: !!user.password_hash } });
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const existing = dbGet(db, 'SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (body.role !== undefined && !['user', 'admin'].includes(body.role)) return res.status(400).json({ error: 'Invalid role' });
  if (body.status !== undefined && !['active', 'inactive', 'suspended'].includes(body.status)) return res.status(400).json({ error: 'Invalid status' });
  const allowed = ['email', 'display_name', 'job_title', 'department', 'role', 'status'];
  const fields = Object.keys(body).filter(k => allowed.includes(k) && body[k] !== undefined);
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  const setClauses = fields.map(f => `${f} = ?`).join(', ');
  const values = [...fields.map(f => body[f]), new Date().toISOString(), id];
  try {
    dbRun(db, `UPDATE users SET ${setClauses}, updated_at = ? WHERE id = ?`, values);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
  const updated = dbGet(db, 'SELECT * FROM users WHERE id = ?', [id]);
  const { password_hash, ...safeUser } = updated;
  res.json({ user: { ...safeUser, has_password: !!password_hash } });
});

app.put('/api/admin/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password || typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Password is required' });
  }
  const existing = dbGet(db, 'SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const hash = await bcrypt.hash(password, 10);
  dbRun(db, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, new Date().toISOString(), id]);
  res.json({ success: true });
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const existing = dbGet(db, 'SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const adminCount = dbGet(db, "SELECT COUNT(*) as count FROM users WHERE role IN ('admin','super_admin') AND status = 'active' AND id != ?", [id]);
  if (adminCount.count === 0) return res.status(400).json({ error: 'Cannot delete the last admin' });
  dbRun(db, 'DELETE FROM users WHERE id = ?', [id]);
  res.json({ success: true });
});
```

Note: `uuid` is already in `package.json`. The dynamic `import('uuid')` inside POST avoids a top-level import change — alternatively, check if `uuidv4` is already imported at the top of `server/index.js` and use it directly if so.

- [ ] **Step 3: Check if uuid is already imported in server/index.js**

```bash
grep "uuid\|uuidv4" /Users/jeffkwiatkowski/vetted_portal_v2/server/index.js | head -5
```

If `uuidv4` is already imported, replace `(await import('uuid')).v4()` in the POST handler with `uuidv4()`.

- [ ] **Step 4: Restart server and test the new endpoints**

```bash
npm run dev:backend &
sleep 3
JEFF_ID=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jeffk@vettedbot.com","password":"Vetted@3:16"}' | jq -r '.user.id')

# Test GET (should show has_password)
curl -s http://localhost:3000/api/admin/users -H "X-User-Id: $JEFF_ID" | jq '.users[0] | {email, has_password}'

# Test POST (create user)
curl -s -X POST http://localhost:3000/api/admin/users \
  -H "Content-Type: application/json" -H "X-User-Id: $JEFF_ID" \
  -d '{"email":"test@example.com","display_name":"Test User","password":"Test1234"}' | jq .

# Test DELETE (should fail — would remove last admin if we delete jeff, so test new user)
NEW_ID=$(curl -s http://localhost:3000/api/admin/users -H "X-User-Id: $JEFF_ID" | jq -r '.users[] | select(.email=="test@example.com") | .id')
curl -s -X DELETE http://localhost:3000/api/admin/users/$NEW_ID -H "X-User-Id: $JEFF_ID" | jq .

kill %1
```

Expected: GET shows `has_password: true`, POST returns created user, DELETE returns `{ success: true }`.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: add admin user CRUD endpoints with password management"
```

---

## Task 4: Frontend API layer + login page

**Files:**
- Modify: `src/api/index.ts:21-22` (auth.login)
- Modify: `src/api/index.ts:135-137` (admin.users/updateRole/updateStatus)
- Modify: `src/components/auth/LoginPage.tsx` (full rewrite)

**Context:** These two files must be edited together — `api.admin.users` changes from a function to a namespace object, which breaks `AdminUsersPage.tsx` immediately. Do both `api/index.ts` and `LoginPage.tsx` in this task, then `AdminUsersPage.tsx` in the next task. The app will be broken between tasks 4 and 5 (admin users page crashes), but login will work immediately after task 4.

- [ ] **Step 1: Update `src/api/index.ts` — auth.login signature**

Find line 22:
```ts
// Before:
  login: (email: string) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email }) }),

// After:
  login: (email: string, password: string) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
```

- [ ] **Step 2: Update `src/api/index.ts` — replace admin.users, remove updateRole/updateStatus**

Find lines 135–137:
```ts
// Before (3 lines to replace):
  users: () => request('/admin/users').then(d => d.users || d || []),
  updateRole: (id: string, role: string) => request(`/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  updateStatus: (id: string, status: string) => request(`/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

// After (replace those 3 lines with):
  users: {
    list: () => request('/admin/users').then((d: any) => d.users || d || []),
    create: (data: { email: string; display_name: string; job_title?: string; department?: string; role?: string; password?: string }) =>
      request('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{ email: string; display_name: string; job_title: string; department: string; role: string; status: string }>) =>
      request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setPassword: (id: string, password: string) =>
      request(`/admin/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
    remove: (id: string) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  },
```

- [ ] **Step 3: Rewrite `src/components/auth/LoginPage.tsx`**

Replace the entire file with:

```tsx
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store';
import * as api from '../../api';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from || '/';
  const setUser = useStore((s) => s.setUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.auth.login(email, password);
      localStorage.setItem('userId', result.user.id);
      setUser(result.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-serif font-bold text-vetted-primary">
            Vetted<span className="text-vetted-accent">.</span>
          </h1>
        </div>

        <div className="card shadow-lg">
          <h2 className="text-2xl font-serif text-vetted-primary mb-2">Welcome back</h2>
          <p className="text-vetted-text-secondary mb-6">Sign in to access your portal</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
              <AlertCircle size={18} className="text-vetted-danger flex-shrink-0 mt-0.5" />
              <p className="text-sm text-vetted-danger">{error}</p>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-vetted-primary mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="you@example.com"
              className="w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-vetted-primary mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                placeholder="••••••••"
                className="w-full px-3 py-2 pr-10 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-vetted-text-muted hover:text-vetted-primary"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify login works in the browser**

```bash
npm run dev
```

Open http://localhost:5173 — should show the new email + password form. Log in with `jeffk@vettedbot.com` / `Vetted@3:16`. Should land on the main chat page.

- [ ] **Step 5: Commit**

> **Note:** After this commit, `AdminUsersPage.tsx` still calls `api.admin.users()` as a function — the TypeScript build will fail until Task 5 is complete. Do not run `npm run build` between tasks 4 and 5.

```bash
git add src/api/index.ts src/components/auth/LoginPage.tsx
git commit -m "feat: password login UI and updated API client"
```

---

## Task 5: Admin Users page rewrite

**Files:**
- Modify: `src/pages/AdminUsersPage.tsx` (full rewrite)

**Context:** The existing file (183 lines) uses `api.admin.users()`, `api.admin.updateRole()`, and `api.admin.updateStatus()` — all removed in Task 4. This task replaces it with the full CRUD UI: stats row, search, table with role/password/status display, and three modals (Add, Edit, Reset Password). Uses Tailwind classes consistent with the existing app style (`border-vetted-border`, `text-vetted-primary`, `btn-primary`, `card`, etc.).

- [ ] **Step 1: Write the new `AdminUsersPage.tsx`**

Replace the entire file with:

```tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { ArrowLeft, Search, Plus, Pencil, KeyRound, Trash2, X, Eye, EyeOff } from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  job_title: string | null;
  department: string | null;
  role: string;
  status: string;
  has_password: boolean;
  last_login_at: string | null;
}

type ModalType = null | 'add' | 'edit' | 'password';

interface UserForm {
  firstName: string;
  lastName: string;
  email: string;
  job_title: string;
  department: string;
  role: string;
  status: string;
  password: string;
  confirmPassword: string;
}

const emptyForm: UserForm = {
  firstName: '', lastName: '', email: '', job_title: '', department: '',
  role: 'user', status: 'active', password: '', confirmPassword: '',
};

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const { user: currentUser, addToast } = useStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalType>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  useEffect(() => {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'super_admin') {
      navigate('/');
      return;
    }
    loadUsers();
  }, [currentUser, navigate]);

  const loadUsers = async () => {
    try {
      const data = await api.admin.users.list();
      setUsers(data);
    } catch {
      addToast({ type: 'error', title: 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setForm(emptyForm); setFormError(''); setShowPw(false); setShowConfirmPw(false); setModal('add'); };
  const openEdit = (u: AdminUser) => {
    const [firstName, ...rest] = u.display_name.split(' ');
    setForm({ firstName, lastName: rest.join(' '), email: u.email, job_title: u.job_title || '', department: u.department || '', role: u.role, status: u.status, password: '', confirmPassword: '' });
    setFormError('');
    setShowPw(false);
    setShowConfirmPw(false);
    setSelectedUser(u);
    setModal('edit');
  };
  const openPassword = (u: AdminUser) => { setForm({ ...emptyForm }); setFormError(''); setShowPw(false); setShowConfirmPw(false); setSelectedUser(u); setModal('password'); };
  const closeModal = () => { setModal(null); setSelectedUser(null); setFormError(''); };

  const handleAdd = async () => {
    if (!form.email || !form.firstName) { setFormError('Email and first name are required'); return; }
    if (form.password && form.password !== form.confirmPassword) { setFormError('Passwords do not match'); return; }
    setSubmitting(true); setFormError('');
    try {
      await api.admin.users.create({
        email: form.email,
        display_name: [form.firstName, form.lastName].filter(Boolean).join(' '),
        job_title: form.job_title || undefined,
        department: form.department || undefined,
        role: form.role,
        password: form.password || undefined,
      });
      addToast({ type: 'success', title: 'User created' });
      closeModal();
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!form.email || !form.firstName) { setFormError('Email and first name are required'); return; }
    if (form.password && form.password !== form.confirmPassword) { setFormError('Passwords do not match'); return; }
    if (!selectedUser) return;
    setSubmitting(true); setFormError('');
    try {
      await api.admin.users.update(selectedUser.id, {
        email: form.email,
        display_name: [form.firstName, form.lastName].filter(Boolean).join(' '),
        job_title: form.job_title || undefined,
        department: form.department || undefined,
        role: form.role,
        status: form.status,
      });
      if (form.password) {
        try {
          await api.admin.users.setPassword(selectedUser.id, form.password);
        } catch {
          addToast({ type: 'error', title: 'Profile saved but password update failed — try again from the Password button' });
          closeModal();
          await loadUsers();
          return;
        }
      }
      addToast({ type: 'success', title: 'User updated' });
      closeModal();
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetPassword = async () => {
    if (!form.password) { setFormError('Password is required'); return; }
    if (form.password !== form.confirmPassword) { setFormError('Passwords do not match'); return; }
    if (!selectedUser) return;
    setSubmitting(true); setFormError('');
    try {
      await api.admin.users.setPassword(selectedUser.id, form.password);
      addToast({ type: 'success', title: 'Password updated' });
      closeModal();
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (u: AdminUser) => {
    if (!confirm(`Delete ${u.display_name}? This cannot be undone.`)) return;
    try {
      await api.admin.users.remove(u.id);
      addToast({ type: 'success', title: 'User deleted' });
      await loadUsers();
    } catch (err) {
      addToast({ type: 'error', title: err instanceof Error ? err.message : 'Failed to delete user' });
    }
  };

  const filtered = users.filter(u =>
    u.display_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: users.length,
    active: users.filter(u => u.status === 'active').length,
    admins: users.filter(u => u.role === 'admin' || u.role === 'super_admin').length,
    withPassword: users.filter(u => u.has_password).length,
  };

  const fieldClass = "w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent text-sm";

  const PasswordField = ({ label, field, show, onToggle }: { label: string; field: 'password' | 'confirmPassword'; show: boolean; onToggle: () => void }) => (
    <div>
      <label className="block text-sm font-medium text-vetted-primary mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={form[field]}
          onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
          placeholder="••••••••"
          className={fieldClass + ' pr-10'}
        />
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-vetted-text-muted hover:text-vetted-primary" tabIndex={-1}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );

  if (loading) return <div className="flex items-center justify-center h-full"><p className="text-vetted-text-secondary">Loading users...</p></div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-vetted-border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/admin')} className="p-2 hover:bg-vetted-surface rounded-lg transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-3xl font-serif text-vetted-primary">Manage Users</h1>
          </div>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Add User
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Users', value: stats.total },
            { label: 'Active', value: stats.active },
            { label: 'Admins', value: stats.admins },
            { label: 'Password Set', value: stats.withPassword },
          ].map(({ label, value }) => (
            <div key={label} className="card text-center py-4">
              <p className="text-3xl font-serif font-bold text-vetted-primary">{value}</p>
              <p className="text-xs text-vetted-text-secondary mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vetted-text-muted" />
          <input
            type="text"
            placeholder="Search users…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent text-sm"
          />
        </div>

        {/* Table */}
        <div className="card p-0 overflow-hidden">
          <table className="w-full min-w-[700px]">
            <thead className="bg-vetted-surface border-b border-vetted-border">
              <tr className="text-left text-xs font-medium text-vetted-text-muted uppercase tracking-wide">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Password</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 whitespace-nowrap">Last Login</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vetted-border">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-vetted-surface/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-vetted-accent flex items-center justify-center text-vetted-primary font-bold text-xs shrink-0">
                        {initials(u.display_name)}
                      </div>
                      <div>
                        <p className="font-medium text-vetted-primary text-sm">{u.display_name}</p>
                        <p className="text-xs text-vetted-text-secondary">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                      u.role === 'admin' || u.role === 'super_admin'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-indigo-100 text-indigo-800'
                    }`}>
                      {u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {u.has_password
                      ? <span className="text-green-600 font-medium">✓ Set</span>
                      : <span className="text-red-500 font-medium">✗ Not set</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-vetted-text-muted whitespace-nowrap">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-vetted-surface rounded transition-colors text-vetted-text-muted hover:text-vetted-primary" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => openPassword(u)} className="p-1.5 hover:bg-vetted-surface rounded transition-colors text-vetted-text-muted hover:text-vetted-primary" title="Set password">
                        <KeyRound size={14} />
                      </button>
                      {u.id !== currentUser?.id && (
                        <button onClick={() => handleDelete(u)} className="p-1.5 hover:bg-red-50 rounded transition-colors text-vetted-text-muted hover:text-red-500" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-vetted-text-muted text-sm">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between p-6 border-b border-vetted-border">
              <h2 className="text-xl font-serif font-bold text-vetted-primary">
                {modal === 'add' ? 'Add User' : modal === 'edit' ? 'Edit User' : 'Reset Password'}
              </h2>
              <button onClick={closeModal} className="p-1 hover:bg-vetted-surface rounded transition-colors"><X size={18} /></button>
            </div>

            {/* Modal body */}
            <div className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{formError}</div>
              )}

              {(modal === 'add' || modal === 'edit') && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">First Name *</label>
                      <input type="text" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="First" className={fieldClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">Last Name</label>
                      <input type="text" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Last" className={fieldClass} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-vetted-primary mb-1">Email *</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@example.com" className={fieldClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">Job Title</label>
                      <input type="text" value={form.job_title} onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))} placeholder="e.g. Analyst" className={fieldClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">Department</label>
                      <input type="text" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Finance" className={fieldClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">Role</label>
                      <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={fieldClass}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    {modal === 'edit' && (
                      <div>
                        <label className="block text-sm font-medium text-vetted-primary mb-1">Status</label>
                        <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={fieldClass}>
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="border-t border-vetted-border pt-4">
                    <p className="text-xs text-vetted-text-muted mb-3">{modal === 'add' ? 'Optional — set a password now or later' : 'Leave blank to keep current password'}</p>
                    <div className="space-y-3">
                      <PasswordField label="Password" field="password" show={showPw} onToggle={() => setShowPw(v => !v)} />
                      <PasswordField label="Confirm Password" field="confirmPassword" show={showConfirmPw} onToggle={() => setShowConfirmPw(v => !v)} />
                    </div>
                  </div>
                </>
              )}

              {modal === 'password' && (
                <div className="space-y-3">
                  <p className="text-sm text-vetted-text-secondary">Setting password for <strong>{selectedUser?.display_name}</strong></p>
                  <PasswordField label="New Password" field="password" show={showPw} onToggle={() => setShowPw(v => !v)} />
                  <PasswordField label="Confirm Password" field="confirmPassword" show={showConfirmPw} onToggle={() => setShowConfirmPw(v => !v)} />
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-3 p-6 border-t border-vetted-border">
              <button onClick={closeModal} className="px-4 py-2 text-sm border border-vetted-border rounded-lg hover:bg-vetted-surface transition-colors">
                Cancel
              </button>
              <button
                onClick={modal === 'add' ? handleAdd : modal === 'edit' ? handleEdit : handleSetPassword}
                disabled={submitting}
                className="btn-primary"
              >
                {submitting ? 'Saving...' : modal === 'add' ? 'Create User' : modal === 'password' ? 'Set Password' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the page works**

```bash
npm run dev
```

Log in as `jeffk@vettedbot.com` / `Vetted@3:16`. Navigate to Admin → Manage Users. Verify:
- Stats row shows 1 user, 1 active, 1 admin, 1 password set
- Table shows jeffk with green "✓ Set" password status
- "Add User" button opens modal
- Edit and Password buttons work on jeffk's row
- Delete button is hidden for jeffk (own row)

- [ ] **Step 3: Commit**

```bash
git add src/pages/AdminUsersPage.tsx
git commit -m "feat: full admin user management UI with modals"
```

---

## Task 6: Version bump and VM deploy

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx:248`

- [ ] **Step 1: Bump version in Sidebar.tsx**

Find line 248:
```tsx
// Before:
<p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.1.0</p>

// After:
<p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.1.1</p>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "chore: bump version to v1.1.1"
```

- [ ] **Step 3: Build and deploy to VM**

```bash
npm run build
```

Expected: `dist/` directory created, no build errors.

```bash
gcloud compute scp -r dist/ jeff@vetted-portal:/tmp/dist-new --zone=us-central1-a
gcloud compute ssh jeff@vetted-portal --zone=us-central1-a -- \
  "sudo cp -r /tmp/dist-new/* /opt/vetted-portal/dist/ && sudo systemctl restart vetted-portal" 2>&1
```

- [ ] **Step 4: Update VM .env with bcrypt (no change needed — bcrypt is a backend dep)**

The VM runs from `server/` directly. Push the updated server files **and `package.json`/`package-lock.json`** so `npm install` picks up the new `bcrypt` dependency:

```bash
gcloud compute scp server/index.js server/database.js server/seed.js \
  package.json package-lock.json \
  jeff@vetted-portal:/tmp/ --zone=us-central1-a
gcloud compute ssh jeff@vetted-portal --zone=us-central1-a -- \
  "sudo cp /tmp/index.js /tmp/database.js /tmp/seed.js /opt/vetted-portal/server/ && \
   sudo cp /tmp/package.json /tmp/package-lock.json /opt/vetted-portal/ && \
   cd /opt/vetted-portal && sudo -u vetted npm install && \
   sudo systemctl restart vetted-portal" 2>&1
```

- [ ] **Step 5: Verify VM is working**

```bash
curl -s -X POST http://34.132.119.114:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jeffk@vettedbot.com","password":"Vetted@3:16"}' | jq .email
```

Expected: `"jeffk@vettedbot.com"`
