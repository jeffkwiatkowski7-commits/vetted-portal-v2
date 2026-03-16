# Library File Picker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the chat input paperclip to a centered Library modal where users can multi-select existing files and/or upload new ones with a detailed progress bar, with selected files appearing as dismissible chips in the chat input.

**Architecture:** A new `LibraryPickerModal` component owns all browse/upload logic and communicates back to `ChatInput` via an `onAttach` callback. A shared `FileTypeBadge` component is used in both the modal rows and the chat input chips. `ChatInput` replaces its single-file `attachment` state with a `LibraryFile[]` array and renders chips above the textarea.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, XMLHttpRequest (for upload progress — intentionally bypasses `api.library.upload` which uses `fetch` and provides no progress events), Lucide React icons, existing `/api/library` backend endpoints.

**Backend field note:** The existing `POST /api/chats/:id/messages` endpoint already handles an `attachments` field (stored as JSON string in the messages table). Use `attachments: attachedFiles.map(f => f.id)` — not `attachment_ids`.

**Note:** No test runner is configured in this project. Verification steps use `npm run dev` and manual browser testing.

---

## Chunk 1: FileTypeBadge + formatFileSize

**Files:**
- Create: `src/components/chat/FileTypeBadge.tsx`
- Create: `src/utils/formatFileSize.ts`

---

### Task 1: Create `formatFileSize` utility

**Files:**
- Create: `src/utils/formatFileSize.ts`

- [ ] **Step 1: Create the file**

```ts
// src/utils/formatFileSize.ts
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build 2>&1 | tail -5`
Expected: exit 0, no TypeScript errors mentioning `formatFileSize`

---

### Task 2: Create `FileTypeBadge` component

This component is used in both the modal file rows (20×20px) and the chat input chips (16×16px).

**Files:**
- Create: `src/components/chat/FileTypeBadge.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/chat/FileTypeBadge.tsx
import React from 'react';

const BADGE_COLORS: Record<string, string> = {
  pdf: '#e74c3c',
  xls: '#1e7e34',
  xlsx: '#1e7e34',
  csv: '#1e7e34',
  doc: '#2980b9',
  docx: '#2980b9',
  txt: '#7f8c8d',
  md: '#7f8c8d',
  png: '#8e44ad',
  jpg: '#8e44ad',
  jpeg: '#8e44ad',
  gif: '#8e44ad',
};

function getBadgeColor(fileType: string): string {
  return BADGE_COLORS[fileType.toLowerCase()] ?? '#555555';
}

interface FileTypeBadgeProps {
  fileType: string;
  size?: number; // defaults to 20
}

export default function FileTypeBadge({ fileType, size = 20 }: FileTypeBadgeProps) {
  const label = fileType.toUpperCase().slice(0, 3);
  const bg = getBadgeColor(fileType);
  const fontSize = size <= 16 ? 6 : 7;

  return (
    <div
      style={{
        width: size,
        height: size,
        background: bg,
        borderRadius: 3,
        fontSize,
        fontWeight: 700,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build 2>&1 | tail -5`
Expected: exit 0, no TS errors

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/FileTypeBadge.tsx src/utils/formatFileSize.ts
git commit -m "feat: add FileTypeBadge component and formatFileSize utility"
```

---

## Chunk 2: LibraryPickerModal

**Prerequisite:** Chunk 1 must be completed first. `src/components/chat/FileTypeBadge.tsx` and `src/utils/formatFileSize.ts` must exist before this chunk compiles.

**Files:**
- Create: `src/components/chat/LibraryPickerModal.tsx`

This is the main modal component. It has two internal views: Browse and Upload.

---

### Task 3: Modal shell + Browse View (static/loading states)

- [ ] **Step 1: Create the component with shell + browse scaffolding**

```tsx
// src/components/chat/LibraryPickerModal.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, Search } from 'lucide-react';
import * as api from '../../api';
import { LibraryFile } from '../../types';
import FileTypeBadge from './FileTypeBadge';
import { formatFileSize } from '../../utils/formatFileSize';

export interface LibraryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAttach: (files: LibraryFile[]) => void;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
}

type UploadCard = {
  id: string; // local key, e.g. crypto.randomUUID()
  file: File;
  xhr: XMLHttpRequest;
  uploadStartTime: number;
  status: 'uploading' | 'done' | 'error';
  loaded: number;
  total: number;
  displayEstimate: string;
  result?: LibraryFile;
};

type ModalView = 'browse' | 'upload';

export default function LibraryPickerModal({
  isOpen,
  onClose,
  onAttach,
  returnFocusRef,
}: LibraryPickerModalProps) {
  const [view, setView] = useState<ModalView>('browse');
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [fetchStatus, setFetchStatus] = useState<'loading' | 'error' | 'done'>('loading');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<UploadCard[]>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // ── Fetch library on open ──────────────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    setFetchStatus('loading');
    try {
      const data = await api.library.list();
      setFiles(data);
      setFetchStatus('done');
    } catch {
      setFetchStatus('error');
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setView('browse');
      setSearchQuery('');
      setSelectedIds(new Set());
      setCards([]);
      loadFiles();
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen, loadFiles]);

  // ── Escape key ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]); // handleClose stable via useCallback below

  // ── Focus trap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;
    const modal = modalRef.current;
    const getFocusable = () =>
      Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    modal.addEventListener('keydown', trapFocus);
    return () => modal.removeEventListener('keydown', trapFocus);
  }, [isOpen]);

  // ── Close ──────────────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    // Abort any in-flight uploads
    cards.forEach((c) => { if (c.status === 'uploading') c.xhr.abort(); });
    onClose();
    setTimeout(() => returnFocusRef.current?.focus(), 0);
  }, [cards, onClose, returnFocusRef]);

  // ── Filtered files ─────────────────────────────────────────────────────────
  const filteredFiles = files.filter((f) =>
    f.original_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedFiles = files.filter((f) => selectedIds.has(f.id));

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={handleClose}
      />

      {/* Modal panel */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Library file picker"
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col"
        style={{
          background: '#111',
          borderRadius: 10,
          width: 520,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ background: '#1a1a1a', borderBottom: '1px solid #2a2a2a' }}
        >
          <span style={{ color: '#C4A962', fontSize: 12, fontWeight: 700, letterSpacing: '1.5px' }}>
            LIBRARY
          </span>
          <div className="flex items-center gap-2">
            {view === 'browse' && (
              <>
                <label
                  htmlFor="library-file-input"
                  className="cursor-pointer px-3 py-1 rounded text-xs font-semibold"
                  style={{
                    background: '#C4A962',
                    color: '#000',
                    opacity: cards.some((c) => c.status === 'uploading') ? 0.4 : 1,
                    pointerEvents: cards.some((c) => c.status === 'uploading') ? 'none' : 'auto',
                  }}
                >
                  + Upload File
                </label>
                <input
                  id="library-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept="*/*"
                  className="hidden"
                  disabled={cards.some((c) => c.status === 'uploading')}
                  onChange={handleFileInputChange}
                />
              </>
            )}
            <button
              onClick={handleClose}
              className="p-1 rounded transition-colors"
              style={{ color: '#666' }}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {view === 'browse' ? (
            <BrowseView
              fetchStatus={fetchStatus}
              filteredFiles={filteredFiles}
              selectedIds={selectedIds}
              searchQuery={searchQuery}
              searchInputRef={searchInputRef}
              onSearchChange={setSearchQuery}
              onToggleId={toggleId}
              onRetry={loadFiles}
            />
          ) : (
            <UploadView cards={cards} />
          )}
        </div>

        {/* Footer */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-3"
          style={{ borderTop: '1px solid #1e1e1e', background: '#141414' }}
        >
          {view === 'browse' ? (
            <>
              <span style={{ color: '#666', fontSize: 11 }}>
                {selectedIds.size > 0 ? `${selectedIds.size} file(s) selected` : ''}
              </span>
              <button
                disabled={selectedIds.size === 0}
                onClick={() => { onAttach(selectedFiles); handleClose(); }}
                className="px-4 py-1.5 rounded text-xs font-bold transition-opacity"
                style={{
                  background: '#C4A962',
                  color: '#000',
                  opacity: selectedIds.size === 0 ? 0.4 : 1,
                  pointerEvents: selectedIds.size === 0 ? 'none' : 'auto',
                }}
              >
                Attach to Chat
              </button>
            </>
          ) : (
            <>
              <span />
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 rounded text-xs font-semibold"
                style={{ background: '#2a2a2a', color: '#ccc' }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );

  // ── Placeholder handlers (wired in next task) ──────────────────────────────
  function handleFileInputChange(_e: React.ChangeEvent<HTMLInputElement>) {}
  function handleCancel() {}
}

// ── BrowseView ────────────────────────────────────────────────────────────────
function BrowseView({
  fetchStatus,
  filteredFiles,
  selectedIds,
  searchQuery,
  searchInputRef,
  onSearchChange,
  onToggleId,
  onRetry,
}: {
  fetchStatus: 'loading' | 'error' | 'done';
  filteredFiles: LibraryFile[];
  selectedIds: Set<string>;
  searchQuery: string;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onSearchChange: (q: string) => void;
  onToggleId: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <>
      {/* Search */}
      <div className="px-3 pt-3 pb-2 shrink-0" style={{ borderBottom: '1px solid #1e1e1e' }}>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-md"
          style={{ background: '#1e1e1e', border: '1px solid #2a2a2a' }}
        >
          <Search size={14} style={{ color: '#555', flexShrink: 0 }} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="flex-1 bg-transparent outline-none text-xs"
            style={{ color: '#ccc' }}
          />
        </div>
      </div>

      {/* File list body */}
      <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight: 320 }}>
        {fetchStatus === 'loading' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" style={{ color: '#C4A962' }} />
          </div>
        )}
        {fetchStatus === 'error' && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span style={{ color: '#888', fontSize: 12 }}>Failed to load files</span>
            <button onClick={onRetry} style={{ color: '#C4A962', fontSize: 11 }}>
              Retry
            </button>
          </div>
        )}
        {fetchStatus === 'done' && filteredFiles.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <span style={{ color: '#555', fontSize: 12 }}>No files yet — upload one above</span>
          </div>
        )}
        {fetchStatus === 'done' &&
          filteredFiles.map((f) => {
            const selected = selectedIds.has(f.id);
            const date = new Date(f.uploaded_at).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            });
            return (
              <div
                key={f.id}
                onClick={() => onToggleId(f.id)}
                className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer mb-1"
                style={{
                  background: selected ? '#1e1e1e' : '#161616',
                  borderLeft: `2px solid ${selected ? '#C4A962' : 'transparent'}`,
                }}
              >
                {/* Checkbox */}
                <div
                  style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                    background: selected ? '#C4A962' : 'transparent',
                    border: `2px solid ${selected ? '#C4A962' : '#444'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {selected && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M1.5 4L3.5 6L6.5 2" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <FileTypeBadge fileType={f.file_type} size={20} />
                <span
                  className="flex-1 text-xs"
                  style={{
                    color: selected ? '#fff' : '#aaa',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    maxWidth: 200,
                  }}
                >
                  {f.original_name}
                </span>
                <span style={{ color: '#555', fontSize: 10, flexShrink: 0 }}>
                  {formatFileSize(f.file_size)}
                </span>
                <span style={{ color: '#444', fontSize: 10, flexShrink: 0 }}>{date}</span>
              </div>
            );
          })}
      </div>
    </>
  );
}

// ── UploadView ────────────────────────────────────────────────────────────────
function UploadView({ cards }: { cards: UploadCard[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
      {cards.map((card) => (
        <UploadCardItem key={card.id} card={card} />
      ))}
    </div>
  );
}

function UploadCardItem({ card }: { card: UploadCard }) {
  const pct = card.total > 0 ? Math.round((card.loaded / card.total) * 100) : 0;
  const isDone = card.status === 'done';
  const isError = card.status === 'error';

  const barColor = isDone
    ? '#2ecc71'
    : isError
    ? '#e74c3c'
    : undefined; // gradient applied via style when uploading

  return (
    <div
      style={{
        background: '#1a1a1a', border: '1px solid #2a2a2a',
        borderRadius: 8, padding: 14,
      }}
    >
      {/* Top row */}
      <div className="flex items-center gap-2 mb-2">
        <FileTypeBadge fileType={card.file.name.split('.').pop() ?? ''} size={28} />
        <div className="flex-1 min-w-0">
          <div
            className="text-xs font-semibold"
            style={{ color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {card.file.name}
          </div>
          <div style={{ color: '#666', fontSize: 9, marginTop: 1 }}>
            {formatFileSize(card.file.size)}
          </div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: isDone ? '#2ecc71' : isError ? '#e74c3c' : '#C4A962', flexShrink: 0 }}>
          {isDone ? '✓' : isError ? '!' : `${pct}%`}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: '#2a2a2a', borderRadius: 100, height: 6, overflow: 'hidden' }}>
        <div
          style={{
            width: `${isDone || isError ? 100 : pct}%`,
            height: '100%',
            borderRadius: 100,
            transition: 'width 0.2s ease',
            background: barColor ?? 'linear-gradient(90deg, #C4A962, #e8c97a)',
          }}
        />
      </div>

      {/* Sub-row */}
      <div className="flex justify-between mt-1.5">
        <span style={{ color: isDone ? '#2ecc71' : isError ? '#e74c3c' : '#666', fontSize: 8 }}>
          {isDone
            ? 'Upload complete · Added to Library'
            : isError
            ? 'Upload failed'
            : card.total > 0
            ? `${formatFileSize(card.loaded)} / ${formatFileSize(card.total)}`
            : ''}
        </span>
        <span style={{ color: '#555', fontSize: 8 }}>
          {!isDone && !isError ? card.displayEstimate : ''}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds (TypeScript checks)**

Run: `npm run build 2>&1 | grep -E "error|Error" | head -20`
Expected: No errors. (Unused handler warnings are fine at this stage.)

---

### Task 4: Wire upload logic into LibraryPickerModal

Replace the placeholder `handleFileInputChange` and `handleCancel` functions, and add the retry wiring. These are added inside the main component function body, before the `return` statement.

- [ ] **Step 1: Replace placeholder handlers in `LibraryPickerModal`**

In `src/components/chat/LibraryPickerModal.tsx`, replace:

```tsx
  // ── Placeholder handlers (wired in next task) ──────────────────────────────
  function handleFileInputChange(_e: React.ChangeEvent<HTMLInputElement>) {}
  function handleCancel() {}
```

with:

```tsx
  // ── Upload ─────────────────────────────────────────────────────────────────
  function startUpload(file: File, existingCardId?: string) {
    const cardId = existingCardId ?? crypto.randomUUID();
    const xhr = new XMLHttpRequest();
    let uploadStartTime = 0;

    const newCard: UploadCard = {
      id: cardId, file, xhr, uploadStartTime: 0,
      status: 'uploading', loaded: 0, total: file.size,
      displayEstimate: '',
    };

    setCards((prev) => {
      if (existingCardId) {
        // Retry: replace card in-place, reset progress
        return prev.map((c) =>
          c.id === existingCardId
            ? { ...newCard, xhr }
            : c
        );
      }
      // New upload: enforce max 5 cards
      let next = [...prev, newCard];
      if (next.length > 5) {
        const doneIdx = next.findIndex((c) => c.status === 'done');
        next.splice(doneIdx !== -1 ? doneIdx : 0, 1);
      }
      return next;
    });

    setView('upload');

    xhr.open('POST', '/api/library/upload');
    xhr.setRequestHeader('X-User-Id', localStorage.getItem('userId') || '');

    xhr.upload.onloadstart = () => {
      uploadStartTime = Date.now();
      setCards((prev) =>
        prev.map((c) => c.id === cardId ? { ...c, uploadStartTime } : c)
      );
    };

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const elapsed = Date.now() - uploadStartTime;
      let estimate = '';
      if (e.loaded > 0 && elapsed > 0 && elapsed >= 1000) {
        const rate = e.loaded / elapsed;
        const remainingMs = (e.total - e.loaded) / rate;
        estimate = remainingMs < 60000
          ? `~${Math.ceil(remainingMs / 1000)}s left`
          : `~${Math.ceil(remainingMs / 60000)}m left`;
      } else {
        estimate = 'Calculating...';
      }
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? { ...c, loaded: e.loaded, total: e.total, displayEstimate: estimate }
            : c
        )
      );
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        const result: LibraryFile = data.file || data;
        setCards((prev) =>
          prev.map((c) =>
            c.id === cardId
              ? { ...c, status: 'done', loaded: c.total, result }
              : c
          )
        );
        // After 600ms, return to browse and pre-select the new file
        setTimeout(() => {
          setFiles((prev) => [...prev, result]);
          setSelectedIds((prev) => new Set([...prev, result.id]));
          setView('browse');
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }, 600);
      } else {
        setCards((prev) =>
          prev.map((c) => c.id === cardId ? { ...c, status: 'error' } : c)
        );
      }
    };

    xhr.onerror = () => {
      setCards((prev) =>
        prev.map((c) => c.id === cardId ? { ...c, status: 'error' } : c)
      );
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-selected
    e.target.value = '';
    startUpload(file);
  }

  function handleCancel() {
    cards.forEach((c) => { if (c.status === 'uploading') c.xhr.abort(); });
    setCards([]);
    setView('browse');
  }

  function handleRetry(cardId: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    startUpload(card.file, cardId);
  }
```

- [ ] **Step 2: Pass `onRetry` to `UploadCardItem`**

In the `UploadView` component, pass `onRetry` down:

```tsx
function UploadView({ cards, onRetry }: { cards: UploadCard[]; onRetry: (id: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
      {cards.map((card) => (
        <UploadCardItem key={card.id} card={card} onRetry={onRetry} />
      ))}
    </div>
  );
}
```

Update the `UploadView` usage in the main component's JSX body:

```tsx
// Change from:
<UploadView cards={cards} />
// Change to:
<UploadView cards={cards} onRetry={handleRetry} />
```

- [ ] **Step 3: Add Retry button to `UploadCardItem`**

In `UploadCardItem`, replace the props interface and add the retry button:

```tsx
function UploadCardItem({ card, onRetry }: { card: UploadCard; onRetry: (id: string) => void }) {
```

After the sub-row `<div>`, add:

```tsx
      {card.status === 'error' && (
        <button
          onClick={() => onRetry(card.id)}
          className="mt-2 text-xs px-3 py-1 rounded"
          style={{ background: '#2a2a2a', color: '#ccc' }}
        >
          Retry
        </button>
      )}
```

- [ ] **Step 4: Verify full build**

Run: `npm run build 2>&1 | grep -E "error TS" | head -20`
Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/LibraryPickerModal.tsx
git commit -m "feat: add LibraryPickerModal with browse, upload, and progress tracking"
```

---

## Chunk 3: ChatInput integration

**Prerequisite:** Chunks 1 and 2 must be completed first.

**Files:**
- Modify: `src/components/chat/ChatInput.tsx`

---

### Task 5: Update ChatInput to use LibraryPickerModal + file chips

- [ ] **Step 1: Update imports and state in `ChatInput.tsx`**

Replace the top of `ChatInput.tsx` (lines 1–51):

```tsx
import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import * as api from '../../api';
import {
  Send,
  Paperclip,
  Share2,
  ChevronDown,
  X,
} from 'lucide-react';
import { LibraryFile } from '../../types';
import LibraryPickerModal from './LibraryPickerModal';
import FileTypeBadge from './FileTypeBadge';

function ClaudeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.93 2.93l1.41 1.41M9.66 9.66l1.41 1.41M2.93 11.07l1.41-1.41M9.66 4.34l1.41-1.41" stroke="#E8774A" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="7" cy="7" r="2" fill="#E8774A"/>
    </svg>
  );
}

function GeminiIcon({ flash = false }: { flash?: boolean }) {
  const color = flash ? '#60A5FA' : '#3B82F6';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1L9.5 6.5L7 13L4.5 6.5Z" fill={color} opacity="0.9"/>
      <path d="M1 7L6.5 4.5L13 7L6.5 9.5Z" fill={color} opacity="0.6"/>
    </svg>
  );
}

const MODELS = [
  { name: 'Sonnet 4.6', icon: <ClaudeIcon /> },
  { name: 'Opus 4.6', icon: <ClaudeIcon /> },
  { name: 'Gemini 3', icon: <GeminiIcon /> },
  { name: 'Gemini Flash 3', icon: <GeminiIcon flash /> },
];

export default function ChatInput({ centered = false, projectId }: { centered?: boolean; projectId?: string }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeChat, setActiveChat, addToast } = useStore();
  const [message, setMessage] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<LibraryFile[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [temperature, setTemperature] = useState(0.7);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paperclipButtonRef = useRef<HTMLButtonElement>(null);
```

- [ ] **Step 2: Update `handleSendMessage` to include `attachment_ids`**

Replace the `handleSendMessage` function:

```tsx
  const handleSendMessage = async () => {
    if (!message.trim()) return;

    setLoading(true);
    try {
      let chatId = id || activeChat?.id;

      if (!chatId) {
        const newChat = await api.chats.create({
          title: message.slice(0, 50),
          model: selectedModel.name,
          temperature,
          ...(projectId && { project_id: projectId }),
        });
        chatId = newChat.id;
        navigate(`/chat/${chatId}`);
      }

      await api.chats.sendMessage(chatId, {
        content: message,
        model: selectedModel.name,
        temperature,
        attachments: attachedFiles.map((f) => f.id),  // stored as JSON string in messages table
      });

      setMessage('');
      setAttachedFiles([]);

      if (chatId) {
        const updated = await api.chats.get(chatId);
        setActiveChat(updated);
      }

      addToast({ type: 'success', title: 'Message sent' });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to send message',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };
```

- [ ] **Step 3: Update the JSX — replace attachment chip + paperclip button, add file chips and modal**

Replace the entire `return (...)` block. This removes: the old `{attachment && ...}` chip div, the native hidden `<input type="file" ref={fileInputRef}>` element, and the `onClick={() => fileInputRef.current?.click()}` on the paperclip button. None of those should remain.

```tsx
  return (
    <>
      <LibraryPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onAttach={(files) => setAttachedFiles(files)}
        returnFocusRef={paperclipButtonRef}
      />

      <div className={`bg-white px-4 py-4 ${centered ? '' : 'border-t border-vetted-border'}`}>
        <div className="max-w-3xl mx-auto">

          {/* File chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-[6px] pb-2">
              {attachedFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-[6px] rounded-md px-2 py-1"
                  style={{ background: '#252525', border: '1px solid #333' }}
                >
                  <FileTypeBadge fileType={f.file_type} size={16} />
                  <span
                    className="text-[10px]"
                    style={{
                      color: '#ccc',
                      maxWidth: 150,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.original_name}
                  </span>
                  <button
                    onClick={() => setAttachedFiles((prev) => prev.filter((x) => x.id !== f.id))}
                    className="ml-0.5"
                    style={{ color: '#555' }}
                    aria-label={`Remove ${f.original_name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Main input container */}
          <div className="relative border border-vetted-border rounded-2xl bg-white focus-within:border-vetted-accent focus-within:ring-[3px] focus-within:ring-vetted-accent/20 transition-all">
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              className="w-full px-4 pt-3 pb-12 text-sm leading-relaxed resize-none bg-transparent outline-none placeholder:text-vetted-text-muted min-h-[80px] max-h-[200px]"
              rows={2}
            />

            {/* Bottom toolbar row */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 pb-3">
              {/* Left side */}
              <div className="flex items-center gap-1">
                <button
                  ref={paperclipButtonRef}
                  onClick={() => setIsPickerOpen(true)}
                  className="p-2 text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface rounded-lg transition-colors"
                  title="Attach files from Library"
                >
                  <Paperclip size={18} />
                </button>
                {activeChat && (
                  <button
                    onClick={() => {
                      addToast({
                        type: 'success',
                        title: 'Chat link copied',
                        detail: 'Share this chat with others',
                      });
                    }}
                    className="p-2 text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface rounded-lg transition-colors"
                    title="Share chat"
                  >
                    <Share2 size={18} />
                  </button>
                )}
              </div>

              {/* Right side: model selector + send */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setShowModelSelect(!showModelSelect)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-vetted-border hover:bg-vetted-surface transition-colors text-xs font-medium text-vetted-text-secondary"
                  >
                    {selectedModel.icon}
                    {selectedModel.name}
                    <ChevronDown size={12} />
                  </button>
                  {showModelSelect && (
                    <div className="absolute bottom-full right-0 mb-2 bg-white border border-vetted-border rounded-xl shadow-lg z-10 min-w-[180px] overflow-hidden">
                      <div className="px-3 py-2 border-b border-vetted-border">
                        <p className="text-[11px] font-medium text-vetted-text-muted uppercase tracking-wider">Model</p>
                      </div>
                      {MODELS.map((model) => (
                        <button
                          key={model.name}
                          onClick={() => {
                            setSelectedModel(model);
                            setShowModelSelect(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 text-sm hover:bg-vetted-surface flex items-center gap-2.5 transition-colors ${
                            selectedModel.name === model.name ? 'bg-vetted-surface font-medium' : ''
                          }`}
                        >
                          {model.icon}
                          {model.name}
                          {selectedModel.name === model.name && (
                            <span className="ml-auto text-vetted-accent text-xs">&#10003;</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleSendMessage}
                  disabled={loading || !message.trim()}
                  className={`p-2 rounded-full transition-all ${
                    message.trim() && !loading
                      ? 'bg-vetted-primary text-white hover:bg-gray-800'
                      : 'bg-vetted-border text-vetted-text-muted cursor-not-allowed'
                  }`}
                  title="Send (Enter)"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-vetted-text-muted text-center mt-2">
            Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </>
  );
```

- [ ] **Step 4: Verify the full build**

Run: `npm run build 2>&1 | grep -E "error TS" | head -20`
Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ChatInput.tsx
git commit -m "feat: integrate LibraryPickerModal into ChatInput with file chips"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Vite frontend on port 5173, Express backend on port 3000.

- [ ] **Step 2: Log in and open a chat**

Open http://localhost:5173. Log in as `james.wilson@company.com`. Open or create a chat.

- [ ] **Step 3: Test browse flow**

1. Click the paperclip icon — modal opens over the chat
2. File list loads (spinner then files, or empty state if no files)
3. Search filters the list in real time
4. Clicking a row selects it (gold left border, checkbox fills)
5. Footer shows "N file(s) selected" and "Attach to Chat" becomes active
6. Click "Attach to Chat" — modal closes, chips appear above textarea
7. ✕ on a chip removes it
8. Clicking paperclip again shows fresh modal with no pre-selections

- [ ] **Step 4: Test upload flow**

1. Click paperclip → modal opens
2. Click "+ Upload File" — native file picker opens
3. Select a file — modal switches to Upload view, progress card appears
4. Progress bar animates with %, size info, and time estimate
5. On completion: bar turns green, ✓ shown, "Upload complete · Added to Library"
6. After ~600ms: modal returns to Browse, new file listed and pre-checked
7. Click "Attach to Chat" — new file chip appears in input

Note: uploaded files are stored in `uploads/` at the project root (not `data/uploads/`). This is normal — the multer config writes there. The Library page will list the file correctly regardless.

- [ ] **Step 5: Test cancel during upload**

1. Start an upload of a large file
2. Click "Cancel" before completion — modal returns to Browse, no chips added

- [ ] **Step 6: Test file chips in sent message**

1. Attach a file and type a message
2. Press Enter — message sends, chips clear
3. No error toast

- [ ] **Step 7: Test Escape and backdrop close**

1. Open modal — press Escape — modal closes, focus returns to paperclip
2. Open modal — click outside the panel — modal closes

- [ ] **Step 8: Final commit**

```bash
git add -p  # stage any final tweaks
git commit -m "feat: library file picker — complete implementation"
```
