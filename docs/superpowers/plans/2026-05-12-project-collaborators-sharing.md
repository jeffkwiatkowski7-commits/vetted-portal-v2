# Project Collaborators & Sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let project owners invite collaborators (editor) and shared-with users (viewer) by email; in-app notify on share; show "Shared with me" tab; manage all access from an accordion section at the top of project setup.

**Architecture:** Builds on existing `projects.owner_id` + `project_members.permission` schema. Two additive columns (`invited_by`, `invited_at`). Five new endpoints (`/access`, `/invite`, `PATCH member`, `/transfer-ownership`, `/leave`) plus `/api/users/search`. Frontend rebuilds project setup as an accordion (replacing the existing `ProjectForm` modal); access management lives as the first accordion panel. No external email service — in-app notifications via existing `notifications` table.

**Tech Stack:** Node/Express + SQLite (sql.js) backend; React + TypeScript + Vite + Tailwind frontend; Zustand store; lucide-react icons. No test runner — verification is curl + browser.

**Reference docs:**
- Spec: [docs/superpowers/specs/2026-05-12-project-collaborators-sharing-design.md](../specs/2026-05-12-project-collaborators-sharing-design.md)
- Layout mockup: [docs/superpowers/specs/mockups/2026-05-12-project-setup-layouts.html](../specs/mockups/2026-05-12-project-setup-layouts.html) (accordion was selected)

**Verification baseline (run before starting):**
```bash
npm run dev    # frontend on 5173, backend on 3000
# Log in as admin@vetted.com, navigate to /projects
```

---

## Workstream 1 — Backend foundations

### Task 1: Add `invited_by` and `invited_at` columns to `project_members`

**Files:**
- Modify: `server/database.js` (additive ALTER TABLEs near line 428–440 where existing additive migrations live)

- [ ] **Step 1: Add migration block**

In `server/database.js`, find the block that does `try { db.run(`ALTER TABLE projects ADD COLUMN mcp_servers ...`) } catch ...` (around line 430). Add immediately below it:

```javascript
// Project member invite tracking
try { db.run(`ALTER TABLE project_members ADD COLUMN invited_by TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }
try { db.run(`ALTER TABLE project_members ADD COLUMN invited_at TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }
```

- [ ] **Step 2: Restart backend, verify columns exist**

Run:
```bash
# Kill the dev server (Ctrl+C) and restart
npm run dev:backend
```

In a separate shell:
```bash
sqlite3 /Users/jeffkwiatkowski/vetted_portal_v2/data/vetted_portal.db "PRAGMA table_info(project_members);"
```

Expected output includes rows for `invited_by` and `invited_at`.

- [ ] **Step 3: Commit**

```bash
git add server/database.js
git commit -m "feat(db): add invited_by/invited_at to project_members"
```

---

### Task 2: Add `requireProjectOwner` middleware

**Files:**
- Modify: `server/index.js` (add helper next to `getProjectAccess` near line 514)

- [ ] **Step 1: Add helper above `requireAuth`**

In `server/index.js`, find `function canReadProject(level) { return level !== 'none'; }` (around line 538). Add immediately after:

```javascript
// Middleware: caller must be project owner OR global admin.
// Sets req.project for downstream handlers.
function requireProjectOwner(req, res, next) {
  const { project, level } = getProjectAccess(req.params.id, req.user);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (level !== 'owner' && level !== 'admin') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  req.project = project;
  next();
}
```

- [ ] **Step 2: Verify backend still boots**

Run `npm run dev:backend`. Confirm no syntax errors in the console.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(server): add requireProjectOwner middleware"
```

---

## Workstream 2 — Backend endpoints

### Task 3: `GET /api/users/search?q=<query>`

**Files:**
- Modify: `server/index.js` (add new endpoint near the existing `/api/search` endpoint at line 3626)

- [ ] **Step 1: Add endpoint**

In `server/index.js`, immediately before `app.get('/api/search', ...)` (line 3626), add:

```javascript
// User lookup for invite autocomplete. Returns minimal fields for any
// authenticated caller (NOT admin-gated, unlike /api/admin/users).
// Matches case-insensitive substring on email and display_name.
app.get('/api/users/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ users: [] });
  const pattern = `%${q.toLowerCase()}%`;
  const users = dbAll(db, `
    SELECT id, email, display_name, avatar_path
    FROM users
    WHERE status = 'active'
      AND (LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?)
    ORDER BY display_name
    LIMIT 10
  `, [pattern, pattern]);
  res.json({ users });
});
```

- [ ] **Step 2: Verify with curl**

Get an admin user_id first:
```bash
sqlite3 /Users/jeffkwiatkowski/vetted_portal_v2/data/vetted_portal.db "SELECT id FROM users WHERE email='admin@vetted.com';"
```

Then:
```bash
curl -s -H "X-User-Id: <admin-id>" "http://localhost:3000/api/users/search?q=jam" | head
```

Expected: JSON object `{"users":[{...},...]}` with at least one match (the seeded `james.wilson@company.com`).

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(api): add /api/users/search for invite autocomplete"
```

---

### Task 4: `GET /api/projects/:id/access`

**Files:**
- Modify: `server/index.js` (add near existing `/api/projects/:id/members` endpoints at line 1751)

- [ ] **Step 1: Add endpoint**

In `server/index.js`, immediately above `app.post('/api/projects/:id/members', ...)` (line 1751), add:

```javascript
// Returns enriched access info: owner user + all members with user details.
// Any member (or admin) can read.
app.get('/api/projects/:id/access', requireAuth, (req, res) => {
  const { project, level } = getProjectAccess(req.params.id, req.user);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canReadProject(level)) return res.status(403).json({ error: 'Forbidden' });

  const owner = dbGet(db, 'SELECT id, email, display_name, avatar_path FROM users WHERE id = ?', [project.owner_id]);
  const members = dbAll(db, `
    SELECT pm.id, pm.user_id, pm.permission, pm.invited_by, pm.invited_at, pm.created_at,
           u.email, u.display_name, u.avatar_path
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ?
    ORDER BY pm.created_at ASC
  `, [req.params.id]);

  res.json({
    project_id: project.id,
    owner,
    members,
    your_level: level
  });
});
```

- [ ] **Step 2: Verify with curl**

Pick a project id:
```bash
sqlite3 /Users/jeffkwiatkowski/vetted_portal_v2/data/vetted_portal.db "SELECT id, name FROM projects LIMIT 1;"
```

Then:
```bash
curl -s -H "X-User-Id: <admin-id>" "http://localhost:3000/api/projects/<project-id>/access" | head -c 400
```

Expected: JSON with `owner`, `members` array, `your_level` field.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(api): add GET /projects/:id/access for member listing"
```

---

### Task 5: `POST /api/projects/:id/invite` (email-based, owner-only)

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add endpoint**

In `server/index.js`, immediately above the existing `app.post('/api/projects/:id/members', ...)` (line 1751), add:

```javascript
// Owner-only: invite by email. Resolves email -> user; errors if email
// is not a known portal user. Inserts or updates project_members; on
// re-invite, refreshes invited_at and re-fires the notification.
// Writes to audit_log.
app.post('/api/projects/:id/invite', requireAuth, requireProjectOwner, (req, res) => {
  const { email, permission } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  const perm = permission === 'editor' ? 'editor' : 'viewer';

  const target = dbGet(db, 'SELECT id, email, display_name FROM users WHERE LOWER(email) = LOWER(?) AND status = ?', [email.trim(), 'active']);
  if (!target) {
    return res.status(404).json({ error: 'No portal user with that email', email_searched: email });
  }
  if (target.id === req.project.owner_id) {
    return res.status(400).json({ error: 'User is already the owner' });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ error: "You can't share a project with yourself" });
  }

  const now = new Date().toISOString();
  const existing = dbGet(db, 'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, target.id]);
  let memberId;
  if (existing) {
    memberId = existing.id;
    dbRun(db, `
      UPDATE project_members SET permission = ?, invited_by = ?, invited_at = ? WHERE id = ?
    `, [perm, req.user.id, now, memberId]);
  } else {
    memberId = uuidv4();
    dbRun(db, `
      INSERT INTO project_members (id, project_id, user_id, permission, invited_by, invited_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [memberId, req.params.id, target.id, perm, req.user.id, now, now]);
  }

  // In-app notification (respect user_preferences.notify_project_updates)
  const prefs = dbGet(db, 'SELECT notify_project_updates FROM user_preferences WHERE user_id = ?', [target.id]);
  const wantsNotif = !prefs || prefs.notify_project_updates !== 0;
  if (wantsNotif) {
    dbRun(db, `
      INSERT INTO notifications (id, user_id, type, title, description, link, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `, [
      uuidv4(),
      target.id,
      'project_share',
      `${req.user.display_name} shared "${req.project.name}" with you`,
      perm === 'editor' ? 'You can edit this project.' : 'You can view this project.',
      `/projects/${req.params.id}`,
      now
    ]);
  }

  auditLog({
    userId: req.user.id,
    action: existing ? 'project_member_reinvited' : 'project_member_invited',
    resourceType: 'project',
    resourceId: req.params.id,
    details: JSON.stringify({ target_user_id: target.id, permission: perm })
  });

  res.status(existing ? 200 : 201).json({
    member: {
      id: memberId,
      project_id: req.params.id,
      user_id: target.id,
      email: target.email,
      display_name: target.display_name,
      permission: perm,
      invited_at: now
    },
    re_invited: !!existing
  });
});
```

- [ ] **Step 2: Verify with curl — successful invite**

```bash
# Get a non-admin user email from seeds
sqlite3 /Users/jeffkwiatkowski/vetted_portal_v2/data/vetted_portal.db "SELECT email FROM users WHERE role='user' LIMIT 1;"

curl -s -X POST -H "X-User-Id: <owner-id>" -H "Content-Type: application/json" \
  -d '{"email":"<that-email>","permission":"editor"}' \
  "http://localhost:3000/api/projects/<project-id>/invite" | head
```

Expected: 201 + member JSON. Then verify the notification was created:
```bash
sqlite3 /Users/jeffkwiatkowski/vetted_portal_v2/data/vetted_portal.db \
  "SELECT type, title FROM notifications ORDER BY created_at DESC LIMIT 1;"
```

- [ ] **Step 3: Verify error cases**

Unknown email (expect 404):
```bash
curl -s -X POST -H "X-User-Id: <owner-id>" -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com","permission":"viewer"}' \
  "http://localhost:3000/api/projects/<project-id>/invite"
```

Self (expect 400):
```bash
curl -s -X POST -H "X-User-Id: <owner-id>" -H "Content-Type: application/json" \
  -d '{"email":"<owner-email>","permission":"viewer"}' \
  "http://localhost:3000/api/projects/<project-id>/invite"
```

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(api): POST /projects/:id/invite with email lookup and notification"
```

---

### Task 6: `PATCH /api/projects/:id/members/:userId` — change permission

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add endpoint**

In `server/index.js`, immediately above `app.delete('/api/projects/:id/members/:userId', ...)` (line 1782), add:

```javascript
// Owner-only: change a member's permission (viewer <-> editor).
app.patch('/api/projects/:id/members/:userId', requireAuth, requireProjectOwner, (req, res) => {
  const { permission } = req.body || {};
  const perm = permission === 'editor' ? 'editor' : 'viewer';
  const member = dbGet(db, 'SELECT id, permission FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  dbRun(db, 'UPDATE project_members SET permission = ? WHERE id = ?', [perm, member.id]);
  auditLog({
    userId: req.user.id,
    action: 'project_member_permission_changed',
    resourceType: 'project',
    resourceId: req.params.id,
    details: JSON.stringify({ target_user_id: req.params.userId, old_permission: member.permission, new_permission: perm })
  });
  res.json({ success: true, permission: perm });
});
```

- [ ] **Step 2: Verify with curl**

```bash
curl -s -X PATCH -H "X-User-Id: <owner-id>" -H "Content-Type: application/json" \
  -d '{"permission":"viewer"}' \
  "http://localhost:3000/api/projects/<project-id>/members/<member-user-id>"
```

Expected: `{"success":true,"permission":"viewer"}`. Then check the row:
```bash
sqlite3 /Users/jeffkwiatkowski/vetted_portal_v2/data/vetted_portal.db \
  "SELECT permission FROM project_members WHERE project_id='<project-id>' AND user_id='<member-id>';"
```

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(api): PATCH /projects/:id/members/:userId to change permission"
```

---

### Task 7: `POST /api/projects/:id/transfer-ownership`

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add endpoint**

In `server/index.js`, immediately after the new PATCH endpoint from Task 6, add:

```javascript
// Owner-only: transfer ownership to an existing member. Demotes old owner
// to editor. Atomic via single transaction-equivalent run.
app.post('/api/projects/:id/transfer-ownership', requireAuth, requireProjectOwner, (req, res) => {
  const { new_owner_user_id } = req.body || {};
  if (!new_owner_user_id) return res.status(400).json({ error: 'new_owner_user_id is required' });
  if (new_owner_user_id === req.user.id) return res.status(400).json({ error: 'You are already the owner' });

  const member = dbGet(db, 'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, new_owner_user_id]);
  if (!member) return res.status(400).json({ error: 'New owner must already be a member of the project' });

  const newOwner = dbGet(db, 'SELECT id, display_name, email FROM users WHERE id = ?', [new_owner_user_id]);
  if (!newOwner) return res.status(404).json({ error: 'User not found' });

  const oldOwnerId = req.project.owner_id;
  const now = new Date().toISOString();

  // Promote new owner: remove their member row
  dbRun(db, 'DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, new_owner_user_id]);
  // Demote old owner: insert as editor
  dbRun(db, `
    INSERT INTO project_members (id, project_id, user_id, permission, invited_by, invited_at, created_at)
    VALUES (?, ?, ?, 'editor', ?, ?, ?)
  `, [uuidv4(), req.params.id, oldOwnerId, oldOwnerId, now, now]);
  // Flip owner_id
  dbRun(db, 'UPDATE projects SET owner_id = ?, updated_at = ? WHERE id = ?', [new_owner_user_id, now, req.params.id]);

  // Notify both
  for (const uid of [oldOwnerId, new_owner_user_id]) {
    dbRun(db, `
      INSERT INTO notifications (id, user_id, type, title, description, link, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `, [
      uuidv4(),
      uid,
      'project_share',
      `Ownership of "${req.project.name}" was transferred to ${newOwner.display_name}`,
      uid === new_owner_user_id ? 'You are now the owner.' : 'You are now an editor on this project.',
      `/projects/${req.params.id}`,
      now
    ]);
  }

  auditLog({
    userId: req.user.id,
    action: 'project_ownership_transferred',
    resourceType: 'project',
    resourceId: req.params.id,
    details: JSON.stringify({ from: oldOwnerId, to: new_owner_user_id })
  });

  res.json({ success: true, owner_id: new_owner_user_id });
});
```

- [ ] **Step 2: Verify with curl**

Set up: pick a project where you're owner and a member exists.
```bash
curl -s -X POST -H "X-User-Id: <owner-id>" -H "Content-Type: application/json" \
  -d '{"new_owner_user_id":"<member-id>"}' \
  "http://localhost:3000/api/projects/<project-id>/transfer-ownership"
```

Expected: `{"success":true,"owner_id":"<member-id>"}`. Verify:
```bash
sqlite3 /Users/jeffkwiatkowski/vetted_portal_v2/data/vetted_portal.db \
  "SELECT owner_id FROM projects WHERE id='<project-id>'; SELECT user_id, permission FROM project_members WHERE project_id='<project-id>';"
```

The old owner should now be in `project_members` as 'editor', and `owner_id` should be the new user.

**Important:** transfer the project back before the next task so other tests still work:
```bash
curl -s -X POST -H "X-User-Id: <new-owner-id>" -H "Content-Type: application/json" \
  -d '{"new_owner_user_id":"<original-owner-id>"}' \
  "http://localhost:3000/api/projects/<project-id>/transfer-ownership"
```

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(api): POST /projects/:id/transfer-ownership"
```

---

### Task 8: `POST /api/projects/:id/leave`

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add endpoint**

In `server/index.js`, immediately after the transfer-ownership endpoint, add:

```javascript
// Self-leave for non-owners. Owner cannot leave (must transfer first).
app.post('/api/projects/:id/leave', requireAuth, (req, res) => {
  const { project, level } = getProjectAccess(req.params.id, req.user);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (level === 'owner') return res.status(400).json({ error: 'Owner cannot leave; transfer ownership first' });
  if (level === 'none') return res.status(400).json({ error: 'You are not a member of this project' });

  dbRun(db, 'DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  auditLog({
    userId: req.user.id,
    action: 'project_left',
    resourceType: 'project',
    resourceId: req.params.id,
    details: null
  });
  res.json({ success: true });
});
```

- [ ] **Step 2: Verify with curl**

```bash
# Add yourself first
curl -s -X POST -H "X-User-Id: <owner-id>" -H "Content-Type: application/json" \
  -d '{"email":"<other-user-email>","permission":"viewer"}' \
  "http://localhost:3000/api/projects/<project-id>/invite"

# Leave as that other user
curl -s -X POST -H "X-User-Id: <other-user-id>" \
  "http://localhost:3000/api/projects/<project-id>/leave"
```

Expected: `{"success":true}`. Verify the row is gone:
```bash
sqlite3 /Users/jeffkwiatkowski/vetted_portal_v2/data/vetted_portal.db \
  "SELECT COUNT(*) FROM project_members WHERE project_id='<project-id>' AND user_id='<other-user-id>';"
```

Returns `0`.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(api): POST /projects/:id/leave for self-removal"
```

---

### Task 9: Augment `DELETE /api/projects/:id/members/:userId` with notification + audit

**Files:**
- Modify: `server/index.js` (lines 1782–1792 — the existing endpoint)

- [ ] **Step 1: Replace the existing endpoint body**

Find the existing `app.delete('/api/projects/:id/members/:userId', requireAuth, ...)` block (around line 1782). Replace its body so the whole endpoint reads:

```javascript
app.delete('/api/projects/:id/members/:userId', requireAuth, requireProjectOwner, (req, res) => {
  const member = dbGet(db, 'SELECT id, permission FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  dbRun(db, 'DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.params.userId]);

  // Notify the removed user (if they want project_updates)
  const prefs = dbGet(db, 'SELECT notify_project_updates FROM user_preferences WHERE user_id = ?', [req.params.userId]);
  const wantsNotif = !prefs || prefs.notify_project_updates !== 0;
  if (wantsNotif) {
    dbRun(db, `
      INSERT INTO notifications (id, user_id, type, title, description, link, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, 0, ?)
    `, [
      uuidv4(),
      req.params.userId,
      'project_unshare',
      `${req.user.display_name} removed your access to "${req.project.name}"`,
      null,
      new Date().toISOString()
    ]);
  }

  auditLog({
    userId: req.user.id,
    action: 'project_member_removed',
    resourceType: 'project',
    resourceId: req.params.id,
    details: JSON.stringify({ target_user_id: req.params.userId, was_permission: member.permission })
  });

  res.json({ success: true });
});
```

This swaps the inline ownership check for `requireProjectOwner` (preserving the same authorization) and adds notification + audit.

- [ ] **Step 2: Verify with curl**

```bash
# Add a member
curl -s -X POST -H "X-User-Id: <owner-id>" -H "Content-Type: application/json" \
  -d '{"email":"<other-email>","permission":"viewer"}' \
  "http://localhost:3000/api/projects/<project-id>/invite"

# Remove them
curl -s -X DELETE -H "X-User-Id: <owner-id>" \
  "http://localhost:3000/api/projects/<project-id>/members/<other-user-id>"

# Confirm notification fired
sqlite3 /Users/jeffkwiatkowski/vetted_portal_v2/data/vetted_portal.db \
  "SELECT type, title FROM notifications WHERE user_id='<other-user-id>' ORDER BY created_at DESC LIMIT 1;"
```

Expected: row with `type='project_unshare'`.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(api): notify and audit on project member removal"
```

---

### Task 10: Add `scope` query param to `GET /api/projects`

**Files:**
- Modify: `server/index.js` (line 1619)

- [ ] **Step 1: Replace the endpoint body**

Find `app.get('/api/projects', requireAuth, (req, res) => { ... })` (line 1619). Replace its body so the whole endpoint reads:

```javascript
app.get('/api/projects', requireAuth, (req, res) => {
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
  const scope = req.query.scope === 'owned' || req.query.scope === 'shared' ? req.query.scope : 'all';

  let projects;
  if (isAdmin && scope === 'all') {
    projects = dbAll(db, `SELECT p.*, u.display_name as owner_name FROM projects p LEFT JOIN users u ON p.owner_id = u.id ORDER BY p.updated_at DESC`);
  } else if (scope === 'owned') {
    projects = dbAll(db, `
      SELECT p.*, u.display_name as owner_name
      FROM projects p LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.owner_id = ?
      ORDER BY p.updated_at DESC
    `, [req.user.id]);
  } else if (scope === 'shared') {
    projects = dbAll(db, `
      SELECT p.*, u.display_name as owner_name, pm.permission as permission
      FROM projects p
      LEFT JOIN users u ON p.owner_id = u.id
      INNER JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = ?
      ORDER BY p.updated_at DESC
    `, [req.user.id]);
  } else {
    // scope === 'all' (non-admin): owned ∪ member-of, with permission column populated for member rows
    projects = dbAll(db, `
      SELECT DISTINCT p.*, u.display_name as owner_name,
             (SELECT permission FROM project_members WHERE project_id = p.id AND user_id = ?) as permission
      FROM projects p
      LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.owner_id = ? OR p.id IN (
        SELECT project_id FROM project_members WHERE user_id = ?
      )
      ORDER BY p.updated_at DESC
    `, [req.user.id, req.user.id, req.user.id]);
  }

  const result = projects.map(p => ({
    ...p,
    tool_sets: p.tool_sets ? JSON.parse(p.tool_sets) : []
  }));

  res.json({ projects: result });
});
```

- [ ] **Step 2: Verify each scope**

```bash
curl -s -H "X-User-Id: <user-id>" "http://localhost:3000/api/projects?scope=owned" | head -c 200
curl -s -H "X-User-Id: <user-id>" "http://localhost:3000/api/projects?scope=shared" | head -c 200
curl -s -H "X-User-Id: <user-id>" "http://localhost:3000/api/projects?scope=all" | head -c 200
```

Expected: `owned` returns only projects where `owner_id = user`; `shared` returns only projects where the user is a member; `all` returns the union and includes a `permission` field on each row (null when owned).

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(api): support scope=owned|shared|all on GET /projects"
```

---

## Workstream 3 — Frontend types + API client

### Task 11: Update types in `src/types/index.ts`

**Files:**
- Modify: `src/types/index.ts` (lines 62–91 — `Project` and `ProjectMember`)

- [ ] **Step 1: Update `ProjectMember` and add `ProjectAccess`**

Find `export interface ProjectMember` (line 83). Replace it with:

```typescript
export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  permission: 'viewer' | 'editor';
  invited_by?: string | null;
  invited_at?: string | null;
  created_at: string;
  // Joined user fields (returned by /access endpoint)
  email?: string;
  display_name?: string;
  avatar_path?: string | null;
}

export interface ProjectOwner {
  id: string;
  email: string;
  display_name: string;
  avatar_path?: string | null;
}

export interface ProjectAccess {
  project_id: string;
  owner: ProjectOwner;
  members: ProjectMember[];
  your_level: 'owner' | 'editor' | 'viewer' | 'admin' | 'none';
}

export interface UserSearchResult {
  id: string;
  email: string;
  display_name: string;
  avatar_path?: string | null;
}
```

- [ ] **Step 2: Verify TypeScript**

Run:
```bash
npx tsc --noEmit
```

Expected: no errors related to the changed types. (Pre-existing errors elsewhere are out of scope.)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add ProjectAccess, ProjectOwner, UserSearchResult"
```

---

### Task 12: Add API methods in `src/api/index.ts`

**Files:**
- Modify: `src/api/index.ts` (lines 183–191 — `projects` block)

- [ ] **Step 1: Extend `projects` and add `users.search`**

Replace the existing `export const projects = { ... }` block (lines 183–191) with:

```typescript
export const projects = {
  list: (scope?: 'owned' | 'shared' | 'all') =>
    request(`/projects${scope ? `?scope=${scope}` : ''}`).then(d => d.projects || d || []),
  create: (data: any) => request('/projects', { method: 'POST', body: JSON.stringify(data) }).then(d => d.project || d),
  get: (id: string) => request(`/projects/${id}`).then(d => d.project || d),
  update: (id: string, data: any) => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.project || d),
  delete: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),
  // Legacy — kept for callers that still use it
  addMember: (id: string, data: any) => request(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify(data) }),
  removeMember: (id: string, userId: string) => request(`/projects/${id}/members/${userId}`, { method: 'DELETE' }),
  // New
  access: (id: string) => request(`/projects/${id}/access`),
  invite: (id: string, email: string, permission: 'editor' | 'viewer') =>
    request(`/projects/${id}/invite`, { method: 'POST', body: JSON.stringify({ email, permission }) }),
  updateMember: (id: string, userId: string, permission: 'editor' | 'viewer') =>
    request(`/projects/${id}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ permission }) }),
  transferOwnership: (id: string, newOwnerUserId: string) =>
    request(`/projects/${id}/transfer-ownership`, { method: 'POST', body: JSON.stringify({ new_owner_user_id: newOwnerUserId }) }),
  leave: (id: string) => request(`/projects/${id}/leave`, { method: 'POST' }),
};

export const users = {
  search: (q: string) => request(`/users/search?q=${encodeURIComponent(q)}`).then(d => d.users || []),
};
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors related to the new API methods.

- [ ] **Step 3: Commit**

```bash
git add src/api/index.ts
git commit -m "feat(api-client): add access/invite/transfer/leave + users.search"
```

---

## Workstream 4 — Frontend components

### Task 13: `EmailAutocomplete` component

**Files:**
- Create: `src/components/projects/EmailAutocomplete.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/projects/EmailAutocomplete.tsx`:

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import * as api from '../../api';
import type { UserSearchResult } from '../../types';

interface Props {
  placeholder?: string;
  excludeUserIds?: string[];
  onSelect: (user: UserSearchResult) => void;
  onSubmit?: (email: string) => void;  // when user types email + presses enter, no match selected
  disabled?: boolean;
}

export default function EmailAutocomplete({ placeholder, excludeUserIds = [], onSelect, onSubmit, disabled }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const users = await api.users.search(q.trim());
        setResults(users.filter((u: UserSearchResult) => !excludeUserIds.includes(u.id)));
        setOpen(true);
        setHighlight(0);
      } catch {
        setResults([]);
      }
    }, 180);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [q, excludeUserIds.join(',')]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlight]) { onSelect(results[highlight]); setQ(''); setOpen(false); }
      else if (onSubmit && q.includes('@')) { onSubmit(q.trim()); }
    } else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-vetted-text-muted" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder || 'name or email'}
          disabled={disabled}
          className="w-full pl-9 pr-3 py-2 text-sm border border-vetted-border rounded-lg bg-white focus:outline-none focus:border-vetted-accent disabled:opacity-50"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-vetted-border rounded-lg shadow-lg z-30 max-h-64 overflow-y-auto">
          {results.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => { onSelect(u); setQ(''); setOpen(false); }}
              className={`w-full text-left px-3 py-2 flex items-center gap-2.5 ${i === highlight ? 'bg-vetted-surface' : 'hover:bg-vetted-surface'}`}
            >
              <div className="w-7 h-7 rounded-full bg-vetted-primary text-white text-xs flex items-center justify-center flex-shrink-0">
                {u.display_name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-vetted-primary truncate">{u.display_name}</div>
                <div className="text-xs text-vetted-text-muted truncate">{u.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/projects/EmailAutocomplete.tsx
git commit -m "feat(ui): EmailAutocomplete component for invite flow"
```

---

### Task 14: `AccordionSection` reusable component

**Files:**
- Create: `src/components/projects/AccordionSection.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/projects/AccordionSection.tsx`:

```typescript
import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
  num?: string;            // 'i', 'ii', etc.
  title: string;
  summary: string;         // one-line state shown in header
  defaultOpen?: boolean;
  rightAside?: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}

export default function AccordionSection({ num, title, summary, defaultOpen, rightAside, danger, children }: Props) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition-shadow ${open ? 'shadow-md' : 'shadow-sm'} ${danger ? 'border-red-200' : 'border-vetted-border'}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-4 px-5 py-4 text-left ${open ? '' : 'hover:bg-vetted-surface'} transition-colors`}
      >
        {num && (
          <span className={`font-serif italic text-xs font-bold w-5 ${danger ? 'text-red-600' : 'text-vetted-accent'}`}>
            {num}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h3 className={`font-serif font-bold text-base ${danger ? 'text-red-600' : 'text-vetted-primary'}`}>{title}</h3>
          <p className="text-xs text-vetted-text-muted mt-0.5 truncate">{summary}</p>
        </div>
        {rightAside}
        <ChevronRight size={16} className={`text-vetted-text-muted transition-transform ${open ? 'rotate-90 text-vetted-accent' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pt-4 pb-5 border-t border-vetted-border/50">
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/projects/AccordionSection.tsx
git commit -m "feat(ui): AccordionSection reusable panel"
```

---

### Task 15: `AccessSection` content component

**Files:**
- Create: `src/components/projects/AccessSection.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/projects/AccessSection.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { X, ArrowLeftRight, LogOut, Crown } from 'lucide-react';
import * as api from '../../api';
import { useStore } from '../../store';
import type { ProjectAccess, ProjectMember, ProjectOwner, UserSearchResult } from '../../types';
import EmailAutocomplete from './EmailAutocomplete';

interface Props {
  projectId: string;
  onAccessChange?: (access: ProjectAccess) => void;  // notifies parent for header summary
}

function initials(name: string) {
  return name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
}

function MemberAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'w-7 h-7 text-xs' : size === 'lg' ? 'w-11 h-11 text-sm' : 'w-9 h-9 text-xs';
  return (
    <div className={`${dim} rounded-full bg-gradient-to-br from-vetted-primary to-vetted-text-muted text-white flex items-center justify-center flex-shrink-0 font-semibold`}>
      {initials(name)}
    </div>
  );
}

function RoleChip({ role }: { role: 'owner' | 'editor' | 'viewer' }) {
  const cls = role === 'owner'
    ? 'bg-vetted-primary text-vetted-accent'
    : role === 'editor'
      ? 'bg-vetted-accent/15 text-vetted-accent border border-vetted-accent/30'
      : 'bg-white text-vetted-text-muted border border-vetted-border';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {role === 'owner' && <Crown size={10} />}
      {role}
    </span>
  );
}

export default function AccessSection({ projectId, onAccessChange }: Props) {
  const { addToast, currentUser } = useStore();
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const data = await api.projects.access(projectId);
      setAccess(data);
      onAccessChange?.(data);
    } catch {
      addToast({ type: 'error', title: 'Failed to load access' });
    }
  }

  useEffect(() => { reload(); }, [projectId]);

  if (!access) return <p className="text-sm text-vetted-text-muted">Loading…</p>;

  const isOwner = access.your_level === 'owner' || access.your_level === 'admin';
  const collaborators = access.members.filter(m => m.permission === 'editor');
  const viewers = access.members.filter(m => m.permission === 'viewer');
  const memberUserIds = [access.owner.id, ...access.members.map(m => m.user_id)];

  async function handleInvite(email: string, permission: 'editor' | 'viewer') {
    setBusy(true);
    try {
      await api.projects.invite(projectId, email, permission);
      addToast({ type: 'success', title: `Invited as ${permission}` });
      await reload();
    } catch (err: any) {
      const msg = err?.message?.includes('No portal user')
        ? `No user with email "${email}" exists in the portal.`
        : err?.message || 'Invite failed';
      addToast({ type: 'error', title: msg });
    } finally { setBusy(false); }
  }

  async function handleSelectFromAutocomplete(user: UserSearchResult, permission: 'editor' | 'viewer') {
    await handleInvite(user.email, permission);
  }

  async function handleRemove(userId: string) {
    if (!confirm('Remove this member?')) return;
    setBusy(true);
    try {
      await api.projects.removeMember(projectId, userId);
      addToast({ type: 'success', title: 'Member removed' });
      await reload();
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Remove failed' });
    } finally { setBusy(false); }
  }

  async function handleChangePermission(userId: string, permission: 'editor' | 'viewer') {
    setBusy(true);
    try {
      await api.projects.updateMember(projectId, userId, permission);
      await reload();
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Update failed' });
    } finally { setBusy(false); }
  }

  async function handleTransfer() {
    if (collaborators.length === 0) {
      addToast({ type: 'error', title: 'Add a collaborator first to transfer ownership' });
      return;
    }
    const choices = collaborators.map((c, i) => `${i + 1}. ${c.display_name} (${c.email})`).join('\n');
    const pick = prompt(`Transfer ownership to which collaborator?\n\n${choices}\n\nEnter number:`);
    const idx = parseInt(pick || '', 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= collaborators.length) return;
    if (!confirm(`Transfer ownership to ${collaborators[idx].display_name}? You will become an editor.`)) return;
    setBusy(true);
    try {
      await api.projects.transferOwnership(projectId, collaborators[idx].user_id);
      addToast({ type: 'success', title: 'Ownership transferred' });
      await reload();
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Transfer failed' });
    } finally { setBusy(false); }
  }

  async function handleLeave() {
    if (!confirm('Leave this project? You will lose access.')) return;
    setBusy(true);
    try {
      await api.projects.leave(projectId);
      addToast({ type: 'success', title: 'Left project' });
      window.location.href = '/projects';
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Leave failed' });
      setBusy(false);
    }
  }

  function MemberRow({ member }: { member: ProjectMember }) {
    return (
      <div className="flex items-center gap-3 py-2.5 border-b border-vetted-border/50 last:border-b-0">
        <MemberAvatar name={member.display_name || member.email || '?'} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-vetted-primary truncate">{member.display_name}</p>
          <p className="text-xs text-vetted-text-muted truncate">{member.email}</p>
        </div>
        <RoleChip role={member.permission} />
        {isOwner && (
          <>
            <button
              type="button"
              onClick={() => handleChangePermission(member.user_id, member.permission === 'editor' ? 'viewer' : 'editor')}
              disabled={busy}
              className="text-xs text-vetted-text-muted hover:text-vetted-accent px-1"
              title={`Change to ${member.permission === 'editor' ? 'viewer' : 'editor'}`}
            >
              <ArrowLeftRight size={13} />
            </button>
            <button type="button" onClick={() => handleRemove(member.user_id)} disabled={busy} className="text-vetted-text-muted hover:text-red-600 px-1">
              <X size={14} />
            </button>
          </>
        )}
      </div>
    );
  }

  function InviteRow({ permission }: { permission: 'editor' | 'viewer' }) {
    return (
      <div className="mt-3 flex gap-2">
        <div className="flex-1">
          <EmailAutocomplete
            placeholder="email or name"
            excludeUserIds={memberUserIds}
            onSelect={(u) => handleSelectFromAutocomplete(u, permission)}
            onSubmit={(email) => handleInvite(email, permission)}
            disabled={busy}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Owner card */}
      <div className="flex items-center gap-3 bg-vetted-surface border border-vetted-border/60 rounded-xl px-4 py-3 mb-5">
        <MemberAvatar name={access.owner.display_name} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-vetted-primary">
            {access.owner.display_name}
            {access.owner.id === currentUser?.id && <span className="text-xs text-vetted-text-muted font-normal ml-2">(you)</span>}
          </p>
          <p className="text-xs text-vetted-text-muted">{access.owner.email}</p>
        </div>
        <RoleChip role="owner" />
        {isOwner && (
          <button type="button" onClick={handleTransfer} disabled={busy} className="text-xs text-vetted-text-muted hover:text-vetted-accent px-2">
            Transfer…
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Collaborators */}
        <div className="bg-vetted-surface border border-vetted-border/60 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-vetted-primary">Collaborators</h4>
            <span className="text-xs text-vetted-text-muted">{collaborators.length}</span>
          </div>
          {collaborators.length === 0
            ? <p className="text-xs text-vetted-text-muted py-3">No collaborators yet.</p>
            : collaborators.map(m => <MemberRow key={m.id} member={m} />)
          }
          {isOwner && <InviteRow permission="editor" />}
        </div>

        {/* Shared with */}
        <div className="bg-vetted-surface border border-vetted-border/60 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-vetted-primary">Shared with</h4>
            <span className="text-xs text-vetted-text-muted">{viewers.length}</span>
          </div>
          {viewers.length === 0
            ? <p className="text-xs text-vetted-text-muted py-3">Not shared with anyone yet.</p>
            : viewers.map(m => <MemberRow key={m.id} member={m} />)
          }
          {isOwner && <InviteRow permission="viewer" />}
        </div>
      </div>

      {/* Self-leave for non-owners */}
      {!isOwner && access.your_level !== 'none' && (
        <div className="mt-5 pt-4 border-t border-vetted-border flex justify-end">
          <button
            type="button"
            onClick={handleLeave}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50"
          >
            <LogOut size={12} />
            Leave project
          </button>
        </div>
      )}
    </div>
  );
}
```

**Note on `currentUser`:** if the Zustand store exposes a different name (e.g., `user`), adjust the import — see Step 2.

- [ ] **Step 2: Verify store field name**

Run:
```bash
grep -n "currentUser\|^\s*user:\|^\s*authUser:" /Users/jeffkwiatkowski/vetted_portal_v2/src/store/index.ts | head -10
```

If the store uses `user` instead of `currentUser`, replace `currentUser` with the actual field name in the file you just created. (Two occurrences: the `useStore` destructure and the `(you)` check.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Fix any field-name mismatches discovered.

- [ ] **Step 4: Commit**

```bash
git add src/components/projects/AccessSection.tsx
git commit -m "feat(ui): AccessSection panel for project sharing"
```

---

### Task 16: `ProjectSettings` accordion container (replaces inline `ProjectForm`)

**Files:**
- Create: `src/components/projects/ProjectSettings.tsx`

- [ ] **Step 1: Create the container**

Create `src/components/projects/ProjectSettings.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import * as api from '../../api';
import { useStore } from '../../store';
import type { Project, ProjectAccess } from '../../types';
import AccordionSection from './AccordionSection';
import AccessSection from './AccessSection';

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
}

export default function ProjectSettings({ project, onUpdated }: Props) {
  const { addToast } = useStore();
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [systemPrompt, setSystemPrompt] = useState(project.system_prompt || '');
  const [model, setModel] = useState(project.default_model || 'claude-opus-4-7');
  const [temperature, setTemperature] = useState(project.temperature ?? 0.7);
  const [saving, setSaving] = useState(false);

  const isOwner = access?.your_level === 'owner' || access?.your_level === 'admin';
  const isWriter = isOwner || access?.your_level === 'editor';

  async function saveGeneral() {
    setSaving(true);
    try {
      const updated = await api.projects.update(project.id, {
        name, description, system_prompt: systemPrompt,
      });
      onUpdated(updated);
      addToast({ type: 'success', title: 'Project saved' });
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Save failed' });
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-3 max-w-5xl mx-auto py-6 px-6">
      <h1 className="font-serif font-bold text-3xl text-vetted-primary mb-2">{project.name}</h1>

      <AccordionSection
        num="i"
        title="Access & Sharing"
        summary={access
          ? `${access.members.filter(m => m.permission === 'editor').length} collaborators · ${access.members.filter(m => m.permission === 'viewer').length} viewers`
          : 'Loading…'}
        defaultOpen
      >
        <AccessSection projectId={project.id} onAccessChange={setAccess} />
      </AccordionSection>

      <AccordionSection
        num="ii"
        title="General"
        summary={`${project.name}${project.status ? ` · ${project.status}` : ''}`}
        defaultOpen
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-vetted-primary mb-1">Project name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isWriter}
              className="w-full border border-vetted-border rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-vetted-primary mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isWriter}
              rows={3}
              className="w-full border border-vetted-border rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
            />
          </div>
          {isWriter && (
            <button
              type="button"
              onClick={saveGeneral}
              disabled={saving}
              className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </AccordionSection>

      <AccordionSection
        num="iii"
        title="AI Defaults"
        summary={`${model} · temp ${temperature.toFixed(2)}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-vetted-primary mb-1">System prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={!isWriter}
              rows={6}
              className="w-full border border-vetted-border rounded-lg px-3 py-2 text-sm font-mono bg-white disabled:opacity-50"
            />
          </div>
          {isWriter && (
            <button
              type="button"
              onClick={saveGeneral}
              disabled={saving}
              className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </AccordionSection>

      {/* Tools/Skills/Templates/Files: keep showing what's wired, but defer rich editors
          to a follow-up. The existing ProjectForm modal still exists for owner editing
          via the ⚙ Settings button. */}
      <AccordionSection
        num="iv"
        title="Tools, Skills, Templates, Files"
        summary="Use the ⚙ Settings button (top-right) to manage these for now"
      >
        <p className="text-sm text-vetted-text-muted">
          Detailed editors for tool sets, MCP servers, skills, branded templates, and project files
          are available in the existing project Settings dialog. They will be migrated into this
          accordion in a follow-up.
        </p>
      </AccordionSection>

      {isOwner && (
        <AccordionSection num="—" title="Danger Zone" summary="Archive or delete the project. Owner only." danger>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={async () => {
                if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
                await api.projects.delete(project.id);
                window.location.href = '/projects';
              }}
              className="text-sm text-red-600 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-600 hover:text-white"
            >
              Delete project…
            </button>
          </div>
        </AccordionSection>
      )}
    </div>
  );
}
```

**Why this scope:** ws3 task 16 explicitly does not migrate Tools/Skills/Templates/Files into the accordion — that surface is preserved via the existing ProjectForm dialog so we ship Access without rebuilding everything. The mockup shows the full vision; this PR delivers Access + General + AI in the accordion, with the rest reachable via the unchanged ⚙ button.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/projects/ProjectSettings.tsx
git commit -m "feat(ui): ProjectSettings accordion (Access + General + AI)"
```

---

### Task 17: Wire `ProjectSettings` into `ProjectDetailPage`

**Files:**
- Modify: `src/pages/ProjectDetailPage.tsx`

- [ ] **Step 1: Add a settings tab/toggle to the page**

Open `src/pages/ProjectDetailPage.tsx`. The page currently shows chat content with a "Settings" modal trigger. We're adding an inline settings view that toggles with the chat view.

Find the imports block (around line 1–11). Add:
```typescript
import ProjectSettings from '../components/projects/ProjectSettings';
```

Find the `useState` block near the top of the component (around line 19–27). Add:
```typescript
const [showInlineSettings, setShowInlineSettings] = useState(false);
```

Find the Settings button in the header (search for `Settings` icon usage around line 6 / look for `<Settings`). The button currently opens a modal (`setShowSettings(true)`). Change its handler to:

```typescript
onClick={() => setShowInlineSettings(s => !s)}
```

Find where the page returns its JSX. Immediately before the existing `<ChatView>`/`<ChatInput>` content (look for `hasChat` conditional around mid-file), add:

```tsx
{showInlineSettings && project && (
  <ProjectSettings
    project={project}
    onUpdated={(p) => setProject(p)}
  />
)}
{!showInlineSettings && (
  <>
    {/* existing chat content stays here */}
  </>
)}
```

Wrap the existing chat-area JSX in the `{!showInlineSettings && (<>...</>)}` block.

- [ ] **Step 2: Verify in browser**

```bash
npm run dev
```

Open `http://localhost:5173/projects/<some-project-id>`. Click the Settings button in the header — the chat area should swap to the new accordion. Click Settings again — chat returns. Open Access & Sharing → owner card and the two empty grids render. Add a member by typing an email; member appears.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ProjectDetailPage.tsx
git commit -m "feat(project-page): wire ProjectSettings accordion behind Settings toggle"
```

---

## Workstream 5 — Projects page

### Task 18: Add scope tabs to `ProjectsPage`

**Files:**
- Modify: `src/pages/ProjectsPage.tsx`

- [ ] **Step 1: Add tab state and re-fetch on tab change**

Open `src/pages/ProjectsPage.tsx`. Add a `scope` state:
```typescript
const [scope, setScope] = useState<'all' | 'owned' | 'shared'>('all');
```

Find the existing `api.projects.list()` call and replace with:
```typescript
api.projects.list(scope)
```

Add `scope` to the `useEffect` dependency array that triggers the fetch.

- [ ] **Step 2: Render the tab strip above the project grid**

Immediately above the project grid (find the wrapper that contains the project cards), add:

```tsx
<div className="inline-flex bg-vetted-surface border border-vetted-border rounded-full p-1 mb-6">
  {(['all', 'owned', 'shared'] as const).map(s => (
    <button
      key={s}
      type="button"
      onClick={() => setScope(s)}
      className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${scope === s ? 'bg-vetted-primary text-white' : 'text-vetted-text-muted hover:text-vetted-primary'}`}
    >
      {s === 'all' ? 'All' : s === 'owned' ? 'My projects' : 'Shared with me'}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Show role chip on shared cards**

In the project card render, find where the project name renders. Immediately after, add:

```tsx
{project.permission && (
  <span className="ml-2 px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-vetted-accent/15 text-vetted-accent border border-vetted-accent/30">
    {project.permission}
  </span>
)}
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:5173/projects`. The three tabs render. Switching to "Shared with me" shows only projects you've been added to. Cards in that view show the role chip.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProjectsPage.tsx
git commit -m "feat(projects-page): add All/My/Shared scope tabs with role chips"
```

---

## Workstream 6 — Polish & sidebar version bump

### Task 19: Bump sidebar version

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx` (per [feedback_version.md](../../../.claude/projects/-Users-jeffkwiatkowski-vetted-portal-v2/memory/feedback_version.md) — always bump on changes)

- [ ] **Step 1: Find current version string**

Run:
```bash
grep -n "v1\.\|version" /Users/jeffkwiatkowski/vetted_portal_v2/src/components/sidebar/Sidebar.tsx | head -5
```

The most recent commit history shows `v1.14.0` for agent stage. Bump to **v1.15.0** for project sharing.

- [ ] **Step 2: Edit the version label**

In the Sidebar file, find the version string and replace `v1.14.0` (or whatever's there) with `v1.15.0`.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "chore(sidebar): bump version to v1.15.0 for project sharing"
```

---

### Task 20: End-to-end manual verification

- [ ] **Step 1: Run all 7 verification scenarios from the spec**

Spec section "Testing strategy" lists 7 scenarios. Execute each in the browser with two user accounts side-by-side (one in normal window, one in incognito):

1. **Owner shares with B as collaborator** → B receives notification, sees project under "Shared with me", can upload files.
2. **Owner shares with C as viewer** → C sees project; file-upload UI is read-only.
3. **Owner removes B** → B's notification fires, project disappears from B's "Shared with me".
4. **Owner transfers to B** → owner_id flips, B becomes owner, original owner becomes editor, both notified.
5. **Invite by unknown email** → toast error, no DB write.
6. **Invite same user twice** → notification re-fires, `invited_at` updates, no duplicate row.
7. **Non-owner cannot see Share button or hit invite endpoint** (403 from server).

For each scenario, confirm the expected DB and UI state. Note any failures and circle back to the relevant task before declaring done.

- [ ] **Step 2: Final commit (if anything was tweaked during verification)**

```bash
git status
# If clean, no commit needed.
# If there are tweaks, commit with descriptive message.
```

---

## Out of scope (explicit deferrals)

- Outbound email (SMTP/Resend/SendGrid) — in-app only for v1.
- Inviting non-portal users — must exist in `users` table first.
- Migrating Tools/Skills/Templates/Files into the accordion — done via existing ProjectForm modal; follow-up plan.
- File-level or chat-level ACLs — project-wide permissions only.
- Owner-deletion cascade behavior — current behavior preserved.

---

## Self-review checklist (already run)

- ✅ Spec coverage: every endpoint and UI element from the spec maps to a task.
- ✅ No placeholders: every code step contains complete code.
- ✅ Type consistency: `ProjectAccess`, `ProjectMember`, `UserSearchResult` defined once in Task 11 and used identically downstream.
- ✅ File paths are absolute or repo-relative; line-number anchors verified against current `server/index.js`.
- ✅ Verification steps use real curl shapes — no `<TBD>` placeholders except for actual user IDs the engineer must paste.
