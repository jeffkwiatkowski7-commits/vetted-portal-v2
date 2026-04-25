# AI-Driven Chat Export (Word & Excel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users say "export this to Excel" / "save as Word" / similar in natural language and get a downloadable `.docx` or `.xlsx` rendered inline in the chat. Files persist as library entries with an explicit "Add to Library" affordance.

**Architecture:** Two new tool definitions (`export_to_word`, `export_to_excel`) are registered into the existing shared tool registry at `server/index.js:710-749`. Both Claude and Gemini chat loops pick them up automatically alongside MCP/Tavily tools. Tool invocations are handled server-side: a new `server/lib/exports.js` builds `.docx`/`.xlsx` Buffers using the already-installed `docx` and `exceljs` packages, saves them as `library_files` rows (with a new `library_visible` flag, default `false` for exports), and references them from `messages.attachments`. The frontend gains a new `MessageAttachment` card that renders inside assistant messages with **Download** and **Add to Library** actions.

**Coexists with existing button-triggered export** (`src/utils/export.ts`, `ExportModal`, `ExportPanel`) — that flow is client-side and stays untouched.

**Tech Stack:** `docx`, `exceljs` (already in package.json), Node/Express, React/TypeScript, SQLite via sql.js

**Spec sources:**
- Investigation findings: see conversation 2026-04-25
- Existing tool loop: `server/index.js:710-749` (registry), `server/lib/claude-direct.js:182-238`, `server/index.js:802-850` (Gemini loop)
- Existing attachment column: `server/database.js:77` (`messages.attachments TEXT`), `server/database.js:109-123` (`library_files` table)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/database.js` | Modify | Add `library_visible INTEGER DEFAULT 1` column to `library_files`; migrate existing rows to `1` |
| `server/lib/exports.js` | Create | `buildDocx(input)` and `buildXlsx(input)` — pure functions returning `{ buffer, mimeType }` |
| `server/index.js` | Modify | Define `export_to_word` / `export_to_excel` declarations; add `builtinToolMap` dispatch; add `library_visible` filter to library endpoints; add `POST /api/library-files/:id/promote` for Add-to-Library |
| `server/lib/claude-direct.js` | Modify | Pass `builtinToolMap` through so the Claude tool loop can resolve the new tools alongside MCP |
| `src/types/index.ts` | Modify | Add `MessageAttachment` type and update `Message.attachments` shape |
| `src/components/chat/MessageAttachment.tsx` | Create | Download card: icon (Word/Excel), filename, Download button, "Add to Library" toggle |
| `src/components/chat/ChatView.tsx` | Modify | Render `MessageAttachment` when a message has attachment metadata |
| `src/api/index.ts` | Modify | Add `promoteFileToLibrary(fileId)` API call |
| `src/pages/LibraryPage.tsx` | Modify | Filter on `library_visible=1` (or add a "Chat exports" tab — TBD during Task 8) |

No new npm dependencies — `docx` and `exceljs` are already installed.

---

### Task 1: Database migration — `library_visible` flag

**Files:**
- Modify: `server/database.js`

**Goal:** Add a boolean column to `library_files` that controls whether the file shows up in the global Library page. Existing rows default to visible (`1`); files generated via AI export default to hidden (`0`) until the user clicks "Add to Library."

- [ ] **Step 1: Add column to schema**

In `server/database.js`, locate the `library_files` table definition (around line 109). Add `library_visible INTEGER DEFAULT 1` to the `CREATE TABLE` statement.

- [ ] **Step 2: Add idempotent migration**

After table creation, add an `ALTER TABLE` that adds the column if it doesn't already exist. Pattern: query `pragma_table_info('library_files')` and conditionally run `ALTER TABLE library_files ADD COLUMN library_visible INTEGER DEFAULT 1`. Existing rows automatically get `1` from the default.

- [ ] **Step 3: Restart and verify**

```bash
# Local: kill dev server, restart
npm run dev
# Verify in SQLite browser or via:
sqlite3 ./data/vetted_portal.db "PRAGMA table_info(library_files);"
```

Expected: `library_visible` appears with default `1`.

- [ ] **Step 4: Commit**

```bash
git add server/database.js
git commit -m "feat: add library_visible flag to library_files for chat exports"
```

---

### Task 2: Server-side export module

**Files:**
- Create: `server/lib/exports.js`

**Goal:** Pure functions that take structured input (matching the shape the AI will pass via tool calls) and return a Buffer plus mime type. Reuses `docx` and `exceljs` patterns from `src/utils/export.ts` but adapts to structured input instead of markdown parsing.

- [ ] **Step 1: Create the module skeleton**

```js
// server/lib/exports.js
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType, TextRun } from 'docx';
import ExcelJS from 'exceljs';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function buildDocx({ title, sections }) {
  // sections: [{ heading?, paragraphs?: string[], bullets?: string[], table?: { headers, rows } }]
  const children = [];
  if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));
  for (const sec of sections || []) {
    if (sec.heading) children.push(new Paragraph({ text: sec.heading, heading: HeadingLevel.HEADING_2 }));
    for (const p of sec.paragraphs || []) children.push(new Paragraph({ children: [new TextRun(p)] }));
    for (const b of sec.bullets || []) children.push(new Paragraph({ text: b, bullet: { level: 0 } }));
    if (sec.table) children.push(buildDocxTable(sec.table));
  }
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  return { buffer, mimeType: DOCX_MIME };
}

export async function buildXlsx({ filename, sheets }) {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets || []) {
    const ws = wb.addWorksheet(sheet.name || 'Sheet1');
    if (sheet.headers?.length) ws.addRow(sheet.headers).font = { bold: true };
    for (const row of sheet.rows || []) ws.addRow(row);
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, mimeType: XLSX_MIME };
}

function buildDocxTable({ headers, rows }) {
  const headerRow = new TableRow({
    children: (headers || []).map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })),
  });
  const bodyRows = (rows || []).map((r) =>
    new TableRow({ children: r.map((cell) => new TableCell({ children: [new Paragraph(String(cell ?? ''))] })) })
  );
  return new Table({ rows: [headerRow, ...bodyRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}
```

- [ ] **Step 2: Smoke test the module standalone**

```bash
node --input-type=module -e "
  import('./server/lib/exports.js').then(async (m) => {
    const { buffer } = await m.buildDocx({ title: 'Test', sections: [{ paragraphs: ['Hello world'] }] });
    console.log('docx ok, bytes:', buffer.length);
    const { buffer: xb } = await m.buildXlsx({ sheets: [{ name: 'S1', headers: ['A','B'], rows: [[1,2]] }] });
    console.log('xlsx ok, bytes:', xb.length);
  });
"
```

Expected: both report nonzero byte counts.

- [ ] **Step 3: Commit**

```bash
git add server/lib/exports.js
git commit -m "feat: server-side docx and xlsx generation for chat exports"
```

---

### Task 3: Tool registration in shared registry

**Files:**
- Modify: `server/index.js` (around lines 710-790 where `allFunctionDeclarations` is built)

**Goal:** Extend the shared tool registry so both Claude and Gemini paths see the two new tools. Add a `builtinToolMap` parallel to `mcpToolMap` so the tool-execution loops can dispatch them.

- [ ] **Step 1: Define the tool declarations**

In `server/index.js`, before `allFunctionDeclarations` is composed, define:

```js
const BUILTIN_EXPORT_TOOLS = [
  {
    name: 'export_to_word',
    description: 'Generate a Microsoft Word (.docx) file from structured content and attach it to the response. Call this when the user asks to export, save as Word, make a doc, etc. Compose the sections from the conversation context.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        filename: { type: 'string', description: 'Suggested filename without extension' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              paragraphs: { type: 'array', items: { type: 'string' } },
              bullets: { type: 'array', items: { type: 'string' } },
              table: {
                type: 'object',
                properties: {
                  headers: { type: 'array', items: { type: 'string' } },
                  rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      required: ['title', 'sections'],
    },
  },
  {
    name: 'export_to_excel',
    description: 'Generate a Microsoft Excel (.xlsx) file from tabular data. Call this when the user asks to export to Excel, spreadsheet, csv, etc. ONLY call when the content has a clear tabular structure; if the source content is prose with no obvious rows/columns, reply asking whether the user prefers Word instead, or offer to restructure the data first.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Suggested filename without extension' },
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              headers: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array' } },
            },
            required: ['headers', 'rows'],
          },
        },
      },
      required: ['filename', 'sheets'],
    },
  },
];
```

- [ ] **Step 2: Merge builtins into `allFunctionDeclarations`**

Locate the line that composes `allFunctionDeclarations` (around line 752). Append `BUILTIN_EXPORT_TOOLS` to the array alongside MCP and Tavily.

- [ ] **Step 3: Add `builtinToolMap` and the dispatch handler**

Define a map keyed by tool name → async handler that:
1. Generates the buffer via `buildDocx`/`buildXlsx`
2. Saves it to `data/uploads/exports/<uuid>.{docx,xlsx}`
3. Inserts a `library_files` row with `library_visible=0`, `chat_id=<current chat>`, filename, mime, path
4. Returns a tool-result payload of shape `{ status: 'ok', file_id, filename, download_url }`

The existing pattern in `mcp-manager.js:74-90` (`callTool`) is the model — emit a stringified text result the model can read.

- [ ] **Step 4: Wire into Gemini tool loop**

In the Gemini loop (around lines 821-834), where the code currently checks `mcpToolMap[name]`, add a fallback to `builtinToolMap[name]` before the unknown-tool error.

- [ ] **Step 5: Wire into Claude tool loop**

Pass `builtinToolMap` into `claude-direct.js` chat handler (a new arg). In the loop at lines 221-234, do the same fallback dispatch.

- [ ] **Step 6: Append the file_id to `messages.attachments`**

When a builtin tool runs and produces a file, the chat handler should accumulate the resulting `library_files.id` so it's appended to the assistant message's `attachments` JSON when the message is persisted. The current message-save code path is at `server/index.js:436,473` — find where the assistant turn is written and merge in any new export file IDs.

- [ ] **Step 7: Commit**

```bash
git add server/index.js server/lib/claude-direct.js
git commit -m "feat: register export_to_word and export_to_excel builtin tools"
```

---

### Task 4: Manual end-to-end smoke test (server only)

**Files:** none (manual test)

- [ ] **Step 1: Restart dev server**

```bash
npm run dev
```

- [ ] **Step 2: Trigger via real chat**

In the UI, send: "export the last response as Excel" after an assistant message that contains a markdown table.

- [ ] **Step 3: Verify**

- Check server logs for the tool invocation
- Check `data/uploads/exports/` — file should exist
- Check SQLite: `SELECT id, filename, library_visible, chat_id FROM library_files WHERE chat_id IS NOT NULL ORDER BY created_at DESC LIMIT 5;`
- Open the file from disk to confirm it's a valid `.xlsx`

- [ ] **Step 4: Test prose case**

Send "export to excel" after a *prose* assistant response (no table). The model should refuse or restructure rather than producing junk. If it produces junk, tighten the tool description and re-test.

- [ ] **Step 5: Test Word path**

Send "save this as a Word doc". Verify `.docx` is generated.

---

### Task 5: Frontend types and download endpoint

**Files:**
- Modify: `src/types/index.ts`
- Modify: `server/index.js` (download endpoint)

- [ ] **Step 1: Confirm or add `GET /api/library-files/:id/download`**

Search `server/index.js` for existing download endpoints. If a generic library-file download exists, reuse it. Otherwise add one that streams the file with `Content-Type` from the row and `Content-Disposition: attachment; filename="..."`.

- [ ] **Step 2: Update Message type**

In `src/types/index.ts`, change `attachments?: string` to a proper shape:

```ts
export interface MessageAttachment {
  id: string;
  filename: string;
  mime_type: string;
  library_visible: boolean;
}

export interface Message {
  // ...
  attachments?: MessageAttachment[] | null;
}
```

- [ ] **Step 3: Update message read path**

In `server/index.js:379` (the `attachments: m.attachments ? JSON.parse(m.attachments) : null` line), change so the API returns hydrated attachment objects (id + filename + mime + library_visible) by joining against `library_files`, not just an array of IDs. This is what the frontend will render.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts server/index.js
git commit -m "feat: hydrate message attachments with file metadata for rendering"
```

---

### Task 6: `MessageAttachment` component

**Files:**
- Create: `src/components/chat/MessageAttachment.tsx`

- [ ] **Step 1: Build the card**

Card layout:
- Word icon (lucide `FileText`) or Excel icon (lucide `Sheet`), color-coded
- Filename
- "Download" button → triggers `GET /api/library-files/:id/download` (use a hidden anchor with `download` attribute for proper filename)
- "Add to Library" button if `library_visible === false`; replaced by a small "✓ In Library" badge once promoted

State: `useState` for in-flight promotion. On click, call `api.promoteFileToLibrary(id)`, then update the card optimistically.

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/MessageAttachment.tsx
git commit -m "feat: MessageAttachment card component for inline chat downloads"
```

---

### Task 7: Render attachments in `ChatView`

**Files:**
- Modify: `src/components/chat/ChatView.tsx`

- [ ] **Step 1: Render the card**

Find the assistant message rendering block (`ChatView.tsx:367-379` is where images render today). Below the message content, conditionally render:

```tsx
{msg.attachments?.length > 0 && (
  <div className="mt-3 space-y-2">
    {msg.attachments.map((a) => <MessageAttachment key={a.id} attachment={a} />)}
  </div>
)}
```

- [ ] **Step 2: Manual test in browser**

Restart dev. Trigger an export via natural language. Confirm the card appears under the assistant message, downloads work, "Add to Library" button toggles.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatView.tsx
git commit -m "feat: render attachment cards under assistant messages"
```

---

### Task 8: "Add to Library" endpoint and Library page filter

**Files:**
- Modify: `server/index.js` (new `POST /api/library-files/:id/promote`)
- Modify: `src/api/index.ts` (new `promoteFileToLibrary`)
- Modify: `src/pages/LibraryPage.tsx`

- [ ] **Step 1: Add promote endpoint**

```js
app.post('/api/library-files/:id/promote', requireAuth, (req, res) => {
  const { id } = req.params;
  db.run('UPDATE library_files SET library_visible = 1 WHERE id = ? AND user_id = ?', [id, req.user.id]);
  saveDatabase();
  res.json({ ok: true });
});
```

- [ ] **Step 2: Add API client method**

In `src/api/index.ts`, add `promoteFileToLibrary(id: string)` calling the endpoint.

- [ ] **Step 3: Filter Library page**

Find the existing library list query in `server/index.js`. Add `WHERE library_visible = 1` so chat exports don't appear until promoted. Decide during this task whether to also add a "Chat exports" tab on the Library page or keep them invisible until promoted (recommend: invisible-until-promoted for v1, simpler).

- [ ] **Step 4: Manual test**

Trigger an export, click "Add to Library", navigate to Library page, confirm the file appears.

- [ ] **Step 5: Commit**

```bash
git add server/index.js src/api/index.ts src/pages/LibraryPage.tsx
git commit -m "feat: Add to Library promotion for chat-export files"
```

---

### Task 9: Deploy

- [ ] **Step 1: Push to main**

```bash
git push
```

- [ ] **Step 2: Deploy to VM**

User SSHes into the VM (per `reference_vm_deployment` memory):

```bash
cd /opt/vetted-portal
sudo git pull
sudo npm run build
sudo systemctl restart vetted-portal
```

- [ ] **Step 3: Verify in production**

Trigger an export in the deployed app. Confirm download works, "Add to Library" works.

---

## Out of scope (Phase 3 / future)

- Cleanup job for orphaned exports (files never promoted, older than 30 days)
- Multi-sheet Excel for responses with multiple tables (model can already pass multiple `sheets`, but UX hint not yet given)
- Charts/images embedded in Word
- "Export this whole conversation" via natural language (would need a tool that traverses all messages)
- Telemetry/analytics on which tools fire most often

---

## Open risks

1. **Gemini tool schema differences.** The shared registry already adapts MCP tools across SDKs (`server/index.js:761-785`), but the new tools' schemas should be tested against Gemini specifically — Gemini's `OpenAPI`-style schema is stricter than Anthropic's. If Gemini chokes on nested objects, may need to flatten.
2. **Empty/garbage tool input.** If the model invokes `export_to_excel` with `rows: []`, we still produce an empty file. Add a server-side guard that returns an error tool result if the input is empty, prompting the model to retry with content.
3. **File ownership on promote.** The promote endpoint scopes to `user_id = req.user.id`, but the export-creation step needs to set `user_id` correctly when inserting the `library_files` row. Double-check this in Task 3 Step 3.
