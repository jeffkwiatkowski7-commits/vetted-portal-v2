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
} from 'lucide-react';
import type { Chat } from '../../types';

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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    api.chats.list().then(setChats).catch(() => setChats([]));
  }, [setChats]);

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  // Detect project context: either viewing a project chat or on a /projects/:id page
  const projectRouteMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const currentProjectId = activeChat?.project_id || (projectRouteMatch ? projectRouteMatch[1] : null);
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
      setContextMenu(null);
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
      <div className="px-3 pb-1">
        <button
          onClick={handleNewChat}
          title={sidebarCollapsed ? (isInProjectChat ? 'New Chat (Projects)' : 'New Chat') : ''}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors border-l-4 border-l-transparent text-vetted-text-secondary hover:bg-white hover:bg-opacity-50"
        >
          <Plus size={16} />
          {!sidebarCollapsed && <span className="text-sm">{isInProjectChat ? 'New Chat (Projects)' : 'New Chat'}</span>}
        </button>
      </div>

      {/* Navigation */}
      <nav className="px-3 space-y-1 mb-6">
        {[
          { path: '/projects', icon: FolderOpen, label: 'Projects' },
          { path: '/library', icon: BookOpen, label: 'Library' },
          { path: '/skills', icon: Sparkles, label: 'Skills' },
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
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors border-l-4 ${
              isActive(path)
                ? 'bg-white border-l-vetted-accent text-vetted-primary'
                : 'border-l-transparent text-vetted-text-secondary hover:bg-white hover:bg-opacity-50'
            }`}
          >
            <Icon size={16} />
            {!sidebarCollapsed && <span className="text-sm">{label}</span>}
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
        <p className="text-[10px] text-vetted-text-muted text-center pb-2 opacity-50">v1.8.3</p>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-white border border-vetted-border rounded-lg shadow-lg z-50"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button
            onClick={() => {
              setRenaming(contextMenu.chatId);
              setNewTitle(chats.find((c) => c.id === contextMenu.chatId)?.title || '');
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-sm flex items-center gap-2 hover:bg-vetted-surface text-left"
          >
            <Pencil size={14} />
            Rename
          </button>
          <button
            onClick={() => handleDeleteChat(contextMenu.chatId)}
            className="w-full px-3 py-2 text-sm flex items-center gap-2 hover:bg-red-50 text-vetted-danger text-left"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
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
            if (e.key === 'Escape') renaming = false;
          }}
          onBlur={onRenameSave}
          className="flex-1 text-sm px-2 py-1 border border-vetted-border rounded focus:outline-none focus:ring-1 focus:ring-vetted-accent"
        />
      </div>
    );
  }

  return (
    <button
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
        isActive
          ? 'bg-white text-vetted-primary font-medium border-l-2 border-vetted-accent'
          : 'text-vetted-text-secondary hover:bg-white hover:bg-opacity-50'
      }`}
      title={chat.title}
    >
      {chat.title}
    </button>
  );
}
