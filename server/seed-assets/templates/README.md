# Seed templates

PowerPoint templates pre-loaded for specific users at seed/migration time.

See `PRD-AI-Portal-PowerPoint-Generation.md` (repo root) for the full feature spec, especially:

- §5.0 — Template ingestion pipeline
- §5.0a — Template registry and access control (user-scoped)
- §5.0b — Bill Ross template association (this directory's purpose)

## Files

| File | Purpose |
|------|---------|
| `PREP_IC_Memo_Template.pptx` | Placeholder IC Memo template for Bill Ross (`wross@prepfunds.net`). Built during PRD scoping; replace with Bill's real template when he provides it. |
| `PREP_IC_Memo_Manifest.json` | Slide-by-slide field annotation that the deck-generation pipeline reads to populate the template. Draft — refine during week 1 of the build. |

## Migration target

The template-association migration script (to be written) reads these files and:

1. Looks up Bill Ross by email `wross@prepfunds.net` → gets his `user_id`.
2. Inserts a row into `pptx_templates` with that `user_id`, the manifest JSON, and a path to the source `.pptx`.
3. Copies `PREP_IC_Memo_Template.pptx` to `./data/uploads/templates/{bill_user_id}/ic_memo_v1.pptx`.
4. Idempotent — re-running the migration does not duplicate the row or overwrite if Bill has already replaced the template via the UI.

After migration, Bill logs in and sees one template (IC Memo) in the deck-generation surface; all other users see the empty state per the strict user-scoping rule in PRD §5.0a.

## When Bill provides his real template

1. Receive the `.pptx` from Bill (probably via email or a file share).
2. Replace `PREP_IC_Memo_Template.pptx` here with Bill's file (same filename, or update the manifest's `source_pptx` reference).
3. Re-run the manifest annotation step against the new file (the field positions and TODO placeholder locations may change).
4. Bump `version` in the manifest from `0.1.0-placeholder` to `1.0.0` (or similar).
5. Bill clicks **Replace** in the user-facing template UI (PRD §5.0c.4) — or, if running pre-launch, the migration script picks up the new file on next run.

## When PREP needs One-Pager and Investor Update templates

Add them to this directory with the same shape (`.pptx` + `.json` manifest pair) and extend the migration script to register all three templates against Bill's `user_id`. The pattern in the current migration scales 1→N templates without code changes if the migration iterates over `*.pptx` files in this directory and reads their adjacent manifest.
