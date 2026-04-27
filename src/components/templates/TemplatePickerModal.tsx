import React, { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import * as api from '../../api';

interface PptxTemplate {
  id: string;
  name: string;
  template_type: string;
  status: 'active' | 'archived';
  has_thumbnail?: boolean;
  manifest_json?: string;
}

interface Props {
  selectedId?: string | null;
  onClose: () => void;
  onSelect: (template: PptxTemplate) => void;
}

export default function TemplatePickerModal({ selectedId, onClose, onSelect }: Props) {
  const [templates, setTemplates] = useState<PptxTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.pptxTemplates.list({ includeArchived: false })
      .then((data: any) => setTemplates(data.templates || data || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-vetted-border">
          <h3 className="text-base font-medium text-vetted-primary">Choose Branding Template</h3>
          <button onClick={onClose} className="p-1 hover:bg-vetted-surface rounded-lg">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-vetted-border">
          {loading ? (
            <p className="text-sm text-vetted-text-muted text-center py-8">Loading…</p>
          ) : templates.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-vetted-text-muted">You don't have any templates yet.</p>
              <a href="/apps/pptx-parser" className="text-sm text-vetted-accent hover:underline">Upload one →</a>
            </div>
          ) : templates.map((tpl) => {
            const isSelected = tpl.id === selectedId;
            return (
              <button
                key={tpl.id}
                onClick={() => { onSelect(tpl); onClose(); }}
                className={`w-full flex items-center gap-3 px-5 py-3 hover:bg-vetted-surface text-left transition-colors ${isSelected ? 'bg-vetted-accent/10' : ''}`}
              >
                <FileText size={16} className="text-vetted-text-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tpl.name}</p>
                  <p className="text-xs text-vetted-text-muted capitalize">{tpl.template_type.replace(/_/g, ' ')}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
