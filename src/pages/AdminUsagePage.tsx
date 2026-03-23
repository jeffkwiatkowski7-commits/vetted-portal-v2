import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import type { UsageListParams, UsageRow, UsageSummary } from '../api';
import { ArrowLeft, Search, Download } from 'lucide-react';

function initials(name: string) {
  return (name || '?').split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

function formatDateRange(option: string): { from?: string; to?: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const toDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (option === 'today') { const t = toDate(now); return { from: t, to: t }; }
  if (option === '7d') { const f = new Date(now); f.setDate(now.getDate() - 6); return { from: toDate(f), to: toDate(now) }; }
  if (option === '30d') { const f = new Date(now); f.setDate(now.getDate() - 29); return { from: toDate(f), to: toDate(now) }; }
  if (option === 'month') {
    const f = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const t = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
    return { from: toDate(f), to: toDate(t) };
  }
  return {};
}

const DATE_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'month', label: 'This Month' },
];

export default function AdminUsagePage() {
  const navigate = useNavigate();
  const { user, addToast } = useStore();

  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [model, setModel] = useState('');
  const [source, setSource] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const [rows, setRows] = useState<UsageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [users, setUsers] = useState<{ id: string; display_name: string }[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const buildParams = useCallback((overrides: Partial<UsageListParams> = {}): UsageListParams => {
    const dateFilter = formatDateRange(dateRange);
    return {
      page, limit: LIMIT,
      ...(search ? { q: search } : {}),
      ...(userId ? { user_id: userId } : {}),
      ...(model ? { model } : {}),
      ...(source ? { source: source as 'chat' | 'lease' } : {}),
      ...dateFilter,
      ...overrides,
    };
  }, [page, search, userId, model, source, dateRange]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.usage.list(buildParams());
      setRows(data.rows);
      setTotal(data.total);
    } catch {
      addToast({ type: 'error', title: 'Failed to load usage data' });
    } finally {
      setLoading(false);
    }
  }, [buildParams, addToast]);

  const loadSummary = useCallback(async () => {
    try { setSummary(await api.admin.usage.summary()); } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'super_admin') { navigate('/'); return; }
    Promise.all([
      api.admin.users.list().then(setUsers).catch(() => {}),
      api.admin.usage.models().then(setModels).catch(() => {}),
      loadSummary(),
    ]);
  }, [user, navigate, loadSummary]);

  useEffect(() => { loadRows(); }, [loadRows]);

  useEffect(() => {
    const interval = setInterval(loadSummary, 30_000);
    return () => clearInterval(interval);
  }, [loadSummary]);

  const prevFilters = useRef({ search, userId, model, source, dateRange });
  useEffect(() => {
    const p = prevFilters.current;
    if (p.search !== search || p.userId !== userId || p.model !== model ||
        p.source !== source || p.dateRange !== dateRange) {
      setPage(1);
      prevFilters.current = { search, userId, model, source, dateRange };
    }
  }, [search, userId, model, source, dateRange]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await api.admin.usage.list(buildParams({ page: 1, limit: 500 }));
      const headers = ['User', 'Date', 'Source', 'Prompt', 'Model', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Est. Cost'];
      const csvRows = data.rows.map(r => [
        r.display_name || '',
        r.created_at,
        r.source,
        `"${(r.prompt || '').replace(/"/g, '""')}"`,
        r.model || '',
        r.input_tokens,
        r.output_tokens,
        r.total_tokens,
        r.estimated_cost.toFixed(5),
      ].join(','));
      const csv = [headers.join(','), ...csvRows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usage-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast({ type: 'error', title: 'Export failed' });
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startEntry = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endEntry = Math.min(page * LIMIT, total);
  const maxTokens = Math.max(1, ...rows.map(r => r.total_tokens));

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };
  };

  const fieldClass = 'px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent text-sm bg-white';

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return null;

  const statCards = [
    { label: 'Total Prompts', value: summary?.total_prompts?.toLocaleString() ?? '—' },
    { label: 'Total Tokens', value: summary ? (summary.total_tokens >= 1_000_000 ? `${(summary.total_tokens / 1_000_000).toFixed(1)}M` : summary.total_tokens.toLocaleString()) : '—' },
    { label: 'Est. Cost (Month)', value: summary ? `$${summary.estimated_cost.toFixed(2)}` : '—', gold: true },
    { label: 'Active Users', value: summary?.active_users?.toLocaleString() ?? '—' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/admin')} className="p-2 hover:bg-vetted-surface rounded-lg transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-3xl font-serif text-vetted-primary">Usage Log</h1>
          </div>
          <span className="text-xs text-vetted-text-secondary">Stats refresh every 30s</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map(({ label, value, gold }) => (
            <div key={label} className="card text-center py-4">
              <p className={`text-3xl font-serif font-bold ${gold ? 'text-vetted-accent' : 'text-vetted-primary'}`}>{value}</p>
              <p className="text-xs text-vetted-text-secondary mt-1">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-vetted-text-muted" />
            <input type="text" placeholder="Search prompts…" value={search}
              onChange={e => setSearch(e.target.value)}
              className={`${fieldClass} pl-8 w-56`} />
          </div>
          <select value={userId} onChange={e => setUserId(e.target.value)} className={fieldClass}>
            <option value="">All Users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
          <select value={model} onChange={e => setModel(e.target.value)} className={fieldClass}>
            <option value="">All Models</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={source} onChange={e => setSource(e.target.value)} className={fieldClass}>
            <option value="">All Sources</option>
            <option value="chat">Chat</option>
            <option value="lease">Lease</option>
          </select>
          <select value={dateRange} onChange={e => setDateRange(e.target.value)} className={fieldClass}>
            {DATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={handleExport} disabled={exporting || total === 0}
            className="ml-auto flex items-center gap-2 px-4 py-2 border border-vetted-border rounded-lg text-sm hover:bg-vetted-surface transition-colors disabled:opacity-50">
            <Download size={14} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>

        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-vetted-text-secondary text-sm">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="bg-vetted-surface border-b border-vetted-border">
                  <tr className="text-left text-xs font-medium text-vetted-text-muted uppercase tracking-wide">
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3 whitespace-nowrap">Date / Time</th>
                    <th className="px-4 py-3">Prompt</th>
                    <th className="px-4 py-3">Tokens</th>
                    <th className="px-4 py-3">Est. Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vetted-border">
                  {rows.map(row => {
                    const { date, time } = formatDate(row.created_at);
                    const barPct = Math.round((row.total_tokens / maxTokens) * 100);
                    return (
                      <tr key={row.id} className="hover:bg-vetted-surface/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-vetted-accent flex items-center justify-center text-vetted-primary font-bold text-xs shrink-0">
                              {initials(row.display_name || '?')}
                            </div>
                            <div>
                              <p className="font-medium text-vetted-primary text-sm">{row.display_name || '—'}</p>
                              {row.department && <p className="text-xs text-vetted-text-secondary">{row.department}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm text-vetted-primary">{date}</p>
                          <p className="text-xs text-vetted-text-secondary">{time}</p>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <p className="text-sm text-vetted-primary line-clamp-2">{row.prompt || '—'}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {row.model && <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">{row.model}</span>}
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${row.source === 'lease' ? 'bg-blue-100 text-blue-700' : 'bg-indigo-100 text-indigo-800'}`}>{row.source}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-semibold text-vetted-primary">{row.total_tokens.toLocaleString()}</p>
                          <div className="w-16 h-1 bg-vetted-border rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-vetted-accent rounded-full" style={{ width: `${barPct}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-semibold text-vetted-primary">${row.estimated_cost.toFixed(4)}</p>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-vetted-text-muted text-sm">No usage data found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-vetted-border bg-vetted-surface/50">
              <span className="text-xs text-vetted-text-secondary">
                Showing {startEntry}–{endEntry} of {total.toLocaleString()} entries
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-2 py-1 text-xs border border-vetted-border rounded hover:bg-vetted-surface disabled:opacity-40">‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = page <= 3 ? i + 1 : page + i - 2;
                  if (p < 1 || p > totalPages) return null;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`px-2 py-1 text-xs border rounded ${p === page ? 'bg-vetted-primary text-white border-vetted-primary' : 'border-vetted-border hover:bg-vetted-surface'}`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-2 py-1 text-xs border border-vetted-border rounded hover:bg-vetted-surface disabled:opacity-40">›</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
