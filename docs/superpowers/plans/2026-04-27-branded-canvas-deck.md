# Branded Canvas Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a stored PPTX template into a project so that "presentation-y" chat requests render as multi-slide branded decks themed by the template's colors and fonts.

**Architecture:** Single nullable `projects.pptx_template_id` column. Manifest v2 carries design tokens extracted at upload. When a project has a template attached, the system-prompt assembler appends a "branded canvas" block instructing the AI to emit a `canvas-deck` fence; the frontend mounts a parallel `<CanvasDeckBlock />` (alongside today's `<CanvasBlock />`) that slices `<section data-layout>` children into a navigable iframe deck. No changes to AI backends, no new runtimes.

**Tech Stack:** Node.js/Express + sql.js (SQLite) backend, React/TypeScript + Vite frontend, Vitest + supertest for server tests, DOMPurify for sanitization, Google Fonts via public CSS endpoint.

**Spec:** [docs/superpowers/specs/2026-04-27-branded-canvas-deck-design.md](../specs/2026-04-27-branded-canvas-deck-design.md)

---

## File map

**Created:**
- `server/lib/branded-canvas.js` — `getDesignTokens` + `buildBrandedCanvasBlock` helpers (pure, no IO)
- `server/test/branded-canvas.test.js` — tests 1, 2 (helper content, defaults)
- `server/test/system-prompt-branding.test.js` — tests 3, 4, S3 (brand block gating + cross-user safety + SQL inspection)
- `server/test/projects-template-attach.test.js` — tests 5, 6 (PUT ownership gate + DELETE cascading detach)
- `server/test/manifest-v2-migration.test.js` — test S2 (general parallel-pass v1→v2 upgrade)
- `src/components/templates/TemplatePickerModal.tsx` — shared template picker for ProjectForm
- `src/components/projects/ProjectPickerModal.tsx` — project picker for "Apply to project…" action
- `src/components/chat/CanvasDeckBlock.tsx` — multi-slide deck renderer with iframe + nav
- `src/components/chat/canvas-deck-styles.css` — 8 layout rules + slide frame + nav chrome (~250 lines)

**Modified:**
- `server/database.js` — `ALTER TABLE projects ADD COLUMN pptx_template_id` + index
- `server/lib/pptx-parser.js` — export `extractColors`, `extractFonts`, plus `extractColor` and `applyLumModifiers` helpers
- `server/lib/pptx-manifest.js` — extend `extractManifest` to return v2 manifest with `design_tokens`
- `server/test/pptx-manifest.test.js` — update existing v1 assertion to v2; add token assertions (test S1)
- `server/index.js` — wross migration v1→v2 branch + general parallel pass; system-prompt brand block; POST/PUT projects accept `pptx_template_id` with ownership validation; DELETE template nulls dependent projects
- `src/types/index.ts` — `Project.pptx_template_id?: string | null`
- `src/components/projects/ProjectForm.tsx` — branding-template field + integration with `<TemplatePickerModal />`
- `src/pages/ProjectDetailPage.tsx` — plumb `pptx_template_id` through `handleUpdateProject` + `initialData`
- `src/pages/PptxAppPage.tsx` — "Apply to project…" button between Replace and Archive
- `src/components/chat/ChatView.tsx` — `language-canvas-deck` branch
- `src/pages/MainChatPage.tsx` — `language-canvas-deck` branch
- `src/components/Sidebar.tsx` — version bump

---

## Task 1: Schema — `projects.pptx_template_id`

**Files:**
- Modify: `server/database.js`

- [ ] **Step 1: Add ALTER TABLE + index next to existing per-boot ALTER TABLE block**

Open `server/database.js`, find the block of `try { db.run(\`ALTER TABLE … ADD COLUMN …\`) } catch (e) { /* already exists */ }` statements (around line 411–424). Append:

```js
  try { db.run(`ALTER TABLE projects ADD COLUMN pptx_template_id TEXT DEFAULT NULL`); } catch (e) { /* already exists */ }
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_projects_pptx_template ON projects(pptx_template_id)`); } catch (e) { /* already exists */ }
```

(The `REFERENCES pptx_templates(id)` clause from the spec is omitted — SQLite FKs are off by default in this app, so the documentary clause adds nothing and would just make the runtime ALTER more brittle.)

- [ ] **Step 2: Restart the dev server**

Run: `npm run dev` (kill any prior instance first).
Expected: Server boots; no error in console about the new ALTER TABLE.

- [ ] **Step 3: Verify the column exists**

Run from the project root:
```bash
sqlite3 ./data/vetted_portal.db "PRAGMA table_info(projects);" | grep pptx_template_id
```
Expected output: a row containing `pptx_template_id|TEXT|0||0`.

- [ ] **Step 4: Commit**

```bash
git add server/database.js
git commit -m "feat(db): add projects.pptx_template_id column + index"
```

---

## Task 2: Export extraction helpers from `pptx-parser.js`

**Files:**
- Modify: `server/lib/pptx-parser.js`

- [ ] **Step 1: Add `export` to four functions**

Open `server/lib/pptx-parser.js`. Change four `function` declarations to `export function`:

- `function extractColor(el)` (~line 25) → `export function extractColor(el)`
- `function applyLumModifiers(hex, node)` (~line 43) → `export function applyLumModifiers(hex, node)`
- `function extractColors(clrScheme)` (~line 94) → `export function extractColors(clrScheme)`
- `function extractFonts(fontScheme)` (~line 109) → `export function extractFonts(fontScheme)`

(`extractColor` and `applyLumModifiers` are dependencies of `extractColors`; exporting them keeps the import in `pptx-manifest.js` self-contained.)

- [ ] **Step 2: Verify legacy parser callers still work**

Run: `npm test -- pptx-manifest`
Expected: existing `extractManifest` tests still pass (we haven't touched `extractManifest` yet).

- [ ] **Step 3: Commit**

```bash
git add server/lib/pptx-parser.js
git commit -m "refactor(pptx): export extractColors/extractFonts and helpers"
```

---

## Task 3: Extend `extractManifest` to v2 with `design_tokens`

**Files:**
- Modify: `server/lib/pptx-manifest.js`
- Modify: `server/test/pptx-manifest.test.js`

- [ ] **Step 1: Update test S1 to expect v2 + tokens (failing test)**

Open `server/test/pptx-manifest.test.js`. Replace the body of the first `it(...)` block with:

```js
  it('S1: returns v2 manifest with design_tokens for the seed pptx', async () => {
    const { manifest, thumbnailBuffer } = await extractManifest(SAMPLE_PPTX);

    expect(manifest.version).toBe(2);
    expect(manifest.slide_count).toBeGreaterThan(0);
    expect(Array.isArray(manifest.slides)).toBe(true);
    expect(manifest.slides.length).toBe(manifest.slide_count);

    for (const s of manifest.slides) {
      expect(typeof s.index).toBe('number');
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
    }

    // Design tokens — three colors and two fonts, all non-empty strings.
    expect(manifest.design_tokens).toBeDefined();
    expect(typeof manifest.design_tokens.colors.primary).toBe('string');
    expect(typeof manifest.design_tokens.colors.accent).toBe('string');
    expect(typeof manifest.design_tokens.colors.background).toBe('string');
    expect(manifest.design_tokens.colors.primary.length).toBeGreaterThan(0);
    expect(typeof manifest.design_tokens.fonts.heading).toBe('string');
    expect(typeof manifest.design_tokens.fonts.body).toBe('string');
    expect(manifest.design_tokens.fonts.heading.length).toBeGreaterThan(0);

    expect(Buffer.isBuffer(thumbnailBuffer)).toBe(true);
    expect(thumbnailBuffer.length).toBeGreaterThan(0);

    const realTitles = manifest.slides.filter(s => !/^Slide \d+( \(parse error\))?$/.test(s.title));
    expect(realTitles.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pptx-manifest`
Expected: FAIL with `expected 1 to be 2` (current code returns `version: 1`).

- [ ] **Step 3: Extend `extractManifest` in `pptx-manifest.js`**

Open `server/lib/pptx-manifest.js`. At the top, add the import:

```js
import { extractColors, extractFonts } from './pptx-parser.js';
```

Then inside `extractManifest`, just before the final `return { manifest: ..., thumbnailBuffer }` statement, insert token extraction:

```js
  // Design tokens (v2). Extracted from ppt/theme/theme1.xml. Wrapped — a
  // missing or malformed theme falls back to brand defaults; never throws.
  let designTokens = {
    colors:
      { primary: '#1A1A1A', accent: '#C4A962', background: '#FFFFFF' },
    fonts:
      { heading: 'Playfair Display', body: 'Inter' },
  };
  try {
    const themeFile = zip.file('ppt/theme/theme1.xml');
    if (themeFile) {
      const themeXml = await themeFile.async('string');
      const themeObj = parser.parse(themeXml);
      const themeElements = themeObj?.theme?.themeElements;
      const colors = extractColors(themeElements?.clrScheme);
      const fonts = extractFonts(themeElements?.fontScheme);
      // Map pptx semantic names to our three-key vocabulary.
      // dark1/dk1 = primary text, accent1 = brand accent, light1/lt1 = background.
      designTokens = {
        colors: {
          primary:    colors.dark1   || designTokens.colors.primary,
          accent:     colors.accent1 || designTokens.colors.accent,
          background: colors.light1  || designTokens.colors.background,
        },
        fonts: {
          heading: fonts.heading || designTokens.fonts.heading,
          body:    fonts.body    || designTokens.fonts.body,
        },
      };
    }
  } catch {
    // Keep defaults.
  }
```

Then update the return:

```js
  return {
    manifest: {
      version: 2,
      slide_count: slideCount,
      slides,
      design_tokens: designTokens,
    },
    thumbnailBuffer,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pptx-manifest`
Expected: PASS — both tests in `pptx-manifest.test.js` pass.

- [ ] **Step 5: Run full test suite to check no regressions**

Run: `npm test`
Expected: All tests pass. The existing `migration.test.js` still passes because `extractManifest` is now called with v2 output — the upgraded shape is a superset.

- [ ] **Step 6: Commit**

```bash
git add server/lib/pptx-manifest.js server/test/pptx-manifest.test.js
git commit -m "feat(pptx): emit manifest v2 with design_tokens"
```

---

## Task 4: Per-boot v1→v2 migration with general parallel pass

**Files:**
- Create: `server/test/manifest-v2-migration.test.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write the failing test (test S2)**

Create `server/test/manifest-v2-migration.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PPTX = path.join(__dirname, '../seed-assets/templates/PREP_IC_Memo_Template.pptx');

describe('manifest v1→v2 migration (general parallel pass)', () => {
  let db, dbRun, dbGet, dbAll, upgradeManifestsToV2;

  beforeAll(async () => {
    const server = await import('../index.js');
    const dbMod = await import('../database.js');
    db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    dbAll = (sql, params) => dbMod.dbAll(db, sql, params);
    upgradeManifestsToV2 = server.upgradeManifestsToV2;

    // Seed user.
    const uid = uuidv4();
    dbRun(
      `INSERT INTO users (id, email, display_name, role, status, password_hash, created_at, updated_at)
       VALUES (?, 'm@test.local', 'M', 'user', 'active', 'x', datetime('now'), datetime('now'))`,
      [uid]
    );

    const v1Manifest = JSON.stringify({ version: 1, slide_count: 1, slides: [{ index: 1, title: 'X' }] });
    const now = new Date().toISOString();

    // Row A: valid path, should upgrade.
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES ('row-valid', ?, 'Valid', 'ic_memo', ?, NULL, ?, 'active', ?, ?)`,
      [uid, SAMPLE_PPTX, v1Manifest, now, now]
    );

    // Row B: missing path on disk, should be left at v1 without throwing.
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES ('row-missing', ?, 'Missing', 'ic_memo', '/nonexistent/file.pptx', NULL, ?, 'active', ?, ?)`,
      [uid, v1Manifest, now, now]
    );

    // Row C: already v2, should be untouched.
    const v2Manifest = JSON.stringify({
      version: 2,
      slide_count: 1,
      slides: [{ index: 1, title: 'Y' }],
      design_tokens: {
        colors: { primary: '#000', accent: '#fff', background: '#aaa' },
        fonts: { heading: 'A', body: 'B' },
      },
    });
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES ('row-v2', ?, 'V2', 'ic_memo', ?, NULL, ?, 'active', ?, ?)`,
      [uid, SAMPLE_PPTX, v2Manifest, now, now]
    );
  });

  afterAll(() => cleanupTestPaths(paths));

  it('S2: upgrades v1 rows with valid paths and skips broken ones', async () => {
    await upgradeManifestsToV2(db);

    const valid = JSON.parse(dbGet('SELECT manifest_json FROM pptx_templates WHERE id = ?', ['row-valid']).manifest_json);
    expect(valid.version).toBe(2);
    expect(valid.design_tokens).toBeDefined();

    const missing = JSON.parse(dbGet('SELECT manifest_json FROM pptx_templates WHERE id = ?', ['row-missing']).manifest_json);
    expect(missing.version).toBe(1);

    const v2 = JSON.parse(dbGet('SELECT manifest_json FROM pptx_templates WHERE id = ?', ['row-v2']).manifest_json);
    expect(v2.version).toBe(2);
    expect(v2.design_tokens.colors.primary).toBe('#000'); // unchanged
  });

  it('is idempotent on a second run', async () => {
    await upgradeManifestsToV2(db);
    await upgradeManifestsToV2(db);
    const valid = JSON.parse(dbGet('SELECT manifest_json FROM pptx_templates WHERE id = ?', ['row-valid']).manifest_json);
    expect(valid.version).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- manifest-v2-migration`
Expected: FAIL with `upgradeManifestsToV2 is not a function`.

- [ ] **Step 3: Implement `upgradeManifestsToV2` in `server/index.js`**

Open `server/index.js`. Find the `ensureWrossIcMemoTemplate` function (around line 280). Right after it, add a new exported function:

```js
// Per-boot migration: upgrade any v1 manifest rows to v2 by re-running extractManifest.
// Idempotent — rows already at version >= 2 are skipped. Failures (missing files,
// malformed pptx) are logged and the row is left at v1; the renderer's getDesignTokens
// fallback handles v1 manifests gracefully so this is non-fatal.
export async function upgradeManifestsToV2(database) {
  const rows = dbAll(
    database,
    `SELECT id, source_pptx_path, manifest_json FROM pptx_templates`
  );
  for (const row of rows) {
    let parsed;
    try { parsed = JSON.parse(row.manifest_json); } catch { continue; }
    if (parsed?.version >= 2) continue;
    try {
      const { manifest: v2 } = await extractManifest(
        path.isAbsolute(row.source_pptx_path)
          ? row.source_pptx_path
          : path.join(uploadsDir, row.source_pptx_path)
      );
      dbRun(database, 'UPDATE pptx_templates SET manifest_json = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(v2), new Date().toISOString(), row.id]);
    } catch (err) {
      console.warn(`[migration] manifest v2 upgrade skipped for template ${row.id}: ${err.message}`);
    }
  }
}
```

- [ ] **Step 4: Wire `upgradeManifestsToV2` into the boot path**

Find the call site of `ensureWrossIcMemoTemplate(db)` in the boot migration block (~line 273). Add the parallel pass right after it:

```js
  // Ensure Bill Ross has his IC Memo template (idempotent across boots)
  await ensureWrossIcMemoTemplate(db);

  // Upgrade any v1 manifests to v2 (idempotent across boots)
  await upgradeManifestsToV2(db);
```

Also confirm `extractManifest` is imported at the top of `server/index.js` — if not already, add:

```js
import { extractManifest } from './lib/pptx-manifest.js';
```

(Search the file for `extractManifest` before adding to avoid a duplicate.)

Confirm `dbAll` is imported alongside `dbRun`, `dbGet` from `./database.js`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- manifest-v2-migration`
Expected: PASS — both `it()` blocks green.

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `npm test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add server/index.js server/test/manifest-v2-migration.test.js
git commit -m "feat(pptx): per-boot v1→v2 manifest migration with safe parallel pass"
```

---

## Task 5: Helpers — `getDesignTokens` and `buildBrandedCanvasBlock`

**Files:**
- Create: `server/lib/branded-canvas.js`
- Create: `server/test/branded-canvas.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/test/branded-canvas.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { getDesignTokens, buildBrandedCanvasBlock } from '../lib/branded-canvas.js';

describe('getDesignTokens', () => {
  it('returns brand defaults for a v1 manifest (no design_tokens)', () => {
    const t = getDesignTokens({ version: 1, slide_count: 1, slides: [] });
    expect(t).toEqual({
      primary: '#1A1A1A',
      accent: '#C4A962',
      background: '#FFFFFF',
      headingFont: 'Playfair Display',
      bodyFont: 'Inter',
    });
  });

  it('falls back per-key for partially populated tokens', () => {
    const t = getDesignTokens({
      version: 2,
      design_tokens: { colors: { primary: '#FF0000' }, fonts: {} },
    });
    expect(t.primary).toBe('#FF0000');
    expect(t.accent).toBe('#C4A962');         // default
    expect(t.background).toBe('#FFFFFF');     // default
    expect(t.headingFont).toBe('Playfair Display'); // default
    expect(t.bodyFont).toBe('Inter');         // default
  });

  it('returns all values when fully populated', () => {
    const t = getDesignTokens({
      version: 2,
      design_tokens: {
        colors: { primary: '#111', accent: '#222', background: '#333' },
        fonts: { heading: 'Foo', body: 'Bar' },
      },
    });
    expect(t).toEqual({
      primary: '#111', accent: '#222', background: '#333',
      headingFont: 'Foo', bodyFont: 'Bar',
    });
  });

  it('handles null/undefined manifest', () => {
    expect(getDesignTokens(null).primary).toBe('#1A1A1A');
    expect(getDesignTokens(undefined).primary).toBe('#1A1A1A');
  });
});

describe('buildBrandedCanvasBlock', () => {
  const tokens = {
    primary: '#1A1A1A', accent: '#C4A962', background: '#FFFFFF',
    headingFont: 'Playfair Display', bodyFont: 'Inter',
  };

  it('test 1: contains layout names, fence keyword, and CSS-variable names', () => {
    const out = buildBrandedCanvasBlock('PREP IC Memo', tokens);

    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);

    // Size budget — ships every assistant turn in a project chat.
    expect(out.length).toBeLessThanOrEqual(2048);

    // 8 layout names.
    for (const layout of ['title', 'section', 'content', 'two-col', 'stat', 'table', 'quote', 'closing']) {
      expect(out).toContain(layout);
    }

    // Fence keyword.
    expect(out).toContain('canvas-deck');

    // Template name interpolated.
    expect(out).toContain('PREP IC Memo');

    // Token JSON literal.
    expect(out).toContain('#C4A962');
    expect(out).toContain('Playfair Display');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- branded-canvas`
Expected: FAIL with module-not-found error for `../lib/branded-canvas.js`.

- [ ] **Step 3: Implement `server/lib/branded-canvas.js`**

Create the file:

```js
// Pure helpers for the project-scoped branded canvas feature.
// No DB, no IO. Used by the system-prompt assembler and tests.

const DEFAULTS = {
  primary: '#1A1A1A',
  accent: '#C4A962',
  background: '#FFFFFF',
  headingFont: 'Playfair Display',
  bodyFont: 'Inter',
};

export function getDesignTokens(manifest) {
  const t = manifest?.design_tokens;
  return {
    primary:     t?.colors?.primary     || DEFAULTS.primary,
    accent:      t?.colors?.accent      || DEFAULTS.accent,
    background:  t?.colors?.background  || DEFAULTS.background,
    headingFont: t?.fonts?.heading      || DEFAULTS.headingFont,
    bodyFont:    t?.fonts?.body         || DEFAULTS.bodyFont,
  };
}

export function buildBrandedCanvasBlock(templateName, tokens) {
  const tokenJson = JSON.stringify(tokens);
  return `## Branded canvas mode

You are working in a project branded with the "${templateName}" template. When the user asks for presentation-style output (e.g. "build me an IC memo for X", "draft a one-pager", "show me a deck", "make a property summary slide"), emit a single \`\`\`canvas-deck fenced block. For all other requests (e.g. "what's the cap rate?", "summarize this lease", "explain X"), respond with normal markdown.

Format:

\`\`\`canvas-deck
<!--TOKENS:${tokenJson}-->
<section data-layout="title">
  <h1>Investment Committee Memo</h1>
  <p class="subtitle">Hilliard Acquisition · April 2026</p>
</section>
<section data-layout="content">
  <h2>Investment Thesis</h2>
  <ul><li>Stable cash flow</li><li>Strategic location</li></ul>
</section>
\`\`\`

Layouts (set via the data-layout attribute, applied via --brand-primary, --brand-accent, --font-heading, --font-body CSS variables):
- title:    cover slide; <h1> + optional <p class="subtitle">
- section:  divider; large <h1>
- content:  default body slide; <h2> + paragraphs/lists
- two-col:  side-by-side; two <div class="col"> children
- stat:     hero number; <p class="stat">$12.4M</p> + <p class="caption">
- table:    data tables; one <table>
- quote:    pull quote; <blockquote> + optional <cite>
- closing:  thank-you / next steps; <h1> + optional CTA

Tokens — copy verbatim into the TOKENS comment, do not invent your own colors or fonts:
${tokenJson}

Hard rules:
- Never include <script>, <style>, <link>, or <iframe>; they will be stripped.
- Use only the 8 layout names above. Unknown layouts render as content.
- One fenced block per response.
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- branded-canvas`
Expected: PASS — all 5 `it()` blocks green, including the `≤ 2048` size assertion.

- [ ] **Step 5: Commit**

```bash
git add server/lib/branded-canvas.js server/test/branded-canvas.test.js
git commit -m "feat(canvas): branded-canvas helpers (tokens + system-prompt block)"
```

---

## Task 6: System-prompt assembly — append brand block when project has template

**Files:**
- Create: `server/test/system-prompt-branding.test.js`
- Modify: `server/index.js`

- [ ] **Step 1: Locate the system-prompt assembly site**

Find this block in `server/index.js` (around line 730–740, just before `// Tool sets`):

```js
    // Project system prompt replaces global when present
    if (hasProjectPrompt) {
      step('Applying project system prompt');
      parts.push(project.system_prompt.trim());
    }
```

The brand block goes right after the project-system-prompt push and before `// Tool sets`.

- [ ] **Step 2: Write the failing tests**

Create `server/test/system-prompt-branding.test.js`. We test the assembly logic by exporting a small helper from `server/index.js` rather than reaching into the chat handler. Add to the test file:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, seedTestUsers, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('system-prompt branded canvas block', () => {
  let db, dbRun, dbGet, ids, applyBrandedCanvasBlock;

  beforeAll(async () => {
    const server = await import('../index.js');
    const dbMod = await import('../database.js');
    db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    applyBrandedCanvasBlock = server.applyBrandedCanvasBlock;
    ids = await seedTestUsers(dbRun);

    // Seed a v2 template owned by user A.
    const tplId = uuidv4();
    const manifest = JSON.stringify({
      version: 2, slide_count: 1, slides: [{ index: 1, title: 'X' }],
      design_tokens: {
        colors: { primary: '#111', accent: '#222', background: '#333' },
        fonts: { heading: 'Foo', body: 'Bar' },
      },
    });
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'Branded Tpl', 'ic_memo', '/fake/a.pptx', NULL, ?, 'active', ?, ?)`,
      [tplId, ids.a, manifest, now, now]
    );

    // Project owned by A with template attached.
    const projAttached = uuidv4();
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'Attached', 'active', ?, ?, ?)`,
      [projAttached, ids.a, tplId, now, now]
    );

    // Project owned by A with no template.
    const projUnattached = uuidv4();
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'Unattached', 'active', NULL, ?, ?)`,
      [projUnattached, ids.a, now, now]
    );

    // Cross-user trap: project owned by A, but stamped with user B's template id.
    // The chat-time SELECT filters by owner_id, so this should NOT pick up the brand block.
    const projCrossUser = uuidv4();
    const bTplId = uuidv4();
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'B Tpl', 'ic_memo', '/fake/b.pptx', ?, NULL, 'active', ?, ?)`,
      [bTplId, ids.b, manifest, now, now]
    );
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'CrossUser', 'active', ?, ?, ?)`,
      [projCrossUser, ids.a, bTplId, now, now]
    );

    Object.assign(ids, { tplId, projAttached, projUnattached, projCrossUser });
  });

  afterAll(() => cleanupTestPaths(paths));

  it('test 3: appends brand block when project has a template', () => {
    const project = dbGet('SELECT * FROM projects WHERE id = ?', [ids.projAttached]);
    const parts = [];
    applyBrandedCanvasBlock(db, project, parts);
    const joined = parts.join('\n');
    expect(joined).toContain('canvas-deck');
    expect(joined).toContain('Branded Tpl');
  });

  it('test 3: skips brand block when project has no template', () => {
    const project = dbGet('SELECT * FROM projects WHERE id = ?', [ids.projUnattached]);
    const parts = [];
    applyBrandedCanvasBlock(db, project, parts);
    expect(parts).toHaveLength(0);
  });

  it('test 4: skips brand block when template owner != project owner (defense in depth)', () => {
    const project = dbGet('SELECT * FROM projects WHERE id = ?', [ids.projCrossUser]);
    const parts = [];
    expect(() => applyBrandedCanvasBlock(db, project, parts)).not.toThrow();
    expect(parts).toHaveLength(0);
  });

  it('S3: chat-time template SELECT contains owner-scoped WHERE clause (static check)', () => {
    const src = fs.readFileSync('server/index.js', 'utf8');
    // The SELECT must filter on both id and user_id. Allow flexible whitespace,
    // case-sensitive keywords, and require the same statement contains both.
    const re = /SELECT[^;]+FROM\s+pptx_templates\s+WHERE\s+id\s*=\s*\?\s+AND\s+user_id\s*=\s*\?/i;
    expect(re.test(src)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- system-prompt-branding`
Expected: FAIL with `applyBrandedCanvasBlock is not a function`.

- [ ] **Step 4: Implement `applyBrandedCanvasBlock` in `server/index.js`**

At the top of `server/index.js`, ensure these imports exist (add what's missing):

```js
import { buildBrandedCanvasBlock, getDesignTokens } from './lib/branded-canvas.js';
```

Right above the `ensureWrossIcMemoTemplate` export (or anywhere in the module-level helper area), add:

```js
// Append the branded-canvas system-prompt block to `parts` if the project has
// a template attached AND the template is owned by the project owner.
// The owner_id check is defense-in-depth: PUT /api/projects validates ownership
// at attach time, but we re-verify here so a database-state anomaly cannot
// silently leak another user's branding into a chat.
export function applyBrandedCanvasBlock(database, project, parts) {
  if (!project?.pptx_template_id) return;
  const tmpl = dbGet(
    database,
    'SELECT name, manifest_json FROM pptx_templates WHERE id = ? AND user_id = ?',
    [project.pptx_template_id, project.owner_id]
  );
  if (!tmpl) return;
  let manifest;
  try { manifest = JSON.parse(tmpl.manifest_json); } catch { return; }
  const tokens = getDesignTokens(manifest);
  parts.push(buildBrandedCanvasBlock(tmpl.name, tokens));
}
```

Then in the chat handler, just after the project-system-prompt push (right before `// Tool sets`), insert:

```js
    // Project-scoped branded canvas mode
    if (project?.pptx_template_id) {
      applyBrandedCanvasBlock(db, project, parts);
      step('Branded canvas mode active');
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- system-prompt-branding`
Expected: PASS — all 4 `it()` blocks green.

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `npm test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add server/index.js server/test/system-prompt-branding.test.js
git commit -m "feat(chat): inject branded canvas block into system prompt for project chats"
```

---

## Task 7: Project endpoints accept `pptx_template_id` with ownership validation

**Files:**
- Create: `server/test/projects-template-attach.test.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write the failing tests**

Create `server/test/projects-template-attach.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { isolateTestDatabase, seedTestUsers, cleanupTestPaths } from './helpers.js';

const paths = isolateTestDatabase();

describe('project template attach + cascading detach', () => {
  let app, db, dbRun, dbGet, ids;

  beforeAll(async () => {
    const server = await import('../index.js');
    app = server.default;
    const dbMod = await import('../database.js');
    db = dbMod.getDatabase();
    dbRun = (sql, params) => dbMod.dbRun(db, sql, params);
    dbGet = (sql, params) => dbMod.dbGet(db, sql, params);
    ids = await seedTestUsers(dbRun);

    const now = new Date().toISOString();
    const v2Manifest = JSON.stringify({
      version: 2, slide_count: 1, slides: [{ index: 1, title: 'X' }],
      design_tokens: {
        colors: { primary: '#111', accent: '#222', background: '#333' },
        fonts: { heading: 'Foo', body: 'Bar' },
      },
    });
    const aTplId = uuidv4();
    const bTplId = uuidv4();
    const archivedTplId = uuidv4();
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'A Tpl', 'ic_memo', '/fake/a.pptx', NULL, ?, 'active', ?, ?)`,
      [aTplId, ids.a, v2Manifest, now, now]
    );
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'B Tpl', 'ic_memo', '/fake/b.pptx', NULL, ?, 'active', ?, ?)`,
      [bTplId, ids.b, v2Manifest, now, now]
    );
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'A Archived', 'ic_memo', '/fake/a-arc.pptx', NULL, ?, 'archived', ?, ?)`,
      [archivedTplId, ids.a, v2Manifest, now, now]
    );
    Object.assign(ids, { aTplId, bTplId, archivedTplId });
  });

  afterAll(() => cleanupTestPaths(paths));

  it('test 5: PUT /api/projects/:id rejects cross-user template with 400', async () => {
    // Create a project owned by A.
    const create = await request(app)
      .post('/api/projects')
      .set('X-User-Id', ids.a)
      .send({ name: 'A Project', description: 'x' });
    expect(create.status).toBe(201);
    const projId = create.body.project.id;

    // Try to attach user B's template via PUT.
    const res = await request(app)
      .put(`/api/projects/${projId}`)
      .set('X-User-Id', ids.a)
      .send({ pptx_template_id: ids.bTplId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found|not owned/i);

    // Project's column unchanged.
    const proj = dbGet('SELECT pptx_template_id FROM projects WHERE id = ?', [projId]);
    expect(proj.pptx_template_id).toBeNull();
  });

  it('test 5: PUT accepts owner template and persists it', async () => {
    const create = await request(app).post('/api/projects').set('X-User-Id', ids.a).send({ name: 'B Project' });
    const projId = create.body.project.id;

    const res = await request(app)
      .put(`/api/projects/${projId}`)
      .set('X-User-Id', ids.a)
      .send({ pptx_template_id: ids.aTplId });
    expect(res.status).toBe(200);

    const proj = dbGet('SELECT pptx_template_id FROM projects WHERE id = ?', [projId]);
    expect(proj.pptx_template_id).toBe(ids.aTplId);
  });

  it('test 5: PUT rejects archived templates with 400', async () => {
    const create = await request(app).post('/api/projects').set('X-User-Id', ids.a).send({ name: 'Archived Project' });
    const projId = create.body.project.id;

    const res = await request(app)
      .put(`/api/projects/${projId}`)
      .set('X-User-Id', ids.a)
      .send({ pptx_template_id: ids.archivedTplId });
    expect(res.status).toBe(400);
  });

  it('test 5: PUT with null pptx_template_id detaches', async () => {
    // Pre-attach via SQL to skip the API path.
    const projId = uuidv4();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'Detach Me', 'active', ?, ?, ?)`,
      [projId, ids.a, ids.aTplId, now, now]
    );

    const res = await request(app)
      .put(`/api/projects/${projId}`)
      .set('X-User-Id', ids.a)
      .send({ pptx_template_id: null });
    expect(res.status).toBe(200);

    const proj = dbGet('SELECT pptx_template_id FROM projects WHERE id = ?', [projId]);
    expect(proj.pptx_template_id).toBeNull();
  });

  it('test 5: POST accepts pptx_template_id with ownership validation', async () => {
    const ok = await request(app)
      .post('/api/projects')
      .set('X-User-Id', ids.a)
      .send({ name: 'POST OK', pptx_template_id: ids.aTplId });
    expect(ok.status).toBe(201);
    expect(ok.body.project.pptx_template_id).toBe(ids.aTplId);

    const bad = await request(app)
      .post('/api/projects')
      .set('X-User-Id', ids.a)
      .send({ name: 'POST Bad', pptx_template_id: ids.bTplId });
    expect(bad.status).toBe(400);
  });

  it('test 6: DELETE /api/pptx-templates/:id nulls dependent project columns', async () => {
    // Create a fresh template + project, attach, then delete the template.
    const tplId = uuidv4();
    const now = new Date().toISOString();
    const v2Manifest = JSON.stringify({
      version: 2, slide_count: 1, slides: [{ index: 1, title: 'X' }],
      design_tokens: {
        colors: { primary: '#111', accent: '#222', background: '#333' },
        fonts: { heading: 'Foo', body: 'Bar' },
      },
    });
    dbRun(
      `INSERT INTO pptx_templates
       (id, user_id, name, template_type, source_pptx_path, thumbnail_path, manifest_json, status, created_at, updated_at)
       VALUES (?, ?, 'Doomed', 'ic_memo', '/fake/doomed.pptx', NULL, ?, 'active', ?, ?)`,
      [tplId, ids.a, v2Manifest, now, now]
    );
    const projId = uuidv4();
    dbRun(
      `INSERT INTO projects (id, owner_id, name, status, pptx_template_id, created_at, updated_at)
       VALUES (?, ?, 'Cascade Project', 'active', ?, ?, ?)`,
      [projId, ids.a, tplId, now, now]
    );

    const res = await request(app)
      .delete(`/api/pptx-templates/${tplId}`)
      .set('X-User-Id', ids.a);
    expect(res.status).toBe(204);

    // Template gone.
    const tpl = dbGet('SELECT * FROM pptx_templates WHERE id = ?', [tplId]);
    expect(tpl).toBeUndefined();

    // Project's column nulled.
    const proj = dbGet('SELECT pptx_template_id FROM projects WHERE id = ?', [projId]);
    expect(proj.pptx_template_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- projects-template-attach`
Expected: FAIL — endpoints don't yet accept `pptx_template_id`, so the cross-user POST returns 201 instead of 400, the PUT doesn't persist, etc.

- [ ] **Step 3: Update POST `/api/projects` (~line 1242) to accept and validate `pptx_template_id`**

Locate the POST handler and replace it with:

```js
app.post('/api/projects', requireAuth, (req, res) => {
  const { name, description, default_model, system_prompt, temperature, tool_sets, pptx_template_id } = req.body;

  // Validate template ownership when attaching.
  if (pptx_template_id) {
    const tpl = dbGet(db,
      `SELECT id FROM pptx_templates WHERE id = ? AND user_id = ? AND status != 'archived'`,
      [pptx_template_id, req.user.id]
    );
    if (!tpl) return res.status(400).json({ error: 'template not found or not owned' });
  }

  const projectId = uuidv4();
  const now = new Date().toISOString();

  dbRun(db, `
    INSERT INTO projects (id, owner_id, name, description, default_model, system_prompt, temperature, tool_sets, status, pptx_template_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    projectId,
    req.user.id,
    name,
    description || null,
    default_model || 'gemini',
    system_prompt || null,
    temperature || 0.7,
    tool_sets ? JSON.stringify(tool_sets) : JSON.stringify([]),
    'active',
    pptx_template_id || null,
    now,
    now
  ]);

  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [projectId]);
  res.status(201).json({ project });
});
```

- [ ] **Step 4: Update PUT `/api/projects/:id` (~line 1288) to accept and validate `pptx_template_id`**

Find the PUT handler and replace its body with this version (preserves all existing fields, adds template support):

```js
app.put('/api/projects/:id', requireAuth, (req, res) => {
  const { name, description, default_model, system_prompt, temperature, tool_sets, mcp_servers, pptx_template_id } = req.body;

  const project = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const isOwner = project.owner_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  const isMember = dbGet(db, 'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!isOwner && !isAdmin && !isMember) {
    return res.status(403).json({ error: 'Not authorized to update this project' });
  }

  // Validate template ownership when attaching a non-null value.
  // Null is a valid detach signal and skips validation.
  if (pptx_template_id !== undefined && pptx_template_id !== null) {
    const tpl = dbGet(db,
      `SELECT id FROM pptx_templates WHERE id = ? AND user_id = ? AND status != 'archived'`,
      [pptx_template_id, project.owner_id]
    );
    if (!tpl) return res.status(400).json({ error: 'template not found or not owned' });
  }

  const now = new Date().toISOString();
  dbRun(db, `
    UPDATE projects
    SET name = ?, description = ?, default_model = ?, system_prompt = ?, temperature = ?, tool_sets = ?, mcp_servers = ?, pptx_template_id = ?, updated_at = ?
    WHERE id = ?
  `, [
    name !== undefined ? name : project.name,
    description !== undefined ? description : project.description,
    default_model !== undefined ? default_model : project.default_model,
    system_prompt !== undefined ? system_prompt : project.system_prompt,
    temperature !== undefined ? temperature : project.temperature,
    tool_sets !== undefined ? JSON.stringify(tool_sets) : project.tool_sets,
    mcp_servers !== undefined ? JSON.stringify(mcp_servers) : project.mcp_servers,
    pptx_template_id !== undefined ? pptx_template_id : project.pptx_template_id,
    now,
    req.params.id
  ]);

  const updated = dbGet(db, 'SELECT * FROM projects WHERE id = ?', [req.params.id]);
  res.json({ project: updated });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- projects-template-attach`
Expected: 5 of 6 tests pass — the DELETE cascade test still fails because we haven't added the cascading detach yet (Task 8).

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/test/projects-template-attach.test.js
git commit -m "feat(api): projects accept pptx_template_id with ownership validation"
```

---

## Task 8: DELETE template cascading detach

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Locate the DELETE handler**

Find `app.delete('/api/pptx-templates/:id', ...)` in `server/index.js` (~line 2279).

- [ ] **Step 2: Add the cascading detach UPDATE before the row delete**

Inside the handler, just before `dbRun(db, 'DELETE FROM pptx_templates WHERE id = ? AND user_id = ?', [row.id, userId]);`, add:

```js
  // Cascading detach: null out the column on any projects that referenced this template.
  // SQLite FKs are off, so we do it in application code. The index from Task 1 keeps it cheap.
  dbRun(db, 'UPDATE projects SET pptx_template_id = NULL WHERE pptx_template_id = ?', [row.id]);
```

- [ ] **Step 3: Run the cascade test to verify it passes**

Run: `npm test -- projects-template-attach`
Expected: All 6 `it()` blocks now pass, including `test 6: DELETE /api/pptx-templates/:id nulls dependent project columns`.

- [ ] **Step 4: Run full test suite to verify no regressions**

Run: `npm test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(api): cascading detach when deleting a pptx template"
```

---

## Task 9: `<TemplatePickerModal />` shared component

**Files:**
- Create: `src/components/templates/TemplatePickerModal.tsx`

(No frontend tests per spec decision #9. Verified via the manual smoke pass in Task 14.)

- [ ] **Step 1: Create the modal**

Create `src/components/templates/TemplatePickerModal.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import * as api from '../../api';

interface PptxTemplate {
  id: string;
  name: string;
  template_type: string;
  status: 'active' | 'archived';
  has_thumbnail?: boolean;
  manifest_json?: string;
}

interface Props {
  selectedId?: string | null;
  onClose: () => void;
  onSelect: (template: PptxTemplate) => void;
}

export default function TemplatePickerModal({ selectedId, onClose, onSelect }: Props) {
  const [templates, setTemplates] = useState<PptxTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.pptxTemplates.list({ includeArchived: false })
      .then((data: any) => setTemplates(data.templates || data || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-vetted-border">
          <h3 className="text-base font-medium text-vetted-primary">Choose Branding Template</h3>
          <button onClick={onClose} className="p-1 hover:bg-vetted-surface rounded-lg">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-vetted-border">
          {loading ? (
            <p className="text-sm text-vetted-text-muted text-center py-8">Loading…</p>
          ) : templates.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-vetted-text-muted">You don't have any templates yet.</p>
              <a href="/apps/pptx-parser" className="text-sm text-vetted-accent hover:underline">Upload one →</a>
            </div>
          ) : templates.map((tpl) => {
            const isSelected = tpl.id === selectedId;
            return (
              <button
                key={tpl.id}
                onClick={() => { onSelect(tpl); onClose(); }}
                className={`w-full flex items-center gap-3 px-5 py-3 hover:bg-vetted-surface text-left transition-colors ${isSelected ? 'bg-vetted-accent/10' : ''}`}
              >
                <FileText size={16} className="text-vetted-text-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tpl.name}</p>
                  <p className="text-xs text-vetted-text-muted capitalize">{tpl.template_type.replace(/_/g, ' ')}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

(Note: this assumes `api.pptxTemplates.list({ includeArchived })` exists — confirmed in [PptxAppPage.tsx:56](../../src/pages/PptxAppPage.tsx#L56). If the actual exported name differs, match it.)

- [ ] **Step 2: Verify it builds**

Run: `npm run build` (or just confirm no TypeScript errors from the dev server's HMR logs).
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/templates/TemplatePickerModal.tsx
git commit -m "feat(ui): TemplatePickerModal component"
```

---

## Task 10: ProjectForm branding-template field + plumbing

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/projects/ProjectForm.tsx`
- Modify: `src/pages/ProjectDetailPage.tsx`

- [ ] **Step 1: Add `pptx_template_id` to the `Project` type**

Open `src/types/index.ts`. Find the `Project` interface and add the optional field:

```ts
export interface Project {
  // ... existing fields
  pptx_template_id?: string | null;
}
```

(If a `Project` interface doesn't exist yet — search for `interface Project` — match the existing pattern: the file already exports interfaces for User, Chat, etc.)

- [ ] **Step 2: Extend `ProjectFormData` and add the picker UI**

Open `src/components/projects/ProjectForm.tsx`. Update the interface:

```ts
export interface ProjectFormData {
  name: string;
  description: string;
  system_prompt: string;
  tool_sets: string[];
  mcp_servers: string[];
  default_model: string;
  file_ids: string[];
  pptx_template_id: string | null;
}
```

Add an import at the top:

```tsx
import TemplatePickerModal from '../templates/TemplatePickerModal';
```

Inside the component body, alongside the other `useState` calls, add:

```tsx
  const [pptxTemplateId, setPptxTemplateId] = useState<string | null>(initialData?.pptx_template_id ?? null);
  const [pptxTemplateName, setPptxTemplateName] = useState<string>('');
  const [pptxTemplateStatus, setPptxTemplateStatus] = useState<string>('active');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Hydrate the chip with the template's name when initialData provides an id.
  useEffect(() => {
    if (!pptxTemplateId) { setPptxTemplateName(''); return; }
    api.pptxTemplates.list({ includeArchived: true })
      .then((data: any) => {
        const list = data.templates || data || [];
        const tpl = list.find((t: any) => t.id === pptxTemplateId);
        if (tpl) {
          setPptxTemplateName(tpl.name);
          setPptxTemplateStatus(tpl.status);
        }
      })
      .catch(() => {});
  }, [pptxTemplateId]);
```

In the `handleSubmit` body, replace the `onSave` call with:

```tsx
    const result = await onSave({
      name, description, system_prompt: systemPrompt,
      tool_sets: [], mcp_servers: enabledMcps, default_model: selectedModel,
      file_ids: selectedFileIds,
      pptx_template_id: pptxTemplateId,
    });
```

In the JSX, after the MCP Tools section and before the Skills section (so above `{projectSkills.length > 0 && (...)}`), add:

```tsx
              {/* Branding Template */}
              <div>
                <label className="block text-sm font-medium text-vetted-primary mb-1">Branding template</label>
                <p className="text-xs text-vetted-text-muted mb-2">When set, presentation-style requests render as a branded slide deck.</p>
                {pptxTemplateId ? (
                  <div className="flex items-center gap-3 px-3 py-2 border border-vetted-border rounded-lg">
                    <FileText size={14} className="text-vetted-text-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        {pptxTemplateName || pptxTemplateId}
                        {pptxTemplateStatus === 'archived' && <span className="ml-2 text-xs text-vetted-text-muted">(archived)</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPptxTemplateId(null)}
                      className="p-0.5 hover:bg-vetted-surface rounded"
                      title="Detach template"
                    >
                      <X size={13} className="text-vetted-text-muted" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowTemplatePicker(true)}
                    className="text-sm px-3 py-2 border border-dashed border-vetted-border rounded-lg w-full text-vetted-text-muted hover:border-vetted-accent hover:text-vetted-primary transition-colors"
                  >
                    Choose template…
                  </button>
                )}
              </div>
```

At the bottom of the rendered tree (after `{showLibrary && (...)}`), add:

```tsx
      {showTemplatePicker && (
        <TemplatePickerModal
          selectedId={pptxTemplateId}
          onClose={() => setShowTemplatePicker(false)}
          onSelect={(tpl) => {
            setPptxTemplateId(tpl.id);
            setPptxTemplateName(tpl.name);
            setPptxTemplateStatus(tpl.status);
          }}
        />
      )}
```

- [ ] **Step 3: Plumb `pptx_template_id` through `ProjectDetailPage`**

Open `src/pages/ProjectDetailPage.tsx`. Update the `handleUpdateProject` signature and body:

```tsx
  const handleUpdateProject = async (data: { name: string; description: string; system_prompt: string; tool_sets: string[]; mcp_servers: string[]; file_ids: string[]; pptx_template_id: string | null }) => {
    if (!project || !id) return;
    setSaving(true);
    try {
      await api.projects.update(id, {
        name: data.name,
        description: data.description,
        system_prompt: data.system_prompt,
        mcp_servers: data.mcp_servers || [],
        pptx_template_id: data.pptx_template_id,
      });
      // ... rest of body unchanged
```

Update the `setProject(...)` line later in the same function to include the new field:

```tsx
      setProject({ ...project, name: data.name, description: data.description, system_prompt: data.system_prompt, mcp_servers: data.mcp_servers as any, pptx_template_id: data.pptx_template_id });
```

Update the `<ProjectForm initialData={...}>` block in the JSX to include the field:

```tsx
          initialData={{
            name: project.name,
            description: project.description,
            system_prompt: project.system_prompt,
            tool_sets: project.tool_sets as unknown as string[],
            mcp_servers: project.mcp_servers as unknown as string[],
            file_ids: projectFiles.map((f) => f.id),
            pptx_template_id: (project as any).pptx_template_id ?? null,
          }}
```

- [ ] **Step 4: Manual verification**

With the dev server running:
- Open a project, click Settings (the gear icon in the project header).
- Confirm the new "Branding template" field appears below MCP Tools.
- Click "Choose template…" → modal opens with the seeded IC Memo template.
- Click the template → chip appears with the template name.
- Click the `[×]` on the chip → field returns to empty state.
- Save the project → no console errors.
- Reopen settings → the chip is restored from the persisted column.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/components/projects/ProjectForm.tsx src/pages/ProjectDetailPage.tsx
git commit -m "feat(ui): branding-template field in ProjectForm"
```

---

## Task 11: `<ProjectPickerModal />` + "Apply to project…" action on PptxAppPage

**Files:**
- Create: `src/components/projects/ProjectPickerModal.tsx`
- Modify: `src/pages/PptxAppPage.tsx`

- [ ] **Step 1: Create `<ProjectPickerModal />`**

Create `src/components/projects/ProjectPickerModal.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { X, Folder } from 'lucide-react';
import * as api from '../../api';

interface Project {
  id: string;
  name: string;
  pptx_template_id?: string | null;
}

interface Props {
  templateId: string;
  templateName: string;
  onClose: () => void;
  onApplied: () => void;
}

export default function ProjectPickerModal({ templateId, templateName, onClose, onApplied }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmFor, setConfirmFor] = useState<Project | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    api.projects.list()
      .then((data: any) => setProjects(data.projects || data || []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  const apply = async (proj: Project) => {
    setApplying(true);
    try {
      await api.projects.update(proj.id, { pptx_template_id: templateId });
      onApplied();
      onClose();
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-vetted-border">
          <h3 className="text-base font-medium text-vetted-primary">Apply to Project</h3>
          <button onClick={onClose} className="p-1 hover:bg-vetted-surface rounded-lg">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-vetted-border">
          {loading ? (
            <p className="text-sm text-vetted-text-muted text-center py-8">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-vetted-text-muted text-center py-8">No projects.</p>
          ) : projects.map((proj) => {
            const alreadyBranded = !!proj.pptx_template_id;
            return (
              <button
                key={proj.id}
                onClick={() => setConfirmFor(proj)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-vetted-surface text-left"
              >
                <Folder size={16} className="text-vetted-text-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{proj.name}</p>
                  {alreadyBranded && (
                    <p className="text-xs text-vetted-text-muted">Currently branded — will be replaced</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {confirmFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h4 className="text-base font-medium text-vetted-primary mb-2">Confirm</h4>
            <p className="text-sm text-vetted-text-secondary mb-5">
              Apply "{templateName}" as the branding template for project "{confirmFor.name}"?
              {confirmFor.pptx_template_id && ' This replaces the current template.'}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmFor(null)} className="btn-secondary text-sm py-1.5 px-3">Cancel</button>
              <button
                onClick={() => apply(confirmFor)}
                disabled={applying}
                className="btn-primary text-sm py-1.5 px-3"
              >
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the "Apply to project…" action to PptxAppPage rows**

Open `src/pages/PptxAppPage.tsx`. Add the import:

```tsx
import ProjectPickerModal from '../components/projects/ProjectPickerModal';
```

Add to the lucide import:

```tsx
import { Upload, CheckCircle, AlertCircle, Loader2, ArrowLeft, Plus, Eye, Pencil, RefreshCw, Archive, ArchiveRestore, Trash2, Send } from 'lucide-react';
```

Add a state hook near the other state at the top of the page component:

```tsx
  const [applyForId, setApplyForId] = useState<string | null>(null);
  const [applyForName, setApplyForName] = useState<string>('');
```

In the row action area (around line 310), insert the new button between Replace and Archive:

```tsx
                      <button onClick={() => handleReplace(t)} title="Replace" className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted">
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={() => { setApplyForId(t.id); setApplyForName(t.name); }}
                        title="Apply to project…"
                        className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted"
                      >
                        <Send size={14} />
                      </button>
                      <button
                        onClick={() => handleArchiveToggle(t)}
                        ...
```

At the bottom of the page's rendered tree (next to other modals), add:

```tsx
      {applyForId && (
        <ProjectPickerModal
          templateId={applyForId}
          templateName={applyForName}
          onClose={() => { setApplyForId(null); setApplyForName(''); }}
          onApplied={() => addToast({ type: 'success', title: 'Applied to project' })}
        />
      )}
```

- [ ] **Step 3: Manual verification**

With the dev server running:
- Visit `/apps/pptx-parser`.
- Find the seeded IC Memo template row.
- Click the new Send icon — modal opens with project list.
- Pick a project — confirm modal appears.
- Click Apply — toast shows "Applied to project".
- Open that project's Settings — confirm the IC Memo template is now attached.

- [ ] **Step 4: Commit**

```bash
git add src/components/projects/ProjectPickerModal.tsx src/pages/PptxAppPage.tsx
git commit -m "feat(ui): Apply to project action on PptxAppPage rows"
```

---

## Task 12: Layout CSS file + `<CanvasDeckBlock />` component

**Files:**
- Create: `src/components/chat/canvas-deck-styles.css`
- Create: `src/components/chat/CanvasDeckBlock.tsx`

- [ ] **Step 1: Create the layout stylesheet**

Create `src/components/chat/canvas-deck-styles.css`:

```css
/* Canvas Deck — 16:9 frame + 8 layouts + nav chrome.
   All theme values come from CSS variables defined inline by CanvasDeckBlock:
     --brand-primary, --brand-accent, --brand-background, --font-heading, --font-body
*/

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  width: 100%; height: 100%;
  background: var(--brand-background);
  color: var(--brand-primary);
  font-family: var(--font-body);
}

.deck {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
}

.slide {
  position: absolute;
  inset: 0;
  padding: 5% 8%;
  display: none;
  flex-direction: column;
  justify-content: flex-start;
  background: var(--brand-background);
}
.slide[aria-current="true"] { display: flex; }

.slide h1, .slide h2, .slide h3 {
  font-family: var(--font-heading);
  color: var(--brand-primary);
  line-height: 1.15;
  margin-bottom: 0.4em;
}
.slide h1 { font-size: 3.6vw; font-weight: 600; }
.slide h2 { font-size: 2.4vw; font-weight: 600; border-bottom: 2px solid var(--brand-accent); padding-bottom: 0.3em; margin-bottom: 0.6em; }
.slide h3 { font-size: 1.6vw; font-weight: 500; }
.slide p, .slide li { font-size: 1.4vw; line-height: 1.5; margin-bottom: 0.5em; }
.slide ul, .slide ol { padding-left: 1.4em; }
.slide strong { color: var(--brand-accent); font-weight: 600; }

/* title */
.slide[data-layout="title"] { justify-content: center; align-items: flex-start; }
.slide[data-layout="title"] h1 { font-size: 5vw; }
.slide[data-layout="title"] .subtitle { font-size: 1.8vw; color: var(--brand-accent); margin-top: 0.4em; font-family: var(--font-body); font-style: italic; }

/* section */
.slide[data-layout="section"] { justify-content: center; align-items: flex-start; background: var(--brand-primary); color: var(--brand-background); }
.slide[data-layout="section"] h1 { color: var(--brand-background); font-size: 4.5vw; border-left: 6px solid var(--brand-accent); padding-left: 0.4em; }

/* content — default, uses base styles */

/* two-col */
.slide[data-layout="two-col"] { padding: 5% 8%; }
.slide[data-layout="two-col"] > h2 { width: 100%; }
.slide[data-layout="two-col"] .col-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 5%; flex: 1; }
.slide[data-layout="two-col"] .col { display: flex; flex-direction: column; gap: 0.5em; }
/* Fallback if AI emits two raw <div class="col"> without a wrapper */
.slide[data-layout="two-col"] > div.col:first-of-type { grid-column: 1; }

/* stat */
.slide[data-layout="stat"] { justify-content: center; align-items: center; text-align: center; }
.slide[data-layout="stat"] .stat { font-family: var(--font-heading); font-size: 10vw; color: var(--brand-accent); font-weight: 700; line-height: 1; }
.slide[data-layout="stat"] .caption { font-size: 1.6vw; color: var(--brand-primary); margin-top: 0.5em; }

/* table */
.slide[data-layout="table"] table { width: 100%; border-collapse: collapse; font-size: 1.2vw; margin-top: 0.6em; }
.slide[data-layout="table"] th, .slide[data-layout="table"] td { border-bottom: 1px solid #e0e0e0; padding: 0.6em 0.8em; text-align: left; }
.slide[data-layout="table"] th { background: var(--brand-primary); color: var(--brand-background); font-family: var(--font-heading); font-weight: 600; }
.slide[data-layout="table"] tr:nth-child(even) td { background: rgba(0,0,0,0.02); }

/* quote */
.slide[data-layout="quote"] { justify-content: center; align-items: flex-start; }
.slide[data-layout="quote"] blockquote { font-family: var(--font-heading); font-size: 2.6vw; font-style: italic; line-height: 1.3; color: var(--brand-primary); border-left: 6px solid var(--brand-accent); padding-left: 0.6em; }
.slide[data-layout="quote"] cite { display: block; margin-top: 1em; font-size: 1.3vw; color: var(--brand-accent); font-style: normal; }

/* closing */
.slide[data-layout="closing"] { justify-content: center; align-items: center; text-align: center; background: var(--brand-primary); color: var(--brand-background); }
.slide[data-layout="closing"] h1 { color: var(--brand-background); font-size: 4vw; }
.slide[data-layout="closing"] p { color: var(--brand-accent); font-size: 1.6vw; margin-top: 0.6em; }

/* Nav chrome */
.deck-nav {
  position: absolute;
  bottom: 12px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px;
  background: rgba(255,255,255,0.92);
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--brand-primary);
  font-family: var(--font-body);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.deck-nav button { background: none; border: 0; cursor: pointer; font-size: 16px; color: var(--brand-primary); padding: 2px 6px; }
.deck-nav button:disabled { opacity: 0.3; cursor: default; }
.deck-nav .dots { display: flex; gap: 4px; }
.deck-nav .dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(0,0,0,0.15); border: 0; padding: 0; cursor: pointer; }
.deck-nav .dot[aria-current="true"] { background: var(--brand-accent); }
.deck-nav .counter { font-variant-numeric: tabular-nums; min-width: 3em; text-align: center; }
```

- [ ] **Step 2: Create `<CanvasDeckBlock />`**

Create `src/components/chat/CanvasDeckBlock.tsx`:

```tsx
import React, { useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Eye, Code, Copy, Download, ExternalLink, Check } from 'lucide-react';
import LAYOUT_CSS from './canvas-deck-styles.css?raw';

interface Props {
  body: string; // raw fence body, including <!--TOKENS:...--> header
}

const DEFAULTS = {
  primary: '#1A1A1A',
  accent: '#C4A962',
  background: '#FFFFFF',
  headingFont: 'Playfair Display',
  bodyFont: 'Inter',
};

const KNOWN_LAYOUTS = new Set(['title', 'section', 'content', 'two-col', 'stat', 'table', 'quote', 'closing']);

const NAV_SCRIPT = `
  (function() {
    const slides = Array.from(document.querySelectorAll('.slide'));
    const dots = Array.from(document.querySelectorAll('.deck-nav .dot'));
    const prev = document.querySelector('.deck-nav .prev');
    const next = document.querySelector('.deck-nav .next');
    const counter = document.querySelector('.deck-nav .counter');
    let i = 0;
    function show(n) {
      i = Math.max(0, Math.min(slides.length - 1, n));
      slides.forEach((s, idx) => s.setAttribute('aria-current', idx === i ? 'true' : 'false'));
      dots.forEach((d, idx) => d.setAttribute('aria-current', idx === i ? 'true' : 'false'));
      if (counter) counter.textContent = (i + 1) + ' / ' + slides.length;
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === slides.length - 1;
    }
    if (prev) prev.addEventListener('click', () => show(i - 1));
    if (next) next.addEventListener('click', () => show(i + 1));
    dots.forEach((d, idx) => d.addEventListener('click', () => show(idx)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });
    show(0);
  })();
`;

function parseTokens(body: string): typeof DEFAULTS {
  const m = body.match(/<!--TOKENS:({.*?})-->/);
  if (!m) return DEFAULTS;
  try {
    const parsed = JSON.parse(m[1]);
    return {
      primary: parsed.primary || DEFAULTS.primary,
      accent: parsed.accent || DEFAULTS.accent,
      background: parsed.background || DEFAULTS.background,
      headingFont: parsed.headingFont || DEFAULTS.headingFont,
      bodyFont: parsed.bodyFont || DEFAULTS.bodyFont,
    };
  } catch {
    return DEFAULTS;
  }
}

function parseSections(body: string): { layout: string; html: string }[] {
  const stripped = body.replace(/<!--TOKENS:.*?-->/, '');
  const doc = new DOMParser().parseFromString(`<root>${stripped}</root>`, 'text/html');
  const sections = Array.from(doc.querySelectorAll('section[data-layout]'));
  return sections.map((s) => {
    let layout = s.getAttribute('data-layout') || 'content';
    if (!KNOWN_LAYOUTS.has(layout)) {
      console.warn(`[CanvasDeckBlock] unknown layout "${layout}" — falling back to content`);
      layout = 'content';
    }
    const html = DOMPurify.sanitize(s.innerHTML, {
      FORBID_TAGS: ['script', 'style', 'link', 'iframe', 'object', 'embed'],
      ADD_ATTR: ['class', 'data-layout'],
    });
    return { layout, html };
  });
}

function buildSrcDoc(tokens: typeof DEFAULTS, sections: { layout: string; html: string }[]): string {
  const fontHeadingEsc = encodeURIComponent(tokens.headingFont).replace(/%20/g, '+');
  const fontBodyEsc = encodeURIComponent(tokens.bodyFont).replace(/%20/g, '+');
  const slidesHtml = sections.map((s) =>
    `<article class="slide" data-layout="${s.layout}" aria-current="false">${s.html}</article>`
  ).join('\n');
  const dotsHtml = sections.map((_, i) =>
    `<button class="dot" aria-current="${i === 0 ? 'true' : 'false'}"></button>`
  ).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
:root {
  --brand-primary: ${tokens.primary};
  --brand-accent: ${tokens.accent};
  --brand-background: ${tokens.background};
  --font-heading: '${tokens.headingFont}', Georgia, serif;
  --font-body: '${tokens.bodyFont}', system-ui, sans-serif;
}
${LAYOUT_CSS}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fontHeadingEsc}&family=${fontBodyEsc}&display=swap">
</head><body>
<div class="deck">${slidesHtml}</div>
<nav class="deck-nav" role="navigation">
  <button class="prev" aria-label="Previous slide">←</button>
  <div class="dots">${dotsHtml}</div>
  <span class="counter">1 / ${sections.length}</span>
  <button class="next" aria-label="Next slide">→</button>
</nav>
<script>${NAV_SCRIPT}</script>
</body></html>`;
}

export default function CanvasDeckBlock({ body }: Props) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { srcDoc, sectionCount } = useMemo(() => {
    const tokens = parseTokens(body);
    const sections = parseSections(body);
    if (sections.length === 0) return { srcDoc: '', sectionCount: 0 };
    return { srcDoc: buildSrcDoc(tokens, sections), sectionCount: sections.length };
  }, [body]);

  // Empty/malformed fence → fall back to a plain code block.
  if (sectionCount === 0) {
    return (
      <pre className="my-3 px-4 py-3 rounded-xl bg-[#1a1a1a] overflow-x-auto text-[13px] leading-relaxed">
        <code className="text-green-300 font-mono">{body}</code>
      </pre>
    );
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const handleDownload = () => {
    const blob = new Blob([srcDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'deck.html'; a.click();
    URL.revokeObjectURL(url);
  };
  const handleNewTab = () => {
    const blob = new Blob([srcDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <div className="my-3 rounded-xl bg-[#1a1a1a] overflow-hidden border border-[#2a2a2a]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#2a2a2a]">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${tab === 'preview' ? 'bg-[#C4A962]/20 text-[#C4A962]' : 'text-white/40 hover:text-white/60'}`}
          ><Eye size={13} /> Preview</button>
          <button
            onClick={() => setTab('code')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${tab === 'code' ? 'bg-[#C4A962]/20 text-[#C4A962]' : 'text-white/40 hover:text-white/60'}`}
          ><Code size={13} /> Code</button>
          <span className="ml-2 text-[10px] text-white/40 self-center">{sectionCount} slide{sectionCount === 1 ? '' : 's'}</span>
        </div>
        <div className="flex gap-1">
          <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5" title="Copy">
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5" title="Download">
            <Download size={13} />
          </button>
          <button onClick={handleNewTab} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5" title="Open in new tab">
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {tab === 'preview' ? (
        <div className="relative">
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            className="w-full bg-white border-0"
            style={{ height: expanded ? '80vh' : '480px' }}
            title="Canvas deck preview"
          />
          <button
            onClick={() => setExpanded(!expanded)}
            className="absolute bottom-2 right-2 px-2 py-1 rounded text-[10px] bg-black/60 text-white/60 hover:text-white/80"
          >{expanded ? 'Collapse' : 'Expand'}</button>
        </div>
      ) : (
        <pre className="px-4 py-3 overflow-x-auto text-[13px] leading-relaxed max-h-[500px]">
          <code className="text-green-300 font-mono">{body}</code>
        </pre>
      )}
    </div>
  );
}
```

Key safety detail: `sandbox="allow-scripts"` (no `allow-same-origin`). Together those two would let the iframe escape; alone, scripts run in an opaque origin and cannot reach the parent.

- [ ] **Step 3: Verify the build picks up `?raw`**

Run: `npm run build`
Expected: Build succeeds. Vite ships `?raw` support out of the box, no config changes needed.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/canvas-deck-styles.css src/components/chat/CanvasDeckBlock.tsx
git commit -m "feat(ui): CanvasDeckBlock renderer with 8 layouts + nav"
```

---

## Task 13: Wire `language-canvas-deck` branch in MainChatPage and ChatView

**Files:**
- Modify: `src/pages/MainChatPage.tsx`
- Modify: `src/components/chat/ChatView.tsx`

- [ ] **Step 1: Add the branch in `MainChatPage.tsx`**

Open `src/pages/MainChatPage.tsx`. At the top, add the import (or update the existing canvas import line):

```tsx
import CanvasDeckBlock from '../components/chat/CanvasDeckBlock';
```

Find the `code: ({ className, children }) => {` block (~line 257). Right after the existing `language-canvas-html` branch, add a sibling:

```tsx
                  if (className?.includes('language-canvas-html')) {
                    return <CanvasBlock html={String(children)} />;
                  }
                  if (className?.includes('language-canvas-deck')) {
                    return <CanvasDeckBlock body={String(children)} />;
                  }
```

- [ ] **Step 2: Same diff in `ChatView.tsx`**

Open `src/components/chat/ChatView.tsx`. Add the import:

```tsx
import CanvasDeckBlock from './CanvasDeckBlock';
```

Find the `language-canvas-html` branch (~line 84) and add the sibling:

```tsx
            if (className?.includes('language-canvas-html')) {
              return <CanvasBlock html={String(children)} />;
            }
            if (className?.includes('language-canvas-deck')) {
              return <CanvasDeckBlock body={String(children)} />;
            }
```

- [ ] **Step 3: Smoke test the renderer with a synthetic fence**

In the dev console (with the dev server running), open a regular markdown chat and have the AI emit (or paste a hand-rolled response containing) a sample fence:

````
```canvas-deck
<!--TOKENS:{"primary":"#1A1A1A","accent":"#C4A962","background":"#FFFFFF","headingFont":"Playfair Display","bodyFont":"Inter"}-->
<section data-layout="title">
  <h1>Test Deck</h1>
  <p class="subtitle">Smoke test</p>
</section>
<section data-layout="content">
  <h2>It works</h2>
  <ul><li>Slide 1</li><li>Slide 2</li></ul>
</section>
```
````

Expected: a 2-slide deck renders, the toolbar shows "2 slides", prev/next buttons cycle, dots highlight, keyboard arrows work.

- [ ] **Step 4: Commit**

```bash
git add src/pages/MainChatPage.tsx src/components/chat/ChatView.tsx
git commit -m "feat(chat): mount CanvasDeckBlock for language-canvas-deck fences"
```

---

## Task 14: Manual smoke pass + sidebar version bump

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Manual smoke pass — full happy path**

With `npm run dev` running, log in as `wross@prepfunds.net` (password `PrepOwner!77` per the seeded migration).

1. **Template still loads.** Visit `/apps/pptx-parser` → confirm "PREP IC Memo" template is in the list with thumbnail.
2. **Attach via project form.**
   - Go to `/projects` → create a new project named "Hilliard" (or open an existing one).
   - Click Settings (gear). Confirm the "Branding template" field is below MCP Tools.
   - Click "Choose template…" → modal lists only the IC Memo template (active, not archived).
   - Pick it → chip shows the name. Save the project.
3. **Positive case — deck renders.**
   - In the project's chat, send: *"build me an IC memo for Hilliard"*.
   - Expected: assistant emits a `canvas-deck` fence, renderer mounts a multi-slide deck. Verify prev/next, dots, keyboard arrows, the slide counter, and that at least 3 of the 8 layouts render in the AI's actual output.
4. **Negative case — plain markdown.**
   - In the same chat, send: *"what's the cap rate on a property with $1M NOI and a $20M price?"*
   - Expected: plain markdown, no deck.
5. **Detach via chip.**
   - Open Settings → click `[×]` on the chip → save.
   - Send the same presentation question again. Expected: plain markdown.
6. **Apply via apps page.**
   - Visit `/apps/pptx-parser` → click the new Send icon on the IC Memo row.
   - Pick the "Hilliard" project → confirm. Toast shows success.
   - Open the project's settings — confirm the chip is back.
7. **Cascading detach.**
   - Visit `/apps/pptx-parser` → delete the IC Memo template (Trash icon → confirm).
   - Open the "Hilliard" project's settings — confirm the field is empty (`pptx_template_id` was nulled).
   - Re-seed by restarting the server (the wross migration re-creates the row).

- [ ] **Step 2: Bump the sidebar version**

Open `src/components/Sidebar.tsx`. Find the version string (currently `v1.12.1` per the most recent commit `chore(sidebar): tighten font and item spacing, bump to v1.12.1`). Bump to `v1.13.0` (minor — new feature):

```tsx
// e.g. <p className="...">v1.13.0</p>
```

- [ ] **Step 3: Final test run**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "chore(sidebar): bump version to v1.13.0 for branded canvas deck"
```

---

## Definition of done (mirrors spec §13)

- [ ] `projects.pptx_template_id` column + index exist after one boot — confirmed in Task 1 step 3
- [ ] Manifest v2 extraction returns design tokens for the seed `.pptx` — test S1 passes
- [ ] Per-boot migration upgrades v1 rows to v2 idempotently; missing files don't crash boot — test S2 passes
- [ ] Brand block appears in the system prompt iff project has a template — tests 3, 4 pass
- [ ] `<ProjectForm />` can attach, switch, and detach a template — manual smoke step 2, 5
- [ ] PptxAppPage rows have an "Apply to project…" action — manual smoke step 6
- [ ] `<CanvasDeckBlock />` renders multi-slide deck with prev/next/dots/keyboard arrows — manual smoke step 3
- [ ] DOMPurify strips `<script>` from a malicious fence — verified by code path (FORBID_TAGS in `parseSections`)
- [ ] Deleting a template detaches it from any projects — test 6 passes; manual smoke step 7
- [ ] All Vitest tests pass via `npm test` — Task 14 step 3
- [ ] Sidebar version bumped — Task 14 step 2
