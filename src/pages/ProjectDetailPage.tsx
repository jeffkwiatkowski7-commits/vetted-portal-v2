import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { projectFiles as projectFilesApi } from '../api';
import { ArrowLeft, Settings, Download } from 'lucide-react';
import type { Project } from '../types';
import ChatInput from '../components/chat/ChatInput';
import ChatView from '../components/chat/ChatView';
import ProjectSettings from '../components/projects/ProjectSettings';
import ExportModal from '../components/chat/ExportModal';


export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast, activeChat, setActiveChat, projectFiles, setProjectFiles, setRightPanelOpen } = useStore();
  const hasChat = (activeChat?.messages?.length ?? 0) > 0 || (activeChat?.project_id === id && activeChat?.id != null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [uploadSteps, setUploadSteps] = useState<{message: string; ts: string}[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectMcpIds, setProjectMcpIds] = useState<string[]>([]);

  useEffect(() => {
    if (id) {
      // If activeChat belongs to this project, load its full data (messages)
      // so clicking a project chat from sidebar history opens it properly
      if (activeChat && activeChat.project_id === id) {
        api.chats.get(activeChat.id).then(setActiveChat).catch(() => {});
      } else {
        setActiveChat(null);
      }
      setProjectFiles([]);
      loadProject();
    }
    return () => {
      setProjectFiles([]);
      setRightPanelOpen(false);
    };
  }, [id]);

  const loadProject = async () => {
    try {
      const [proj, files] = await Promise.all([
        api.projects.get(id!),
        api.library.list(id!),
      ]);
      setProject(proj);
      // Parse project MCP servers for chat input
      let mcpIds: string[] = [];
      try {
        const raw = proj.mcp_servers;
        mcpIds = Array.isArray(raw) ? raw : typeof raw === 'string' ? JSON.parse(raw) : [];
      } catch {}
      setProjectMcpIds(mcpIds);
      setProjectFiles(files);
      if (files.length > 0) setRightPanelOpen(true);
    } catch {
      addToast({ type: 'error', title: 'Failed to load project' });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProject = async (data: { name: string; description: string; system_prompt: string; tool_sets: string[]; mcp_servers: string[]; file_ids: string[]; pptx_template_id: string | null }) => {
    if (!project || !id) return;
    setSaving(true);
    try {
      await api.projects.update(id, {
        name: data.name,
        description: data.description,
        system_prompt: data.system_prompt,
        mcp_servers: data.mcp_servers || [],
        pptx_template_id: data.pptx_template_id,
      });

      // Sync file assignments
      const oldIds = new Set(projectFiles.map((f) => f.id));
      const newIds = new Set(data.file_ids);
      const toAdd = data.file_ids.filter((fid) => !oldIds.has(fid));
      const toRemove = projectFiles.filter((f) => !newIds.has(f.id)).map((f) => f.id);
      await Promise.all([
        ...toAdd.map((fid) => api.library.assignProject(fid, id)),
        ...toRemove.map((fid) => api.library.assignProject(fid, null)),
      ]);

      const updatedFiles = await api.library.list(id);
      setProjectFiles(updatedFiles);
      if (updatedFiles.length > 0) setRightPanelOpen(true);

      setProject({ ...project, name: data.name, description: data.description, system_prompt: data.system_prompt, mcp_servers: data.mcp_servers as any, pptx_template_id: data.pptx_template_id });
      setProjectMcpIds(data.mcp_servers || []);
      setShowSettings(false);
      addToast({ type: 'success', title: 'Project updated' });
    } catch {
      addToast({ type: 'error', title: 'Failed to update project' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!project || !id) return;
    if (!window.confirm('Delete this project?')) return;
    try {
      await api.projects.delete(id);
      navigate('/projects');
    } catch {
      addToast({ type: 'error', title: 'Failed to delete project' });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;

    setIsUploading(true);
    setUploadSteps([]);

    try {
      await projectFilesApi.upload(project.id, file, (step) => {
        setUploadSteps(prev => [...prev, step]);
      });
      // Reload files list
      const files = await api.library.list(project.id);
      setProjectFiles(files);
      if (files.length > 0) setRightPanelOpen(true);
    } catch (err: any) {
      console.error('Upload failed:', err);
      addToast({ type: 'error', title: 'Upload failed' });
    } finally {
      setIsUploading(false);
      setUploadSteps([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading || !project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary text-sm">Loading project...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ExportModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        messages={activeChat?.messages || []}
        chatTitle={activeChat?.title || project?.name || 'Project Export'}
      />
      {/* Slim project header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-vetted-border">
        <button
          onClick={() => navigate('/projects')}
          className="p-1 hover:bg-vetted-surface rounded transition-colors"
        >
          <ArrowLeft size={15} className="text-vetted-text-secondary" />
        </button>
        <span className="text-sm font-medium text-vetted-primary flex-1">{project.name}</span>
        {hasChat && activeChat?.messages && activeChat.messages.length > 0 && (
          <button
            onClick={() => setExportOpen(true)}
            className="p-1 hover:bg-vetted-surface rounded transition-colors"
            title="Export conversation"
          >
            <Download size={15} className="text-vetted-text-secondary" />
          </button>
        )}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1 hover:bg-vetted-surface rounded transition-colors"
          title="Project settings"
        >
          <Settings size={15} className="text-vetted-text-secondary" />
        </button>
      </div>

      {showSettings && project && (
        <ProjectSettings
          project={project}
          onUpdated={(p) => setProject(p)}
        />
      )}

      {!showSettings && (hasChat ? (
        <>
          <div className="flex-1 overflow-hidden">
            <ChatView chatId={activeChat?.id} />
          </div>
          <ChatInput projectId={id} mcpServerIds={projectMcpIds} onMcpServersChange={setProjectMcpIds} isProjectChat />
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-16">
          <h2 className="text-3xl font-playfair text-vetted-primary mb-8">{project.name}</h2>
          {project.description && (
            <p className="text-sm text-vetted-text-secondary mb-6 max-w-md text-center">{project.description}</p>
          )}
          <div className="w-full max-w-3xl">
            <ChatInput centered projectId={id} mcpServerIds={projectMcpIds} onMcpServersChange={setProjectMcpIds} isProjectChat />
          </div>
        </div>
      ))}
    </div>
  );
}
