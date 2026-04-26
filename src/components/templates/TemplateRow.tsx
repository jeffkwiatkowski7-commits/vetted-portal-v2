import React from 'react';
import { FileText } from 'lucide-react';
import type { PptxTemplate } from '../../types';
import { pptxTemplates } from '../../api';

const TYPE_LABEL: Record<string, string> = {
  ic_memo: 'IC Memo',
  one_pager: 'One Pager',
  investor_update: 'Investor Update',
  custom: 'Custom',
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export interface TemplateRowProps {
  template: PptxTemplate;
  actions?: React.ReactNode;
  onClick?: () => void;
}

export function TemplateRow({ template, actions, onClick }: TemplateRowProps) {
  return (
    <div
      className={`flex items-start gap-3 p-3 border border-vetted-border rounded-lg ${onClick ? 'cursor-pointer hover:bg-vetted-surface/50' : ''} transition-colors`}
      onClick={onClick}
    >
      <div className="w-16 h-12 shrink-0 rounded bg-vetted-surface flex items-center justify-center overflow-hidden border border-vetted-border">
        {template.has_thumbnail ? (
          <img
            src={pptxTemplates.thumbnailUrl(template.id)}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <FileText size={18} className="text-vetted-text-muted" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-vetted-primary text-sm truncate">{template.name}</p>
          {template.status === 'archived' && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-vetted-surface text-vetted-text-muted">
              Archived
            </span>
          )}
        </div>
        <p className="text-xs text-vetted-text-secondary mt-0.5">
          <span className="inline-block px-1.5 py-0.5 rounded bg-vetted-accent/15 text-vetted-accent font-medium mr-2">
            {TYPE_LABEL[template.template_type] || template.template_type}
          </span>
          {template.slide_count} slide{template.slide_count === 1 ? '' : 's'} · {relativeTime(template.updated_at)}
        </p>
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  );
}
