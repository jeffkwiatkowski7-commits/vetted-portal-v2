import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, Search } from 'lucide-react';
import * as api from '../../api';
import { LibraryFile } from '../../types';
import FileTypeBadge from './FileTypeBadge';
import { formatFileSize } from '../../utils/formatFileSize';

export interface LibraryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAttach: (files: LibraryFile[]) => void | Promise<void>;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
  projectId?: string;
  onUploadComplete?: () => void;
}

type UploadCard = {
  id: string;
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
  projectId,
  onUploadComplete,
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

  // ── Fetch library ───────────────────────────────────────────────────────────
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

  // ── Close + Escape ──────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    cards.forEach((c) => {
      if (c.status === 'uploading') c.xhr.abort();
    });
    onClose();
    setTimeout(() => returnFocusRef.current?.focus(), 0);
  }, [cards, onClose, returnFocusRef]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  // ── Focus trap ──────────────────────────────────────────────────────────────
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

  // ── Selection ───────────────────────────────────────────────────────────────
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

  // ── Upload ──────────────────────────────────────────────────────────────────
  function startUpload(file: File, existingCardId?: string) {
    const cardId = existingCardId ?? crypto.randomUUID();
    const xhr = new XMLHttpRequest();
    let uploadStartTime = 0;

    const newCard: UploadCard = {
      id: cardId,
      file,
      xhr,
      uploadStartTime: 0,
      status: 'uploading',
      loaded: 0,
      total: file.size,
      displayEstimate: '',
    };

    setCards((prev) => {
      if (existingCardId) {
        return prev.map((c) => (c.id === existingCardId ? { ...newCard, xhr } : c));
      }
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
        prev.map((c) => (c.id === cardId ? { ...c, uploadStartTime } : c))
      );
    };

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const elapsed = Date.now() - uploadStartTime;
      let estimate = '';
      if (e.loaded > 0 && elapsed > 0 && elapsed >= 1000) {
        const rate = e.loaded / elapsed;
        const remainingMs = (e.total - e.loaded) / rate;
        estimate =
          remainingMs < 60000
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
            c.id === cardId ? { ...c, status: 'done', loaded: c.total, result } : c
          )
        );
        setTimeout(() => {
          setFiles((prev) => [...prev, result]);
          setSelectedIds((prev) => new Set([...prev, result.id]));
          setView('browse');
          setTimeout(() => searchInputRef.current?.focus(), 0);
          if (projectId) onUploadComplete?.();
        }, 600);
      } else {
        setCards((prev) =>
          prev.map((c) => (c.id === cardId ? { ...c, status: 'error' } : c))
        );
      }
    };

    xhr.onerror = () => {
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, status: 'error' } : c))
      );
    };

    const formData = new FormData();
    formData.append('file', file);
    if (projectId) formData.append('project_id', projectId);
    xhr.send(formData);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    startUpload(file);
  }

  function handleCancel() {
    cards.forEach((c) => {
      if (c.status === 'uploading') c.xhr.abort();
    });
    setCards([]);
    setView('browse');
  }

  function handleRetry(cardId: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    startUpload(card.file, cardId);
  }

  if (!isOpen) return null;

  const anyUploading = cards.some((c) => c.status === 'uploading');

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}
        onClick={handleClose}
      />

      {/* Modal panel */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Library file picker"
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col bg-white rounded-xl shadow-2xl"
        style={{
          width: 520,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)',
          overflow: 'hidden',
          border: '1px solid #E5E7EB',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-vetted-border bg-vetted-surface">
          <span className="text-xs font-bold tracking-widest text-vetted-text-secondary uppercase">
            Library
          </span>
          <div className="flex items-center gap-2">
            {view === 'browse' && (
              <>
                <label
                  htmlFor="library-file-input"
                  className="cursor-pointer px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity"
                  style={{
                    background: '#C4A962',
                    color: '#fff',
                    opacity: anyUploading ? 0.4 : 1,
                    pointerEvents: anyUploading ? 'none' : 'auto',
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
                  disabled={anyUploading}
                  onChange={handleFileInputChange}
                />
              </>
            )}
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-vetted-border transition-colors text-vetted-text-muted hover:text-vetted-text-secondary"
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
            <UploadView cards={cards} onRetry={handleRetry} />
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t border-vetted-border bg-vetted-surface">
          {view === 'browse' ? (
            <>
              <span className="text-xs text-vetted-text-muted">
                {selectedIds.size > 0 ? `${selectedIds.size} file(s) selected` : ''}
              </span>
              <button
                disabled={selectedIds.size === 0}
                onClick={async () => {
                  await onAttach(selectedFiles);
                  handleClose();
                }}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-opacity"
                style={{
                  background: '#C4A962',
                  color: '#fff',
                  opacity: selectedIds.size === 0 ? 0.35 : 1,
                  cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                {projectId ? 'Add to Project' : 'Attach to Chat'}
              </button>
            </>
          ) : (
            <>
              <span />
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold border border-vetted-border hover:bg-vetted-border transition-colors text-vetted-text-secondary"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
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
      <div className="px-3 pt-3 pb-2 shrink-0 border-b border-vetted-border">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-vetted-border bg-white">
          <Search size={14} className="text-vetted-text-muted shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="flex-1 bg-transparent outline-none text-sm text-vetted-text-primary placeholder:text-vetted-text-muted"
          />
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-2" style={{ maxHeight: 320 }}>
        {fetchStatus === 'loading' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={22} className="animate-spin text-vetted-accent" />
          </div>
        )}
        {fetchStatus === 'error' && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span className="text-sm text-vetted-text-secondary">Failed to load files</span>
            <button onClick={onRetry} className="text-xs text-vetted-accent hover:underline">
              Retry
            </button>
          </div>
        )}
        {fetchStatus === 'done' && filteredFiles.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-vetted-text-muted">No files yet — upload one above</span>
          </div>
        )}
        {fetchStatus === 'done' &&
          filteredFiles.map((f) => {
            const selected = selectedIds.has(f.id);
            const date = new Date(f.uploaded_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });
            return (
              <div
                key={f.id}
                onClick={() => onToggleId(f.id)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer mb-0.5 transition-colors"
                style={{
                  background: selected ? '#FDF9EE' : 'transparent',
                  borderLeft: `2px solid ${selected ? '#C4A962' : 'transparent'}`,
                }}
              >
                {/* Checkbox */}
                <div
                  className="shrink-0 flex items-center justify-center rounded"
                  style={{
                    width: 16,
                    height: 16,
                    background: selected ? '#C4A962' : '#fff',
                    border: `2px solid ${selected ? '#C4A962' : '#D1D5DB'}`,
                  }}
                >
                  {selected && (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <path
                        d="M1.5 4.5L3.5 6.5L7.5 2.5"
                        stroke="#fff"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>

                <FileTypeBadge fileType={f.file_type} size={20} />

                <span
                  className="flex-1 text-sm text-vetted-text-primary"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 200,
                  }}
                >
                  {f.original_name}
                </span>

                <span className="text-xs text-vetted-text-muted shrink-0">
                  {formatFileSize(f.file_size)}
                </span>
                <span className="text-xs text-vetted-text-muted shrink-0">{date}</span>
              </div>
            );
          })}
      </div>
    </>
  );
}

// ── UploadView ────────────────────────────────────────────────────────────────

function UploadView({
  cards,
  onRetry,
}: {
  cards: UploadCard[];
  onRetry: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
      {cards.map((card) => (
        <UploadCardItem key={card.id} card={card} onRetry={onRetry} />
      ))}
    </div>
  );
}

function UploadCardItem({
  card,
  onRetry,
}: {
  card: UploadCard;
  onRetry: (id: string) => void;
}) {
  const pct = card.total > 0 ? Math.round((card.loaded / card.total) * 100) : 0;
  const isDone = card.status === 'done';
  const isError = card.status === 'error';
  const ext = card.file.name.split('.').pop() ?? '';

  return (
    <div className="border border-vetted-border rounded-xl p-4 bg-vetted-surface">
      {/* Top row */}
      <div className="flex items-center gap-3 mb-3">
        <FileTypeBadge fileType={ext} size={28} />
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-medium text-vetted-text-primary"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {card.file.name}
          </div>
          <div className="text-xs text-vetted-text-muted mt-0.5">
            {formatFileSize(card.file.size)}
          </div>
        </div>
        <div
          className="text-xs font-bold shrink-0"
          style={{
            color: isDone ? '#10B981' : isError ? '#EF4444' : '#C4A962',
          }}
        >
          {isDone ? '✓ Done' : isError ? 'Failed' : `${pct}%`}
        </div>
      </div>

      {/* Progress bar */}
      <div className="rounded-full overflow-hidden" style={{ height: 6, background: '#E5E7EB' }}>
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{
            width: `${isDone || isError ? 100 : pct}%`,
            background: isDone
              ? '#10B981'
              : isError
              ? '#EF4444'
              : 'linear-gradient(90deg, #C4A962, #e8c97a)',
          }}
        />
      </div>

      {/* Sub-row */}
      <div className="flex justify-between mt-1.5">
        <span
          className="text-xs"
          style={{
            color: isDone ? '#10B981' : isError ? '#EF4444' : '#9CA3AF',
          }}
        >
          {isDone
            ? 'Upload complete · Added to Library'
            : isError
            ? 'Upload failed'
            : card.total > 0
            ? `${formatFileSize(card.loaded)} / ${formatFileSize(card.total)}`
            : ''}
        </span>
        <span className="text-xs text-vetted-text-muted">
          {!isDone && !isError ? card.displayEstimate : ''}
        </span>
      </div>

      {/* Retry */}
      {isError && (
        <button
          onClick={() => onRetry(card.id)}
          className="mt-2 text-xs px-3 py-1 rounded-lg border border-vetted-border hover:bg-vetted-border transition-colors text-vetted-text-secondary"
        >
          Retry
        </button>
      )}
    </div>
  );
}
