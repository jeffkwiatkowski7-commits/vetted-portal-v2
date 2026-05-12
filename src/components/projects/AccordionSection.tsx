import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
  num?: string;            // 'i', 'ii', etc.
  title: string;
  summary: string;         // one-line state shown in header
  defaultOpen?: boolean;
  rightAside?: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}

export default function AccordionSection({ num, title, summary, defaultOpen, rightAside, danger, children }: Props) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition-shadow ${open ? 'shadow-md' : 'shadow-sm'} ${danger ? 'border-red-200' : 'border-vetted-border'}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-4 px-5 py-4 text-left ${open ? '' : 'hover:bg-vetted-surface'} transition-colors`}
      >
        {num && (
          <span className={`font-serif italic text-xs font-bold w-5 ${danger ? 'text-red-600' : 'text-vetted-accent'}`}>
            {num}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h3 className={`font-serif font-bold text-base ${danger ? 'text-red-600' : 'text-vetted-primary'}`}>{title}</h3>
          <p className="text-xs text-vetted-text-muted mt-0.5 truncate">{summary}</p>
        </div>
        {rightAside}
        <ChevronRight size={16} className={`text-vetted-text-muted transition-transform ${open ? 'rotate-90 text-vetted-accent' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pt-4 pb-5 border-t border-vetted-border/50">
          {children}
        </div>
      )}
    </div>
  );
}
