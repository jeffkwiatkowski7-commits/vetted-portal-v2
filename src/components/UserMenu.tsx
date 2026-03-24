import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { Settings, LogOut } from 'lucide-react';

export default function UserMenu() {
  const navigate = useNavigate();
  const { user, setUser } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    api.auth.logout().finally(() => {
      localStorage.removeItem('userId');
      setUser(null);
      navigate('/login');
    });
  };

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-vetted-surface transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-vetted-accent flex items-center justify-center text-vetted-primary font-medium text-[11px]">
          {user.display_name[0]?.toUpperCase()}
        </div>
        <span className="text-xs text-vetted-text-secondary hidden sm:inline">{user.display_name}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-vetted-border py-1 z-50">
          <div className="px-3 py-2 border-b border-vetted-border">
            <p className="text-xs font-medium text-vetted-primary truncate">{user.display_name}</p>
            <p className="text-[10px] text-vetted-text-muted truncate">{user.email}</p>
          </div>
          <button
            onClick={() => { navigate('/settings'); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-vetted-text-secondary hover:bg-vetted-surface transition-colors"
          >
            <Settings size={13} />
            Settings
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-vetted-surface transition-colors"
          >
            <LogOut size={13} />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
