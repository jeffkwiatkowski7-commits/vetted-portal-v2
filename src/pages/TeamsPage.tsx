import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, Trash2 } from 'lucide-react';
import * as api from '../api';
import type { Team } from '../types';

export default function TeamsPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.teams.list().then((rows) => { setTeams(rows); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Archive team "${name}"?`)) return;
    await api.teams.delete(id);
    setTeams((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="flex-1 overflow-y-auto bg-vetted-bg">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-serif text-vetted-primary">Teams</h1>
            <p className="text-sm text-vetted-text-muted mt-1">
              Bundle projects into a coordinated agentic workflow.
            </p>
          </div>
          <button
            onClick={() => navigate('/teams/new')}
            className="flex items-center gap-2 px-4 py-2 bg-vetted-primary text-white rounded-lg hover:bg-black transition-colors text-sm"
          >
            <Plus size={14} /> New Team
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-vetted-text-muted">Loading…</p>
        ) : teams.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-vetted-border rounded-xl">
            <Users size={28} className="mx-auto text-vetted-text-muted mb-3" />
            <p className="text-sm text-vetted-text-muted">No teams yet. Click <strong>New Team</strong> to build one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {teams.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-4 px-5 py-4 bg-white rounded-xl border border-vetted-border hover:border-vetted-accent transition-colors cursor-pointer"
                onClick={() => navigate(`/teams/${t.id}/edit`)}
              >
                <Users size={18} className="text-vetted-accent" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-vetted-primary truncate">{t.name}</div>
                  {t.description && (
                    <div className="text-xs text-vetted-text-muted truncate mt-0.5">{t.description}</div>
                  )}
                </div>
                <span className="text-xs text-vetted-text-muted whitespace-nowrap">
                  {t.member_count ?? 0} sub-agent{(t.member_count ?? 0) === 1 ? '' : 's'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(t.id, t.name); }}
                  className="p-2 hover:bg-vetted-surface rounded-lg text-vetted-text-muted"
                  title="Archive"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
