import React, { useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Eye, Code, Copy, Download, ExternalLink, Check } from 'lucide-react';
import LAYOUT_CSS from './canvas-deck-styles.css?raw';

interface Props {
  body: string; // raw fence body, including <!--TOKENS:...--> header
}

const DEFAULTS = {
  primary: '#1A1A1A',
  accent: '#C4A962',
  background: '#FFFFFF',
  headingFont: 'Playfair Display',
  bodyFont: 'Inter',
};

const KNOWN_LAYOUTS = new Set(['title', 'section', 'content', 'two-col', 'stat', 'table', 'quote', 'closing']);

const NAV_SCRIPT = `
  (function() {
    const slides = Array.from(document.querySelectorAll('.slide'));
    const dots = Array.from(document.querySelectorAll('.deck-nav .dot'));
    const prev = document.querySelector('.deck-nav .prev');
    const next = document.querySelector('.deck-nav .next');
    const counter = document.querySelector('.deck-nav .counter');
    let i = 0;
    function show(n) {
      i = Math.max(0, Math.min(slides.length - 1, n));
      slides.forEach((s, idx) => s.setAttribute('aria-current', idx === i ? 'true' : 'false'));
      dots.forEach((d, idx) => d.setAttribute('aria-current', idx === i ? 'true' : 'false'));
      if (counter) counter.textContent = (i + 1) + ' / ' + slides.length;
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === slides.length - 1;
    }
    if (prev) prev.addEventListener('click', () => show(i - 1));
    if (next) next.addEventListener('click', () => show(i + 1));
    dots.forEach((d, idx) => d.addEventListener('click', () => show(idx)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });
    show(0);
  })();
`;

function parseTokens(body: string): typeof DEFAULTS {
  const m = body.match(/<!--TOKENS:({.*?})-->/);
  if (!m) return DEFAULTS;
  try {
    const parsed = JSON.parse(m[1]);
    return {
      primary: parsed.primary || DEFAULTS.primary,
      accent: parsed.accent || DEFAULTS.accent,
      background: parsed.background || DEFAULTS.background,
      headingFont: parsed.headingFont || DEFAULTS.headingFont,
      bodyFont: parsed.bodyFont || DEFAULTS.bodyFont,
    };
  } catch {
    return DEFAULTS;
  }
}

function parseSections(body: string): { layout: string; html: string }[] {
  const stripped = body.replace(/<!--TOKENS:.*?-->/, '');
  const doc = new DOMParser().parseFromString(`<root>${stripped}</root>`, 'text/html');
  const sections = Array.from(doc.querySelectorAll('section[data-layout]'));
  return sections.map((s) => {
    let layout = s.getAttribute('data-layout') || 'content';
    if (!KNOWN_LAYOUTS.has(layout)) {
      console.warn(`[CanvasDeckBlock] unknown layout "${layout}" — falling back to content`);
      layout = 'content';
    }
    const html = DOMPurify.sanitize(s.innerHTML, {
      FORBID_TAGS: ['script', 'style', 'link', 'iframe', 'object', 'embed'],
      ADD_ATTR: ['class', 'data-layout'],
    });
    return { layout, html };
  });
}

function buildSrcDoc(tokens: typeof DEFAULTS, sections: { layout: string; html: string }[]): string {
  const fontHeadingEsc = encodeURIComponent(tokens.headingFont).replace(/%20/g, '+');
  const fontBodyEsc = encodeURIComponent(tokens.bodyFont).replace(/%20/g, '+');
  const slidesHtml = sections.map((s) =>
    `<article class="slide" data-layout="${s.layout}" aria-current="false">${s.html}</article>`
  ).join('\n');
  const dotsHtml = sections.map((_, i) =>
    `<button class="dot" aria-current="${i === 0 ? 'true' : 'false'}"></button>`
  ).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
:root {
  --brand-primary: ${tokens.primary};
  --brand-accent: ${tokens.accent};
  --brand-background: ${tokens.background};
  --font-heading: '${tokens.headingFont}', Georgia, serif;
  --font-body: '${tokens.bodyFont}', system-ui, sans-serif;
}
${LAYOUT_CSS}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${fontHeadingEsc}&family=${fontBodyEsc}&display=swap">
</head><body>
<div class="deck">${slidesHtml}</div>
<nav class="deck-nav" role="navigation">
  <button class="prev" aria-label="Previous slide">←</button>
  <div class="dots">${dotsHtml}</div>
  <span class="counter">1 / ${sections.length}</span>
  <button class="next" aria-label="Next slide">→</button>
</nav>
<script>${NAV_SCRIPT}</script>
</body></html>`;
}

export default function CanvasDeckBlock({ body }: Props) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { srcDoc, sectionCount } = useMemo(() => {
    const tokens = parseTokens(body);
    const sections = parseSections(body);
    if (sections.length === 0) return { srcDoc: '', sectionCount: 0 };
    return { srcDoc: buildSrcDoc(tokens, sections), sectionCount: sections.length };
  }, [body]);

  // Empty/malformed fence → fall back to a plain code block.
  if (sectionCount === 0) {
    return (
      <pre className="my-3 px-4 py-3 rounded-xl bg-[#1a1a1a] overflow-x-auto text-[13px] leading-relaxed">
        <code className="text-green-300 font-mono">{body}</code>
      </pre>
    );
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const handleDownload = () => {
    const blob = new Blob([srcDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'deck.html'; a.click();
    URL.revokeObjectURL(url);
  };
  const handleNewTab = () => {
    const blob = new Blob([srcDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <div className="my-3 rounded-xl bg-[#1a1a1a] overflow-hidden border border-[#2a2a2a]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#2a2a2a]">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${tab === 'preview' ? 'bg-[#C4A962]/20 text-[#C4A962]' : 'text-white/40 hover:text-white/60'}`}
          ><Eye size={13} /> Preview</button>
          <button
            onClick={() => setTab('code')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${tab === 'code' ? 'bg-[#C4A962]/20 text-[#C4A962]' : 'text-white/40 hover:text-white/60'}`}
          ><Code size={13} /> Code</button>
          <span className="ml-2 text-[10px] text-white/40 self-center">{sectionCount} slide{sectionCount === 1 ? '' : 's'}</span>
        </div>
        <div className="flex gap-1">
          <button onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5" title="Copy">
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5" title="Download">
            <Download size={13} />
          </button>
          <button onClick={handleNewTab} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/60 hover:bg-white/5" title="Open in new tab">
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {tab === 'preview' ? (
        <div className="relative">
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            className="w-full bg-white border-0"
            style={{ height: expanded ? '80vh' : '480px' }}
            title="Canvas deck preview"
          />
          <button
            onClick={() => setExpanded(!expanded)}
            className="absolute bottom-2 right-2 px-2 py-1 rounded text-[10px] bg-black/60 text-white/60 hover:text-white/80"
          >{expanded ? 'Collapse' : 'Expand'}</button>
        </div>
      ) : (
        <pre className="px-4 py-3 overflow-x-auto text-[13px] leading-relaxed max-h-[500px]">
          <code className="text-green-300 font-mono">{body}</code>
        </pre>
      )}
    </div>
  );
}
