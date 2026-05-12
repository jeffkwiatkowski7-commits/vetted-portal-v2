# PRD: AI Portal — Rent Roll Analyst

**Owner:** Product
**Audience:** Engineering
**Status:** Draft for review (v1.0)
**Target release:** Phase 2
**Last updated:** 2026-04-27

---

## 1. Problem Statement

PREP analysts spend 2–4 hours on every portfolio-level rent roll review: pulling expirations into a chart, computing WALT, building a tenant-concentration table, and flagging suspect rents. The work is mechanical and the result is consistent — same numbers, same chart, same memo structure each time — but it consumes the same analyst hours that should be spent on the underwriting interpretation. Across PREP's 10+ MOB portfolios reviewed quarterly, this is 25–40 analyst hours per quarter spent on assembly rather than analysis.

The existing portal can read an `.xlsx` and answer ad-hoc questions about it, but cannot deliver a finished portfolio analysis package — formatted Word memo with a native chart and tables, formatted Excel workbook with computed sheets — in one shot. Today the workflow ends in PowerPoint and Excel even when the analysis began in chat.

Rent Roll Analyst is the second feature in the portal's analyst-replacement track. It complements **Lease Abstraction** (single-document, deep) with a **portfolio-level, broad** counterpart. The pair is the wedge for Phase 2: PREP signs the expansion when the portal can replace the bottom 60–70% of analyst time across both single-lease and multi-lease workflows.

## 2. Goals

1. **Eliminate manual portfolio-level rent roll analysis** for PREP's recurring quarterly review — measured by analyst time-to-finished-package dropping from 2–4 hrs to ≤5 minutes.
2. **Produce numbers that an analyst will sign without re-running** — measured by ≥95% of generated analyses shipping with no manual recomputation by week 8 post-launch.
3. **Word and Excel artifacts that pass PREP's brand bar** — native Word tables (not pipe-character text), embedded chart images, currency- and date-typed Excel cells, all with the styling already established by the Lease Abstraction skill.
4. **Anchor the second analyst-replacement skill** — paired with Lease Abstraction, this is the demo-able feature that makes the Phase 2 case for "the portal replaces the analyst's mechanical work."
5. **Reuse the artifact pipeline** built for the PowerPoint Generation feature — the Word and Excel renderers introduced here become the basis for future analyst deliverables.

## 3. Non-Goals

1. **Market comparison data.** The skill flags leases below the **building's own** average PSF. It does not label anything "below market" and does not pull external comp data (CoStar, Reonomy, broker reports). Reason: external data integration is its own roadmap item; the deviation flag is a starting point for analyst attention, not a market judgment.
2. **Multi-rent-roll merge in one analysis.** v1 takes one file per analysis. Combining multiple files into a single portfolio view is v2.
3. **Time-series analysis across rent rolls.** v1 analyzes one snapshot. Comparing snapshots quarter-over-quarter is v2.
4. **Tenant credit overlay.** v1 does not cross-reference tenant names against credit databases. Tenant concentration is by rent only.
5. **T-12 / operating statement integration.** Out of scope for v1. Routed to a future Financial Statement skill.
6. **Real-time refresh from property management systems.** v1 is file-driven (Excel/CSV upload). Yardi/MRI API integrations are not in v1.
7. **Scenario modeling.** "What if Tenant X doesn't renew?" is v2.
8. **Bulk processing.** v1 is one file at a time. The model can run the skill in a loop in chat, but the skill itself is single-file.
9. **Gemini compatibility.** v1 ships against Claude only. The portal's model-abstraction layer can route other workloads to Gemini, but this skill's structured tool contracts are designed for Claude tool use; Gemini parity is deferred until there is a concrete reason to add it.

## 4. User Stories

**Priority order — most important first.**

1. As a PREP **analyst**, I upload a portfolio rent roll and receive a finished Word memo with the expiration chart, WALT, tenant concentration, and below-average flags, so that I can review and send the same day instead of building it from scratch.
2. As a PREP **analyst**, I upload a rent roll exported from Yardi (or MRI, or a bespoke Excel) and the skill reads it correctly without me cleaning it first, so that I am not pre-processing files for the AI.
3. As a PREP **principal** (Bill, Bob), I want to ask the portal "what does the Hilliard portfolio's expiration profile look like?" and get an answer in chat plus an attached deck-ready chart, so that I can move directly into a partner conversation without a build step.
4. As an **analyst**, I want every inferred value (especially monthly-vs-annual rent inference) flagged at the top of both the chat response and the document footer, so that I know to spot-check it before sending.
5. As an **analyst**, I want the WALT calculation to be transparent — I can see the formula, the weighting basis, the lease-count included, and the lease-count excluded — so that I can defend the number in front of the IC.
6. As an **analyst**, I want any below-building-average rent to be flagged with the building average baseline shown alongside it, never labeled "below market," so that I do not accidentally publish a market claim the data cannot support.
7. As an **analyst**, I want generated outputs to land in my project (not just my chat), so that subsequent work in that project — IC memos, decks — can reference the analysis without me re-uploading anything.
8. As an **analyst**, I want failures to be loud and explicit ("I could not detect the lease end column; please tell me which one it is") rather than silent, so that I can trust the output.
9. As a **dev team member**, I want each analytical capability (expirations, WALT, concentration) to be independently callable, so that the model can answer narrow questions ("just give me the WALT") without running a full report.

## 5. Requirements

### P0 — Must-Have (cannot ship without)

**5.1 Triggering and intent detection**

The skill is invoked by the chat orchestrator when:

- A user uploads an `.xlsx`, `.xls`, or `.csv` file *and* the file passes a column-shape check (≥3 of {tenant, suite/unit, square footage, base rent, lease end} present), **or**
- The user explicitly references portfolio analysis, expirations, WALT, tenant concentration, or below-average rent against a file already in context.

Filename heuristics ("rent roll", "RR", "tenant list", "portfolio") are a tie-breaker, not a primary signal. The skill never invokes on filename alone.

The skill **does not** invoke for: single lease documents (route to Lease Abstraction), T-12s / operating statements (out of scope), or generic "analyze this Excel" requests where the column-shape check fails.

*Acceptance:*
- Given a rent roll `.xlsx`, when the user uploads it without explicit instruction, then the skill is invoked and produces the full analysis.
- Given a single-lease PDF, when uploaded, then Lease Abstraction is invoked, not Rent Roll Analyst.
- Given a file whose only matching column is a tenant name, when uploaded, then the skill is **not** invoked.

**5.2 Loading and normalization**

The skill must produce a single deterministic normalized DataFrame from any of the formats PREP actually receives today (see §10 fixtures). Every downstream computation reads from this DataFrame; no computation re-parses the source file.

*5.2.1 Header detection.* The skill scans rows 1–10 of the active sheet looking for a row that contains ≥3 column-name matches against a curated alias dictionary (see Appendix B). The first row meeting that bar is the header. If no row meets the bar, the skill returns a clear error naming the closest candidate and asks the user to confirm. The contract: header detection is deterministic, testable, and explainable — a unit test takes a fixture, calls the detector, and asserts the chosen row index.

*5.2.2 Column mapping.* Each normalized column maps from a source column via the alias dictionary in Appendix B. Aliases are case-insensitive, whitespace-collapsed, and cover the variants observed in PREP's actual files plus the standard Yardi and MRI exports. New aliases are added to the dictionary; the mapping logic itself never changes per-file.

*5.2.3 Monthly-vs-annual rent inference.* This is the highest-stakes inference in the skill — getting it wrong moves every dollar number by 12×. The detector uses the following deterministic rules in order:

1. If the source column header explicitly contains "annual," "yearly," or "/yr" → annual.
2. If the header explicitly contains "monthly" or "/mo" → monthly.
3. If neither, compute median rent ÷ median rentable SF and apply these disjoint bands:
   - PSF in `[$0.50, $5)` → monthly (unambiguous).
   - PSF in `[$5, $20]` → **overlap zone**: the skill stops and asks the user.
   - PSF in `($20, $250]` → annual (unambiguous).
   - PSF outside `[$0.50, $250]` → the skill stops and asks the user.
4. The chat prompt for any ask-the-user case is: *"I detected rents that look like {monthly|annual|ambiguous} based on a median PSF of ${x}. Confirm or specify. (monthly / annual / let-me-specify)"*

The bands are deliberately disjoint so the rule is unambiguous; there is no "lower band wins" tiebreaker. Reason: silent guessing on a 12× error is the exact failure this section is designed to prevent.

Every inference (including a confirmed one) is recorded in the run's data-quality block (§5.10) and surfaced at the top of the Word memo and on the Excel "Data Quality" sheet.

*5.2.4 Required normalized schema:*

| Column | Type | Required | Notes |
|---|---|---|---|
| `building` | string | yes (synth if missing — see 5.2.6) | property identifier |
| `tenant` | string | yes | as in source |
| `tenant_normalized` | string | yes | output of normalization pipeline (Appendix C) |
| `suite` | string | nullable | |
| `sf` | numeric | yes | rentable square feet |
| `annual_rent` | numeric | yes | always annualized; inference recorded |
| `rent_psf` | numeric | yes | derived: `annual_rent / sf` (null if `sf` is 0 or null) |
| `lease_start` | datetime | nullable | reserved for future use; preserved if present |
| `lease_end` | datetime | yes for active rows | required for active-lease metrics |
| `exp_year` | int | yes | derived from `lease_end` |
| `is_vacant` | bool | yes | true when tenant is blank or rent is 0 with no `lease_end` |
| `is_mtm` | bool | yes | true when source flags MTM/holdover or when `lease_end` is null but tenant present and rent > 0 |
| `is_active` | bool | yes | true when `lease_end > today` OR `is_mtm`; false otherwise |
| `_source_row` | int | yes | original 1-indexed row number for traceability |

Source columns not in this list are preserved on the DataFrame as additional columns and on the Excel "Cleaned Rent Roll" sheet, but are never used by computations.

*5.2.5 Active-lease rule (applies to all metrics in §5.3–§5.8).* Unless explicitly stated otherwise, every metric is computed over `is_active = true` rows only. The Cleaned Rent Roll sheet retains all rows with the flags set; expired and vacant rows are visible in the data but excluded from headline numbers. Each section of the Word memo states the row count it operated on so the reader sees the inclusion rule.

*5.2.6 Multi-property fallback.* If no source column maps to `building`, the skill defaults to a single building named after the file (e.g., "PREP MOB Portfolio") and surfaces this in the data-quality block. The user can re-run with a manual building column specified in chat.

*5.2.7 Validation and warnings.* The data-quality block records, for each run:

- Row count: total, active, expired, vacant, MTM.
- Sum reconciliation: sum of `annual_rent` over **active** rows vs. sum over **all** rows.
- Null `lease_end` count and percentage among non-vacant rows. Threshold for prominent warning: > 5%.
- Detected duplicates (same `building + suite + tenant_normalized`).
- Monthly/annual inference outcome and basis.
- Header row chosen and confidence (count of alias hits).
- Any column the skill could not map.

*Acceptance:*
- Given each fixture in §10.1, when loaded, then the produced DataFrame matches the expected normalized DataFrame within 1¢ on rent and within 1 SF on square footage.
- Given a file with mixed monthly/annual columns or PSF math in the overlap band, when loaded, then the skill stops and asks rather than guessing.
- Given a file with no `lease_end` column at all, when loaded, then the skill returns a clear error and does not produce a partial report.

**5.3 Lease expiration analysis**

Compute expiring rent ($) and SF by year of expiration, over a configurable window (default: current year through current year + 9). Operates on **active** leases only (excludes already-expired and vacant rows).

Output table columns: `year`, `expiring_rent`, `expiring_sf`, `lease_count`. The current year's bucket counts only leases expiring **after today** in that calendar year — the skill notes this in the table caption ("YTD remainder" rather than full-year). MTM leases are reported as a separate line item, not bundled into the current year.

*Visualization.* The default chart is two **stacked panels** (rent on top, SF on bottom), shared X axis. A dual-axis variant is available behind a `chart_style: dual_axis` parameter for users who explicitly request it; the dual-axis variant locks the SF axis scale to a fixed ratio of the rent axis (1 SF = portfolio-average PSF) so the line and bars carry comparable visual weight. Either variant must meet the chart standards in §5.11.

*Acceptance:*
- Given a fixture with known lease ends, when expirations are computed, then the table reconciles to the active-lease subset within $1 and 1 SF.
- Given the chart is requested, when rendered, then the resulting PNG embeds at ≥150 DPI in the Word memo, has labeled axes, a legend, no gridline clutter, and a fully-spelled title.

**5.4 Building inventory**

Per-building summary over active leases. Columns: `building`, `total_sf`, `tenant_count_distinct`, `lease_count`, `total_annual_rent`, `weighted_avg_rent_psf` (SF-weighted), `vacancy_sf` (vacant rows in that building, reported separately, not deducted from `total_sf`). Sorted by `total_sf` descending.

**`tenant_count_distinct`** counts unique `tenant_normalized` values per building. **`lease_count`** counts rows. A tenant with two suites in one building is 1 distinct tenant, 2 leases.

**`weighted_avg_rent_psf`** is `sum(annual_rent) / sum(sf)` over active leases. The header in both Word and Excel reads "Weighted Avg Rent PSF (SF-weighted)" — explicit so no reader guesses.

**5.5 Expiration pivot (building × year)**

Two-dimensional view: buildings on rows, years on columns, `expiring_rent` in cells. Includes Total row and Total column. Same active-lease and current-year-bucket rules as §5.3. If the portfolio has > 25 buildings, the Word memo shows the top 25 by `total_sf` plus a "+ N additional buildings" row; the Excel sheet always shows all buildings.

**5.6 Weighted average lease term (WALT)**

Compute WALT at portfolio and per-building levels.

```
For each active lease:
  years_remaining = (lease_end - today).days / 365.25

WALT = sum(weight * years_remaining) / sum(weight)
```

`weight_by` parameter accepts `'rent'` (default) or `'sf'`. NOI weighting is **not** in v1 (the schema does not include NOI). MTM leases are excluded from WALT and reported as a separate count alongside the result.

Output displays WALT to **1 decimal place** with an optional secondary "years and months" rendering ("5.3 years (5y 4m)"). Two-decimal precision is forbidden — see §5.11.2 for rationale.

The portfolio result and per-building DataFrame both expose: `walt_years`, `weighting_basis`, `included_lease_count`, `excluded_mtm_count`, `excluded_expired_count`. Every WALT figure that appears in a deliverable is accompanied by the inclusion counts.

**5.7 Tenant concentration**

Top N tenants by total active rent, grouped by `tenant_normalized`. Default `top_n` is `5` for portfolios with ≤ 50 distinct tenants, `10` for portfolios with > 50 (the skill picks automatically; user can override). Columns: `tenant_normalized`, `total_annual_rent`, `total_sf`, `lease_count`, `building_count`, `pct_of_portfolio_rent`.

*Tenant normalization pipeline.* See Appendix C. The pipeline is a documented config artifact (suffix list, casing rules, punctuation handling), not hardcoded. The MOB-specific suffixes (`P.C.`, `PLLC`, `M.D.`, `DDS`, etc.) are explicitly included in v1 because PREP's portfolios are MOBs.

**5.8 Below-building-average rent flagging**

Flag active leases whose `rent_psf` falls more than `threshold` below the building's `weighted_avg_rent_psf` (where the building average itself is computed over active leases only — so a flagged lease is not allowed to drag down its own baseline; the average for flagging purposes is recomputed building-by-building **excluding the row under test**).

Default `threshold` is `-0.15` (15% below). Output columns: `building`, `tenant`, `suite`, `rent_psf`, `building_weighted_avg_psf_excluding_self`, `variance_pct`, `lease_end`.

**Critical language constraint.** The output (table headers, Word commentary, chat response, Excel sheet name and column names) must use **"below building average"** or **"below building avg PSF"**. The phrases **"below market," "under market," "below market rent," "submarket rent"** are forbidden. The skill's prompt template includes this constraint and the rendering layer scans final output for forbidden phrases and fails the run if any are present (see Appendix D for the forbidden-phrase list).

**5.9 Word document output**

Format: `.docx`. Native Word tables (not pipe-character text — the rendering layer asserts this on every table; see acceptance below). Native heading styles. Embedded chart images at ≥150 DPI. US Letter, 1" margins, Arial, matching the Lease Abstraction skill's template (see Appendix E for the shared template manifest).

Structure:

1. Title and date.
2. **Data Quality Notes** — non-empty if any inferences, warnings, or excluded data; rendered as a callout box at the top of the document. Sections include: monthly/annual inference, header-row choice, null-lease-end percentage, duplicate-row count, building-fallback note (if 5.2.6 fired). If the data-quality block is empty, this section is omitted entirely.
3. **Executive summary** — a *templated* paragraph (no LLM-generated prose; deterministic): "Portfolio of {building_count} buildings, {tenant_count_distinct} distinct tenants across {lease_count} leases, ${total_active_rent} in total active annual rent, {total_active_sf} total active SF. Weighted average rent is ${weighted_avg_psf} PSF. Portfolio WALT is {walt_years} years (rent-weighted). The largest expiration year is {top_exp_year} at ${top_exp_rent}." Variables substituted; no other text generated. (Rationale: §5.11.2 — deterministic outputs are a hard requirement.)
4. **Lease Expiration Profile** — embedded chart + 1 templated paragraph identifying the top three expiration years.
5. **Building Inventory** — native Word table from §5.4.
6. **Expiration Schedule by Building** — native Word table from §5.5 (top 25 + "additional" row if > 25 buildings).
7. **Tenant Concentration** — native Word table from §5.7.
8. **WALT** — portfolio number plus per-building table from §5.6, including inclusion-count footnotes.
9. **Below-Building-Average Rent Flags** — native Word table from §5.8.
10. **Footer** — file name, date generated, methodology disclaimer (see Appendix F for approved language).

*Acceptance:*
- Given a generated `.docx`, when opened in Microsoft Word, then every table appears as a native Word table (right-click → "Table Properties" returns a valid response on every table). The integration test asserts this by inspecting the `w:tbl` elements in the underlying XML.
- Given any forbidden phrase from Appendix D appears in the rendered Word output, then the integration test fails.

**5.10 Excel document output**

Format: `.xlsx`. Sheets:

| # | Sheet | Source |
|---|---|---|
| 1 | Cleaned Rent Roll | Full normalized DataFrame + preserved source columns |
| 2 | Data Quality | All warnings, inferences, header-row choice, row counts |
| 3 | Expirations by Year | §5.3 |
| 4 | Building Inventory | §5.4 |
| 5 | Expirations by Bldg & Year | §5.5 (all buildings) |
| 6 | Top Tenants | §5.7 |
| 7 | WALT by Building | §5.6 |
| 8 | Below-Bldg-Avg Flags | §5.8 |

Formatting requirements:

- Currency columns: `$#,##0` for rent totals, `$#,##0.00` for PSF values; never coerced to strings.
- Date columns formatted as Excel dates; never serial numbers; never strings.
- Percentage columns formatted as percentages.
- Numeric columns retained as numbers.
- Headers in row 1, frozen, bold.
- Column widths auto-fit within reason (cap at 60 characters wide).
- Data Quality sheet is sheet 2 (immediately after Cleaned Rent Roll) — explicitly second so reviewers see it before consuming downstream sheets.

*Acceptance:*
- Given a generated `.xlsx`, when opened in Excel, then no currency cell is left-aligned (which would indicate text), no date cell shows a serial number, and percentage cells display with the `%` glyph.
- Given the Excel and Word are generated from the same run, then the totals on Building Inventory match between the two within 1¢.

**5.11 Output quality standards**

*5.11.1 Chart standards.* All charts use the shared portfolio palette defined alongside the Lease Abstraction skill (Appendix E). The expiration chart includes title, axis labels on both axes, legend, currency-formatted rent axis (`$X.XM` / `$XK`), and SF-formatted SF axis (`XK`). Render at ≥150 DPI. No 3D, no chartjunk, gridlines only when they aid readability of dense data. Color choice avoids red for non-negative metrics — SF-expiring is conventionally neutral, not negative.

*5.11.2 Determinism.* All outputs are deterministic: same input file → same output bytes (modulo timestamps). This is non-negotiable. The executive summary uses a templated string (5.9.3); LLM-generated prose is forbidden in this skill's deliverables. WALT and other derived metrics display to **1 decimal place** — 2 decimals (e.g., 5.34 years) implies ~3.6-day precision that the underlying data does not support.

*5.11.3 Reconciliation.* Sum totals in deliverables reconcile against the **cleaned, active-lease subset** of the source rent roll within rounding ($1, 1 SF). They do **not** necessarily match raw source workbook totals because cleaning excludes subtotal rows, expired leases, and (where present) source-file footers. The Data Quality sheet shows the difference between raw source sum and cleaned active sum so the analyst can audit the delta.

*5.11.4 Language.* Use precise, operator-grade language. Hedging words ("approximately," "roughly") appear only in the Data Quality block where they describe an inference; everywhere else the numbers are exact. Forbidden phrases per Appendix D.

**5.12 Project and memory integration**

When invoked inside a project context (the portal's existing `projects` scope):

- The skill **reads** project memory for: preferred WALT weighting, preferred expiration window, custom building name aliases. These come from a structured memory record (schema below); not free-text.
- After analysis completes, the skill **writes** a structured memory record:

```json
{
  "type": "rent_roll_analysis",
  "project_id": "...",
  "user_id": "...",
  "date": "2026-04-27",
  "source_file": "PREP_MOB_Portfolio_Q1.xlsx",
  "building_count": 10,
  "tenant_count_distinct": 47,
  "lease_count": 62,
  "total_active_annual_rent": 8420000,
  "total_active_sf": 312000,
  "portfolio_walt_years": 5.3,
  "weighting_basis": "rent",
  "data_quality_warnings": ["monthly_annual_inferred", "null_lease_end_pct=4.8"],
  "output_files": {
    "docx": "rent_roll_analysis_2026-04-27.docx",
    "xlsx": "rent_roll_analysis_2026-04-27.xlsx"
  }
}
```

- Output files are saved to the project's outputs folder (not just the chat session) so that downstream IC memos and decks can reference the analysis without re-uploading.

*Acceptance:*
- Given a project with prior analyses, when the user runs a new rent roll analysis, then the chat surface mentions the prior analyses and offers to reuse the prior weighting/window.
- Given the analysis completes, when the user opens the project memory view, then the JSON record above is visible and queryable.

**5.13 Tenant isolation and access control**

This skill processes user-uploaded financial data. The same rules from PowerPoint Generation §5.0a apply (see `PRD-AI-Portal-PowerPoint-Generation.md` in the repo root):

- All file processing, intermediate artifacts, and generated outputs are tenant-scoped under the user's storage root.
- No code path may read another tenant's analysis or input.
- Outputs are deletable on user request; the skill must not orphan references in other systems (memory records, project listings) when an output is deleted.
- Every analysis run logs to the existing `audit_log` table: `user_id`, `project_id`, `source_file`, `run_id`, `timestamp`, output paths.

*Acceptance:*
- Test suite includes the §5.0a-pattern access-control tests, adapted for this skill (see Appendix G). Cross-user access attempts must return 404 (not 403) and not appear in logs as "permission denied" but as "not found."

**5.14 Failure modes**

The skill fails loudly, never silently. Concrete failure messages live in chat with actionable next steps:

- *No header row detected* → "I could not find a header row in the first 10 rows. The closest candidate was row {n}. Should I use that?"
- *No `lease_end` column* → "I could not find a lease-end column. Aliases I checked: {list}. Which column holds lease end dates?"
- *Monthly/annual inference in overlap band* → "Rents look like {monthly|annual} based on a median PSF of ${x}. Confirm or specify."
- *> 50% null lease ends* → "More than half the rows have no lease end. Most metrics depend on this column. Continue with what we have, or fix the file?"
- *Hard parse error* → "I could not open the file. Error: {message}. The portal accepts `.xlsx`, `.xls`, and `.csv`."

Each failure mode has a corresponding integration test using fixture E.

### P1 — Nice-to-Have (fast-follow, weeks 8–16 post-launch)

**5.15** Partial analysis — user asks for "just the WALT" or "just the expiration chart" and the skill returns only that section. Architecture is set up for this (each capability is independently callable); the chat surface needs prompt templates.

**5.16** Custom building name aliases via project memory — user maps "Bldg A" / "Building Alpha" / "Alpha MOB" to a single canonical name without editing the file.

**5.17** Year-month WALT display ("5y 4m") as the default; v1 ships with `5.3 years` and the year-month rendering is opt-in.

**5.18** Light occupancy summary — total rentable SF including vacant rows, occupied SF, occupancy %, top vacant suites by SF. Today vacant rows are surfaced but not summarized.

### P2 — Future Considerations (design for, do not build)

**5.19** Market comparison data integration (CoStar/Reonomy/broker reports).
**5.20** Multi-rent-roll merge in one analysis.
**5.21** Time-series analysis across snapshots.
**5.22** Tenant credit overlay.
**5.23** T-12 / operating statement integration.
**5.24** Yardi/MRI API ingestion (live refresh).
**5.25** Scenario modeling.

> **Architectural implication.** The seven capabilities in §5.3–§5.8 plus loading (§5.2) and rendering (§5.9–§5.10) must be independently callable functions with stable signatures (Appendix A). Future skills (Lease Abstraction, IC Memo Generator) compose these capabilities; the renderer is the same renderer used by PowerPoint Generation. Do not bundle the analysis logic inside the renderer, and do not bundle the renderer inside the analysis.

## 6. Success Metrics

### Leading indicators (measured weeks 1–4 post-launch)

| Metric | Definition | Success | Stretch |
|---|---|---|---|
| Adoption | % of weekly active portal users who run ≥1 rent roll analysis | 50% | 75% |
| Activation | % of analysis requests that produce a downloaded `.docx` + `.xlsx` pair | 90% | 98% |
| Time-to-result | Median wall-clock from upload to download link | ≤30s | ≤15s |
| Rework rate | % of analyses shipped with zero manual recomputation | 95% | 99% |
| Inference confirm rate | % of monthly/annual inferences confirmed by user as correct | 95% | 99% |
| Failure visibility | % of failures producing actionable error vs. silent issue | 100% | 100% |

**Measurement.** Instrument with events `rentroll.uploaded`, `rentroll.parsed`, `rentroll.inference_confirmed`, `rentroll.analysis_completed`, `rentroll.failed`, `rentroll.downloaded`. Rework rate measured via a thumbs-up/down + free-text follow-up after download.

### Lagging indicators (measured weeks 8–16)

| Metric | Definition | Success | Stretch |
|---|---|---|---|
| Analyst hours saved | Self-reported via quarterly survey | 15 hrs/analyst/quarter | 30 hrs |
| Phase 2 contract close | Bill signs Phase 2 expansion | ✅ | ✅ + reference quote |
| Recurrence | Analyses run per analyst per quarter | ≥4 | ≥8 |

### Evaluation cadence
- Week 2: leading-indicator review, decide on P1 items.
- Week 8: full success-metrics review, lagging first read, Phase 2 contract conversation.
- Week 16: retrospective + v2 roadmap.

## 7. Technical Considerations

### Stack assumptions
- The portal backend is Node.js/Express (`server/index.js`); there is no existing Python worker. The skill's analytical core is a Python module (pandas / matplotlib / python-docx / openpyxl), invoked from Node. Boundary options, in order of preference:
  1. **Python sidecar service** exposing a small HTTP API (e.g., `POST /analyze`, `POST /capability/<name>`) co-deployed with the Node backend. Outputs are written to the portal's existing storage and the response returns paths + the memory record. Preferred because it isolates Python deps, supports per-request concurrency, and matches the SSE streaming pattern already used for lease ingestion.
  2. **Subprocess invocation** from Node (`child_process.spawn('python', ...)`) with JSON over stdio. Acceptable as a v1 expedient if a sidecar is not stood up in time; it does not scale past ~1 concurrent run per backend instance.
  - Engineering picks one in week 0; the public function signatures in Appendix A are unchanged either way (they describe the Python module's interface, which both options call into).
- Pandas for the normalized DataFrame; matplotlib for chart rendering; `python-docx` for Word; `openpyxl` for Excel. These are the v1 choices and are stated as constraints in the public function signatures (Appendix A).
- Storage: outputs land under `./data/uploads/` in dev and `/data/uploads/` on the GCP VM (the same convention already used for project files). Outputs are referenced by the project's outputs folder and retained 90 days.
- Model: Claude Opus 4.5/4.7 via the **direct Anthropic API** (the portal reads `Opus_API_KEY` and routes through `server/lib/claude-direct.js`). GCP Vertex is not used for this skill — Vertex does not currently serve Claude for this account. The model is only invoked for routing and clarifying questions; the analysis itself is fully deterministic.

### Integration points
- **Portal chat layer** — request entry point, response surface, inference confirmation prompts.
- **Portal job queue** — async generation; chat shows progress.
- **`anthropic-skills:xlsx`** — input parsing only (the column-shape probe). Once normalized, this skill owns the DataFrame.
- **`anthropic-skills:docx`** — Word rendering primitives (native tables, embedded images).
- **`anthropic-skills:pdf`** — not used in v1 (rent rolls are not PDF). Stub for future fixture.
- **Project memory** — structured records per §5.12.
- **`audit_log`** — every run logs entry per §5.13.

### Architectural decision: single entry point vs. composable tool calls

The skill exposes **both**:

1. A high-level entry point `analyze_rent_roll(file_path, project_id) → {docx_path, xlsx_path, memory_record}` that runs the full report. This is the default invocation when the model detects a rent-roll upload (§5.1).
2. Individual capability tool calls (Appendix A) that the model can invoke when the user asks a narrow question. Each capability is a separate MCP-style tool call with a stable schema.

This double-exposure is intentional: it preserves the one-shot UX for the primary case (upload → finished package) while allowing the model to compose narrower analyses for ad-hoc questions ("what's the WALT?"). It also matches the pattern used elsewhere in the portal (e.g., `pptx-generate` is a single high-level call, but the slide-rendering helpers are independently callable too).

The fallback rule: if the model is unsure whether to compose or invoke the high-level entry point, prefer the high-level entry point. Reason: the report is the value proposition.

### Prompt architecture (high level)

There are no prose-generating prompts in this skill's hot path. The skill's "intelligence" is in:

- Header detection (deterministic rule).
- Column mapping (alias dictionary).
- Monthly/annual inference (deterministic rules with explicit ask-the-user fallback).
- Tenant normalization (pipeline; Appendix C).
- The forbidden-phrase scanner on output.

The model is responsible for: routing ("is this a rent-roll request?"), asking clarifying questions when the skill returns one, and explaining results in chat. The model **does not** generate the Word memo's body or the executive summary — those are templated.

## 8. Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | Source rent rolls for fixtures — confirm PREP's actual files (Yardi-style export from PREP, MRI-style export from any second customer if available) can be used as test fixtures, with PII handling cleared? | Product / Bill / Legal | Blocking |
| Q2 | ~~Vertex availability of Opus 4.5/4.7 for the routing/clarifying-question layer~~ **Resolved:** Vertex does not serve Claude on this account; the skill uses the direct Anthropic API via `Opus_API_KEY` (see §7). | Engineering | Resolved |
| Q3 | Outputs retention — 90 days as default per §7? | Legal | Non-blocking |
| Q4 | Forbidden-phrase scanner — runs on Word and chat output, but what about the model's exploratory chat *before* a final document is rendered? Pre-render scanning adds latency. Default: scan only the final rendered Word and Excel; the model's prompt template instructs it to avoid the forbidden phrases in chat as well. | Product | Non-blocking (default decided) |
| Q5 | Should building name fallback (§5.2.6) use the file name or a fixed string ("Single Building")? | Design | Non-blocking |
| Q6 | Logging — capture full normalized DataFrame for QA, or only summary stats for privacy? | Engineering / Legal | Non-blocking |
| Q7 | Telemetry — should `rentroll.parsed` event include the alias-hit count to monitor dictionary drift? | Engineering | Non-blocking |
| Q8 | Top-N tenant default (5 vs. 10) — is the size threshold (50 distinct tenants) reasonable for PREP's portfolio sizes? | Product / Bill | Non-blocking |
| Q9 | Below-average threshold default (-0.15) — is 15% the right line for MOB? Some operators use 10%. | Product / Bill | Non-blocking |

## 9. Timeline Considerations

### Hard constraints
- Phase 2 contract conversation targeted weeks 8–10 alongside PowerPoint Generation. This skill must be demo-stable by week 6.
- No external regulatory or contractual deadlines.

### Suggested phasing (5-week build, runs partly in parallel with PowerPoint Generation)

**Week 1 — Loader and normalization**
- Alias dictionary (Appendix B) populated from PREP fixtures.
- Header detection + column mapping unit tests against fixtures A–E.
- Monthly/annual inference + ask-the-user fallback.
- Normalized DataFrame schema implemented; `is_active`, `is_vacant`, `is_mtm` flags wired.
- Tenant normalization pipeline (Appendix C) implemented and tested.

**Week 2 — Analytical capabilities**
- Capabilities §5.3–§5.8 implemented as independent functions with stable signatures.
- Reconciliation tests against fixtures A–D (active-lease subset).
- Per-capability unit tests pass.

**Week 3 — Rendering**
- Word renderer (`python-docx`): native tables, embedded chart, heading styles, shared template.
- Excel renderer (`openpyxl`): typed cells, formatted columns, frozen headers.
- Chart rendering (matplotlib): stacked-panel default + dual-axis variant.
- Forbidden-phrase scanner.
- End-to-end integration tests against fixtures A–D.

**Week 4 — Portal integration**
- Triggering logic in chat orchestrator.
- Inline file delivery (Word + Excel pair) in chat.
- Project memory read/write.
- Audit logging.
- Access-control test suite (Appendix G).

**Week 5 — Polish + perf**
- Performance tuning to meet ≤30s median on 1000-row inputs; ≤90s p95 on 10,000-row inputs.
- Failure-mode UX (every error in §5.14 has a tested chat surface).
- Telemetry firing for the leading-indicator metrics.
- Internal dogfood with PREP MOB Q1 portfolio.

### Dependencies
- PREP fixture clearance (Q1) — gates week 1 testing rigor; can scaffold against synthetics first.
- Anthropic API access via `Opus_API_KEY` — already in place; no external blocker for week 4 chat integration.
- Python boundary decision (sidecar vs. subprocess, see §7) — engineering picks in week 0; gates week 1 scaffolding.
- Shared Word/Excel template alignment with Lease Abstraction skill — gates week 3.

### Risk register
- **R1:** Yardi/MRI exports vary by client config more than the alias dictionary covers. Mitigation: the dictionary is config; the loader returns a clear "unmapped column" error; a new alias is a config PR, not a code change.
- **R2:** Monthly/annual inference is wrong on a real customer file. Mitigation: confirm-with-user fallback; the inference is itself logged so post-mortem is fast.
- **R3:** Native-Word-table rendering regression (the PRD's primary motivator). Mitigation: the integration test inspects `w:tbl` XML on every generated `.docx` and fails the build if any expected table is missing or malformed.
- **R4:** Performance on 10,000-row REIT-scale rent rolls exceeds 90s. Mitigation: the perf budget for v1 is `≤30s on 1,000 rows, ≤90s on 10,000 rows`; beyond that, surface a "large file detected, processing may take longer" indicator. Vectorize hot paths in pandas.
- **R5:** Forbidden-phrase scanner false positives blocking legitimate runs. Mitigation: scanner runs on the rendered Word body and Excel sheet/column names only; not on the source rent roll content (which may legitimately contain such phrases).

---

## Appendix A — Public function signatures

These signatures are the public contract. Naming, parameter order, and return types are stable across v1 minor versions.

```python
load_rent_roll(file_path: str) -> NormalizedRentRoll
    # NormalizedRentRoll wraps a pd.DataFrame plus a DataQualityBlock.

compute_expirations(
    rr: NormalizedRentRoll,
    start_year: int | None = None,
    end_year: int | None = None,
) -> pd.DataFrame

compute_building_inventory(rr: NormalizedRentRoll) -> pd.DataFrame

compute_expiration_pivot(
    rr: NormalizedRentRoll,
    start_year: int | None = None,
    end_year: int | None = None,
) -> pd.DataFrame

compute_walt(rr: NormalizedRentRoll, weight_by: str = "rent") -> WaltResult
    # WaltResult: { walt_years, weighting_basis, included_lease_count,
    #               excluded_mtm_count, excluded_expired_count }

compute_walt_by_building(rr: NormalizedRentRoll, weight_by: str = "rent") -> pd.DataFrame

compute_tenant_concentration(rr: NormalizedRentRoll, top_n: int | None = None) -> pd.DataFrame

compute_below_building_avg_flags(rr: NormalizedRentRoll, threshold: float = -0.15) -> pd.DataFrame

render_expiration_chart(
    exp_df: pd.DataFrame,
    output_path: str,
    style: str = "stacked",   # "stacked" | "dual_axis"
) -> str

render_portfolio_word(analyses: PortfolioAnalyses, output_path: str) -> str

render_portfolio_excel(analyses: PortfolioAnalyses, output_path: str) -> str

analyze_rent_roll(
    file_path: str,
    project_id: str | None = None,
    user_id: str | None = None,
) -> AnalysisResult
    # High-level entry point. Calls all of the above and returns paths
    # to the generated docx + xlsx plus the memory record.
```

## Appendix B — Column alias dictionary (initial)

Aliases are case-insensitive and whitespace-collapsed before matching. New aliases land here as config PRs, not code changes.

| Normalized | Source aliases (initial set) |
|---|---|
| `building` | `building`, `property`, `property name`, `bldg`, `asset`, `site` |
| `tenant` | `tenant`, `tenant name`, `lessee`, `occupant`, `customer` |
| `suite` | `suite`, `unit`, `space`, `suite number`, `unit #`, `space #` |
| `sf` | `sf`, `square feet`, `rentable sf`, `rsf`, `rentable area`, `area (sf)`, `nra` |
| `annual_rent` | `annual rent`, `base rent (annual)`, `yearly rent`, `rent/yr`, `annual base rent` |
| `monthly_rent` (→ × 12 → `annual_rent`) | `monthly rent`, `base rent (monthly)`, `rent/mo`, `monthly base rent` |
| `lease_start` | `lease start`, `commencement`, `commencement date`, `start date`, `begin date` |
| `lease_end` | `lease end`, `expiration`, `expiration date`, `end date`, `lease expiration`, `term end` |
| `mtm_flag` | `mtm`, `month-to-month`, `holdover`, `tenancy type` (when value is `MTM`) |

Engineering populates this from Yardi and MRI sample exports during week 1; PREP fixtures pin the rest.

## Appendix C — Tenant normalization pipeline

Steps, applied in order:

1. Trim whitespace; collapse internal whitespace runs to a single space.
2. Lowercase.
3. Strip trailing periods and commas.
4. Strip a configured suffix list. v1 list: `LLC`, `L.L.C.`, `Inc`, `Inc.`, `Incorporated`, `Corp`, `Corporation`, `Co`, `Co.`, `Company`, `Ltd`, `Ltd.`, `Limited`, `LLP`, `L.L.P.`, `LP`, `L.P.`, `PC`, `P.C.`, `PLLC`, `P.L.L.C.`, `MD`, `M.D.`, `DO`, `D.O.`, `DDS`, `D.D.S.`, `DMD`, `D.M.D.`, `DPM`, `D.P.M.`, `OD`, `O.D.`, `LMT`, `RN`, `NP`, `PA`, `P.A.` (the medical suffixes are required for MOB portfolios).
5. Strip common DBA prefixes: `dba`, `d/b/a`, `d.b.a.`.
6. Strip `the` from the start of the string.
7. Re-collapse whitespace; trim.

The result is the value used for grouping (`tenant_normalized`). The original `tenant` field is preserved for display.

## Appendix D — Forbidden phrases

The output scanner fails any run whose final rendered Word body or Excel sheet/column names contain any of:

- `below market`
- `below-market`
- `under market`
- `under-market`
- `submarket rent`
- `sub-market rent`
- `market rent` (in context of a deviation claim — the scanner inspects nearby words; flagged by default, allow-listed for fixed-text disclaimer language only)

Approved phrases for the same concept: `below building average`, `below building avg`, `below building avg PSF`, `below the building's weighted-average PSF`.

## Appendix E — Shared Word/Excel template manifest

Lives alongside the Lease Abstraction skill's template. References:

- Page: US Letter, 1" margins.
- Default font: Arial 11.
- Heading styles: Heading 1 (Arial 16, bold), Heading 2 (Arial 13, bold), Heading 3 (Arial 11, bold).
- Color palette: defined in `chart_palette.json` next to the renderer; both skills import from the same file.
- Footer: file name (left), page number (center), date generated (right).

Engineering aligns the template with Lease Abstraction during week 3; both skills must produce documents that look like they came from the same source.

## Appendix F — Methodology disclaimer (footer)

Approved language (Legal-cleared):

> *Generated {date} by the Vetted AI Portal Rent Roll Analyst. All numbers are computed from the source rent roll only; no external market data is used. "Below building average" reflects deviation from the building's weighted-average rent PSF on active leases and is intended as a starting point for analyst review, not a market judgment. Active leases are defined as those with a lease end after {date} or flagged as month-to-month. See the Data Quality section of this document for any inferences applied during processing.*

## Appendix G — Access-control test plan

Adapted from PowerPoint Generation §5.0a. Minimum tests for v1:

1. **Output isolation.** Seed users A and B, each with one rent roll analysis. `GET /api/rent-roll-analyses` as A returns A's only; as B returns B's only.
2. **Detail 404 on cross-access.** `GET /api/rent-roll-analyses/{B_id}` as user A returns 404, not 403, not 200. The error body does not leak the analysis name or source file name.
3. **Re-run isolation.** `POST /api/rent-roll-analyses/{B_id}/rerun` as A returns 404; the LLM mock receives zero calls.
4. **Project scoping.** A's project memory does not surface B's prior analyses, even if both users have projects with the same name.
5. **Memory delete cascade.** Deleting an analysis from A's project removes the memory record; subsequent A queries do not return a stale reference.
6. **Audit log integrity.** Every run creates exactly one `audit_log` row; the row is queryable by admin via the existing admin route, not by the user.

## Appendix H — Test fixtures

| ID | Description | Source |
|---|---|---|
| A | Clean baseline. Header in row 1, ISO dates, numeric rent (annual), single property. | Synthetic |
| B | Multi-property with subtotal rows mixed in, mixed date formats, monthly rent in `Rent` column with `(monthly)` in the header. | Synthetic |
| C | Yardi-style export. Header in row 4 below a metadata block; specific column layout from real Yardi sample. | PREP-provided (Q1) |
| D | MRI-style export. Header in row 6; specific MRI column layout. | PREP-provided or second customer (Q1); synthetic fallback if unavailable |
| E | Intentionally messy: missing `lease_end` column, partial nulls, a row with negative rent, two duplicate building+suite+tenant rows, a row with rent that triggers the monthly/annual overlap band. | Synthetic |

For each fixture, an expected-outputs YAML pins: row counts (total/active/expired/vacant/MTM), totals (active rent, active SF), portfolio WALT, expiration table, top-5 tenants, below-avg flag count. Tests assert outputs match within tolerance ($1, 1 SF, 0.05 years).

Acceptance criterion 4 (reconciliation) applies to fixtures **A–D**; fixture E is the failure-mode fixture and the corresponding test asserts the **error messages and ask-the-user prompts**, not numerical reconciliation.

## Appendix I — Definition of Done for v1

- [ ] All P0 acceptance criteria met.
- [ ] Fixtures A–D pass the integration test end-to-end with no manual intervention; outputs match expected values within tolerance.
- [ ] Fixture E surfaces every failure mode in §5.14 with the exact chat prompts specified there.
- [ ] Generated `.docx` for every fixture has been opened by a human reviewer and verified: native Word tables, native heading styles, embedded chart at correct DPI, no forbidden phrases.
- [ ] Generated `.xlsx` for every fixture has been opened and verified: typed numeric/currency/date cells, no string coercion, frozen headers.
- [ ] Tenant isolation verified by Appendix G test suite passing in CI.
- [ ] 1,000-row analysis completes in ≤30s median; 10,000-row in ≤90s median.
- [ ] PREP MOB Q1 portfolio dogfood: output reviewed by a PREP analyst and graded ≥4/5 on a rubric of accuracy, formatting, and narrative clarity (rubric defined Appendix J).
- [ ] Telemetry firing for all six leading-indicator events.
- [ ] Memory record schema visible in the project memory view per §5.12.

## Appendix J — Dogfood acceptance rubric (Definition of Done item)

PREP analyst (the analyst who has historically produced the manual version) scores the generated package on a 1–5 scale across:

1. **Numerical accuracy** — every headline number matches the analyst's own computation. (1 = > 5% off; 5 = exact within rounding.)
2. **Formatting fidelity** — Word and Excel look like the analyst would have produced them. (1 = visibly broken; 5 = indistinguishable.)
3. **Narrative clarity** — the executive summary and Data Quality block are accurate and readable. (1 = misleading; 5 = the analyst would copy them verbatim.)
4. **Trust** — would you sign this and send it without a second pass? (1 = no; 5 = yes.)

All four scores must be ≥4 to consider the dogfood passed. Any score ≤3 generates a follow-up issue and a re-run.

---

*End of specification.*
