# Chat Input Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign MainChatPage so the chat input is centered on an empty chat and bottom-docked after the first message, with file upload and model selector living inside the input box, and a clean grey thinking state with animated dots and collapsible steps.

**Architecture:** All changes are confined to `src/pages/MainChatPage.tsx`. The input box is structurally refactored from a horizontal flex row into a vertical card. The two layout states (empty/centered vs. active/bottom-docked) share the same input card component, just mounted in different containers.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react

---

## Files

- **Modify:** `src/pages/MainChatPage.tsx` — all changes live here

---

### Task 1: Add `attachedFileName` to ChatMessage and set it in handleSend

**Files:**
- Modify: `src/pages/MainChatPage.tsx:42-46` (ChatMessage interface)
- Modify: `src/pages/MainChatPage.tsx:174-177` (handleSend user message insert)

**Context:** The `ChatMessage` interface is defined locally at the top of the file. `handleSend` inserts the user message into state at line ~175. Currently it stores `{ role: 'user', content: text }`. We need to also store the filename so `ChatBubble` can render the chip.

- [ ] **Step 1: Update ChatMessage interface**

Find this block (around line 42):
```ts
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: string[];
}
```

Replace with:
```ts
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: string[];
  attachedFileName?: string;
}
```

- [ ] **Step 2: Set attachedFileName in handleSend**

Find this line in `handleSend` (around line 175):
```ts
setMessages(prev => [...prev, { role: 'user', content: text }]);
```

Replace with:
```ts
setMessages(prev => [...prev, { role: 'user', content: text, attachedFileName: pendingFile?.name }]);
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /Users/jeffkwiatkowski/vetted_portal_v2 && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

Expected: no new errors (there may be 2 pre-existing errors in ChatInput.tsx — those are fine).

- [ ] **Step 4: Commit**

```bash
git add src/pages/MainChatPage.tsx
git commit -m "feat: add attachedFileName to ChatMessage interface"
```

---

### Task 2: Refactor input box to vertical card structure

**Files:**
- Modify: `src/pages/MainChatPage.tsx` — the input area (currently the `<div className="border-t border-vetted-border p-4">` block at the bottom)

**Context:** The current input layout is a `flex gap-2 items-end` row with model select, file chip, textarea, paperclip button, and send button all as siblings. Replace this entire structure with a vertical card. The card is used in both State 1 and State 2 — write it once and reference it in both places.

Extract the input card as a JSX variable `const inputCard = (...)` inside the component body (after the hooks, before the return), then place it in the appropriate container in State 1 and State 2.

- [ ] **Step 1: Write the input card JSX variable**

Add this before the `return` statement in `MainChatPage` (after all hooks):

```tsx
const inputCard = (
  <div className={`rounded-2xl border border-vetted-border bg-white p-3 shadow-sm ${chatting ? 'opacity-60 pointer-events-none' : ''}`}>
    {/* File chip — shown when a file is pending */}
    {pendingFile && (
      <div className="flex items-center gap-1.5 px-2 py-1 bg-vetted-surface border border-vetted-border rounded-lg text-xs text-vetted-text-muted mb-2 w-fit">
        <Paperclip size={11} />
        <span className="max-w-[160px] truncate">{pendingFile.name}</span>
        <button onClick={() => setPendingFile(null)} className="hover:text-vetted-primary transition-colors ml-0.5">
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
      className="w-full resize-none text-sm text-vetted-primary placeholder-vetted-text-muted focus:outline-none disabled:opacity-50 bg-transparent"
    />

    {/* Bottom toolbar */}
    <div className="flex items-center justify-between pt-2 mt-1 border-t border-vetted-border">
      {/* Left: file attach */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="p-1.5 rounded-lg border border-vetted-border text-vetted-text-muted hover:text-vetted-primary transition-colors"
        title="Attach file"
      >
        {fileLoading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
      </button>

      {/* Right: model selector + send */}
      <div className="flex items-center gap-2">
        <select
          value={selectedModel}
          onChange={e => {
            const val = e.target.value as 'gemini' | 'claude';
            setSelectedModel(val);
            localStorage.setItem('selectedModel', val);
          }}
          className="text-xs border border-vetted-border rounded-lg px-2 py-1 text-vetted-text-secondary bg-white focus:outline-none cursor-pointer"
        >
          <option value="gemini">Gemini 3.1</option>
          <option value="claude">Opus 4.6</option>
        </select>
        <button
          onClick={handleSend}
          disabled={!input.trim() || chatting}
          className="p-1.5 rounded-lg bg-vetted-primary text-white disabled:opacity-40 hover:bg-opacity-80 transition-colors"
        >
          {chatting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>

    {/* Hidden file input */}
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
  </div>
);
```

- [ ] **Step 2: Replace the return statement**

Replace the entire `return (...)` block with:

```tsx
return (
  <div className="flex-1 flex flex-col overflow-hidden">
    {messages.length === 0 ? (
      /* State 1: empty — centered column */
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4 pb-16">
        <div className="text-center">
          <h2 className="text-3xl font-playfair text-vetted-primary mb-2">
            Good to see you, {firstName}!
          </h2>
          <p className="text-sm text-vetted-text-muted">Ask me anything, or attach a file to get started.</p>
        </div>
        <div className="w-full max-w-[560px]">
          {inputCard}
        </div>
      </div>
    ) : (
      /* State 2: active — messages + bottom-docked input */
      <>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
          <div ref={messagesEndRef} />
        </div>
        <div className="border-t border-vetted-border p-4">
          {inputCard}
        </div>
      </>
    )}
  </div>
);
```

- [ ] **Step 3: Verify in browser**

Start dev server if not running: `npm run dev:frontend` (port 5173).

- Open http://localhost:5173/ — should see greeting + centered input card with paperclip on left, model selector + send on right inside the card.
- Type a message and send — input should move to the bottom.
- Confirm model selector and paperclip are inside the card in both states.

- [ ] **Step 4: TypeScript check**

```bash
cd /Users/jeffkwiatkowski/vetted_portal_v2 && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MainChatPage.tsx
git commit -m "feat: refactor chat input to vertical card, centered on empty / bottom-docked on active"
```

---

### Task 3: User bubble filename chip

**Files:**
- Modify: `src/pages/MainChatPage.tsx` — `ChatBubble` component (lines ~56-63 for user bubble)

**Context:** The user bubble currently renders `msg.content` directly inside a dark rounded div. We need to optionally show a filename chip above the content when `msg.attachedFileName` is set. `msg.content` is always the raw user text (no `[Attached: ...]` prefix).

- [ ] **Step 1: Update the user bubble branch in ChatBubble**

Find the user bubble return (around line 56):
```tsx
if (msg.role === 'user') {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] bg-vetted-primary text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
        {msg.content}
      </div>
    </div>
  );
}
```

Replace with:
```tsx
if (msg.role === 'user') {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] bg-vetted-primary text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
        {msg.attachedFileName && (
          <div className="flex items-center gap-1 opacity-50 mb-1.5 text-[11px]">
            <Paperclip size={10} />
            <span className="truncate max-w-[200px]">{msg.attachedFileName}</span>
          </div>
        )}
        {msg.content}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

- Attach a file (e.g. any PDF or text file), type a message, send.
- The user bubble should show the filename chip (grey, 50% opacity) above the message text.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/MainChatPage.tsx
git commit -m "feat: show attached filename chip in user bubble"
```

---

### Task 4: Animated dots while thinking + updated steps panel

**Files:**
- Modify: `src/pages/MainChatPage.tsx` — `ChatBubble` component (assistant branch, lines ~66-117)

**Context:** The assistant bubble currently shows the steps panel and then the markdown content. We need to:
1. Show three bouncing grey dots when `msg.content === ''` (thinking state), replacing the markdown area
2. Update steps panel styling: white bg, dash prefix per step, Tavily badge on `Web search:` steps

The `stepsOpen` state and toggle behavior already work correctly — do not change that logic.

- [ ] **Step 1: Update the assistant bubble in ChatBubble**

Find the assistant bubble return (the `return (...)` after the user bubble check, around line 66). Replace the entire assistant bubble return with:

```tsx
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
      <div className="bg-white border border-vetted-border rounded-xl px-3 py-2 text-xs text-vetted-text-muted space-y-0.5 font-mono">
        {msg.steps.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <span>–</span>
            <span>{s}</span>
            {s.startsWith('Web search:') && (
              <span className="ml-1 text-[10px] bg-vetted-surface text-vetted-text-muted px-1.5 py-0.5 rounded">Tavily</span>
            )}
          </div>
        ))}
      </div>
    )}
    <div className="bg-vetted-bg border border-vetted-border rounded-2xl rounded-tl-sm px-4 py-3 overflow-x-auto">
      {msg.content === '' ? (
        /* Thinking dots */
        <div className="flex items-center gap-1 py-1">
          <span className="w-2 h-2 bg-vetted-text-muted rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-vetted-text-muted rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-vetted-text-muted rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      ) : (
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
      )}
    </div>
  </div>
);
```

- [ ] **Step 2: Verify in browser**

- Send a message. While the response is streaming: three grey bouncing dots should appear in the assistant bubble, steps panel should expand above it showing each step with a `–` prefix.
- A `Web search:` step should show a grey "Tavily" badge.
- Once the response arrives, dots disappear and markdown renders; steps panel collapses to `▸ N steps` toggle.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/MainChatPage.tsx
git commit -m "feat: animated thinking dots, updated steps panel with dash prefix and Tavily badge"
```

---

### Task 5: Bump version

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Find and update version string**

```bash
grep -n "v1\." src/components/sidebar/Sidebar.tsx
```

Change `v1.2.1` → `v1.2.2`.

- [ ] **Step 2: Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "chore: bump version to v1.2.2"
```
