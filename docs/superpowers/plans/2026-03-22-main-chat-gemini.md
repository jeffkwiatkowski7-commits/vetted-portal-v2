# Main Chat Gemini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock demo chat at `/` with a real Gemini-powered full-width chat — file upload via paperclip, SSE streaming, progress steps that appear immediately on Enter.

**Architecture:** New `MainChatPage.tsx` replaces the inline `ChatPage` in `App.tsx`. It uses the existing `api.chats.streamMessage` for SSE streaming and the existing `/api/chats/:id/messages` backend endpoint — no backend chat changes needed. A new `POST /api/chat/upload` endpoint handles file uploads. `RightPanel` is suppressed on main chat routes via a `ConditionalRightPanel` wrapper.

**Tech Stack:** React/TypeScript, Zustand, react-router-dom v6, Lucide icons, react-markdown + remark-gfm, Node.js/Express, multer, pdf-parse (already installed), Vertex AI Gemini via existing `chatWithDocuments`.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `server/index.js` | Modify | Add `POST /api/chat/upload` endpoint |
| `src/pages/MainChatPage.tsx` | Create | Full-width Gemini chat page |
| `src/App.tsx` | Modify | Swap routes, suppress RightPanel, remove dead imports |
| `src/components/sidebar/Sidebar.tsx` | Modify | Version bump to v1.2.0 |

---

## Task 1: Backend — File Upload Endpoint

**Files:**
- Modify: `server/index.js` (after line 61, after `const upload = multer({ storage });`)

No test runner — verify manually with curl after implementation.

- [ ] **Step 1: Add the upload endpoint**

Open `server/index.js`. Find the line `const upload = multer({ storage });` (around line 61). Add this endpoint immediately after it:

```js
app.post('/api/chat/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const { originalname, mimetype, path: filePath } = req.file;
  let textContent = null;
  let base64Content = null;

  const isPdf = mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    try {
      const pdfParse = (await import('pdf-parse')).default;
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

**Why this placement:** `requireAuth` and `upload` are defined before this line. `fs` is already imported at the top.

- [ ] **Step 2: Verify the server still starts**

```bash
cd /Users/jeffkwiatkowski/vetted_portal_v2
npm run dev:backend
```

Expected: server starts on port 3000 with no errors. Kill it with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: add POST /api/chat/upload endpoint for main chat file attachments"
```

---

## Task 2: Create MainChatPage

**Files:**
- Create: `src/pages/MainChatPage.tsx`

**Reference files to read before implementing:**
- `src/pages/LeaseChatPage.tsx` — copy `normalizeMarkdown`, `ChatMessage` interface, and `ChatBubble` verbatim
- `src/api/index.ts` lines 35–72 — `api.chats.streamMessage` signature: `(id, data, onStep) => Promise<{ messages: [...] }>`

**Note — intentional spec deviation:** The spec says to copy `readSSE` from `LeaseChatPage` and call `fetch` directly. This plan instead uses `api.chats.streamMessage` which already implements the same SSE parsing. This avoids code duplication and is the correct approach.

**Verified:** The backend `done` event (`server/index.js` line 501) emits `messages: [userMsg, assistantMsg]` — so `result.messages[1].content` is always the assistant reply. `messages[0]` is the user echo.

- [ ] **Step 1: Create the file**

Create `/Users/jeffkwiatkowski/vetted_portal_v2/src/pages/MainChatPage.tsx` with this complete content:

```tsx
import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Send, Loader2, Paperclip, X, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';
import * as api from '../api';

// ── Normalize markdown tables (copied from LeaseChatPage) ─────────────────────
function normalizeMarkdown(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableLine = /^\s*\|/.test(line);
    const isEmpty = line.trim() === '';

    if (isTableLine) {
      if (!inTable && result.length > 0) {
        const prev = result[result.length - 1];
        if (prev.trim() !== '' && !/^\s*\|/.test(prev)) result.push('');
      }
      inTable = true;
      result.push(line);
    } else if (isEmpty && inTable) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && /^\s*\|/.test(lines[j])) continue;
      else { inTable = false; result.push(line); }
    } else {
      inTable = false;
      result.push(line);
    }
  }

  return result.join('\n');
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: string[];
}

// ── ChatBubble (copied from LeaseChatPage) ────────────────────────────────────
function ChatBubble({ msg }: { msg: ChatMessage }) {
  const [stepsOpen, setStepsOpen] = useState(!msg.content);

  useEffect(() => {
    if (msg.content) setStepsOpen(false);
  }, [msg.content]);

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-vetted-primary text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 w-full">
      {msg.steps && msg.steps.length > 0 && (
        <button
          onClick={() => setStepsOpen(!stepsOpen)}
          className="flex items-center gap-1 text-xs text-vetted-text-muted hover:text-vetted-primary transition-colors self-start"
        >
          {stepsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {msg.steps.length} steps
        </button>
      )}
      {stepsOpen && msg.steps && (
        <div className="bg-gray-50 border border-vetted-border rounded-lg px-3 py-2 text-xs text-vetted-text-muted space-y-0.5 font-mono">
          {msg.steps.map((s, i) => <div key={i}>{s}</div>)}
        </div>
      )}
      <div className="bg-vetted-bg border border-vetted-border rounded-2xl rounded-tl-sm px-4 py-3 overflow-x-auto">
        <div className="text-[15px]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div className="my-3 overflow-x-auto rounded-xl border border-vetted-border">
                  <table className="w-full text-sm border-collapse">{children}</table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-vetted-surface border-b border-vetted-border">{children}</thead>
              ),
              tbody: ({ children }) => (
                <tbody className="divide-y divide-vetted-border">{children}</tbody>
              ),
              tr: ({ children }) => (
                <tr className="hover:bg-vetted-surface/60 transition-colors">{children}</tr>
              ),
              th: ({ children }) => (
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-vetted-text-secondary uppercase tracking-wide whitespace-nowrap">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-4 py-2.5 text-[14px] text-vetted-text-primary align-top">{children}</td>
              ),
            }}
          >
            {normalizeMarkdown(msg.content)}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function MainChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, chats, setChats } = useStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const [chatId, setChatId] = useState<string | null>(id ?? null);
  const [pendingFile, setPendingFile] = useState<{ name: string; content: string } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gemini' | 'claude'>(() => {
    const saved = localStorage.getItem('selectedModel');
    return saved === 'claude' ? 'claude' : 'gemini';
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load existing chat when navigating to /chat/:id
  useEffect(() => {
    if (!id) {
      setMessages([]);
      setChatId(null);
      return;
    }
    setChatId(id);
    api.chats.get(id)
      .then((chat: any) => {
        setMessages(
          (chat.messages ?? []).map((m: any) => ({
            role: m.role,
            content: m.content,
            steps: [],
          }))
        );
      })
      .catch(() => {});
  }, [id]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || chatting) return;

    // Build content — prepend file text if attached
    const userContent = pendingFile
      ? `[Attached: ${pendingFile.name}]\n\n${pendingFile.content}\n\n---\n\n${text}`
      : text;

    // Show user message and clear inputs immediately
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setPendingFile(null);
    setChatting(true);

    // Resolve or create chatId
    let activeChatId = chatId;
    if (!activeChatId) {
      try {
        const newChat = await api.chats.create({ title: text.slice(0, 60), model: selectedModel });
        activeChatId = newChat.id;
        setChatId(activeChatId);
        navigate(`/chat/${activeChatId}`, { replace: true });
        setChats([newChat, ...chats]);
      } catch {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Error: could not create chat.' }]);
        setChatting(false);
        return;
      }
    }

    // Seed assistant placeholder with immediate step — user sees it right away
    setMessages(prev => [...prev, { role: 'assistant', content: '', steps: ['Sending request…'] }]);

    try {
      const result = await api.chats.streamMessage(
        activeChatId!,
        { content: userContent, model: selectedModel },
        (step: { message: string }) => {
          setMessages(prev => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };
            last.steps = [...(last.steps ?? []), step.message];
            updated[updated.length - 1] = last;
            return updated;
          });
        }
      );

      // result.messages[0] = user echo, result.messages[1] = assistant reply
      const assistantContent = result.messages?.[1]?.content ?? '';
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent };
        return updated;
      });

      // Refresh sidebar chat list so new chat appears
      api.chats.list().then(setChats).catch(() => {});
    } catch (err: any) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: `Error: ${err.message ?? 'Something went wrong'}`,
        };
        return updated;
      });
    } finally {
      setChatting(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    setFileLoading(true);
    try {
      const userId = localStorage.getItem('userId') || '';
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setPendingFile({
        name: file.name,
        content: data.textContent ?? '[Binary file — content not extractable as text]',
      });
    } catch {
      // silently fail — user can try again
    } finally {
      setFileLoading(false);
    }
  };

  const firstName = user?.display_name?.split(' ')[0] ?? 'there';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Messages area */}
      {messages.length > 0 ? (
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
          <div ref={messagesEndRef} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
          <h2 className="text-3xl font-playfair text-vetted-primary mb-2">
            Good to see you, {firstName}!
          </h2>
          <p className="text-sm text-vetted-text-muted">Ask me anything, or attach a file to get started.</p>
        </div>
      )}

      {/* Input bar */}
      <div className="border-t border-vetted-border p-4">
        <div className="flex gap-2 items-end">

          {/* Model selector */}
          <select
            value={selectedModel}
            onChange={e => {
              const val = e.target.value as 'gemini' | 'claude';
              setSelectedModel(val);
              localStorage.setItem('selectedModel', val);
            }}
            className="h-9 rounded-xl border border-vetted-border px-2 text-xs text-vetted-text-secondary bg-white focus:outline-none cursor-pointer shrink-0"
          >
            <option value="gemini">Gemini 3.1</option>
            <option value="claude">Opus 4.6</option>
          </select>

          {/* File chip */}
          {pendingFile && (
            <div className="flex items-center gap-1 px-2 py-1 bg-vetted-surface border border-vetted-border rounded-lg text-xs text-vetted-text-secondary shrink-0">
              <Paperclip size={11} />
              <span className="max-w-[120px] truncate">{pendingFile.name}</span>
              <button onClick={() => setPendingFile(null)} className="hover:text-vetted-danger transition-colors">
                <X size={11} />
              </button>
            </div>
          )}

          {/* Textarea */}
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask anything…"
            disabled={chatting}
            rows={2}
            className="flex-1 resize-none rounded-xl border border-vetted-border px-4 py-2.5 text-sm text-vetted-primary placeholder-vetted-text-muted focus:outline-none disabled:opacity-50 disabled:bg-gray-50"
          />

          {/* Paperclip */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={fileLoading}
            className="p-2.5 rounded-xl border border-vetted-border text-vetted-text-muted hover:text-vetted-primary transition-colors disabled:opacity-40"
            title="Attach file"
          >
            {fileLoading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
              e.target.value = '';
            }}
          />

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={!input.trim() || chatting}
            className="p-2.5 rounded-xl bg-vetted-primary text-white disabled:opacity-40 hover:bg-opacity-80 transition-colors"
          >
            {chatting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>

        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/jeffkwiatkowski/vetted_portal_v2
npm run build 2>&1 | head -40
```

Expected: no TypeScript errors relating to `MainChatPage.tsx`. Fix any type errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/pages/MainChatPage.tsx
git commit -m "feat: create MainChatPage with Gemini streaming, progress steps, file upload"
```

---

## Task 3: Wire Up Routes in App.tsx

**Files:**
- Modify: `src/App.tsx`

**What to do:**
1. Add import for `MainChatPage`
2. Remove `ChatPage` function, `QUICK_ACTIONS` constant, and now-unused imports (`ChatView`, `ChatInput`, `BookOpen`, `Code2`, `BarChart2`, `PenLine`, `FolderSearch`)
3. Replace `/` and `/chat/:id` routes with `MainChatPage`
4. Add `ConditionalRightPanel` to suppress `RightPanel` on main chat routes

- [ ] **Step 1: Replace the top of `App.tsx`**

The current imports block (lines 1–25) should become:

```tsx
import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store';
import * as api from './api';
import Sidebar from './components/sidebar/Sidebar';
import LoginPage from './components/auth/LoginPage';
import MainChatPage from './pages/MainChatPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import LibraryPage from './pages/LibraryPage';
import AppsPage from './pages/AppsPage';
import AdminPage from './pages/AdminPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminSystemPromptsPage from './pages/AdminSystemPromptsPage';
import AdminModelsPage from './pages/AdminModelsPage';
import AdminMcpPage from './pages/AdminMcpPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import LeaseChatPage from './pages/LeaseChatPage';
import ToastContainer from './components/notifications/ToastContainer';
import GlobalSearch from './components/search/GlobalSearch';
import DemoMode from './components/demo/DemoMode';
import RightPanel from './components/RightPanel';
```

- [ ] **Step 2: Remove `QUICK_ACTIONS` and `ChatPage`**

Delete the `QUICK_ACTIONS` constant (lines 27–33) and the entire `ChatPage` function (lines 40–85).

- [ ] **Step 3: Add `RedirectToLogin` and `ConditionalRightPanel`**

After the imports block, add these two small components (replace the existing `RedirectToLogin`):

```tsx
function RedirectToLogin() {
  const location = useLocation();
  return <Navigate to="/login" state={{ from: location.pathname }} replace />;
}

function ConditionalRightPanel() {
  const location = useLocation();
  const isMainChat = location.pathname === '/' || location.pathname.startsWith('/chat/');
  if (isMainChat) return null;
  return <RightPanel />;
}
```

- [ ] **Step 4: Update routes and RightPanel usage**

Inside the authenticated `BrowserRouter` JSX, replace the two chat routes:

```tsx
<Route path="/" element={<MainChatPage />} />
<Route path="/chat/:id" element={<MainChatPage />} />
```

And replace `<RightPanel />` with `<ConditionalRightPanel />`.

- [ ] **Step 5: Verify it builds**

```bash
npm run build 2>&1 | head -40
```

Expected: clean build. Fix any import errors (e.g. if `useParams` was removed from react-router-dom import — check it's still there if needed elsewhere; in this case `MainChatPage` uses it, not `App.tsx`, so `useParams` can be removed from `App.tsx`'s import).

- [ ] **Step 6: Smoke test in browser**

```bash
npm run dev
```

Open `http://localhost:5173`. Verify:
- Landing page shows "Good to see you, {firstName}!" with input bar
- Type a message, hit Enter — "Sending request…" appears immediately
- Steps fill in, response arrives with markdown
- Paperclip icon is visible; clicking it opens file picker
- Sidebar shows new chat after first message
- Navigating to an existing chat from sidebar loads its history

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: replace mock ChatPage with MainChatPage on / and /chat/:id routes"
```

---

## Task 4: Version Bump

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx` line 248

- [ ] **Step 1: Bump version**

In `src/components/sidebar/Sidebar.tsx`, find:

```tsx
<p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.1.1</p>
```

Change to:

```tsx
<p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.2.0</p>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "chore: bump version to v1.2.0"
```

---

## Verification Checklist

After all tasks complete, verify in browser:

- [ ] `/` shows personalized greeting, input bar, paperclip, model selector
- [ ] Typing and hitting Enter immediately shows "Sending request…" in steps panel
- [ ] Steps fill in as backend processes (model thinking, response received, etc.)
- [ ] Steps auto-collapse when response arrives; chevron button re-opens them
- [ ] Response renders as rich markdown (tables, code blocks, etc.)
- [ ] Attaching a file shows a chip in the input bar with an X to remove
- [ ] Sending with a file attaches file content to the message
- [ ] New chat appears in sidebar after first message
- [ ] Clicking a chat in sidebar loads its history at `/chat/:id`
- [ ] `/leases` still works (LeaseChatPage unchanged)
- [ ] RightPanel does not render on `/` or `/chat/:id`
- [ ] Model selector persists choice across page refreshes (localStorage)
