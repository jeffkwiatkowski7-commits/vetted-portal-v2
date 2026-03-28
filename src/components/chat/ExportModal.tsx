import React, { useState } from 'react';
import { X, FileText, Sheet } from 'lucide-react';
import { ExportableMessage } from '../../utils/export';
import ExportPanel from './ExportPanel';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ExportableMessage[];
  chatTitle: string;
}

export default function ExportModal({ isOpen, onClose, messages, chatTitle }: ExportModalProps) {
  const [format, setFormat] = useState<'word' | 'excel'>('word');
  const [scope, setScope] = useState<'last' | 'all'>('last');
  const [panelOpen, setPanelOpen] = useState(false);

  if (!isOpen) return null;

  // If panel is open, show the panel instead of the modal
  if (panelOpen) {
    return (
      <ExportPanel
        isOpen
        onClose={() => {
          setPanelOpen(false);
          onClose();
        }}
        format={format}
        scope={scope}
        messages={messages}
        chatTitle={chatTitle}
      />
    );
  }

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
              Select format and scope, then open the editor
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
              onClick={() => {
                if (format === 'word') { setPanelOpen(true); }
                else { setFormat('word'); setScope('last'); }
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                format === 'word'
                  ? 'border-accent bg-accent/5'
                  : 'border-vetted-border hover:border-vetted-text-muted'
              }`}
            >
              <FileText size={20} className={format === 'word' ? 'text-accent' : 'text-vetted-text-muted'} />
              <div>
                <div className="text-sm font-medium text-vetted-primary">Word Document</div>
                <div className="text-xs text-vetted-text-muted">Edit and export as Word document</div>
              </div>
            </button>

            {/* Excel option */}
            <button
              onClick={() => {
                if (format === 'excel') { setPanelOpen(true); }
                else { setFormat('excel'); setScope('last'); }
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                format === 'excel'
                  ? 'border-accent bg-accent/5'
                  : 'border-vetted-border hover:border-vetted-text-muted'
              }`}
            >
              <Sheet size={20} className={format === 'excel' ? 'text-accent' : 'text-vetted-text-muted'} />
              <div>
                <div className="text-sm font-medium text-vetted-primary">Excel Spreadsheet</div>
                <div className="text-xs text-vetted-text-muted">Edit tables and export as Excel</div>
              </div>
            </button>
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

          {/* Open editor button */}
          <button
            onClick={() => setPanelOpen(true)}
            className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Open Editor
          </button>
        </div>
      </div>
    </div>
  );
}
