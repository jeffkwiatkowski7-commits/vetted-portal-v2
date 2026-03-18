import { create } from 'zustand';
import type { User, Chat, Toast, Notification } from '../types';

interface AppState {
  // Auth
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  // Chats
  chats: Chat[];
  setChats: (chats: Chat[]) => void;
  activeChat: Chat | null;
  setActiveChat: (chat: Chat | null) => void;
  sharedChats: Chat[];
  setSharedChats: (chats: Chat[]) => void;

  // Toasts
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;

  // Notifications
  notifications: Notification[];
  setNotifications: (n: Notification[]) => void;
  unreadCount: number;

  // Demo mode
  demoActive: boolean;
  demoPaused: boolean;
  demoStep: number;
  demoHighlight: string | null;
  demoInputText: string;
  demoShowModelPicker: boolean;
  demoAttachedFile: string | null;
  setDemoActive: (v: boolean) => void;
  setDemoPaused: (v: boolean) => void;
  setDemoStep: (v: number) => void;
  setDemoHighlight: (v: string | null) => void;
  setDemoInputText: (v: string) => void;
  setDemoShowModelPicker: (v: boolean) => void;
  setDemoAttachedFile: (v: string | null) => void;
  demoTriggerSend: boolean;
  setDemoTriggerSend: (v: boolean) => void;

  // Quick actions
  quickActionText: string;
  setQuickActionText: (v: string) => void;

  // Search
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Auth
  user: null,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  isAuthenticated: false,

  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  // Chats
  chats: [],
  setChats: (chats) => set({ chats }),
  activeChat: null,
  setActiveChat: (chat) => set({ activeChat: chat }),
  sharedChats: [],
  setSharedChats: (chats) => set({ sharedChats: chats }),

  // Toasts
  toasts: [],
  addToast: (toast) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...toast, id }] }));
    if (toast.type !== 'error') {
      setTimeout(() => get().removeToast(id), toast.type === 'warning' ? 6000 : 4000);
    }
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // Notifications
  notifications: [],
  setNotifications: (n) => set({ notifications: n, unreadCount: n.filter((x) => !x.is_read).length }),
  unreadCount: 0,

  // Demo
  demoActive: false,
  demoPaused: false,
  demoStep: 0,
  demoHighlight: null,
  demoInputText: '',
  demoShowModelPicker: false,
  demoAttachedFile: null,
  setDemoActive: (v) => set({
    demoActive: v,
    demoStep: 0,
    demoPaused: false,
    demoHighlight: null,
    demoInputText: '',
    demoShowModelPicker: false,
    demoAttachedFile: null,
    demoTriggerSend: false,
  }),
  setDemoPaused: (v) => set({ demoPaused: v }),
  setDemoStep: (v) => set({ demoStep: v }),
  setDemoHighlight: (v) => set({ demoHighlight: v }),
  setDemoInputText: (v) => set({ demoInputText: v }),
  setDemoShowModelPicker: (v) => set({ demoShowModelPicker: v }),
  setDemoAttachedFile: (v) => set({ demoAttachedFile: v }),
  demoTriggerSend: false,
  setDemoTriggerSend: (v) => set({ demoTriggerSend: v }),

  // Quick actions
  quickActionText: '',
  setQuickActionText: (v) => set({ quickActionText: v }),

  // Search
  searchOpen: false,
  setSearchOpen: (v) => set({ searchOpen: v }),
}));
