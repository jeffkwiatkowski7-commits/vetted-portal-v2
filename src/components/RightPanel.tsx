import React from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import FileTypeBadge from './chat/FileTypeBadge';

export default function RightPanel() {
  const location = useLocation();
  const { rightPanelOpen, toggleRightPanel, chatAttachedFiles, setChatAttachedFiles } = useStore();

  const isVisible =
    location.pathname === '/' ||
    location.pathname.startsWith('/chat/') ||
    location.pathname.startsWith('/projects/');

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
                    className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-vetted-surface group"
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
        </div>
      )}
    </div>
  );
}
