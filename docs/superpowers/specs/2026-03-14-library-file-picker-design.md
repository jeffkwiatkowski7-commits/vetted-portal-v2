# Library File Picker — Design Spec

**Date:** 2026-03-14
**Status:** Approved

## Overview

When a user clicks the paperclip icon in the main chat input, a centered modal opens giving them access to their Library. They can browse and select multiple existing files via checkboxes, or upload new files with a detailed per-file progress bar. After clicking "Attach to Chat," the modal closes and selected files appear as chips in the chat input — matching Claude's attachment UX.

---

## Existing API & Types (no new backend needed except one change)

`LibraryFile` is already defined in `src/types/index.ts`:
```ts
interface LibraryFile {
  id: string;
  user_id: string;
  filename: string;        // disk name
  original_name: string;  // display name
  file_path: string;
  file_type: string;       // extension (pdf, xlsx, etc.)
  file_size: number;       // bytes
  mime_type: string;
  project_id?: string;
  uploaded_at: string;     // ISO timestamp
}
```

`src/api/index.ts` already exports:
- `api.library.list()` — `GET /api/library` — returns `LibraryFile[]`
- `api.library.upload(file)` — not used directly (we use XHR for progress); the endpoint is `POST /api/library/upload`, multipart/form-data, field name `file`, no file type or size restriction — returns `{ file: LibraryFile }`

**Backend (server/index.js):** No change needed. Express's `POST /api/chats/:chatId/messages` destructures `{ content, attachments }` and silently ignores all other body fields — `attachment_ids` will pass through without a 400. No database storage of attachment IDs is required for this feature.

---

## Component: `LibraryPickerModal`

**File:** `src/components/chat/LibraryPickerModal.tsx`

**Props:**
```ts
interface LibraryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAttach: (files: LibraryFile[]) => void;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
}
```

**Note on `onAttach` behavior:** Calling `onAttach(files)` replaces the entire chip set in `ChatInput`. The modal does not receive or reflect the current chip state — opening the modal a second time always starts with no pre-checked files. This is intentional.

---

### Internal State Shape

```ts
type UploadCard = {
  file: File;                           // original File object, retained for Retry
  xhr: XMLHttpRequest;                  // per-card XHR instance
  uploadStartTime: number;              // set in onloadstart
  status: 'uploading' | 'done' | 'error';
  loaded: number;
  total: number;
  result?: LibraryFile;                 // set on success
};

type ModalView = 'browse' | 'upload';

// Component state
view: ModalView                         // 'browse' | 'upload'
files: LibraryFile[]                    // loaded from api.library.list()
fetchStatus: 'loading' | 'error' | 'done'
searchQuery: string
selectedIds: Set<string>               // persists across browse↔upload transitions
cards: UploadCard[]                    // accumulate per session; max 5
```

**Selection persistence:** `selectedIds` is preserved when entering/exiting Upload View. When returning to Browse after upload, the new file's ID is added to `selectedIds`.

---

### Browse View

**Header:** "LIBRARY" (gold, uppercase) · "Upload File" `<label>` wrapping a hidden `<input type="file" accept="*/*">` (no `multiple` attribute — one file at a time by design) · ✕ close button. The hidden file input is **disabled** while any card has `status === 'uploading'` (prevents triggering a second upload mid-flight).

**Loading state:** While `fetchStatus === 'loading'`, show a centered 24px gold spinner. No file list.

**Error state:** `fetchStatus === 'error'` → centered "Failed to load files" + "Retry" link (re-calls `api.library.list()`, sets `fetchStatus = 'loading'`).

**Empty state:** `fetchStatus === 'done'` and `files.length === 0` → centered "No files yet — upload one above."

**Search:** `<input>` below header. Filters rows client-side: `files.filter(f => f.original_name.toLowerCase().includes(searchQuery.toLowerCase()))`. Updates on every keystroke, no debounce.

**File list:** `overflow-y: auto; max-height: 320px`. One row per filtered file.

Each row contains:
- **Checkbox** (14×14px square): gold fill + white checkmark if `selectedIds.has(f.id)`, else `#444` border. Clicking anywhere on row calls `toggleId(f.id)` (adds/removes from `selectedIds`).
- **File type badge** (20×20px — see Badge Colors)
- **Filename** (`original_name`; `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px`)
- **File size** (formatted: `< 1024` → "X B"; `< 1048576` → "X KB"; else "X.X MB")
- **Upload date** (`uploaded_at` → "MMM D, YYYY")

Selected row: `border-left: 2px solid #C4A962; background: #1e1e1e`
Unselected row: `border-left: 2px solid transparent; background: #161616`

**Footer:** Left — "N file(s) selected" (hidden when N=0). Right — "Attach to Chat" button:
- Disabled + `opacity: 0.4; pointer-events: none` when `selectedIds.size === 0`
- Active (gold) when `selectedIds.size ≥ 1`
- On click: collect `files.filter(f => selectedIds.has(f.id))`, call `onAttach(selection)`, then `onClose()`

---

### Upload View

Triggered when the user picks a file (hidden input `onChange`). Sets `view = 'upload'`. Header remains; "Upload File" label/input and "Attach to Chat" are not rendered. Footer shows only "Cancel."

**"Cancel" button:** Iterates `cards` — for every card with `status === 'uploading'`, calls `card.xhr.abort()`. Then sets `cards = []`, sets `view = 'browse'`. Files that completed before Cancel remain in the library; their results are not added to `files` or `selectedIds` on a Cancel.

**Per-file progress card** (one per upload attempt in this modal session; max 5 — see below):

```
[ TYPE ]  original_name                           67%
▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░
  2.8 MB / 4.2 MB                    Uploading... ~3s left
```

Card style: `background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 14px`

- **Top row:** type badge · `original_name` · percentage (right-aligned, `#C4A962`, 10px)
- **Progress bar:** `height: 6px; border-radius: 100px`. Track: `#2a2a2a`. Fill: `linear-gradient(90deg, #C4A962, #e8c97a); transition: width 0.2s ease; width: {loaded/total*100}%`
- **Sub-row:** `"{loadedFormatted} / {totalFormatted}"` left · time estimate right (both `font-size: 8px; color: #666`)

**Time estimate computation** (run only inside `onprogress`, skip if conditions not met):
```ts
if (card.uploadStartTime === 0 || event.loaded === 0) {
  // skip computation; display = "Calculating..."
  return;
}
const elapsedMs = Date.now() - card.uploadStartTime;
if (elapsedMs === 0) {
  // skip computation; display = "Calculating..."
  return;
}
const rate = event.loaded / elapsedMs;           // bytes per ms
const remainingMs = (event.total - event.loaded) / rate;
// Suppress display for first 1000ms of upload
if (elapsedMs < 1000) {
  display = "Calculating...";
} else if (remainingMs < 60000) {
  display = `~${Math.ceil(remainingMs / 1000)}s left`;
} else {
  display = `~${Math.ceil(remainingMs / 60000)}m left`;
}
```

**On completion** (`xhr.onload` and `xhr.status` in 2xx range):
- Set `card.status = 'done'`, bar → 100% `#2ecc71`, percentage → green "✓", sub-row → "Upload complete · Added to Library" in `#2ecc71`
- After 600ms: set `view = 'browse'`, push `card.result` (from response JSON `data.file`) to `files`, add `card.result.id` to `selectedIds`
- Re-focus search input after returning to Browse (`searchInputRef.current?.focus()`)

**On error** (`xhr.onerror` or `xhr.onload` with non-2xx status):
- Set `card.status = 'error'`, bar → 100% `#e74c3c`, sub-row → "Upload failed" + "Retry" button
- "Retry": create a new `XMLHttpRequest` instance, replace `card.xhr` with the new instance, reset `card.loaded = 0`, `card.uploadStartTime = 0`, `card.status = 'uploading'`, then run the XHR (same `card.file` object). The card stays in its existing position; progress resets to 0%.

**Max 5 cards rule:** Before adding a new card, if `cards.length === 5`: remove the first card whose `status === 'done'`. If no completed cards exist (all are `'uploading'` or `'error'`), remove `cards[0]` (oldest regardless of status).

**XHR setup** (one per card; stored as `card.xhr`):
```ts
const xhr = new XMLHttpRequest();
xhr.open('POST', '/api/library/upload');
xhr.setRequestHeader('X-User-Id', localStorage.getItem('userId') || '');
const formData = new FormData();
formData.append('file', file);
xhr.upload.onloadstart = () => { card.uploadStartTime = Date.now(); };
xhr.upload.onprogress = (e) => { card.loaded = e.loaded; card.total = e.total; /* re-render */ };
xhr.onload = () => { /* success or error check by xhr.status */ };
xhr.onerror = () => { /* error */ };
xhr.send(formData);
```

---

### Modal Shell

**Backdrop:** `position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 50`

**Modal panel:** `position: relative; background: #111; border-radius: 10px; width: 520px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px); display: flex; flex-direction: column; overflow: hidden`

**Closing:**
- Backdrop click (on backdrop element, not modal) → `onClose()`
- `Escape` keydown listener attached to `document` on mount, removed on unmount → `onClose()`
- If `onClose()` called while any card has `status === 'uploading'`: iterate cards, abort each in-flight XHR before closing

**Focus management:**
- On open: `setTimeout(() => searchInputRef.current?.focus(), 0)` (Browse View). If entering Upload View, no auto-focus.
- On return to Browse after upload: `searchInputRef.current?.focus()`
- **Focus trap:** `keydown` handler on the modal `<div>`: intercepts `Tab` and `Shift+Tab`, queries all focusable descendants (`button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])`), wraps focus to first/last
- On close: `returnFocusRef.current?.focus()`

**ARIA:** `role="dialog"`, `aria-modal="true"`, `aria-label="Library file picker"`

---

## Component: `ChatInput` changes

**File:** `src/components/chat/ChatInput.tsx`

- Remove `attachment: File | null` state, native hidden file `<input>`, `fileInputRef`
- Add `attachedFiles: LibraryFile[]` (default `[]`)
- Add `isPickerOpen: boolean` (default `false`)
- Add `paperclipButtonRef = useRef<HTMLButtonElement>(null)`

Paperclip button: `<button ref={paperclipButtonRef} onClick={() => setIsPickerOpen(true)}>`

Render:
```tsx
<LibraryPickerModal
  isOpen={isPickerOpen}
  onClose={() => setIsPickerOpen(false)}
  onAttach={(files) => setAttachedFiles(files)}
  returnFocusRef={paperclipButtonRef}
/>
```

**File chips** (rendered above textarea when `attachedFiles.length > 0`):
```
Tailwind container: flex flex-wrap gap-[6px] pb-2
Each chip: bg-[#252525] border border-[#333] rounded-md px-2 py-1 flex items-center gap-[6px]
  → file type badge (16×16px)
  → <span className="truncate max-w-[150px] text-[10px] text-[#ccc]">{f.original_name}</span>
  → <button onClick={() => setAttachedFiles(prev => prev.filter(x => x.id !== f.id))}>✕</button>
```

**On send:** existing send handler adds `attachment_ids: attachedFiles.map(f => f.id)` to POST body. After successful send: `setAttachedFiles([])`.

---

## Badge Colors

| `file_type` | Background |
|-------------|------------|
| `pdf` | `#e74c3c` |
| `xls` / `xlsx` / `csv` | `#1e7e34` |
| `doc` / `docx` | `#2980b9` |
| `txt` / `md` | `#7f8c8d` |
| `png` / `jpg` / `jpeg` / `gif` | `#8e44ad` |
| anything else | `#555555` |

Badge style: `width: 20px; height: 20px; border-radius: 3px; font-size: 7px; font-weight: 700; color: #fff; display: flex; align-items: center; justify-content: center`
Badge text: `file_type.toUpperCase().slice(0, 3)`

---

## Data Flow

```
User clicks 📎
  → isPickerOpen = true → LibraryPickerModal mounts
  → api.library.list() → spinner → file list populates
  → User toggles checkboxes (multi-select; selectedIds set)
  → OR: user clicks "Upload File" → file input fires → new XHR per file
      → view = 'upload'; card accumulates
      → onprogress updates card.loaded, estimate recalculates
      → on done (600ms): view = 'browse', file appended + pre-selected, search focused
  → User clicks "Attach to Chat"
  → onAttach(files filtered by selectedIds) called
  → onClose() → isPickerOpen = false → modal unmounts
  → chips render in ChatInput above textarea
  → User types + sends
  → POST body includes attachment_ids: [...]
  → setAttachedFiles([])
```

---

## Out of Scope

- AI processing of file content (mock AI ignores `attachment_ids`)
- Drag-and-drop into the modal
- Project/folder filtering in picker
- Parallel (concurrent) uploads
- Pagination of file list
- Reflecting prior chip state inside the modal on re-open
