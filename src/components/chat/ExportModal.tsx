import React, { useState, useMemo } from 'react';
import { X, FileText, Sheet } from 'lucide-react';
import {
  ExportableMessage,
  hasMarkdownTables,
  exportToWord,
  exportToExcel,
} from '../../utils/export';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ExportableMessage[];
  chatTitle: string;
}

export default function ExportModal({ isOpen, onClose, messages, chatTitle }: ExportModalProps) {
  const [format, setFormat] = useState<'word' | 'excel'>('word');
  const [scope, setScope] = useState<'last' | 'all'>('last');
  const [exporting, setExporting] = useState(false);

  const hasTables = useMemo(() => hasMarkdownTables(messages), [messages]);

  if (!isOpen) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      if (format === 'word') {
        await exportToWord(messages, scope, chatTitle);
      } else {
        await exportToExcel(messages, scope, chatTitle);
      }
    } finally {
      setExporting(false);
      onClose();
    }
  };

  const wordScopeLabel = { last: 'Last AI response only', all: 'Entire conversation' };
  const excelScopeLabel = { last: 'Last table only', all: 'All tables' };
  const scopeLabels = format === 'word' ? wordScopeLabel : excelScopeLabel;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-serif text-vetted-primary">Choose Export Format</h2>
            <p className="text-xs text-vetted-text-muted mt-0.5">
              Select the format you want to export your conversation to
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-vetted-surface rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-4">
          {/* Format selection */}
          <div className="space-y-2">
            {/* Word option */}
            <button
              onClick={() => { setFormat('word'); setScope('last'); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                format === 'word'
                  ? 'border-accent bg-accent/5'
                  : 'border-vetted-border hover:border-vetted-text-muted'
              }`}
            >
              <FileText size={20} className={format === 'word' ? 'text-accent' : 'text-vetted-text-muted'} />
              <div>
                <div className="text-sm font-medium text-vetted-primary">Word Document</div>
                <div className="text-xs text-vetted-text-muted">Export as editable Word document</div>
              </div>
            </button>

            {/* Excel option — only when tables exist */}
            {hasTables && (
              <button
                onClick={() => { setFormat('excel'); setScope('last'); }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                  format === 'excel'
                    ? 'border-accent bg-accent/5'
                    : 'border-vetted-border hover:border-vetted-text-muted'
                }`}
              >
                <Sheet size={20} className={format === 'excel' ? 'text-accent' : 'text-vetted-text-muted'} />
                <div>
                  <div className="text-sm font-medium text-vetted-primary">Excel Spreadsheet</div>
                  <div className="text-xs text-vetted-text-muted">Export tables as Excel spreadsheet</div>
                </div>
              </button>
            )}
          </div>

          {/* Scope radio */}
          <div className="flex items-center gap-4 pl-1">
            {(['last', 'all'] as const).map((val) => (
              <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value={val}
                  checked={scope === val}
                  onChange={() => setScope(val)}
                  className="accent-accent"
                />
                <span className="text-xs text-vetted-text-secondary">{scopeLabels[val]}</span>
              </label>
            ))}
          </div>

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
