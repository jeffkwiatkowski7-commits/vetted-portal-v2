import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Send, Loader2, Paperclip, X, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: string[];
  attachedFileName?: string;
}

// ── ChatBubble (copied from LeaseChatPage) ────────────────────────────────────
function ChatBubble({ msg }: { msg: ChatMessage }) {
  const [stepsOpen, setStepsOpen] = useState(!msg.content);

  useEffect(() => {
    if (msg.content) setStepsOpen(false);
  }, [msg.content]);

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-vetted-primary text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {msg.content}
        </div>
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
        <div className="bg-gray-50 border border-vetted-border rounded-lg px-3 py-2 text-xs text-vetted-text-muted space-y-0.5 font-mono">
          {msg.steps.map((s, i) => <div key={i}>{s}</div>)}
        </div>
      )}
      <div className="bg-vetted-bg border border-vetted-border rounded-2xl rounded-tl-sm px-4 py-3 overflow-x-auto">
        <div className="text-[15px]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
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
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function MainChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, chats, setChats } = useStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const [chatId, setChatId] = useState<string | null>(id ?? null);
  const [pendingFile, setPendingFile] = useState<{ name: string; content: string } | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gemini' | 'claude'>(() => {
    const saved = localStorage.getItem('selectedModel');
    return saved === 'claude' ? 'claude' : 'gemini';
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load existing chat when navigating to /chat/:id
  useEffect(() => {
    if (!id) {
      setMessages([]);
      setChatId(null);
      return;
    }
    setChatId(id);
    api.chats.get(id)
      .then((chat: any) => {
        setMessages(
          (chat.messages ?? []).map((m: any) => ({
            role: m.role,
            content: m.content,
            steps: [],
          }))
        );
      })
      .catch(() => {});
  }, [id]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || chatting) return;

    // Build content — prepend file text if attached
    const userContent = pendingFile
      ? `[Attached: ${pendingFile.name}]\n\n${pendingFile.content}\n\n---\n\n${text}`
      : text;

    // Show user message and clear inputs immediately
    setMessages(prev => [...prev, { role: 'user', content: text, attachedFileName: pendingFile?.name }]);
    setInput('');
    setPendingFile(null);
    setChatting(true);

    // Resolve or create chatId
    let activeChatId = chatId;
    if (!activeChatId) {
      try {
        const newChat = await api.chats.create({ title: text.slice(0, 60), model: selectedModel });
        activeChatId = newChat.id;
        setChatId(activeChatId);
        navigate(`/chat/${activeChatId}`, { replace: true });
        setChats([newChat, ...chats]);
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
        { content: userContent, model: selectedModel },
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

      // result.messages[0] = user echo, result.messages[1] = assistant reply
      const assistantContent = result.messages?.[1]?.content ?? '';
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent };
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
    }
  };

  const handleFileSelect = async (file: File) => {
    setFileLoading(true);
    try {
      const userId = localStorage.getItem('userId') || '';
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setPendingFile({
        name: file.name,
        content: data.textContent ?? '[Binary file — content not extractable as text]',
      });
    } catch {
      // silently fail — user can try again
    } finally {
      setFileLoading(false);
    }
  };

  const firstName = user?.display_name?.split(' ')[0] ?? 'there';

  const inputCard = (
    <div className={`rounded-2xl border border-vetted-border bg-white p-3 shadow-sm ${chatting ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* File chip — shown when a file is pending */}
      {pendingFile && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-vetted-surface border border-vetted-border rounded-lg text-xs text-vetted-text-muted mb-2 w-fit">
          <Paperclip size={11} />
          <span className="max-w-[160px] truncate">{pendingFile.name}</span>
          <button onClick={() => setPendingFile(null)} className="hover:text-vetted-primary transition-colors ml-0.5">
            <X size={11} />
          </button>
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
        rows={2}
        className="w-full resize-none text-sm text-vetted-primary placeholder-vetted-text-muted focus:outline-none disabled:opacity-50 bg-transparent"
      />

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between pt-2 mt-1 border-t border-vetted-border">
        {/* Left: file attach */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={fileLoading}
          className="p-1.5 rounded-lg border border-vetted-border text-vetted-text-muted hover:text-vetted-primary transition-colors disabled:opacity-40"
          title="Attach file"
        >
          {fileLoading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
        </button>

        {/* Right: model selector + send */}
        <div className="flex items-center gap-2">
          <select
            value={selectedModel}
            onChange={e => {
              const val = e.target.value as 'gemini' | 'claude';
              setSelectedModel(val);
              localStorage.setItem('selectedModel', val);
            }}
            className="text-xs border border-vetted-border rounded-lg px-2 py-1 text-vetted-text-secondary bg-white focus:outline-none cursor-pointer"
          >
            <option value="gemini">Gemini 3.1</option>
            <option value="claude">Opus 4.6</option>
          </select>
          <button
            onClick={handleSend}
            disabled={!input.trim() || chatting}
            className="p-1.5 rounded-lg bg-vetted-primary text-white disabled:opacity-40 hover:bg-opacity-80 transition-colors"
          >
            {chatting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFileSelect(f);
          e.target.value = '';
        }}
      />
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {messages.length === 0 ? (
        /* State 1: empty — centered column */
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-4 pb-16">
          <div className="text-center">
            <h2 className="text-3xl font-playfair text-vetted-primary mb-2">
              Good to see you, {firstName}!
            </h2>
            <p className="text-sm text-vetted-text-muted">Ask me anything, or attach a file to get started.</p>
          </div>
          <div className="w-full max-w-[560px]">
            {inputCard}
          </div>
        </div>
      ) : (
        /* State 2: active — messages + bottom-docked input */
        <>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
            <div ref={messagesEndRef} />
          </div>
          <div className="border-t border-vetted-border p-4">
            {inputCard}
          </div>
        </>
      )}
    </div>
  );
}
