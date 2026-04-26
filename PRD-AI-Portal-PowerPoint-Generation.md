# PRD: AI Portal — PowerPoint Generation

**Owner:** Product
**Audience:** Engineering
**Status:** Draft for review (v1.2 — user-scoped template registry)
**Target release:** Phase 2
**Last updated:** 2026-04-26

---

## 1. Problem Statement

PREP analysts and principals spend 3–5 hours building each Investment Committee (IC) memo, property deck, or investor update — the bulk of which is mechanical work: pulling property data into the firm's slide template, normalizing formatting, restating boilerplate (ProREP standard, MOB thesis, market context), and proofing layout. With 10+ decks produced per quarter, this is 30–50 analyst hours per quarter spent on assembly rather than analysis.

The current AI portal can answer questions and draft prose but cannot produce a finished, on-template `.pptx` file. Every deck still ends in the same manual workflow: copy AI output into PowerPoint, re-format, re-brand, repeat. The cost of not solving this is the most visible value-leak in the portal, weakens the Phase 2 expansion narrative, and leaves PREP exposed to off-the-shelf tools (consumer Claude, Copilot for M365) that can match the portal's chat capability but cannot produce decks in PREP's specific template with PREP's specific data.

## 2. Goals

1. **Eliminate manual deck assembly for the top 3 recurring deck types** (IC memo, property one-pager, investor update) — measured by analyst time-to-finished-deck dropping from 3–5 hrs to ≤30 minutes for those templates.
2. **Produce decks that pass PREP's brand bar without rework** — measured by ≥80% of generated decks shipped with no manual layout/branding changes by week 8 post-launch.
3. **Anchor the Phase 2 contract** — a demo-able feature that produces a finished deck from a property record in <60 seconds during a live demo.
4. **Build a defensible moat via template fidelity** — the feature is not "make a PowerPoint," it is "make a deck in PREP's exact templates, with PREP's exact ProREP language, populated from PREP's data." That fidelity is the differentiator.
5. **Establish the artifact pipeline** that future generators (Word IC memos, Excel underwriting models) will reuse.

## 3. Non-Goals

1. **Persistent cross-session memory layer** — out of scope for v1. v1 carries context only within a single conversation. Memory is a fast-follow (see §9) but is not gating Phase 2.
2. **Free-form slide design from a blank canvas** — v1 only generates against pre-ingested PREP templates. "Make me a deck about anything" with novel layouts is out of scope. Reason: brand fidelity is the moat; free-form design dilutes it and is a solved problem elsewhere.
3. **In-portal slide editor / WYSIWYG canvas** — v1 returns a downloadable `.pptx`. Inline editing of the rendered deck is v2. Reason: the canvas is 3–4× the engineering work and the user's existing PowerPoint is a perfectly good editor.
4. **Real-time multi-user collaboration on a draft deck** — v1 is single-user. Reason: PREP's deck workflow is single-author with offline review, not concurrent editing.
5. **Auto-fetch of property data from external sources (CoStar, Reonomy, etc.)** — v1 accepts data either pasted in, uploaded, or pulled from an existing PREP record the user references. External data integrations are a separate roadmap item.
6. **Bulk generation (e.g., "make a one-pager for every property in the portfolio")** — v1 is one deck at a time. Bulk is v2.
7. **Cross-user template sharing** — templates are strictly user-scoped in v1 (see §5.0a). User A cannot see, request, or generate against User B's templates. Sharing/team templates is a future capability that can ride on the existing `project_members` pattern but is explicitly not in v1.
8. **System-wide or organization-wide template library** — there is no "default" or "shared" template pool that any user can fall back to. Bill Ross sees only his own templates; every other user sees only their own. Reason: brand fidelity is the moat, and a fallback "generic" template would either look generic (defeating the moat) or leak one customer's branding into another customer's decks.

## 4. User Stories

**Priority order — most important first.**

1. As a PREP **analyst**, I want to ask the portal "build an IC memo for the Hilliard property" and receive a finished `.pptx` in PREP's IC template, so that I can spend my time on the underwriting analysis instead of on layout.
2. As a PREP **analyst**, I want to upload property data (rent roll, T-12, OM extract) and have the portal populate the template's data slides automatically, so that I am not re-typing numbers.
3. As a PREP **principal** (Bill, Bob), I want to request a deck in plain language ("one-pager for the Westerville acquisition, focused on the medical thesis") and get something I can review in 60 seconds, so that I can move faster between meetings.
4. As an **analyst**, I want the portal to use the ProREP standard lease language verbatim where it shows up in the deck (NNN definitions, operating expense passthroughs), so that nothing in the deck contradicts the firm's contractual standard.
5. As an **analyst**, I want to choose which template to use (IC memo, one-pager, investor update) when I make a request, so that the same property data can drive different deliverables.
6. As an **analyst**, I want the portal to flag any slide where it had to make assumptions or insert a placeholder ("TODO: cap rate"), so that I know exactly where to focus my review.
7. As an **analyst**, I want to download the finished deck as a `.pptx` (not a PDF or proprietary format), so that I can edit it in PowerPoint like any other file.
8. As an **analyst**, I want failures to be loud and explicit ("I could not find a value for cap rate; please provide one") rather than the portal silently inventing numbers, so that I can trust the output.
9. As a **dev team member**, I want template ingestion to be a one-time process per template, so that adding a new template type does not require ongoing engineering work.
10. As an **analyst** running a live demo for a prospective LP, I want the deck to render in <60s with a visible progress indicator, so that the demo holds the room's attention.

## 5. Requirements

### P0 — Must-Have (cannot ship without)

**5.0 Template ingestion pipeline**
- Engineering will accept a `.pptx` file from PREP and convert it into a structured template definition (slide layouts, named placeholders, fixed text blocks, dynamic regions).
- Each template ingestion produces: (a) the original `.pptx` as the rendering source, (b) a JSON schema describing dynamic fields and their types (string, currency, percentage, table, image), (c) a per-slide prompt scaffold that instructs the model what content belongs there.
- v1 ships with three ingested templates **owned by user `Bill Ross`**: **IC Memo**, **Property One-Pager**, **Investor Update**. No templates are pre-provisioned for any other user.
- Acceptance:
  - Given a `.pptx` template provided by PREP, when ingestion runs, then a template manifest is produced and stored in the template registry, **scoped to the uploading user's `user_id`**.
  - Given a template manifest, when the user requests a deck of that type, then every dynamic field in the manifest is either filled or flagged as TODO with the placeholder visible on the slide.

**5.0a Template registry and access control (user-scoped)**

Templates are strictly user-owned. Every template belongs to exactly one user. The deck-generation pipeline never sees, lists, or renders against templates the requesting user does not own. This requirement is non-negotiable and gates every other feature in this PRD — no other requirement may be considered satisfied if access control leaks across users.

*5.0a.1 Schema.* New SQLite table mirrors the existing `library_files` user-scoping pattern in `server/database.js`:

```sql
CREATE TABLE pptx_templates (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL,                -- "PREP IC Memo"
  template_type   TEXT NOT NULL,                -- 'ic_memo' | 'one_pager' | 'investor_update' | 'custom'
  source_pptx_path TEXT NOT NULL,               -- ./data/uploads/templates/{user_id}/{id}.pptx
  manifest_json   TEXT NOT NULL,                -- slide-by-slide annotation
  status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_pptx_templates_user_id ON pptx_templates(user_id);
CREATE INDEX idx_pptx_templates_user_type ON pptx_templates(user_id, template_type);
```

*5.0a.2 File layout.* Source `.pptx` files live at `./data/uploads/templates/{user_id}/{template_id}.pptx`. Multer paths follow the existing convention. The `user_id` segment is part of the path so that filesystem inspection makes ownership obvious, not just the database row.

*5.0a.3 API contract.* All template endpoints require auth and filter by `req.user.id`:

- `GET /api/pptx-templates` → returns templates `WHERE user_id = ?` only. Never `*`.
- `GET /api/pptx-templates/:id` → 404 if `template.user_id !== req.user.id`. Not 403 — 404 prevents leaking the existence of another user's template via error code.
- `POST /api/pptx-templates` → uploads a new template; row created with `user_id = req.user.id`.
- `DELETE /api/pptx-templates/:id` → 404 if not owned by requesting user.
- `POST /api/pptx-generate` → orchestrator looks up `pptx_templates WHERE user_id = ? AND id = ?` before any LLM call. If not found, returns "you don't have access to this template" without leaking whether the template exists.

*5.0a.4 Orchestrator filtering.* When a deck-generation intent is detected in the chat (per §5.1), the orchestrator's first step is to load the requesting user's available templates: `SELECT id, name, template_type FROM pptx_templates WHERE user_id = ? AND status = 'active'`. Template selection (manual or by inference from the natural-language request) is bounded to that result set. The orchestrator must never construct a query that returns templates owned by another user, even for "fallback" or "default" purposes.

*5.0a.5 Empty state.* If a user invokes deck-generation intent but has zero templates, the chat surface returns: *"You don't have any deck templates yet. To use this feature, upload a `.pptx` template via the [PowerPoint Template Extractor](/apps/pptx)."* This is the only fallback. We do not show another user's templates as examples.

*5.0a.6 Admin override (optional, deferred).* For support cases, admins may need to inspect another user's templates. v1 does not implement this; if needed, it ships behind an explicit admin-only endpoint (`GET /api/admin/pptx-templates?user_id=X`) gated by `requireAdmin`. Open question Q10.

*5.0a.7 Acceptance:*
- Given user A and user B both exist with templates, when user A calls `GET /api/pptx-templates`, then the response contains only A's templates.
- Given user A requests deck generation against user B's `template_id`, when the orchestrator runs, then the request is rejected and no LLM call is made.
- Given a user with zero templates invokes deck-generation intent, when the orchestrator runs, then it responds with the empty-state message and never falls back to another user's templates.
- Given automated tests, when the user-scoping rule is violated by a code change, then a test fails before merge. (See test plan in Appendix.)

**5.0b Bill Ross template association (v1 only)**

Bill Ross already exists in the database (`wross@prepfunds.net`, regular user, never logged in). No user-creation step is needed. v1 launch requires his three PREP template slots to be associated with his existing `user_id` before he first uses the feature.

- A one-time data migration script (or extension of `server/seed.js` that runs idempotently) looks up Bill by email, reads his `user_id`, inserts the template row, and copies the placeholder `.pptx` to `./data/uploads/templates/{bill_user_id}/ic_memo_v1.pptx`.
- The migration is idempotent: re-running it does not duplicate the template row or overwrite a template Bill has uploaded himself.
- The PREP IC Memo placeholder template (`PREP_IC_Memo_Template.pptx`, generated during PRD scoping) is the v1 IC Memo template until Bill provides his real one (Q2).
- The One-Pager and Investor Update template slots remain empty until Bill provides source `.pptx` files.
- Acceptance: after the migration runs, Bill Ross logs in and sees one template (IC Memo) listed in the deck-generation surface. Other users (Jeff Kwiatkowski, Jeff Fox) see zero templates per the strict user-scoping rule in §5.0a.

**5.0c User-facing template management UI**

Bill needs a place outside of chat to see what templates he owns, what they look like, when each was last updated, and to manage the list (archive, delete, replace). Without this surface, the only way to know "what templates do I have?" is to start a deck-generation conversation — which is a poor mental model for asset management.

*5.0c.1 Surface.* Extend the existing `src/pages/PptxAppPage.tsx` (route `/apps/pptx`). The page currently has one mode — upload-and-extract-tokens. Split it into two stacked sections:

- **Top: "Your Templates"** — list of templates owned by the requesting user (`GET /api/pptx-templates` filtered by `user_id` per §5.0a). Each row shows: thumbnail of slide 1 (using the same thumbnailing infra as the deck-generation carousel), template name, template type badge (IC Memo / One-Pager / Investor Update / Custom), last updated date, slide count, action buttons (Preview, Replace, Archive, Delete).
- **Bottom: "Upload New Template"** — the existing upload affordance, unchanged.

*5.0c.2 Empty state.* If the user has zero templates, the "Your Templates" section shows: *"You don't have any templates yet. Upload a `.pptx` below to get started."* This is the same empty state referenced in §5.0a.5 — written once, used everywhere.

*5.0c.3 Preview action.* Clicking Preview opens a modal showing thumbnails of all slides in the template (same carousel component used in §5.5.4). User can scroll through, see exactly what the template contains, and close back out. Read-only — no editing in v1.

*5.0c.4 Replace action.* Clicking Replace opens the upload affordance with the existing template ID pre-filled. The new `.pptx` overwrites the source file and re-runs manifest extraction, but the template ID and `user_id` remain stable. This is how Bill updates his templates over time without breaking deck history.

*5.0c.5 Archive action.* Sets `status = 'archived'` on the template row. Archived templates do not appear in the deck-generation surface and do not appear by default in the user-facing list, but are recoverable via a "Show archived" toggle. Soft delete — preserves historical decks that were generated against this template version.

*5.0c.6 Delete action.* Hard delete with confirmation modal. Removes the row, removes the source `.pptx` file from disk, removes the manifest. Decks already generated against this template are not affected (they're separate `.pptx` files in the user's session output folder).

*5.0c.7 Acceptance:*
- Given Bill Ross is logged in, when he visits `/apps/pptx`, then "Your Templates" lists his IC Memo template with a slide-1 thumbnail and metadata.
- Given Jeff Kwiatkowski (admin) is logged in, when he visits `/apps/pptx`, then "Your Templates" shows the empty state. He does not see Bill's templates here, even as admin — admin override lives elsewhere (§5.0d).
- Given Bill clicks Preview on his IC Memo template, when the modal opens, then all 12 slide thumbnails render and are scrollable.
- Given Bill clicks Delete and confirms, when the request completes, then the template row is removed, the file is removed from disk, and the deck-generation surface no longer offers that template.

**5.0d Admin-facing template visibility**

Admins need to know what templates exist across all users for support, audit, and onboarding-monitoring purposes. Without admin visibility, you can't answer questions like "did Bill ever upload his real IC Memo?" or "which customers have set up templates?" except by running raw SQL. This surface closes that gap.

*5.0d.1 User list column.* Extend `src/pages/AdminUsersPage.tsx` (the page shown in your screenshot) by adding a **TEMPLATES** column between STATUS and LAST LOGIN. Column shows the count of active (non-archived) templates owned by that user — e.g., `Bill Ross | … | • Active | 1 template | Never`. Zero is rendered as muted gray "0 templates"; non-zero is rendered with normal weight. The count comes from `SELECT COUNT(*) FROM pptx_templates WHERE user_id = ? AND status = 'active'`.

*5.0d.2 Click-through to per-user template detail.* Clicking the count opens a side panel (or modal — design call) that lists that user's templates with the same row format as §5.0c.1 (thumbnail, name, type, date, slide count). Admin can click Preview to see thumbnails (read-only). Admin can archive a template if needed (e.g., the user uploaded something incorrectly and emailed support). Admin **cannot** generate decks against another user's templates from this view — generation always runs as the template's owner, never as the admin.

*5.0d.3 Endpoint.* New admin-only endpoint `GET /api/admin/pptx-templates?user_id=X`. Gated by `requireAdmin`. Returns templates for the specified user. This is the controlled escape hatch from the user-scoping rule in §5.0a — required because admins legitimately need to see across users for support, but it lives behind an explicit admin route so it's auditable.

*5.0d.4 Audit logging.* Every admin call to `/api/admin/pptx-templates` is logged to the existing `audit_log` table with the admin's `user_id`, the queried `user_id`, and timestamp. This is the audit trail that makes admin override safe — you can answer "which admins looked at Bill's templates and when?" after the fact.

*5.0d.5 Acceptance:*
- Given Jeff Kwiatkowski (admin) visits `/admin/users`, when the page loads, then the TEMPLATES column shows "1 template" for Bill Ross and "0 templates" for himself and Jeff Fox.
- Given Jeff Kwiatkowski clicks the "1 template" link for Bill, when the detail panel opens, then it lists Bill's IC Memo template with a thumbnail and metadata.
- Given a non-admin user attempts to call `GET /api/admin/pptx-templates?user_id=...` directly, when the request hits the server, then it returns 403.
- Given Jeff Kwiatkowski opens any per-user template detail, when the request completes, then a row appears in `audit_log` capturing the admin's id, the queried user's id, and the action.

**5.1 Conversational deck request**
- User can request a deck in natural language inside the existing portal chat surface.
- The model must (a) identify the requested template, (b) identify the subject property/topic, (c) identify the data sources (uploaded files, pasted text, prior chat content).
- If any of (a)/(b)/(c) is ambiguous, the model asks one clarifying question before generating. It does not silently guess.
- Acceptance:
  - Given the user types "build an IC memo for Hilliard," when no Hilliard data is in context, then the model asks the user to attach or paste the Hilliard data before generating.
  - Given the user provides a template + property + data, when generation runs, then no further input is required.

**5.2 Data ingestion for population**
- Accept inputs via: (a) file upload (`.pdf`, `.xlsx`, `.csv`, `.docx`, `.pptx`), (b) pasted text in chat, (c) reference to an earlier message in the same conversation.
- Excel files: parse with the existing `xlsx` skill. PDFs: parse with the existing `pdf` skill. Word: `docx` skill.
- Acceptance:
  - Given the user uploads a rent roll `.xlsx`, when the deck includes a rent roll slide, then the actual numbers from the upload appear on that slide (not summarized, not invented).
  - Given a number cannot be located in the source data, then the slide shows "TODO: [field name]" in a visually distinct style and the chat output lists every TODO at the top of the response.

**5.3 Deck generation engine**
- Architecture: prompt-driven slide-by-slide generation. For each slide in the chosen template, the system constructs a prompt that includes:
  - The slide's role (per the template manifest)
  - The slide's dynamic fields and types
  - The relevant slice of property data
  - The relevant slice of ProREP standard language (when the slide includes lease/legal boilerplate)
  - Strict output schema (JSON matching the slide's field definitions)
- The structured outputs are then rendered into the source `.pptx` via `python-pptx` (or equivalent) — the model never produces raw `.pptx` XML.
- Acceptance:
  - Given a template with N dynamic fields, when generation runs, then the LLM is called with N field-aware prompts and the response is validated against the slide schema before rendering.
  - Given a schema validation failure, then generation retries up to 2× with the validation error fed back, then surfaces the failure to the user with the offending slide and field.

**5.4 ProREP standard integration**
- The existing `prorep-standard-lease` skill is the source of truth for lease/legal boilerplate that appears on slides (NNN clauses, operating expense passthroughs, audit rights). The deck generator must read from that skill for any slide tagged in the manifest as containing ProREP-standard content — it must not paraphrase this language.
- Acceptance:
  - Given a slide manifest tagged `prorep-standard: §4.operating-costs`, when generated, then the slide text matches the corresponding section of the standard verbatim (subject only to template-driven length truncation, which must be flagged).

**5.5 Output delivery**
- The finished `.pptx` is saved to the user's outputs folder and surfaced in chat as a downloadable link.
- Above the link, the chat response shows: (a) which template was used, (b) which inputs were consumed, (c) any TODOs/flags on slides, (d) any assumptions the model made.
- Acceptance:
  - Given a successful generation, when the user reads the chat response, then they can identify every slide with a TODO without opening the file.

**5.6 Performance**
- Median generation time for a 12-slide IC memo with all data provided: **≤60 seconds**.
- p95: ≤120 seconds.
- Progress indicator visible in the portal chat from 5s onward.

**5.7 Failure modes**
- Generation must fail loudly, never silently.
- If the model lacks data for a field, the slide gets a visible TODO marker — the model never invents financial figures, dates, or counterparty names.
- Hard failures (template missing, schema validation exhausted retries) return an explicit error in chat with actionable guidance.

### P1 — Nice-to-Have (fast-follow, weeks 8–16 post-launch)

**5.8** Deck variants — same data, different template ("now do that as a one-pager").
**5.9** Light memory shim — remember per-user defaults (preferred template, last-used data sources) within a 30-day window. Not the full memory layer; just enough to remove repetitive setup.
**5.10** Slide-level regeneration — "redo slide 7 with these numbers" without rebuilding the whole deck.
**5.11** Inline image insertion — pull property photos from a referenced data source into the property image slide.
**5.12** Source citation footer — small footnote on data slides naming the source file/sheet/row the number came from.

### P2 — Future Considerations (design for, do not build)

**5.13** Full persistent memory layer (cross-session, cross-deck).
**5.14** WYSIWYG in-portal slide editor.
**5.15** Bulk generation across portfolio.
**5.16** External data integrations (CoStar, Reonomy, MLS).
**5.17** Auto-update — when source data changes, regenerate affected slides.
**5.18** Word IC memo generator and Excel underwriting model generator on the same artifact pipeline.

> **Architectural implication for P2:** the slide-generation engine should treat templates as first-class objects (registry + manifest + renderer). Do not hardcode the three v1 templates into the generation logic. Future Word/Excel generators reuse the registry pattern with a different renderer.

## 6. Success Metrics

### Leading indicators (measured weeks 1–4 post-launch)

| Metric | Definition | Success | Stretch |
|---|---|---|---|
| Adoption | % of weekly active portal users who generate ≥1 deck | 60% | 80% |
| Activation | % of deck requests that produce a downloaded file | 85% | 95% |
| Time-to-first-deck | Median wall-clock from request to download | ≤90s | ≤60s |
| Rework rate | % of generated decks that ship with zero manual layout edits | 60% | 80% |
| Failure visibility | % of failures that produce an actionable error vs. silent issue | 100% | 100% |

**Measurement:** instrument the portal with events `deck.requested`, `deck.generated`, `deck.downloaded`, `deck.failed`. Rework rate is measured via a thumbs-up/down + free-text follow-up after download ("did you have to fix anything before sending?").

### Lagging indicators (measured weeks 8–16)

| Metric | Definition | Success | Stretch |
|---|---|---|---|
| Analyst hours saved | Self-reported via quarterly survey | 20 hrs/analyst/quarter | 40 hrs |
| Phase 2 contract close | Bill signs Phase 2 expansion | ✅ | ✅ + reference quote |
| Decks per analyst per quarter | Throughput proxy | +25% vs. baseline | +50% |

### Evaluation cadence
- Week 2: leading-indicator review, decision to ship P1 items.
- Week 8: full success-metrics review, lagging-indicator first read, Phase 2 contract conversation.
- Week 16: retrospective + roadmap update for v2.

## 7. Technical Considerations

### Stack assumptions
- Hosting: GCP Vertex AI (existing portal infra).
- Model: Anthropic Claude Opus 4.5/4.7 via Vertex, leveraging Anthropic's deck-generation skill capability where available, with PREP's template manifests layered on top.
- Rendering: `python-pptx` server-side, running in the portal's existing job worker.
- Storage: template registry in the portal's existing object store; user-generated decks in the user's session output folder, retained 90 days.

### Integration points
- **`anthropic-skills:pptx`** — drives slide construction patterns and structured output for slide content.
- **`prorep-standard-lease` skill** — source of truth for lease/legal boilerplate (P0 requirement 5.4).
- **`anthropic-skills:xlsx`, `:pdf`, `:docx`** — input parsers for source data.
- **Portal chat layer** — request entry point and response surface.
- **Portal job queue** — async generation; chat shows progress, completion notification fires when ready.

### Prompt architecture (high level)
- **Orchestrator prompt:** parses the user's natural-language request → resolves `(template, subject, data sources)` → constructs the per-slide work list.
- **Per-slide prompts:** templated, parameterized by the slide manifest entry. Each enforces a JSON output schema corresponding to that slide's dynamic fields.
- **Validator:** schema validation + sanity checks (no invented entities, currency formats correct, percentages in [0,100]).
- **Renderer:** deterministic — takes validated JSON + the source `.pptx` template + writes the output `.pptx`.

The model is responsible for content; rendering is fully deterministic. This is intentional: it bounds the failure modes and makes the output predictable.

### Template manifest schema (sketch — refine in design)
```
{
  "template_id": "ic_memo_v1",
  "user_id": "<owner-uuid>",                 // NEW: every manifest is owned
  "source_pptx": "templates/<user_id>/ic_memo_v1.pptx",
  "slides": [
    {
      "index": 1,
      "role": "title",
      "fields": [
        { "name": "property_name", "type": "string", "required": true },
        { "name": "deal_date",     "type": "date",   "required": true }
      ]
    },
    {
      "index": 4,
      "role": "lease_terms",
      "prorep_standard_refs": ["§4.operating-costs"],
      "fields": [...]
    }
  ]
}
```

## 8. Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | Final list of v1 templates — confirm IC Memo, One-Pager, Investor Update, or substitute? | Product / Bill | Blocking |
| Q2 | Source `.pptx` files for the three templates — who provides, when? | Bill / Bob | Blocking |
| Q3 | Vertex availability of Opus 4.5/4.7 deck-generation skill in our region/quota | Engineering / GCP | Blocking |
| Q4 | Do we need PREP-specific font licensing on the render server? | Engineering / Legal | Blocking before render |
| Q5 | Retention policy for generated decks — 90 days enough, or longer for audit? | Legal | Non-blocking (default 90, adjust before GA) |
| Q6 | Should TODO markers be PREP-branded or use a generic style? | Design | Non-blocking |
| Q7 | Logging — capture full prompt + output for QA, or hashed only for privacy? | Engineering / Legal | Non-blocking |
| Q8 | Demo data set for the Phase 2 demo — Hilliard, Westerville, or a synthetic property? | Product | Non-blocking |
| Q9 | ~~Bill Ross's user record — does he have an existing user_id in the database, and what email is he using to log in?~~ **RESOLVED 2026-04-26: Bill exists at `wross@prepfunds.net`, regular user, never logged in. No user-creation step needed; templates associate to his existing `user_id`. See §5.0b.** | — | Resolved |
| Q10 | ~~Seed Bill Ross at `npm run seed` time, or create his record on first SSO login?~~ **RESOLVED 2026-04-26: Moot — Bill already exists. v1 needs only a template-association migration, not a user-creation step.** | — | Resolved |
| Q10a | ~~Should Jeff Fox also have templates in v1?~~ **RESOLVED 2026-04-26: Strictly Bill-only. v1 is a demo for Bill Ross. Other users see the empty state.** | — | Resolved |
| Q11 | Admin override for cross-user template inspection (§5.0a.6) — needed in v1 for support, or deferred to v2? | Product / Support | Non-blocking |
| Q12 | When (not if) a second customer onboards, do their templates ride on the same `pptx_templates` table with their own `user_id`, or do we need a separate "organization" scope? Decision affects schema migration cost. | Product / Engineering | Non-blocking (decide before second customer signs) |

## 9. Timeline Considerations

### Hard constraints
- Phase 2 contract conversation targeted for **weeks 8–10**. The feature must be demo-stable by week 6 at the latest.
- No external regulatory or contractual deadlines.

### Suggested phasing (6-week build)

**Week 1 — Foundations**
- Template manifest schema finalized (including `user_id` per §5.0a).
- `pptx_templates` SQLite table added to `server/database.js` migration block; index created.
- Idempotent template-association migration script: looks up Bill Ross by email (`wross@prepfunds.net`), inserts his IC Memo template row, copies placeholder `.pptx` to `./data/uploads/templates/{bill_user_id}/ic_memo_v1.pptx`. (Q9/Q10 resolved — no user creation needed.)
- Access-control test suite scaffolded — every template endpoint has a "user A cannot read user B's templates" test that runs in CI.
- Renderer prototype (`python-pptx`) producing a populated deck from a hand-written manifest + JSON.
- One template ingested end-to-end (IC Memo).

**Week 2 — Generation engine**
- Orchestrator + per-slide prompt scaffolding.
- Schema validation + retry logic.
- Integration with `prorep-standard-lease` skill.

**Week 3 — Inputs**
- File upload pipeline (xlsx, pdf, docx) feeding the orchestrator.
- Data extraction prompts per file type.
- TODO/flag system for missing data.

**Week 4 — Templates 2 & 3 + Management UI**
- One-Pager and Investor Update ingestion (when Bill provides them).
- Template selection logic in the orchestrator.
- User-facing template management UI (§5.0c) — extend `PptxAppPage.tsx` with "Your Templates" list, Preview modal, Archive/Delete actions.
- Admin-facing template visibility (§5.0d) — add TEMPLATES column to `AdminUsersPage.tsx`, per-user detail panel, `GET /api/admin/pptx-templates` endpoint with audit logging.

**Week 5 — Polish + perf**
- Progress indicator, error UX, download surface.
- Performance tuning to meet ≤60s median.
- Logging + telemetry for success metrics.

**Week 6 — Demo readiness**
- Internal dogfood with PREP analyst.
- Demo script for Phase 2 conversation.
- Bug bash + final cuts.

### Dependencies
- Source `.pptx` templates from PREP (Q2) — gates week 1.
- Vertex Opus deck-skill availability (Q3) — gates week 2 if unavailable; fallback is base Opus + structured output prompts.
- Font/render licensing (Q4) — gates rendering at fidelity; can ship with substitute fonts for internal demo.

### Risk register
- **R1:** Template fidelity is harder than expected (fonts, complex layouts, embedded charts). Mitigation: ingest the simplest template first, surface fidelity issues by week 2.
- **R2:** Excel parsing is messier than PRD assumes (rent rolls in inconsistent shapes). Mitigation: scope week 3 to "parse the formats PREP actually uses today" rather than generic xlsx.
- **R3:** Generation latency exceeds 60s. Mitigation: parallelize per-slide LLM calls; degrade gracefully with "first 3 slides ready" streaming.
- **R4:** Memory absence creates friction in repeat use. Mitigation: ship the P1 light memory shim by week 10 if Phase 2 conversation surfaces this.

---

## Appendix A — Out of scope clarifications for engineering

- Do not build a generic "AI deck builder." Build a templated deck populator. Free-form layout is explicitly P2.
- Do not embed editing UI. The download → edit-in-PowerPoint loop is the v1 user workflow.
- Do not store user inputs beyond session retention without explicit Legal sign-off (Q7).
- Do not implement bulk generation, even if the abstraction tempts you. Single-deck is the v1 contract with the user.

## Appendix B — Definition of Done for v1

- [ ] Three templates ingested and registered.
- [ ] End-to-end happy path: chat request → finished `.pptx` download in ≤60s median.
- [ ] All P0 acceptance criteria met, including all §5.0a access-control assertions.
- [ ] Bill Ross seeded; logging in as Bill shows his IC Memo template; logging in as Jeff shows zero templates.
- [ ] Telemetry firing for the five leading-indicator metrics.
- [ ] Internal dogfood completed with at least one real PREP property.
- [ ] Phase 2 demo script rehearsed end-to-end without intervention.

## Appendix C — Access-control test plan (§5.0a)

The user-scoping rule must be enforced by automated tests that fail in CI before any access-control regression can merge. Minimum test set for v1:

1. **List endpoint isolation.** Seed two users (A and B) each with one template. `GET /api/pptx-templates` as A returns exactly A's template; as B returns exactly B's; neither response leaks the other's `id` or `name`.
2. **Detail endpoint 404 on cross-access.** `GET /api/pptx-templates/{B_template_id}` as user A returns 404, not 403, not 200. The error body does not include the template name or any field that confirms its existence.
3. **Generation rejection.** `POST /api/pptx-generate` with `template_id = B_template_id` as user A is rejected before any LLM call; verify by asserting zero requests hit the LLM mock.
4. **Empty-state path.** Seed user C with no templates. Deck-generation intent in C's chat returns the empty-state message and does not include any of A's or B's template names.
5. **Delete endpoint isolation.** `DELETE /api/pptx-templates/{B_template_id}` as user A returns 404 and B's template still exists in the DB.
6. **Orchestrator query inspection.** Unit test against the orchestrator's template-loading code path: assert that the SQL query string includes `WHERE user_id = ?` and that the parameter is the requesting user's id. Catches future refactors that drop the filter.

These six tests are the minimum required for the §5.0a acceptance criteria to be considered satisfied.
