import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { ArrowLeft, Search, ChevronDown } from 'lucide-react';
import type { User } from '../types';

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const { user: currentUser, addToast } = useStore();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'super_admin') {
      navigate('/');
      return;
    }
    loadUsers();
  }, [currentUser, navigate]);

  const loadUsers = async () => {
    try {
      const data = await api.admin.users();
      setUsers(data);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to load users',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    setUpdating(userId);
    try {
      await api.admin.updateRole(userId, role);
      setUsers(users.map((u) => (u.id === userId ? { ...u, role: role as any } : u)));
      addToast({
        type: 'success',
        title: 'User role updated',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to update user',
      });
    } finally {
      setUpdating(null);
    }
  };

  const handleStatusChange = async (userId: string, status: string) => {
    setUpdating(userId);
    try {
      await api.admin.updateStatus(userId, status);
      setUsers(users.map((u) => (u.id === userId ? { ...u, status: status as any } : u)));
      addToast({
        type: 'success',
        title: 'User status updated',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to update user',
      });
    } finally {
      setUpdating(null);
    }
  };

  const filtered = users.filter(
    (u) =>
      u.display_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary">Loading users...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-vetted-border p-6 space-y-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin')}
            className="p-2 hover:bg-vetted-surface rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-3xl font-serif text-vetted-primary">Manage Users</h1>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search
            size={18}
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-vetted-text-muted"
          />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent input-field"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="bg-vetted-surface sticky top-0 border-b border-vetted-border">
            <tr className="text-left text-xs font-medium text-vetted-text-muted">
              <th className="px-6 py-3">Avatar</th>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Email</th>
              <th className="px-6 py-3">Role</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Last Active</th>
              <th className="px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vetted-border">
            {filtered.map((u) => (
              <tr key={u.id} className="hover:bg-vetted-surface transition-colors">
                <td className="px-6 py-4">
                  <div className="w-8 h-8 rounded-full bg-vetted-accent flex items-center justify-center text-vetted-primary font-medium text-sm">
                    {u.display_name[0]?.toUpperCase()}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <p className="font-medium text-vetted-primary">{u.display_name}</p>
                  {u.job_title && <p className="text-xs text-vetted-text-secondary">{u.job_title}</p>}
                </td>
                <td className="px-6 py-4 text-sm text-vetted-text-secondary">{u.email}</td>
                <td className="px-6 py-4">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    disabled={updating === u.id}
                    className="text-sm px-2 py-1 border border-vetted-border rounded bg-white focus:outline-none focus:ring-2 focus:ring-vetted-accent"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </td>
                <td className="px-6 py-4">
                  <select
                    value={u.status}
                    onChange={(e) => handleStatusChange(u.id, e.target.value)}
                    disabled={updating === u.id}
                    className={`text-sm px-2 py-1 border border-vetted-border rounded bg-white focus:outline-none focus:ring-2 focus:ring-vetted-accent ${
                      u.status === 'suspended' ? 'text-vetted-danger' : 'text-vetted-success'
                    }`}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </td>
                <td className="px-6 py-4 text-sm text-vetted-text-muted">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-6 py-4">
                  <button className="text-vetted-text-secondary hover:text-vetted-primary transition-colors">
                    {/* More menu could go here */}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
