import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { useStore } from './store';
import * as api from './api';
import Sidebar from './components/sidebar/Sidebar';
import ChatView from './components/chat/ChatView';
import ChatInput from './components/chat/ChatInput';
import LoginPage from './components/auth/LoginPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import LibraryPage from './pages/LibraryPage';
import AppsPage from './pages/AppsPage';
import AdminPage from './pages/AdminPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminSystemPromptsPage from './pages/AdminSystemPromptsPage';
import AdminModelsPage from './pages/AdminModelsPage';
import AdminMcpPage from './pages/AdminMcpPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import LeaseChatPage from './pages/LeaseChatPage';
import ToastContainer from './components/notifications/ToastContainer';
import GlobalSearch from './components/search/GlobalSearch';
import DemoMode from './components/demo/DemoMode';
import { BookOpen, Code2, BarChart2, PenLine, FolderSearch } from 'lucide-react';

const QUICK_ACTIONS = [
  { label: 'Research', icon: BookOpen, prompt: 'Help me research ' },
  { label: 'Code', icon: Code2, prompt: 'Write code to ' },
  { label: 'Analyze', icon: BarChart2, prompt: 'Analyze ' },
  { label: 'Write', icon: PenLine, prompt: 'Write a ' },
  { label: 'Projects', icon: FolderSearch, prompt: 'Summarize the key information across my projects' },
];

function RedirectToLogin() {
  const location = useLocation();
  return <Navigate to="/login" state={{ from: location.pathname }} replace />;
}

function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const { activeChat, user, setQuickActionText } = useStore();
  const hasMessages = (activeChat?.messages?.length ?? 0) > 0;

  const firstName = user?.display_name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there';

  if (id || hasMessages) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeChat?.title && !activeChat?.project_id && (
          <div className="border-b border-vetted-border px-6 py-3 shrink-0">
            <h2 className="text-sm font-medium text-vetted-text-secondary truncate">{activeChat.title}</h2>
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <ChatView />
        </div>
        <ChatInput />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
      <h2 className="text-3xl font-playfair text-vetted-primary mb-8">
        Good to see you, {firstName}!
      </h2>
      <div className="w-full max-w-3xl">
        <ChatInput centered />
      </div>
      <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
        {QUICK_ACTIONS.map(({ label, icon: Icon, prompt }) => (
          <button
            key={label}
            onClick={() => setQuickActionText(prompt)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-vetted-border text-sm text-vetted-text-secondary hover:border-vetted-accent hover:text-vetted-primary transition-colors bg-white"
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function App() {
  const {
    user,
    setUser,
    isAuthenticated,
    activeChat,
    setActiveChat,
    chats,
    setChats,
    sharedChats,
    setSharedChats,
    demoActive,
  } = useStore();
  const [authChecking, setAuthChecking] = React.useState(!!localStorage.getItem('userId'));

  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    if (storedUserId) {
      api.auth.me()
        .then(setUser)
        .catch(() => {
          localStorage.removeItem('userId');
          setUser(null);
        })
        .finally(() => setAuthChecking(false));
    }
  }, [setUser]);

  useEffect(() => {
    if (isAuthenticated) {
      api.chats.list().then(setChats).catch(() => setChats([]));
      api.chats.sharedWithMe().then(setSharedChats).catch(() => setSharedChats([]));
    }
  }, [isAuthenticated, setChats, setSharedChats]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        useStore.setState({ searchOpen: true });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (authChecking) {
    return <div className="min-h-screen bg-white" />;
  }

  if (!isAuthenticated) {
    return (
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<RedirectToLogin />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="flex h-screen bg-white overflow-hidden">
        {demoActive && <DemoMode />}

<Sidebar />

        <main className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/chat/:id" element={<ChatPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/system-prompts" element={<AdminSystemPromptsPage />} />
            <Route path="/admin/models" element={<AdminModelsPage />} />
            <Route path="/admin/tool-sets" element={<AdminMcpPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/leases" element={<LeaseChatPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>

        <GlobalSearch />
        <ToastContainer />
      </div>
    </BrowserRouter>
  );
}

export default App;
