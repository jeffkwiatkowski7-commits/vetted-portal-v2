import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import * as api from '../../api';
import { Search, ChevronRight, Clock, X } from 'lucide-react';
import type { SearchResult } from '../../types';

export default function GlobalSearch() {
  const { searchOpen, setSearchOpen } = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        performSearch(query);
      } else {
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const performSearch = async (q: string) => {
    setLoading(true);
    try {
      const data = await api.search.query(q);
      setResults(data.slice(0, 12)); // Max 3 per category
      if (!recentSearches.includes(q)) {
        setRecentSearches([q, ...recentSearches.slice(0, 4)]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!searchOpen) return null;

  const categories = ['chats', 'projects', 'files', 'apps'] as const;
  const grouped = categories.reduce(
    (acc, cat) => {
      acc[cat] = results.filter((r) => r.category === cat).slice(0, 3);
      return acc;
    },
    {} as Record<string, SearchResult[]>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-20"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSearchOpen(false);
      }}
    >
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-2xl">
        {/* Search Input */}
        <div className="p-4 border-b border-vetted-border flex gap-3 items-center">
          <Search size={20} className="text-vetted-text-muted" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats, projects, files, apps..."
            className="flex-1 text-lg focus:outline-none input-field"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchOpen(false);
            }}
          />
          <button
            onClick={() => setSearchOpen(false)}
            className="p-1 hover:bg-vetted-surface rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Results */}
        <div className="overflow-y-auto max-h-96">
          {loading && (
            <div className="p-4 text-center text-vetted-text-secondary">
              Searching...
            </div>
          )}

          {!query && recentSearches.length > 0 && !loading && (
            <div className="p-4 space-y-2">
              <p className="text-xs font-medium text-vetted-text-muted mb-3">RECENT SEARCHES</p>
              {recentSearches.map((search) => (
                <button
                  key={search}
                  onClick={() => setQuery(search)}
                  className="w-full text-left flex items-center gap-2 p-2 hover:bg-vetted-surface rounded transition-colors text-sm text-vetted-text-secondary"
                >
                  <Clock size={14} />
                  {search}
                </button>
              ))}
            </div>
          )}

          {query && results.length === 0 && !loading && (
            <div className="p-8 text-center text-vetted-text-secondary">
              No results found
            </div>
          )}

          {query && results.length > 0 && !loading && (
            <div className="p-4 space-y-6">
              {Object.entries(grouped).map(([category, items]) => {
                if (items.length === 0) return null;
                return (
                  <div key={category}>
                    <p className="text-xs font-medium text-vetted-text-muted mb-2 uppercase">
                      {category}
                    </p>
                    <div className="space-y-1">
                      {items.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => {
                            setSearchOpen(false);
                            // Navigate to result based on category
                          }}
                          className="w-full text-left p-3 rounded hover:bg-vetted-surface transition-colors border-l-2 border-transparent hover:border-vetted-accent"
                        >
                          <p className="text-sm font-medium text-vetted-primary">
                            {result.title}
                          </p>
                          <p className="text-xs text-vetted-text-secondary">
                            {result.subtitle}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
