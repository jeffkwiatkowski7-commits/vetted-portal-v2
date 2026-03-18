# Chat File Upload Flow — Design Spec

**Date:** 2026-03-18
**Branch:** vetted_leases
**Status:** Approved

---

## Overview

Redesign the main chat file upload flow to match a clear 7-step user journey: click paperclip → upload → progress bar → file auto-selected → close dialog → file visible in right panel with X → bot acknowledges the file automatically.

---

## User Flow (7 Steps)

1. **Click paperclip** — opens `LibraryPickerModal` in browse view
2. **"+ Upload File"** — triggers a hidden `<input type="file">`; user selects a file
3. **Progress bar** — upload view shows XHR progress card with percentage and time estimate
4. **Upload completes** — file auto-selects in browse list and view switches back to browse (already works; no change to `LibraryPickerModal`)
5. **"Attach to Chat"** — dialog closes; files are set in `chatAttachedFiles`; a hidden acknowledgment prompt is auto-sent to the bot (no visible user bubble)
6. **Right panel** — file appears with an always-visible X button; right panel opens automatically (`setChatAttachedFiles` in the store already sets `rightPanelOpen: true` — no new store code needed)
7. **Bot reply** — assistant acknowledges the file (e.g., "I've loaded your file — ask me anything!")

For **multiple files**: the hidden prompt uses the plural form and the bot reply acknowledges all of them.

---

## Component Changes

### `ChatInput` (`src/components/chat/ChatInput.tsx`)

#### Change 1: Update `handleSendMessage` overrides type and destructure

Update the overrides parameter type to include `hidden`:

```ts
// Before
const handleSendMessage = async (overrides?: { msg?: string; files?: LibraryFile[] }) => {
  const content = overrides?.msg ?? message;
  const files = overrides?.files ?? chatAttachedFiles;

// After
const handleSendMessage = async (overrides?: { msg?: string; files?: LibraryFile[]; hidden?: boolean }) => {
  const content = overrides?.msg ?? message;
  const files = overrides?.files ?? chatAttachedFiles;
  const hidden = overrides?.hidden ?? false;
```

#### Change 2: Gate side effects that must not fire on hidden sends

**`setMessage('')`** — currently unconditional on line 113. Gate it so a user's in-progress typed text is not erased when the hidden acknowledgment send fires:

```ts
// Before
setMessage('');

// After
if (!hidden) setMessage('');
```

**Optimistic user bubble** — currently unconditional. Gate it so no user message bubble appears for hidden sends:

```ts
// Before
setActiveChat({ ...optimisticChat });

// After
if (!hidden) {
  setActiveChat({ ...optimisticChat });
}
```

**Success toast** — currently unconditional on `addToast({ type: 'success', title: 'Message sent' })`. Suppress for hidden sends:

```ts
// Before
addToast({ type: 'success', title: 'Message sent' });

// After
if (!hidden) addToast({ type: 'success', title: 'Message sent' });
```

**`setLoading`** — `setLoading(true)` and `setLoading(false)` remain unconditional for hidden sends. This means the send button is briefly disabled while the hidden acknowledgment is in flight. On fast networks this is imperceptible; accepted behavior.

**`setAiThinking` and `clearLiveSteps`** — `setAiThinking(true)` causes `ChatView` to render a visible `<ThinkingIndicator>` in the message list. Gate both `setAiThinking` calls and both `clearLiveSteps` calls on `!hidden` to avoid a floating spinner with no associated user message:

```ts
if (!hidden) { clearLiveSteps(); setAiThinking(true); }
// ... await streamMessage ...
if (!hidden) { setAiThinking(false); clearLiveSteps(); }
```

**Post-stream `setActiveChat(updated)`** — the final `setActiveChat(updated)` call after `api.chats.get(chatId)` is unconditional and must remain so. This is the call that delivers the bot's acknowledgment reply into the chat view. It is NOT gated on `!hidden`.

#### Change 3: Replace `onAttach` callback

Remove the existing hard-coded `'Please summarize this document.'` prompt entirely. Replace with:

```ts
// Before
onAttach={(files) => {
  setChatAttachedFiles(files);
  handleSendMessage({ msg: 'Please summarize this document.', files });
}}

// After
onAttach={(files) => {
  setChatAttachedFiles(files);
  const count = files.length;
  const prompt = count === 1
    ? 'A file has been attached. Please briefly acknowledge it and let the user know you are ready to help with questions about it.'
    : `${count} files have been attached. Please briefly acknowledge them and let the user know you are ready to help with questions about them.`;
  handleSendMessage({ msg: prompt, files, hidden: true });
}}
```

#### Edge cases

**No chat exists yet (home `/` route):** `handleSendMessage` creates a new chat and navigates in the no-chat path. With `hidden: true`, the hidden prompt will trigger chat creation and navigation. This is acceptable — the user attached a file so they intend to start a conversation. The chat is created, the bot replies, no user bubble appears.

**Files remain in `chatAttachedFiles` after acknowledgment:** Intentional. Files stay in the right panel and are re-sent as `attachments` on every subsequent user message. This means the bot always has the file context. Users can remove files individually via the X button in the right panel.

---

### `RightPanel` (`src/components/RightPanel.tsx`)

The X (remove) button is currently `opacity-0 group-hover:opacity-100`. Make it always visible:

```tsx
// Before
className="opacity-0 group-hover:opacity-100 p-0.5 text-vetted-text-muted hover:text-vetted-danger transition-all shrink-0"

// After
className="p-0.5 text-vetted-text-muted hover:text-vetted-danger transition-colors shrink-0"
```

No other changes to `RightPanel`.

---

### `LibraryPickerModal` (`src/components/chat/LibraryPickerModal.tsx`)

No changes.

### `src/store/index.ts`

No changes. `setChatAttachedFiles` already sets `rightPanelOpen: true` when files are provided.

---

## Data Flow

```
User clicks "Attach to Chat"
  → onAttach(files) fires in ChatInput
  → setChatAttachedFiles(files)            // right panel populates + opens (existing store behavior)
  → handleSendMessage({ msg: "<hidden prompt>", files, hidden: true })
      setLoading(true)                     // send button briefly disabled
      setMessage('') is SKIPPED           // user's draft text preserved
      optimistic user bubble is SKIPPED   // no user message appears in chat
      setAiThinking(true) is SKIPPED      // no thinking spinner
      clearLiveSteps() is SKIPPED        // (both calls gated on !hidden)
      api.chats.streamMessage(...)        // sends content + attachments to backend
      assistant reply streams back
      setAiThinking(false) is SKIPPED
      clearLiveSteps() is SKIPPED
      setActiveChat(updated) [unconditional] // delivers bot reply into ChatView
      setLoading(false)
      addToast is SKIPPED                 // no "Message sent" toast
```

No backend changes required. File IDs flow through the existing `attachments` field in the message payload.

---

## What Does Not Change

- Upload XHR logic and progress tracking in `LibraryPickerModal`
- Auto-select behavior after upload completes
- The 600ms delay before switching back to browse view
- Right panel toggle behavior
- The `chatAttachedFiles` store shape and `rightPanelOpen` behavior
- Backend endpoints

---

## Files Touched

| File | Change |
|------|--------|
| `src/components/chat/ChatInput.tsx` | Add `hidden` to overrides type; gate `setMessage`, optimistic bubble, and toast on `!hidden`; replace `onAttach` prompt |
| `src/components/RightPanel.tsx` | Remove hover-only opacity from X button |
| `src/store/index.ts` | No changes (confirmed — `rightPanelOpen` already handled) |
| `src/components/chat/LibraryPickerModal.tsx` | No changes |
