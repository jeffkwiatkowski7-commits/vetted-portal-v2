import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import * as api from '../../api';
import type { UserSearchResult } from '../../types';

interface Props {
  placeholder?: string;
  excludeUserIds?: string[];
  onSelect: (user: UserSearchResult) => void;
  onSubmit?: (email: string) => void;  // when user types email + presses enter, no match selected
  disabled?: boolean;
}

export default function EmailAutocomplete({ placeholder, excludeUserIds = [], onSelect, onSubmit, disabled }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const users = await api.users.search(q.trim());
        setResults(users.filter((u: UserSearchResult) => !excludeUserIds.includes(u.id)));
        setOpen(true);
        setHighlight(0);
      } catch {
        setResults([]);
      }
    }, 180);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [q, excludeUserIds.join(',')]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlight]) { onSelect(results[highlight]); setQ(''); setOpen(false); }
      else if (onSubmit && q.includes('@')) { onSubmit(q.trim()); }
    } else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-vetted-text-muted" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder || 'name or email'}
          disabled={disabled}
          className="w-full pl-9 pr-3 py-2 text-sm border border-vetted-border rounded-lg bg-white focus:outline-none focus:border-vetted-accent disabled:opacity-50"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-vetted-border rounded-lg shadow-lg z-30 max-h-64 overflow-y-auto">
          {results.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => { onSelect(u); setQ(''); setOpen(false); }}
              className={`w-full text-left px-3 py-2 flex items-center gap-2.5 ${i === highlight ? 'bg-vetted-surface' : 'hover:bg-vetted-surface'}`}
            >
              <div className="w-7 h-7 rounded-full bg-vetted-primary text-white text-xs flex items-center justify-center flex-shrink-0">
                {u.display_name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-vetted-primary truncate">{u.display_name}</div>
                <div className="text-xs text-vetted-text-muted truncate">{u.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
