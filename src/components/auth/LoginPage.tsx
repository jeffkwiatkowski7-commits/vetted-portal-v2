import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store';
import * as api from '../../api';
import { AlertCircle } from 'lucide-react';

const DEMO_USERS = [
  'admin@vetted.com',
  'james.wilson@company.com',
  'sarah.chen@company.com',
  'michael.rodriguez@company.com',
];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from || '/';
  const setUser = useStore((s) => s.setUser);
  const [email, setEmail] = useState(DEMO_USERS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.auth.login(email);
      localStorage.setItem('userId', result.user.id);
      setUser(result.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-serif font-bold text-vetted-primary">
            Vetted<span className="text-vetted-accent">.</span>
          </h1>
        </div>

        {/* Card */}
        <div className="card shadow-lg">
          <h2 className="text-2xl font-serif text-vetted-primary mb-2">Welcome to Vetted AI</h2>
          <p className="text-vetted-text-secondary mb-6">Sign in to access your portal</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
              <AlertCircle size={18} className="text-vetted-danger flex-shrink-0 mt-0.5" />
              <p className="text-sm text-vetted-danger">{error}</p>
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-medium text-vetted-primary mb-2">
              Select Demo User
            </label>
            <select
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent bg-white"
            >
              {DEMO_USERS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <p className="text-xs text-vetted-text-secondary text-center mt-4">
            Demo mode - Select any user to continue
          </p>
        </div>
      </div>
    </div>
  );
}
