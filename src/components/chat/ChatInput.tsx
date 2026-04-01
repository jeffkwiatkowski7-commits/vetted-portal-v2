import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import * as api from '../../api';
import { Send, Paperclip, Share2, ChevronDown, Plus } from 'lucide-react';
import { LibraryFile } from '../../types';
import LibraryPickerModal from './LibraryPickerModal';
import FileTypeBadge from './FileTypeBadge';


interface ModelOption {
  name: string;
  value: string;
  modelId: string;
  provider: string;
  iconColor: string;
  isDefault: boolean;
}

function ModelIcon({ color, isGemini, isClaude }: { color: string; isGemini?: boolean; isClaude?: boolean }) {
  if (isClaude) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M12 2l2.09 6.26L20.18 9.27l-5.09 3.9L16.18 19.27 12 15.77l-4.18 3.5 1.09-6.1L3.82 9.27l6.09-1.01z" fill={color} />
      </svg>
    );
  }
  if (isGemini) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 0.5 C7 4.5 9.5 7 13.5 7 C9.5 7 7 9.5 7 13.5 C7 9.5 4.5 7 0.5 7 C4.5 7 7 4.5 7 0.5Z" fill={color}/>
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none"/>
      <circle cx="7" cy="7" r="2" fill={color} opacity="0.6"/>
    </svg>
  );
}

export default function ChatInput({ centered = false, projectId, mcpServerIds = [], onMcpServersChange, isProjectChat = false }: {
  centered?: boolean;
  projectId?: string;
  mcpServerIds?: string[];
  onMcpServersChange?: (ids: string[]) => void;
  isProjectChat?: boolean;
}) {
  const { id: urlId } = useParams<{ id: string }>();
  // When on a project page, the URL :id is the project ID — don't use it as a chat ID
  const id = projectId ? undefined : urlId;
  const navigate = useNavigate();
  const {
    activeChat, setActiveChat, setChats, addToast,
    demoActive, demoHighlight, demoInputText, demoShowModelPicker, demoAttachedFile,
    demoTriggerSend, setDemoTriggerSend,
    quickActionText, setQuickActionText,
    setAiThinking, addLiveStep, clearLiveSteps,
    chatAttachedFiles, setChatAttachedFiles, setProjectFiles, setRightPanelOpen,
  } = useStore();
  const [message, setMessage] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelOption | null>(null);

  useEffect(() => {
    api.models.list().then((models: any[]) => {
      const mapped: ModelOption[] = models.map((m) => ({
        name: m.display_name,
        value: m.provider?.toLowerCase().includes('anthropic') ? 'claude' : 'gemini',
        modelId: m.model_name,
        provider: m.provider,
        iconColor: m.icon_color || '#888',
        isDefault: !!m.is_default,
      }));
      setAvailableModels(mapped);
      const match = mapped.find((m) => m.isDefault)
        ?? mapped[0]
        ?? null;
      setSelectedModel(match);
    }).catch(() => {});
  }, []);
  const [temperature, setTemperature] = useState(0.7);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [pastedImages, setPastedImages] = useState<Array<{ base64: string; mimeType: string }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paperclipButtonRef = useRef<HTMLButtonElement>(null);

  // MCP Tools state
  const [mcpServers, setMcpServers] = useState<{ id: string; name: string; description: string; icon: string }[]>([]);
  const [showMcpPicker, setShowMcpPicker] = useState(false);
  const mcpButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api.mcpServers.list().then(setMcpServers).catch(() => {});
  }, []);

  const activeMcpCount = mcpServerIds.length;

  // Close MCP picker on outside click
  useEffect(() => {
    if (!showMcpPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const popover = document.getElementById('mcp-picker-popover');
      if (mcpButtonRef.current && !mcpButtonRef.current.contains(target) && popover && !popover.contains(target)) {
        setShowMcpPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMcpPicker]);

  // Focus textarea on mount and whenever the route changes
  useEffect(() => {
    textareaRef.current?.focus();
  }, [id, projectId]);

  // Consume quick action text
  useEffect(() => {
    if (quickActionText) {
      setMessage(quickActionText);
      setQuickActionText('');
      textareaRef.current?.focus();
    }
  }, [quickActionText, setQuickActionText]);

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

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith('image/')) continue;

      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) continue;

      // Reject images > 5MB
      if (blob.size > 5 * 1024 * 1024) {
        addToast({ type: 'error', title: 'Image too large', detail: 'Maximum image size is 5MB' });
        continue;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const [header, base64] = dataUrl.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
        setPastedImages((prev) => [...prev, { base64, mimeType }]);
      };
      reader.readAsDataURL(blob);
    }
  };

  const handleSendMessage = async (overrides?: { msg?: string; files?: LibraryFile[]; hidden?: boolean }) => {
    let content = overrides?.msg ?? message;
    const files = overrides?.files ?? chatAttachedFiles;
    const hidden = overrides?.hidden ?? false;

    // Auto-inject summary prompt when files attached with no text
    if (!content.trim() && files.length > 0) {
      const names = files.map(f => f.original_name).join(', ');
      content = `Please summarize the following document${files.length > 1 ? 's' : ''}: ${names}`;
    }

    // Allow sending images with no text
    if (!content.trim() && pastedImages.length === 0) return;
    if (!content.trim() && pastedImages.length > 0) {
      content = "What's in this image?";
    }

    setLoading(true);
    try {
      let chatId = id || activeChat?.id;

      if (!chatId) {
        const newChat = await api.chats.create({
          title: content.slice(0, 50),
          model: selectedModel?.value || 'gemini',
          temperature,
          ...(projectId && { project_id: projectId }),
        });
        chatId = newChat.id;
        if (projectId) {
          navigate(`/projects/${projectId}`);
        } else {
          navigate(`/chat/${chatId}`);
        }
      }

      // Optimistically show the user's message immediately (skip for hidden sends)
      if (!hidden) setMessage('');
      if (!hidden) setPastedImages([]);
      if (!hidden) {
        setActiveChat({
          ...(activeChat || { id: chatId, title: content.slice(0, 50), messages: [] }),
          id: chatId,
          messages: [
            ...(activeChat?.messages || []),
            { id: `optimistic-${Date.now()}`, role: 'user', content, created_at: new Date().toISOString(), images: pastedImages.length > 0 ? pastedImages : null },
          ],
        } as any);
      }

      if (!hidden) { clearLiveSteps(); setAiThinking(true); }
      const modelValue = selectedModel?.value || 'gemini';
      const sendResult = await api.chats.streamMessage(
        chatId!,
        { content, model: modelValue, modelId: selectedModel?.modelId, temperature, attachments: files.map((f) => f.id), images: pastedImages.length > 0 ? pastedImages : undefined },
        hidden ? () => {} : (step) => addLiveStep(step),
      );
      if (!hidden) { setAiThinking(false); clearLiveSteps(); }

      if (chatId) {
        const updated = await api.chats.get(chatId);
        // Merge steps from send response into the assistant message
        if (sendResult?.messages) {
          const stepsById: Record<string, string[]> = {};
          for (const m of sendResult.messages) {
            if (m.steps?.length) stepsById[m.id] = m.steps;
          }
          if (Object.keys(stepsById).length > 0 && updated.messages) {
            updated.messages = updated.messages.map((m: any) =>
              stepsById[m.id] ? { ...m, steps: stepsById[m.id] } : m
            );
          }
        }
        setActiveChat(updated);
        // Refresh sidebar chat list so new project chats appear
        api.chats.list().then(setChats).catch(() => {});
      }

      if (!hidden) addToast({ type: 'success', title: 'Message sent' });
    } catch (err) {
      if (!hidden) { setAiThinking(false); clearLiveSteps(); }
      if (!hidden) addToast({
        type: 'error',
        title: 'Failed to send message',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
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
        projectId={projectId}
        onUploadComplete={projectId ? async () => {
          const updated = await api.library.list(projectId);
          setProjectFiles(updated);
          if (updated.length > 0) setRightPanelOpen(true);
        } : undefined}
        onAttach={async (files) => {
          if (projectId) {
            try {
              // Assign any existing library files not yet in this project
              const unassigned = files.filter((f) => f.project_id !== projectId);
              await Promise.all(unassigned.map((f) => api.library.assignProject(f.id, projectId)));
              // Refresh project files in the panel
              const updated = await api.library.list(projectId);
              setProjectFiles(updated);
              if (updated.length > 0) setRightPanelOpen(true);
            } catch (err) {
              addToast({ type: 'error', title: 'Failed to assign files to project', detail: err instanceof Error ? err.message : 'Unknown error' });
              return;
            }
          } else {
            // Merge with existing attached files (avoid duplicates)
            setChatAttachedFiles([
              ...chatAttachedFiles,
              ...files.filter((f) => !chatAttachedFiles.some((cf) => cf.id === f.id)),
            ]);
          }
          const count = files.length;
          const prompt = count === 1
            ? 'A file has been attached. Please briefly acknowledge it and let the user know you are ready to help with questions about it.'
            : `${count} files have been attached. Please briefly acknowledge them and let the user know you are ready to help with questions about them.`;
          handleSendMessage({ msg: prompt, files, hidden: true });
        }}
        returnFocusRef={paperclipButtonRef}
      />

      <div className={`bg-white px-4 py-4 ${centered ? '' : 'border-t border-vetted-border'}`}>
        <div className="max-w-3xl mx-auto">

          {/* Demo attached file chip */}
          {demoActive && demoAttachedFile && (
            <div className="flex flex-wrap gap-1.5 pb-2">
              <div className="flex items-center gap-1.5 rounded-lg px-2 py-1 border border-vetted-accent bg-vetted-surface">
                <FileTypeBadge fileType="pdf" size={16} />
                <span className="text-xs text-vetted-text-primary">{demoAttachedFile}</span>
              </div>
            </div>
          )}

          {/* Main input container */}
          <div className="relative border border-vetted-border rounded-2xl bg-white focus-within:border-vetted-accent focus-within:ring-2 focus-within:ring-vetted-accent/20 outline-none">
            {/* Pasted image previews */}
            {pastedImages.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-2.5">
                {pastedImages.map((img, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={`data:${img.mimeType};base64,${img.base64}`}
                      alt={`Pasted image ${idx + 1}`}
                      className="w-12 h-12 object-cover rounded-lg border border-vetted-border"
                    />
                    <button
                      onClick={() => setPastedImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-vetted-primary text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove image"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              spellCheck={true}
              autoComplete="on"
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
                {/* MCP Tools button */}
                <div className="relative">
                  <button
                    ref={mcpButtonRef}
                    onClick={() => setShowMcpPicker(!showMcpPicker)}
                    className={`p-2 rounded-lg transition-colors relative ${
                      showMcpPicker
                        ? 'text-vetted-accent bg-vetted-accent/10'
                        : 'text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface'
                    }`}
                    title="AI Tools"
                  >
                    <Plus size={18} />
                    {activeMcpCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-vetted-accent rounded-full border-2 border-white" />
                    )}
                  </button>
                  {showMcpPicker && (
                    <div id="mcp-picker-popover" className="absolute bottom-full left-0 mb-2 w-80 bg-white border border-vetted-border rounded-xl shadow-lg z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-vetted-border">
                        <p className="text-sm font-medium text-vetted-primary">AI Tools</p>
                        {isProjectChat && (
                          <p className="text-xs text-vetted-text-muted mt-0.5">Configured in project settings</p>
                        )}
                      </div>
                      <div className="max-h-64 overflow-y-auto divide-y divide-vetted-border">
                        {mcpServers.map((server) => {
                          const active = mcpServerIds.includes(server.id);
                          return (
                            <div key={server.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-vetted-surface/50">
                              <div className="flex-1 min-w-0 mr-3">
                                <p className="text-sm font-medium text-vetted-primary">{server.name}</p>
                                <p className="text-xs text-vetted-text-muted truncate">{server.description}</p>
                              </div>
                              {isProjectChat ? (
                                <span className={`text-xs px-1.5 py-0.5 rounded ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {active ? 'On' : 'Off'}
                                </span>
                              ) : (
                                <div
                                  onClick={() => {
                                    const newIds = active
                                      ? mcpServerIds.filter(id => id !== server.id)
                                      : [...mcpServerIds, server.id];
                                    onMcpServersChange?.(newIds);
                                  }}
                                  className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors flex-shrink-0 ${active ? 'bg-vetted-accent' : 'bg-vetted-border'}`}
                                >
                                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                {activeChat && (
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/chat/${activeChat.id}`;
                      navigator.clipboard.writeText(url);
                      addToast({
                        type: 'success',
                        title: 'Chat link copied',
                        detail: url,
                      });
                    }}
                    className="p-2 text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface rounded-lg transition-colors"
                    title="Copy chat link"
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
                    {selectedModel && <ModelIcon color={selectedModel.iconColor} isGemini={selectedModel.value === 'gemini'} isClaude={selectedModel.value === 'claude'} />}
                    {selectedModel?.name || 'Select model'}
                    <ChevronDown size={12} />
                  </button>
                  {showModelSelect && (
                    <div className="absolute bottom-full right-0 mb-2 bg-white border border-vetted-border rounded-xl shadow-lg z-10 min-w-[180px] overflow-hidden">
                      <div className="px-3 py-2 border-b border-vetted-border">
                        <p className="text-[11px] font-medium text-vetted-text-muted uppercase tracking-wider">Model</p>
                      </div>
                      {availableModels.map((model) => (
                        <button
                          key={model.name}
                          onClick={() => {
                            setSelectedModel(model);
                            setShowModelSelect(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 text-sm hover:bg-vetted-surface flex items-center gap-2.5 transition-colors ${
                            selectedModel?.modelId === model.modelId ? 'bg-vetted-surface font-medium' : ''
                          }`}
                        >
                          <ModelIcon color={model.iconColor} isGemini={model.value === 'gemini'} isClaude={model.value === 'claude'} />
                          {model.name}
                          {selectedModel?.modelId === model.modelId && (
                            <span className="ml-auto text-vetted-accent text-xs">&#10003;</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleSendMessage}
                  disabled={loading || (!message.trim() && pastedImages.length === 0 && !demoActive)}
                  className={`p-2 rounded-full transition-all ${
                    demoActive && demoHighlight === 'send-button'
                      ? 'bg-vetted-accent text-vetted-primary ring-2 ring-vetted-accent/40'
                      : (message.trim() || pastedImages.length > 0) && !loading
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
