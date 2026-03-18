# Chat File Upload Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the file attach flow feel natural — upload a file, close the dialog, see it in the right panel, and get an automatic bot acknowledgment with no visible user bubble.

**Architecture:** Two surgical edits to existing components. `ChatInput` gains a `hidden` flag on `handleSendMessage` that suppresses all visible side effects (optimistic bubble, thinking spinner, toast, textarea clear) while still sending to the backend and rendering the bot reply. `RightPanel` makes the X button always visible.

**Tech Stack:** React, TypeScript, Zustand, Tailwind CSS. No test runner configured — verification is manual via `npm run dev`.

**Spec:** `docs/superpowers/specs/2026-03-18-chat-file-upload-flow-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `src/components/chat/ChatInput.tsx` | Modify | Add `hidden` to overrides type; gate 5 side effects; replace `onAttach` prompt |
| `src/components/RightPanel.tsx` | Modify | Remove hover-only opacity from X button |

---

## Task 1: Add `hidden` flag to `handleSendMessage` and gate side effects

**File:** `src/components/chat/ChatInput.tsx`

This task modifies `handleSendMessage` (lines 88–163) in three places:
1. Extend the overrides type and destructure `hidden`
2. Gate `setMessage('')`, the optimistic `setActiveChat` block, and `addToast` on `!hidden`
3. Gate `clearLiveSteps()` + `setAiThinking()` pairs on `!hidden`

The final `setActiveChat(updated)` after the stream (line 147) stays unconditional — it's what delivers the bot reply.

- [ ] **Step 1: Update the `handleSendMessage` signature and destructure `hidden`**

In `src/components/chat/ChatInput.tsx`, find line 88:
```ts
const handleSendMessage = async (overrides?: { msg?: string; files?: LibraryFile[] }) => {
  const content = overrides?.msg ?? message;
  const files = overrides?.files ?? chatAttachedFiles;
  if (!content.trim()) return;
```

Replace with:
```ts
const handleSendMessage = async (overrides?: { msg?: string; files?: LibraryFile[]; hidden?: boolean }) => {
  const content = overrides?.msg ?? message;
  const files = overrides?.files ?? chatAttachedFiles;
  const hidden = overrides?.hidden ?? false;
  if (!content.trim()) return;
```

- [ ] **Step 2: Gate `setMessage('')` and the optimistic user bubble**

Find lines 112–121 (inside the `try` block, after the chatId is resolved):
```ts
      // Optimistically show the user's message immediately
      setMessage('');
      setActiveChat({
        ...(activeChat || { id: chatId, title: content.slice(0, 50), messages: [] }),
        id: chatId,
        messages: [
          ...(activeChat?.messages || []),
          { id: `optimistic-${Date.now()}`, role: 'user', content, created_at: new Date().toISOString() },
        ],
      } as any);
```

Replace with:
```ts
      // Optimistically show the user's message immediately (skip for hidden sends)
      if (!hidden) setMessage('');
      if (!hidden) {
        setActiveChat({
          ...(activeChat || { id: chatId, title: content.slice(0, 50), messages: [] }),
          id: chatId,
          messages: [
            ...(activeChat?.messages || []),
            { id: `optimistic-${Date.now()}`, role: 'user', content, created_at: new Date().toISOString() },
          ],
        } as any);
      }
```

- [ ] **Step 3: Gate `clearLiveSteps()` and `setAiThinking()` pairs**

Find lines 123–131:
```ts
      clearLiveSteps();
      setAiThinking(true);
      const sendResult = await api.chats.streamMessage(
        chatId,
        { content, model: selectedModel.name, temperature, attachments: files.map((f) => f.id) },
        (step) => addLiveStep(step),
      );
      setAiThinking(false);
      clearLiveSteps();
```

Replace with:
```ts
      if (!hidden) { clearLiveSteps(); setAiThinking(true); }
      const sendResult = await api.chats.streamMessage(
        chatId,
        { content, model: selectedModel.name, temperature, attachments: files.map((f) => f.id) },
        (step) => addLiveStep(step),
      );
      if (!hidden) { setAiThinking(false); clearLiveSteps(); }
```

- [ ] **Step 4: Gate the success toast**

Find line 150:
```ts
      addToast({ type: 'success', title: 'Message sent' });
```

Replace with:
```ts
      if (!hidden) addToast({ type: 'success', title: 'Message sent' });
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ChatInput.tsx
git commit -m "feat: add hidden flag to handleSendMessage to suppress UI side effects"
```

---

## Task 2: Replace `onAttach` callback with hidden acknowledgment prompt

**File:** `src/components/chat/ChatInput.tsx`

The `onAttach` prop passed to `LibraryPickerModal` currently fires `handleSendMessage` with `'Please summarize this document.'` and no `hidden` flag. Replace it with the new hidden, plural-aware acknowledgment prompt.

- [ ] **Step 1: Replace the `onAttach` callback**

Find lines 177–180 inside the JSX return (inside `<LibraryPickerModal>`):
```ts
        onAttach={(files) => {
          setChatAttachedFiles(files);
          handleSendMessage({ msg: 'Please summarize this document.', files });
        }}
```

Replace with:
```ts
        onAttach={(files) => {
          setChatAttachedFiles(files);
          const count = files.length;
          const prompt = count === 1
            ? 'A file has been attached. Please briefly acknowledge it and let the user know you are ready to help with questions about it.'
            : `${count} files have been attached. Please briefly acknowledge them and let the user know you are ready to help with questions about them.`;
          handleSendMessage({ msg: prompt, files, hidden: true });
        }}
```

- [ ] **Step 2: Verify the app runs without TypeScript errors**

```bash
npm run dev
```

Expected: server starts, no compilation errors in terminal.

- [ ] **Step 3: Manual verification — full 7-step flow**

With the dev server running at `http://localhost:5173`:

1. Log in as `james.wilson@company.com`
2. Click the paperclip icon in chat input → Library modal opens in browse view
3. Click "+ Upload File" → pick any file from disk
4. Confirm progress bar appears with percentage
5. After upload: file appears selected (gold checkbox) in browse list
6. Click "Attach to Chat"
7. Confirm: modal closes, no user bubble appears in chat, no "Message sent" toast, no thinking spinner
8. Confirm: bot reply appears (e.g., "I've loaded your file...")
9. Confirm: right panel shows the file (may need to open the panel toggle if collapsed)
10. Confirm: file remains in right panel after bot replies

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatInput.tsx
git commit -m "feat: auto-acknowledge attached files via hidden bot prompt"
```

---

## Task 3: Make right panel X button always visible

**File:** `src/components/RightPanel.tsx`

The X button to remove a file is currently `opacity-0` and only appears on row hover. Make it always visible so users can see and use it without needing to hover first.

- [ ] **Step 1: Update the X button className**

In `src/components/RightPanel.tsx`, find the X button inside the `chatAttachedFiles.map(...)` block (around line 56):
```tsx
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-vetted-text-muted hover:text-vetted-danger transition-all shrink-0"
```

Replace with:
```tsx
                    className="p-0.5 text-vetted-text-muted hover:text-vetted-danger transition-colors shrink-0"
```

- [ ] **Step 2: Manual verification**

With the dev server running and a file attached to chat:

1. Open the right panel (click the toggle tab on the right edge)
2. Confirm the X button is visible on the file row without hovering
3. Hover over the row — X should turn red (`text-vetted-danger`)
4. Click X — file is removed from the panel and from `chatAttachedFiles`

- [ ] **Step 3: Commit**

```bash
git add src/components/RightPanel.tsx
git commit -m "feat: make right panel file remove button always visible"
```
