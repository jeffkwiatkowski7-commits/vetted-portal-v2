import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import * as api from '../../api';
import {
  Send,
  Paperclip,
  Share2,
  ChevronDown,
  X,
} from 'lucide-react';
import { LibraryFile } from '../../types';
import LibraryPickerModal from './LibraryPickerModal';
import FileTypeBadge from './FileTypeBadge';

function ClaudeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.93 2.93l1.41 1.41M9.66 9.66l1.41 1.41M2.93 11.07l1.41-1.41M9.66 4.34l1.41-1.41" stroke="#E8774A" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="7" cy="7" r="2" fill="#E8774A"/>
    </svg>
  );
}

function GeminiIcon({ flash = false }: { flash?: boolean }) {
  const color = flash ? '#60A5FA' : '#3B82F6';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1L9.5 6.5L7 13L4.5 6.5Z" fill={color} opacity="0.9"/>
      <path d="M1 7L6.5 4.5L13 7L6.5 9.5Z" fill={color} opacity="0.6"/>
    </svg>
  );
}

const MODELS = [
  { name: 'Sonnet 4.6', icon: <ClaudeIcon /> },
  { name: 'Opus 4.6', icon: <ClaudeIcon /> },
  { name: 'Gemini 3', icon: <GeminiIcon /> },
  { name: 'Gemini Flash 3', icon: <GeminiIcon flash /> },
];

export default function ChatInput({ centered = false, projectId }: { centered?: boolean; projectId?: string }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    activeChat, setActiveChat, addToast,
    demoActive, demoHighlight, demoInputText, demoShowModelPicker, demoAttachedFile,
    demoTriggerSend, setDemoTriggerSend,
  } = useStore();
  const [message, setMessage] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<LibraryFile[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [temperature, setTemperature] = useState(0.7);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paperclipButtonRef = useRef<HTMLButtonElement>(null);

  // Sync demo state into local state
  useEffect(() => {
    if (demoActive) setMessage(demoInputText);
  }, [demoActive, demoInputText]);

  useEffect(() => {
    if (demoActive) setShowModelSelect(demoShowModelPicker);
  }, [demoActive, demoShowModelPicker]);

  useEffect(() => {
    if (demoActive && demoTriggerSend) {
      setDemoTriggerSend(false);
      handleSendMessage();
    }
  }, [demoActive, demoTriggerSend]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 240) + 'px';
    }
  }, [message]);

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    setLoading(true);
    try {
      let chatId = id || activeChat?.id;

      if (!chatId) {
        const newChat = await api.chats.create({
          title: message.slice(0, 50),
          model: selectedModel.name,
          temperature,
          ...(projectId && { project_id: projectId }),
        });
        chatId = newChat.id;
        navigate(`/chat/${chatId}`);
      }

      await api.chats.sendMessage(chatId, {
        content: message,
        model: selectedModel.name,
        temperature,
        attachments: attachedFiles.map((f) => f.id),
      });

      setMessage('');
      setAttachedFiles([]);

      if (chatId) {
        const updated = await api.chats.get(chatId);
        setActiveChat(updated);
      }

      addToast({ type: 'success', title: 'Message sent' });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to send message',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <>
      <LibraryPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onAttach={(files) => setAttachedFiles(files)}
        returnFocusRef={paperclipButtonRef}
      />

      <div className={`bg-white px-4 py-4 ${centered ? '' : 'border-t border-vetted-border'}`}>
        <div className="max-w-3xl mx-auto">

          {/* File chips */}
          {(attachedFiles.length > 0 || (demoActive && demoAttachedFile)) && (
            <div className="flex flex-wrap gap-1.5 pb-2">
              {demoActive && demoAttachedFile && (
                <div className="flex items-center gap-1.5 rounded-lg px-2 py-1 border border-vetted-accent bg-vetted-surface">
                  <FileTypeBadge fileType="pdf" size={16} />
                  <span className="text-xs text-vetted-text-primary">{demoAttachedFile}</span>
                </div>
              )}
              {attachedFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 border border-vetted-border bg-vetted-surface"
                >
                  <FileTypeBadge fileType={f.file_type} size={16} />
                  <span
                    className="text-xs text-vetted-text-primary"
                    style={{
                      maxWidth: 150,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.original_name}
                  </span>
                  <button
                    onClick={() => setAttachedFiles((prev) => prev.filter((x) => x.id !== f.id))}
                    className="ml-0.5 text-vetted-text-muted hover:text-vetted-text-secondary transition-colors"
                    aria-label={`Remove ${f.original_name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Main input container */}
          <div className={`relative border rounded-2xl bg-white focus-within:border-vetted-accent focus-within:ring-[3px] focus-within:ring-vetted-accent/20 transition-all ${
            demoActive && (demoHighlight === 'chat-input' || demoHighlight === 'send-button')
              ? 'border-vetted-accent ring-[3px] ring-vetted-accent/20'
              : 'border-vetted-border'
          }`}>
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              className="w-full px-3 pt-2.5 pb-10 text-sm leading-relaxed resize-none bg-transparent outline-none placeholder:text-vetted-text-muted min-h-[56px] max-h-[160px]"
              rows={1}
            />

            {/* Bottom toolbar row */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 pb-3">
              {/* Left side */}
              <div className="flex items-center gap-1">
                <button
                  ref={paperclipButtonRef}
                  onClick={() => setIsPickerOpen(true)}
                  className={`p-2 rounded-lg transition-colors ${
                    demoActive && demoHighlight === 'paperclip'
                      ? 'text-vetted-accent ring-2 ring-vetted-accent/40'
                      : 'text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface'
                  }`}
                  title="Attach files from Library"
                >
                  <Paperclip size={18} />
                </button>
                {activeChat && (
                  <button
                    onClick={() => {
                      addToast({
                        type: 'success',
                        title: 'Chat link copied',
                        detail: 'Share this chat with others',
                      });
                    }}
                    className="p-2 text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface rounded-lg transition-colors"
                    title="Share chat"
                  >
                    <Share2 size={18} />
                  </button>
                )}
              </div>

              {/* Right side: model selector + send */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setShowModelSelect(!showModelSelect)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-colors text-xs font-medium ${
                      demoActive && demoHighlight === 'model-picker'
                        ? 'border-vetted-accent text-vetted-accent ring-2 ring-vetted-accent/20'
                        : 'border-vetted-border text-vetted-text-secondary hover:bg-vetted-surface'
                    }`}
                  >
                    {selectedModel.icon}
                    {selectedModel.name}
                    <ChevronDown size={12} />
                  </button>
                  {showModelSelect && (
                    <div className="absolute bottom-full right-0 mb-2 bg-white border border-vetted-border rounded-xl shadow-lg z-10 min-w-[180px] overflow-hidden">
                      <div className="px-3 py-2 border-b border-vetted-border">
                        <p className="text-[11px] font-medium text-vetted-text-muted uppercase tracking-wider">Model</p>
                      </div>
                      {MODELS.map((model) => (
                        <button
                          key={model.name}
                          onClick={() => {
                            setSelectedModel(model);
                            setShowModelSelect(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 text-sm hover:bg-vetted-surface flex items-center gap-2.5 transition-colors ${
                            selectedModel.name === model.name ? 'bg-vetted-surface font-medium' : ''
                          }`}
                        >
                          {model.icon}
                          {model.name}
                          {selectedModel.name === model.name && (
                            <span className="ml-auto text-vetted-accent text-xs">&#10003;</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleSendMessage}
                  disabled={loading || (!message.trim() && !demoActive)}
                  className={`p-2 rounded-full transition-all ${
                    demoActive && demoHighlight === 'send-button'
                      ? 'bg-vetted-accent text-vetted-primary ring-2 ring-vetted-accent/40'
                      : message.trim() && !loading
                        ? 'bg-vetted-primary text-white hover:bg-gray-800'
                        : 'bg-vetted-border text-vetted-text-muted cursor-not-allowed'
                  }`}
                  title="Send (Enter)"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-vetted-text-muted text-center mt-2">
            Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </>
  );
}
