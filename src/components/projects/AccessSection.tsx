import React, { useEffect, useState } from 'react';
import { X, ArrowLeftRight, LogOut, Crown } from 'lucide-react';
import * as api from '../../api';
import { useStore } from '../../store';
import type { ProjectAccess, ProjectMember, ProjectOwner, UserSearchResult } from '../../types';
import EmailAutocomplete from './EmailAutocomplete';

interface Props {
  projectId: string;
  onAccessChange?: (access: ProjectAccess) => void;
}

function initials(name: string) {
  return name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
}

function MemberAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'w-7 h-7 text-xs' : size === 'lg' ? 'w-11 h-11 text-sm' : 'w-9 h-9 text-xs';
  return (
    <div className={`${dim} rounded-full bg-gradient-to-br from-vetted-primary to-vetted-text-muted text-white flex items-center justify-center flex-shrink-0 font-semibold`}>
      {initials(name)}
    </div>
  );
}

function RoleChip({ role }: { role: 'owner' | 'editor' | 'viewer' }) {
  const cls = role === 'owner'
    ? 'bg-vetted-primary text-vetted-accent'
    : role === 'editor'
      ? 'bg-vetted-accent/15 text-vetted-accent border border-vetted-accent/30'
      : 'bg-white text-vetted-text-muted border border-vetted-border';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {role === 'owner' && <Crown size={10} />}
      {role}
    </span>
  );
}

export default function AccessSection({ projectId, onAccessChange }: Props) {
  const { addToast, user } = useStore();
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const data = await api.projects.access(projectId);
      setAccess(data);
      onAccessChange?.(data);
    } catch {
      addToast({ type: 'error', title: 'Failed to load access' });
    }
  }

  useEffect(() => { reload(); }, [projectId]);

  if (!access) return <p className="text-sm text-vetted-text-muted">Loading…</p>;

  const isOwner = access.your_level === 'owner' || access.your_level === 'admin';
  const collaborators = access.members.filter(m => m.permission === 'editor');
  const viewers = access.members.filter(m => m.permission === 'viewer');
  const memberUserIds = [access.owner.id, ...access.members.map(m => m.user_id)];

  async function handleInvite(email: string, permission: 'editor' | 'viewer') {
    setBusy(true);
    try {
      await api.projects.invite(projectId, email, permission);
      addToast({ type: 'success', title: `Invited as ${permission}` });
      await reload();
    } catch (err: any) {
      const msg = err?.message?.includes('No portal user')
        ? `No user with email "${email}" exists in the portal.`
        : err?.message || 'Invite failed';
      addToast({ type: 'error', title: msg });
    } finally { setBusy(false); }
  }

  async function handleSelectFromAutocomplete(u: UserSearchResult, permission: 'editor' | 'viewer') {
    await handleInvite(u.email, permission);
  }

  async function handleRemove(userId: string) {
    if (!confirm('Remove this member?')) return;
    setBusy(true);
    try {
      await api.projects.removeMember(projectId, userId);
      addToast({ type: 'success', title: 'Member removed' });
      await reload();
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Remove failed' });
    } finally { setBusy(false); }
  }

  async function handleChangePermission(userId: string, permission: 'editor' | 'viewer') {
    setBusy(true);
    try {
      await api.projects.updateMember(projectId, userId, permission);
      await reload();
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Update failed' });
    } finally { setBusy(false); }
  }

  async function handleTransfer() {
    if (collaborators.length === 0) {
      addToast({ type: 'error', title: 'Add a collaborator first to transfer ownership' });
      return;
    }
    const choices = collaborators.map((c, i) => `${i + 1}. ${c.display_name} (${c.email})`).join('\n');
    const pick = prompt(`Transfer ownership to which collaborator?\n\n${choices}\n\nEnter number:`);
    const idx = parseInt(pick || '', 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= collaborators.length) return;
    if (!confirm(`Transfer ownership to ${collaborators[idx].display_name}? You will become an editor.`)) return;
    setBusy(true);
    try {
      await api.projects.transferOwnership(projectId, collaborators[idx].user_id);
      addToast({ type: 'success', title: 'Ownership transferred' });
      await reload();
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Transfer failed' });
    } finally { setBusy(false); }
  }

  async function handleLeave() {
    if (!confirm('Leave this project? You will lose access.')) return;
    setBusy(true);
    try {
      await api.projects.leave(projectId);
      addToast({ type: 'success', title: 'Left project' });
      window.location.href = '/projects';
    } catch (err: any) {
      addToast({ type: 'error', title: err?.message || 'Leave failed' });
      setBusy(false);
    }
  }

  function MemberRow({ member }: { member: ProjectMember }) {
    return (
      <div className="flex items-center gap-3 py-2.5 border-b border-vetted-border/50 last:border-b-0">
        <MemberAvatar name={member.display_name || member.email || '?'} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-vetted-primary truncate">{member.display_name}</p>
          <p className="text-xs text-vetted-text-muted truncate">{member.email}</p>
        </div>
        <RoleChip role={member.permission} />
        {isOwner && (
          <>
            <button
              type="button"
              onClick={() => handleChangePermission(member.user_id, member.permission === 'editor' ? 'viewer' : 'editor')}
              disabled={busy}
              className="text-xs text-vetted-text-muted hover:text-vetted-accent px-1"
              title={`Change to ${member.permission === 'editor' ? 'viewer' : 'editor'}`}
            >
              <ArrowLeftRight size={13} />
            </button>
            <button type="button" onClick={() => handleRemove(member.user_id)} disabled={busy} className="text-vetted-text-muted hover:text-red-600 px-1">
              <X size={14} />
            </button>
          </>
        )}
      </div>
    );
  }

  function InviteRow({ permission }: { permission: 'editor' | 'viewer' }) {
    return (
      <div className="mt-3 flex gap-2">
        <div className="flex-1">
          <EmailAutocomplete
            placeholder="email or name"
            excludeUserIds={memberUserIds}
            onSelect={(u) => handleSelectFromAutocomplete(u, permission)}
            onSubmit={(email) => handleInvite(email, permission)}
            disabled={busy}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Owner card */}
      <div className="flex items-center gap-3 bg-vetted-surface border border-vetted-border/60 rounded-xl px-4 py-3 mb-5">
        <MemberAvatar name={access.owner.display_name} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-vetted-primary">
            {access.owner.display_name}
            {access.owner.id === user?.id && <span className="text-xs text-vetted-text-muted font-normal ml-2">(you)</span>}
          </p>
          <p className="text-xs text-vetted-text-muted">{access.owner.email}</p>
        </div>
        <RoleChip role="owner" />
        {isOwner && (
          <button type="button" onClick={handleTransfer} disabled={busy} className="text-xs text-vetted-text-muted hover:text-vetted-accent px-2">
            Transfer…
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Collaborators */}
        <div className="bg-vetted-surface border border-vetted-border/60 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-vetted-primary">Collaborators</h4>
            <span className="text-xs text-vetted-text-muted">{collaborators.length}</span>
          </div>
          {collaborators.length === 0
            ? <p className="text-xs text-vetted-text-muted py-3">No collaborators yet.</p>
            : collaborators.map(m => <MemberRow key={m.id} member={m} />)
          }
          {isOwner && <InviteRow permission="editor" />}
        </div>

        {/* Shared with */}
        <div className="bg-vetted-surface border border-vetted-border/60 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-vetted-primary">Shared with</h4>
            <span className="text-xs text-vetted-text-muted">{viewers.length}</span>
          </div>
          {viewers.length === 0
            ? <p className="text-xs text-vetted-text-muted py-3">Not shared with anyone yet.</p>
            : viewers.map(m => <MemberRow key={m.id} member={m} />)
          }
          {isOwner && <InviteRow permission="viewer" />}
        </div>
      </div>

      {/* Self-leave for non-owners */}
      {!isOwner && access.your_level !== 'none' && (
        <div className="mt-5 pt-4 border-t border-vetted-border flex justify-end">
          <button
            type="button"
            onClick={handleLeave}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50"
          >
            <LogOut size={12} />
            Leave project
          </button>
        </div>
      )}
    </div>
  );
}
