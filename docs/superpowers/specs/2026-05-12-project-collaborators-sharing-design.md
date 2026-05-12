# Project Collaborators & Sharing — Design

**Status:** Draft
**Date:** 2026-05-12
**Author:** Jeff (with Claude)

## Problem

Projects today have a single creator (`projects.owner_id`) and an unused `project_members` table. There is no UI to add collaborators or share projects, and no way for a user to see projects others have shared with them.

## Goals

1. Project creator is the **owner**.
2. Owner can add **collaborators** (existing portal users) who can modify the project — edit settings, upload files, change MCP/skills, run chats.
3. Owner can add **shared-with** users (existing portal users) who can read the project and any files within it.
4. When a user is added as collaborator or shared-with, they get an **in-app notification** and the project appears in their **"Shared with me"** view.
5. All access management lives in a panel **at the top of the project detail page**.

## Non-goals (v1)

- Real outbound email (SMTP / Resend / SendGrid). In-app notifications only. The `emailer` interface is left as a hook for a later swap.
- Inviting people who don't yet have an account. Invites resolve email → known user, error otherwise.
- Per-resource ACLs (file-level, chat-level). Permissions are project-wide.
- Collaborator-initiated invites. **Owner-only** for v1.
- Self-service ownership transfer is included but not auto-triggered (e.g., on user deletion).

## Roles

| Role | Stored as | Can read | Can modify project | Can manage members |
|---|---|---|---|---|
| Owner | `projects.owner_id` | yes | yes | yes |
| Collaborator | `project_members.permission = 'editor'` | yes | yes | no |
| Shared-with | `project_members.permission = 'viewer'` | yes | no | no |
| Admin (global) | `users.role IN ('admin','super_admin')` | yes | yes | yes |

This intentionally maps to the existing `getProjectAccess()` resolver — no permission-system rewrite.

## Data model changes

Existing tables stay. Two added columns on `project_members` (additive, idempotent migration via `ALTER TABLE ... ADD COLUMN`):

```sql
ALTER TABLE project_members ADD COLUMN invited_by TEXT;     -- user_id of inviter
ALTER TABLE project_members ADD COLUMN invited_at TEXT;     -- ISO timestamp; same as created_at on first add, updated on re-invite
```

No new tables. Notifications use the existing `notifications` table with `type = 'project_share'`.

## API

All endpoints are owner-only for writes (admin overrides, as today). Reads gated by `canReadProject()`.

### New

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/projects/:id/access` | Returns `{ owner: User, members: [{user, permission, invited_by, invited_at}] }` |
| `POST` | `/api/projects/:id/invite` | Body `{ email, permission: 'editor'\|'viewer' }`. Resolves email → user; 404 if email not in `users`. Inserts/updates `project_members`, creates a notification, writes to `audit_log`. Re-inviting an existing member updates `invited_at` and re-notifies. |
| `PATCH` | `/api/projects/:id/members/:userId` | Body `{ permission }`. Owner-only. Changes viewer ↔ editor. Audit-logged. No notification. |
| `POST` | `/api/projects/:id/transfer-ownership` | Body `{ new_owner_user_id }`. New owner must already be a member. Atomic: updates `projects.owner_id`, demotes old owner to `editor`, audit-logged, notifies both. |
| `POST` | `/api/projects/:id/leave` | Non-owner self-removal. Errors if caller is owner. Audit-logged. |
| `GET` | `/api/users/search?q=<query>` | Authenticated (any role). Returns up to 10 matches `[{id, display_name, email, avatar_path}]` matching `q` against email or display_name (case-insensitive prefix or substring). Used by the invite autocomplete. Distinct from `/api/admin/users` which is admin-only and returns full user records. |

### Existing — modified

- `POST /api/projects/:id/members` — kept for backward compat but routed through the same logic as `/invite`. Internally accepts `user_id` directly (no email lookup) for callers that already have it.
- `DELETE /api/projects/:id/members/:userId` — adds an audit-log entry and a notification to the removed user.
- `GET /api/projects` — already returns owned + member projects (joined at [server/index.js:3640](server/index.js#L3640)). Add a `scope` query param: `scope=owned` | `scope=shared` | `scope=all` (default `all`). Each project carries `permission` field already.

### Email-not-found behavior

Returns `404 { error: 'No portal user with that email', email_searched: <input> }`. Frontend shows a toast: *"No user with that email exists. Add them first via Admin → Users."*

## In-app notification

On invite (or re-invite):

- Insert into `notifications`:
  - `type = 'project_share'`
  - `title = "<Owner name> shared <project name> with you"`
  - `description = "You can <view | edit> this project."`
  - `link = "/projects/<id>"`
- Respect `user_preferences.notify_project_updates` — skip if `false`.

On removal:

- `type = 'project_unshare'`, `title = "<Owner name> removed your access to <project name>"`, no link.

On ownership transfer (sent to both old and new owner):

- `title = "Ownership of <project name> was transferred to <new owner>"`.

## Frontend

### Layout pattern: accordion (decided 2026-05-12 from layout study)

Project setup uses a single-page **accordion**. Each section is a collapsible panel with a one-line summary in its header so the full project state is auditable without expanding anything.

- Most-edited sections (Access & Sharing, General) start expanded by default.
- The rest start collapsed; their headers display state summaries (e.g., "Claude Opus 4.7 · temp 0.35", "14 files · 38.2 MB indexed").
- Section headers carry the section name on the left and a status snippet on the right; the Access section's header shows a compact avatar stack as its summary.
- A sticky save bar appears at the bottom only when there are unsaved edits.

Reference mockup: [mockups/2026-05-12-project-setup-layouts.html](mockups/2026-05-12-project-setup-layouts.html) (open in browser; toggle to "Accordion").

### Access & Sharing section (in-page, not a modal)

Lives as the first accordion panel, expanded by default. Layout:

- **Owner card** at the top — full-width row with the owner's avatar, name, email, "Owner" chip, and a "Transfer…" button (owner-only).
- **Two-column grid below:**
  - **Collaborators** (editors) — list of current editor members, each with avatar, name, email, "Editor" chip, and a remove button (owner-only). Below the list: an email autocomplete input + "Invite as editor" button.
  - **Shared with** (viewers) — same shape but for `permission: 'viewer'`. Below the list: "Invite as viewer" button.
- Email autocomplete queries `GET /api/users/search?q=<query>` debounced; suggestions show avatar + name + email; submitting an email not in the user table shows a toast error.
- A row's chip is clickable for owners → opens a small popover to change permission (Editor ↔ Viewer) or remove.
- Non-owners see the section read-only with a small chip indicating their own permission ("You're a viewer on this project") and a "Leave project" button at the bottom of the panel.

### `ProjectsPage` changes

Add a tab strip / segmented control at the top:

- **All** (default — current behavior)
- **My projects** (`scope=owned`)
- **Shared with me** (`scope=shared`)

Each card already carries `permission`; show a small role chip on shared cards so the user knows what they can do.

### Sidebar notification badge

The existing notifications system already surfaces an unread badge — no new sidebar work, just confirm `project_share` notifications display correctly in the existing notification list.

## Audit log

Every member mutation writes to `audit_log` with fields:
- `actor_user_id` — who did it
- `target_user_id` — who it was done to
- `action` — `member_invited` | `member_removed` | `permission_changed` | `ownership_transferred` | `project_left`
- `metadata` (JSON) — `{ project_id, old_permission, new_permission }`

## Permissions matrix (enforcement)

Server-side, every mutating endpoint runs through `getProjectAccess()` and checks:

| Action | Required level |
|---|---|
| Read project | `viewer+` |
| Edit settings, upload files, change MCP/skills | `editor+` |
| Invite, remove, change permission, transfer ownership | `owner` (or global admin) |
| Leave project | self, non-owner |

`canWriteProject()` already enforces `editor+` for the modify path. New owner-only middleware: `requireProjectOwner(req, res, next)`.

## Edge cases

- **Re-invite a removed user:** allowed; treated like a fresh invite (re-notifies).
- **Invite the owner:** rejected with "User is already the owner."
- **Invite yourself:** rejected with "You can't share a project with yourself."
- **Change owner to a non-member:** rejected — UI restricts the dropdown to current collaborators; server double-checks.
- **Owner deletion** (out of scope) — current behavior preserved; add a TODO to revisit when user-deletion lands.
- **Notification preference off** — invite still succeeds; only the in-app notification is suppressed.

## Testing strategy

No test runner exists in the repo, but for manual verification:

1. Owner shares with user B as collaborator → B sees notification, sees project under "Shared with me", can upload files.
2. Owner shares with user C as viewer → C sees project but file-upload UI is read-only / hidden.
3. Owner removes B → B's notification fires, project disappears from B's "Shared with me".
4. Owner transfers to B → owner_id flips, B becomes owner, original owner becomes editor, both notified.
5. Invite by unknown email → toast error, no DB write.
6. Invite same user twice → notification re-fires, `invited_at` updates, no duplicate row.
7. Non-owner cannot see Share button or hit invite endpoint (403 from server).

## Open questions

None blocking. Deferred:

- Real outbound email (post-v1, when SMTP/Resend account exists).
- External invites (off-platform emails).
- File-level or chat-level ACLs.
