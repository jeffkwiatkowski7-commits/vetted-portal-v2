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

If a user has no password set (`password_hash IS NULL`), login is rejected with `401`.

## Database

### Schema change

Add `password_hash TEXT` column to the `users` table (nullable):

```sql
ALTER TABLE users ADD COLUMN password_hash TEXT;
```

### Migration

A one-time migration runs at server startup (before the app begins serving requests):
- If `password_hash` column does not exist, add it.
- Set `jeffk@vettedbot.com`'s `password_hash` to bcrypt hash of `Vetted@3:16` (cost factor 10).

### Seed

`server/seed.js` sets `password_hash` for the seeded `jeffk@vettedbot.com` user so fresh databases start with a working login.

## Backend

### `server/index.js` changes

**`POST /api/auth/login`**

Accepts `{ email, password }`. Verifies password with `bcrypt.compare`. Error cases:
- Missing email or password → `400`
- User not found → `404`
- User inactive → `403`
- Password wrong or not set → `401 { error: 'Invalid password' }`

**New middleware: `requireAdmin`**

```js
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
```

Applied to all `/api/admin/users*` endpoints after `requireAuth`.

**New admin user endpoints** (all require `requireAuth` + `requireAdmin`):

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/users` | List all users |
| `POST` | `/api/admin/users` | Create user |
| `PUT` | `/api/admin/users/:id` | Edit user fields |
| `PUT` | `/api/admin/users/:id/password` | Set/reset password |
| `DELETE` | `/api/admin/users/:id` | Delete user |

**`GET /api/admin/users`** — returns array of all users (id, email, display_name, job_title, department, role, status, created_at, last_login_at, has_password boolean).

**`POST /api/admin/users`** — body: `{ email, display_name, job_title, department, role, password? }`. Generates UUID, inserts user. If `password` provided, hashes with bcrypt cost 10. Returns created user.

**`PUT /api/admin/users/:id`** — body: any subset of `{ email, display_name, job_title, department, role, status }`. Updates provided fields only.

**`PUT /api/admin/users/:id/password`** — body: `{ password }`. Hashes and updates `password_hash`. Returns `{ success: true }`.

**`DELETE /api/admin/users/:id`** — deletes user. Blocked (returns `400`) if deleting would leave zero admins.

### Dependency

`bcrypt` added via `npm install bcrypt`. Used only in auth and admin user endpoints.

## Frontend

### `src/components/auth/LoginPage.tsx`

Replace demo user dropdown with:
- Email text input (type `email`)
- Password input (type `password`) with show/hide toggle button
- Remove `DEMO_USERS` array
- Remove "Demo mode" hint text
- API call sends `{ email, password }` to `api.auth.login`

### `src/api/index.ts`

**`api.auth.login`**: update to send `{ email, password }`.

**New `api.admin.users`**:
```ts
api.admin.users = {
  list: () => request('/admin/users'),
  create: (data) => request('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setPassword: (id, password) => request(`/admin/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  remove: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
};
```

### `src/pages/AdminPage.tsx`

Add `'users'` to the tabs array. When the Users tab is active, render `<AdminUsersPanel />`.

### `src/components/admin/AdminUsersPanel.tsx` (new file)

Self-contained component. State: user list, search query, modal state (none | add | edit | password), selected user for edit.

**Layout:**
- Stats row: Total Users, Active, Admins, Password Set
- Toolbar: search input + "Add User" button
- User table with columns: User (avatar + name + email), Role, Password, Status, Last Login, Actions
- Role displayed as badge (Admin = amber, User = indigo)
- Password column: "✓ Set" (green) or "✗ Not set" (red)
- Action buttons per row: Edit, Password (🔑), Delete (hidden for own account, blocked if last admin)

**Modals:**

*Add User modal* — fields: First Name, Last Name, Email, Job Title, Department, Role (select: user/admin), Password, Confirm Password. Submit calls `api.admin.users.create`.

*Edit User modal* — same fields pre-filled. Password fields optional (blank = unchanged). Submit calls `api.admin.users.update` (and `setPassword` if password provided).

*Reset Password modal* — Password + Confirm Password only. Submit calls `api.admin.users.setPassword`.

All modals validate that password and confirm match before submitting. Errors displayed inline.

## Files Modified

| File | Change |
|---|---|
| `server/index.js` | Add bcrypt import; migration on startup; update login endpoint; add `requireAdmin` middleware; add 5 admin user endpoints |
| `server/seed.js` | Set `password_hash` for seeded jeffk user |
| `src/components/auth/LoginPage.tsx` | Replace dropdown with email + password fields |
| `src/api/index.ts` | Update `auth.login` signature; add `admin.users` methods |
| `src/pages/AdminPage.tsx` | Add Users tab |
| `src/components/admin/AdminUsersPanel.tsx` | **New** — full user management UI |
| `src/components/sidebar/Sidebar.tsx` | Version bump |

## Security Notes

- Passwords hashed with bcrypt cost factor 10
- Admin endpoints protected by both `requireAuth` and `requireAdmin`
- Cannot delete the last admin user
- `password_hash` never returned in any API response
- `has_password` boolean returned instead (for UI display)
