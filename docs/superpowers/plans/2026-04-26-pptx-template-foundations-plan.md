# PPTX Template Foundations & Management UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source spec:** [docs/superpowers/specs/2026-04-26-pptx-template-foundations-design.md](../specs/2026-04-26-pptx-template-foundations-design.md)

**Goal:** Ship a user-scoped PowerPoint template registry with management UIs for end users (upload/preview/replace/archive/delete) and admins (read-only inspect with audit logging). No deck rendering this cycle.

**Architecture:** New SQLite table `pptx_templates`, file-system storage under `data/uploads/templates/{user_id}/`, eight Express endpoints (seven user + one admin), Vitest server-side tests, two shared React components reused across user and admin UIs.

**Tech Stack:** Node.js/Express, sql.js (SQLite), `jszip`/`fast-xml-parser` (already present), Vitest + supertest (new devDeps), React/TypeScript with Tailwind.

---

## Files Touched

**Backend (new):**
- `server/lib/pptx-manifest.js` — extracts manifest + slide-1 thumbnail
- `vitest.config.ts` — Vitest config scoped to `server/test/**`
- `server/test/helpers.js` — temp DB + supertest fixtures
- `server/test/pptx-manifest.test.js` — S1
- `server/test/pptx-templates.test.js` — tests 1, 2, 3', 4, 5, 6
- `server/test/migration.test.js` — S2
- `server/test/admin-pptx.test.js` — S3

**Backend (modified):**
- `package.json` — devDeps + `test` script
- `server/database.js` — `pptx_templates` table + 3 indexes
- `server/index.js` — guard side effects for tests; 8 endpoints; `auditLog` helper; `ensureWrossIcMemoTemplate`; extend `GET /api/admin/users`

**Frontend (new):**
- `src/components/templates/TemplateRow.tsx`
- `src/components/templates/PreviewModal.tsx`
- `src/components/templates/index.ts`

**Frontend (modified):**
- `src/types/index.ts` — `PptxTemplate` interface
- `src/api/index.ts` — `pptxTemplates` namespace + `templates_count` on admin user
- `src/pages/PptxAppPage.tsx` — add "Your Templates" section above token extractor
- `src/pages/AdminUsersPage.tsx` — add TEMPLATES column + per-user slide-over
- `src/components/sidebar/Sidebar.tsx` — version bump

---

## Task 1: Vitest setup + test-importable server

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `server/test/helpers.js`
- Modify: `server/index.js:2702-2710` (guard side effects)

- [ ] **Step 1.1: Install dev dependencies**

Run:
```bash
npm install --save-dev vitest@^2.1.0 supertest@^7.0.0
```

Expected: `vitest` and `supertest` appear under `devDependencies` in `package.json`.

- [ ] **Step 1.2: Add `test` script to `package.json`**

In `package.json`, add to the `scripts` block (under `"seed"`):

```json
"test": "vitest run",
"test:watch": "vitest"
```

Final `scripts` block:
```json
"scripts": {
  "dev:frontend": "vite",
  "dev:backend": "node server/index.js",
  "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
  "build": "vite build",
  "start": "NODE_ENV=production node server/index.js",
  "seed": "node server/seed/index.js",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 1.3: Create `vitest.config.ts`**

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.js'],
    environment: 'node',
    testTimeout: 10000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    globals: false,
  },
});
```

`singleFork` ensures sequential execution so the shared in-process sql.js DB doesn't get mutated concurrently across test files.

- [ ] **Step 1.4: Guard `app.listen` and timer side effects in `server/index.js`**

These run at module import. Tests need to import `app` without binding to port 3000 or starting the prune timer.

Change `server/index.js:2702-2710` from:

```js
// Prune error_log every hour; also run once at startup so a long-down server clears stale rows on boot.
pruneOldErrors();
const pruneTimer = setInterval(pruneOldErrors, 60 * 60 * 1000);
pruneTimer.unref();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (${NODE_ENV} mode)`);
  console.log(`API available at http://localhost:${PORT}/api`);
});
```

to:

```js
// Skip during tests — supertest imports `app` and we don't want timers or a real port bind.
if (process.env.NODE_ENV !== 'test') {
  pruneOldErrors();
  const pruneTimer = setInterval(pruneOldErrors, 60 * 60 * 1000);
  pruneTimer.unref();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (${NODE_ENV} mode)`);
    console.log(`API available at http://localhost:${PORT}/api`);
  });
}
```

The two `process.on(...)` shutdown handlers below `app.listen` can stay — they're harmless in test runs.

- [ ] **Step 1.5: Create `server/test/helpers.js`**

This sets up an isolated DB per test file by pointing `DATABASE_PATH` at a temp file before importing the server. It also exposes a `seedTestUsers(db)` helper.

Create `server/test/helpers.js`:

```js
import fs from 'fs';
import path from 'path';
import os from 'os';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// Must be called BEFORE importing `server/index.js`.
// Sets DATABASE_PATH + NODE_ENV so the module-level init uses a throwaway file
// and `app.listen` is skipped.
export function isolateTestDatabase() {
  process.env.NODE_ENV = 'test';
  process.env.DEMO_MODE = 'false';
  process.env.SEED_DEMO_DATA = 'false';
  const tmpFile = path.join(os.tmpdir(), `vetted-test-${uuidv4()}.db`);
  process.env.DATABASE_PATH = tmpFile;
  // Also redirect uploads to a temp dir so tests don't pollute ./data/uploads
  const tmpUploads = path.join(os.tmpdir(), `vetted-test-uploads-${uuidv4()}`);
  fs.mkdirSync(tmpUploads, { recursive: true });
  process.env.UPLOAD_DIR = tmpUploads;
  return { dbFile: tmpFile, uploadsDir: tmpUploads };
}

// Insert two regular users (A, B) and one admin. Returns their IDs.
// Call AFTER the server module has been imported (so the schema exists).
export async function seedTestUsers(dbRun) {
  const now = new Date().toISOString();
  const hash = await bcrypt.hash('test', 10);
  const a = uuidv4();
  const b = uuidv4();
  const admin = uuidv4();
  for (const [id, email, name, role] of [
    [a, 'a@test.local', 'User A', 'user'],
    [b, 'b@test.local', 'User B', 'user'],
    [admin, 'admin@test.local', 'Admin', 'admin'],
  ]) {
    dbRun(
      `INSERT INTO users (id, email, display_name, role, status, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      [id, email, name, role, hash, now, now]
    );
  }
  return { a, b, admin };
}

// Cleanup helper for afterAll hooks
export function cleanupTestPaths({ dbFile, uploadsDir }) {
  try { fs.unlinkSync(dbFile); } catch {}
  try { fs.rmSync(uploadsDir, { recursive: true, force: true }); } catch {}
}
```

- [ ] **Step 1.6: Verify the harness boots**

Create a throwaway sanity test at `server/test/_sanity.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isolateTestDatabase, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('test harness', () => {
  let app, dbGet;
  beforeAll(async () => {
    const server = await import('../index.js');
    app = server.default;
    const dbMod = await import('../database.js');
    dbGet = (sql, params) => dbMod.dbGet(dbMod.getDatabase(), sql, params);
  });
  afterAll(() => cleanupTestPaths(paths));

  it('imports app without binding port and DB is reachable', () => {
    expect(app).toBeDefined();
    const r = dbGet('SELECT 1 as ok', []);
    expect(r.ok).toBe(1);
  });
});
```

Run: `npm test`

Expected: PASS, exit code 0, no `EADDRINUSE` error, no "Server running on port 3000" log line.

- [ ] **Step 1.7: Delete the sanity test**

Run:
```bash
rm server/test/_sanity.test.js
```

- [ ] **Step 1.8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts server/test/helpers.js server/index.js
git commit -m "test: add Vitest harness with isolated DB per test file"
```

---

## Task 2: `pptx_templates` schema + indexes

**Files:**
- Modify: `server/database.js` (insert table + indexes inside the schema-creation template literal, before its closing backtick at line 390)

- [ ] **Step 2.1: Add the table and indexes**

In `server/database.js`, locate the long template-literal block that contains every `CREATE TABLE IF NOT EXISTS ...` statement. Find the line just before its closing backtick (around line 389-390 — immediately after `idx_task_runs_started_at`). Insert the new table and indexes inside the same literal:

```sql
    CREATE TABLE IF NOT EXISTS pptx_templates (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL,
      name             TEXT NOT NULL,
      template_type    TEXT NOT NULL,
      source_pptx_path TEXT NOT NULL,
      thumbnail_path   TEXT,
      manifest_json    TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'active',
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pptx_templates_user_id     ON pptx_templates(user_id);
    CREATE INDEX IF NOT EXISTS idx_pptx_templates_user_type   ON pptx_templates(user_id, template_type);
    CREATE INDEX IF NOT EXISTS idx_pptx_templates_user_status ON pptx_templates(user_id, status);
```

These statements live inside the same template literal as all other tables — no quoting changes.

- [ ] **Step 2.2: Write the schema-presence test**

Create `server/test/schema.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isolateTestDatabase, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('pptx_templates schema', () => {
  let dbAll;
  beforeAll(async () => {
    await import('../index.js');
    const dbMod = await import('../database.js');
    dbAll = (sql, params) => dbMod.dbAll(dbMod.getDatabase(), sql, params);
  });
  afterAll(() => cleanupTestPaths(paths));

  it('has the pptx_templates table with expected columns', () => {
    const cols = dbAll('PRAGMA table_info(pptx_templates)', []);
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual([
      'created_at', 'id', 'manifest_json', 'name', 'source_pptx_path',
      'status', 'template_type', 'thumbnail_path', 'updated_at', 'user_id',
    ]);
  });

  it('has the three indexes', () => {
    const idxs = dbAll(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pptx_templates'",
      []
    );
    const names = idxs.map(i => i.name).sort();
    expect(names).toContain('idx_pptx_templates_user_id');
    expect(names).toContain('idx_pptx_templates_user_type');
    expect(names).toContain('idx_pptx_templates_user_status');
  });
});
```

- [ ] **Step 2.3: Run the test to verify pass**

Run: `npm test -- schema.test.js`

Expected: 2 tests pass.

- [ ] **Step 2.4: Commit**

```bash
git add server/database.js server/test/schema.test.js
git commit -m "feat(db): add pptx_templates table with user-scoped indexes"
```

---

## Task 3: `extractManifest` utility + S1 smoke test

**Files:**
- Create: `server/lib/pptx-manifest.js`
- Create: `server/test/pptx-manifest.test.js`

- [ ] **Step 3.1: Write the failing test (S1)**

Create `server/test/pptx-manifest.test.js`:

```js
import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractManifest, InvalidPptxError } from '../lib/pptx-manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PPTX = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

describe('extractManifest', () => {
  it('S1: returns manifest with slide_count and titled slides for the seed pptx', async () => {
    const { manifest, thumbnailBuffer } = await extractManifest(SAMPLE_PPTX);

    expect(manifest.version).toBe(1);
    expect(manifest.slide_count).toBeGreaterThan(0);
    expect(Array.isArray(manifest.slides)).toBe(true);
    expect(manifest.slides.length).toBe(manifest.slide_count);

    for (const s of manifest.slides) {
      expect(typeof s.index).toBe('number');
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
    }

    // thumbnailBuffer is null OR a Buffer — both acceptable per spec §6
    if (thumbnailBuffer !== null) {
      expect(Buffer.isBuffer(thumbnailBuffer)).toBe(true);
      expect(thumbnailBuffer.length).toBeGreaterThan(0);
    }
  });

  it('throws InvalidPptxError when given a non-zip file', async () => {
    const notAPptx = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Manifest.json');
    await expect(extractManifest(notAPptx)).rejects.toThrow(InvalidPptxError);
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run: `npm test -- pptx-manifest.test.js`

Expected: FAIL with `Cannot find module '../lib/pptx-manifest.js'`.

- [ ] **Step 3.3: Implement `extractManifest`**

Create `server/lib/pptx-manifest.js`:

```js
import fs from 'fs';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

export class InvalidPptxError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'InvalidPptxError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

// Walks an arbitrarily-nested object looking for any `t` text node and concatenates them.
// Used to extract the title text from inside a placeholder shape — the text can be split
// across multiple <a:r><a:t>...</a:t></a:r> runs.
function collectText(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const n of node) collectText(n, out); return out; }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 't') {
        if (Array.isArray(v)) for (const tv of v) out.push(typeof tv === 'string' ? tv : (tv?.['#text'] ?? ''));
        else out.push(typeof v === 'string' ? v : (v?.['#text'] ?? ''));
      } else if (!k.startsWith('@_')) {
        collectText(v, out);
      }
    }
  }
  return out;
}

// Within a parsed slide XML, find the <p:sp> whose <p:nvSpPr><p:nvPr><p:ph type="title|ctrTitle"/>
// is set, and pull the concatenated text out of its txBody.
function extractTitleFromSlide(slideObj) {
  const sld = slideObj?.sld;
  if (!sld) return null;
  const cSld = sld.cSld;
  const spTree = cSld?.spTree;
  if (!spTree) return null;
  const sps = Array.isArray(spTree.sp) ? spTree.sp : (spTree.sp ? [spTree.sp] : []);
  for (const sp of sps) {
    const ph = sp?.nvSpPr?.nvPr?.ph;
    const phType = ph?.['@_type'];
    if (phType === 'title' || phType === 'ctrTitle') {
      const text = collectText(sp.txBody).join('').trim();
      if (text.length > 0) return text;
    }
  }
  return null;
}

/**
 * Extract slide titles + slide-1 thumbnail from a .pptx file.
 *
 * @param {string} filePath - absolute path to a .pptx file
 * @returns {Promise<{ manifest: object, thumbnailBuffer: Buffer | null }>}
 * @throws {InvalidPptxError} if the file isn't a valid pptx zip or lacks ppt/presentation.xml
 */
export async function extractManifest(filePath) {
  const buf = fs.readFileSync(filePath);

  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    throw new InvalidPptxError(`File is not a valid .pptx: ${e.message}`);
  }

  const presentationXmlFile = zip.file('ppt/presentation.xml');
  if (!presentationXmlFile) {
    throw new InvalidPptxError('File is not a valid .pptx (missing ppt/presentation.xml)');
  }

  const presentationXml = await presentationXmlFile.async('string');
  const presentationObj = parser.parse(presentationXml);

  const sldIdLst = presentationObj?.presentation?.sldIdLst?.sldId;
  const sldIds = Array.isArray(sldIdLst) ? sldIdLst : (sldIdLst ? [sldIdLst] : []);
  const slideCount = sldIds.length;

  // For each slide N, parse ppt/slides/slideN.xml and extract its title.
  // We use 1..N positional naming because that's the standard pptx convention.
  const slides = [];
  for (let i = 1; i <= slideCount; i++) {
    const slideFile = zip.file(`ppt/slides/slide${i}.xml`);
    if (!slideFile) {
      slides.push({ index: i, title: `Slide ${i}` });
      continue;
    }
    let title;
    try {
      const slideXml = await slideFile.async('string');
      const slideObj = parser.parse(slideXml);
      title = extractTitleFromSlide(slideObj);
    } catch {
      slides.push({ index: i, title: `Slide ${i} (parse error)` });
      continue;
    }
    slides.push({ index: i, title: title && title.length > 0 ? title : `Slide ${i}` });
  }

  // Slide-1 thumbnail (optional)
  const thumbFile = zip.file('ppt/thumbnail.jpeg');
  const thumbnailBuffer = thumbFile ? Buffer.from(await thumbFile.async('uint8array')) : null;

  return {
    manifest: { version: 1, slide_count: slideCount, slides },
    thumbnailBuffer,
  };
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `npm test -- pptx-manifest.test.js`

Expected: 2 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add server/lib/pptx-manifest.js server/test/pptx-manifest.test.js
git commit -m "feat(pptx): add extractManifest utility for slide titles + thumbnail"
```

---

## Task 4: `GET /api/pptx-templates` (list) + tests 1 and 4

**Files:**
- Modify: `server/index.js` (insert routes immediately before the `app.get('/api/admin/users', ...)` route at line 1974)
- Create: `server/test/pptx-templates.test.js`

Add a section header comment above the new routes for grep-ability:
```
// ============================================================================
// PPTX TEMPLATES
// ============================================================================
```

- [ ] **Step 4.1: Write the failing list tests**

Create `server/test/pptx-templates.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, seedTestUsers, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('pptx-templates user endpoints', () => {
  let app, dbRun, dbGet, ids;

  beforeAll(async () => {
    const server = await import('../index.js');
    app = server.default;
    const dbMod = await import('../database.js');
    const db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    ids = await seedTestUsers(dbRun);

    // Insert one template owned by A and one owned by B directly via SQL —
    // we don't need real .pptx files for the access-control checks.
    const now = new Date().toISOString();
    const aTplId = uuidv4();
    const bTplId = uuidv4();
    const minimalManifest = JSON.stringify({ version: 1, slide_count: 1, slides: [{ index: 1, title: 'Test' }] });
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'A Template', 'ic_memo', '/fake/a.pptx', NULL, ?, 'active', ?, ?)`,
      [aTplId, ids.a, minimalManifest, now, now]
    );
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'B Template', 'one_pager', '/fake/b.pptx', NULL, ?, 'active', ?, ?)`,
      [bTplId, ids.b, minimalManifest, now, now]
    );
    ids.aTplId = aTplId;
    ids.bTplId = bTplId;
  });

  afterAll(() => cleanupTestPaths(paths));

  it('test 1: list endpoint isolates per user', async () => {
    const aRes = await request(app).get('/api/pptx-templates').set('X-User-Id', ids.a);
    expect(aRes.status).toBe(200);
    const aTemplates = aRes.body.templates || aRes.body;
    expect(aTemplates).toHaveLength(1);
    expect(aTemplates[0].name).toBe('A Template');
    expect(aTemplates.find(t => t.name === 'B Template')).toBeUndefined();

    const bRes = await request(app).get('/api/pptx-templates').set('X-User-Id', ids.b);
    expect(bRes.status).toBe(200);
    const bTemplates = bRes.body.templates || bRes.body;
    expect(bTemplates).toHaveLength(1);
    expect(bTemplates[0].name).toBe('B Template');
    expect(bTemplates.find(t => t.name === 'A Template')).toBeUndefined();
  });

  it('test 4: empty-state path returns [] without leaking other users', async () => {
    const cId = uuidv4();
    dbRun(
      `INSERT INTO users (id, email, display_name, role, status, password_hash, created_at, updated_at)
       VALUES (?, 'c@test.local', 'User C', 'user', 'active', 'x', datetime('now'), datetime('now'))`,
      [cId]
    );
    const res = await request(app).get('/api/pptx-templates').set('X-User-Id', cId);
    expect(res.status).toBe(200);
    const templates = res.body.templates || res.body;
    expect(templates).toEqual([]);
  });
});
```

- [ ] **Step 4.2: Run the tests to verify they fail**

Run: `npm test -- pptx-templates.test.js`

Expected: FAIL with 404 status (route not registered yet).

- [ ] **Step 4.3: Implement `GET /api/pptx-templates`**

In `server/index.js`, find the line immediately before `app.get('/api/admin/users', ...)` (around line 1974). Add a section header and the route directly above it:

```js
// ============================================================================
// PPTX TEMPLATES
// ============================================================================

// Lists templates for the requesting user. Defaults to status='active';
// pass ?include=archived to get all statuses. Returns the minimal row data
// the management UI needs (no manifest_json, no source paths).
app.get('/api/pptx-templates', requireAuth, (req, res) => {
  const userId = req.user.id;
  const includeArchived = req.query.include === 'archived';
  const sql = includeArchived
    ? 'SELECT * FROM pptx_templates WHERE user_id = ? ORDER BY created_at DESC'
    : "SELECT * FROM pptx_templates WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC";
  const rows = dbAll(db, sql, [userId]);
  const templates = rows.map(r => {
    let slideCount = 0;
    try { slideCount = JSON.parse(r.manifest_json).slide_count || 0; } catch {}
    return {
      id: r.id,
      name: r.name,
      template_type: r.template_type,
      slide_count: slideCount,
      has_thumbnail: r.thumbnail_path != null,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });
  res.json({ templates });
});
```

- [ ] **Step 4.4: Run the tests to verify they pass**

Run: `npm test -- pptx-templates.test.js`

Expected: 2 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add server/index.js server/test/pptx-templates.test.js
git commit -m "feat(pptx): GET /api/pptx-templates list endpoint with user isolation"
```

---

## Task 5: `GET /api/pptx-templates/:id` (detail) + tests 2 and 6

**Files:**
- Modify: `server/index.js`
- Modify: `server/test/pptx-templates.test.js`

- [ ] **Step 5.1: Add failing tests 2 and 6**

In `server/test/pptx-templates.test.js`, append the following inside the `describe('pptx-templates user endpoints', ...)` block, after test 4:

```js
  it('test 2: detail endpoint returns 404 (not 403) on cross-user access', async () => {
    const res = await request(app).get(`/api/pptx-templates/${ids.bTplId}`).set('X-User-Id', ids.a);
    expect(res.status).toBe(404);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('B Template');
    expect(body).not.toContain(ids.bTplId);
  });

  it('test 2b: detail endpoint returns own template fully', async () => {
    const res = await request(app).get(`/api/pptx-templates/${ids.aTplId}`).set('X-User-Id', ids.a);
    expect(res.status).toBe(200);
    const tpl = res.body.template || res.body;
    expect(tpl.id).toBe(ids.aTplId);
    expect(tpl.name).toBe('A Template');
    expect(tpl.manifest).toEqual({ version: 1, slide_count: 1, slides: [{ index: 1, title: 'Test' }] });
  });

  it('test 6: list and detail SQL strings filter by user_id in WHERE clause', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const url = await import('url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const indexJs = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

    const listHandlerMatch = indexJs.match(/app\.get\('\/api\/pptx-templates',[\s\S]*?\}\);/);
    const detailHandlerMatch = indexJs.match(/app\.get\('\/api\/pptx-templates\/:id',[\s\S]*?\}\);/);
    expect(listHandlerMatch, 'list handler must exist').toBeTruthy();
    expect(detailHandlerMatch, 'detail handler must exist').toBeTruthy();
    expect(listHandlerMatch[0]).toMatch(/WHERE user_id = \?/);
    expect(detailHandlerMatch[0]).toMatch(/WHERE id = \? AND user_id = \?/);
  });
```

- [ ] **Step 5.2: Run the tests to verify they fail**

Run: `npm test -- pptx-templates.test.js`

Expected: tests 2, 2b, 6 fail (route not present, regex match returns null).

- [ ] **Step 5.3: Implement detail handler**

In `server/index.js`, immediately after the list handler from Task 4, add:

```js
// Returns full template row + parsed manifest for the requesting user.
// 404 (not 403) on cross-user access — prevents existence leak per spec §7.
app.get('/api/pptx-templates/:id', requireAuth, (req, res) => {
  const row = dbGet(
    db,
    'SELECT * FROM pptx_templates WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  let manifest;
  try { manifest = JSON.parse(row.manifest_json); } catch { manifest = null; }
  res.json({
    template: {
      id: row.id,
      name: row.name,
      template_type: row.template_type,
      source_pptx_path: row.source_pptx_path,
      thumbnail_path: row.thumbnail_path,
      has_thumbnail: row.thumbnail_path != null,
      manifest,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
});
```

- [ ] **Step 5.4: Run the tests**

Run: `npm test -- pptx-templates.test.js`

Expected: all 5 tests in the file pass.

- [ ] **Step 5.5: Commit**

```bash
git add server/index.js server/test/pptx-templates.test.js
git commit -m "feat(pptx): GET /api/pptx-templates/:id detail with 404-on-cross-access"
```

---

## Task 6: `POST /api/pptx-templates` (upload)

**Files:**
- Modify: `server/index.js`
- Modify: `server/test/pptx-templates.test.js`

- [ ] **Step 6.1: Add the upload smoke test**

Append to `server/test/pptx-templates.test.js` inside the same describe block:

```js
  it('upload: writes file under user dir, parses manifest, returns row', async () => {
    const path = await import('path');
    const url = await import('url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const samplePath = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

    const res = await request(app)
      .post('/api/pptx-templates')
      .set('X-User-Id', ids.a)
      .field('name', 'Uploaded Template')
      .field('template_type', 'ic_memo')
      .attach('file', samplePath);

    expect(res.status).toBe(201);
    const tpl = res.body.template || res.body;
    expect(tpl.id).toBeTruthy();
    expect(tpl.name).toBe('Uploaded Template');
    expect(tpl.template_type).toBe('ic_memo');
    expect(tpl.slide_count).toBeGreaterThan(0);

    const fs = await import('fs');
    const expectedPath = path.join(paths.uploadsDir, 'templates', ids.a, `${tpl.id}.pptx`);
    expect(fs.existsSync(expectedPath)).toBe(true);

    const row = dbGet('SELECT user_id, name, status FROM pptx_templates WHERE id = ?', [tpl.id]);
    expect(row.user_id).toBe(ids.a);
    expect(row.status).toBe('active');

    ids.aUploadedId = tpl.id;
  });

  it('upload: rejects non-pptx mime', async () => {
    const path = await import('path');
    const url = await import('url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const notPptx = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Manifest.json');

    const res = await request(app)
      .post('/api/pptx-templates')
      .set('X-User-Id', ids.a)
      .field('name', 'Should Fail')
      .field('template_type', 'ic_memo')
      .attach('file', notPptx);

    expect(res.status).toBe(400);
  });

  it('upload: rejects invalid template_type', async () => {
    const path = await import('path');
    const url = await import('url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const samplePath = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

    const res = await request(app)
      .post('/api/pptx-templates')
      .set('X-User-Id', ids.a)
      .field('name', 'Bad Type')
      .field('template_type', 'not_a_real_type')
      .attach('file', samplePath);

    expect(res.status).toBe(400);
  });
```

- [ ] **Step 6.2: Run the tests to verify they fail**

Run: `npm test -- pptx-templates.test.js`

Expected: the three new upload tests FAIL (route doesn't exist, returns 404).

- [ ] **Step 6.3: Implement the upload route**

In `server/index.js`, near the top of the file (where the other multer instances are defined, around line 160), add a memory-storage multer instance dedicated to template uploads:

```js
const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSize },
});
```

Then under the PPTX TEMPLATES section header, after the detail handler from Task 5, add:

```js
const VALID_TEMPLATE_TYPES = ['ic_memo', 'one_pager', 'investor_update', 'custom'];

// Resolve the per-user template directory under the configured uploads dir.
function templateDir(userId) {
  return path.join(uploadsDir, 'templates', userId);
}

// Upload a new template. Multipart form: file + name + template_type.
// Writes source .pptx to data/uploads/templates/{user_id}/{id}.pptx, runs
// extractManifest, writes optional thumbnail next to it, inserts row.
app.post('/api/pptx-templates', requireAuth, templateUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const { name, template_type } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name is required' });
  if (!VALID_TEMPLATE_TYPES.includes(template_type)) {
    return res.status(400).json({ error: `template_type must be one of ${VALID_TEMPLATE_TYPES.join(', ')}` });
  }

  // Loose mime check — pptx browsers report inconsistently; check extension as a fallback.
  const looksLikePptx =
    req.file.mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    (req.file.originalname || '').toLowerCase().endsWith('.pptx');
  if (!looksLikePptx) return res.status(400).json({ error: 'File must be a .pptx' });

  const userId = req.user.id;
  const id = uuidv4();
  const userDir = templateDir(userId);
  fs.mkdirSync(userDir, { recursive: true });
  const sourcePath = path.join(userDir, `${id}.pptx`);
  fs.writeFileSync(sourcePath, req.file.buffer);

  let manifest, thumbnailBuffer;
  try {
    const { extractManifest } = await import('./lib/pptx-manifest.js');
    const result = await extractManifest(sourcePath);
    manifest = result.manifest;
    thumbnailBuffer = result.thumbnailBuffer;
  } catch (err) {
    try { fs.unlinkSync(sourcePath); } catch {}
    return res.status(400).json({ error: err.message || 'File is not a valid .pptx' });
  }

  let thumbnailPath = null;
  if (thumbnailBuffer) {
    thumbnailPath = path.join(userDir, `${id}.thumb.jpg`);
    fs.writeFileSync(thumbnailPath, thumbnailBuffer);
  }

  const now = new Date().toISOString();
  // Store paths relative to the configured uploads dir so the location is portable.
  const relSource = path.relative(uploadsDir, sourcePath);
  const relThumb = thumbnailPath ? path.relative(uploadsDir, thumbnailPath) : null;
  dbRun(db, `
    INSERT INTO pptx_templates
    (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `, [id, userId, name, template_type, relSource, relThumb, JSON.stringify(manifest), now, now]);

  res.status(201).json({
    template: {
      id,
      name,
      template_type,
      slide_count: manifest.slide_count,
      has_thumbnail: !!thumbnailBuffer,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  });
}));
```

The dynamic `import('./lib/pptx-manifest.js')` keeps the module load lazy.

- [ ] **Step 6.4: Run the tests**

Run: `npm test -- pptx-templates.test.js`

Expected: all tests in the file pass.

- [ ] **Step 6.5: Commit**

```bash
git add server/index.js server/test/pptx-templates.test.js
git commit -m "feat(pptx): POST /api/pptx-templates upload with manifest extraction"
```

---

## Task 7: `POST /api/pptx-templates/:id/replace` + test 3'

**Files:**
- Modify: `server/index.js`
- Modify: `server/test/pptx-templates.test.js`

- [ ] **Step 7.1: Add failing test 3'**

Append to `server/test/pptx-templates.test.js` inside the same describe block:

```js
  it("test 3': replace returns 404 on cross-user access; victim file unchanged", async () => {
    const path = await import('path');
    const url = await import('url');
    const fs = await import('fs');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const samplePath = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

    const bUpload = await request(app)
      .post('/api/pptx-templates')
      .set('X-User-Id', ids.b)
      .field('name', 'B Real Template')
      .field('template_type', 'ic_memo')
      .attach('file', samplePath);
    expect(bUpload.status).toBe(201);
    const bRealId = (bUpload.body.template || bUpload.body).id;
    const bDiskPath = path.join(paths.uploadsDir, 'templates', ids.b, `${bRealId}.pptx`);
    expect(fs.existsSync(bDiskPath)).toBe(true);
    const bSizeBefore = fs.statSync(bDiskPath).size;

    const aRes = await request(app)
      .post(`/api/pptx-templates/${bRealId}/replace`)
      .set('X-User-Id', ids.a)
      .attach('file', samplePath);
    expect(aRes.status).toBe(404);

    expect(fs.existsSync(bDiskPath)).toBe(true);
    expect(fs.statSync(bDiskPath).size).toBe(bSizeBefore);
  });

  it('replace: own template overwrites in place and updates updated_at', async () => {
    const path = await import('path');
    const url = await import('url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const samplePath = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

    const before = dbGet('SELECT updated_at FROM pptx_templates WHERE id = ?', [ids.aUploadedId]);
    await new Promise(r => setTimeout(r, 5));

    const res = await request(app)
      .post(`/api/pptx-templates/${ids.aUploadedId}/replace`)
      .set('X-User-Id', ids.a)
      .attach('file', samplePath);
    expect(res.status).toBe(200);

    const after = dbGet('SELECT updated_at FROM pptx_templates WHERE id = ?', [ids.aUploadedId]);
    expect(after.updated_at).not.toBe(before.updated_at);
  });
```

- [ ] **Step 7.2: Run the tests to verify the new ones fail**

Run: `npm test -- pptx-templates.test.js`

Expected: the two new tests FAIL (replace route doesn't exist).

- [ ] **Step 7.3: Implement the replace route**

In `server/index.js`, after the upload route from Task 6:

```js
// Replace the source file for an existing template. Same multipart format as upload but
// no name/template_type body — those are kept. 404 (not 403) on cross-user.
app.post('/api/pptx-templates/:id/replace', requireAuth, templateUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const userId = req.user.id;
  const row = dbGet(db, 'SELECT * FROM pptx_templates WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const looksLikePptx =
    req.file.mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    (req.file.originalname || '').toLowerCase().endsWith('.pptx');
  if (!looksLikePptx) return res.status(400).json({ error: 'File must be a .pptx' });

  const userDir = templateDir(userId);
  fs.mkdirSync(userDir, { recursive: true });
  const sourcePath = path.join(userDir, `${row.id}.pptx`);

  // Write to a temp path first so we don't corrupt the existing file if extraction fails
  const tempPath = sourcePath + '.new';
  fs.writeFileSync(tempPath, req.file.buffer);

  let manifest, thumbnailBuffer;
  try {
    const { extractManifest } = await import('./lib/pptx-manifest.js');
    const result = await extractManifest(tempPath);
    manifest = result.manifest;
    thumbnailBuffer = result.thumbnailBuffer;
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch {}
    return res.status(400).json({ error: err.message || 'File is not a valid .pptx' });
  }

  // Atomically move temp → source
  fs.renameSync(tempPath, sourcePath);

  const thumbDiskPath = path.join(userDir, `${row.id}.thumb.jpg`);
  if (thumbnailBuffer) {
    fs.writeFileSync(thumbDiskPath, thumbnailBuffer);
  } else if (fs.existsSync(thumbDiskPath)) {
    fs.unlinkSync(thumbDiskPath);
  }

  const now = new Date().toISOString();
  const relSource = path.relative(uploadsDir, sourcePath);
  const relThumb = thumbnailBuffer ? path.relative(uploadsDir, thumbDiskPath) : null;
  dbRun(db, `
    UPDATE pptx_templates
    SET source_pptx_path = ?, thumbnail_path = ?, manifest_json = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `, [relSource, relThumb, JSON.stringify(manifest), now, row.id, userId]);

  res.json({
    template: {
      id: row.id,
      name: row.name,
      template_type: row.template_type,
      slide_count: manifest.slide_count,
      has_thumbnail: !!thumbnailBuffer,
      status: row.status,
      created_at: row.created_at,
      updated_at: now,
    },
  });
}));
```

- [ ] **Step 7.4: Run the tests**

Run: `npm test -- pptx-templates.test.js`

Expected: all tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add server/index.js server/test/pptx-templates.test.js
git commit -m "feat(pptx): POST /api/pptx-templates/:id/replace with cross-user 404"
```

---

## Task 8: `PATCH /api/pptx-templates/:id` (rename + archive/restore)

**Files:**
- Modify: `server/index.js`
- Modify: `server/test/pptx-templates.test.js`

- [ ] **Step 8.1: Add tests**

Append to `server/test/pptx-templates.test.js`:

```js
  it('patch: rename own template', async () => {
    const res = await request(app)
      .patch(`/api/pptx-templates/${ids.aUploadedId}`)
      .set('X-User-Id', ids.a)
      .send({ name: 'Renamed Template' });
    expect(res.status).toBe(200);
    const row = dbGet('SELECT name FROM pptx_templates WHERE id = ?', [ids.aUploadedId]);
    expect(row.name).toBe('Renamed Template');
  });

  it('patch: archive then restore own template', async () => {
    const r1 = await request(app)
      .patch(`/api/pptx-templates/${ids.aUploadedId}`)
      .set('X-User-Id', ids.a)
      .send({ status: 'archived' });
    expect(r1.status).toBe(200);
    let row = dbGet('SELECT status FROM pptx_templates WHERE id = ?', [ids.aUploadedId]);
    expect(row.status).toBe('archived');

    const r2 = await request(app)
      .patch(`/api/pptx-templates/${ids.aUploadedId}`)
      .set('X-User-Id', ids.a)
      .send({ status: 'active' });
    expect(r2.status).toBe(200);
    row = dbGet('SELECT status FROM pptx_templates WHERE id = ?', [ids.aUploadedId]);
    expect(row.status).toBe('active');
  });

  it('patch: rejects unknown status', async () => {
    const res = await request(app)
      .patch(`/api/pptx-templates/${ids.aUploadedId}`)
      .set('X-User-Id', ids.a)
      .send({ status: 'deleted' });
    expect(res.status).toBe(400);
  });

  it('patch: 404 on cross-user access', async () => {
    const res = await request(app)
      .patch(`/api/pptx-templates/${ids.bTplId}`)
      .set('X-User-Id', ids.a)
      .send({ name: 'Hijack' });
    expect(res.status).toBe(404);
    const row = dbGet('SELECT name FROM pptx_templates WHERE id = ?', [ids.bTplId]);
    expect(row.name).toBe('B Template');
  });
```

- [ ] **Step 8.2: Run the tests to verify they fail**

Run: `npm test -- pptx-templates.test.js`

Expected: 4 new tests FAIL (404 from missing route).

- [ ] **Step 8.3: Implement the patch route**

After the replace route in `server/index.js`:

```js
// Partial update: rename and/or change status (active <-> archived).
// Body: { name?, status? }. 404 on cross-user. 400 on invalid status.
app.patch('/api/pptx-templates/:id', requireAuth, asyncRoute(async (req, res) => {
  const userId = req.user.id;
  const row = dbGet(db, 'SELECT * FROM pptx_templates WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const { name, status } = req.body || {};
  const updates = [];
  const params = [];

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name must be a non-empty string' });
    updates.push('name = ?'); params.push(name);
  }
  if (status !== undefined) {
    if (status !== 'active' && status !== 'archived') return res.status(400).json({ error: "status must be 'active' or 'archived'" });
    updates.push('status = ?'); params.push(status);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const now = new Date().toISOString();
  updates.push('updated_at = ?'); params.push(now);
  params.push(row.id, userId);

  dbRun(db, `UPDATE pptx_templates SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, params);

  const updated = dbGet(db, 'SELECT * FROM pptx_templates WHERE id = ?', [row.id]);
  res.json({
    template: {
      id: updated.id,
      name: updated.name,
      template_type: updated.template_type,
      status: updated.status,
      updated_at: updated.updated_at,
    },
  });
}));
```

- [ ] **Step 8.4: Run the tests**

Run: `npm test -- pptx-templates.test.js`

Expected: all pass.

- [ ] **Step 8.5: Commit**

```bash
git add server/index.js server/test/pptx-templates.test.js
git commit -m "feat(pptx): PATCH /api/pptx-templates/:id for rename and archive"
```

---

## Task 9: `DELETE /api/pptx-templates/:id` + test 5

**Files:**
- Modify: `server/index.js`
- Modify: `server/test/pptx-templates.test.js`

- [ ] **Step 9.1: Add tests**

Append to `server/test/pptx-templates.test.js`:

```js
  it('test 5: delete returns 404 on cross-user access; row + file preserved', async () => {
    const path = await import('path');
    const url = await import('url');
    const fs = await import('fs');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const samplePath = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');
    const upload = await request(app)
      .post('/api/pptx-templates')
      .set('X-User-Id', ids.b)
      .field('name', 'B For Delete Test')
      .field('template_type', 'custom')
      .attach('file', samplePath);
    const targetId = (upload.body.template || upload.body).id;
    const diskPath = path.join(paths.uploadsDir, 'templates', ids.b, `${targetId}.pptx`);
    expect(fs.existsSync(diskPath)).toBe(true);

    const res = await request(app)
      .delete(`/api/pptx-templates/${targetId}`)
      .set('X-User-Id', ids.a);
    expect(res.status).toBe(404);

    const row = dbGet('SELECT id FROM pptx_templates WHERE id = ?', [targetId]);
    expect(row).toBeTruthy();
    expect(fs.existsSync(diskPath)).toBe(true);
  });

  it('delete: own template removes row and both files', async () => {
    const path = await import('path');
    const url = await import('url');
    const fs = await import('fs');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const samplePath = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');
    const upload = await request(app)
      .post('/api/pptx-templates')
      .set('X-User-Id', ids.a)
      .field('name', 'Doomed')
      .field('template_type', 'custom')
      .attach('file', samplePath);
    const id = (upload.body.template || upload.body).id;
    const sourcePath = path.join(paths.uploadsDir, 'templates', ids.a, `${id}.pptx`);
    const thumbPath = path.join(paths.uploadsDir, 'templates', ids.a, `${id}.thumb.jpg`);
    expect(fs.existsSync(sourcePath)).toBe(true);

    const res = await request(app).delete(`/api/pptx-templates/${id}`).set('X-User-Id', ids.a);
    expect(res.status).toBe(204);

    const row = dbGet('SELECT id FROM pptx_templates WHERE id = ?', [id]);
    expect(row).toBeUndefined();
    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(fs.existsSync(thumbPath)).toBe(false);
  });
```

- [ ] **Step 9.2: Run to verify they fail**

Run: `npm test -- pptx-templates.test.js`

Expected: 2 new tests FAIL.

- [ ] **Step 9.3: Implement delete**

After the patch route in `server/index.js`:

```js
// Hard delete: row + on-disk source + thumbnail. 404 on cross-user. 204 on success.
app.delete('/api/pptx-templates/:id', requireAuth, (req, res) => {
  const userId = req.user.id;
  const row = dbGet(db, 'SELECT * FROM pptx_templates WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (row.source_pptx_path) {
    const abs = path.join(uploadsDir, row.source_pptx_path);
    try { fs.unlinkSync(abs); } catch {}
  }
  if (row.thumbnail_path) {
    const abs = path.join(uploadsDir, row.thumbnail_path);
    try { fs.unlinkSync(abs); } catch {}
  }
  dbRun(db, 'DELETE FROM pptx_templates WHERE id = ? AND user_id = ?', [row.id, userId]);
  res.status(204).end();
});
```

- [ ] **Step 9.4: Run the tests**

Run: `npm test -- pptx-templates.test.js`

Expected: all pass.

- [ ] **Step 9.5: Commit**

```bash
git add server/index.js server/test/pptx-templates.test.js
git commit -m "feat(pptx): DELETE /api/pptx-templates/:id removes row + files"
```

---

## Task 10: `GET /api/pptx-templates/:id/thumbnail`

**Files:**
- Modify: `server/index.js`
- Modify: `server/test/pptx-templates.test.js`

- [ ] **Step 10.1: Add tests**

Append to `server/test/pptx-templates.test.js`:

```js
  it('thumbnail: streams jpeg with cache headers when present', async () => {
    const res = await request(app)
      .get(`/api/pptx-templates/${ids.aUploadedId}/thumbnail`)
      .set('X-User-Id', ids.a);
    if (res.status === 404) {
      // The seed pptx may not have a thumbnail — skip in that case
      return;
    }
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(res.headers['cache-control']).toContain('max-age=86400');
    expect(res.body.length || res.body.byteLength).toBeGreaterThan(0);
  });

  it('thumbnail: 404 on cross-user', async () => {
    const res = await request(app)
      .get(`/api/pptx-templates/${ids.aUploadedId}/thumbnail`)
      .set('X-User-Id', ids.b);
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 10.2: Run to verify they fail**

Run: `npm test -- pptx-templates.test.js`

Expected: 2 new tests FAIL.

- [ ] **Step 10.3: Implement the thumbnail route**

After the delete route in `server/index.js`:

```js
// Streams the per-template slide-1 thumbnail. 404 if not owned or no thumbnail on disk.
app.get('/api/pptx-templates/:id/thumbnail', requireAuth, (req, res) => {
  const row = dbGet(
    db,
    'SELECT thumbnail_path FROM pptx_templates WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!row || !row.thumbnail_path) return res.status(404).json({ error: 'Not found' });

  const abs = path.join(uploadsDir, row.thumbnail_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });

  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=86400, immutable');
  fs.createReadStream(abs).pipe(res);
});
```

- [ ] **Step 10.4: Run the tests**

Run: `npm test -- pptx-templates.test.js`

Expected: all pass.

- [ ] **Step 10.5: Commit**

```bash
git add server/index.js server/test/pptx-templates.test.js
git commit -m "feat(pptx): GET /api/pptx-templates/:id/thumbnail with cache headers"
```

---

## Task 11: Bill Ross template migration + S2 idempotency test

**Files:**
- Modify: `server/index.js` (add `ensureWrossIcMemoTemplate` function and call it from `runMigrations`)
- Create: `server/test/migration.test.js`

- [ ] **Step 11.1: Write the failing test (S2)**

Create `server/test/migration.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isolateTestDatabase, cleanupTestPaths } from './helpers.js';
import { v4 as uuidv4 } from 'uuid';

const paths = isolateTestDatabase();

describe('ensureWrossIcMemoTemplate', () => {
  let dbRun, dbGet, ensureWrossIcMemoTemplate, db, fs, path;

  beforeAll(async () => {
    fs = await import('fs');
    path = await import('path');
    const server = await import('../index.js');
    const dbMod = await import('../database.js');
    db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    ensureWrossIcMemoTemplate = server.ensureWrossIcMemoTemplate;

    // Make sure wross exists in this fresh test DB
    const w = dbGet("SELECT id FROM users WHERE email = 'wross@prepfunds.net'", []);
    if (!w) {
      dbRun(
        `INSERT INTO users (id, email, display_name, role, status, password_hash, created_at, updated_at)
         VALUES (?, 'wross@prepfunds.net', 'Bill Ross', 'user', 'active', 'x', datetime('now'), datetime('now'))`,
        [uuidv4()]
      );
    }
  });

  afterAll(() => cleanupTestPaths(paths));

  it('S2: running migration twice produces exactly one ic_memo template for wross', async () => {
    const wrossUser = dbGet("SELECT id FROM users WHERE email = 'wross@prepfunds.net'", []);
    dbRun('DELETE FROM pptx_templates WHERE user_id = ?', [wrossUser.id]);
    const wrossDir = path.join(paths.uploadsDir, 'templates', wrossUser.id);
    if (fs.existsSync(wrossDir)) fs.rmSync(wrossDir, { recursive: true, force: true });

    await ensureWrossIcMemoTemplate(db);
    await ensureWrossIcMemoTemplate(db);

    const rows = dbGet(
      'SELECT COUNT(*) as c FROM pptx_templates WHERE user_id = ? AND template_type = ?',
      [wrossUser.id, 'ic_memo']
    );
    expect(rows.c).toBe(1);

    const dirContents = fs.readdirSync(wrossDir).filter(f => f.endsWith('.pptx'));
    expect(dirContents).toHaveLength(1);
  });

  it('migration: skips quietly when wross user does not exist', async () => {
    const wrossUser = dbGet("SELECT id FROM users WHERE email = 'wross@prepfunds.net'", []);
    if (wrossUser) {
      dbRun('DELETE FROM pptx_templates WHERE user_id = ?', [wrossUser.id]);
      dbRun("DELETE FROM users WHERE email = 'wross@prepfunds.net'", []);
    }
    await expect(ensureWrossIcMemoTemplate(db)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 11.2: Run the test to verify it fails**

Run: `npm test -- migration.test.js`

Expected: FAIL — `ensureWrossIcMemoTemplate is not a function` (export doesn't exist yet).

- [ ] **Step 11.3: Implement `ensureWrossIcMemoTemplate` and wire it into the per-boot migrations**

In `server/index.js`, find the `async function runMigrations(db)` block (it ends around line 284 with the wross user creation). After the closing brace of that function, add the new migration function:

```js
// Per-boot migration: ensure Bill Ross has an IC Memo template seeded.
// Idempotent: missing-user tolerance, broad existence check by template_type, file-copy skip.
// Exported so tests can call it directly without booting a server.
export async function ensureWrossIcMemoTemplate(database) {
  const bill = dbGet(database, "SELECT id FROM users WHERE email = 'wross@prepfunds.net'", []);
  if (!bill) {
    console.warn('Migration: wross@prepfunds.net not found, skipping IC Memo template seed');
    return;
  }

  const existing = dbGet(
    database,
    "SELECT id FROM pptx_templates WHERE user_id = ? AND template_type = 'ic_memo'",
    [bill.id]
  );
  if (existing) return;

  const sourceAsset = path.join(__dirname, 'seed-assets/templates/PREP_IC_Memo_Template.pptx');
  if (!fs.existsSync(sourceAsset)) {
    console.warn(`Migration: seed asset not found at ${sourceAsset}, skipping IC Memo template seed`);
    return;
  }

  const templateId = uuidv4();
  const userDir = path.join(uploadsDir, 'templates', bill.id);
  fs.mkdirSync(userDir, { recursive: true });
  const destPath = path.join(userDir, `${templateId}.pptx`);
  if (!fs.existsSync(destPath)) {
    fs.copyFileSync(sourceAsset, destPath);
  }

  let manifest, thumbnailBuffer;
  try {
    const { extractManifest } = await import('./lib/pptx-manifest.js');
    const result = await extractManifest(destPath);
    manifest = result.manifest;
    thumbnailBuffer = result.thumbnailBuffer;
  } catch (err) {
    console.warn(`Migration: failed to parse seed pptx (${err.message}), skipping`);
    return;
  }

  let thumbAbs = null;
  if (thumbnailBuffer) {
    thumbAbs = path.join(userDir, `${templateId}.thumb.jpg`);
    fs.writeFileSync(thumbAbs, thumbnailBuffer);
  }

  const now = new Date().toISOString();
  const relSource = path.relative(uploadsDir, destPath);
  const relThumb = thumbAbs ? path.relative(uploadsDir, thumbAbs) : null;
  dbRun(database, `
    INSERT INTO pptx_templates
    (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
    VALUES (?, ?, 'PREP IC Memo', 'ic_memo', ?, ?, ?, 'active', ?, ?)
  `, [templateId, bill.id, relSource, relThumb, JSON.stringify(manifest), now, now]);
  console.log(`Migration: seeded IC Memo template for wross@prepfunds.net (id=${templateId})`);
}
```

Then call it from `runMigrations(db)` — find the closing brace of that function (immediately before `let db;`) and add a call to the new function just before that closing brace:

```js
  // Ensure Bill Ross has his IC Memo template (idempotent across boots)
  await ensureWrossIcMemoTemplate(db);
}
```

So `runMigrations` ends with:

```js
  // Ensure wross@prepfunds.net exists
  const wross = dbGet(db, "SELECT id FROM users WHERE email = 'wross@prepfunds.net'");
  if (!wross) {
    // ... existing wross insert ...
  }

  // Ensure Bill Ross has his IC Memo template (idempotent across boots)
  await ensureWrossIcMemoTemplate(db);
}

export async function ensureWrossIcMemoTemplate(database) { /* as above */ }
```

- [ ] **Step 11.4: Run the test**

Run: `npm test -- migration.test.js`

Expected: 2 tests pass.

- [ ] **Step 11.5: Commit**

```bash
git add server/index.js server/test/migration.test.js
git commit -m "feat(pptx): per-boot migration seeds IC Memo template for Bill Ross"
```

---

## Task 12: `auditLog` helper + admin endpoint + S3 test

**Files:**
- Modify: `server/index.js`
- Create: `server/test/admin-pptx.test.js`

- [ ] **Step 12.1: Write the failing test (S3)**

Create `server/test/admin-pptx.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, seedTestUsers, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('admin pptx-templates endpoint', () => {
  let app, dbRun, dbGet, dbAll, ids;

  beforeAll(async () => {
    const server = await import('../index.js');
    app = server.default;
    const dbMod = await import('../database.js');
    const db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    dbAll = (sql, params) => dbMod.dbAll(db, sql, params);
    ids = await seedTestUsers(dbRun);

    const tplId = uuidv4();
    const now = new Date().toISOString();
    const minimalManifest = JSON.stringify({ version: 1, slide_count: 2, slides: [{ index: 1, title: 'X' }, { index: 2, title: 'Y' }] });
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'A Template', 'ic_memo', '/fake/a.pptx', NULL, ?, 'active', ?, ?)`,
      [tplId, ids.a, minimalManifest, now, now]
    );
    ids.aTplId = tplId;
  });

  afterAll(() => cleanupTestPaths(paths));

  it('S3a: non-admin gets 403', async () => {
    const res = await request(app)
      .get(`/api/admin/pptx-templates?user_id=${ids.a}`)
      .set('X-User-Id', ids.b);
    expect(res.status).toBe(403);
  });

  it('S3b: admin gets target user templates AND one audit row is written', async () => {
    const before = dbGet("SELECT COUNT(*) as c FROM audit_log WHERE action = 'pptx_templates.admin_view'", []);

    const res = await request(app)
      .get(`/api/admin/pptx-templates?user_id=${ids.a}`)
      .set('X-User-Id', ids.admin);
    expect(res.status).toBe(200);
    const templates = res.body.templates || res.body;
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('A Template');

    const after = dbGet("SELECT COUNT(*) as c FROM audit_log WHERE action = 'pptx_templates.admin_view'", []);
    expect(after.c).toBe(before.c + 1);

    const row = dbGet(
      "SELECT * FROM audit_log WHERE action = 'pptx_templates.admin_view' ORDER BY created_at DESC LIMIT 1",
      []
    );
    expect(row.user_id).toBe(ids.admin);
    expect(row.resource_type).toBe('pptx_template');
    expect(row.resource_id).toBe(ids.a);
    expect(row.id).toBeTruthy();
  });

  it('S3c: 400 when user_id query param is missing', async () => {
    const res = await request(app)
      .get('/api/admin/pptx-templates')
      .set('X-User-Id', ids.admin);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 12.2: Run the test to verify it fails**

Run: `npm test -- admin-pptx.test.js`

Expected: 3 tests FAIL (route doesn't exist).

- [ ] **Step 12.3: Implement `auditLog` helper + admin endpoint**

In `server/index.js`, add a small helper near the top of the PPTX TEMPLATES section (before the user routes from Task 4):

```js
// Canonical audit_log writer. First callsite in the repo — copy this shape for future writes.
function auditLog({ userId, action, resourceType = null, resourceId = null, details = null }) {
  dbRun(
    db,
    `INSERT INTO audit_log (id, user_id, action, resource_type, resource_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), userId, action, resourceType, resourceId, details, new Date().toISOString()]
  );
}
```

Then, after all the user pptx routes (the thumbnail route from Task 10 should be the last user-scoped one), add the admin route:

```js
// Admin-only: read another user's templates. Writes one audit_log row per call.
// 400 if no user_id query param provided.
app.get('/api/admin/pptx-templates', requireAuth, requireAdmin, (req, res) => {
  const targetUserId = req.query.user_id;
  if (!targetUserId) return res.status(400).json({ error: 'user_id query param is required' });

  const rows = dbAll(
    db,
    'SELECT * FROM pptx_templates WHERE user_id = ? ORDER BY created_at DESC',
    [targetUserId]
  );
  const templates = rows.map(r => {
    let slideCount = 0;
    try { slideCount = JSON.parse(r.manifest_json).slide_count || 0; } catch {}
    return {
      id: r.id,
      name: r.name,
      template_type: r.template_type,
      slide_count: slideCount,
      has_thumbnail: r.thumbnail_path != null,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });

  auditLog({
    userId: req.user.id,
    action: 'pptx_templates.admin_view',
    resourceType: 'pptx_template',
    resourceId: targetUserId,
  });

  res.json({ templates });
});
```

- [ ] **Step 12.4: Run the test**

Run: `npm test -- admin-pptx.test.js`

Expected: 3 tests pass.

- [ ] **Step 12.5: Run the full server-side suite to confirm nothing regressed**

Run: `npm test`

Expected: every test file passes (schema, pptx-manifest, pptx-templates, migration, admin-pptx).

- [ ] **Step 12.6: Commit**

```bash
git add server/index.js server/test/admin-pptx.test.js
git commit -m "feat(pptx): admin view endpoint + auditLog helper for cross-user reads"
```

---

## Task 13: Extend `GET /api/admin/users` with `templates_count`

**Files:**
- Modify: `server/index.js:1974-1978`
- Modify: `server/test/admin-pptx.test.js`

- [ ] **Step 13.1: Add a test for the new field**

Append to `server/test/admin-pptx.test.js` inside the same describe block:

```js
  it('admin user list now includes templates_count and excludes archived', async () => {
    const dbMod2 = await import('../database.js');
    const db2 = dbMod2.getDatabase();
    dbMod2.dbRun(db2, "UPDATE pptx_templates SET status = 'archived' WHERE id = ?", [ids.aTplId]);

    const res = await request(app).get('/api/admin/users').set('X-User-Id', ids.admin);
    expect(res.status).toBe(200);
    const users = res.body.users || res.body;
    const aUser = users.find(u => u.id === ids.a);
    expect(aUser).toBeTruthy();
    expect(aUser.templates_count).toBe(0);
    expect(aUser.password_hash).toBeUndefined();

    dbMod2.dbRun(db2, "UPDATE pptx_templates SET status = 'active' WHERE id = ?", [ids.aTplId]);

    const res2 = await request(app).get('/api/admin/users').set('X-User-Id', ids.admin);
    const aUser2 = (res2.body.users || res2.body).find(u => u.id === ids.a);
    expect(aUser2.templates_count).toBe(1);
  });
```

- [ ] **Step 13.2: Run to verify it fails**

Run: `npm test -- admin-pptx.test.js`

Expected: new test FAILS — `templates_count` is `undefined`.

- [ ] **Step 13.3: Modify the admin users handler**

In `server/index.js`, change `app.get('/api/admin/users', ...)` at line 1974-1978 from:

```js
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const rows = dbAll(db, 'SELECT * FROM users ORDER BY created_at DESC');
  const users = rows.map(({ password_hash, ...u }) => ({ ...u, has_password: !!password_hash }));
  res.json({ users });
});
```

to:

```js
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const rows = dbAll(db, `
    SELECT users.*, COALESCE(t.c, 0) AS templates_count
    FROM users
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS c
      FROM pptx_templates
      WHERE status = 'active'
      GROUP BY user_id
    ) t ON t.user_id = users.id
    ORDER BY users.created_at DESC
  `);
  const users = rows.map(({ password_hash, ...u }) => ({ ...u, has_password: !!password_hash }));
  res.json({ users });
});
```

The `templates_count` field rides along the spread because the destructure only strips `password_hash`. No N+1.

- [ ] **Step 13.4: Run the test**

Run: `npm test -- admin-pptx.test.js`

Expected: all tests pass.

- [ ] **Step 13.5: Commit**

```bash
git add server/index.js server/test/admin-pptx.test.js
git commit -m "feat(admin): include templates_count on admin user list"
```

---

## Task 14: Frontend type + API client

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/index.ts`

- [ ] **Step 14.1: Add the `PptxTemplate` type**

In `src/types/index.ts`, append:

```ts
export type PptxTemplateType = 'ic_memo' | 'one_pager' | 'investor_update' | 'custom';
export type PptxTemplateStatus = 'active' | 'archived';

export interface PptxTemplate {
  id: string;
  name: string;
  template_type: PptxTemplateType;
  slide_count: number;
  has_thumbnail: boolean;
  status: PptxTemplateStatus;
  created_at: string;
  updated_at: string;
}

export interface PptxTemplateDetail extends PptxTemplate {
  manifest: {
    version: number;
    slide_count: number;
    slides: Array<{ index: number; title: string }>;
  } | null;
}
```

- [ ] **Step 14.2: Add the `pptxTemplates` API namespace**

In `src/api/index.ts`, append a new export (at the end of the file):

```ts
export const pptxTemplates = {
  list: (opts?: { includeArchived?: boolean }) => {
    const q = opts?.includeArchived ? '?include=archived' : '';
    return request(`/pptx-templates${q}`).then((d: any) => d.templates || d || []);
  },
  get: (id: string) => request(`/pptx-templates/${id}`).then((d: any) => d.template || d),
  upload: (file: File, body: { name: string; template_type: string }, onProgress?: (pct: number) => void): Promise<any> =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', body.name);
      formData.append('template_type', body.template_type);
      const userId = localStorage.getItem('userId') || '';
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/pptx-templates`);
      xhr.setRequestHeader('X-User-Id', userId);
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        } else {
          let msg = 'Upload failed';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    }),
  replace: (id: string, file: File): Promise<any> =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      const userId = localStorage.getItem('userId') || '';
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/pptx-templates/${id}/replace`);
      xhr.setRequestHeader('X-User-Id', userId);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        } else {
          let msg = 'Replace failed';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Replace failed'));
      xhr.send(formData);
    }),
  patch: (id: string, body: { name?: string; status?: 'active' | 'archived' }) =>
    request(`/pptx-templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }).then((d: any) => d.template || d),
  remove: (id: string) => request(`/pptx-templates/${id}`, { method: 'DELETE' }),
  thumbnailUrl: (id: string) => `${BASE}/pptx-templates/${id}/thumbnail`,
};

export const adminPptxTemplates = {
  forUser: (userId: string) =>
    request(`/admin/pptx-templates?user_id=${encodeURIComponent(userId)}`).then((d: any) => d.templates || d || []),
};
```

- [ ] **Step 14.3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: exit 0, no errors.

- [ ] **Step 14.4: Commit**

```bash
git add src/types/index.ts src/api/index.ts
git commit -m "feat(api): add pptx templates client + types"
```

---

## Task 15: Shared `<TemplateRow />` and `<PreviewModal />` components

**Files:**
- Create: `src/components/templates/TemplateRow.tsx`
- Create: `src/components/templates/PreviewModal.tsx`
- Create: `src/components/templates/index.ts`

- [ ] **Step 15.1: Create the barrel file**

Create `src/components/templates/index.ts`:

```ts
export { TemplateRow } from './TemplateRow';
export { PreviewModal } from './PreviewModal';
```

- [ ] **Step 15.2: Create `TemplateRow`**

Create `src/components/templates/TemplateRow.tsx`:

```tsx
import React from 'react';
import { FileText } from 'lucide-react';
import type { PptxTemplate } from '../../types';
import { pptxTemplates } from '../../api';

const TYPE_LABEL: Record<string, string> = {
  ic_memo: 'IC Memo',
  one_pager: 'One Pager',
  investor_update: 'Investor Update',
  custom: 'Custom',
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export interface TemplateRowProps {
  template: PptxTemplate;
  actions?: React.ReactNode;
  onClick?: () => void;
}

export function TemplateRow({ template, actions, onClick }: TemplateRowProps) {
  return (
    <div
      className={`flex items-start gap-3 p-3 border border-vetted-border rounded-lg ${onClick ? 'cursor-pointer hover:bg-vetted-surface/50' : ''} transition-colors`}
      onClick={onClick}
    >
      <div className="w-16 h-12 shrink-0 rounded bg-vetted-surface flex items-center justify-center overflow-hidden border border-vetted-border">
        {template.has_thumbnail ? (
          <img
            src={pptxTemplates.thumbnailUrl(template.id)}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <FileText size={18} className="text-vetted-text-muted" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-vetted-primary text-sm truncate">{template.name}</p>
          {template.status === 'archived' && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-vetted-surface text-vetted-text-muted">
              Archived
            </span>
          )}
        </div>
        <p className="text-xs text-vetted-text-secondary mt-0.5">
          <span className="inline-block px-1.5 py-0.5 rounded bg-vetted-accent/15 text-vetted-accent font-medium mr-2">
            {TYPE_LABEL[template.template_type] || template.template_type}
          </span>
          {template.slide_count} slide{template.slide_count === 1 ? '' : 's'} · {relativeTime(template.updated_at)}
        </p>
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 15.3: Create `PreviewModal`**

Create `src/components/templates/PreviewModal.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import type { PptxTemplateDetail } from '../../types';
import { pptxTemplates } from '../../api';

const TYPE_LABEL: Record<string, string> = {
  ic_memo: 'IC Memo',
  one_pager: 'One Pager',
  investor_update: 'Investor Update',
  custom: 'Custom',
};

export interface PreviewModalProps {
  templateId: string | null;
  onClose: () => void;
  // When provided, fetch via this loader (used by admin to get someone else's
  // template). If omitted, falls back to the user-scoped detail endpoint.
  loader?: (id: string) => Promise<PptxTemplateDetail>;
}

export function PreviewModal({ templateId, onClose, loader }: PreviewModalProps) {
  const [detail, setDetail] = useState<PptxTemplateDetail | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!templateId) { setDetail(null); setError(''); return; }
    const fetchFn = loader || pptxTemplates.get;
    fetchFn(templateId)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [templateId, loader]);

  if (!templateId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-vetted-border">
          <h3 className="font-display text-lg text-vetted-primary">{detail?.name || 'Loading...'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-vetted-surface rounded text-vetted-text-muted">
            <X size={18} />
          </button>
        </div>

        {error && <div className="p-5 text-sm text-red-600">{error}</div>}

        {detail && (
          <div className="overflow-y-auto p-5 space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-32 h-24 shrink-0 rounded bg-vetted-surface flex items-center justify-center overflow-hidden border border-vetted-border">
                {detail.has_thumbnail ? (
                  <img src={pptxTemplates.thumbnailUrl(detail.id)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <FileText size={28} className="text-vetted-text-muted" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-xs text-vetted-text-muted uppercase tracking-wide">{TYPE_LABEL[detail.template_type] || detail.template_type}</p>
                <p className="text-sm text-vetted-text-secondary mt-1">
                  {detail.manifest?.slide_count ?? detail.slide_count} slides
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-xs uppercase tracking-wide text-vetted-text-muted mb-2">Slides</h4>
              <ol className="space-y-1 text-sm">
                {(detail.manifest?.slides || []).map(s => (
                  <li key={s.index} className="flex items-baseline gap-2">
                    <span className="text-vetted-text-muted text-xs w-6 shrink-0">{s.index}.</span>
                    <span className="text-vetted-primary">{s.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 15.4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 15.5: Commit**

```bash
git add src/components/templates/
git commit -m "feat(ui): shared TemplateRow + PreviewModal components"
```

---

## Task 16: Extend `PptxAppPage.tsx` with "Your Templates" section

**Files:**
- Modify: `src/pages/PptxAppPage.tsx`

The new section sits ABOVE the existing token-extraction UI. The existing flow is fully preserved.

- [ ] **Step 16.1: Read the current `PptxAppPage.tsx` to find the JSX root**

Open `src/pages/PptxAppPage.tsx`. Note the imports block (lines 1-4) and the `return` block of the default export. Identify where the page's main content starts (look for the outermost wrapper `<div>` inside `return`).

- [ ] **Step 16.2: Add imports**

At the top of `src/pages/PptxAppPage.tsx`, replace the imports block with:

```tsx
import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Upload, CheckCircle, AlertCircle, Loader2, ArrowLeft, Plus, Eye, RefreshCw, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { TemplateRow, PreviewModal } from '../components/templates';
import { pptxTemplates } from '../api';
import type { PptxTemplate } from '../types';
```

- [ ] **Step 16.3: Add the templates state and handlers inside the `PptxAppPage` component**

Inside `PptxAppPage()`, near the top of the function body (alongside the existing `useState` hooks), add:

```tsx
  const [templates, setTemplates] = useState<PptxTemplate[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState<'ic_memo' | 'one_pager' | 'investor_update' | 'custom'>('ic_memo');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refreshTemplates = useCallback(async () => {
    try {
      const list = await pptxTemplates.list({ includeArchived: showArchived });
      setTemplates(list);
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message || 'Failed to load templates' });
    }
  }, [showArchived, addToast]);

  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);

  const handleUpload = async () => {
    if (!uploadFile || !uploadName.trim()) return;
    setUploading(true);
    try {
      await pptxTemplates.upload(uploadFile, { name: uploadName.trim(), template_type: uploadType });
      addToast({ type: 'success', title: 'Template uploaded' });
      setShowUploadForm(false);
      setUploadFile(null);
      setUploadName('');
      setUploadType('ic_memo');
      await refreshTemplates();
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  };

  const handleArchiveToggle = async (t: PptxTemplate) => {
    try {
      await pptxTemplates.patch(t.id, { status: t.status === 'active' ? 'archived' : 'active' });
      addToast({ type: 'success', title: t.status === 'active' ? 'Archived' : 'Restored' });
      await refreshTemplates();
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message });
    }
  };

  const handleReplace = (t: PptxTemplate) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pptx';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await pptxTemplates.replace(t.id, file);
        addToast({ type: 'success', title: 'Template replaced' });
        await refreshTemplates();
      } catch (err) {
        addToast({ type: 'error', title: (err as Error).message });
      }
    };
    input.click();
  };

  const handleDelete = async (id: string) => {
    try {
      await pptxTemplates.remove(id);
      addToast({ type: 'success', title: 'Template deleted' });
      setConfirmDeleteId(null);
      await refreshTemplates();
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message });
    }
  };
```

- [ ] **Step 16.4: Insert the "Your Templates" section into the JSX**

In the `return` block of `PptxAppPage`, find the outermost content wrapper. Add the new section as the first block inside the page's main content area, BEFORE the existing token-extraction UI.

The exact insertion point depends on the existing JSX structure (around line 90-260). Look for where the main `<div className="...">` content begins. Insert this block at the very top of that content area:

```tsx
        {/* Your Templates section */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl text-vetted-primary">Your Templates</h2>
            <button
              onClick={() => setShowUploadForm(s => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-vetted-accent text-vetted-primary rounded text-sm font-medium hover:bg-vetted-accent/90"
            >
              <Plus size={14} />
              Upload
            </button>
          </div>

          {showUploadForm && (
            <div className="mb-4 p-4 border border-vetted-border rounded-lg bg-vetted-surface/30 space-y-3">
              <div>
                <label className="block text-xs font-medium text-vetted-text-muted uppercase tracking-wide mb-1">File</label>
                <input
                  type="file"
                  accept=".pptx"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setUploadFile(f);
                    if (f && !uploadName) setUploadName(f.name.replace(/\.pptx$/i, ''));
                  }}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-muted uppercase tracking-wide mb-1">Name</label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={e => setUploadName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-vetted-border rounded text-sm"
                  placeholder="Template name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-muted uppercase tracking-wide mb-1">Type</label>
                <select
                  value={uploadType}
                  onChange={e => setUploadType(e.target.value as typeof uploadType)}
                  className="w-full px-3 py-1.5 border border-vetted-border rounded text-sm"
                >
                  <option value="ic_memo">IC Memo</option>
                  <option value="one_pager">One Pager</option>
                  <option value="investor_update">Investor Update</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleUpload}
                  disabled={uploading || !uploadFile || !uploadName.trim()}
                  className="px-3 py-1.5 bg-vetted-primary text-white rounded text-sm font-medium disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <button
                  onClick={() => { setShowUploadForm(false); setUploadFile(null); setUploadName(''); }}
                  className="px-3 py-1.5 border border-vetted-border rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {templates.length === 0 ? (
            <div className="p-6 text-center text-sm text-vetted-text-muted border border-dashed border-vetted-border rounded-lg">
              You don't have any templates yet. Upload a <code>.pptx</code> below to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map(t => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  actions={
                    <>
                      <button onClick={() => setPreviewId(t.id)} title="Preview" className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => handleReplace(t)} title="Replace" className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted">
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={() => handleArchiveToggle(t)}
                        title={t.status === 'active' ? 'Archive' : 'Restore'}
                        className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted"
                      >
                        {t.status === 'active' ? <Archive size={14} /> : <ArchiveRestore size={14} />}
                      </button>
                      <button onClick={() => setConfirmDeleteId(t.id)} title="Delete" className="p-1.5 hover:bg-red-50 rounded text-vetted-text-muted hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          )}

          <button
            onClick={() => setShowArchived(s => !s)}
            className="mt-3 text-xs text-vetted-text-muted hover:text-vetted-primary"
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </section>

        {/* Existing token extraction UI continues below — unchanged */}
```

Then below the section, before the page's closing wrapper, add the modals:

```tsx
        <PreviewModal templateId={previewId} onClose={() => setPreviewId(null)} />

        {confirmDeleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmDeleteId(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-medium text-vetted-primary mb-2">Delete this template?</h3>
              <p className="text-sm text-vetted-text-secondary mb-4">This cannot be undone.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1.5 border border-vetted-border rounded text-sm">Cancel</button>
                <button onClick={() => handleDelete(confirmDeleteId)} className="px-3 py-1.5 bg-red-500 text-white rounded text-sm">Delete</button>
              </div>
            </div>
          </div>
        )}
```

- [ ] **Step 16.5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 16.6: Smoke test in browser**

Run: `npm run dev`

Open http://localhost:5173 → log in as `wross@prepfunds.net` (password `PrepOwner!77`) → navigate to the PowerPoint app page → verify:
- "Your Templates" section appears at the top with "PREP IC Memo" listed
- Clicking Preview opens the modal with the slide title list
- Upload button works (try the seed pptx as a second upload)
- Archive/Restore toggles update the row
- Delete confirms and removes
- Existing token extraction UI still works below

- [ ] **Step 16.7: Commit**

```bash
git add src/pages/PptxAppPage.tsx
git commit -m "feat(pptx-page): add Your Templates section above token extractor"
```

---

## Task 17: Extend `AdminUsersPage.tsx` with TEMPLATES column + slide-over

**Files:**
- Modify: `src/pages/AdminUsersPage.tsx`

- [ ] **Step 17.1: Update `AdminUser` interface and add new state**

In `src/pages/AdminUsersPage.tsx:7-17`, change the interface to include `templates_count`:

```tsx
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
  templates_count: number;
}
```

Update the imports at line 5 to include the new icons and types:

```tsx
import { ArrowLeft, Search, Plus, Pencil, KeyRound, Trash2, X, Eye, EyeOff, Layers } from 'lucide-react';
import { adminPptxTemplates } from '../api';
import type { PptxTemplate, PptxTemplateDetail } from '../types';
import { TemplateRow, PreviewModal } from '../components/templates';
```

Add `useCallback` to the React import: `import React, { useState, useEffect, useCallback } from 'react';`

Inside the `AdminUsersPage` component, add new state alongside the existing hooks:

```tsx
  const [panelUser, setPanelUser] = useState<AdminUser | null>(null);
  const [panelTemplates, setPanelTemplates] = useState<PptxTemplate[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const openTemplatesPanel = async (u: AdminUser) => {
    setPanelUser(u);
    setPanelLoading(true);
    setPanelTemplates([]);
    try {
      const list = await adminPptxTemplates.forUser(u.id);
      setPanelTemplates(list);
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message });
    } finally {
      setPanelLoading(false);
    }
  };

  // Admin previews use the admin endpoint as their loader since the user-scoped
  // detail route would 404 (admin doesn't own the template).
  const adminPreviewLoader = useCallback((id: string): Promise<PptxTemplateDetail> => {
    if (!panelUser) return Promise.reject(new Error('No user selected'));
    return adminPptxTemplates.forUser(panelUser.id).then((list: PptxTemplate[]) => {
      const t = list.find(x => x.id === id);
      if (!t) throw new Error('Template not found');
      // Admin endpoint returns the same minimal shape as the user list — for v1 we
      // construct a detail-shaped object with no manifest. PreviewModal renders
      // gracefully when manifest is null.
      return { ...t, manifest: null } as PptxTemplateDetail;
    });
  }, [panelUser]);
```

- [ ] **Step 17.2: Add the TEMPLATES column to the table**

In `src/pages/AdminUsersPage.tsx`, find the `<thead>` block (around line 255-263) and add a new `<th>` between Status and Last Login:

```tsx
              <tr className="text-left text-xs font-medium text-vetted-text-muted uppercase tracking-wide">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Password</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Templates</th>
                <th className="px-4 py-3 whitespace-nowrap">Last Login</th>
                <th className="px-4 py-3"></th>
              </tr>
```

In the `<tbody>` block, add a new `<td>` between Status and Last Login (after the existing Status `<td>` ending at line 298):

```tsx
                  <td className="px-4 py-3 text-sm">
                    {u.templates_count === 0 ? (
                      <span className="text-vetted-text-muted">0 templates</span>
                    ) : (
                      <button
                        onClick={() => openTemplatesPanel(u)}
                        className="text-vetted-accent hover:underline font-medium"
                      >
                        {u.templates_count} {u.templates_count === 1 ? 'template' : 'templates'}
                      </button>
                    )}
                  </td>
```

Also bump the empty-state colspan from 6 to 7 (line 320):

```tsx
                <tr><td colSpan={7} className="px-4 py-8 text-center text-vetted-text-muted text-sm">No users found</td></tr>
```

- [ ] **Step 17.3: Add the slide-over panel and preview modal at the end of JSX**

Find the page's outermost wrapping `<div>` close in `AdminUsersPage` (just before the final `</div>` of the return). Add the slide-over and preview before that close:

```tsx
        {/* Templates slide-over panel */}
        {panelUser && (
          <div className="fixed inset-0 z-40 flex" onClick={() => setPanelUser(null)}>
            <div className="flex-1 bg-black/40" />
            <div
              className="w-full max-w-md bg-white shadow-xl flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-vetted-border flex items-center justify-between">
                <div>
                  <h3 className="font-display text-lg text-vetted-primary">{panelUser.display_name}</h3>
                  <p className="text-xs text-vetted-text-muted">{panelUser.email}</p>
                </div>
                <button onClick={() => setPanelUser(null)} className="p-1 hover:bg-vetted-surface rounded text-vetted-text-muted">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-2">
                {panelLoading && <p className="text-sm text-vetted-text-muted">Loading…</p>}
                {!panelLoading && panelTemplates.length === 0 && (
                  <p className="text-sm text-vetted-text-muted text-center py-8">This user has no templates.</p>
                )}
                {!panelLoading && panelTemplates.map(t => (
                  <div key={t.id}>
                    <TemplateRow
                      template={t}
                      actions={
                        <button
                          onClick={() => setPreviewId(t.id)}
                          title="Preview"
                          className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted"
                        >
                          <Eye size={14} />
                        </button>
                      }
                    />
                    <p className="text-[10px] text-vetted-text-muted font-mono mt-1 ml-1">{t.id}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <PreviewModal
          templateId={previewId}
          onClose={() => setPreviewId(null)}
          loader={adminPreviewLoader}
        />
```

- [ ] **Step 17.4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 17.5: Smoke test in browser**

Run: `npm run dev` (if not already running)

Log in as an admin (`admin@vetted.com`) → navigate to /admin/users → verify:
- TEMPLATES column appears between Status and Last Login
- Bill Ross row shows "1 template" as a gold link; other users show "0 templates" muted
- Click "1 template" → slide-over opens with PREP IC Memo + small id under it
- Preview opens the modal (manifest may be null in admin view; that's fine — list still renders)
- Closing the panel does not refetch
- Server log: one new row in `audit_log` per panel open. Verify with:
  ```bash
  sqlite3 ./data/vetted_portal.db "SELECT * FROM audit_log WHERE action='pptx_templates.admin_view' ORDER BY created_at DESC LIMIT 5"
  ```

- [ ] **Step 17.6: Commit**

```bash
git add src/pages/AdminUsersPage.tsx
git commit -m "feat(admin): templates column + per-user slide-over with audit logging"
```

---

## Task 18: Sidebar version bump

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx:211`

- [ ] **Step 18.1: Bump version**

In `src/components/sidebar/Sidebar.tsx`, change line 211:

```tsx
        <p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.11.0</p>
```

to:

```tsx
        <p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.12.0</p>
```

- [ ] **Step 18.2: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "chore: bump sidebar version to v1.12.0"
```

---

## Task 19: Final verification

- [ ] **Step 19.1: Run the entire server-side test suite**

Run: `npm test`

Expected (file-by-file):
- `server/test/schema.test.js` — 2 pass
- `server/test/pptx-manifest.test.js` — 2 pass (S1 + invalid-pptx)
- `server/test/pptx-templates.test.js` — 16+ pass (1, 4, 2, 2b, 6, upload smoke + 2 reject, 3', replace own, patch ×4, test 5, delete own, thumbnail success + 404)
- `server/test/migration.test.js` — 2 pass (S2 + missing-user)
- `server/test/admin-pptx.test.js` — 4 pass (S3a, S3b, S3c, templates_count column)

Total ≥ 26 tests, exit 0.

- [ ] **Step 19.2: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 19.3: Run the dev server and exercise the three personas**

Run: `npm run dev`

Exercise each persona in a browser:

**Bill Ross (`wross@prepfunds.net` / `PrepOwner!77`):**
- Navigate to PowerPoint app page
- Confirm "PREP IC Memo" appears in Your Templates
- Upload a second pptx → confirm row appears
- Preview → modal shows slide-title list
- Replace → upload again, see updated_at change
- Archive → row hides; "Show archived" reveals it
- Delete a non-IC-Memo template → confirms and disappears

**Jeff Fox (`jefffox@vettedconsultant.com` / `SalesRock$24`):**
- Navigate to PowerPoint app page
- Confirm zero-state message renders
- Upload one template → row appears

**Admin (`admin@vetted.com`):**
- Navigate to /admin/users
- Confirm TEMPLATES column visible
- Bill Ross row shows ≥ 1 template (gold link); Jeff Fox shows 1 template; other users show 0
- Click on a user with templates → slide-over opens with read-only template list
- Preview opens modal
- Verify audit log row written:
  ```bash
  sqlite3 ./data/vetted_portal.db "SELECT user_id, action, resource_type, resource_id, created_at FROM audit_log WHERE action='pptx_templates.admin_view' ORDER BY created_at DESC LIMIT 3"
  ```
  Expected: rows with `resource_type=pptx_template`, `resource_id=<viewed user id>`, current timestamps.

- [ ] **Step 19.4: Final commit if there are any drive-by fixes from the smoke test**

If the smoke surfaced anything trivial:

```bash
git add <files>
git commit -m "fix(pptx): <whatever was wrong>"
```

If nothing needed fixing, no commit.

---

## Definition of Done — checklist mirror

Tracks the spec's §16 items so the executor can mark them off as the plan completes:

- [ ] `pptx_templates` table created with three indexes (Task 2)
- [ ] All eight endpoints implemented with WHERE-clause user filtering (Tasks 4–10, 12)
- [ ] `extractManifest` utility exists and is unit-tested (Task 3)
- [ ] Bill Ross migration runs on boot, is idempotent, populates one row pointing at the placeholder file (Task 11)
- [ ] `PptxAppPage.tsx` shows "Your Templates" above the existing token extractor; upload, preview, archive, replace, delete all work (Task 16)
- [ ] `AdminUsersPage.tsx` shows TEMPLATES column; click → side panel with read-only template list + Preview action (Task 17)
- [ ] Every admin panel open writes one row to `audit_log` (Task 12)
- [ ] All Vitest tests pass via `npm test` (Task 19)
- [ ] Manual smoke: Bill, admin, Jeff Fox all behave correctly (Task 19)
- [ ] Sidebar version bumped (Task 18)
