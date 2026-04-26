import React, { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import type { PptxTemplateDetail } from '../../types';
import { pptxTemplates } from '../../api';

const TYPE_LABEL: Record<string, string> = {
  ic_memo: 'IC Memo',
  one_pager: 'One Pager',
  investor_update: 'Investor Update',
  custom: 'Custom',
};

export interface PreviewModalProps {
  templateId: string | null;
  onClose: () => void;
  // When provided, fetch via this loader (used by admin to get someone else's
  // template). If omitted, falls back to the user-scoped detail endpoint.
  loader?: (id: string) => Promise<PptxTemplateDetail>;
}

export function PreviewModal({ templateId, onClose, loader }: PreviewModalProps) {
  const [detail, setDetail] = useState<PptxTemplateDetail | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!templateId) { setDetail(null); setError(''); return; }
    const fetchFn = loader || pptxTemplates.get;
    fetchFn(templateId)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [templateId, loader]);

  if (!templateId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-vetted-border">
          <h3 className="font-display text-lg text-vetted-primary">{detail?.name || 'Loading...'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-vetted-surface rounded text-vetted-text-muted">
            <X size={18} />
          </button>
        </div>

        {error && <div className="p-5 text-sm text-red-600">{error}</div>}

        {detail && (
          <div className="overflow-y-auto p-5 space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-32 h-24 shrink-0 rounded bg-vetted-surface flex items-center justify-center overflow-hidden border border-vetted-border">
                {detail.has_thumbnail ? (
                  <img src={pptxTemplates.thumbnailUrl(detail.id)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <FileText size={28} className="text-vetted-text-muted" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-xs text-vetted-text-muted uppercase tracking-wide">{TYPE_LABEL[detail.template_type] || detail.template_type}</p>
                <p className="text-sm text-vetted-text-secondary mt-1">
                  {detail.manifest?.slide_count ?? detail.slide_count} slides
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-xs uppercase tracking-wide text-vetted-text-muted mb-2">Slides</h4>
              <ol className="space-y-1 text-sm">
                {(detail.manifest?.slides || []).map(s => (
                  <li key={s.index} className="flex items-baseline gap-2">
                    <span className="text-vetted-text-muted text-xs w-6 shrink-0">{s.index}.</span>
                    <span className="text-vetted-primary">{s.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
