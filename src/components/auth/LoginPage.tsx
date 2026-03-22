import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store';
import * as api from '../../api';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from || '/';
  const setUser = useStore((s) => s.setUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.auth.login(email, password);
      localStorage.setItem('userId', result.user.id);
      setUser(result.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin();
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-serif font-bold text-vetted-primary">
            Vetted<span className="text-vetted-accent">.</span>
          </h1>
        </div>

        <div className="card shadow-lg">
          <h2 className="text-2xl font-serif text-vetted-primary mb-2">Welcome back</h2>
          <p className="text-vetted-text-secondary mb-6">Sign in to access your portal</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
              <AlertCircle size={18} className="text-vetted-danger flex-shrink-0 mt-0.5" />
              <p className="text-sm text-vetted-danger">{error}</p>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-vetted-primary mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="you@example.com"
              className="w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-vetted-primary mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                placeholder="••••••••"
                className="w-full px-3 py-2 pr-10 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-vetted-text-muted hover:text-vetted-primary"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
}
