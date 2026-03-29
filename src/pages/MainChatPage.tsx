import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Send, Loader2, Paperclip, X, ChevronDown, ChevronUp, Check, Download, Plus } from 'lucide-react';
import LibraryPickerModal from '../components/chat/LibraryPickerModal';
import ExportModal from '../components/chat/ExportModal';
import { LibraryFile } from '../types';

// ── Model icon (matches ChatInput) ───────────────────────────────────────────
interface ModelOption {
  name: string;
  value: string;
  modelId: string;
  provider: string;
  iconColor: string;
  isDefault: boolean;
}

function ModelIcon({ color, isGemini }: { color: string; isGemini?: boolean }) {
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

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useStore } from '../store';
import * as api from '../api';

// ── Normalize markdown tables (copied from LeaseChatPage) ─────────────────────
function normalizeMarkdown(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableLine = /^\s*\|/.test(line);
    const isEmpty = line.trim() === '';

    if (isTableLine) {
      if (!inTable && result.length > 0) {
        const prev = result[result.length - 1];
        if (prev.trim() !== '' && !/^\s*\|/.test(prev)) result.push('');
      }
      inTable = true;
      result.push(line);
    } else if (isEmpty && inTable) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && /^\s*\|/.test(lines[j])) continue;
      else { inTable = false; result.push(line); }
    } else {
      inTable = false;
      result.push(line);
    }
  }

  return result.join('\n');
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface SourceCitation {
  filename: string;
  pageNumber: number | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: string[];
  attachedFileName?: string;
  citations?: SourceCitation[];
  timestamp?: string;
  reasoning?: string;
}

// ── ReasoningSummary ─────────────────────────────────────────────────────────
function ReasoningSummary({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  // Show first ~100 chars as summary
  const summary = reasoning.length > 120 ? reasoning.slice(0, 120).trim() + '…' : reasoning;
  return (
    <div className="mt-2 pt-2 border-t border-vetted-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] text-vetted-text-muted hover:text-vetted-primary transition-colors"
      >
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        Thinking
      </button>
      {open ? (
        <p className="mt-1 text-xs text-vetted-text-muted whitespace-pre-wrap leading-relaxed">{reasoning}</p>
      ) : (
        <p className="mt-0.5 text-[11px] text-vetted-text-muted/60 truncate">{summary}</p>
      )}
    </div>
  );
}

// ── ChatBubble (copied from LeaseChatPage) ────────────────────────────────────
function ChatBubble({ msg }: { msg: ChatMessage }) {
  const [stepsOpen, setStepsOpen] = useState(!msg.content);

  useEffect(() => {
    if (msg.content) setStepsOpen(false);
  }, [msg.content]);

  const formatTime = (ts?: string) => {
    if (!ts) return null;
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isToday) return time;
    if (isYesterday) return `Yesterday ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
  };

  if (msg.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <div className="max-w-[75%] bg-vetted-primary text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {msg.attachedFileName && (
            <div className="flex items-center gap-1 opacity-50 mb-1.5 text-[11px]">
              <Paperclip size={10} />
              <span className="truncate max-w-[200px]">{msg.attachedFileName}</span>
            </div>
          )}
          {msg.content}
        </div>
        {msg.timestamp && <span className="text-[10px] text-vetted-text-muted px-1">{formatTime(msg.timestamp)}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 w-full">
      {msg.steps && msg.steps.length > 0 && (
        <button
          onClick={() => setStepsOpen(!stepsOpen)}
          className="flex items-center gap-1 text-xs text-vetted-text-muted hover:text-vetted-primary transition-colors self-start"
        >
          {stepsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {msg.steps.length} steps
        </button>
      )}
      {stepsOpen && msg.steps && (
        <div className="bg-white border border-vetted-border rounded-xl px-3 py-2 text-xs text-vetted-text-muted space-y-0.5 font-mono">
          {msg.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <span>–</span>
              <span>{s}</span>
              {s.startsWith('Web search:') && (
                <span className="ml-1 text-[10px] bg-vetted-surface text-vetted-text-muted px-1.5 py-0.5 rounded">Tavily</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="bg-vetted-bg border border-vetted-border rounded-2xl rounded-tl-sm px-4 py-3 overflow-x-auto">
        {msg.content === '' ? (
          <div className="flex items-center gap-1 py-1">
            <span className="w-2 h-2 bg-vetted-text-muted rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-vetted-text-muted rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-vetted-text-muted rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        ) : (
          <div className="text-[15px] leading-relaxed text-vetted-text-primary">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                // Headings
                h1: ({ children }) => (
                  <h1 className="text-xl font-semibold text-vetted-primary mt-5 mb-2 first:mt-0">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-semibold text-vetted-primary mt-4 mb-2 first:mt-0">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-semibold text-vetted-primary mt-3 mb-1.5 first:mt-0">{children}</h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-sm font-semibold text-vetted-primary mt-3 mb-1 first:mt-0">{children}</h4>
                ),
                // Paragraphs
                p: ({ children }) => (
                  <p className="mb-3 last:mb-0">{children}</p>
                ),
                // Bold & italic
                strong: ({ children }) => (
                  <strong className="font-semibold text-vetted-primary">{children}</strong>
                ),
                em: ({ children }) => (
                  <em className="italic text-vetted-text-secondary">{children}</em>
                ),
                // Lists
                ul: ({ children }) => (
                  <ul className="mb-3 ml-1 space-y-1 list-none">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="mb-3 ml-1 space-y-1 list-none counter-reset-item">{children}</ol>
                ),
                li: ({ children, ordered, index }: any) => (
                  <li className="flex gap-2 text-[14px]">
                    <span className="text-vetted-accent mt-0.5 shrink-0 text-[13px]">
                      {ordered ? `${(index ?? 0) + 1}.` : '•'}
                    </span>
                    <span className="flex-1">{children}</span>
                  </li>
                ),
                // Blockquote
                blockquote: ({ children }) => (
                  <blockquote className="border-l-3 border-vetted-accent pl-4 py-1 my-3 bg-vetted-surface/50 rounded-r-lg text-vetted-text-secondary italic">
                    {children}
                  </blockquote>
                ),
                // Code
                code: ({ className, children }) => {
                  const isBlock = className?.includes('language-');
                  if (isBlock) {
                    return (
                      <div className="my-3 rounded-xl bg-[#1a1a1a] overflow-hidden">
                        {className && (
                          <div className="px-4 py-1.5 bg-[#2a2a2a] text-[10px] text-white/40 uppercase tracking-wider font-mono">
                            {className.replace('language-', '')}
                          </div>
                        )}
                        <pre className="px-4 py-3 overflow-x-auto text-[13px] leading-relaxed">
                          <code className="text-green-300 font-mono">{children}</code>
                        </pre>
                      </div>
                    );
                  }
                  return (
                    <code className="px-1.5 py-0.5 bg-vetted-surface rounded text-[13px] font-mono text-vetted-accent">
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                // Horizontal rule
                hr: () => <hr className="my-4 border-vetted-border" />,
                // Links
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-vetted-accent hover:underline">
                    {children}
                  </a>
                ),
                // Tables
                table: ({ children }) => (
                  <div className="my-3 overflow-x-auto rounded-xl border border-vetted-border">
                    <table className="w-full text-sm border-collapse">{children}</table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-vetted-surface border-b border-vetted-border">{children}</thead>
                ),
                tbody: ({ children }) => (
                  <tbody className="divide-y divide-vetted-border">{children}</tbody>
                ),
                tr: ({ children }) => (
                  <tr className="hover:bg-vetted-surface/60 transition-colors">{children}</tr>
                ),
                th: ({ children }) => (
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-vetted-text-secondary uppercase tracking-wide whitespace-nowrap">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-2.5 text-[14px] text-vetted-text-primary align-top">{children}</td>
                ),
              }}
            >
              {normalizeMarkdown(msg.content)}
            </ReactMarkdown>
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-2 pt-2 border-t border-vetted-border">
                <div className="text-xs text-vetted-text-muted mb-1">Sources:</div>
                <div className="flex flex-wrap gap-1">
                  {msg.citations.map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-vetted-surface rounded text-xs text-vetted-text-muted">
                      {c.filename}{c.pageNumber ? ` (p. ${c.pageNumber})` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {msg.reasoning && <ReasoningSummary reasoning={msg.reasoning} />}
          </div>
        )}
      {msg.timestamp && <span className="text-[10px] text-vetted-text-muted px-1">{formatTime(msg.timestamp)}</span>}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function MainChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, chats, setChats, pendingProjectId, setPendingProjectId } = useStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const [chatId, setChatId] = useState<string | null>(id ?? null);
  const [pendingFiles, setPendingFiles] = useState<LibraryFile[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelOption | null>(null);
  const [chatMcpServerIds, setChatMcpServerIds] = useState<string[]>([]);

  // Fetch models from admin config
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
      const savedModelId = localStorage.getItem('selectedModelId');
      const match = (savedModelId && mapped.find((m) => m.modelId === savedModelId))
        ?? mapped.find((m) => m.isDefault)
        ?? mapped[0]
        ?? null;
      setSelectedModel(match);
    }).catch(() => {});
  }, []);

  const [modelOpen, setModelOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<{ id: string; name: string; description: string }[]>([]);
  const [showMcpPicker, setShowMcpPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const mcpButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { api.mcpServers.list().then(setMcpServers).catch(() => {}); }, []);

  const handleMcpServersChange = async (ids: string[]) => {
    setChatMcpServerIds(ids);
    if (chatId) {
      try { await api.mcpServers.setChatServers(chatId, ids); } catch {}
    }
  };

  // Close model dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close MCP picker on outside click
  useEffect(() => {
    if (!showMcpPicker) return;
    const handler = (e: MouseEvent) => {
      if (mcpButtonRef.current && !mcpButtonRef.current.contains(e.target as Node)) {
        setShowMcpPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMcpPicker]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Track whether we're mid-send so navigation after chat creation doesn't clobber messages
  const sendingRef = useRef(false);

  // Load existing chat when navigating to /chat/:id
  useEffect(() => {
    if (!id) {
      setMessages([]);
      setChatId(null);
      setChatMcpServerIds([]);
      return;
    }
    // Skip re-fetch if we just created this chat via send
    if (sendingRef.current && chatId === id) return;
    setChatId(id);
    api.chats.get(id)
      .then((chat: any) => {
        setMessages(
          (chat.messages ?? []).map((m: any) => ({
            role: m.role,
            content: m.content,
            steps: [],
            timestamp: m.created_at,
          }))
        );
        try { setChatMcpServerIds(JSON.parse(chat.mcp_servers || '[]')); } catch { setChatMcpServerIds([]); }
      })
      .catch(() => {});
  }, [id]);

  const handleSend = async () => {
    let text = input.trim();
    if (chatting) return;

    // Capture attached file IDs before clearing
    const attachmentIds = pendingFiles.map(f => f.id);

    // Auto-inject summary prompt when files attached with no text
    if (!text && attachmentIds.length > 0) {
      const names = pendingFiles.map(f => f.original_name).join(', ');
      text = `Please summarize the following document${pendingFiles.length > 1 ? 's' : ''}: ${names}`;
    }

    if (!text) return;
    const attachedName = pendingFiles.length === 1
      ? pendingFiles[0].original_name
      : pendingFiles.length > 1
      ? `${pendingFiles.length} files`
      : undefined;

    // Show user message and clear inputs immediately
    setMessages(prev => [...prev, { role: 'user', content: text, attachedFileName: attachedName, timestamp: new Date().toISOString() }]);
    setInput('');
    setPendingFiles([]);
    setChatting(true);
    sendingRef.current = true;

    // Resolve or create chatId
    let activeChatId = chatId;
    if (!activeChatId) {
      try {
        const createData: any = { title: text.slice(0, 60), model: selectedModel?.value || 'gemini' };
        if (pendingProjectId) createData.project_id = pendingProjectId;
        const newChat = await api.chats.create(createData);
        activeChatId = newChat.id;
        setChatId(activeChatId);
        navigate(`/chat/${activeChatId}`, { replace: true });
        setChats([newChat, ...chats]);
        if (pendingProjectId) setPendingProjectId(null);
      } catch {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Error: could not create chat.' }]);
        setChatting(false);
        return;
      }
    }

    // Seed assistant placeholder with immediate step — user sees it right away
    setMessages(prev => [...prev, { role: 'assistant', content: '', steps: ['Sending request…'] }]);

    try {
      const result = await (api.chats as any).streamMessage(
        activeChatId!,
        { content: text, model: selectedModel?.value || 'gemini', modelId: selectedModel?.modelId, attachments: attachmentIds.length > 0 ? attachmentIds : undefined },
        (step: { message: string }) => {
          setMessages(prev => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };
            last.steps = [...(last.steps ?? []), step.message];
            updated[updated.length - 1] = last;
            return updated;
          });
        }
      );

      // Done event is minimal — fetch full messages from API
      const doneChatId = result.chatId || activeChatId;
      const chat = await api.chats.get(doneChatId);
      const lastMsg = (chat.messages ?? []).filter((m: any) => m.role === 'assistant').pop();
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: lastMsg?.content ?? '',
          citations: lastMsg?.citations ?? undefined,
          reasoning: lastMsg?.reasoning ?? undefined,
          timestamp: lastMsg?.created_at ?? new Date().toISOString(),
        };
        return updated;
      });

      // Refresh sidebar chat list so new chat appears
      api.chats.list().then(setChats).catch(() => {});
    } catch (err: any) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: `Error: ${err.message ?? 'Something went wrong'}`,
        };
        return updated;
      });
    } finally {
      setChatting(false);
      sendingRef.current = false;
    }
  };

  const handleLibraryAttach = (files: LibraryFile[]) => {
    setPendingFiles(files);
  };

  const firstName = user?.display_name?.split(' ')[0] ?? 'there';

  const inputCard = (
    <div className={`rounded-2xl border border-vetted-border bg-white p-3 shadow-sm ${chatting ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* File chips — shown when files are pending */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pendingFiles.map(f => (
            <div key={f.id} className="flex items-center gap-1.5 px-2 py-1 bg-vetted-surface border border-vetted-border rounded-lg text-xs text-vetted-text-muted w-fit">
              <Paperclip size={11} />
              <span className="max-w-[160px] truncate">{f.original_name}</span>
              <button onClick={() => setPendingFiles(prev => prev.filter(p => p.id !== f.id))} className="hover:text-vetted-primary transition-colors ml-0.5">
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Textarea */}
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder="Ask anything…"
        disabled={chatting}
        rows={3}
        className="w-full resize-none text-sm text-vetted-primary placeholder-vetted-text-muted focus:outline-none disabled:opacity-50 bg-transparent"
      />

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between pt-2 mt-1 border-t border-vetted-border">
        {/* Left: file attach + MCP tools */}
        <div className="flex items-center gap-1 relative">
          <button
            ref={attachButtonRef}
            onClick={() => setPickerOpen(true)}
            className="p-1.5 rounded-lg border border-vetted-border text-vetted-text-muted hover:text-vetted-primary transition-colors"
            title="Attach file"
          >
            <Paperclip size={16} />
          </button>
          <button
            ref={mcpButtonRef}
            onClick={() => setShowMcpPicker(!showMcpPicker)}
            className={`p-1.5 rounded-lg border border-vetted-border transition-colors relative ${
              showMcpPicker ? 'text-vetted-accent border-vetted-accent' : 'text-vetted-text-muted hover:text-vetted-primary'
            }`}
            title="AI Tools"
          >
            <Plus size={16} />
            {chatMcpServerIds.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-vetted-accent rounded-full border-2 border-white" />
            )}
          </button>
          {showMcpPicker && (
            <div className="absolute bottom-full left-0 mb-2 w-80 bg-white border border-vetted-border rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-vetted-border">
                <p className="text-sm font-medium text-vetted-primary">AI Tools</p>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-vetted-border">
                {mcpServers.map((server) => {
                  const active = chatMcpServerIds.includes(server.id);
                  return (
                    <div key={server.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-vetted-surface/50">
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-sm font-medium text-vetted-primary">{server.name}</p>
                        <p className="text-xs text-vetted-text-muted truncate">{server.description}</p>
                      </div>
                      <div
                        onClick={() => {
                          const newIds = active
                            ? chatMcpServerIds.filter(id => id !== server.id)
                            : [...chatMcpServerIds, server.id];
                          handleMcpServersChange(newIds);
                        }}
                        className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors flex-shrink-0 ${active ? 'bg-vetted-accent' : 'bg-vetted-border'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: model selector + send */}
        <div className="flex items-center gap-2">
          {/* Custom model selector */}
          <div className="relative" ref={modelDropdownRef}>
            <button
              onClick={() => setModelOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs border border-vetted-border rounded-lg px-2 py-1 text-vetted-text-secondary bg-white hover:border-vetted-primary transition-colors"
            >
              {selectedModel && <ModelIcon color={selectedModel.iconColor} isGemini={selectedModel.value === 'gemini'} />}
              {selectedModel?.name || 'Select model'}
              <ChevronDown size={11} className="opacity-50" />
            </button>
            {modelOpen && (
              <div className="absolute bottom-full mb-1.5 right-0 bg-white border border-vetted-border rounded-xl shadow-lg py-1 min-w-[160px] z-10">
                {availableModels.map((model) => (
                  <button
                    key={model.modelId}
                    onClick={() => { setSelectedModel(model); localStorage.setItem('selectedModelId', model.modelId); setModelOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-vetted-text-secondary hover:bg-vetted-surface transition-colors"
                  >
                    <ModelIcon color={model.iconColor} isGemini={model.value === 'gemini'} />
                    <span className="flex-1 text-left">{model.name}</span>
                    {selectedModel?.modelId === model.modelId && <Check size={11} className="text-vetted-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || chatting}
            className="p-1.5 rounded-lg bg-vetted-primary text-white disabled:opacity-40 hover:bg-opacity-80 transition-colors"
          >
            {chatting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>

    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <LibraryPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAttach={handleLibraryAttach}
        returnFocusRef={attachButtonRef as React.RefObject<HTMLButtonElement>}
      />
      {messages.length === 0 ? (
        /* State 1: empty — centered column */
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4 pb-16">
          <div className="text-center">
            <h2 className="text-3xl font-playfair text-vetted-primary mb-2">
              Good to see you, {firstName}!
            </h2>
            <p className="text-sm text-vetted-text-muted">Ask me anything, or attach a file to get started.</p>
          </div>
          <div className="w-full max-w-[700px]">
            {inputCard}
          </div>
        </div>
      ) : (
        /* State 2: active — messages + bottom-docked input */
        <>
          <ExportModal
            isOpen={exportOpen}
            onClose={() => setExportOpen(false)}
            messages={messages}
            chatTitle={chats.find(c => c.id === chatId)?.title || 'Chat Export'}
          />
          {/* Chat header bar */}
          <div className="flex items-center justify-between px-6 py-2 border-b border-vetted-border">
            <span className="text-sm font-medium text-vetted-primary">{firstName}</span>
            <button
              onClick={() => setExportOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-vetted-border bg-white text-xs text-vetted-text-secondary hover:text-vetted-primary hover:border-vetted-primary transition-colors"
              title="Export conversation"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-[75%] mx-auto px-6 py-8 space-y-6">
              {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
              <div ref={messagesEndRef} />
            </div>
          </div>
          <div className="px-4 pb-4 pt-2">
            <div className="max-w-[75%] mx-auto px-6">
              {inputCard}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
