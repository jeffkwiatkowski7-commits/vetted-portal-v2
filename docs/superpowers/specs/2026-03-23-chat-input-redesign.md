# Chat Input Redesign — Design Spec

**Date:** 2026-03-23
**Status:** Approved

## Overview

Redesign `MainChatPage` to match the Claude-style chat pattern: input centered on an empty new chat, sliding to the bottom once the conversation starts. File upload and model selector move inside the input box. Thinking state shows animated dots plus a collapsible steps panel (all grey, no color cues).

---

## File Changed

**Modify only:** `src/pages/MainChatPage.tsx`

No new files, no API changes, no backend changes.

---

## Layout States

### State 1 — Empty (new chat)

When `messages.length === 0`:

- The greeting (`Good to see you, {firstName}!`) and subtitle are vertically centered in the available space.
- The chat input box is centered below the greeting, `max-width: 560px`, with a subtle box shadow.
- The input box contains:
  - Top: `<textarea>` (placeholder `Ask anything…`, `rows={2}`, auto-grows)
  - Bottom toolbar (inside the box, separated by a thin top border):
    - **Left:** 📎 file attach icon button
    - **Right:** model selector `<select>` → send button

### State 2 — Active (messages present)

When `messages.length > 0`:

- Messages area occupies the top, filling available height, scrollable.
- Input box is bottom-docked, full width, inside a `border-t` container — same internal layout as State 1.
- Transition is immediate (no animation needed) — the state switches on the first send.

---

## Input Box Internals

The input box is a rounded card (`border-radius: 16px`, `border: 1.5px solid #ddd`) containing:

1. `<textarea>` — full width, no resize, placeholder `Ask anything…`, disabled + dimmed while `chatting === true`.
2. Bottom toolbar row (`display: flex; justify-content: space-between`):
   - **Left side:** file attach icon button (`Paperclip` icon, grey). Clicking triggers the hidden `<input type="file">`. Shows `Loader2` spinner while uploading.
   - **Right side:** model `<select>` (existing options: Gemini 3.1 / Opus 4.6) → send button (`Send` icon, `bg-vetted-primary`). Both disabled while `chatting`.

If a file is pending (`pendingFile !== null`), a file chip appears **above** the textarea (inside the input box, above the text area):
- Small pill: `📎 filename.pdf  ✕`
- Clicking ✕ clears `pendingFile`
- All grey / muted styling — no color

The hidden `<input type="file" ref={fileInputRef}>` stays in the DOM as before.

---

## Document in User Bubble

When a message is sent with a file attached, the user bubble shows the filename above the message text:

```
┌─────────────────────────────────────┐
│ 📎 Q3_Lease_Portfolio.pdf           │  ← 50% opacity, small
│ Summarize the key financial risks… │
└─────────────────────────────────────┘
```

This is a display-only change to `ChatBubble` — the content string already contains `[Attached: filename]` prepended by `handleSend`. Parse this prefix out of the displayed text and render it as the chip, showing only the user's actual message text in the bubble body.

**Parsing rule:** if `msg.content` starts with `[Attached: ` parse out the filename (between `[Attached: ` and `]`) and strip everything up to and including the `---\n\n` separator before displaying the message text.

---

## Thinking / Streaming State

While `chatting === true` and the assistant placeholder message is present:

### Dots
The assistant bubble body shows three animated bouncing dots (grey, `#ccc`) while `msg.content === ''`. Once content arrives, the dots are replaced by the rendered markdown.

### Steps panel
Shown above the dots (or above the response bubble once content arrives):

- Collapsed by default to `▸ N steps` toggle once `msg.content` is non-empty.
- Expanded automatically while content is still empty (i.e. while thinking).
- Each step is a monochrome dash line: `– Step text here`
- Tavily web search steps show a plain grey pill badge: `Tavily` (background `#f2f2f2`, color `#aaa`)
  - Detect Tavily steps by checking if the step string contains `"Web search:"` — these come from the existing SSE step events.
- Toggle click flips open/closed.

Steps panel styling: white background, `border: 1px solid #e8e8e8`, `border-radius: 12px`, monospace font, grey text (`#999`).

---

## Disabled State While Chatting

While `chatting === true`:
- Textarea: `disabled`, `opacity-50`, `bg-gray-50`
- File attach button: `disabled`, muted
- Model select: `disabled`, muted
- Send button: `disabled`, `opacity-40`
- The entire input box wrapper gets `opacity-60` or equivalent to visually dim it

---

## What Does NOT Change

- `handleSend` logic — no changes
- `handleFileSelect` logic — no changes
- `ChatBubble` markdown rendering — no changes (only adds dot animation + step display tweak + user bubble filename chip)
- Backend / API — no changes
- Model persistence in `localStorage` — no changes

---

## Out of Scope

- Animated transition between State 1 and State 2
- Auto-growing textarea beyond a max height
- Drag-and-drop file upload
- Multiple file attachments
