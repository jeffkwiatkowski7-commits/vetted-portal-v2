# Chat Export — Word & Excel

## Overview

Add export functionality to main chat and project chat, allowing users to download conversations as Word documents or extract tables as Excel spreadsheets. All export logic runs client-side — no backend changes required.

## Export Button

A download icon button in the top-right of the chat area:
- **MainChatPage.tsx** — next to existing header controls
- **ProjectDetailPage.tsx** — in the header bar, near the settings icon

Button is only visible when messages exist in the conversation.

## Export Modal

Triggered by the export button. A centered modal with dark overlay matching existing modal patterns.

### Structure

```
Choose Export Format
Select the format you want to export your conversation to

  [doc icon] Word Document
             Export as editable Word document

  [sheet icon] Excel Spreadsheet          ← only shown when tables exist
               Export tables as Excel spreadsheet

  --- scope radio (changes per format) ---

  Word:   ( ) Last AI response only   ( ) Entire conversation
  Excel:  ( ) Last table only          ( ) All tables

  [ Export ]   ← gold accent button
```

### Behavior

- Default selection: Word Document
- Excel option only rendered when `hasMarkdownTables(messages)` returns true
- Radio defaults: "Last AI response only" for Word, "Last table only" for Excel
- Clicking Export triggers download and closes modal

## Export Utilities — `src/utils/export.ts`

### `hasMarkdownTables(messages: ChatMessage[]): boolean`

Scans assistant messages for markdown table syntax (lines with `|` column separators and `---` header dividers).

### `exportToWord(messages: ChatMessage[], scope: 'last' | 'all'): void`

Uses the `docx` npm package to build a .docx file.

- **scope = 'last'**: Exports only the last assistant message
- **scope = 'all'**: Exports all messages with role labels ("You" / "Assistant") and timestamps

Content conversion from markdown to docx elements:
- Headings → Heading paragraphs
- Bold/italic → formatted runs
- Bullet/numbered lists → list items
- Tables → docx tables
- Code blocks → monospace paragraphs
- Plain text → normal paragraphs

File saved as `{chat-title}-export.docx` via browser download.

### `exportToExcel(messages: ChatMessage[], scope: 'last' | 'all'): void`

Uses the `exceljs` npm package to build an .xlsx file.

- **scope = 'last'**: Extracts last markdown table from the last assistant message containing one
- **scope = 'all'**: Extracts all markdown tables across all assistant messages

Table parsing:
1. Split message content by lines
2. Identify table blocks (consecutive lines starting with `|`)
3. Parse header row and data rows by splitting on `|`
4. Skip separator rows (`---`)

Each table gets its own worksheet named "Table 1", "Table 2", etc. Header row is bold.

File saved as `{chat-title}-tables.xlsx` via browser download.

## New Component — `src/components/chat/ExportModal.tsx`

### Props

```typescript
interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  chatTitle: string;
}
```

### State

- `format: 'word' | 'excel'` — selected format (default: 'word')
- `scope: 'last' | 'all'` — content scope (default: 'last')
- `hasTables: boolean` — computed from messages on mount

## Styling

- Modal card: white background, rounded-xl, shadow, max-w-md
- Format options: bordered cards with icon, title, subtitle; highlighted border on selection
- Radio buttons: standard form radios with labels
- Export button: gold accent (`bg-accent`), full-width, rounded
- Close button: X in top-right corner of modal

## Dependencies

New npm packages:
- `docx` — Word document generation
- `file-saver` — browser file download trigger (used by docx)
- `exceljs` — Excel spreadsheet generation
