import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { adminPptxTemplates } from '../api';
import type { PptxTemplate, PptxTemplateDetail } from '../types';
import { TemplateRow, PreviewModal } from '../components/templates';
import { ArrowLeft, Search, Plus, Pencil, KeyRound, Trash2, X, Eye, EyeOff } from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  job_title: string | null;
  department: string | null;
  role: string;
  status: string;
  has_password: boolean;
  last_login_at: string | null;
  templates_count: number;
}

type ModalType = null | 'add' | 'edit' | 'password';

interface UserForm {
  firstName: string;
  lastName: string;
  email: string;
  job_title: string;
  department: string;
  role: string;
  status: string;
  password: string;
  confirmPassword: string;
}

const emptyForm: UserForm = {
  firstName: '', lastName: '', email: '', job_title: '', department: '',
  role: 'user', status: 'active', password: '', confirmPassword: '',
};

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

const fieldClass = "w-full px-3 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent text-sm";

function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggle,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-vetted-primary mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="••••••••"
          className={fieldClass + ' pr-10'}
        />
        <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-vetted-text-muted hover:text-vetted-primary" tabIndex={-1}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const { user: currentUser, addToast } = useStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalType>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [panelUser, setPanelUser] = useState<AdminUser | null>(null);
  const [panelTemplates, setPanelTemplates] = useState<PptxTemplate[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const openTemplatesPanel = async (u: AdminUser) => {
    setPanelUser(u);
    setPanelLoading(true);
    setPanelTemplates([]);
    try {
      const list = await adminPptxTemplates.forUser(u.id);
      // Override has_thumbnail to false — admin can't fetch user-scoped thumbnails,
      // so force the placeholder icon to render instead of broken images.
      const sanitized = list.map((t: PptxTemplate) => ({ ...t, has_thumbnail: false }));
      setPanelTemplates(sanitized);
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message || 'Failed to load templates' });
    } finally {
      setPanelLoading(false);
    }
  };

  // Admin previews use the admin endpoint as their loader since the user-scoped
  // detail route would 404 (admin doesn't own the template).
  const adminPreviewLoader = useCallback((id: string): Promise<PptxTemplateDetail> => {
    if (!panelUser) return Promise.reject(new Error('No user selected'));
    return adminPptxTemplates.forUser(panelUser.id).then((list: PptxTemplate[]) => {
      const t = list.find(x => x.id === id);
      if (!t) throw new Error('Template not found');
      // Admin endpoint returns the same minimal shape as the user list — for v1 we
      // construct a detail-shaped object with no manifest. PreviewModal renders
      // gracefully when manifest is null.
      return { ...t, has_thumbnail: false, manifest: null } as PptxTemplateDetail;
    });
  }, [panelUser]);

  useEffect(() => {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'super_admin') {
      navigate('/');
      return;
    }
    loadUsers();
  }, [currentUser, navigate]);

  const loadUsers = async () => {
    try {
      const data = await api.admin.users.list();
      setUsers(data);
    } catch {
      addToast({ type: 'error', title: 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setForm(emptyForm); setFormError(''); setShowPw(false); setShowConfirmPw(false); setModal('add'); };
  const openEdit = (u: AdminUser) => {
    const [firstName, ...rest] = u.display_name.split(' ');
    setForm({ firstName, lastName: rest.join(' '), email: u.email, job_title: u.job_title || '', department: u.department || '', role: u.role, status: u.status, password: '', confirmPassword: '' });
    setFormError('');
    setShowPw(false);
    setShowConfirmPw(false);
    setSelectedUser(u);
    setModal('edit');
  };
  const openPassword = (u: AdminUser) => { setForm({ ...emptyForm }); setFormError(''); setShowPw(false); setShowConfirmPw(false); setSelectedUser(u); setModal('password'); };
  const closeModal = () => { setModal(null); setSelectedUser(null); setFormError(''); };

  const handleAdd = async () => {
    if (!form.email || !form.firstName) { setFormError('Email and first name are required'); return; }
    if (form.password && form.password !== form.confirmPassword) { setFormError('Passwords do not match'); return; }
    setSubmitting(true); setFormError('');
    try {
      await api.admin.users.create({
        email: form.email,
        display_name: [form.firstName, form.lastName].filter(Boolean).join(' '),
        job_title: form.job_title || undefined,
        department: form.department || undefined,
        role: form.role,
        password: form.password || undefined,
      });
      addToast({ type: 'success', title: 'User created' });
      closeModal();
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!form.email || !form.firstName) { setFormError('Email and first name are required'); return; }
    if (form.password && form.password !== form.confirmPassword) { setFormError('Passwords do not match'); return; }
    if (!selectedUser) return;
    setSubmitting(true); setFormError('');
    try {
      await api.admin.users.update(selectedUser.id, {
        email: form.email,
        display_name: [form.firstName, form.lastName].filter(Boolean).join(' '),
        job_title: form.job_title || undefined,
        department: form.department || undefined,
        role: form.role,
        status: form.status,
      });
      if (form.password) {
        try {
          await api.admin.users.setPassword(selectedUser.id, form.password);
        } catch {
          addToast({ type: 'error', title: 'Profile saved but password update failed — try again from the Password button' });
          closeModal();
          await loadUsers();
          return;
        }
      }
      addToast({ type: 'success', title: 'User updated' });
      closeModal();
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetPassword = async () => {
    if (!form.password) { setFormError('Password is required'); return; }
    if (form.password !== form.confirmPassword) { setFormError('Passwords do not match'); return; }
    if (!selectedUser) return;
    setSubmitting(true); setFormError('');
    try {
      await api.admin.users.setPassword(selectedUser.id, form.password);
      addToast({ type: 'success', title: 'Password updated' });
      closeModal();
      await loadUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (u: AdminUser) => {
    if (!confirm(`Delete ${u.display_name}? This cannot be undone.`)) return;
    try {
      await api.admin.users.remove(u.id);
      addToast({ type: 'success', title: 'User deleted' });
      await loadUsers();
    } catch (err) {
      addToast({ type: 'error', title: err instanceof Error ? err.message : 'Failed to delete user' });
    }
  };

  const filtered = users.filter(u =>
    u.display_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: users.length,
    active: users.filter(u => u.status === 'active').length,
    admins: users.filter(u => u.role === 'admin' || u.role === 'super_admin').length,
    withPassword: users.filter(u => u.has_password).length,
  };

  if (loading) return <div className="flex items-center justify-center h-full"><p className="text-vetted-text-secondary">Loading users...</p></div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-vetted-border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/admin')} className="p-2 hover:bg-vetted-surface rounded-lg transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-3xl font-serif text-vetted-primary">Manage Users</h1>
          </div>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Add User
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Users', value: stats.total },
            { label: 'Active', value: stats.active },
            { label: 'Admins', value: stats.admins },
            { label: 'Password Set', value: stats.withPassword },
          ].map(({ label, value }) => (
            <div key={label} className="card text-center py-4">
              <p className="text-3xl font-serif font-bold text-vetted-primary">{value}</p>
              <p className="text-xs text-vetted-text-secondary mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-vetted-text-muted" />
          <input
            type="text"
            placeholder="Search users…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent text-sm"
          />
        </div>

        {/* Table */}
        <div className="card p-0 overflow-hidden">
          <table className="w-full min-w-[700px]">
            <thead className="bg-vetted-surface border-b border-vetted-border">
              <tr className="text-left text-xs font-medium text-vetted-text-muted uppercase tracking-wide">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Password</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Templates</th>
                <th className="px-4 py-3 whitespace-nowrap">Last Login</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vetted-border">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-vetted-surface/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-vetted-accent flex items-center justify-center text-vetted-primary font-bold text-xs shrink-0">
                        {initials(u.display_name)}
                      </div>
                      <div>
                        <p className="font-medium text-vetted-primary text-sm">{u.display_name}</p>
                        <p className="text-xs text-vetted-text-secondary">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                      u.role === 'admin' || u.role === 'super_admin'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-indigo-100 text-indigo-800'
                    }`}>
                      {u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {u.has_password
                      ? <span className="text-green-600 font-medium">✓ Set</span>
                      : <span className="text-red-500 font-medium">✗ Not set</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {u.templates_count === 0 ? (
                      <span className="text-vetted-text-muted">0 templates</span>
                    ) : (
                      <button
                        onClick={() => openTemplatesPanel(u)}
                        className="text-vetted-accent hover:underline font-medium"
                      >
                        {u.templates_count} {u.templates_count === 1 ? 'template' : 'templates'}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-vetted-text-muted whitespace-nowrap">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-vetted-surface rounded transition-colors text-vetted-text-muted hover:text-vetted-primary" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => openPassword(u)} className="p-1.5 hover:bg-vetted-surface rounded transition-colors text-vetted-text-muted hover:text-vetted-primary" title="Set password">
                        <KeyRound size={14} />
                      </button>
                      {u.id !== currentUser?.id && (
                        <button onClick={() => handleDelete(u)} className="p-1.5 hover:bg-red-50 rounded transition-colors text-vetted-text-muted hover:text-red-500" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-vetted-text-muted text-sm">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between p-6 border-b border-vetted-border">
              <h2 className="text-xl font-serif font-bold text-vetted-primary">
                {modal === 'add' ? 'Add User' : modal === 'edit' ? 'Edit User' : 'Reset Password'}
              </h2>
              <button onClick={closeModal} className="p-1 hover:bg-vetted-surface rounded transition-colors"><X size={18} /></button>
            </div>

            {/* Modal body */}
            <div className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{formError}</div>
              )}

              {(modal === 'add' || modal === 'edit') && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">First Name *</label>
                      <input type="text" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} placeholder="First" className={fieldClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">Last Name</label>
                      <input type="text" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} placeholder="Last" className={fieldClass} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-vetted-primary mb-1">Email *</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@example.com" className={fieldClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">Job Title</label>
                      <input type="text" value={form.job_title} onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))} placeholder="e.g. Analyst" className={fieldClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">Department</label>
                      <input type="text" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Finance" className={fieldClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-vetted-primary mb-1">Role</label>
                      <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={fieldClass}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    {modal === 'edit' && (
                      <div>
                        <label className="block text-sm font-medium text-vetted-primary mb-1">Status</label>
                        <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={fieldClass}>
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="border-t border-vetted-border pt-4">
                    <p className="text-xs text-vetted-text-muted mb-3">{modal === 'add' ? 'Optional — set a password now or later' : 'Leave blank to keep current password'}</p>
                    <div className="space-y-3">
                      <PasswordField label="Password" value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} show={showPw} onToggle={() => setShowPw(v => !v)} />
                      <PasswordField label="Confirm Password" value={form.confirmPassword} onChange={v => setForm(f => ({ ...f, confirmPassword: v }))} show={showConfirmPw} onToggle={() => setShowConfirmPw(v => !v)} />
                    </div>
                  </div>
                </>
              )}

              {modal === 'password' && (
                <div className="space-y-3">
                  <p className="text-sm text-vetted-text-secondary">Setting password for <strong>{selectedUser?.display_name}</strong></p>
                  <PasswordField label="New Password" value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} show={showPw} onToggle={() => setShowPw(v => !v)} />
                  <PasswordField label="Confirm Password" value={form.confirmPassword} onChange={v => setForm(f => ({ ...f, confirmPassword: v }))} show={showConfirmPw} onToggle={() => setShowConfirmPw(v => !v)} />
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-3 p-6 border-t border-vetted-border">
              <button onClick={closeModal} className="px-4 py-2 text-sm border border-vetted-border rounded-lg hover:bg-vetted-surface transition-colors">
                Cancel
              </button>
              <button
                onClick={modal === 'add' ? handleAdd : modal === 'edit' ? handleEdit : handleSetPassword}
                disabled={submitting}
                className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50"
              >
                {submitting ? 'Saving…' : modal === 'add' ? 'Create User' : modal === 'password' ? 'Set Password' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates slide-over panel */}
      {panelUser && (
        <div className="fixed inset-0 z-40 flex" onClick={() => { setPreviewId(null); setPanelUser(null); }}>
          <div className="flex-1 bg-black/40" />
          <div
            className="w-full max-w-md bg-white shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-vetted-border flex items-center justify-between">
              <div>
                <h3 className="font-serif text-lg text-vetted-primary">{panelUser.display_name}</h3>
                <p className="text-xs text-vetted-text-muted">{panelUser.email}</p>
              </div>
              <button onClick={() => { setPreviewId(null); setPanelUser(null); }} className="p-1 hover:bg-vetted-surface rounded text-vetted-text-muted">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {panelLoading && <p className="text-sm text-vetted-text-muted">Loading…</p>}
              {!panelLoading && panelTemplates.length === 0 && (
                <p className="text-sm text-vetted-text-muted text-center py-8">This user has no templates.</p>
              )}
              {!panelLoading && panelTemplates.map(t => (
                <div key={t.id}>
                  <TemplateRow
                    template={t}
                    actions={
                      <button
                        onClick={() => setPreviewId(t.id)}
                        title="Preview"
                        className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted"
                      >
                        <Eye size={14} />
                      </button>
                    }
                  />
                  <p className="text-[10px] text-vetted-text-muted font-mono mt-1 ml-1">{t.id}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <PreviewModal
        templateId={previewId}
        onClose={() => setPreviewId(null)}
        loader={adminPreviewLoader}
      />
    </div>
  );
}
