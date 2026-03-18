import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Trash2, Send, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IngestedLease {
  id: string;
  tenantName: string | null;
  propertyAddress: string | null;
  suiteNumber: string | null;
  monthlyRent: number | null;
  sourceFile: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: string[];
}

// ── SSE parser ────────────────────────────────────────────────────────────────

async function readSSE(
  response: Response,
  onEvent: (event: string, data: unknown) => void,
) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split('\n');
      let event = 'message';
      let dataLine = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
      }
      if (dataLine) {
        try {
          onEvent(event, JSON.parse(dataLine));
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}

// ── Upload zone ───────────────────────────────────────────────────────────────

function UploadZone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
        dragging
          ? 'border-vetted-accent bg-amber-50'
          : 'border-vetted-border hover:border-vetted-accent hover:bg-amber-50/30'
      }`}
    >
      <Upload size={32} className="mx-auto mb-3 text-vetted-text-muted" />
      <p className="text-sm font-medium text-vetted-primary mb-1">Drop a lease PDF here</p>
      <p className="text-xs text-vetted-text-muted">or click to browse</p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
    </div>
  );
}

// ── Ingest progress log ───────────────────────────────────────────────────────

function IngestLog({ logs, done }: { logs: string[]; done: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  return (
    <div className="bg-gray-900 rounded-xl p-4 font-mono text-xs max-h-48 overflow-y-auto">
      {logs.map((line, i) => (
        <div key={i} className={`mb-0.5 ${line.includes('ERROR') ? 'text-red-400' : line.includes('Stored') || line.includes('success') ? 'text-green-400' : 'text-gray-300'}`}>
          {line}
        </div>
      ))}
      {!done && <div className="text-amber-400 animate-pulse">▌</div>}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Lease card ────────────────────────────────────────────────────────────────

function LeaseCard({ lease, onDelete }: { lease: IngestedLease; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between p-3 bg-white border border-vetted-border rounded-lg">
      <div className="flex items-center gap-3 min-w-0">
        <FileText size={16} className="text-vetted-accent shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-vetted-primary truncate">
            {lease.tenantName ?? lease.sourceFile}
          </p>
          {lease.propertyAddress && (
            <p className="text-xs text-vetted-text-muted truncate">{lease.propertyAddress}{lease.suiteNumber ? ` · Suite ${lease.suiteNumber}` : ''}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        {lease.monthlyRent && (
          <span className="text-xs font-medium text-vetted-accent">${lease.monthlyRent.toLocaleString()}/mo</span>
        )}
        <button onClick={onDelete} className="text-vetted-text-muted hover:text-vetted-danger transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Chat message ──────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const [stepsOpen, setStepsOpen] = useState(false);

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-vetted-primary text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 max-w-[85%]">
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
      <div className="bg-vetted-bg border border-vetted-border rounded-2xl rounded-tl-sm px-4 py-3">
        <div className="prose-vetted text-[15px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LeaseChatPage() {
  const [leases, setLeases] = useState<IngestedLease[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const [ingestLogs, setIngestLogs] = useState<string[]>([]);
  const [ingestDone, setIngestDone] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Load existing leases on mount
  useEffect(() => {
    fetch('/api/leases').then(r => r.json()).then(d => {
      if (d.leases) setLeases(d.leases.map((l: any) => ({
        id: l.id,
        tenantName: l.tenantName,
        propertyAddress: l.propertyAddress,
        suiteNumber: l.suiteNumber,
        monthlyRent: l.monthlyRent,
        sourceFile: l.sourceFile,
      })));
    }).catch(() => {});
  }, []);

  const handleFile = async (file: File) => {
    setIngesting(true);
    setIngestLogs([]);
    setIngestDone(false);

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/leases/ingest', {
      method: 'POST',
      body: formData,
    });

    await readSSE(res, (event, data: any) => {
      if (event === 'log') {
        setIngestLogs(prev => [...prev, data.message]);
      } else if (event === 'done') {
        setIngestDone(true);
        setLeases(prev => [...prev, {
          id: data.id,
          tenantName: data.tenantName,
          propertyAddress: data.propertyAddress,
          suiteNumber: data.suiteNumber,
          monthlyRent: data.monthlyRent,
          sourceFile: file.name,
        }]);
        setIngesting(false);
      } else if (event === 'error') {
        setIngestLogs(prev => [...prev, `ERROR: ${data.message}`]);
        setIngestDone(true);
        setIngesting(false);
      }
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || chatting) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setChatting(true);

    const history = messages.map(m => ({ role: m.role, content: m.content }));

    const assistantMsg: ChatMessage = { role: 'assistant', content: '', steps: [] };
    setMessages(prev => [...prev, assistantMsg]);

    const res = await fetch('/api/leases/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history }),
    });

    await readSSE(res, (event, data: any) => {
      if (event === 'step') {
        setMessages(prev => {
          const updated = [...prev];
          const last = { ...updated[updated.length - 1] };
          last.steps = [...(last.steps ?? []), data.message];
          updated[updated.length - 1] = last;
          return updated;
        });
      } else if (event === 'done') {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: data.response };
          return updated;
        });
        setChatting(false);
      } else if (event === 'error') {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: `Error: ${data.message}` };
          return updated;
        });
        setChatting(false);
      }
    });
  };

  const handleDeleteLease = async (id: string) => {
    await fetch(`/api/leases/${id}`, { method: 'DELETE' }).catch(() => {});
    setLeases(prev => prev.filter(l => l.id !== id));
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — leases */}
      <div className="w-72 shrink-0 border-r border-vetted-border flex flex-col overflow-hidden">
        <div className="p-4 border-b border-vetted-border">
          <h2 className="font-playfair text-lg text-vetted-primary">Lease Chat</h2>
          <p className="text-xs text-vetted-text-muted mt-0.5">Upload PDFs, then ask questions</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!ingesting && <UploadZone onFile={handleFile} />}

          {(ingesting || (ingestLogs.length > 0)) && (
            <IngestLog logs={ingestLogs} done={ingestDone} />
          )}

          {leases.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-vetted-text-muted uppercase tracking-wide">{leases.length} lease{leases.length !== 1 ? 's' : ''}</p>
              {leases.map(l => (
                <LeaseCard key={l.id} lease={l} onDelete={() => handleDeleteLease(l.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — chat */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <FileText size={40} className="text-vetted-border mb-4" />
              <p className="text-vetted-text-muted text-sm">
                {leases.length === 0
                  ? 'Upload a lease PDF to get started'
                  : 'Ask a question about your leases'}
              </p>
            </div>
          )}
          {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
          {chatting && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (
            <div className="flex items-center gap-2 text-vetted-text-muted text-sm">
              <Loader2 size={14} className="animate-spin" />
              Thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-vetted-border p-4">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={leases.length === 0 ? 'Upload a lease first…' : 'Ask about your leases…'}
              disabled={leases.length === 0 || chatting}
              rows={2}
              className="flex-1 resize-none rounded-xl border border-vetted-border px-4 py-2.5 text-sm text-vetted-primary placeholder-vetted-text-muted focus:outline-none disabled:opacity-50 disabled:bg-gray-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || chatting || leases.length === 0}
              className="p-2.5 rounded-xl bg-vetted-primary text-white disabled:opacity-40 hover:bg-opacity-80 transition-colors"
            >
              {chatting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
