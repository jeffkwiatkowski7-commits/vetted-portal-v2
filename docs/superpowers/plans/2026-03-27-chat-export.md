# Chat Export (Word & Excel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users export chat conversations as Word documents or extract markdown tables as Excel spreadsheets, all client-side.

**Architecture:** Two new npm packages (`docx`, `exceljs`) handle document generation in the browser. A utility module (`src/utils/export.ts`) contains all parsing/generation logic. A reusable `ExportModal` component presents format/scope options. The export button is added to `MainChatPage` (in the messages area) and `ProjectDetailPage` (in the header bar).

**Tech Stack:** `docx` (Word generation), `exceljs` (Excel generation), React, TypeScript, Tailwind CSS

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install docx and exceljs**

Run: `npm install docx exceljs`

- [ ] **Step 2: Verify installation**

Run: `node -e "require('docx'); require('exceljs'); console.log('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

Stage `package.json` and `package-lock.json`, commit with message: `chore: add docx and exceljs dependencies for chat export`

---

### Task 2: Export Utilities — Table Detection & Excel Export

**Files:**
- Create: `src/utils/export.ts`

This task builds the markdown table parser and Excel export. We define a minimal message interface that works with both `ChatMessage` (MainChatPage local type) and `Message` (global type from `src/types/index.ts`).

- [ ] **Step 1: Create `src/utils/export.ts` with table detection and Excel export**

```typescript
import ExcelJS from 'exceljs';

// Minimal interface — works with both local ChatMessage and global Message types
export interface ExportableMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;    // MainChatPage local ChatMessage
  created_at?: string;   // Global Message type
}

// ── Table detection ──────────────────────────────────────────────────────────

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Returns true if any assistant message contains a markdown table.
 */
export function hasMarkdownTables(messages: ExportableMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'assistant' && extractTables(m.content).length > 0
  );
}

/**
 * Extract all markdown tables from a string.
 * A table is consecutive lines starting with `|` that include a separator row (--|--).
 */
function extractTables(text: string): ParsedTable[] {
  const lines = text.split('\n');
  const tables: ParsedTable[] = [];
  let block: string[] = [];

  const flushBlock = () => {
    if (block.length < 3) { block = []; return; }
    const sepIdx = block.findIndex((l) => /^\|[\s\-:|]+\|$/.test(l.trim()));
    if (sepIdx < 1) { block = []; return; }

    const parseRow = (line: string): string[] =>
      line.split('|').slice(1, -1).map((c) => c.trim());

    const headers = parseRow(block[sepIdx - 1]);
    const rows: string[][] = [];
    for (let i = sepIdx + 1; i < block.length; i++) {
      const cells = parseRow(block[i]);
      if (cells.length > 0) rows.push(cells);
    }
    if (headers.length > 0 && rows.length > 0) {
      tables.push({ headers, rows });
    }
    block = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      block.push(line);
    } else {
      flushBlock();
    }
  }
  flushBlock();
  return tables;
}

// ── Excel export ─────────────────────────────────────────────────────────────

/**
 * Export markdown tables from messages as an .xlsx file.
 * scope='last' -> only the last table from the last assistant message that has one.
 * scope='all'  -> all tables across all assistant messages.
 */
export async function exportToExcel(
  messages: ExportableMessage[],
  scope: 'last' | 'all',
  chatTitle: string
): Promise<void> {
  const assistantMsgs = messages.filter((m) => m.role === 'assistant');
  let tables: ParsedTable[] = [];

  if (scope === 'all') {
    for (const msg of assistantMsgs) {
      tables.push(...extractTables(msg.content));
    }
  } else {
    for (let i = assistantMsgs.length - 1; i >= 0; i--) {
      const t = extractTables(assistantMsgs[i].content);
      if (t.length > 0) {
        tables = [t[t.length - 1]];
        break;
      }
    }
  }

  if (tables.length === 0) return;

  const workbook = new ExcelJS.Workbook();

  tables.forEach((table, idx) => {
    const sheet = workbook.addWorksheet(`Table ${idx + 1}`);

    const headerRow = sheet.addRow(table.headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F0E6' },
      };
    });

    for (const row of table.rows) {
      sheet.addRow(row);
    }

    sheet.columns.forEach((col) => {
      let maxLen = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 50);
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${sanitizeFilename(chatTitle)}-tables.xlsx`
  );
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '-') || 'chat-export';
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx vite build 2>&1 | tail -5`

Expected: build succeeds (or at least no errors from export.ts).

- [ ] **Step 3: Commit**

Stage `src/utils/export.ts`, commit with message: `feat: add table detection and Excel export utility`

---

### Task 3: Export Utilities — Word Export

**Files:**
- Modify: `src/utils/export.ts`

- [ ] **Step 1: Add Word export to `src/utils/export.ts`**

Add these imports at the top of the file, below the ExcelJS import:

```typescript
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';
```

Add the following functions before the `// ── Shared helpers` section:

```typescript
// ── Word export ──────────────────────────────────────────────────────────────

/**
 * Export messages as a .docx Word document.
 * scope='last' -> only the last assistant message.
 * scope='all'  -> entire conversation with role labels and timestamps.
 */
export async function exportToWord(
  messages: ExportableMessage[],
  scope: 'last' | 'all',
  chatTitle: string
): Promise<void> {
  const children: (Paragraph | Table)[] = [];

  // Title
  children.push(
    new Paragraph({
      text: chatTitle,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  const exportMessages =
    scope === 'last'
      ? [messages.filter((m) => m.role === 'assistant').pop()].filter(Boolean) as ExportableMessage[]
      : messages;

  for (const msg of exportMessages) {
    if (scope === 'all') {
      const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
      const time = msg.timestamp || msg.created_at || '';
      const labelRuns: TextRun[] = [
        new TextRun({ text: roleLabel, bold: true, size: 22 }),
      ];
      if (time) {
        labelRuns.push(
          new TextRun({ text: `  ${new Date(time).toLocaleString()}`, color: '888888', size: 18 })
        );
      }
      children.push(new Paragraph({ children: labelRuns, spacing: { before: 300, after: 100 } }));
    }

    children.push(...markdownToDocx(msg.content));
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${sanitizeFilename(chatTitle)}-export.docx`);
}

/**
 * Convert markdown text to an array of docx Paragraph/Table elements.
 * Handles: headings, bold/italic, bullet lists, numbered lists, tables, code blocks, plain text.
 */
function markdownToDocx(text: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: codeLines.join('\n'),
              font: 'JetBrains Mono',
              size: 18,
            }),
          ],
          shading: { type: 'clear' as any, color: 'auto', fill: 'F5F5F5' },
          spacing: { before: 100, after: 100 },
        })
      );
      continue;
    }

    // Markdown table block
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const parsed = parseTableBlock(tableLines);
      if (parsed) {
        elements.push(buildDocxTable(parsed));
      }
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
      };
      elements.push(
        new Paragraph({
          text: headingMatch[2],
          heading: headingMap[level] || HeadingLevel.HEADING_4,
          spacing: { before: 200, after: 100 },
        })
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(line.replace(/^\s*[-*]\s+/, '')),
          bullet: { level: 0 },
          spacing: { before: 40, after: 40 },
        })
      );
      i++;
      continue;
    }

    // Numbered list
    const numberedMatch = line.match(/^\s*\d+\.\s+(.*)/);
    if (numberedMatch) {
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(numberedMatch[1]),
          numbering: { reference: 'default-numbering', level: 0 },
          spacing: { before: 40, after: 40 },
        })
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Plain text paragraph
    elements.push(
      new Paragraph({
        children: parseInlineFormatting(line),
        spacing: { before: 60, after: 60 },
      })
    );
    i++;
  }

  return elements;
}

/**
 * Parse inline markdown formatting (bold, italic, bold+italic, inline code) into TextRun[].
 */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], bold: true }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true }));
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], font: 'JetBrains Mono', size: 18 }));
    } else if (match[6]) {
      runs.push(new TextRun({ text: match[6] }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
}

/**
 * Parse a block of table lines into headers + rows.
 */
function parseTableBlock(lines: string[]): ParsedTable | null {
  const sepIdx = lines.findIndex((l) => /^\|[\s\-:|]+\|$/.test(l.trim()));
  if (sepIdx < 1) return null;

  const parseRow = (line: string): string[] =>
    line.split('|').slice(1, -1).map((c) => c.trim());

  const headers = parseRow(lines[sepIdx - 1]);
  const rows: string[][] = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const cells = parseRow(lines[i]);
    if (cells.length > 0) rows.push(cells);
  }
  return headers.length > 0 && rows.length > 0 ? { headers, rows } : null;
}

/**
 * Build a docx Table from parsed table data.
 */
function buildDocxTable(table: ParsedTable): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: table.headers.map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
          shading: { type: 'clear' as any, color: 'auto', fill: 'F5F0E6' },
        })
    ),
  });

  const dataRows = table.rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ text: cell })],
            })
        ),
      })
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

Expected: build succeeds.

- [ ] **Step 3: Commit**

Stage `src/utils/export.ts`, commit with message: `feat: add Word export with markdown-to-docx conversion`

---

### Task 4: ExportModal Component

**Files:**
- Create: `src/components/chat/ExportModal.tsx`

- [ ] **Step 1: Create `src/components/chat/ExportModal.tsx`**

```typescript
import React, { useState, useMemo } from 'react';
import { X, FileText, Sheet } from 'lucide-react';
import {
  ExportableMessage,
  hasMarkdownTables,
  exportToWord,
  exportToExcel,
} from '../../utils/export';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ExportableMessage[];
  chatTitle: string;
}

export default function ExportModal({ isOpen, onClose, messages, chatTitle }: ExportModalProps) {
  const [format, setFormat] = useState<'word' | 'excel'>('word');
  const [scope, setScope] = useState<'last' | 'all'>('last');
  const [exporting, setExporting] = useState(false);

  const hasTables = useMemo(() => hasMarkdownTables(messages), [messages]);

  if (!isOpen) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      if (format === 'word') {
        await exportToWord(messages, scope, chatTitle);
      } else {
        await exportToExcel(messages, scope, chatTitle);
      }
    } finally {
      setExporting(false);
      onClose();
    }
  };

  const wordScopeLabel = { last: 'Last AI response only', all: 'Entire conversation' };
  const excelScopeLabel = { last: 'Last table only', all: 'All tables' };
  const scopeLabels = format === 'word' ? wordScopeLabel : excelScopeLabel;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-serif text-vetted-primary">Choose Export Format</h2>
            <p className="text-xs text-vetted-text-muted mt-0.5">
              Select the format you want to export your conversation to
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-vetted-surface rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-4">
          {/* Format selection */}
          <div className="space-y-2">
            {/* Word option */}
            <button
              onClick={() => { setFormat('word'); setScope('last'); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                format === 'word'
                  ? 'border-accent bg-accent/5'
                  : 'border-vetted-border hover:border-vetted-text-muted'
              }`}
            >
              <FileText size={20} className={format === 'word' ? 'text-accent' : 'text-vetted-text-muted'} />
              <div>
                <div className="text-sm font-medium text-vetted-primary">Word Document</div>
                <div className="text-xs text-vetted-text-muted">Export as editable Word document</div>
              </div>
            </button>

            {/* Excel option — only when tables exist */}
            {hasTables && (
              <button
                onClick={() => { setFormat('excel'); setScope('last'); }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                  format === 'excel'
                    ? 'border-accent bg-accent/5'
                    : 'border-vetted-border hover:border-vetted-text-muted'
                }`}
              >
                <Sheet size={20} className={format === 'excel' ? 'text-accent' : 'text-vetted-text-muted'} />
                <div>
                  <div className="text-sm font-medium text-vetted-primary">Excel Spreadsheet</div>
                  <div className="text-xs text-vetted-text-muted">Export tables as Excel spreadsheet</div>
                </div>
              </button>
            )}
          </div>

          {/* Scope radio */}
          <div className="flex items-center gap-4 pl-1">
            {(['last', 'all'] as const).map((val) => (
              <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value={val}
                  checked={scope === val}
                  onChange={() => setScope(val)}
                  className="accent-accent"
                />
                <span className="text-xs text-vetted-text-secondary">{scopeLabels[val]}</span>
              </label>
            ))}
          </div>

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx vite build 2>&1 | tail -5`

Expected: build succeeds.

- [ ] **Step 3: Commit**

Stage `src/components/chat/ExportModal.tsx`, commit with message: `feat: add ExportModal component for chat export`

---

### Task 5: Add Export Button to MainChatPage

**Files:**
- Modify: `src/pages/MainChatPage.tsx`

The MainChatPage doesn't have a header bar — messages scroll full-height. We'll add a floating export button in the top-right of the messages area, visible only when messages exist.

- [ ] **Step 1: Add import and state**

At the top of `src/pages/MainChatPage.tsx`, add the `Download` icon to the existing lucide import (line 3):

Change:
```typescript
import { Send, Loader2, Paperclip, X, ChevronDown, ChevronUp, Check } from 'lucide-react';
```
To:
```typescript
import { Send, Loader2, Paperclip, X, ChevronDown, ChevronUp, Check, Download } from 'lucide-react';
```

Add the ExportModal import below the LibraryPickerModal import (after line 4):

```typescript
import ExportModal from '../components/chat/ExportModal';
```

Inside `MainChatPage()` function, after the `const [modelOpen, setModelOpen] = useState(false);` line (line 335), add:

```typescript
const [exportOpen, setExportOpen] = useState(false);
```

- [ ] **Step 2: Add the ExportModal and floating button to the JSX**

In the return JSX, find the active-messages branch (around line 587, the `<>` after the ternary). Replace this block:

```typescript
        <>
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-[75%] mx-auto px-6 py-8 space-y-6">
              {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
              <div ref={messagesEndRef} />
            </div>
          </div>
          <div className="px-4 pb-4 pt-2">
            <div className="max-w-[75%] mx-auto px-6">
              {inputCard}
            </div>
          </div>
        </>
```

With:

```typescript
        <>
          <ExportModal
            isOpen={exportOpen}
            onClose={() => setExportOpen(false)}
            messages={messages}
            chatTitle={chats.find(c => c.id === chatId)?.title || 'Chat Export'}
          />
          <div className="flex-1 overflow-y-auto relative">
            {/* Export button — top-right of messages area */}
            <button
              onClick={() => setExportOpen(true)}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-lg border border-vetted-border bg-white/80 backdrop-blur-sm text-vetted-text-muted hover:text-vetted-primary hover:border-vetted-primary transition-colors"
              title="Export conversation"
            >
              <Download size={15} />
            </button>
            <div className="max-w-[75%] mx-auto px-6 py-8 space-y-6">
              {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
              <div ref={messagesEndRef} />
            </div>
          </div>
          <div className="px-4 pb-4 pt-2">
            <div className="max-w-[75%] mx-auto px-6">
              {inputCard}
            </div>
          </div>
        </>
```

- [ ] **Step 3: Verify build and manual test**

Run: `npx vite build 2>&1 | tail -5`

Then `npm run dev` and verify:
1. Chat with messages -> export button appears top-right
2. Click it -> modal opens
3. New/empty chat -> no export button visible

- [ ] **Step 4: Commit**

Stage `src/pages/MainChatPage.tsx`, commit with message: `feat: add export button to MainChatPage`

---

### Task 6: Add Export Button to ProjectDetailPage

**Files:**
- Modify: `src/pages/ProjectDetailPage.tsx`

The ProjectDetailPage has a slim header bar. We add the export button between the project name and the settings gear, visible only when a chat exists.

- [ ] **Step 1: Add imports**

At the top of `src/pages/ProjectDetailPage.tsx`, add `Download` to the lucide import. Find the existing lucide import line and add `Download` to it.

Add the ExportModal import:

```typescript
import ExportModal from '../components/chat/ExportModal';
```

- [ ] **Step 2: Add state and store access**

Inside the component function, add:

```typescript
const [exportOpen, setExportOpen] = useState(false);
```

The project page uses `ChatView` which reads from `activeChat` in the Zustand store. We need access to `activeChat` for the export modal. Find the existing store destructure and add `activeChat`:

```typescript
const { activeChat } = useStore();
```

(If `useStore` is not already imported, add it. If the component already destructures from `useStore`, just add `activeChat` to the existing destructure.)

- [ ] **Step 3: Add ExportModal and button to the header**

Add the ExportModal just inside the return's root `<div>`, before the header:

```typescript
<ExportModal
  isOpen={exportOpen}
  onClose={() => setExportOpen(false)}
  messages={(activeChat?.messages || []) as any}
  chatTitle={activeChat?.title || project?.name || 'Project Export'}
/>
```

In the header bar (the `<div className="flex items-center gap-3 px-6 py-3 border-b ...">`) , add the export button right before the settings button — between the `<span>` (project name) and the settings `<button>`:

```typescript
{hasChat && activeChat?.messages && activeChat.messages.length > 0 && (
  <button
    onClick={() => setExportOpen(true)}
    className="p-1 hover:bg-vetted-surface rounded transition-colors"
    title="Export conversation"
  >
    <Download size={15} className="text-vetted-text-secondary" />
  </button>
)}
```

- [ ] **Step 4: Verify build and manual test**

Run: `npx vite build 2>&1 | tail -5`

Then `npm run dev` and verify:
1. Project with a chat -> export button visible in header
2. Project with no chat -> no export button

- [ ] **Step 5: Commit**

Stage `src/pages/ProjectDetailPage.tsx`, commit with message: `feat: add export button to ProjectDetailPage header`

---

### Task 7: Bump Sidebar Version

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx:211`

- [ ] **Step 1: Update version number**

In `src/components/sidebar/Sidebar.tsx`, find line 211:

```typescript
<p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.4.0</p>
```

Change to:

```typescript
<p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.5.0</p>
```

- [ ] **Step 2: Commit**

Stage `src/components/sidebar/Sidebar.tsx`, commit with message: `chore: bump sidebar version to v1.5.0`

---

### Task 8: End-to-End Manual Verification

No files modified — this is a verification pass.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test Word export — last response**

1. Log in as `admin@vetted.com`
2. Open or create a chat with at least 2 messages
3. Click the download button (top-right)
4. Select "Word Document" -> "Last AI response only" -> Export
5. Open the downloaded `.docx` file — should contain only the last assistant message

- [ ] **Step 3: Test Word export — entire conversation**

1. Same chat -> Export button -> "Word Document" -> "Entire conversation" -> Export
2. Open `.docx` — should have "You" and "Assistant" labels with timestamps for each message

- [ ] **Step 4: Test Excel export — with tables**

1. Ask the AI a question that produces a markdown table (e.g., "Give me a comparison table of...")
2. Export button -> "Excel Spreadsheet" option should now appear
3. Select Excel -> "Last table only" -> Export
4. Open `.xlsx` — should have one sheet "Table 1" with the table data, bold headers

- [ ] **Step 5: Test Excel export — all tables**

1. Same chat with multiple table responses -> Export -> Excel -> "All tables" -> Export
2. Open `.xlsx` — should have multiple sheets

- [ ] **Step 6: Test Excel hidden when no tables**

1. Open a chat that has no markdown tables
2. Export button -> modal should only show Word option, no Excel

- [ ] **Step 7: Test ProjectDetailPage export**

1. Navigate to a project with an active chat
2. Export button should appear in the header bar
3. Export Word -> verify it works

- [ ] **Step 8: Production build check**

Run: `npm run build`

Expected: builds without errors.
