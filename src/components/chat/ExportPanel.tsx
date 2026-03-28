import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Download } from 'lucide-react';
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
  messages: ExportableMessage[];
  chatTitle: string;
}

// ── Word Editor ──────────────────────────────────────────────────────────────

function WordEditor({ messages, scope }: { messages: ExportableMessage[]; scope: 'last' | 'all' }) {
  const content = useMemo(() => {
    const msgs = scope === 'last'
      ? [messages.filter((m) => m.role === 'assistant').pop()].filter(Boolean) as ExportableMessage[]
      : messages;

    return msgs.map((msg) => {
      const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
      const time = msg.timestamp || msg.created_at || '';
      const timeStr = time ? ` — ${new Date(time).toLocaleString()}` : '';
      const header = scope === 'all' ? `${roleLabel}${timeStr}\n` : '';
      return header + msg.content;
    }).join('\n\n');
  }, [messages, scope]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div
        contentEditable
        suppressContentEditableWarning
        className="min-h-full p-4 bg-white border border-vetted-border rounded-lg text-sm text-vetted-primary leading-relaxed whitespace-pre-wrap focus:outline-none focus:border-accent"
        data-editor="word"
      >
        {content}
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

export default function ExportPanel({ isOpen, onClose, format, messages, chatTitle }: ExportPanelProps) {
  const [exporting, setExporting] = useState(false);
  const [scope, setScope] = useState<'last' | 'all'>('last');
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

  const wordScopeLabel = { last: 'Last AI response only', all: 'Entire conversation' };
  const excelScopeLabel = { last: 'Last table only', all: 'All tables' };
  const scopeLabels = format === 'word' ? wordScopeLabel : excelScopeLabel;

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

          {/* Scope radio */}
          <div className="flex items-center gap-3">
            {(['last', 'all'] as const).map((val) => (
              <label key={val} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="panel-scope"
                  value={val}
                  checked={scope === val}
                  onChange={() => setScope(val)}
                  className="accent-accent"
                />
                <span className="text-[11px] text-vetted-text-secondary">{scopeLabels[val]}</span>
              </label>
            ))}
          </div>

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
