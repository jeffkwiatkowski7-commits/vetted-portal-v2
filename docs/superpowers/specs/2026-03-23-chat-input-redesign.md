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

## Data Model Change

Add an optional `attachedFileName` field to the `ChatMessage` interface:

```ts
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: string[];
  attachedFileName?: string; // filename of attached file, if any
}
```

In `handleSend`, when building the user message object, set `attachedFileName: pendingFile?.name ?? undefined`.

---

## Layout States

### State 1 — Empty (new chat)

When `messages.length === 0`, render a single centered column using `flex-1 flex flex-col items-center justify-center gap-6 px-4 pb-16`:

```
┌─ flex-1 flex flex-col items-center justify-center gap-6 ─┐
│  Greeting + subtitle (text-center)                        │
│  Input card (max-w-[560px] w-full shadow-md)              │
└──────────────────────────────────────────────────────────┘
```

Both the greeting and the input card are children of this centered column — the input card is **inside** the centering container, not below it.

### State 2 — Active (messages present)

When `messages.length > 0`:

- Messages area: `flex-1 overflow-y-auto p-6 space-y-4` (same as current).
- Input box is bottom-docked inside a `border-t border-vetted-border p-4` container, `w-full` (no max-width cap).
- Transition is immediate — no animation.

---

## Input Box Internals

**This is a structural refactor.** The current code lays out the file chip, textarea, paperclip button, and send button as siblings in a single horizontal `flex` row. Replace that entire structure with a white rounded card (`rounded-2xl border border-vetted-border p-3`) whose children stack vertically:

Internal layout (top to bottom):

1. **File chip row** — only rendered when `pendingFile !== null`:
   - `flex items-center gap-1.5 px-2 py-1 bg-vetted-surface border border-vetted-border rounded-lg text-xs text-vetted-text-muted mb-2 w-fit`
   - Content: `<Paperclip size={11} />  filename.pdf  <X size={11} />` (clicking X clears `pendingFile`)

2. **Textarea** — full width, `resize-none`, placeholder `Ask anything…`, `rows={2}`, `disabled` while `chatting`.

3. **Bottom toolbar** — `flex items-center justify-between pt-2 mt-1 border-t border-vetted-border`:
   - **Left:** `<Paperclip>` icon button — triggers `fileInputRef.current?.click()`. Shows `<Loader2 className="animate-spin">` while `fileLoading`. Styling: `p-1.5 rounded-lg border border-vetted-border text-vetted-text-muted hover:text-vetted-primary disabled:opacity-40`.
   - **Right:** `flex items-center gap-2`:
     - Model `<select>` — existing options (Gemini 3.1 / Opus 4.6), persisted in localStorage. Styling: `text-xs border border-vetted-border rounded-lg px-2 py-1 text-vetted-text-secondary bg-white focus:outline-none`.
     - Send button — `<Send size={16}>` / `<Loader2 size={16} className="animate-spin">`. Styling: `p-1.5 rounded-lg bg-vetted-primary text-white disabled:opacity-40`.

**Send button disabled condition:** `!input.trim() || chatting` — a file alone without text does NOT enable send.

The hidden `<input type="file" ref={fileInputRef}>` stays in the DOM as before.

---

## Disabled State While Chatting

While `chatting === true`, the entire input card wrapper gets `opacity-60 pointer-events-none` to visually dim and block interaction. The textarea also keeps its `disabled` prop for correct accessibility semantics and to prevent focus. Other individual `disabled` props are not needed beyond the textarea.

---

## User Bubble — Filename Chip

When `msg.attachedFileName` is set on a user message, render a small chip above the message text inside the bubble:

```tsx
{msg.attachedFileName && (
  <div className="flex items-center gap-1 opacity-50 mb-1 text-[11px]">
    <Paperclip size={10} />
    <span>{msg.attachedFileName}</span>
  </div>
)}
<div>{msg.content}</div>
```

`msg.content` for user messages is always the raw user text (no `[Attached: ...]` prefix — that prefix only exists in `userContent` which is sent to the API, never stored in state). No parsing is needed.

---

## Thinking / Streaming State

### Animated dots

While the assistant placeholder message has `msg.content === ''`, render three bouncing grey dots instead of the markdown area:

```tsx
<div className="flex items-center gap-1 py-2">
  <span className="w-2 h-2 bg-vetted-text-muted rounded-full animate-bounce [animation-delay:0ms]" />
  <span className="w-2 h-2 bg-vetted-text-muted rounded-full animate-bounce [animation-delay:150ms]" />
  <span className="w-2 h-2 bg-vetted-text-muted rounded-full animate-bounce [animation-delay:300ms]" />
</div>
```

Use Tailwind's built-in `animate-bounce` with staggered delays via arbitrary `[animation-delay:Xms]` values. Once `msg.content` is non-empty, show the markdown instead.

### Steps panel

The existing `stepsOpen` state and collapse behavior is preserved exactly as-is (`useState(!msg.content)` + `useEffect` that sets to `false` when content arrives — already in the code, do not reimplement).

**Styling changes to the steps panel:**

Current code renders raw step strings in a `bg-gray-50 border-vetted-border rounded-lg font-mono` div. Update to:
- Background: `white` instead of `bg-gray-50`
- Border: keep `border-vetted-border`
- Border radius: `rounded-xl`
- Each step: prepend `– ` in the render loop (the step strings themselves do not contain dashes)
- If the step string starts with `Web search:` (e.g. `Web search: "commercial lease risk"`), append a grey pill badge: `<span className="ml-1.5 text-[10px] bg-vetted-surface text-vetted-text-muted px-1.5 py-0.5 rounded">Tavily</span>`

**Toggle button:** Keep the existing `<ChevronDown size={12}>` / `<ChevronUp size={12}>` lucide icons with `{msg.steps.length} steps` label text. No change needed.

---

## ChatBubble Changes Summary

The `ChatBubble` component needs these targeted changes (markdown rendering and `normalizeMarkdown` are untouched):

1. Add animated dots when `msg.content === ''`
2. Update steps panel styling (white bg, dash prefix, Tavily badge)
3. Render `msg.attachedFileName` chip in user bubbles

---

## What Does NOT Change

- `handleSend` logic (except setting `attachedFileName` on the user message object)
- `handleFileSelect` logic
- Markdown rendering components inside `ChatBubble`
- `normalizeMarkdown` function
- Model persistence in `localStorage`
- Backend / API
- `attachedFileName` is intentionally not persisted to the backend. When a chat is reloaded from history, user bubbles will not show the filename chip — this is acceptable.

---

## Out of Scope

- Animated transition between State 1 and State 2
- Auto-growing textarea beyond a max height
- Drag-and-drop file upload
- Multiple file attachments
