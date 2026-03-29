# Export Editor — Excel Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Always show the Excel export option and provide a single-column text fallback when no markdown tables exist in the AI response.

**Architecture:** Remove the `hasTables` gate in ExportModal so both Word and Excel are always visible. Add a text-to-table fallback in ExportPanel's Excel initialization so non-table content gets split into paragraphs and placed in a single-column "Content" table.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/chat/ExportModal.tsx` | Modify | Remove `hasTables` conditional; always render Excel option |
| `src/components/chat/ExportPanel.tsx` | Modify | Add text-to-table fallback in Excel editor initialization |

No new files. No test runner configured.

---

### Task 1: Remove hasTables gate from ExportModal

**Files:**
- Modify: `src/components/chat/ExportModal.tsx:1-109`

- [ ] **Step 1: Remove the `hasTables` useMemo and unused import**

In `src/components/chat/ExportModal.tsx`, change the imports and remove the `hasTables` memo:

```tsx
// BEFORE (line 1-6):
import React, { useState, useMemo } from 'react';
import { X, FileText, Sheet } from 'lucide-react';
import {
  ExportableMessage,
  hasMarkdownTables,
} from '../../utils/export';

// AFTER:
import React, { useState } from 'react';
import { X, FileText, Sheet } from 'lucide-react';
import { ExportableMessage } from '../../utils/export';
```

Then delete line 21:
```tsx
// DELETE this line:
const hasTables = useMemo(() => hasMarkdownTables(messages), [messages]);
```

- [ ] **Step 2: Remove the conditional wrapper around the Excel button**

In `src/components/chat/ExportModal.tsx`, the Excel button (lines 90-109) is wrapped in `{hasTables && ( ... )}`. Remove the conditional so the button always renders:

```tsx
// BEFORE (lines 90-109):
            {/* Excel option — only when tables exist */}
            {hasTables && (
              <button
                onClick={() => {
                  if (format === 'excel') { setPanelOpen(true); }
                  else { setFormat('excel'); setScope('last'); }
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                  format === 'excel'
                    ? 'border-accent bg-accent/5'
                    : 'border-vetted-border hover:border-vetted-text-muted'
                }`}
              >
                <Sheet size={20} className={format === 'excel' ? 'text-accent' : 'text-vetted-text-muted'} />
                <div>
                  <div className="text-sm font-medium text-vetted-primary">Excel Spreadsheet</div>
                  <div className="text-xs text-vetted-text-muted">Edit tables and export as Excel</div>
                </div>
              </button>
            )}

// AFTER:
            {/* Excel option */}
            <button
              onClick={() => {
                if (format === 'excel') { setPanelOpen(true); }
                else { setFormat('excel'); setScope('last'); }
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                format === 'excel'
                  ? 'border-accent bg-accent/5'
                  : 'border-vetted-border hover:border-vetted-text-muted'
              }`}
            >
              <Sheet size={20} className={format === 'excel' ? 'text-accent' : 'text-vetted-text-muted'} />
              <div>
                <div className="text-sm font-medium text-vetted-primary">Excel Spreadsheet</div>
                <div className="text-xs text-vetted-text-muted">Edit tables and export as Excel</div>
              </div>
            </button>
```

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`

1. Open the app, get any AI response (with or without tables)
2. Click the Export button
3. Confirm both Word Document and Excel Spreadsheet options are always visible in the modal
4. Click Excel, then click "Open Editor" — the panel should open (it may show an empty table grid for now; that's fine, Task 2 adds the fallback)

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ExportModal.tsx
git commit -m "feat: always show Excel export option, remove hasTables gate"
```

---

### Task 2: Add text-to-table fallback in ExportPanel

**Files:**
- Modify: `src/components/chat/ExportPanel.tsx:230-251`

- [ ] **Step 1: Add the text fallback logic to the Excel useEffect**

In `src/components/chat/ExportPanel.tsx`, find the `useEffect` that builds table data for Excel mode (lines 231-251). After the existing extraction logic, add a fallback that creates a single-column "Content" table when no markdown tables are found:

```tsx
// BEFORE (lines 231-251):
  useEffect(() => {
    if (format !== 'excel' || !isOpen) return;

    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    let extracted: ParsedTable[] = [];

    if (scope === 'all') {
      for (const msg of assistantMsgs) {
        extracted.push(...extractTables(msg.content));
      }
    } else {
      for (let i = assistantMsgs.length - 1; i >= 0; i--) {
        const t = extractTables(assistantMsgs[i].content);
        if (t.length > 0) {
          extracted = [t[t.length - 1]];
          break;
        }
      }
    }
    setTables(extracted);
  }, [format, scope, messages, isOpen]);

// AFTER:
  useEffect(() => {
    if (format !== 'excel' || !isOpen) return;

    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    let extracted: ParsedTable[] = [];

    if (scope === 'all') {
      for (const msg of assistantMsgs) {
        extracted.push(...extractTables(msg.content));
      }
    } else {
      for (let i = assistantMsgs.length - 1; i >= 0; i--) {
        const t = extractTables(assistantMsgs[i].content);
        if (t.length > 0) {
          extracted = [t[t.length - 1]];
          break;
        }
      }
    }

    // Fallback: no markdown tables found — split text into a single-column table
    if (extracted.length === 0) {
      const msgs = scope === 'last'
        ? [assistantMsgs[assistantMsgs.length - 1]].filter(Boolean)
        : assistantMsgs;
      const rows = msgs
        .flatMap((m) => m.content.split(/\n\n+/))
        .map((para) => para.trim())
        .filter((para) => para.length > 0)
        .map((para) => [para]);
      if (rows.length > 0) {
        extracted = [{ headers: ['Content'], rows }];
      }
    }

    setTables(extracted);
  }, [format, scope, messages, isOpen]);
```

The fallback:
1. Only activates when `extracted` is empty (no markdown tables found)
2. Takes the relevant assistant messages (respecting scope)
3. Splits each message's content on double-newlines into paragraphs
4. Trims and filters empty strings
5. Creates a single `ParsedTable` with header `["Content"]` and one row per paragraph

- [ ] **Step 2: Verify in browser**

Run: `npm run dev`

1. Open the app, send a message that produces an AI response **without** tables (e.g., a plain text answer)
2. Click Export → select Excel Spreadsheet → Open Editor
3. Confirm the panel shows an editable single-column table with header "Content" and one row per paragraph from the response
4. Edit a cell to verify editing works
5. Click "Export to Excel" to verify the download works
6. Now test with a response that **has** markdown tables — confirm the existing table-parsing behavior is unchanged

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ExportPanel.tsx
git commit -m "feat: add text-to-table fallback for Excel export when no tables exist"
```

---

## Verification Checklist

After both tasks are complete, verify these scenarios:

- [ ] Export modal always shows both Word and Excel options regardless of response content
- [ ] Response with markdown tables → Excel editor shows parsed table grid (existing behavior preserved)
- [ ] Response without tables → Excel editor shows single-column "Content" table with paragraphs as rows
- [ ] Word editor is unaffected by these changes
- [ ] Scope radio ("Last" vs "All") works correctly for both table and fallback cases
- [ ] Export to Excel downloads correctly for both table and fallback cases
