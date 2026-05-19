import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store';
import * as api from '../../api';
import {
  Plus,
  FolderOpen,
  BookOpen,
  Sparkles,
  Grid3X3,
  Puzzle,
  Shield,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Trash2,
  Pencil,
  Users,
  FolderInput,
  ChevronRight as ChevronRightIcon,
} from 'lucide-react';
import type { Chat, Project } from '../../types';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    sidebarCollapsed,
    toggleSidebar,
    chats,
    setChats,
    activeChat,
    setActiveChat,
    setUser,
    setChatAttachedFiles,
    setPendingProjectId,
  } = useStore();
  const [contextMenu, setContextMenu] = useState<{ chatId: string; x: number; y: number } | null>(null);
  const [menuView, setMenuView] = useState<'main' | 'move'>('main');
  const [moveProjects, setMoveProjects] = useState<Project[] | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    api.chats.list().then(setChats).catch(() => setChats([]));
  }, [setChats]);

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  // Detect project context: either on a /projects/:id page, or viewing a project chat at /chat/:id.
  // Do NOT fall back to activeChat.project_id on other routes (e.g. /projects list, /library) —
  // stale activeChat would otherwise lock the user into a project they've already navigated away from.
  const projectRouteMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const onChatRoute = location.pathname.startsWith('/chat/');
  const currentProjectId = projectRouteMatch
    ? projectRouteMatch[1]
    : onChatRoute
    ? activeChat?.project_id ?? null
    : null;
  const isInProjectChat = !!currentProjectId;

  const handleNewChat = () => {
    setChatAttachedFiles([]);
    setActiveChat(null);
    if (isInProjectChat) {
      // Navigate to the project page — clears chat and shows fresh input
      navigate(`/projects/${currentProjectId}`);
    } else {
      setPendingProjectId(null);
      navigate('/');
    }
  };

  const handleRenameChat = async (chatId: string) => {
    if (!newTitle.trim()) return;
    try {
      await api.chats.update(chatId, { title: newTitle });
      setChats(chats.map((c) => (c.id === chatId ? { ...c, title: newTitle } : c)));
      setRenaming(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      await api.chats.delete(chatId);
      setChats(chats.filter((c) => c.id !== chatId));
      if (activeChat?.id === chatId) setActiveChat(null);
      closeContextMenu();
    } catch (err) {
      console.error(err);
    }
  };

  const closeContextMenu = () => {
    setContextMenu(null);
    setMenuView('main');
  };

  const openMoveSubmenu = async () => {
    setMenuView('move');
    if (moveProjects) return;
    setMoveLoading(true);
    try {
      const list = await api.projects.list();
      setMoveProjects(list);
    } catch (err) {
      console.error(err);
      setMoveProjects([]);
    } finally {
      setMoveLoading(false);
    }
  };

  const handleMoveChat = async (chatId: string, projectId: string | null) => {
    try {
      const updated = await api.chats.update(chatId, { project_id: projectId });
      setChats(chats.map((c) => (c.id === chatId ? { ...c, project_id: updated.project_id } : c)));
      if (activeChat?.id === chatId) setActiveChat({ ...activeChat, project_id: updated.project_id });
      closeContextMenu();
    } catch (err) {
      console.error(err);
    }
  };

  const projectChats = chats.filter((c) => c.project_id);
  const recentChats = chats.filter((c) => !c.project_id).slice(0, 5);

  return (
    <div
      className={`flex flex-col bg-vetted-surface border-r border-vetted-border transition-all duration-300 ${
        sidebarCollapsed ? 'w-sidebar-collapsed' : 'w-sidebar'
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-vetted-border flex items-center justify-between">
        {!sidebarCollapsed && (
          <h1 className="text-2xl font-serif font-bold text-vetted-primary">
            Vetted<span className="text-vetted-accent">.</span>
          </h1>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 hover:bg-white rounded-lg transition-colors"
          title={sidebarCollapsed ? 'Expand' : 'Collapse'}
        >
          {sidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      {/* New Chat Button */}
      <div className="px-3 pb-0.5">
        <button
          onClick={handleNewChat}
          title={sidebarCollapsed ? (isInProjectChat ? 'New Chat (Projects)' : 'New Chat') : ''}
          className="w-full flex items-center gap-2.5 px-3 py-1 rounded-lg transition-colors border-l-4 border-l-transparent text-vetted-text-secondary hover:bg-white hover:bg-opacity-50"
        >
          <Plus size={14} />
          {!sidebarCollapsed && <span className="text-xs">{isInProjectChat ? 'New Chat (Projects)' : 'New Chat'}</span>}
        </button>
      </div>

      {/* Navigation */}
      <nav className="px-3 space-y-0 mb-4">
        {[
          { path: '/projects', icon: FolderOpen, label: 'Projects' },
          { path: '/library', icon: BookOpen, label: 'Library' },
          { path: '/skills', icon: Sparkles, label: 'Skills' },
          { path: '/teams', icon: Users, label: 'Teams' },
          { path: '/apps', icon: Grid3X3, label: 'Apps' },
          { path: '/integrations', icon: Puzzle, label: 'Integrations' },
          ...(user?.role === 'admin' || user?.role === 'super_admin'
            ? [{ path: '/admin', icon: Shield, label: 'Admin' }]
            : []),
        ].map(({ path, icon: Icon, label }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            title={sidebarCollapsed ? label : ''}
            className={`w-full flex items-center gap-2.5 px-3 py-1 rounded-lg transition-colors border-l-4 ${
              isActive(path)
                ? 'bg-white border-l-vetted-accent text-vetted-primary'
                : 'border-l-transparent text-vetted-text-secondary hover:bg-white hover:bg-opacity-50'
            }`}
          >
            <Icon size={14} />
            {!sidebarCollapsed && <span className="text-xs">{label}</span>}
          </button>
        ))}
      </nav>

      {/* Chats Section */}
      <div className="flex-1 overflow-y-auto px-3 space-y-4">
        {!sidebarCollapsed && projectChats.length > 0 && (
          <div>
            <p className="text-xs font-medium text-vetted-text-muted px-2 mb-2">PROJECT CHATS</p>
            <div className="space-y-1 max-h-[168px] overflow-y-auto">
              {projectChats.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  isActive={activeChat?.id === chat.id}
                  onSelect={() => {
                    setActiveChat(chat);
                    navigate(chat.project_id ? `/projects/${chat.project_id}` : `/chat/${chat.id}`);
                  }}
                  onContextMenu={(x, y) => setContextMenu({ chatId: chat.id, x, y })}
                  renaming={renaming === chat.id}
                  onRenameStart={() => {
                    setRenaming(chat.id);
                    setNewTitle(chat.title);
                  }}
                  onRenameSave={() => handleRenameChat(chat.id)}
                  onRenameCancel={() => setRenaming(null)}
                  newTitle={newTitle}
                  setNewTitle={setNewTitle}
                />
              ))}
            </div>
          </div>
        )}

        {!sidebarCollapsed && recentChats.length > 0 && (
          <div>
            <p className="text-xs font-medium text-vetted-text-muted px-2 mb-2">RECENT CHATS</p>
            <div className="space-y-1">
              {recentChats.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  isActive={activeChat?.id === chat.id}
                  onSelect={() => {
                    setActiveChat(chat);
                    navigate(`/chat/${chat.id}`);
                  }}
                  onContextMenu={(x, y) => setContextMenu({ chatId: chat.id, x, y })}
                  renaming={renaming === chat.id}
                  onRenameStart={() => {
                    setRenaming(chat.id);
                    setNewTitle(chat.title);
                  }}
                  onRenameSave={() => handleRenameChat(chat.id)}
                  onRenameCancel={() => setRenaming(null)}
                  newTitle={newTitle}
                  setNewTitle={setNewTitle}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User Footer */}
      <div className="p-3 border-t border-vetted-border">
        <p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.21.10</p>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
          <div
            className="fixed bg-white border border-vetted-border rounded-lg shadow-lg z-50 min-w-[180px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {menuView === 'main' && (
              <>
                <button
                  onClick={() => {
                    setRenaming(contextMenu.chatId);
                    setNewTitle(chats.find((c) => c.id === contextMenu.chatId)?.title || '');
                    closeContextMenu();
                  }}
                  className="w-full px-3 py-2 text-sm flex items-center gap-2 hover:bg-vetted-surface text-left"
                >
                  <Pencil size={14} />
                  Rename
                </button>
                <button
                  onClick={openMoveSubmenu}
                  className="w-full px-3 py-2 text-sm flex items-center gap-2 hover:bg-vetted-surface text-left"
                >
                  <FolderInput size={14} />
                  <span className="flex-1">Move to project</span>
                  <ChevronRightIcon size={12} className="text-vetted-text-muted" />
                </button>
                <button
                  onClick={() => handleDeleteChat(contextMenu.chatId)}
                  className="w-full px-3 py-2 text-sm flex items-center gap-2 hover:bg-red-50 text-vetted-danger text-left"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </>
            )}
            {menuView === 'move' && (
              <div className="max-h-72 overflow-y-auto">
                <button
                  onClick={() => setMenuView('main')}
                  className="w-full px-3 py-2 text-xs flex items-center gap-2 hover:bg-vetted-surface text-vetted-text-muted text-left border-b border-vetted-border"
                >
                  <ChevronLeft size={12} /> Back
                </button>
                {moveLoading && (
                  <p className="px-3 py-3 text-xs text-vetted-text-muted">Loading…</p>
                )}
                {!moveLoading && moveProjects && (() => {
                  const currentProjectId = chats.find((c) => c.id === contextMenu.chatId)?.project_id ?? null;
                  return (
                    <>
                      <button
                        onClick={() => handleMoveChat(contextMenu.chatId, null)}
                        disabled={currentProjectId === null}
                        className="w-full px-3 py-2 text-sm flex items-center gap-2 hover:bg-vetted-surface text-left disabled:opacity-50 disabled:cursor-default"
                      >
                        <span className="text-vetted-text-muted">No project</span>
                        {currentProjectId === null && <span className="ml-auto text-[10px] text-vetted-text-muted">current</span>}
                      </button>
                      {moveProjects.length === 0 && (
                        <p className="px-3 py-3 text-xs text-vetted-text-muted">No projects yet</p>
                      )}
                      {moveProjects.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleMoveChat(contextMenu.chatId, p.id)}
                          disabled={currentProjectId === p.id}
                          className="w-full px-3 py-2 text-sm flex items-center gap-2 hover:bg-vetted-surface text-left disabled:opacity-50 disabled:cursor-default"
                          title={p.name}
                        >
                          <FolderOpen size={12} className="text-vetted-text-muted shrink-0" />
                          <span className="truncate">{p.name}</span>
                          {currentProjectId === p.id && <span className="ml-auto text-[10px] text-vetted-text-muted">current</span>}
                        </button>
                      ))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ChatItem({
  chat,
  isActive,
  onSelect,
  onContextMenu,
  renaming,
  onRenameStart,
  onRenameSave,
  onRenameCancel,
  newTitle,
  setNewTitle,
}: {
  chat: Chat;
  isActive: boolean;
  onSelect: () => void;
  onContextMenu: (x: number, y: number) => void;
  renaming: boolean;
  onRenameStart: () => void;
  onRenameSave: () => void;
  onRenameCancel: () => void;
  newTitle: string;
  setNewTitle: (v: string) => void;
}) {
  if (renaming) {
    return (
      <div className="flex gap-1 px-2 py-1">
        <input
          autoFocus
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameSave();
            if (e.key === 'Escape') onRenameCancel();
          }}
          onBlur={onRenameSave}
          className="flex-1 text-xs px-2 py-1 border border-vetted-border rounded focus:outline-none focus:ring-1 focus:ring-vetted-accent"
        />
      </div>
    );
  }

  return (
    <div
      className={`group relative w-full rounded transition-colors ${
        isActive
          ? 'bg-white text-vetted-primary font-medium border-l-2 border-vetted-accent'
          : 'text-vetted-text-secondary hover:bg-white hover:bg-opacity-50'
      }`}
    >
      <button
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e.clientX, e.clientY);
        }}
        className="w-full text-left pl-2 pr-7 py-1.5 text-xs truncate"
        title={chat.title}
      >
        {chat.title}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onContextMenu(rect.left, rect.bottom + 4);
        }}
        aria-label="More options"
        title="More"
        className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-vetted-surface text-vetted-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}
