# Claude-Style Chat Input Design

**Date:** 2026-03-14
**Status:** Approved

## Overview

Redesign the chat input to match Claude.ai's UX pattern: input centered on screen when starting a new chat, sliding to the bottom after the first message is sent. Includes a new single-box input layout with model selector in the bottom-right and temperature slider removed from the default view.

---

## Goals

- Center the chat input vertically and horizontally when no conversation is active
- Animate the input to the bottom of the screen when the first message is sent
- Redesign the input box to match Claude.ai's visual style and ~660px width
- Move the model selector to the bottom-right of the input box
- Remove the temperature slider from the default view

---

## Files Changed

| File | Change |
|------|--------|
| `src/App.tsx` | Add `ChatLayout` component; render it for both `/` and `/chat/:id` routes |
| `src/components/chat/ChatInput.tsx` | New single-box layout; toolbar with attach (left), model + send (right); remove temp slider |
| `src/components/chat/ChatView.tsx` | Replace `!activeChat` welcome fallback with empty `<div className="flex-1" />` (keeps null-safety, removes welcome text) |

---

## Layout Architecture

### ChatLayout (new component in App.tsx)

`ChatLayout` is a **persistent layout wrapper** that must stay mounted as the user navigates between `/` and `/chat/:id`. This is the prerequisite for the slide-down animation: `onStart?.()` fires inside `handleSendMessage` (before `navigate()`), setting `isStarted=true` and starting the animation — but if `ChatLayout` were remounted by route change, the animation would be interrupted and the component would start fresh with `isStarted=true` (no animation).

**Route structure in `App.tsx`** — replace the current two sibling `<Route>` entries with a single parent layout route:

```tsx
<Route element={<ChatLayout />}>
  <Route path="/" element={null} />
  <Route path="/chat/:id" element={null} />
</Route>
```

`ChatLayout` renders an `<Outlet />` in place of any child route content (both routes render null). Because it is the parent element, React Router keeps `ChatLayout` mounted across navigation between `/` and `/chat/:id`, allowing `id` to update in place and triggering the `useEffect` below.

`ChatLayout` manages one boolean: `isStarted`.

**Initialization:**
- On `/` route: `isStarted` initializes to `false`
- On `/chat/:id` route: `isStarted` initializes to `true`

**Route navigation (sidebar clicks):**
Because `ChatLayout` is a persistent layout component (stays mounted), React Router updates the `id` param in place rather than remounting. `ChatLayout` uses a `useEffect` keyed on `id` to reset `isStarted` whenever navigation occurs:

```tsx
const { id } = useParams<{ id?: string }>();
const [isStarted, setIsStarted] = useState(!!id);

useEffect(() => {
  setIsStarted(!!id); // true for /chat/:id, false for /
}, [id]);
```

This handles all navigation cases:
- Sidebar click to existing chat → `id` changes → `isStarted = true`
- "New Chat" button (navigates to `/`) → `id` becomes undefined → `isStarted = false`
- Direct URL load → initialized correctly on mount

### Layout zones

The component renders four stacked zones in a `flex flex-col h-full overflow-hidden` container:

```
┌────────────────────────────────────────────┐
│ [Messages zone]                            │ max-h-0 opacity-0 → max-h-[100vh] opacity-100
│   <ChatView />                             │ overflow-y-auto, only rendered when isStarted
├────────────────────────────────────────────┤
│ [Welcome zone]                             │ max-h-screen opacity-100 → max-h-0 opacity-0
│   "Vetted." heading                        │ overflow-hidden, collapsed when isStarted
│   subtitle: "Your enterprise AI workspace" │
├────────────────────────────────────────────┤
│ [Input zone]                               │ always rendered, wrapper width transitions
│   <ChatInput onStart={handleStart} />      │ max-w-[660px] → max-w-3xl
├────────────────────────────────────────────┤
│ [Bottom spacer]                            │ max-h-[45vh] → max-h-0 (drives slide-down)
└────────────────────────────────────────────┘
```

### CSS transitions

All transitions use `transition-all duration-300 ease-in-out` (Tailwind standard `duration-300`).

| Zone | `!isStarted` | `isStarted` |
|------|-------------|-------------|
| Messages | `max-h-0 opacity-0 overflow-hidden` | `flex-1 max-h-[100vh] opacity-100 overflow-y-auto` |
| Welcome | `flex-1 max-h-screen flex items-center justify-center opacity-100` | `max-h-0 opacity-0 overflow-hidden` |
| Input wrapper | `max-w-[660px] mx-auto px-4 w-full` | `max-w-3xl mx-auto px-4 w-full` (wider gives more reading width once the message thread is visible) |
| Bottom spacer | `max-h-[45vh] overflow-hidden` | `max-h-0 overflow-hidden` |

The bottom spacer is an empty `<div aria-hidden="true" />`. Its collapsing (45vh → 0) is what creates the visible downward "slide" of the input. Combined with the welcome zone fading out and the messages zone fading in, this gives the full Claude-style transition.

**Note:** The messages zone uses `max-h-[100vh]` (not `flex-1`) in its animated state so that CSS can interpolate the height change. Once stable, it also has `flex-1` applied via a class so it fills remaining space. Both classes can coexist; `flex-1` handles the steady-state layout while the `max-h` handles the transition.

### `ChatView` is conditionally rendered

`ChatView` is only mounted inside the messages zone when `isStarted === true`. This prevents `ChatView`'s internal `useEffect` (which fetches the chat) from running during the centered/empty state.

```tsx
{isStarted && (
  <div className={`transition-all duration-300 ...`}>
    <ChatView />
  </div>
)}
```

The `!activeChat` welcome fallback in `ChatView.tsx` (lines 35–44) is **replaced** with an early return of `<div className="flex-1" />` (empty placeholder). The welcome heading text is removed, but the null-safety check for `activeChat` must be retained — `ChatView` is mounted while `isStarted=true` but before `navigate()` resolves and before any fetch completes, so `activeChat` is `null` during that window. Without the guard, the line `const messages = activeChat.messages || []` would throw a TypeError.

**This replacement and the conditional mount (`isStarted &&`) must be implemented together.**

`ChatView` retains its existing `if (loading)` guard unchanged.

**Note on `useParams` in a pathless layout route:** React Router v6 pathless layout routes propagate child dynamic segments to `useParams` in the layout component. `ChatLayout` uses `useParams<{ id?: string }>()` and will correctly receive the `:id` param from the matched `/chat/:id` child route, even though the parent `<Route>` has no `path`.

---

## ChatInput Redesign

### Props

```tsx
interface ChatInputProps {
  onStart?: () => void;    // called on every send; ChatLayout's setState is idempotent
  isStarted?: boolean;     // controls placeholder text; passed from ChatLayout
}
```

`onStart?.()` is called at the top of `handleSendMessage` on every invocation. Since `setIsStarted(true)` is idempotent (calling it multiple times has no effect after the first), no guard or ref is needed inside `ChatInput`.

### Visual structure

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  [Attachment chip if file attached]                 │
│                                                     │
│  Textarea                                           │
│  placeholder varies by isStarted (passed as prop)  │
│  min-height: 52px, max-height: 200px, auto-resize  │
│  no border, no outline, padding: 16px 16px 8px     │
│                                                     │
├─────────────────────────────────────────────────────┤
│  📎                    [● Claude ▾]  [→]           │
│  (attach)              (model)      (send)          │
└─────────────────────────────────────────────────────┘
```

The attachment chip (shown when a file is selected) renders **inside** the outer box, above the textarea, with `px-4 pt-3` padding.

### Outer box

- `rounded-2xl border border-vetted-border shadow-sm bg-white`
- `w-full` — width constrained by the parent wrapper in `ChatLayout`

### Textarea

- `border-none outline-none resize-none bg-transparent w-full`
- `px-4 pt-4 pb-2 text-base leading-relaxed`
- `rows={1}`, auto-expands via `scrollHeight` capped at `200px` (intentionally increased from the current `120px` in source to match Claude.ai)
- Placeholder:
  - When `!isStarted` (new chat): `"How can I help you today?"`
  - When `isStarted` (active chat): `"Ask anything... (Shift+Enter for newline)"`
  - `isStarted` is passed from `ChatLayout` as a prop to `ChatInput`: `placeholder={isStarted ? "Ask anything..." : "How can I help you today?"}`

### Bottom toolbar

- `flex items-center justify-between px-3 pb-3`
- **Left:** Paperclip icon button (`size={18}`, `text-vetted-text-muted hover:text-vetted-primary transition-colors`)
- **Right:** `flex items-center gap-2` — model selector + send button

### Model selector (bottom-right)

- Pill button: `flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm hover:bg-vetted-surface transition-colors`
- Contents: color dot (`w-2 h-2 rounded-full`, **8px** — intentionally smaller than the previous `w-3 h-3` used in the old top toolbar), model name, `ChevronDown size={14}`
- Dropdown opens **upward**: `absolute bottom-full right-0 mb-1 bg-white border border-vetted-border rounded-xl shadow-lg min-w-[140px] z-10`
- Dropdown items: same models as before (Claude, ChatGPT, Gemini)

### Send button

- `rounded-full w-8 h-8 flex items-center justify-center transition-colors`
- Active: `bg-vetted-accent text-vetted-primary hover:bg-vetted-accent-dark`
- Inactive: `bg-vetted-border text-vetted-text-muted cursor-not-allowed`
- `Send size={16}` icon (slightly smaller than current `size={20}`)

### Removed

- Temperature slider (`<input type="range">`) — removed entirely; `temperature` state stays in `ChatInput` hardcoded to `0.7` for API calls
- The top controls row (model + temp + share) — fully replaced by new bottom toolbar
- Share button — removed from chat input

---

## State Management

No new Zustand store state. `isStarted` is local `useState` inside `ChatLayout`, reset via `useEffect` on route `id` param changes.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| User navigates to `/chat/:id` directly | `isStarted` initializes to `true` (from `!!id`), input at bottom, no animation |
| User clicks chat in sidebar | `id` param changes → `useEffect` sets `isStarted = true` |
| User clicks "New Chat" | Navigates to `/` → `id` = undefined → `useEffect` sets `isStarted = false`, input centered |
| Send fails (API error) | `isStarted` stays `true` (animation already fired), toast shown |
| User opens `/chat/:id` with no messages | `isStarted = true`, `ChatView` renders with "No messages yet" text, input at bottom |
| Multiple sends in same chat | `onStart?.()` called each time, `setIsStarted(true)` is idempotent — no issue |
| First send: `isStarted=true` before `navigate()` | `onStart?.()` fires immediately, mounting `ChatView` while route is still `/` (id=undefined). `ChatView`'s fetch guard (`if (id && ...)`) does nothing, so "No messages yet" briefly shows during the API call. This flash is acceptable — it is covered by the animation and resolves once `navigate('/chat/:id')` runs. |

---

## Non-Goals

- Temperature slider is not added to a popover/settings panel in this scope
- No changes to share functionality
- No changes to file attachment upload behavior (only chip display location moves inside the box)
- No changes to keyboard shortcuts (Enter to send, Shift+Enter for newline)
- No changes to message rendering in `ChatView`
