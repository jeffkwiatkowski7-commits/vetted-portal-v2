import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { ArrowLeft, Search, Trash2, MessageSquare } from 'lucide-react';

interface ChatRow {
  id: string;
  title: string;
  user_id: string;
  project_id: string | null;
  model: string;
  created_at: string;
  updated_at: string;
  display_name: string;
  email: string;
  project_name: string | null;
  message_count: number;
}

function initials(name: string) {
  return (name || '?').split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

export default function AdminChatsPage() {
  const navigate = useNavigate();
  const { user, addToast } = useStore();

  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const [rows, setRows] = useState<ChatRow[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<{ id: string; display_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.admin.chatHistory.list({
        page, limit: LIMIT,
        ...(search ? { q: search } : {}),
        ...(userId ? { user_id: userId } : {}),
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch {
      addToast({ type: 'error', title: 'Failed to load chats' });
    } finally {
      setLoading(false);
    }
  }, [page, search, userId, addToast]);

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'super_admin') { navigate('/'); return; }
    api.admin.users.list().then(setUsers).catch(() => {});
  }, [user, navigate]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const prevFilters = useRef({ search, userId });
  useEffect(() => {
    const p = prevFilters.current;
    if (p.search !== search || p.userId !== userId) {
      setPage(1);
      prevFilters.current = { search, userId };
    }
  }, [search, userId]);

  const handleDelete = async (chat: ChatRow) => {
    if (!confirm(`Delete "${chat.title}"? This removes all messages and cannot be undone.`)) return;
    try {
      await api.admin.chatHistory.remove(chat.id);
      addToast({ type: 'success', title: 'Chat deleted' });
      await loadRows();
    } catch {
      addToast({ type: 'error', title: 'Failed to delete chat' });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const startEntry = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endEntry = Math.min(page * LIMIT, total);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };
  };

  const fieldClass = 'px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent text-sm bg-white';

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border p-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/admin')} className="p-2 hover:bg-vetted-surface rounded-lg transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-3xl font-serif text-vetted-primary">Chat History</h1>
          <span className="text-sm text-vetted-text-secondary ml-auto">{total} chat{total !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-vetted-text-muted" />
            <input type="text" placeholder="Search by title..." value={search}
              onChange={e => setSearch(e.target.value)}
              className={`${fieldClass} pl-8 w-56`} />
          </div>
          <select value={userId} onChange={e => setUserId(e.target.value)} className={fieldClass}>
            <option value="">All Users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
        </div>

        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-vetted-text-secondary text-sm">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead className="bg-vetted-surface border-b border-vetted-border">
                  <tr className="text-left text-xs font-medium text-vetted-text-muted uppercase tracking-wide">
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Chat</th>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3 whitespace-nowrap">Messages</th>
                    <th className="px-4 py-3 whitespace-nowrap">Last Active</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vetted-border">
                  {rows.map(row => {
                    const { date, time } = formatDate(row.updated_at);
                    return (
                      <tr key={row.id} className="hover:bg-vetted-surface/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-vetted-accent flex items-center justify-center text-vetted-primary font-bold text-xs shrink-0">
                              {initials(row.display_name)}
                            </div>
                            <div>
                              <p className="font-medium text-vetted-primary text-sm">{row.display_name}</p>
                              <p className="text-xs text-vetted-text-secondary">{row.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-vetted-primary font-medium truncate max-w-xs">{row.title}</p>
                          <p className="text-xs text-vetted-text-muted">{row.model}</p>
                        </td>
                        <td className="px-4 py-3">
                          {row.project_name ? (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">{row.project_name}</span>
                          ) : (
                            <span className="text-xs text-vetted-text-muted">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <MessageSquare size={13} className="text-vetted-text-muted" />
                            <span className="text-sm text-vetted-primary">{row.message_count}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm text-vetted-primary">{date}</p>
                          <p className="text-xs text-vetted-text-secondary">{time}</p>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleDelete(row)}
                            className="p-1.5 hover:bg-red-50 rounded transition-colors text-vetted-text-muted hover:text-red-500"
                            title="Delete chat"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-vetted-text-muted text-sm">No chats found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-vetted-border bg-vetted-surface/50">
              <span className="text-xs text-vetted-text-secondary">
                Showing {startEntry}--{endEntry} of {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-2 py-1 text-xs border border-vetted-border rounded hover:bg-vetted-surface disabled:opacity-40">&lsaquo;</button>
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
                  className="px-2 py-1 text-xs border border-vetted-border rounded hover:bg-vetted-surface disabled:opacity-40">&rsaquo;</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
