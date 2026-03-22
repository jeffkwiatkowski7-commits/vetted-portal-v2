# Password Auth & User Management Design — Vetted Portal v2

**Date:** 2026-03-22
**Status:** Approved

## Overview

Replace email-only login with email + password authentication. Add an admin-only User Management tab to the Admin page where the admin can create, edit, delete users and set/reset passwords.

## Scope

- Login requires email + password (bcrypt verified)
- Password management is admin-only — no self-service
- Auth session mechanism unchanged (X-User-Id header, localStorage)
- New "Users" tab inside the existing Admin page
- `bcrypt` added as a dependency

Out of scope: JWT/sessions upgrade, self-service password reset, forgot password flow, per-user avatar upload.

## Auth Approach

**Option A: Password check at login, keep X-User-Id header.**

Login endpoint verifies bcrypt password. On success, returns `{ user }` as today. Frontend stores `userId` in localStorage and sends `X-User-Id` header on every request. No other auth infrastructure changes.

If a user has no password set (`password_hash IS NULL`), login is rejected with `401 { error: 'Invalid password' }`.

## Database

### Schema change

Add `password_hash TEXT` column to the `users` table (nullable). **Update the `CREATE TABLE users` DDL in `server/database.js`** to include this column so fresh databases have it from the start. The migration (below) handles existing databases that were created before this column existed.

### Migration at startup

Define an async helper function `runMigrations(db)` called inside the existing startup `try` block (after the DB is initialized, before `app.listen`). The function is async because `bcrypt.hash` returns a Promise.

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

Call it as `await runMigrations(db)` inside the existing startup `try` block, after `db` is assigned. The startup block already uses top-level `await` (ES module — `db = await initializeDatabase()` on line 66), so no IIFE is needed.

### Seed

`server/seed.js` sets `password_hash` for the seeded `jeffk@vettedbot.com` user using `await bcrypt.hash('Vetted@3:16', 10)`. The `seedDatabase` function is already `async`.

The existing `INSERT INTO users` statement at line 41 specifies an explicit column list that does not include `password_hash`. **Update both the column list and the values array** to include `password_hash`:

```js
const passwordHash = await bcrypt.hash('Vetted@3:16', 10);
// then in users array: password_hash: passwordHash
// INSERT column list: (..., password_hash)
// values: [..., user.password_hash]
```

## Backend

### `server/index.js` changes

#### bcrypt import

```js
import bcrypt from 'bcrypt';
```

#### `POST /api/auth/login` — convert to async, add password check

The existing handler is synchronous. Convert to `async` to use `await bcrypt.compare`. Preserve the existing `last_login_at` update on success (this is currently in the handler — do not remove it).

Accepts `{ email, password }`. Error cases:
- Missing email or password → `400 { error: 'Email and password required' }`
- User not found → `404 { error: 'User not found' }`
- User inactive → `403 { error: 'User account is not active' }`
- `password_hash` is null, or `bcrypt.compare` returns false → `401 { error: 'Invalid password' }`
- Success → same `{ user }` response shape as today (no `password_hash` field); `last_login_at` updated as before

#### `requireAdmin` — use existing definition

`requireAdmin` already exists in `server/index.js` and checks `['admin', 'super_admin'].includes(req.user.role)`. **Do not redefine it.** Apply to all admin user endpoints.

#### Admin user endpoints

All require `requireAuth` + `requireAdmin`.

**`GET /api/admin/users`** — already exists. **Modify**: change the SELECT to include `password_hash` (or use `SELECT *`), then compute `has_password: !!user.password_hash` on each row before returning. Strip `password_hash` from the response. Response shape: `{ users: [...] }`.

**`POST /api/admin/users`** — **does not currently exist, create it**. Accepts:
```json
{ "email": "...", "display_name": "...", "job_title": "...", "department": "...", "role": "user", "password": "..." }
```
- Required: `email`, `display_name`. Return `400 { error: 'Email and name required' }` if missing.
- `role` must be one of `['user', 'admin']`. Default to `'user'` if not provided. Return `400 { error: 'Invalid role' }` if an unrecognized value is given.
- `password` optional. If provided, hash with `await bcrypt.hash(password, 10)`.
- On duplicate email (SQLite UNIQUE constraint error — `err.message` contains `UNIQUE constraint failed`), return `409 { error: 'Email already in use' }`.
- Response: `{ user }` (same shape as GET list items, with `has_password`).

**`PUT /api/admin/users/:id`** — **does not currently exist as a unified endpoint; create it and remove the existing `/:id/role` and `/:id/status` routes in the same edit** (the new route must be registered at or near the same position in the file as the routes it replaces, to avoid any routing order ambiguity). Accepts any subset of `{ email, display_name, job_title, department, role, status }`. Role must be one of `['user', 'admin']` if provided. `super_admin` is intentionally excluded from the allowed set.

**Validate inputs before updating.** If `role` is provided, it must be in `['user', 'admin']`. If `status` is provided, it must be in `['active', 'inactive', 'suspended']`. Return `400 { error: 'Invalid role' }` or `400 { error: 'Invalid status' }` respectively.

**Check existence first** (`dbGet` before `dbRun`) — sql.js silently succeeds on UPDATE with 0 rows matched:
```js
const existing = dbGet(db, 'SELECT id FROM users WHERE id = ?', [id]);
if (!existing) return res.status(404).json({ error: 'User not found' });

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
```

After the UPDATE, re-fetch the row and return `{ user }` (same shape as GET list, with `has_password`).

**`PUT /api/admin/users/:id/password`** — **new**. Accepts `{ password }`. Validates password is a non-empty string (return `400` if not). Hashes with `await bcrypt.hash(password, 10)` and updates `password_hash`. Response: `{ success: true }`.

**`DELETE /api/admin/users/:id`** — **does not currently exist, create it**. Before deleting, verify the user exists (return `404 { error: 'User not found' }` if not). Then check: `SELECT COUNT(*) as count FROM users WHERE role IN ('admin','super_admin') AND status = 'active' AND id != ?`. If count is 0, return `400 { error: 'Cannot delete the last admin' }`. Otherwise delete and return `{ success: true }`.

### Existing endpoints to remove

Remove `PUT /api/admin/users/:id/role` and `PUT /api/admin/users/:id/status` — replaced by the unified `PUT /api/admin/users/:id`.

## Frontend

### `src/components/auth/LoginPage.tsx`

Replace demo user dropdown with:
- Email text input (`type="email"`)
- Password input (`type="password"`) with show/hide toggle (eye icon button, toggles type between `password` and `text`)
- Remove `DEMO_USERS` array and "Demo mode" hint text
- API call sends `{ email, password }` to `api.auth.login`

### `src/api/index.ts`

**`api.auth.login`**: update to accept `(email: string, password: string)` and send `{ email, password }`.

**Targeted changes to `api.admin`** — do not rewrite the whole object. Make three surgical edits. **Edit `src/api/index.ts` and `src/pages/AdminUsersPage.tsx` together** — changing `api.admin.users` from a function to a namespace object will break `AdminUsersPage.tsx` at runtime until that file is replaced.

1. Replace the `users` key (currently a plain function) with the new namespace object:
```ts
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

2. Remove the `updateRole` key.
3. Remove the `updateStatus` key.

All other keys in `api.admin` (`stats`, `health`, `errors`, `systemPrompts`, `createSystemPrompt`, `updateSystemPrompt`, `deleteSystemPrompt`, `models`, `updateModel`, `toolSets`, `createToolSet`, `updateToolSet`, `deleteToolSet`, `reportClientError`) must be preserved unchanged. No other file in the codebase calls `api.admin.users`, `api.admin.updateRole`, or `api.admin.updateStatus` — `AdminUsersPage.tsx` is the only call site, and it is being replaced in full.

### `src/pages/AdminPage.tsx`

No changes. `AdminPage.tsx` is a stat dashboard with a "Manage Users" button that already navigates to `/admin/users`. The actual user management UI lives in `AdminUsersPage.tsx` at that route.

### `src/pages/AdminUsersPage.tsx` (replace existing)

Self-contained component. Local state: `users` list, `search` string, `modal` (`null | 'add' | 'edit' | 'password'`), `selectedUser` for edit/password modal.

On mount: fetch `api.admin.users.list()` and store in `users` state.

**Layout:**
- Stats row: Total Users, Active, Admins, Password Set — all derived from `users` state (no extra API call)
- Toolbar: search input (filters by name/email client-side) + "Add User" button
- User table — columns: User (avatar initials + display_name + email), Role, Password, Status, Last Login, Actions
  - Role badge: Admin = amber (`bg-amber-100 text-amber-800`), User = indigo (`bg-indigo-100 text-indigo-800`)
  - Password column: green "✓ Set" if `has_password`, red "✗ Not set" if not
  - Actions: Edit, Password (🔑), Delete — Delete button hidden for the currently logged-in user's own row

**Name fields:** The DB stores a single `display_name`. Modals show "First Name" and "Last Name" fields. On submit, concatenate as `[firstName, lastName].filter(Boolean).join(' ')` → `display_name`. On edit pre-fill, split `display_name` on the first space: `[display_name.split(' ')[0], display_name.split(' ').slice(1).join(' ')]`.

**Modals:**

*Add User modal* — fields: First Name, Last Name, Email, Job Title (optional), Department (optional), Role (select: user / admin), Password (optional), Confirm Password (optional). Client-side validation: if either password field is non-empty, both must match. On success: close modal, call `api.admin.users.list()` and update `users` state.

*Edit User modal* — same fields pre-filled. Password and Confirm Password optional (blank = keep current). On submit:
1. Call `api.admin.users.update(id, nonPasswordFields)` — **strip password and confirmPassword from the payload before calling update**; only send `{ display_name, email, job_title, department, role, status }`.
2. If password field is non-empty, call `api.admin.users.setPassword(id, password)` after update succeeds.
3. If `setPassword` fails, show inline error: "Profile saved but password update failed — try again from the Password button." Do not roll back.
4. On success: close modal, refresh user list via `api.admin.users.list()`.

*Reset Password modal* — Password + Confirm Password only. Validates they match. Calls `api.admin.users.setPassword`. On success: close modal, refresh user list via `api.admin.users.list()` (required to update the `has_password` column in the table).

All modals: errors shown inline at the top of the modal body. Submit button disabled while request is in-flight.

## Version bump

`src/components/sidebar/Sidebar.tsx`: bump version to `v1.1.1`.

## Files Modified

| File | Change |
|---|---|
| `server/database.js` | Add `password_hash TEXT` to `CREATE TABLE users` DDL |
| `server/index.js` | Add bcrypt import; add `runMigrations` async helper called at startup; convert login to async with password check (preserve `last_login_at`); use existing `requireAdmin`; modify `GET /admin/users` (add `password_hash` to SELECT, return `has_password` boolean); create `POST /admin/users` (role validation, password hashing, 409); remove `PUT /:id/role` and `PUT /:id/status`; create unified `PUT /:id` with 404 guard; create `PUT /:id/password`; create `DELETE /:id` with 404 + last-admin guard |
| `server/seed.js` | Set `password_hash` for seeded jeffk user |
| `src/components/auth/LoginPage.tsx` | Replace dropdown with email + password fields |
| `src/api/index.ts` | Update `auth.login` signature; replace `admin.users` plain function and remove `admin.updateRole`/`admin.updateStatus` with new `admin.users` namespace object |
| `src/pages/AdminUsersPage.tsx` | Replace existing file — full user management UI with modals, password management, and CRUD |
| `src/components/sidebar/Sidebar.tsx` | Version bump to v1.1.1 |

## Security Notes

- Passwords hashed with bcrypt cost factor 10
- Admin endpoints protected by both `requireAuth` and `requireAdmin` (existing middleware)
- Cannot delete the last admin user
- `password_hash` never returned in any API response; `has_password` boolean computed server-side
- `bcrypt.compare` is timing-safe
