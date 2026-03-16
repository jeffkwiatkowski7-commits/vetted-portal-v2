import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  reasoning: string;
}

export default function ModelReasoning({ reasoning }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border-l-4 border-vetted-accent bg-amber-50 overflow-hidden transition-all ${
        expanded ? 'max-h-96' : 'max-h-0'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-amber-100 transition-colors"
      >
        <span className="text-sm font-medium text-vetted-primary">Model Reasoning</span>
        <ChevronDown
          size={16}
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-amber-200">
          <pre className="text-xs text-vetted-text-secondary font-mono whitespace-pre-wrap break-words">
            {reasoning}
          </pre>
        </div>
      )}
    </div>
  );
}
