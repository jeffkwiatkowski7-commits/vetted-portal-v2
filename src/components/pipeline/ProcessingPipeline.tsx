import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const STEPS = [
  { name: 'Resolving chat', ms: 120 },
  { name: 'Discovering tools', ms: 200 },
  { name: 'Loading context', ms: 180 },
  { name: 'Building prompt', ms: 250 },
  { name: 'Calling model', ms: 400 },
  { name: 'Streaming response', ms: 280 },
];

const TOTAL_MS = STEPS.reduce((sum, s) => sum + s.ms, 0);

function formatTimestamp(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

interface StepRecord {
  name: string;
  ms: number;
  timestamp: Date;
}

interface Props {
  onComplete?: () => void;
}

export default function ProcessingPipeline({ onComplete }: Props) {
  const [completedSteps, setCompletedSteps] = useState<StepRecord[]>([]);
  const [progress, setProgress] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  const done = completedSteps.length === STEPS.length;

  useEffect(() => {
    const kickoff = requestAnimationFrame(() => {
      requestAnimationFrame(() => setProgress(100));
    });

    let cumulative = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    STEPS.forEach((step, i) => {
      cumulative += step.ms;
      const t = setTimeout(() => {
        setCompletedSteps((prev) => [...prev, { ...step, timestamp: new Date() }]);
        if (i === STEPS.length - 1) {
          const finish = setTimeout(() => {
            onComplete?.();
            setCollapsed(true);
          }, 200);
          timers.push(finish);
        }
      }, cumulative);
      timers.push(t);
    });

    return () => {
      cancelAnimationFrame(kickoff);
      timers.forEach(clearTimeout);
    };
  }, [onComplete]);

  return (
    <div className="rounded-lg border border-vetted-border bg-vetted-surface overflow-hidden">
      {/* Header row — always visible, clickable when done */}
      <div
        className={`flex items-center gap-2.5 px-3 py-2 ${done ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''}`}
        onClick={() => done && setCollapsed((c) => !c)}
      >
        {/* Progress bar */}
        <div className="flex-1 h-0.5 rounded-full overflow-hidden bg-gray-200">
          <div
            className="h-full rounded-full bg-gray-400"
            style={{
              width: `${progress}%`,
              transition: `width ${TOTAL_MS}ms linear`,
            }}
          />
        </div>

        {/* Time + toggle */}
        <span className="text-[10px] text-gray-400 shrink-0 font-mono tabular-nums">
          {done ? `${(TOTAL_MS / 1000).toFixed(2)}s` : '...'}
        </span>
        {done && (
          <span className="text-gray-300 shrink-0">
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
        )}
      </div>

      {/* Steps — hidden when collapsed */}
      {!collapsed && (
        <div className="px-3 pb-2.5 space-y-0.5">
          {completedSteps.map((step, i) => {
            const isActive = i === completedSteps.length - 1 && !done;
            return (
              <div key={i} className="flex items-baseline gap-2.5">
                <span
                  className="font-mono tabular-nums text-[10px] shrink-0"
                  style={{ color: '#C8C8C8' }}
                >
                  {formatTimestamp(step.timestamp)}
                </span>
                <div
                  className="shrink-0 rounded-full mt-[5px]"
                  style={{
                    width: 4,
                    height: 4,
                    background: isActive ? '#9CA3AF' : '#D1D5DB',
                  }}
                />
                <span
                  className="text-[11px] leading-snug"
                  style={{ color: isActive ? '#6B7280' : '#9CA3AF' }}
                >
                  {step.name}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
