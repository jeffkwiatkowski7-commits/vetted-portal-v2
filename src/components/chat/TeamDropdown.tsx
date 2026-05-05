import { useEffect, useState } from 'react';
import { Users, ChevronDown } from 'lucide-react';
import * as api from '../../api';
import type { Team } from '../../types';

export default function TeamDropdown({
  chatId,
  activeTeamId,
  onChange,
}: {
  chatId: string | null;
  activeTeamId: string | null;
  onChange: (teamId: string | null) => void;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.teams.list().then(setTeams).catch(() => setTeams([]));
  }, []);

  const active = teams.find((t) => t.id === activeTeamId) || null;

  const select = async (teamId: string | null) => {
    setOpen(false);
    onChange(teamId);
    if (chatId) await api.chatTeam.set(chatId, teamId);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
          active
            ? 'bg-vetted-accent/10 border-vetted-accent text-vetted-primary'
            : 'bg-white border-vetted-border text-vetted-text-muted hover:border-vetted-accent'
        }`}
        title={active ? `${active.name} is active` : 'No team active'}
      >
        <Users size={12} />
        <span className="font-medium">{active ? active.name : 'No team'}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 bg-white border border-vetted-border rounded-lg shadow-lg min-w-[200px] py-1">
          <button
            onClick={() => select(null)}
            className={`w-full text-left px-3 py-2 text-xs hover:bg-vetted-surface ${activeTeamId === null ? 'font-medium' : ''}`}
          >
            None
          </button>
          {teams.length === 0 ? (
            <div className="px-3 py-2 text-xs text-vetted-text-muted">No teams. Create one in /teams.</div>
          ) : (
            teams.map((t) => (
              <button
                key={t.id}
                onClick={() => select(t.id)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-vetted-surface ${activeTeamId === t.id ? 'font-medium' : ''}`}
              >
                <div>{t.name}</div>
                <div className="text-[11px] text-vetted-text-muted">{t.member_count ?? 0} sub-agent{(t.member_count ?? 0) === 1 ? '' : 's'}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
