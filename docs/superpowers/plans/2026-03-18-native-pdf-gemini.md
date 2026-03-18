# Native PDF Reading via Gemini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `pdf-parse` text extraction with native Gemini inline PDF data so that scanned and image-based PDFs are readable in the main chat.

**Architecture:** Two targeted changes. `readLibraryFile` in `server/index.js` returns base64 binary for PDFs instead of extracted text. `chatWithDocuments` in `server/lib/gemini.js` routes PDF docs as `inlineData` parts in the Gemini request rather than as text in the system context.

**Tech Stack:** Node.js, `@google/genai` SDK (Vertex AI), `fs` (built-in).

**Spec:** `docs/superpowers/specs/2026-03-18-native-pdf-gemini-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `server/index.js` | Modify | `readLibraryFile`: replace `pdf-parse` PDF branch with base64 buffer read |
| `server/lib/gemini.js` | Modify | `chatWithDocuments`: split docs into text/PDF, add `inlineData` parts for PDFs |

---

## Task 1: Replace `readLibraryFile` PDF branch with base64

**File:** `server/index.js` (lines 320–341)

Remove the `pdf-parse` dynamic import entirely. For PDF files, read the raw buffer and return it base64-encoded. Non-PDF files stay exactly the same.

- [ ] **Step 1: Replace `readLibraryFile`**

Find the function starting at line 320:
```js
  // Helper: read a library file from disk → { name, text }
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
```

Replace with:
```js
  // Helper: read a library file from disk.
  // PDFs → { name, mimeType, base64 } for native Gemini vision.
  // Other files → { name, text }.
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

- [ ] **Step 2: Verify the server starts**

```bash
npm run dev:backend
```

Expected: server starts on port 3000 with no import errors or crashes.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: read PDFs as base64 for native Gemini vision instead of pdf-parse"
```

---

## Task 2: Update `chatWithDocuments` to route PDF docs as `inlineData`

**File:** `server/lib/gemini.js` (lines 291–325)

Split the incoming `docs` array into text docs and PDF docs. Text docs continue to go into the system context string. PDF docs are appended as `inlineData` parts in the first user turn's `parts` array — the same pattern already used by `ocrPdf()` in this file.

- [ ] **Step 1: Update `chatWithDocuments`**

Find the function starting at line 291:
```js
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

  for (let i = 1; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    contents.push({ role: msg.role === "user" ? "user" : "model", parts: [{ text: msg.content }] });
  }

  if (chatHistory.length > 0) {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  // Always enable Google Grounding — model decides when to search
  const result = await generate(contents, {}, [{ googleSearch: {} }]);

  for (const q of result.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? []) {
    console.log("[gemini] web search:", q);
  }

  return extractGroundedResponse(result);
}
```

Replace with:
```js
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

  // Build parts for the first user turn: system context + message text, then PDF inline data
  const firstUserParts = [{ text: firstUserText }];
  for (const pdf of pdfDocs) {
    firstUserParts.push({ inlineData: { mimeType: pdf.mimeType, data: pdf.base64 } });
  }

  const contents = [
    { role: "user", parts: firstUserParts },
  ];

  for (let i = 1; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    contents.push({ role: msg.role === "user" ? "user" : "model", parts: [{ text: msg.content }] });
  }

  if (chatHistory.length > 0) {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  // Always enable Google Grounding — model decides when to search
  const result = await generate(contents, {}, [{ googleSearch: {} }]);

  for (const q of result.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? []) {
    console.log("[gemini] web search:", q);
  }

  return extractGroundedResponse(result);
}
```

- [ ] **Step 2: Verify the server starts cleanly**

```bash
npm run dev:backend
```

Expected: starts with no errors.

- [ ] **Step 3: Manual end-to-end test**

With `npm run dev` running at `http://localhost:5173`:

1. Log in as `james.wilson@company.com`
2. Start a new chat
3. Click the paperclip → upload a PDF (use one of the lease PDFs from `uploads/`)
4. After bot acknowledges the file, ask: **"What are the key dates in this document?"**
5. Expected: bot answers with actual content from the PDF, not "the content was not provided"
6. Ask: **"Put the lease details in a grid"**
7. Expected: bot produces a populated markdown table with real data

- [ ] **Step 4: Commit**

```bash
git add server/lib/gemini.js
git commit -m "feat: pass PDFs as inlineData to Gemini for native vision reading"
```
