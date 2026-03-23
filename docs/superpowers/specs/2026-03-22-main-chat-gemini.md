# Main Chat Gemini — Design Spec

**Date:** 2026-03-22
**Status:** Draft

---

## Goal

Replace the mock/demo primary chat at `/` and `/chat/:id` with a real Gemini-powered general-purpose chat that SSE-streams responses with progress steps and supports file attachments. The lease chat UX (SSE streaming, progress steps, markdown rendering) is already built in `LeaseChatPage.tsx` — this work generalizes exactly that pattern into the primary chat experience.

---

## Scope

| File | Change |
|---|---|
| `src/pages/MainChatPage.tsx` | **New** — full-width Gemini chat with SSE, steps panel, file upload |
| `src/App.tsx` | Replace `ChatPage` at `/` and `/chat/:id` with `MainChatPage` |
| `server/index.js` | Add `POST /api/chat/upload` endpoint |
| `src/components/sidebar/Sidebar.tsx` | Bump version to `v1.2.0` |
| `server/lib/gemini.js` | No changes |
| `src/pages/LeaseChatPage.tsx` | No changes — `/leases` route stays as-is |

---

## Architecture

```
[User types + hits Enter]
        │
        ▼
MainChatPage.tsx
  1. Seeds assistant message: steps: ['Sending request…']  ← IMMEDIATE, before fetch
  2. POST /api/chats/:id/messages  (existing endpoint, SSE)
        │
        ▼
server/index.js  POST /api/chats/:id/messages
  • SSE headers, flushHeaders()
  • Saves user message to SQLite
  • Emits step events for each processing stage (including model thinking)
  • Calls chatWithDocuments() (gemini.js)
  • Saves assistant message to SQLite
  • Emits 'done' event with messages array
        │
SSE stream ──► readSSE() in MainChatPage
  • data.type === 'step'  → append to last assistant message steps[]
  • data.type === 'done'  → set content, setChatting(false)
  • data.type === 'error' → set error content, setChatting(false)
```

---

## File Upload Flow

```
[User clicks paperclip, picks file]
        │
        ▼
POST /api/chat/upload  (multipart/form-data, field: 'file')
  • Multer saves to uploadsDir
  • PDFs → extract text via pdf-parse; fallback to base64
  • Other files → read as UTF-8 text
  • Returns: { name, mimeType, size, textContent, base64Content }
        │
        ▼
MainChatPage stores pendingFile = { name, content }
  • Shows filename chip in input bar with [x] to clear
  • On send: prepends file content into the user message string:
    "[Attached: filename.pdf]\n\n<file text>\n\n---\n\n<user question>"
```

---

## SSE Wire Format Note

The existing `/api/leases/chat` uses named SSE events (`event: step`).
The existing `/api/chats/:id/messages` uses unnamed events with a `type` field in the data:

```
data: {"type":"step","message":"Calling Gemini","ts":"..."}
data: {"type":"done","messages":[...]}
data: {"type":"error","message":"..."}
```

`MainChatPage` copies `readSSE` verbatim from `LeaseChatPage` but routes on `data.type` (not the `event` argument):

```ts
await readSSE(res, (_event, data: any) => {
  if (data.type === 'step') { ... }
  else if (data.type === 'done') { ... }
  else if (data.type === 'error') { ... }
});
```

---

## Backend Changes

### New endpoint: `POST /api/chat/upload`

Add in `server/index.js` after the existing multer setup.

```js
app.post('/api/chat/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const { originalname, mimetype, path: filePath } = req.file;
  let textContent = null;
  let base64Content = null;

  const isPdf = mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    try {
      // Use static import at top of server/index.js: import pdfParse from 'pdf-parse';
      // (dynamic import has ESM/CJS interop issues with pdf-parse v1.x)
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(buffer);
      textContent = parsed.text || null;
    } catch {
      const buffer = fs.readFileSync(filePath);
      base64Content = buffer.toString('base64');
    }
  } else {
    try {
      textContent = fs.readFileSync(filePath, 'utf8');
    } catch {
      return res.status(422).json({ error: 'Could not read file as text' });
    }
  }

  res.json({ name: originalname, mimeType: mimetype, textContent, base64Content });
});
```

**Note:** `pdf-parse` is already installed (used by lease ingestion). `upload` multer instance is already defined in `server/index.js`.

### Existing endpoint: `POST /api/chats/:id/messages` (no changes)

Already handles SSE streaming, SQLite persistence, and Gemini/Claude routing. `MainChatPage` calls it directly.

Optional improvement: add `res.setHeader('X-Accel-Buffering', 'no')` alongside the other SSE headers so nginx doesn't buffer the stream in production.

---

## Frontend: `src/pages/MainChatPage.tsx` (new file)

### What to copy verbatim from `LeaseChatPage.tsx`

- `normalizeMarkdown()` function
- `readSSE()` function
- `ChatMessage` interface
- `ChatBubble` component

### State

| Var | Type | Purpose |
|---|---|---|
| `messages` | `ChatMessage[]` | Local display messages |
| `input` | `string` | Textarea value |
| `chatting` | `boolean` | Disables input while streaming |
| `selectedModel` | `'gemini' \| 'claude'` | Persisted in localStorage key `'selectedModel'` |
| `chatId` | `string \| null` | Active SQLite chat ID; null on new chat |
| `pendingFile` | `{ name: string; content: string } \| null` | Attached file waiting to be sent |

### `handleSend()` — exact sequence

```
1. Trim input; return if empty or chatting
2. Build userContent:
     if pendingFile:
       "[Attached: {name}]\n\n{fileContent}\n\n---\n\n{text}"
     else: text
3. Push user ChatMessage { role:'user', content: text } to messages
4. Clear input and pendingFile
5. setChatting(true)
6. If chatId is null:
     POST /api/chats { title: text.slice(0, 50), model: selectedModel }
     Set chatId from response
     navigate(`/chat/${newId}`, { replace: true })
     Prepend new chat to store chats
7. Push assistant ChatMessage: { role:'assistant', content:'', steps:['Sending request…'] }
   ← MUST happen before fetch, so user sees it immediately
8. fetch POST /api/chats/:chatId/messages
     headers: { 'Content-Type': 'application/json', 'X-User-Id': userId }
     body: { content: userContent, model: selectedModel }
9. readSSE(res, (_event, data) => {
     if data.type === 'step': append data.message to last message's steps[]
     if data.type === 'done': set content from data.messages[1].content; setChatting(false)
     if data.type === 'error': set content to `Error: ${data.message}`; setChatting(false)
   })
```

### `handleFileSelect(file: File)` — sequence

```
1. Show loading state on paperclip button
2. POST /api/chat/upload (FormData 'file'), X-User-Id header
3. On success: setPendingFile({ name: file.name, content: data.textContent ?? '[Binary file attached]' })
4. On error: show inline error, clear loading
```

### Load existing chat on mount

```ts
useEffect(() => {
  if (!id) return;
  fetch(`/api/chats/${id}/messages`, { headers: { 'X-User-Id': userId } })
    .then(r => r.json())
    .then(data => {
      setChatId(id);
      setMessages((data.messages ?? []).map((m: any) => ({
        role: m.role,
        content: m.content,
        steps: [],
      })));
    })
    .catch(() => {});
}, [id]);
```

### JSX layout

```
<div className="flex-1 flex flex-col overflow-hidden">

  {/* Empty state — shown on fresh chat */}
  {messages.length === 0 && (
    <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
      <h2 className="text-3xl font-playfair text-vetted-primary mb-2">
        Good to see you, {user.display_name.split(' ')[0]}!
      </h2>
      <p className="text-vetted-text-muted text-sm">Ask me anything, or attach a file to get started.</p>
    </div>
  )}

  {/* Messages */}
  {messages.length > 0 && (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
      <div ref={messagesEndRef} />
    </div>
  )}

  {/* Input bar */}
  <div className="border-t border-vetted-border p-4">
    <div className="flex gap-2 items-end">

      {/* Model selector */}
      <select value={selectedModel} onChange={...} className="h-9 rounded-xl border border-vetted-border px-2 text-xs text-vetted-text-secondary bg-white focus:outline-none cursor-pointer">
        <option value="gemini">Gemini 3.1</option>
        <option value="claude">Opus 4.6</option>
      </select>

      {/* File chip (shown when pendingFile set) */}
      {pendingFile && (
        <div className="flex items-center gap-1 px-2 py-1 bg-vetted-surface border border-vetted-border rounded-lg text-xs text-vetted-text-secondary shrink-0">
          <Paperclip size={11} />
          <span className="max-w-[120px] truncate">{pendingFile.name}</span>
          <button onClick={() => setPendingFile(null)}><X size={11} /></button>
        </div>
      )}

      {/* Textarea */}
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        placeholder="Ask anything…"
        disabled={chatting}
        rows={2}
        className="flex-1 resize-none rounded-xl border border-vetted-border px-4 py-2.5 text-sm text-vetted-primary placeholder-vetted-text-muted focus:outline-none disabled:opacity-50"
      />

      {/* Paperclip */}
      <button onClick={() => fileInputRef.current?.click()} className="p-2.5 rounded-xl border border-vetted-border text-vetted-text-muted hover:text-vetted-primary transition-colors">
        <Paperclip size={18} />
      </button>
      <input ref={fileInputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); e.target.value = ''; }} />

      {/* Send */}
      <button onClick={handleSend} disabled={!input.trim() || chatting} className="p-2.5 rounded-xl bg-vetted-primary text-white disabled:opacity-40 hover:bg-opacity-80 transition-colors">
        {chatting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
      </button>

    </div>
  </div>
</div>
```

### Imports

```ts
import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Send, Loader2, Paperclip, X, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';
```

---

## Frontend: `src/App.tsx`

1. Add import: `import MainChatPage from './pages/MainChatPage';`
2. Remove the `ChatPage` inline function and `QUICK_ACTIONS` constant
3. Remove now-dead imports: `ChatView`, `ChatInput`, and any quick-action icon imports only used by `ChatPage`
4. Replace routes:
   ```tsx
   <Route path="/" element={<MainChatPage />} />
   <Route path="/chat/:id" element={<MainChatPage />} />
   ```
5. Keep: `<Route path="/leases" element={<LeaseChatPage />} />`
6. `RightPanel` is rendered outside all routes in `App.tsx`. Since `MainChatPage` manages its own local chat state (not Zustand `activeChat`), `RightPanel` will render empty. Suppress it on the main chat routes by conditionally rendering it only when the path does not match `/` or `/chat/:id`. Use `useLocation()` in the layout component to check the current path.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Gemini credential error | Backend streams error as `done` with error message in content |
| Rate limit / 429 | Same — content shows rate limit message |
| Model not found | Same — content shows model unavailable message |
| Upload read failure | `422` response → inline error chip in input bar |
| Network failure during SSE | `readSSE` throws → catch sets last message content to "Network error", `setChatting(false)` |

---

## Key Constraints

1. **Progress steps MUST appear immediately.** Push the assistant message with `steps: ['Sending request…']` to state BEFORE the fetch call. Never wait for the first SSE event.

2. **Every processing step streams.** The backend already emits step events for model thinking, tool calls, etc. The frontend renders each one as it arrives.

3. **No test runner.** Verify manually in the browser.

4. **Copy, don't refactor.** Copy `normalizeMarkdown`, `readSSE`, `ChatBubble` verbatim from `LeaseChatPage.tsx`. Do not extract to a shared module.

5. **Chat creation.** On first message at `/`, create the SQLite chat record first, then navigate to `/chat/:id` with `replace: true` before sending the message.

6. **SSE wire format.** Use `data.type` for routing in the SSE handler, not the `event` argument (the existing messages endpoint doesn't emit named event lines).
