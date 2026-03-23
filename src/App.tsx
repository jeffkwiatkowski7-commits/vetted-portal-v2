import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store';
import * as api from './api';
import Sidebar from './components/sidebar/Sidebar';
import LoginPage from './components/auth/LoginPage';
import MainChatPage from './pages/MainChatPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import LibraryPage from './pages/LibraryPage';
import AppsPage from './pages/AppsPage';
import AdminPage from './pages/AdminPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminSystemPromptsPage from './pages/AdminSystemPromptsPage';
import AdminModelsPage from './pages/AdminModelsPage';
import AdminMcpPage from './pages/AdminMcpPage';
import AdminUsagePage from './pages/AdminUsagePage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import LeaseChatPage from './pages/LeaseChatPage';
import ToastContainer from './components/notifications/ToastContainer';
import GlobalSearch from './components/search/GlobalSearch';
import DemoMode from './components/demo/DemoMode';
import RightPanel from './components/RightPanel';

function RedirectToLogin() {
  const location = useLocation();
  return <Navigate to="/login" state={{ from: location.pathname }} replace />;
}

function ConditionalRightPanel() {
  const location = useLocation();
  const isMainChat = location.pathname === '/' || location.pathname.startsWith('/chat/');
  if (isMainChat) return null;
  return <RightPanel />;
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

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <Routes>
            <Route path="/" element={<MainChatPage />} />
            <Route path="/chat/:id" element={<MainChatPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/system-prompts" element={<AdminSystemPromptsPage />} />
            <Route path="/admin/models" element={<AdminModelsPage />} />
            <Route path="/admin/tool-sets" element={<AdminMcpPage />} />
            <Route path="/admin/usage" element={<AdminUsagePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/leases" element={<LeaseChatPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>

        <ConditionalRightPanel />

        <GlobalSearch />
        <ToastContainer />
      </div>
    </BrowserRouter>
  );
}

export default App;
