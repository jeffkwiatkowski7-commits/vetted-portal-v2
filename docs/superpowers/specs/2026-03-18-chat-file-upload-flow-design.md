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
2. **Click "+ Upload File"** — native file picker opens; user selects a file
3. **Progress bar** — upload view shows XHR progress card with percentage and time estimate
4. **Upload completes** — file auto-selects in browse list and view switches back to browse (already works)
5. **Click "Attach to Chat"** — dialog closes; file is set in `chatAttachedFiles` store; a hidden acknowledgment prompt is auto-sent to the bot
6. **Right panel** — file appears with an always-visible X button; right panel opens automatically
7. **Bot reply** — assistant acknowledges the file (e.g., "I've loaded your file — ask me anything!")

---

## Component Changes

### `ChatInput` (`src/components/chat/ChatInput.tsx`)

The `onAttach` callback passed to `LibraryPickerModal` currently auto-sends `"Please summarize this document."`. This changes to:

1. Call `setChatAttachedFiles(files)` to populate the right panel
2. Call `handleSendMessage` with:
   - `msg`: `"A file has been attached. Please briefly acknowledge it and let the user know you're ready to help with questions about it."`
   - `files`: the attached files array

This prompt is never shown in the UI as a user bubble — it goes directly as the `content` field of the API call, and only the assistant reply is visible. (The current flow already does this pattern with "Please summarize this document." — we're just changing the prompt text and separating the `setChatAttachedFiles` call.)

### `RightPanel` (`src/components/RightPanel.tsx`)

The X (remove) button is currently `opacity-0 group-hover:opacity-100`. Change to always visible:

```
// Before
className="opacity-0 group-hover:opacity-100 p-0.5 text-vetted-text-muted hover:text-vetted-danger transition-all shrink-0"

// After
className="p-0.5 text-vetted-text-muted hover:text-vetted-danger transition-colors shrink-0"
```

No other changes to `RightPanel`.

### `LibraryPickerModal` (`src/components/chat/LibraryPickerModal.tsx`)

No changes. The `onAttach` signature stays `(files: LibraryFile[]) => void`. The modal's internal behavior (progress bar, auto-select after upload, 600ms transition back to browse) is already correct.

---

## Data Flow

```
User clicks "Attach to Chat"
  → onAttach(files) fires in ChatInput
  → setChatAttachedFiles(files)          // populates right panel, opens it
  → handleSendMessage({
      msg: "<hidden acknowledgment prompt>",
      files: files
    })
  → api.chats.streamMessage(chatId, {
      content: "<hidden prompt>",
      attachments: [file.id, ...]
    })
  → backend processes with file IDs
  → assistant reply streams back
  → appears as assistant bubble in ChatView
```

No backend changes required. File IDs flow through the existing `attachments` field in the message payload. Subsequent user messages also include the file IDs (already in `chatAttachedFiles` state).

---

## What Does Not Change

- Upload XHR logic and progress tracking in `LibraryPickerModal`
- Auto-select behavior after upload completes
- The 600ms delay before switching back to browse view
- Right panel toggle behavior
- The `chatAttachedFiles` store shape
- Backend endpoints

---

## Files Touched

| File | Change |
|------|--------|
| `src/components/chat/ChatInput.tsx` | Change `onAttach` callback: new hidden prompt, explicit `setChatAttachedFiles` call |
| `src/components/RightPanel.tsx` | Remove hover-only opacity from X button |

2 files, minimal surface area.
