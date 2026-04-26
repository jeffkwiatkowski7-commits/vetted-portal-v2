# PPTX Template Foundations & Management UI — Design

**Status:** Draft
**Owner:** Engineering
**Date:** 2026-04-26
**Source PRD:** [PRD-AI-Portal-PowerPoint-Generation.md](../../../PRD-AI-Portal-PowerPoint-Generation.md) (v1.2)
**Cycle:** First of two for the PowerPoint Generation feature. Generation engine is the next cycle.

---

## 1. What this cycle delivers

A user-scoped PowerPoint template registry with management UIs for both end users and admins. By end of cycle, Bill Ross can log in, see his pre-seeded IC Memo template, upload new templates, preview them, archive them, and delete them. Admins can see template counts per user and inspect any user's templates read-only with audit logging.

This cycle does **not** generate decks. The generation engine — orchestrator, per-slide prompts, `python-pptx` rendering, `POST /api/pptx-generate` endpoint, and chat-side intent detection — is the next cycle.

The boundary holds because §5.0a (user-scoping) and the management UI in §5.0c/§5.0d are deterministically verifiable and have no LLM/runtime unknowns. Rendering does have unknowns (Python availability, font licensing, layout fidelity) and is safer to scope separately.

## 2. Decisions locked in during brainstorming

| # | Decision | Reason |
|---|---|---|
| 1 | Scope = foundations + management UI; no renderer, no LLM | Isolates verifiable schema/access-control work from rendering unknowns |
| 2 | Add server-side Vitest only | The six §5.0a access-control tests must be CI gates per PRD; frontend tests are not needed for those gates |
| 3 | Extend [PptxAppPage.tsx](../../../src/pages/PptxAppPage.tsx); keep existing token extraction below the new template list | Faithful to PRD §5.0c.1; no working feature is removed |
| 4 | Slide-1 thumbnail extracted from embedded `ppt/thumbnail.jpeg`; preview modal shows slide-title list (no per-slide images) | No new runtime; honest about what is achievable without a renderer |
| 5 | User selects type at upload; manifest stores `{ version, slide_count, slides: [{index, title}] }` | Simple form, type is reliable, manifest grows additively when generation engine ships |
| 6 | Bill Ross template migration sits in the per-boot migrations block at [server/index.js:265-284](../../../server/index.js#L265-L284), next to the wross user migration. **Not** in [server/seed.js](../../../server/seed.js) — that file early-returns when users exist ([server/seed.js:13-16](../../../server/seed.js#L13-L16)) and so never runs against an existing database. Source asset: [server/seed-assets/templates/PREP_IC_Memo_Template.pptx](../../../server/seed-assets/templates/PREP_IC_Memo_Template.pptx). |
| 7 | Admin UI is read-only — no archive, no edit, no generate-as-user | Silent writes against another user's data have weak consent in v1; deferred to a later cycle if needed |
| 8 | Identity binding: endpoints read `req.user.id` (the existing `requireAuth` at [server/index.js:322](../../../server/index.js#L322) sets `req.user` to the full user row) | Match the actual middleware, not a guessed shape |

## 3. Architecture overview

Eight changes, all within the existing repo, no new runtimes:

1. **New SQLite table `pptx_templates`** + indexes, added to the migrations block in [server/database.js](../../../server/database.js).
2. **New file layout** `data/uploads/templates/{user_id}/{template_id}.pptx` and `.thumb.jpg` next to it.
3. **New utility** [server/lib/pptx-manifest.js](../../../server/lib/pptx-manifest.js) — extracts `manifest_json` and slide-1 thumbnail buffer using `jszip` + `fast-xml-parser`.
4. **Seven user endpoints** under `/api/pptx-templates` and one admin endpoint under `/api/admin/pptx-templates`, all in [server/index.js](../../../server/index.js).
5. **Bill Ross template migration** in the per-boot migrations block at [server/index.js:265-284](../../../server/index.js#L265-L284), idempotent across boots.
6. **Frontend — user UI** in [PptxAppPage.tsx](../../../src/pages/PptxAppPage.tsx): "Your Templates" section above the existing token extractor.
7. **Frontend — admin UI** in [AdminUsersPage.tsx](../../../src/pages/AdminUsersPage.tsx): TEMPLATES column + per-user side panel.
8. **Vitest setup** + nine tests (six §5.0a access-control + three smoke) in `server/test/`.

## 4. Database schema

Added to the migrations block in [server/database.js](../../../server/database.js):

```sql
CREATE TABLE IF NOT EXISTS pptx_templates (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  name             TEXT NOT NULL,
  template_type    TEXT NOT NULL,                  -- 'ic_memo' | 'one_pager' | 'investor_update' | 'custom'
  source_pptx_path TEXT NOT NULL,                  -- relative to repo root, e.g. data/uploads/templates/<user_id>/<id>.pptx
  thumbnail_path   TEXT,                           -- nullable; filled when slide-1 thumbnail extracted
  manifest_json    TEXT NOT NULL,                  -- v1: { version, slide_count, slides: [{index, title}] }
  status           TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pptx_templates_user_id     ON pptx_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_pptx_templates_user_type   ON pptx_templates(user_id, template_type);
CREATE INDEX IF NOT EXISTS idx_pptx_templates_user_status ON pptx_templates(user_id, status);
```

Two deviations from the PRD §5.0a.1 schema, both intentional:

- **Added `thumbnail_path` (nullable)** — the embedded slide-1 JPEG isn't always present (Keynote, older PowerPoint versions). NULL means "no thumbnail; UI shows placeholder icon."
- **Added `idx_pptx_templates_user_status`** — the user-facing list filters `status = 'active'` by default and the admin column counts active templates per user. The composite index keeps both queries cheap as data grows.

`manifest_json` for v1 contains:

```json
{
  "version": 1,
  "slide_count": 12,
  "slides": [
    { "index": 1, "title": "Investment Committee Memo" },
    { "index": 2, "title": "Deal Summary" }
  ]
}
```

The `version` field exists so the generation-engine cycle can grow the manifest schema additively (`version: 2` adds slide-level `fields[]` and `prorep_standard_refs`) without breaking v1 rows.

## 5. File layout

```
data/uploads/templates/
  <user_id>/
    <template_id>.pptx          ← source file
    <template_id>.thumb.jpg     ← extracted slide-1 thumbnail (when present)
```

The `user_id` segment in the path makes ownership obvious from filesystem inspection alone, matching the spirit of PRD §5.0a.2.

## 6. Manifest & thumbnail extraction

A single utility module: [server/lib/pptx-manifest.js](../../../server/lib/pptx-manifest.js).

```js
async function extractManifest(filePath)
  → { manifest, thumbnailBuffer | null }
```

**Steps:**

1. Open the `.pptx` (it's a zip) using `jszip`.
2. Read `ppt/presentation.xml` → enumerate `<p:sldId>` entries → resolve to `ppt/slides/slide{N}.xml`.
3. For each slide, parse the XML and find the title placeholder (the `<p:sp>` whose `<p:nvSpPr><p:nvPr><p:ph type="title|ctrTitle"/>` matches), extract concatenated `<a:t>` text. Fallback: `"Slide {N}"`.
4. Look for `ppt/thumbnail.jpeg` in the zip. If present, return its buffer; otherwise null.

**Failure modes:**

- Not a valid zip → throw `InvalidPptxError`. Upload returns 400 with `"File is not a valid .pptx"`.
- Zip OK but `ppt/presentation.xml` missing → same 400.
- One slide's XML fails to parse → store `{ index: N, title: "Slide N (parse error)" }` and continue. The whole upload does not fail over one bad slide; the user can archive/replace it.

**Dependencies:** uses existing `jszip@3.10.1` and `fast-xml-parser@5.5.9` from [package.json](../../../package.json) — no new deps required.

## 7. Backend endpoints

All in [server/index.js](../../../server/index.js). User identity is `req.user.id` (the existing `requireAuth` middleware at [server/index.js:322](../../../server/index.js#L322) sets `req.user` to the full user row).

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/api/pptx-templates` | user | Lists `WHERE user_id = ? AND status = ?` (default `'active'`; `?include=archived` switches to all). Returns minimal row data — `id`, `name`, `template_type`, `slide_count`, `has_thumbnail`, `status`, `created_at`, `updated_at`. |
| GET | `/api/pptx-templates/:id` | user | Returns full row + parsed `manifest_json`. **404** if `template.user_id !== req.user.id` (not 403 — prevents existence leak). |
| POST | `/api/pptx-templates` | user | Multer single-file upload (`file` field) + body `{ name, template_type }`. Validates: `.pptx` MIME, ≤50MB, `template_type` in enum. Generates uuid, writes to `data/uploads/templates/{req.user.id}/{id}.pptx`, runs extraction, inserts row. Returns the new row. |
| POST | `/api/pptx-templates/:id/replace` | user | Same as POST but updates an existing row in place. **404** if not owned. Overwrites source file, re-runs extraction, updates `manifest_json`, `thumbnail_path`, `updated_at`. |
| PATCH | `/api/pptx-templates/:id` | user | Body `{ name?, status? }` for rename + archive/restore. Status transitions allowed: `active ↔ archived`. **404** if not owned. |
| DELETE | `/api/pptx-templates/:id` | user | Hard delete: removes row, removes `.pptx` and `.thumb.jpg` from disk. **404** if not owned. |
| GET | `/api/pptx-templates/:id/thumbnail` | user | Streams `.thumb.jpg` with `Content-Type: image/jpeg` and `Cache-Control: private, max-age=86400, immutable` (per-template-id thumbnail is immutable until replace). **404** if not owned or no thumbnail. |
| GET | `/api/admin/pptx-templates?user_id=X` | admin | Returns templates for X. Writes audit log entry. **400** if no `user_id` param. |

**Cross-cutting rules:**

- Every read taking `:id` runs one SQL: `SELECT * FROM pptx_templates WHERE id = ? AND user_id = ?`. The user_id filter lives in the WHERE clause, not in app-layer post-filtering. This is what test 6 (Appendix C) inspects.
- POST/PATCH/DELETE never trust client-supplied `user_id` — always `req.user.id`.
- The admin endpoint is the **only** path where one user reads another user's data, gated by `requireAdmin` + audit logged.

**Audit log row** (reuses existing `audit_log` table at [server/database.js:230-239](../../../server/database.js#L230-L239) — no schema change). The table has dedicated `resource_type` and `resource_id` columns, so use them rather than stuffing the queried user id into JSON in `details`. `id` is `TEXT PRIMARY KEY` (NOT NULL) — generate a uuid:

```json
{
  "id": "<uuid>",
  "user_id": "<admin-user-id>",
  "action": "pptx_templates.admin_view",
  "resource_type": "pptx_template",
  "resource_id": "<queried-user-id>",
  "details": null,
  "created_at": "<iso>"
}
```

**Note:** there are zero existing `INSERT INTO audit_log` callsites in the repo today — this is the first one. Build a small `auditLog({ action, userId, resourceType, resourceId, details })` helper in [server/lib/](../../../server/lib/) (or inline near the migrations block) so future audit writes have a canonical shape to copy.

## 8. User-facing UI — [PptxAppPage.tsx](../../../src/pages/PptxAppPage.tsx)

The page becomes two stacked sections, with the existing token-extraction flow unchanged below the new section:

```
┌─────────────────────────────────────────────┐
│ Your Templates                  [+ Upload]  │
│                                             │
│  [thumb] PREP IC Memo                       │
│          IC Memo · 12 slides · 2d ago       │
│          [Preview] [Replace] [Archive] [Delete] │
│                                             │
│  Show archived (0)                          │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ Extract Design Tokens                       │
│ (existing one-shot upload — unchanged)      │
└─────────────────────────────────────────────┘
```

**Components** (all in [PptxAppPage.tsx](../../../src/pages/PptxAppPage.tsx) except the two shared ones):

- `<TemplateList />` — fetches `/api/pptx-templates`, renders rows. Empty state per PRD §5.0c.2: *"You don't have any templates yet. Upload a `.pptx` below to get started."*
- `<TemplateRow />` (shared, see §10) — thumbnail or placeholder, name, type badge (gold pill), slide count, relative time, action buttons.
- `<UploadTemplateForm />` — file picker, name input (default = filename minus extension), type dropdown. Submits to `POST /api/pptx-templates`, shows progress, refreshes list.
- `<PreviewModal />` (shared, see §10) — slide-1 thumbnail or placeholder, name, type, slide count, numbered slide-title list parsed from manifest. Read-only. No carousel.
- `<ReplaceModal />` — wraps the same upload form pre-filled with the template id; calls the replace endpoint with confirm: *"Replace this template? Decks already generated against this template are unaffected."*
- `<ArchiveAction />` and `<DeleteConfirm />` — inline buttons. Archive is one click + toast. Delete is a confirm modal.

**State:** local component state. List re-fetches on mount and after each mutation. No pagination (small N expected). No Zustand changes.

**API client additions** in [src/api/index.ts](../../../src/api/index.ts):

- `listTemplates({ includeArchived })`
- `uploadTemplate(file, { name, type })`
- `replaceTemplate(id, file)`
- `patchTemplate(id, { name?, status? })`
- `deleteTemplate(id)`

All carry the existing `X-User-Id` header.

## 9. Admin UI — [AdminUsersPage.tsx](../../../src/pages/AdminUsersPage.tsx)

**TEMPLATES column** inserted between STATUS and LAST LOGIN.

- `0 templates` (muted gray) when count = 0
- `1 template` / `N templates` (accent gold link) when > 0
- Click → opens per-user template panel

The existing admin user list endpoint at [server/index.js:1974](../../../server/index.js#L1974) (`GET /api/admin/users`) gains a `templates_count` field via:

```sql
LEFT JOIN (
  SELECT user_id, COUNT(*) AS c
  FROM pptx_templates
  WHERE status = 'active'
  GROUP BY user_id
) t ON t.user_id = users.id
```

One round trip; no per-row N+1.

**Projection note:** the existing handler at [server/index.js:1974-1978](../../../server/index.js#L1974-L1978) destructures `password_hash` out of every row before returning. The new `templates_count` field needs to be aliased in the SELECT and threaded through that map — easy to drop on the floor otherwise.

**Per-user template panel** — right-side slide-over. Opens on cell click. Header: user's display name + email. Body: same row format as user list, plus a small `id` for support purposes. Single action per row: **Preview** (uses the shared `<PreviewModal />`). Empty state: *"This user has no templates."*

**No archive, no delete, no edit on the admin side** (per decision 7). Closing the panel does not write another audit row — one open = one entry.

## 10. Shared template components

Lift `<TemplateRow />` and `<PreviewModal />` into [src/components/templates/](../../../src/components/templates/) so both user and admin views reuse them. This keeps the visual presentation identical across the two surfaces — the only difference is which actions render.

`<TemplateRow />` accepts an `actions` prop (array of action buttons) so admin can pass `[Preview]` while the user passes `[Preview, Replace, Archive, Delete]`.

## 11. Bill Ross template migration — per-boot block in [server/index.js](../../../server/index.js)

Lands in the migrations block at [server/index.js:265-284](../../../server/index.js#L265-L284), immediately after the existing wross *user* migration. Extracted into a small named function (e.g. `ensureWrossIcMemoTemplate(db)`) so the test S2 can call it directly without booting a full server.

Runs on every server boot, idempotent:

1. Look up user `WHERE email = 'wross@prepfunds.net'`. If not found → log warning, return (don't fail boot). On a fresh boot the wross-user migration immediately above this one creates the user, so by the time this runs the user always exists in normal flow.
2. Existence check — broader than name match to survive renames:
   ```sql
   SELECT id FROM pptx_templates
   WHERE user_id = ? AND template_type = 'ic_memo'
   ```
   If a row exists → return.
3. Generate `template_id` (uuid).
4. Ensure dir `data/uploads/templates/{bill_user_id}/`.
5. Copy [server/seed-assets/templates/PREP_IC_Memo_Template.pptx](../../../server/seed-assets/templates/PREP_IC_Memo_Template.pptx) → `data/uploads/templates/{bill_user_id}/{template_id}.pptx`. If destination exists, skip the copy.
6. Run `extractManifest(destinationPath)` → manifest + thumbnailBuffer.
7. If thumbnailBuffer, write `{template_id}.thumb.jpg` next to the source.
8. INSERT row with `name: 'PREP IC Memo'`, `template_type: 'ic_memo'`, `status: 'active'`, current timestamps.

**Idempotency safeguards:** missing-user tolerance (step 1), broad existence check (step 2), file-copy skip (step 5). Re-running never duplicates and never overwrites a template Bill himself uploaded later.

## 12. Test plan — Vitest, server-side, `server/test/`

**Setup:**

- Add to `devDependencies` in [package.json](../../../package.json): `vitest`, `supertest`, optional `@vitest/coverage-v8`. Not runtime deps — production server never imports them.
- `vitest.config.ts` at repo root, scoped to `server/test/**`, `environment: 'node'` (so it doesn't conflict with frontend Vite config)
- `npm test` script in [package.json](../../../package.json)
- Tests use a temp SQLite file (or in-memory) seeded with two regular users + one admin — never the real `data/vetted_portal.db`

**Tests:**

| # | Name | Asserts |
|---|---|---|
| 1 | List endpoint isolation | A's `GET /api/pptx-templates` returns only A's templates; B's returns only B's; no cross-leak in `id`/`name` |
| 2 | Detail 404 on cross-access | `GET /api/pptx-templates/{B_id}` as A → 404 (not 403); body has no fields confirming existence |
| 3' | Replace 404 on cross-access | `POST /api/pptx-templates/{B_id}/replace` as A → 404; B's file unchanged on disk |
| 4 | Empty-state path | C with zero templates → list returns `[]`; never includes A's or B's names |
| 5 | Delete 404 on cross-access | `DELETE /api/pptx-templates/{B_id}` as A → 404; B's row + file still present |
| 6 | Query inspection | Static check on the SQL strings used by list/detail handlers — contains `WHERE user_id = ?` (or equivalent), bound param matches requesting user |
| S1 | Manifest extraction smoke | Given the placeholder `.pptx`, `extractManifest` returns expected `slide_count` and a non-empty `slides[]` |
| S2 | Migration idempotency | Call `ensureWrossIcMemoTemplate(db)` twice against a fresh test DB seeded with the wross user; assert exactly one row for Bill exists and the source `.pptx` was copied once |
| S3 | Admin endpoint | Non-admin → 403; admin → returns target user's templates AND writes one `audit_log` row |

**Note on PRD Appendix C item 3.** The PRD's "generation rejection" test asserts `POST /api/pptx-generate` rejects cross-user template ids before any LLM call. The generation endpoint does not exist this cycle. Test 3' replaces it — same access-control assertion against a write path that does exist (replace). The original test 3 lands in the generation-engine cycle alongside the endpoint it tests.

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Some `.pptx` files lack the embedded slide-1 thumbnail | Acceptable: UI shows placeholder icon. If real-use rate is high, the renderer cycle solves it. |
| R2 | Slide-title parsing misses titles in non-placeholder text boxes | Acceptable: `"Slide N"` fallback. Preview modal still shows useful slide count + list. |
| R3 | The middleware shape is assumed but not always verified | Verified: `requireAuth` at [server/index.js:322](../../../server/index.js#L322) sets `req.user` = full user row; endpoints read `req.user.id`. |
| R4 | Vitest config conflicts with frontend Vite config | `vitest.config.ts` is scoped to `server/test/**` only, `environment: 'node'`. Frontend Vite config untouched. |
| R5 | Migration runs on every boot, including production. If Bill uploads a real template via UI, idempotency must hold even if name differs | Existence check uses `template_type = 'ic_memo'`, not name. Any IC Memo for Bill prevents duplicate insert. |
| R6 | Admin opens panel multiple times — audit log floods | Acceptable: log captures intent ("did this happen"), not panel-open count. |

## 14. Internal sequencing for the implementation plan

Each backend step pairs an endpoint with the test(s) that prove it — red and green land in the same step rather than carrying long-running red tests across multiple steps.

1. Vitest setup (devDeps + `vitest.config.ts` + `npm test` script + test fixtures: temp DB seeded with two users + one admin).
2. `pptx_templates` schema + indexes in [server/database.js](../../../server/database.js).
3. `extractManifest` utility in [server/lib/pptx-manifest.js](../../../server/lib/pptx-manifest.js) + smoke test S1 (red → green).
4. `GET /api/pptx-templates` (list) + test 1 (isolation) + test 4 (empty state).
5. `GET /api/pptx-templates/:id` (detail) + test 2 (404 on cross-access) + test 6 (SQL inspection).
6. `POST /api/pptx-templates` (upload) — needed before replace/delete tests have data to act on.
7. `POST /api/pptx-templates/:id/replace` + test 3' (404 on cross-access).
8. `PATCH /api/pptx-templates/:id` (rename + archive/restore).
9. `DELETE /api/pptx-templates/:id` + test 5 (404 on cross-access).
10. `GET /api/pptx-templates/:id/thumbnail`.
11. `ensureWrossIcMemoTemplate(db)` migration in the per-boot block at [server/index.js:265-284](../../../server/index.js#L265-L284) (next to the wross user migration) + idempotency test S2.
12. `auditLog(...)` helper (canonical shape — first callsite in repo) + `GET /api/admin/pptx-templates` + test S3. Helper lives next to its sole caller for now; later audit-log writers copy the shape.
13. Extend `GET /api/admin/users` with the `templates_count` LEFT JOIN (mind the `password_hash` projection map).
14. Frontend: shared `<TemplateRow />` and `<PreviewModal />` in [src/components/templates/](../../../src/components/templates/).
15. Frontend: extend [PptxAppPage.tsx](../../../src/pages/PptxAppPage.tsx).
16. Frontend: extend [AdminUsersPage.tsx](../../../src/pages/AdminUsersPage.tsx).
17. Manual smoke test: log in as Bill → verify migrated row; log in as Jeff K → verify admin column + panel + audit log row; log in as Jeff Fox → verify zero-state.
18. Sidebar version bump (per project convention).

## 15. Out of scope / explicitly deferred

**Next cycle (generation engine):**

- `python-pptx` or equivalent renderer
- LLM orchestrator + per-slide prompts + structured-output validation
- ProREP standard skill integration
- `POST /api/pptx-generate` endpoint
- Chat-side intent detection ("build an IC memo for Hilliard")
- Per-slide thumbnail rendering (upgrades the Preview modal beyond slide-title list)
- Manifest schema v2 — slide-level `fields[]` annotation, `prorep_standard_refs`
- Field-aware test cases (PRD Appendix C item 3, generation rejection)

**Further out (PRD P1/P2):**

- Deck variants, slide-level regeneration, light memory shim, source citation footer
- Bulk generation, WYSIWYG editor, full memory layer, external data integrations
- Cross-user template sharing, organization scope
- Admin override "generate as another user" — explicitly out per PRD §5.0d.2

## 16. Definition of done

- [ ] `pptx_templates` table created with the three indexes
- [ ] All eight endpoints implemented with WHERE-clause user filtering
- [ ] `extractManifest` utility exists and is unit-tested
- [ ] Bill Ross migration runs on boot, is idempotent, populates one row pointing at the placeholder file
- [ ] [PptxAppPage.tsx](../../../src/pages/PptxAppPage.tsx) shows "Your Templates" above the existing token extractor; upload, preview, archive, replace, delete all work
- [ ] [AdminUsersPage.tsx](../../../src/pages/AdminUsersPage.tsx) shows TEMPLATES column; click → side panel with read-only template list + Preview action
- [ ] Every admin panel open writes one row to `audit_log`
- [ ] All nine Vitest tests pass via `npm test`
- [ ] Manual smoke: Bill logs in (or his user_id is impersonated in dev) → sees the IC Memo template; Jeff K logs in as admin → sees the column and the panel; Jeff Fox logs in → sees zero templates
- [ ] Sidebar version bumped
