# Claude-Style Chat Input Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chat input to match Claude.ai's UX — centered when idle, sliding to bottom on first send, single-box layout with model selector bottom-right, temperature slider removed.

**Architecture:** A new `ChatLayout` component (in `App.tsx`) wraps both `/` and `/chat/:id` as a persistent layout route, owns `isStarted` state, and manages the four-zone CSS transition layout. `ChatInput` gets two new props (`onStart`, `isStarted`) and a fully redesigned single-box visual structure. `ChatView` gets a minimal null-safety fix.

**Tech Stack:** React 18, React Router v6, TypeScript, Tailwind CSS, Zustand, Lucide React icons

---

## Chunk 1: ChatView null-safety fix + ChatInput redesign

### Task 1: Replace `!activeChat` fallback in ChatView.tsx

**Files:**
- Modify: `src/components/chat/ChatView.tsx:35-44`

**Why first:** `ChatView` will be conditionally mounted by `ChatLayout` via `isStarted &&`. Once that mount is in place, `activeChat` can be null when `ChatView` first renders (before the fetch completes). The welcome text block must be replaced with an empty div *before* the conditional mount is wired up. These two changes are coupled and must both land — do this one first so the file is in a safe state when `ChatLayout` mounts it.

- [ ] **Step 1: Open `src/components/chat/ChatView.tsx` and locate lines 35–44**

  This is the `if (!activeChat)` block that currently returns a "Welcome to Vetted AI" heading. It looks like:

  ```tsx
  if (!activeChat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <h1 className="text-4xl font-serif text-vetted-primary mb-2">Welcome to Vetted AI</h1>
          <p className="text-vetted-text-secondary">Select a chat or start a new conversation</p>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Replace the block with an empty flex placeholder**

  Replace the entire `if (!activeChat) { return (...); }` block (lines 35–44) with:

  ```tsx
  if (!activeChat) {
    return <div className="flex-1" />;
  }
  ```

  The null guard is kept (prevents TypeError on `activeChat.messages` at line 54). Only the JSX content changes — welcome text removed, replaced with a spacer div.

- [ ] **Step 3: Verify the file compiles**

  Run: `npm run dev:frontend`
  Expected: Vite starts without TypeScript errors. The app still works — existing chats display messages, navigating to `/` shows nothing in the messages area (which is fine; the welcome state will be owned by `ChatLayout` in Task 3).

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/chat/ChatView.tsx
  git commit -m "fix: replace ChatView welcome fallback with empty div for ChatLayout compatibility"
  ```

---

### Task 2: Redesign ChatInput.tsx

**Files:**
- Modify: `src/components/chat/ChatInput.tsx` (full rewrite of JSX; logic preserved)

**What changes:**
- Add props: `onStart?: () => void`, `isStarted?: boolean`
- Call `onStart?.()` at the top of `handleSendMessage`
- Remove: temperature state + slider UI, Share button, top controls row
- Keep: `temperature` hardcoded to `0.7` in API calls, all existing send/attach logic
- New layout: single outer box (`rounded-2xl border`) containing attachment chip (top), textarea (middle), bottom toolbar (left: paperclip, right: model selector + send)

- [ ] **Step 1: Update the component signature to accept new props**

  Change line 19 from:
  ```tsx
  export default function ChatInput() {
  ```
  to:
  ```tsx
  interface ChatInputProps {
    onStart?: () => void;
    isStarted?: boolean;
  }

  export default function ChatInput({ onStart, isStarted }: ChatInputProps) {
  ```

- [ ] **Step 2: Remove the temperature state and hardcode it**

  Remove line 27:
  ```tsx
  const [temperature, setTemperature] = useState(0.7);
  ```
  Replace with:
  ```tsx
  const temperature = 0.7;
  ```

  > **Note:** After this step, TypeScript will report an error on `setTemperature` (still referenced in the existing JSX). Do not compile until Step 7 — intermediate steps leave the file in a temporarily broken state until the JSX is replaced in Step 5.

- [ ] **Step 3: Add `onStart?.()` call at the top of `handleSendMessage`**

  The function currently starts with `if (!message.trim()) return;` (line 40). Add the call right after the early return:

  ```tsx
  const handleSendMessage = async () => {
    if (!message.trim()) return;
    onStart?.();  // ← add this line
    // ... rest unchanged
  ```

- [ ] **Step 4: Update the textarea auto-resize cap from 120px to 200px**

  Line 35 currently has:
  ```tsx
  textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
  ```
  Change `120` to `200`:
  ```tsx
  textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
  ```

- [ ] **Step 5: Replace the return JSX with the new single-box layout**

  Replace everything from `return (` to the closing `);` (lines 95–228) with:

  ```tsx
  return (
    <div className="rounded-2xl border border-vetted-border shadow-sm bg-white w-full">
      {/* Attachment chip */}
      {attachment && (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-vetted-surface rounded-lg w-fit">
            <Paperclip size={14} />
            <span className="text-sm text-vetted-text-secondary">{attachment.name}</span>
            <button
              onClick={() => setAttachment(null)}
              className="ml-1 p-0.5 hover:bg-white rounded"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isStarted ? 'Ask anything... (Shift+Enter for newline)' : 'How can I help you today?'}
        className="border-none outline-none resize-none bg-transparent w-full px-4 pt-4 pb-2 text-base leading-relaxed"
        rows={1}
        style={{ minHeight: '52px' }}
      />

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-3 pb-3">
        {/* Left: attach */}
        <div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 text-vetted-text-muted hover:text-vetted-primary transition-colors rounded-lg"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => {
              if (e.target.files?.[0]) setAttachment(e.target.files[0]);
            }}
            hidden
          />
        </div>

        {/* Right: model selector + send */}
        <div className="flex items-center gap-2">
          {/* Model selector */}
          <div className="relative">
            <button
              onClick={() => setShowModelSelect(!showModelSelect)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm hover:bg-vetted-surface transition-colors"
            >
              <div className={`w-2 h-2 rounded-full ${selectedModel.color}`} />
              {selectedModel.name}
              <ChevronDown size={14} />
            </button>
            {showModelSelect && (
              <div className="absolute bottom-full right-0 mb-1 bg-white border border-vetted-border rounded-xl shadow-lg min-w-[140px] z-10">
                {MODELS.map((model) => (
                  <button
                    key={model.name}
                    onClick={() => {
                      setSelectedModel(model);
                      setShowModelSelect(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-vetted-surface flex items-center gap-2 border-b border-vetted-border last:border-b-0"
                  >
                    <div className={`w-2 h-2 rounded-full ${model.color}`} />
                    {model.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Send button */}
          <button
            onClick={handleSendMessage}
            disabled={loading || !message.trim()}
            className={`rounded-full w-8 h-8 flex items-center justify-center transition-colors ${
              message.trim() && !loading
                ? 'bg-vetted-accent text-vetted-primary hover:bg-vetted-accent-dark'
                : 'bg-vetted-border text-vetted-text-muted cursor-not-allowed'
            }`}
            title="Send (Enter)"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
  ```

- [ ] **Step 6: Remove unused imports**

  Remove `Share2` from the import at line 8 (it's no longer used). The final import block should be:

  ```tsx
  import {
    Send,
    Paperclip,
    ChevronDown,
    X,
  } from 'lucide-react';
  ```

- [ ] **Step 7: Verify the file compiles and renders correctly**

  Run: `npm run dev:frontend`
  Navigate to any existing chat. Verify:
  - Input shows single rounded box with bottom toolbar
  - Model selector pill appears bottom-right, opens upward
  - Send button is circular, activates when text is entered
  - Paperclip is on the left of the toolbar
  - No temperature slider visible
  - Pressing Enter sends; Shift+Enter adds newline
  - Attaching a file shows chip inside the box above textarea

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/chat/ChatInput.tsx
  git commit -m "feat: redesign ChatInput as single-box layout with bottom toolbar"
  ```

---

## Chunk 2: ChatLayout and route wiring

### Task 3: Add ChatLayout to App.tsx and update routes

**Files:**
- Modify: `src/App.tsx`

**What changes:**
- Add `ChatLayout` function component (defined above the `App` function)
- Add `Outlet` to the React Router import
- Replace the two sibling `<Route path="/">` and `<Route path="/chat/:id">` entries with a single pathless parent layout route wrapping them
- Pass `isStarted` and `onStart` from `ChatLayout` to `ChatInput`; pass `isStarted` to `ChatView` (not needed — `ChatView` doesn't take props)

- [ ] **Step 1: Add `Outlet` and `useParams` to the React Router import**

  Line 2 currently reads:
  ```tsx
  import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
  ```
  Change to:
  ```tsx
  import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
  ```

- [ ] **Step 2: Add `useState` to the React import**

  Line 1 currently reads:
  ```tsx
  import React, { useEffect } from 'react';
  ```
  Change to (only `useState` is new; `useEffect` is already present):
  ```tsx
  import React, { useEffect, useState } from 'react';
  ```

- [ ] **Step 3: Add the `ChatLayout` component above the `App` function**

  Insert this entire block directly before the `function App() {` declaration (search for that text — line numbers shift after Steps 1–2):

  ```tsx
  function ChatLayout() {
    const { id } = useParams<{ id?: string }>();
    const [isStarted, setIsStarted] = useState(!!id);

    useEffect(() => {
      setIsStarted(!!id);
    }, [id]);

    const handleStart = () => setIsStarted(true);

    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Messages zone */}
        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            isStarted
              ? 'flex-1 max-h-[100vh] opacity-100 overflow-y-auto'
              : 'max-h-0 opacity-0'
          }`}
        >
          {isStarted && <ChatView />}
        </div>

        {/* Welcome zone */}
        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            isStarted
              ? 'max-h-0 opacity-0'
              : 'flex-1 max-h-screen flex items-center justify-center opacity-100'
          }`}
        >
          <div className="text-center">
            <h1 className="text-5xl font-serif font-bold text-vetted-primary mb-3">
              Vetted<span className="text-vetted-accent">.</span>
            </h1>
            <p className="text-vetted-text-secondary">Your enterprise AI workspace</p>
          </div>
        </div>

        {/* Input zone */}
        <div
          className={`transition-all duration-300 ease-in-out mx-auto px-4 w-full ${
            isStarted ? 'max-w-3xl' : 'max-w-[660px]'
          }`}
        >
          <ChatInput onStart={handleStart} isStarted={isStarted} />
        </div>

        {/* Bottom spacer — collapses to drive the slide-down effect */}
        <div
          aria-hidden="true"
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            isStarted ? 'max-h-0' : 'max-h-[45vh]'
          }`}
        />

        <Outlet />
      </div>
    );
  }
  ```

- [ ] **Step 4: Replace the two sibling chat routes with the layout route pattern**

  Find the two existing chat route entries in `App.tsx` (around lines 95–112):

  ```tsx
  <Route
    path="/"
    element={
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatView />
        <ChatInput />
      </div>
    }
  />
  <Route
    path="/chat/:id"
    element={
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatView />
        <ChatInput />
      </div>
    }
  />
  ```

  Replace both with:

  ```tsx
  <Route element={<ChatLayout />}>
    <Route path="/" element={null} />
    <Route path="/chat/:id" element={null} />
  </Route>
  ```

- [ ] **Step 5: Verify the app compiles with no TypeScript errors**

  Run: `npm run dev`
  Expected: Frontend and backend start. No TypeScript errors in the terminal output.

- [ ] **Step 6: Manual smoke test — new chat flow**

  1. Open `http://localhost:5173/` in the browser
  2. Verify the input box is centered on the screen (~660px wide), "Vetted." heading above it, subtitle "Your enterprise AI workspace"
  3. Verify placeholder text is "How can I help you today?"
  4. Type a message and press Enter
  5. Verify the input slides to the bottom (animation ~300ms), messages zone appears with the sent message
  6. Verify placeholder changes to "Ask anything... (Shift+Enter for newline)"

- [ ] **Step 7: Manual smoke test — navigation**

  1. Click an existing chat in the sidebar
  2. Verify the input is at the bottom immediately (no animation), messages load correctly
  3. Click "New Chat" in the sidebar
  4. Verify the input returns to center, "Vetted." heading reappears
  5. Navigate directly to a `/chat/:id` URL
  6. Verify the input starts at the bottom (no animation)

- [ ] **Step 8: Manual smoke test — send fails (API error edge case)**

  This is hard to trigger manually. Verify instead that a successful send in step 6 shows a "Message sent" toast and a reply appears.

- [ ] **Step 9: Commit**

  ```bash
  git add src/App.tsx
  git commit -m "feat: add ChatLayout with Claude-style centered-to-bottom input animation"
  ```

---

## Verification Checklist

After all tasks are done, run through this list before considering the feature complete:

- [ ] `/` route: input centered, ~660px wide, "Vetted." heading, subtitle visible
- [ ] `/` route: placeholder is "How can I help you today?"
- [ ] Send a new message: input slides to bottom smoothly (~300ms transition)
- [ ] Active chat: placeholder is "Ask anything... (Shift+Enter for newline)"
- [ ] Active chat: input width is max-w-3xl (wider than new-chat state)
- [ ] Model selector opens upward from bottom toolbar
- [ ] Model selector dot is 8px (w-2 h-2)
- [ ] Send button is circular, gold when active, grey when empty
- [ ] Temperature slider is gone (not visible anywhere in chat input)
- [ ] Share button is gone from chat input
- [ ] Attach file: chip appears inside the box above textarea
- [ ] Sidebar click to existing chat: input at bottom immediately, no animation
- [ ] "New Chat" click: input returns to center, welcome text visible
- [ ] Direct URL to `/chat/:id`: input starts at bottom
- [ ] Shift+Enter inserts newline, Enter sends
- [ ] Textarea grows up to 200px then scrolls
- [ ] First send: a brief "No messages yet" flash before the new chat URL resolves is expected and acceptable
