import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { X, Download, Bold, Italic, Underline, List, ListOrdered, Heading1, Heading2, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import {
  ExportableMessage,
  ParsedTable,
  extractTables,
  exportTextToWord,
  exportTablesToExcel,
} from '../../utils/export';

interface ExportPanelProps {
  isOpen: boolean;
  onClose: () => void;
  format: 'word' | 'excel';
  scope: 'last' | 'all';
  messages: ExportableMessage[];
  chatTitle: string;
}

// ── Word Editor ──────────────────────────────────────────────────────────────

/** Lightweight markdown to HTML for the word editor */
function mdToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

/** Applies a document.execCommand for rich-text formatting */
function applyFormat(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function ToolbarButton({ onClick, children, title }: {
  onClick: () => void; children: React.ReactNode; title: string;
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className="p-1.5 rounded transition-colors text-vetted-text-muted hover:bg-vetted-surface hover:text-vetted-primary"
    >
      {children}
    </button>
  );
}

function WordEditor({ messages, scope }: { messages: ExportableMessage[]; scope: 'last' | 'all' }) {
  const html = useMemo(() => {
    const msgs = scope === 'last'
      ? [messages.filter((m) => m.role === 'assistant').pop()].filter(Boolean) as ExportableMessage[]
      : messages;

    const md = msgs.map((msg) => {
      const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
      const time = msg.timestamp || msg.created_at || '';
      const timeStr = time ? ` — ${new Date(time).toLocaleString()}` : '';
      const header = scope === 'all' ? `**${roleLabel}**${timeStr}\n\n` : '';
      return header + msg.content;
    }).join('\n\n---\n\n');

    return DOMPurify.sanitize(mdToHtml(md));
  }, [messages, scope]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Formatting toolbar */}
      <div className="flex items-center gap-0.5 px-4 py-2 border-b border-vetted-border bg-white flex-shrink-0">
        <ToolbarButton onClick={() => applyFormat('bold')} title="Bold (Ctrl+B)">
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => applyFormat('italic')} title="Italic (Ctrl+I)">
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => applyFormat('underline')} title="Underline (Ctrl+U)">
          <Underline size={15} />
        </ToolbarButton>

        <div className="w-px h-5 bg-vetted-border mx-1" />

        <ToolbarButton onClick={() => applyFormat('formatBlock', '<h1>')} title="Heading 1">
          <Heading1 size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => applyFormat('formatBlock', '<h2>')} title="Heading 2">
          <Heading2 size={15} />
        </ToolbarButton>

        <div className="w-px h-5 bg-vetted-border mx-1" />

        <ToolbarButton onClick={() => applyFormat('insertUnorderedList')} title="Bullet List">
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => applyFormat('insertOrderedList')} title="Numbered List">
          <ListOrdered size={15} />
        </ToolbarButton>

        <div className="w-px h-5 bg-vetted-border mx-1" />

        <ToolbarButton onClick={() => applyFormat('justifyLeft')} title="Align Left">
          <AlignLeft size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => applyFormat('justifyCenter')} title="Align Center">
          <AlignCenter size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => applyFormat('justifyRight')} title="Align Right">
          <AlignRight size={15} />
        </ToolbarButton>
      </div>

      {/* Editable content area */}
      <div className="flex-1 overflow-y-auto p-4">
        <div
          contentEditable
          suppressContentEditableWarning
          className="min-h-full p-6 bg-white border border-vetted-border rounded-lg text-sm text-vetted-primary leading-relaxed focus:outline-none focus:border-accent"
          style={{ fontFamily: "'Inter', sans-serif" }}
          data-editor="word"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

// ── Excel Editor ─────────────────────────────────────────────────────────────

function ExcelEditor({
  tables,
  onTablesChange,
}: {
  tables: ParsedTable[];
  onTablesChange: (tables: ParsedTable[]) => void;
}) {
  const handleHeaderChange = useCallback(
    (tableIdx: number, colIdx: number, value: string) => {
      const updated = tables.map((t, ti) => {
        if (ti !== tableIdx) return t;
        const headers = [...t.headers];
        headers[colIdx] = value;
        return { ...t, headers };
      });
      onTablesChange(updated);
    },
    [tables, onTablesChange]
  );

  const handleCellChange = useCallback(
    (tableIdx: number, rowIdx: number, colIdx: number, value: string) => {
      const updated = tables.map((t, ti) => {
        if (ti !== tableIdx) return t;
        const rows = t.rows.map((r, ri) => {
          if (ri !== rowIdx) return r;
          const cells = [...r];
          cells[colIdx] = value;
          return cells;
        });
        return { ...t, rows };
      });
      onTablesChange(updated);
    },
    [tables, onTablesChange]
  );

  return (
    <div className="flex-1 overflow-auto p-4 space-y-6">
      {tables.map((table, tableIdx) => (
        <div key={tableIdx}>
          {tables.length > 1 && (
            <div className="text-xs font-medium text-vetted-text-muted mb-2">Table {tableIdx + 1}</div>
          )}
          <div className="border border-vetted-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F5F0E6]">
                  {table.headers.map((h, colIdx) => (
                    <th key={colIdx} className="border-r border-vetted-border last:border-r-0 p-0">
                      <input
                        type="text"
                        value={h}
                        onChange={(e) => handleHeaderChange(tableIdx, colIdx, e.target.value)}
                        className="w-full px-3 py-2 text-xs font-bold text-vetted-primary bg-transparent focus:outline-none focus:bg-accent/5"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-t border-vetted-border hover:bg-vetted-surface/50">
                    {row.map((cell, colIdx) => (
                      <td key={colIdx} className="border-r border-vetted-border last:border-r-0 p-0">
                        <input
                          type="text"
                          value={cell}
                          onChange={(e) => handleCellChange(tableIdx, rowIdx, colIdx, e.target.value)}
                          className="w-full px-3 py-1.5 text-xs text-vetted-text-secondary bg-transparent focus:outline-none focus:bg-accent/5"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export default function ExportPanel({ isOpen, onClose, format, scope, messages, chatTitle }: ExportPanelProps) {
  const [exporting, setExporting] = useState(false);
  const [tables, setTables] = useState<ParsedTable[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Build initial table data for Excel mode
  useEffect(() => {
    if (format !== 'excel' || !isOpen) return;

    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    let extracted: ParsedTable[] = [];

    if (scope === 'all') {
      for (const msg of assistantMsgs) {
        extracted.push(...extractTables(msg.content));
      }
    } else {
      for (let i = assistantMsgs.length - 1; i >= 0; i--) {
        const t = extractTables(assistantMsgs[i].content);
        if (t.length > 0) {
          extracted = [t[t.length - 1]];
          break;
        }
      }
    }

    // Fallback: no markdown tables found — split text into a single-column table
    if (extracted.length === 0) {
      const msgs = scope === 'last'
        ? [assistantMsgs[assistantMsgs.length - 1]].filter(Boolean)
        : assistantMsgs;
      const rows = msgs
        .flatMap((m) => m.content.split(/\n\n+/))
        .map((para) => para.trim())
        .filter((para) => para.length > 0)
        .map((para) => [para]);
      if (rows.length > 0) {
        extracted = [{ headers: ['Content'], rows }];
      }
    }

    setTables(extracted);
  }, [format, scope, messages, isOpen]);

  const handleExport = async () => {
    setExporting(true);
    try {
      if (format === 'word') {
        const editorEl = panelRef.current?.querySelector('[data-editor="word"]');
        const text = editorEl?.textContent || '';
        await exportTextToWord(text, chatTitle);
      } else {
        await exportTablesToExcel(tables, chatTitle);
      }
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-[520px] max-w-[90vw] h-full bg-vetted-surface flex flex-col shadow-xl animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-vetted-border bg-white">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            <Download size={14} />
            {exporting
              ? 'Exporting...'
              : format === 'word'
              ? 'Export to Word'
              : 'Export to Excel'}
          </button>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-vetted-surface rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Editor area */}
        {format === 'word' ? (
          <WordEditor messages={messages} scope={scope} />
        ) : (
          <ExcelEditor tables={tables} onTablesChange={setTables} />
        )}
      </div>
    </div>
  );
}
