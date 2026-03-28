import React, { useState, useMemo } from 'react';
import { X, FileText, Sheet } from 'lucide-react';
import {
  ExportableMessage,
  hasMarkdownTables,
} from '../../utils/export';
import ExportPanel from './ExportPanel';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ExportableMessage[];
  chatTitle: string;
}

export default function ExportModal({ isOpen, onClose, messages, chatTitle }: ExportModalProps) {
  const [panelFormat, setPanelFormat] = useState<'word' | 'excel' | null>(null);

  const hasTables = useMemo(() => hasMarkdownTables(messages), [messages]);

  if (!isOpen) return null;

  // If panel is open, show the panel instead of the modal
  if (panelFormat) {
    return (
      <ExportPanel
        isOpen
        onClose={() => {
          setPanelFormat(null);
          onClose();
        }}
        format={panelFormat}
        messages={messages}
        chatTitle={chatTitle}
      />
    );
  }

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
              Select the format to open the editor
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-vetted-surface rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-2">
          {/* Word option — click opens panel */}
          <button
            onClick={() => setPanelFormat('word')}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-vetted-border hover:border-accent hover:bg-accent/5 transition-colors text-left"
          >
            <FileText size={20} className="text-vetted-text-muted" />
            <div>
              <div className="text-sm font-medium text-vetted-primary">Word Document</div>
              <div className="text-xs text-vetted-text-muted">Edit and export as Word document</div>
            </div>
          </button>

          {/* Excel option — click opens panel (only when tables exist) */}
          {hasTables && (
            <button
              onClick={() => setPanelFormat('excel')}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-vetted-border hover:border-accent hover:bg-accent/5 transition-colors text-left"
            >
              <Sheet size={20} className="text-vetted-text-muted" />
              <div>
                <div className="text-sm font-medium text-vetted-primary">Excel Spreadsheet</div>
                <div className="text-xs text-vetted-text-muted">Edit tables and export as Excel</div>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
