import React, { useState, useRef, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { Eye, Code, Copy, Download, ExternalLink, Check } from 'lucide-react';

interface CanvasBlockProps {
  html: string;
}

export default function CanvasBlock({ html }: CanvasBlockProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const sanitizedHtml = useMemo(() => DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style', 'link'],
    ADD_ATTR: ['target', 'rel'],
  }), [html]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'canvas-output.html';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNewTab = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  return (
    <div className="my-3 rounded-xl bg-[#1a1a1a] overflow-hidden border border-[#2a2a2a]">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#2a2a2a]">
        {/* Tab Toggle */}
        <div className="flex gap-1">
          <button
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              tab === 'preview'
                ? 'bg-[#C4A962]/20 text-[#C4A962]'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <Eye size={13} />
            Preview
          </button>
          <button
            onClick={() => setTab('code')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              tab === 'code'
                ? 'bg-[#C4A962]/20 text-[#C4A962]'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <Code size={13} />
            Code
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-1">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors"
            title="Copy HTML"
          >
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors"
            title="Download HTML"
          >
            <Download size={13} />
          </button>
          <button
            onClick={handleNewTab}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-colors"
            title="Open in new tab"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      {tab === 'preview' ? (
        <div className="relative">
          <iframe
            ref={iframeRef}
            srcDoc={sanitizedHtml}
            sandbox="allow-same-origin"
            className="w-full bg-white border-0"
            style={{ height: expanded ? '80vh' : '400px' }}
            title="Canvas preview"
          />
          <button
            onClick={() => setExpanded(!expanded)}
            className="absolute bottom-2 right-2 px-2 py-1 rounded text-[10px] bg-black/60 text-white/60 hover:text-white/80 transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      ) : (
        <pre className="px-4 py-3 overflow-x-auto text-[13px] leading-relaxed max-h-[500px]">
          <code className="text-green-300 font-mono">{html}</code>
        </pre>
      )}
    </div>
  );
}
