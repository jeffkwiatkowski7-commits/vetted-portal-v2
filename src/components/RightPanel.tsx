import React, { useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { ChevronLeft, ChevronRight, X, Upload } from 'lucide-react';
import FileTypeBadge from './chat/FileTypeBadge';
import { projectFiles as projectFilesApi } from '../api';
import * as api from '../api';

export default function RightPanel() {
  const location = useLocation();
  const {
    rightPanelOpen, toggleRightPanel,
    chatAttachedFiles, setChatAttachedFiles,
    projectFiles, setProjectFiles,
  } = useStore();

  const [uploadSteps, setUploadSteps] = useState<{message: string; ts: string}[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isVisible =
    location.pathname === '/' ||
    location.pathname.startsWith('/chat/') ||
    location.pathname.startsWith('/projects/');

  const isProjectRoute = location.pathname.startsWith('/projects/');
  const projectId = isProjectRoute ? location.pathname.split('/projects/')[1]?.split('/')[0] : null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;

    setIsUploading(true);
    setUploadSteps([]);

    try {
      await projectFilesApi.upload(projectId, file, (step) => {
        setUploadSteps(prev => [...prev, step]);
      });
      const files = await api.library.list(projectId);
      setProjectFiles(files);
    } catch (err: any) {
      console.error('Upload failed:', err);
    } finally {
      setIsUploading(false);
      setUploadSteps([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isVisible) return null;

  return (
    <div className="flex shrink-0">
      {/* Toggle tab */}
      <button
        onClick={toggleRightPanel}
        className="w-5 flex items-center justify-center border-l border-vetted-border bg-vetted-surface hover:bg-gray-100 transition-colors text-vetted-text-muted"
        title={rightPanelOpen ? 'Collapse panel' : 'Expand panel'}
      >
        {rightPanelOpen ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
      </button>

      {rightPanelOpen && (
        <div className="w-56 border-l border-vetted-border flex flex-col bg-white">
          {isProjectRoute ? (
            <>
              <div className="px-3 py-2.5 border-b border-vetted-border flex items-center justify-between">
                <span className="text-[11px] font-semibold text-vetted-text-muted uppercase tracking-wider">
                  Project Files
                  {projectFiles.length > 0 && (
                    <span className="ml-1.5 text-vetted-accent">{projectFiles.length}</span>
                  )}
                </span>
                <label className="cursor-pointer p-1 hover:bg-vetted-surface rounded transition-colors" title="Upload file">
                  <Upload size={13} className="text-vetted-accent" />
                  <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.txt,.md" onChange={handleFileUpload} disabled={isUploading} />
                </label>
              </div>

              {isUploading && uploadSteps.length > 0 && (
                <div className="px-3 py-2 border-b border-vetted-border space-y-1">
                  {uploadSteps.map((s, i) => (
                    <div key={i} className="text-[10px] text-vetted-text-muted">
                      <span className={i === uploadSteps.length - 1 ? 'text-vetted-accent' : ''}>{s.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {projectFiles.length === 0 ? (
                  <div className="flex items-center justify-center h-24 px-4 text-center">
                    <p className="text-[11px] text-vetted-text-muted">No files in this project</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-0.5">
                    {projectFiles.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-vetted-surface"
                      >
                        <FileTypeBadge fileType={f.file_type} size={16} />
                        <span className="text-[12px] text-vetted-primary flex-1 truncate leading-tight">
                          {f.original_name}
                        </span>
                        {f.index_status === 'ready' && <span className="text-green-500 text-[10px]">✓</span>}
                        {f.index_status === 'indexing' && <span className="text-vetted-accent text-[10px] animate-pulse">…</span>}
                        {f.index_status === 'error' && <span className="text-red-400 text-[10px]">!</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="px-3 py-2.5 border-b border-vetted-border">
                <span className="text-[11px] font-semibold text-vetted-text-muted uppercase tracking-wider">
                  Attached Files
                  {chatAttachedFiles.length > 0 && (
                    <span className="ml-1.5 text-vetted-accent">{chatAttachedFiles.length}</span>
                  )}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {chatAttachedFiles.length === 0 ? (
                  <div className="flex items-center justify-center h-24 px-4 text-center">
                    <p className="text-[11px] text-vetted-text-muted">No files attached</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-0.5">
                    {chatAttachedFiles.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-vetted-surface"
                      >
                        <FileTypeBadge fileType={f.file_type} size={16} />
                        <span className="text-[12px] text-vetted-primary flex-1 truncate leading-tight">
                          {f.original_name}
                        </span>
                        <button
                          onClick={() =>
                            setChatAttachedFiles(chatAttachedFiles.filter((cf) => cf.id !== f.id))
                          }
                          className="p-0.5 text-vetted-text-muted hover:text-vetted-danger transition-colors shrink-0"
                          title="Remove"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
