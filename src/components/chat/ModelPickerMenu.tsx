import React from 'react';

export interface ModelPickerOption {
  name: string;
  value: string;
  modelId: string;
  provider: string;
  description: string | null;
  iconColor: string;
  isDefault: boolean;
}

export function GeminiMark({ size = 14 }: { size?: number }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="55%" stopColor="#9B72F2" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        d="M8 0.5C8 4.6 10.5 7.5 15.5 8C10.5 8.5 8 11.4 8 15.5C8 11.4 5.5 8.5 0.5 8C5.5 7.5 8 4.6 8 0.5Z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}

export function ClaudeMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <g fill="#D97757">
        <path d="M8 0.5L9.05 5.6 14.1 4.1 10.6 8 14.1 11.9 9.05 10.4 8 15.5 6.95 10.4 1.9 11.9 5.4 8 1.9 4.1 6.95 5.6Z" />
      </g>
    </svg>
  );
}

function isClaudeProvider(value: string, provider: string) {
  return value === 'claude' || provider.toLowerCase().includes('anthropic');
}

export function ProviderTile({ provider, value, size = 'md' }: { provider: string; value: string; size?: 'sm' | 'md' }) {
  const claude = isClaudeProvider(value, provider);
  const tint = claude ? 'bg-[#FBE9DF]' : 'bg-[#EEF1FF]';
  const dim = size === 'sm'
    ? 'w-5 h-5 rounded-[5px]'
    : 'w-7 h-7 rounded-[7px]';
  const iconSize = size === 'sm' ? 11 : 14;
  return (
    <span className={`shrink-0 inline-flex items-center justify-center ${dim} ${tint}`}>
      {claude ? <ClaudeMark size={iconSize} /> : <GeminiMark size={iconSize} />}
    </span>
  );
}

interface MenuProps {
  models: ModelPickerOption[];
  selectedModelId: string | undefined;
  onSelect: (m: ModelPickerOption) => void;
  /** Tailwind positioning classes — defaults to opening upward, right-aligned. */
  positionClass?: string;
  /** Optional id for click-outside detection. */
  popoverId?: string;
}

export function ModelPickerMenu({
  models,
  selectedModelId,
  onSelect,
  positionClass = 'absolute bottom-full right-0 mb-2',
  popoverId = 'model-picker-popover',
}: MenuProps) {
  // Group by provider; keep server order within group; selected provider first.
  const grouped = models.reduce<Record<string, ModelPickerOption[]>>((acc, m) => {
    const key = m.provider || 'Other';
    (acc[key] ||= []).push(m);
    return acc;
  }, {});
  const selectedProvider = models.find((m) => m.modelId === selectedModelId)?.provider;
  const providerOrder = Object.keys(grouped).sort((a, b) => {
    if (selectedProvider === a) return -1;
    if (selectedProvider === b) return 1;
    return a.localeCompare(b);
  });

  let rowIndex = 0;

  return (
    <div
      id={popoverId}
      className={`${positionClass} w-[340px] bg-white rounded-2xl ring-1 ring-vetted-primary/[0.07] z-20 overflow-hidden animate-scale-in origin-bottom-right`}
      style={{ boxShadow: '0 24px 60px -20px rgba(26,26,26,0.22), 0 4px 12px -4px rgba(26,26,26,0.06)' }}
    >
      <div className="px-4 pt-3.5 pb-2.5 border-b border-vetted-border/60 bg-gradient-to-b from-vetted-surface/40 to-white">
        <p className="font-serif text-[10px] uppercase tracking-[0.22em] text-vetted-text-muted">Model</p>
        <p className="text-[13px] text-vetted-primary mt-0.5 font-medium">Choose your engine</p>
      </div>

      <div className="py-1.5 max-h-[420px] overflow-y-auto">
        {providerOrder.map((provider) => (
          <div key={provider} className="py-1">
            <div className="px-4 pt-2 pb-1.5">
              <p className="font-serif text-[9.5px] uppercase tracking-[0.2em] text-vetted-text-muted/90">
                {provider}
              </p>
            </div>
            {grouped[provider].map((model) => {
              const isSelected = selectedModelId === model.modelId;
              const delay = `${rowIndex++ * 35}ms`;
              return (
                <button
                  key={model.modelId}
                  onClick={() => onSelect(model)}
                  style={{ animationDelay: delay, animationFillMode: 'backwards' }}
                  className={`group/row relative w-full text-left pl-4 pr-3.5 py-2.5 flex items-start gap-3 transition-colors animate-fade-in ${
                    isSelected ? 'bg-vetted-accent/[0.07]' : 'hover:bg-vetted-surface'
                  }`}
                >
                  <span
                    className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-r-sm bg-vetted-accent transition-opacity ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-30'
                    }`}
                    aria-hidden
                  />
                  <ProviderTile provider={model.provider} value={model.value} />
                  <div className="flex-1 min-w-0 pt-px">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13px] leading-tight ${isSelected ? 'font-semibold text-vetted-primary' : 'font-medium text-vetted-primary'}`}>
                        {model.name}
                      </span>
                      {model.isDefault && !isSelected && (
                        <span className="text-[9px] uppercase tracking-[0.14em] text-vetted-accent/90 font-medium">
                          Default
                        </span>
                      )}
                    </div>
                    {model.description && (
                      <p className="text-[11.5px] leading-snug text-vetted-text-secondary mt-1 pr-2">
                        {model.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 pt-1">
                    {isSelected ? (
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-vetted-accent text-white">
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    ) : (
                      <span className="block w-4 h-4" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="px-4 py-2.5 border-t border-vetted-border/60 bg-vetted-surface/40">
        <p className="text-[10.5px] text-vetted-text-muted leading-tight">
          Models &amp; descriptions managed in <span className="text-vetted-text-secondary">Admin → Models</span>.
        </p>
      </div>
    </div>
  );
}
