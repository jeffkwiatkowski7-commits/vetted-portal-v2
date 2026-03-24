import React, { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../../store';
import * as api from '../../api';
import { Copy, ThumbsUp, ThumbsDown, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import ModelReasoning from '../pipeline/ModelReasoning';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';

function modelDisplayName(value?: string): string | undefined {
  if (!value) return undefined;
  if (value === 'gemini') return 'Gemini 3.1';
  if (value === 'claude') return 'Opus 4.6';
  return value; // fallback: show raw value
}

// ── Markdown renderer for assistant messages ──────────────────────────────────
function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose-vetted">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Headings
          h1: ({ children }) => (
            <h1 className="font-serif text-2xl font-bold text-vetted-text-primary mt-6 mb-3 pb-2 border-b border-vetted-border">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-serif text-xl font-bold text-vetted-text-primary mt-5 mb-2">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="font-sans text-base font-semibold text-vetted-text-primary mt-4 mb-1.5">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="font-sans text-sm font-semibold text-vetted-text-secondary uppercase tracking-wide mt-3 mb-1">
              {children}
            </h4>
          ),

          // Paragraph
          p: ({ children }) => (
            <p className="text-[15px] leading-relaxed text-vetted-text-primary mb-3 last:mb-0">
              {children}
            </p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="my-3 space-y-1.5 pl-5 list-disc marker:text-vetted-accent">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 space-y-1.5 pl-5 list-decimal marker:text-vetted-text-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-[15px] leading-relaxed text-vetted-text-primary pl-1">
              {children}
            </li>
          ),

          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="my-3 pl-4 border-l-4 border-vetted-accent bg-amber-50/60 py-2 pr-3 rounded-r-lg text-vetted-text-secondary italic text-[15px]">
              {children}
            </blockquote>
          ),

          // Inline code
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <code className={`${className ?? ''} text-[13px] font-mono`}>{children}</code>
              );
            }
            return (
              <code className="font-mono text-[13px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                {children}
              </code>
            );
          },

          // Code block wrapper
          pre: ({ children }) => (
            <pre className="my-3 rounded-xl overflow-auto text-[13px] font-mono bg-vetted-surface border border-vetted-border p-4 leading-relaxed">
              {children}
            </pre>
          ),

          // Tables
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-vetted-border">
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
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-vetted-text-secondary uppercase tracking-wide">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 text-[14px] text-vetted-text-primary border-b border-vetted-border">{children}</td>
          ),

          // Horizontal rule
          hr: () => <hr className="my-5 border-vetted-border" />,

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-vetted-accent underline underline-offset-2 hover:text-vetted-accent-dark transition-colors"
            >
              {children}
            </a>
          ),

          // Strong / em
          strong: ({ children }) => (
            <strong className="font-semibold text-vetted-text-primary">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-vetted-text-secondary">{children}</em>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── Assistant message with pipeline-first sequencing ─────────────────────────
function StepsLog({ steps }: { steps: string[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-lg border border-vetted-border bg-vetted-surface overflow-hidden text-[11px]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 transition-colors text-left"
      >
        {open ? <ChevronDown size={11} className="text-gray-400 shrink-0" /> : <ChevronRight size={11} className="text-gray-400 shrink-0" />}
        <span className="text-gray-400 font-mono">{steps.length} steps</span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-0.5 space-y-1 border-t border-vetted-border">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0 mt-1.5" />
              <span className="text-gray-500 font-mono leading-snug">{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  content,
  reasoning,
  steps,
  modelUsed,
  citations,
}: {
  content: string;
  reasoning?: string;
  steps?: string[];
  modelUsed?: string;
  citations?: { filename: string; pageNumber: number | null }[];
}) {
  const [copied, setCopied] = React.useState(false);
  const [thumbs, setThumbs] = React.useState<'up' | 'down' | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      {steps && steps.length > 0 && <StepsLog steps={steps} />}
      <MarkdownContent content={content} />
      {citations && citations.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/10">
          <div className="text-xs text-white/40 mb-1">Sources:</div>
          <div className="flex flex-wrap gap-1">
            {citations.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded text-xs text-white/50">
                {c.filename}{c.pageNumber ? ` (p. ${c.pageNumber})` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
      {reasoning && <ModelReasoning reasoning={reasoning} />}
      <div className="flex items-center gap-1">
        <button
          onClick={handleCopy}
          className={`p-1.5 rounded-md transition-colors ${copied ? 'text-vetted-accent' : 'text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface'}`}
          title={copied ? 'Copied!' : 'Copy'}
        >
          <Copy size={15} />
        </button>
        {copied && <span className="text-[11px] text-vetted-accent mr-1">Copied!</span>}
        <button
          onClick={() => setThumbs(thumbs === 'up' ? null : 'up')}
          className={`p-1.5 rounded-md transition-colors ${thumbs === 'up' ? 'text-vetted-accent' : 'text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface'}`}
          title="Good response"
        >
          <ThumbsUp size={15} />
        </button>
        <button
          onClick={() => setThumbs(thumbs === 'down' ? null : 'down')}
          className={`p-1.5 rounded-md transition-colors ${thumbs === 'down' ? 'text-vetted-danger' : 'text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface'}`}
          title="Bad response"
        >
          <ThumbsDown size={15} />
        </button>
        <button
          className="p-1.5 rounded-md text-vetted-text-muted hover:text-vetted-text-secondary hover:bg-vetted-surface transition-colors"
          title="Regenerate"
        >
          <RefreshCw size={15} />
        </button>
        {modelDisplayName(modelUsed) && (
          <span className="ml-2 text-[11px] text-vetted-text-muted">
            {modelDisplayName(modelUsed)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Thinking indicator ────────────────────────────────────────────────────────
function ThinkingIndicator({ steps }: { steps: Array<{ message: string; ts: string }> }) {
  const bottomRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps.length]);

  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-1.5 py-1">
        <span className="w-2 h-2 rounded-full bg-vetted-text-muted animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 rounded-full bg-vetted-text-muted animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 rounded-full bg-vetted-text-muted animate-bounce [animation-delay:300ms]" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-vetted-border bg-vetted-surface overflow-hidden text-[11px]">
        <div className="px-3 py-2 space-y-1.5">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${i === steps.length - 1 ? 'bg-vetted-accent animate-pulse' : 'bg-gray-300'}`} />
              <span className="text-gray-500 font-mono leading-snug flex-1">{s.message}</span>
              <span className="text-gray-400 font-mono whitespace-nowrap shrink-0">
                {new Date(s.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 py-1">
        <span className="w-2 h-2 rounded-full bg-vetted-text-muted animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 rounded-full bg-vetted-text-muted animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 rounded-full bg-vetted-text-muted animate-bounce [animation-delay:300ms]" />
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

function formatMessageTime(isoStr: string) {
  const d = new Date(isoStr);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

// ── Main ChatView ─────────────────────────────────────────────────────────────
export default function ChatView({ chatId: chatIdProp }: { chatId?: string } = {}) {
  const { id: urlId } = useParams<{ id: string }>();
  const id = chatIdProp !== undefined ? chatIdProp : urlId;
  const { activeChat, setActiveChat, aiThinking, liveSteps } = useStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    if (id && (id !== activeChat?.id || !activeChat?.messages)) {
      setLoading(true);
      api.chats
        .get(id)
        .then((chat) => {
          setActiveChat(chat);
          setLoading(false);
        })
        .catch((err) => {
          console.error(err);
          setLoading(false);
        });
    }
  }, [id, activeChat?.id, activeChat?.messages, setActiveChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages, aiThinking]);

  if (!activeChat) return null;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-vetted-text-secondary">Loading chat...</div>
      </div>
    );
  }

  const messages = activeChat.messages || [];
  if (messages.length === 0) return <div className="flex-1 bg-white" />;

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {messages.map((msg, idx) => (
          <div key={msg.id || idx}>
            {msg.role === 'user' ? (
              /* User message — right-aligned pill */
              <div className="flex flex-col items-end gap-1">
                <div className="max-w-[75%] bg-vetted-surface text-vetted-primary rounded-2xl px-5 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
                {msg.created_at && (
                  <span className="text-[10px] text-vetted-text-muted pr-1">
                    {formatMessageTime(msg.created_at)}
                  </span>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <AssistantMessage
                  content={msg.content}
                  reasoning={msg.reasoning}
                  steps={msg.steps}
                  modelUsed={msg.model_used}
                  citations={msg.citations}
                />
                {msg.created_at && (
                  <span className="text-[10px] text-vetted-text-muted">
                    {formatMessageTime(msg.created_at)}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
        {aiThinking && <ThinkingIndicator steps={liveSteps} />}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
