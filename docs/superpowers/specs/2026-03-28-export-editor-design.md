# Export Editor Enhancement Design

**Date:** 2026-03-28
**Status:** Approved

## Summary

Enhance the export flow so both Word and Excel options are always visible in the modal, and both open a proper editor panel. The Excel editor falls back to a single-column table when the AI response has no markdown tables.

## User Flow

1. User gets AI response → clicks **Export** button
2. Modal opens showing **Word Document** and **Excel Spreadsheet** (both always visible)
3. User clicks one → editor panel slides open from the right
4. Editor has format-specific content + "Export to Word" / "Export to Excel" button at top
5. User edits content, then clicks export → file downloads

## Changes

### ExportModal.tsx

- Remove `hasTables` conditional gate on the Excel option — always show both Word and Excel
- Clicking an already-selected format opens the editor directly (already implemented)
- Remove `useMemo` for `hasTables` since it's no longer needed

### ExportPanel.tsx — Word Editor (mostly done)

- Toolbar: Bold, Italic, Underline | H1, H2 | Bullet List, Numbered List | Align Left/Center/Right
- contentEditable div with markdown→HTML rendered content (DOMPurify sanitized)
- "Export to Word" button in panel header
- No changes needed — current implementation is complete

### ExportPanel.tsx — Excel Editor

- When response contains markdown tables → parse into editable grid (current behavior, no change)
- When response has no markdown tables → split text content into paragraphs and put into a single-column "Content" table as fallback
- Editable headers and cells via input fields
- "Export to Excel" button in panel header (already present)
- No rich text toolbar — spreadsheets are about structured data

### Files NOT changed

- `MainChatPage.tsx` — already wires up ExportModal correctly
- `ProjectDetailPage.tsx` — already wires up ExportModal correctly
- `src/utils/export.ts` — existing export functions handle both cases

## Architecture

```
Export Button (MainChatPage / ProjectDetailPage)
  └─> ExportModal (format + scope selection)
      ├─ Word Document (always visible)
      └─ Excel Spreadsheet (always visible, no hasTables gate)
          └─> ExportPanel (slide-out editor)
              ├─ WordEditor: toolbar + contentEditable + markdown→HTML
              └─ ExcelEditor: editable table grid
                  ├─ Has tables → parsed markdown tables
                  └─ No tables → single-column "Content" fallback
```

## Scope

3 changes total:
1. Remove `hasTables` conditional in ExportModal (always show Excel)
2. Add text-to-table fallback in ExportPanel's Excel editor initialization
3. No other files touched
