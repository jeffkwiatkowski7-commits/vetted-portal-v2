# Native PDF Reading via Gemini — Design Spec

**Date:** 2026-03-18
**Branch:** vetted_leases
**Status:** Approved

---

## Problem

The main chat's `readLibraryFile` helper uses `pdf-parse` to extract text from PDFs before sending to Gemini. `pdf-parse` fails silently on scanned or image-based PDFs, returning empty text. Gemini then says "the content was not provided" and cannot answer questions about the document.

## Solution

Pass PDFs directly to Gemini as base64 inline data (native vision). Gemini reads all PDF types — text-based, scanned, mixed — natively. One call, no pre-extraction step.

---

## Data Model

`readLibraryFile` returns one of two shapes depending on file type:

**Text files (non-PDF):** unchanged
```js
{ name: string, text: string }
```

**PDF files:** new shape
```js
{ name: string, mimeType: 'application/pdf', base64: string }
```

`base64` is the raw file buffer encoded as a base64 string (`buffer.toString('base64')`).

---

## Component Changes

### `server/index.js` — `readLibraryFile`

Replace the PDF branch entirely. Remove the `pdf-parse` import call. Read the file as a buffer and base64-encode it:

```js
// Before
async function readLibraryFile(file) {
  const filePath = path.join(__dirname, '..', file.file_path);
  let text = '';
  if (file.file_type === 'pdf' || file.mime_type === 'application/pdf') {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(buffer);
      text = parsed.text || '';
    } catch {
      text = `[Could not extract text from ${file.original_name}]`;
    }
  } else {
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      text = `[Could not read ${file.original_name}]`;
    }
  }
  return { name: file.original_name, text };
}

// After
async function readLibraryFile(file) {
  const filePath = path.join(__dirname, '..', file.file_path);
  if (file.file_type === 'pdf' || file.mime_type === 'application/pdf') {
    try {
      const buffer = fs.readFileSync(filePath);
      return { name: file.original_name, mimeType: 'application/pdf', base64: buffer.toString('base64') };
    } catch {
      return { name: file.original_name, text: `[Could not read ${file.original_name}]` };
    }
  } else {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      return { name: file.original_name, text };
    } catch {
      return { name: file.original_name, text: `[Could not read ${file.original_name}]` };
    }
  }
}
```

No other changes to `server/index.js`. The `docs` array is built and passed to `chatWithDocuments` exactly as before.

---

### `server/lib/gemini.js` — `chatWithDocuments`

Update to handle both doc shapes. Text docs go into the system context string as before. PDF docs become `inlineData` parts in the first user message's `parts` array — the same pattern `ocrPdf` uses.

```js
// Before
export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null) {
  const docContext = docs.length > 0
    ? docs.map((d, i) => `\n--- DOCUMENT ${i + 1}: ${d.name} ---\n${d.text}\n`).join("\n")
    : "";

  const basePrompt = systemPromptOverride ?? buildDefaultSystemPrompt();
  const systemPrompt = docContext
    ? `${basePrompt}\n\n## Attached Documents\n${docContext}`
    : basePrompt;

  const contents = [
    {
      role: "user",
      parts: [{ text: `[SYSTEM CONTEXT]\n${systemPrompt}\n\n[USER MESSAGE]\n${chatHistory.length === 0 ? userMessage : chatHistory[0].content}` }],
    },
  ];
  // ... rest unchanged
}

// After
export async function chatWithDocuments(docs, userMessage, chatHistory = [], systemPromptOverride = null) {
  const textDocs = docs.filter((d) => d.text !== undefined);
  const pdfDocs = docs.filter((d) => d.base64 !== undefined);

  const docContext = textDocs.length > 0
    ? textDocs.map((d, i) => `\n--- DOCUMENT ${i + 1}: ${d.name} ---\n${d.text}\n`).join("\n")
    : "";

  const basePrompt = systemPromptOverride ?? buildDefaultSystemPrompt();
  const systemPrompt = docContext
    ? `${basePrompt}\n\n## Attached Documents\n${docContext}`
    : basePrompt;

  const firstUserText = `[SYSTEM CONTEXT]\n${systemPrompt}\n\n[USER MESSAGE]\n${chatHistory.length === 0 ? userMessage : chatHistory[0].content}`;

  // Build parts for the first user turn: text first, then PDF inline data
  const firstUserParts = [{ text: firstUserText }];
  for (const pdf of pdfDocs) {
    firstUserParts.push({ inlineData: { mimeType: pdf.mimeType, data: pdf.base64 } });
  }

  const contents = [
    { role: "user", parts: firstUserParts },
  ];

  // ... rest of history building and generate call unchanged
}
```

The `generate` call, history building, Google Search grounding, and `extractGroundedResponse` are all unchanged.

---

## What Does Not Change

- The `docs` array construction in `server/index.js` (project files + per-message attachments)
- `chatWithDocuments` function signature
- The `generate` function in `gemini.js`
- History building and grounding logic
- All other file types (text, markdown, etc.) — text path unchanged
- Frontend — no changes

---

## Files Touched

| File | Change |
|------|--------|
| `server/index.js` | Replace PDF branch in `readLibraryFile`: base64 instead of pdf-parse |
| `server/lib/gemini.js` | Update `chatWithDocuments` to route PDF docs as `inlineData` parts |
