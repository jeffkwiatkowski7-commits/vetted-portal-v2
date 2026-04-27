# Branded Canvas Deck — Project-Scoped Themed Slides — Design

**Status:** Draft
**Owner:** Engineering
**Date:** 2026-04-27
**Predecessors:**
- [PPTX Template Foundations](./2026-04-26-pptx-template-foundations-design.md) (template registry, management UIs, audit logging — shipped)
- [Canvas Mode + PPTX Token Extractor](./2026-03-30-pptx-canvas-mode-design.md) (single-page `canvas-html` rendering — shipped)

**Cycle:** First of three for the broader "templates everywhere" arc. This cycle wires templates into projects and introduces multi-slide branded canvas. Subsequent cycles add branded `export_to_word` and the `.pptx` generation engine described in [PRD-AI-Portal-PowerPoint-Generation.md](../../../PRD-AI-Portal-PowerPoint-Generation.md).

---

## 1. What this cycle delivers

A user attaches a stored PPTX template to a project. From that point on, when the AI judges a chat request to be "presentation-y" (e.g. *build me an IC memo for Hilliard*), it emits a multi-slide deck rendered in-chat as 16:9 navigable slides themed by the template's colors and fonts. Plain questions still get plain markdown.

By end of cycle:
- Bill Ross can attach his seeded `PREP IC Memo` template to a project, ask for an IC memo summary, and see a navigable deck rendered in PREP's colors and typography in his chat.
- Templates can be attached from two surfaces — project settings and the Apps page row action — both writing the same column.
- Deleting a template detaches it from any project that referenced it without breaking the project.

This cycle does **not** ship: logos on slides, embedded images, downloadable `.pptx`, themed Word export, slide-by-slide editing, or main-chat (non-project) branding. Those are listed in §15.

## 2. Decisions locked in during brainstorming

| # | Decision | Reason |
|---|---|---|
| 1 | Project-scoped only — main chat outside a project gets no branding in this cycle | Project attachment is a clear consent signal; main-chat ambient branding is a fuzzier UX problem |
| 2 | One template per project (single nullable column, not a join table) | Matches user model; multi-template can grow into a join later |
| 3 | Ambient invocation — template attached = AI may emit `canvas-deck` when the request is presentation-y | Attachment IS the toggle; no slash command, no skill, no extra UI gate |
| 4 | Multi-slide deck (16:9 frames + nav), not single-page | Demo-grade fidelity; sets the table for the eventual `.pptx` cycle |
| 5 | 8-layout vocabulary — title, section, content, two-col, stat, table, quote, closing | Each layout is ~30 lines of CSS; covers IC memo / one-pager / investor update without repetition |
| 6 | HTML-driven schema — one ` ```canvas-deck ` fence with `<section data-layout="…">` children | AI gets full HTML expressivity per slide; renderer slices on sections; CSS variables theme everything |
| 7 | Manifest grows to v2 — additive `design_tokens` field; v1 rows readable | Same versioning approach foundations spec used for forward-compat |
| 8 | Token extraction at upload time, stored in `manifest_json` | One read at chat time; avoid re-parsing the `.pptx` per message |
| 9 | No frontend tests, server-side Vitest only | Same gating model foundations established — access control is server-side |
| 10 | Forward-only — pre-attachment chats unchanged; only new AI responses pick up branding | Avoids retroactive surprise; markdown is already rendered |

## 3. Architecture overview

Six changes, all within the existing repo, no new runtimes:

1. **Schema:** add nullable `pptx_template_id` to `projects` + index, in [server/database.js](../../../server/database.js).
2. **Manifest v2:** extend [server/lib/pptx-manifest.js](../../../server/lib/pptx-manifest.js) `extractManifest` to also extract design tokens (colors, fonts) by sharing the logic that already exists in [server/lib/pptx-parser.js](../../../server/lib/pptx-parser.js#L92-L117).
3. **System-prompt assembly:** insert a "branded canvas" block into the existing `parts.push()` pipeline at [server/index.js:716-738](../../../server/index.js#L716-L738), gated on `project.pptx_template_id`. Helper lives in `server/lib/branded-canvas.js`.
4. **Project endpoints:** `PATCH /api/projects/:id` and `POST /api/projects` accept `pptx_template_id`. `DELETE /api/pptx-templates/:id` (already at [server/index.js:2279](../../../server/index.js#L2279)) gains one line that nulls out the column on dependent projects.
5. **Frontend pickers:** branding-template field in `<ProjectForm />` (new picker modal) and "Apply to project…" action on each row in [PptxAppPage.tsx](../../../src/pages/PptxAppPage.tsx) (project-picker modal).
6. **Frontend renderer:** new `<CanvasDeckBlock />` component parallel to existing [CanvasBlock.tsx](../../../src/components/CanvasBlock.tsx); slices `<section data-layout>` children, renders in a sandboxed iframe with prev/next + dot navigation + keyboard arrows. Wired into both [MainChatPage.tsx](../../../src/pages/MainChatPage.tsx) and [ChatView.tsx](../../../src/components/ChatView.tsx) via a `language-canvas-deck` check parallel to today's `language-canvas-html`.

**Runtime flow:**

```
User sends message in project chat
  → Server: project.pptx_template_id set?
      yes → load template, parse manifest_json, build brand block, append to system prompt
      no  → standard system prompt
  → AI receives prompt with brand block (when applicable)
  → AI decides: "presentation-y" intent? emit canvas-deck. else markdown.
  → Frontend receives streamed assistant message
  → Markdown renderer sees ```canvas-deck fence → mounts <CanvasDeckBlock />
  → CanvasDeckBlock: parse <section> children, theme via CSS variables, render iframe
```

## 4. Data model

### 4.1 Schema change — `projects.pptx_template_id`

Add to the `ALTER TABLE … ADD COLUMN` block in [server/database.js](../../../server/database.js) (same pattern used for `index_status` on `library_files` at line ~411):

```sql
ALTER TABLE projects ADD COLUMN pptx_template_id TEXT REFERENCES pptx_templates(id);
CREATE INDEX IF NOT EXISTS idx_projects_pptx_template ON projects(pptx_template_id);
```

Wrapped in try/catch so re-boots don't fail when the column already exists. The index supports the cleanup query in §4.3.

The `REFERENCES` clause is documentary in this app (SQLite FKs are off by default and the existing code does not opt in via `PRAGMA foreign_keys = ON`). Cascading detach is implemented in application code (§4.3), not by the DB.

### 4.2 Manifest v2

```json
{
  "version": 2,
  "slide_count": 12,
  "slides": [
    { "index": 1, "title": "Investment Committee Memo" }
  ],
  "design_tokens": {
    "colors": {
      "primary":    "#1A1A1A",
      "accent":     "#C4A962",
      "background": "#FFFFFF"
    },
    "fonts": {
      "heading": "Playfair Display",
      "body":    "Inter"
    }
  }
}
```

Rules:
- `version: 2` — readers branch on this. Code that consumes design tokens calls a small helper `getDesignTokens(manifest)` that returns brand defaults when `version < 2`.
- `design_tokens.colors` — three required keys. Extraction fallback per-key: `primary = '#1A1A1A'`, `accent = '#C4A962'`, `background = '#FFFFFF'` (the brand defaults from [tailwind.config.js](../../../tailwind.config.js)).
- `design_tokens.fonts` — two required keys, both font-name strings. No embedded font files. Renderer applies them with sensible CSS fallbacks (see §9.2). Fallback if extraction returns empty: `heading = 'Playfair Display'`, `body = 'Inter'`.

### 4.3 ON DELETE behavior — application-layer cascading detach

The existing template DELETE handler at [server/index.js:2279](../../../server/index.js#L2279) gains one statement *before* the row delete:

```js
dbRun(db, 'UPDATE projects SET pptx_template_id = NULL WHERE pptx_template_id = ?', [id]);
```

Test 6 (§7) gates this. No `ON DELETE` cascade in the schema because (a) FKs aren't enforced and (b) the index from §4.1 makes the UPDATE cheap.

### 4.4 Archive semantics

If a template is archived (`status = 'archived'`):
- The picker modals filter archived templates out by default.
- Projects keep their reference. The chat-time SELECT does **not** filter by status — branding still applies.
- The project's chip in `<ProjectForm />` shows `(archived)` muted suffix on the template name as a courtesy signal.

Reasoning: `archived` is a "hide from default UI" signal, not "this template is broken." Projects that have already adopted an archived template don't suddenly lose their branding — that's an awful surprise. The user can detach manually via the chip's `[×]`.

## 5. Manifest v2 extraction

### 5.1 Shared extraction module

The token-extraction logic at [server/lib/pptx-parser.js:92-117](../../../server/lib/pptx-parser.js#L92-L117) (the `extractColors` and `extractFonts` functions) is moved into [server/lib/pptx-manifest.js](../../../server/lib/pptx-manifest.js) so a single `extractManifest(filePath)` call returns both manifest and tokens.

After this change, `pptx-parser.js` imports `extractColors` and `extractFonts` from `pptx-manifest.js` so the existing `/api/apps/pptx-parse` endpoint continues to work without a breaking change.

### 5.2 Updated `extractManifest` shape

```js
async function extractManifest(filePath)
  → { manifest, thumbnailBuffer | null }
```

Where `manifest` is now a v2 shape (§4.2). The function unconditionally returns `version: 2` for new uploads. Reading `ppt/theme/theme1.xml` from the zip is the new step; if missing or unparseable, tokens fall back per §4.2 and the function does not throw.

### 5.3 Per-boot migration extension

The Bill Ross migration at [server/index.js:265-284](../../../server/index.js#L265-L284) (`ensureWrossIcMemoTemplate`) currently creates the row on first boot. It runs every boot and is idempotent.

We extend the idempotent path: after the existence check confirms the row already exists, branch on `manifest.version`:

```js
const manifest = JSON.parse(row.manifest_json);
if (!manifest.version || manifest.version < 2) {
  const { manifest: v2 } = await extractManifest(row.source_pptx_path);
  dbRun(db, 'UPDATE pptx_templates SET manifest_json = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(v2), new Date().toISOString(), row.id]);
}
```

This upgrades any v1 row to v2 on next boot. It runs once per row (next boot the version check short-circuits), so the cost is bounded.

User-uploaded v1 rows from the previous cycle (none expected in production yet but possible in dev) get the same treatment via a parallel pass added next to the wross migration: `SELECT id, source_pptx_path, manifest_json FROM pptx_templates` → for each, run the same version branch. Capped at the same per-boot timing as the existing migration.

## 6. Backend wiring

### 6.1 System-prompt assembly

In [server/index.js:716-738](../../../server/index.js#L716-L738), after the project's own `system_prompt` is pushed and **before** tool sets are pushed, add:

```js
if (project?.pptx_template_id) {
  const tmpl = dbGet(db,
    'SELECT name, manifest_json FROM pptx_templates WHERE id = ? AND user_id = ?',
    [project.pptx_template_id, project.owner_id]
  );
  if (tmpl) {
    const manifest = JSON.parse(tmpl.manifest_json);
    const tokens = getDesignTokens(manifest);  // brand defaults if v1
    parts.push(buildBrandedCanvasBlock(tmpl.name, tokens));
    step(`Branded canvas mode active (template: ${tmpl.name})`);
  }
}
```

The `WHERE … AND user_id = ?` filter is the foundations-spec access control pattern repeated. Even though only the project owner can attach a template (validated at PATCH time, §6.3), we re-verify at chat time. Defense in depth, and a static check on this query is added to test 6.

### 6.2 `buildBrandedCanvasBlock` helper

New file: `server/lib/branded-canvas.js`. Pure function; no DB, no IO.

```js
export function buildBrandedCanvasBlock(templateName, tokens) → string
```

Returns a markdown block included in the system prompt. Body covers:

1. **Header** — *"You are working in a project branded with the '{templateName}' template. When the user asks for presentation-style output, emit a `canvas-deck` fenced block. For all other requests, respond with normal markdown."*
2. **Trigger criteria** — positive examples (*build me an IC memo*, *draft a one-pager*, *show me a deck for X*, *make a property summary slide*); negative examples (*what's the cap rate?*, *summarize this lease*, *explain X*); default = plain markdown.
3. **Fence schema** — exact format with example, including the `<!--TOKENS:{…}-->` HTML comment header and `<section data-layout="…">…</section>` per slide.
4. **Layouts** — 8 entries, each with name, slot vocabulary, and a one-line "use this when" hint.
5. **Tokens** — JSON literal of `{primary, accent, background, headingFont, bodyFont}` from the template, plus instruction *"copy these values verbatim into the TOKENS comment in your fence; do not write your own colors or fonts."*
6. **Hard constraints** — no `<script>`, no `<style>`, no external `<link>`, no `<iframe>`. (DOMPurify enforces; telling the AI keeps output clean.)

Default-token helper:

```js
export function getDesignTokens(manifest) {
  const t = manifest?.design_tokens;
  return {
    primary:     t?.colors?.primary     || '#1A1A1A',
    accent:      t?.colors?.accent      || '#C4A962',
    background:  t?.colors?.background  || '#FFFFFF',
    headingFont: t?.fonts?.heading      || 'Playfair Display',
    bodyFont:    t?.fonts?.body         || 'Inter',
  };
}
```

### 6.3 Project endpoints

`PATCH /api/projects/:id` at [server/index.js:1288-1314](../../../server/index.js#L1288-L1314):
- Destructure adds `pptx_template_id`.
- If `pptx_template_id` is non-null in the body, validate ownership: `SELECT id FROM pptx_templates WHERE id = ? AND user_id = ? AND status != 'archived'`. If not found → respond `400 { error: "template not found or not owned" }`. Note: this validation rejects **archived** templates from being newly attached, while existing attachments to archived templates remain (§4.4).
- UPDATE statement gains the column.

`POST /api/projects` at [server/index.js:1242-1265](../../../server/index.js#L1242-L1265):
- Same destructure + validation.
- INSERT statement gains the column.

`GET /api/projects` and `GET /api/projects/:id` already return `*`, so the new column is included automatically. No frontend type change beyond adding the field.

### 6.4 `DELETE /api/pptx-templates/:id` cascade

Existing handler at [server/index.js:2279](../../../server/index.js#L2279). Add **before** the existing `dbRun(db, 'DELETE FROM pptx_templates ...')` line:

```js
dbRun(db, 'UPDATE projects SET pptx_template_id = NULL WHERE pptx_template_id = ?', [id]);
```

That's it. Atomic enough — `dbRun` calls happen on the same `db` handle in the same request; concurrent template deletes are rare and the worst case is a redundant NULL-set.

## 7. Test plan — Vitest, server-side, `server/test/`

Builds on the foundations cycle's `server/test/` setup. Same fixture pattern: temp DB seeded with two regular users + one admin.

| # | Name | Asserts |
|---|---|---|
| 1 | `buildBrandedCanvasBlock` content | Output is non-empty string; contains all 8 layout names; contains all four CSS-variable names (`--brand-primary`, `--brand-accent`, `--font-heading`, `--font-body`); contains the `canvas-deck` fence keyword |
| 2 | `getDesignTokens` defaults | Given a v1 manifest (no `design_tokens`), returns brand defaults (`#1A1A1A`, `#C4A962`, `#FFFFFF`, `'Playfair Display'`, `'Inter'`) |
| 3 | System-prompt branding gate | When `project.pptx_template_id` is set, the assembled system prompt contains the brand block (search by canvas-deck keyword); when null, it doesn't |
| 4 | System-prompt cross-user safety | If `project.owner_id !== template.user_id` is somehow stored, the chat-time SELECT returns null, the brand block is skipped, no error is thrown |
| 5 | PATCH ownership gate | User A's project + user B's `pptx_template_id` → 400 "template not found or not owned"; project's column unchanged |
| 6 | DELETE cascading detach | Pre-condition: project X has `pptx_template_id = T`. Action: `DELETE /api/pptx-templates/T` as T's owner. Post-condition: project X's column is NULL; T's row is gone |
| S1 | Manifest v2 extraction smoke | Given the placeholder `.pptx`, `extractManifest` returns `manifest.version === 2` and a `design_tokens` object with three colors and two fonts (any non-empty values; defaults acceptable) |
| S2 | Per-boot migration v2 upgrade | Insert a v1 row directly into a fresh test DB; run `ensureWrossIcMemoTemplate` (or the parallel pass described in §5.3); assert the row's `manifest_json.version === 2` afterward |
| S3 | Static SQL inspection | The chat-time template SELECT (§6.1) contains `WHERE id = ? AND user_id = ?`; same pattern test 6 in foundations cycle established |

## 8. Frontend — `<ProjectForm />`

Add a "Branding template" field below the existing MCP Servers section in the form rendered at [ProjectDetailPage.tsx:185-202](../../../src/pages/ProjectDetailPage.tsx#L185-L202).

**Empty state:**
```
Branding template
┌────────────────────────────────────┐
│ [Choose template]                  │
│ Empty: chat output is unbranded    │
└────────────────────────────────────┘
```

**Selected state:**
```
Branding template
┌────────────────────────────────────────┐
│ [thumb] PREP IC Memo · IC Memo  [×]    │
└────────────────────────────────────────┘
```

Click `[Choose template]` → opens `<TemplatePickerModal />` (§10.1). The chip's `[×]` clears the selection (sets local form state to `null`).

`<ProjectForm />`'s `onSave` payload (currently `{ name, description, system_prompt, tool_sets, mcp_servers, file_ids }`) gains `pptx_template_id: string | null`. [ProjectDetailPage.handleUpdateProject](../../../src/pages/ProjectDetailPage.tsx#L70-L95) plumbs it through to the existing `PATCH /api/projects/:id` call.

API client method update in [src/api/index.ts](../../../src/api/index.ts) (the `projects.update` shape) — add `pptx_template_id?: string | null`.

## 9. Frontend — `<CanvasDeckBlock />` renderer

### 9.1 Component shape

New file: `src/components/CanvasDeckBlock.tsx`. Parallel to existing [CanvasBlock.tsx](../../../src/components/CanvasBlock.tsx).

```ts
type CanvasDeckBlockProps = {
  body: string;  // raw fence body, including <!--TOKENS:...--> header
};
```

Inside, in order:
1. **Strip and parse TOKENS header.** Regex matches `^<!--TOKENS:({.*?})-->`. Parsed → tokens object. On parse failure → brand defaults via `getDesignTokens` (defined client-side too — duplicated for tree-shaking; trivial to keep in sync).
2. **Parse `<section data-layout="…">` children.** Use `DOMParser` on the post-strip body. For each `<section>` with a `data-layout` attribute, capture the layout name and the inner HTML.
3. **Sanitize each slide's inner HTML** with DOMPurify. Allow `class`, `data-*`, headings, paragraphs, lists, tables, blockquotes, spans, strong/em. Forbid `script`, `style`, `link`, `iframe`, `object`, `embed`.
4. **Build iframe srcdoc** from a static template (§9.2) with:
   - CSS variables block injected from tokens
   - 8 layout rules (from `src/components/canvas-deck-styles.ts` — pure string export)
   - One `<article class="slide" data-layout="…">…</article>` per parsed section
   - Slide nav controls + a small slide-counter
5. **Render iframe** with `sandbox="allow-same-origin"` (parallel to today's `CanvasBlock`).
6. **Toolbar** — Preview/Code toggle, Copy, Download HTML, Open in New Tab. **No "Download as .pptx"** in v1.

Unknown layout names render as `content` (with a console.warn). Empty fence → renders as plain code block (fallback path).

### 9.2 iframe srcdoc template

Static string assembled at render time. Sketch:

```html
<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <style>
    :root {
      --brand-primary:    {{primary}};
      --brand-accent:     {{accent}};
      --brand-background: {{background}};
      --font-heading:     '{{headingFont}}', Georgia, serif;
      --font-body:        '{{bodyFont}}', system-ui, sans-serif;
    }
    {{LAYOUT_CSS}}  /* canvas-deck-styles.ts */
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family={{headingFontEsc}}&family={{bodyFontEsc}}&display=swap">
</head><body>
  <div class="deck">
    {{SLIDES}}
  </div>
  <nav class="deck-nav">
    <button class="prev" aria-label="Previous slide">←</button>
    <div class="dots">{{DOTS}}</div>
    <span class="counter">1 / {{N}}</span>
    <button class="next" aria-label="Next slide">→</button>
  </nav>
  <script>{{NAV_SCRIPT}}</script>
</body></html>
```

`NAV_SCRIPT` is ~30 lines of vanilla JS — manages `aria-current` on slides, prev/next, dot clicks, keyboard arrow keys, swipe gestures (defer until a user asks). Lives as a static string at the top of the component file.

Google Fonts loads via the public CSS endpoint with the font names URL-escaped. If the fonts CSS fails to load (network blocked, font name unrecognized), the fallback chain (Georgia / system-ui) keeps things readable. No hard failure.

### 9.3 Layout CSS — `src/components/canvas-deck-styles.ts`

A single string export `LAYOUT_CSS`. ~250 lines total. Eight `.slide[data-layout="…"]` rules + a slide-frame base + nav chrome. Tested as a string in §11 (assertion: contains all 8 selectors).

### 9.4 Wiring into existing chat surfaces

Two parallel sites:
- [MainChatPage.tsx](../../../src/pages/MainChatPage.tsx) — find the existing `includes('language-canvas-html')` branch in the code-block handler; add a sibling branch `includes('language-canvas-deck')` that mounts `<CanvasDeckBlock body={children} />`.
- [ChatView.tsx](../../../src/components/ChatView.tsx) — same diff.

Both files have identical handlers because rehypeHighlight appends classes; the existing project-canvas-mode spec ([2026-03-30](./2026-03-30-pptx-canvas-mode-design.md)) called this out as "remember both files have the canvas-html check." Add the deck check next to it in both.

## 10. Frontend — pickers and apps-page action

### 10.1 `<TemplatePickerModal />` — shared

New file: [src/components/templates/TemplatePickerModal.tsx](../../../src/components/templates/) (next to existing `TemplateRow` and `PreviewModal`). Modal with a list of the user's active templates (filters `status = 'archived'`). Each row shows thumbnail + name + type pill + slide count, click selects + closes. Empty state: *"You don't have any templates yet. [Upload one →](/apps/pptx-parser)"*.

API: `GET /api/pptx-templates` already exists; the modal fetches on mount, no caching.

### 10.2 Apps page — "Apply to project…"

In [PptxAppPage.tsx](../../../src/pages/PptxAppPage.tsx), each row in "Your Templates" gains one more action button positioned **before Archive, after Replace**: **[Apply to project…]**.

Click → opens `<ProjectPickerModal />` (new component, [src/components/projects/ProjectPickerModal.tsx](../../../src/components/projects/) — parallel to the templates folder). Lists user's projects via `GET /api/projects`. Each row shows project name, member count, and a small chip *"Branded · OldTemplateName"* if `project.pptx_template_id` is already set.

On row click, show a confirm modal:
- If project has no current template: *"Apply 'PREP IC Memo' as the branding template for project 'Hilliard'?"*
- If project already has one: *"Apply 'PREP IC Memo' as the branding template for project 'Hilliard'? This replaces 'OldTemplateName'."*

On confirm → `PATCH /api/projects/:id` with `{ pptx_template_id }`. Toast on success. Apps-page row's secondary text is unchanged in v1 — adding *"Used by N project(s)"* requires either a new aggregate endpoint or scanning all projects client-side; both feel out of scope here. Tracked as follow-up.

## 11. Internal sequencing for the implementation plan

Each backend step pairs the change with the test that proves it.

1. Schema: `ALTER TABLE projects ADD COLUMN pptx_template_id` + index in [server/database.js](../../../server/database.js).
2. Move `extractColors`/`extractFonts` into [server/lib/pptx-manifest.js](../../../server/lib/pptx-manifest.js); extend `extractManifest` to return v2 + tokens. Test S1 (smoke).
3. Per-boot v1→v2 migration in [server/index.js:265-284](../../../server/index.js#L265-L284): wross-row branch + the parallel pass for any other v1 rows. Test S2 (idempotency upgrade).
4. `getDesignTokens` + `buildBrandedCanvasBlock` helpers in `server/lib/branded-canvas.js`. Tests 1, 2.
5. Wire brand block into system-prompt assembly at [server/index.js:716-738](../../../server/index.js#L716-L738). Tests 3, 4. Test S3 (SQL inspection).
6. `PATCH /api/projects/:id` and `POST /api/projects` accept `pptx_template_id` with ownership validation. Test 5.
7. `DELETE /api/pptx-templates/:id` cascading detach. Test 6.
8. Frontend: `<TemplatePickerModal />` shared component.
9. Frontend: Branding-template field in `<ProjectForm />`; update `handleUpdateProject` and `projects.update` API client.
10. Frontend: `<ProjectPickerModal />` + "Apply to project…" action on PptxAppPage rows.
11. Frontend: `canvas-deck-styles.ts` (8 layouts) + `<CanvasDeckBlock />` component.
12. Frontend: wire `language-canvas-deck` checks into [MainChatPage.tsx](../../../src/pages/MainChatPage.tsx) and [ChatView.tsx](../../../src/components/ChatView.tsx).
13. Manual smoke pass:
    - Log in as Bill → confirm seeded IC Memo template still loads in /apps/pptx-parser.
    - Create a project; attach IC Memo as branding template via the form picker.
    - Ask: *"build me an IC memo for Hilliard"* → verify deck renders, prev/next works, all 8 layouts the AI emits look right.
    - Ask: *"what's the cap rate?"* → verify plain markdown response (negative case).
    - Detach via the chip's `[×]`; ask the same presentation question again → verify plain markdown.
    - Apply IC Memo to the same project from the apps page; verify same behavior.
    - Delete the IC Memo template; reload project → verify chip is gone (column was nulled).
14. Sidebar version bump.

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | AI emits unknown `data-layout` value | Renderer treats as `content`; logs `console.warn`. Doesn't break the deck. |
| R2 | AI omits the TOKENS comment | Renderer falls back to brand defaults. Deck renders, just with brand-default styling. |
| R3 | AI puts `<script>` or `<style>` in a slide | DOMPurify strips it. Iframe sandbox is the second line of defense. |
| R4 | AI over-canvases — emits a deck for *what's the cap rate?* | System-prompt criteria + negative examples are the primary mitigation. Tunable in v2 if noisy. |
| R5 | Google Fonts blocked at the user's network | Fallback chain (Georgia / system-ui) keeps slides readable. Not a hard failure. |
| R6 | Manifest v1 templates exist before this cycle ships | Per-boot migration upgrades to v2 idempotently (§5.3). Reading code uses `getDesignTokens` which has defaults. |
| R7 | Template archived after a project attached it | Picker filters archived from new selections; existing attachments still apply branding (§4.4). UI shows muted `(archived)` suffix. |
| R8 | Token extraction throws on malformed theme XML | `extractManifest` catches per-step; tokens fall back to defaults. Manifest still produced. |
| R9 | The `pptx-parser.js` legacy endpoint breaks when extraction logic moves | Re-export the moved functions from `pptx-parser.js`; legacy path unchanged. Smoke covered by manual run of `/api/apps/pptx-parse`. |

## 13. Definition of done

- [ ] `projects.pptx_template_id` column + index exist after one boot
- [ ] Manifest v2 extraction returns design tokens for the seed `.pptx`
- [ ] Per-boot migration upgrades v1 rows to v2 on next boot; running it twice does not change row state on the second pass
- [ ] Brand block appears in the assembled system prompt iff project has a template; verified by test 3
- [ ] `<ProjectForm />` Branding-template field can attach, switch, and detach a template
- [ ] PptxAppPage rows have an "Apply to project…" action that writes the same column
- [ ] `<CanvasDeckBlock />` renders all 8 layouts from a sample fence; prev/next/dots/keyboard arrows all work
- [ ] DOMPurify strips `<script>` from a malicious sample fence; the slide still renders
- [ ] Deleting a template detaches it from any projects; verified by test 6
- [ ] Manual smoke pass per §11 step 13 succeeds against Bill's seeded IC Memo template
- [ ] All Vitest tests in §7 pass via `npm test`
- [ ] Sidebar version bumped

## 14. Out of scope (explicit)

- **Logos / brand marks placed on slides** — extraction would need to select the right image and per-layout placement rules. Tangent.
- **Embedded images** — project files (property photos, charts) referenced by the AI. Requires a file-binding schema between fence and project files. Future cycle.
- **Downloadable `.pptx`** — the PRD's next-cycle generation engine. v1 canvas is browser-only.
- **Themed `export_to_word`** — separate cycle. Likely uses pandoc's `--reference-doc` against a docx derived from the template.
- **Slide-by-slide editing** — *"redo slide 3 with…"* requires a per-slide regeneration mechanism. v1 is one-shot.
- **Per-slide thumbnails in PreviewModal** — foundations cycle deferred this; canvas-deck doesn't need it.
- **Cross-user template sharing** — stays out per PRD §3 non-goal.
- **Main-chat (non-project) branding** — projects only in this cycle.
- **Frontend tests** — same gating model foundations established (server-side Vitest for access control; frontend has no Vitest setup).
