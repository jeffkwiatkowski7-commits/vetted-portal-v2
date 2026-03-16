import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import { Play, Pause, SkipForward, X, MessageSquare, FileText } from 'lucide-react';

interface ScenarioStep {
  description: string;
  highlight: string | null;
  action: () => void;
  duration: number;
}

export default function DemoMode() {
  const navigate = useNavigate();
  const {
    demoActive,
    setDemoActive,
    demoPaused,
    setDemoPaused,
    setDemoHighlight,
    setDemoInputText,
    setDemoShowModelPicker,
    setDemoAttachedFile,
  } = useStore();

  const [activeScenario, setActiveScenario] = useState<number | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [done, setDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scenarios: { title: string; subtitle: string; icon: React.ReactNode; steps: ScenarioStep[] }[] = [
    {
      title: 'Make a Request',
      subtitle: 'Type a prompt and select a model',
      icon: <MessageSquare size={18} />,
      steps: [
        {
          description: 'Type your request in the chat input below',
          highlight: 'chat-input',
          action: () => {
            navigate('/');
            setDemoInputText('Summarize the key risks in our Q4 earnings report');
            setDemoShowModelPicker(false);
            setDemoAttachedFile(null);
          },
          duration: 3000,
        },
        {
          description: 'Choose your AI model — Claude, Gemini, and more are available',
          highlight: 'model-picker',
          action: () => {
            setDemoShowModelPicker(true);
          },
          duration: 3000,
        },
        {
          description: 'Hit send to get your answer',
          highlight: 'send-button',
          action: () => {
            setDemoShowModelPicker(false);
          },
          duration: 2500,
        },
      ],
    },
    {
      title: 'Ask About a File',
      subtitle: 'Upload a document and ask questions',
      icon: <FileText size={18} />,
      steps: [
        {
          description: 'Click the paperclip to attach a file from your library',
          highlight: 'paperclip',
          action: () => {
            navigate('/');
            setDemoInputText('');
            setDemoAttachedFile('Q4_Earnings_Report.pdf');
            setDemoShowModelPicker(false);
          },
          duration: 3000,
        },
        {
          description: 'Your file is attached and ready for analysis',
          highlight: 'chat-input',
          action: () => {},
          duration: 2500,
        },
        {
          description: 'Ask a question about the document',
          highlight: 'chat-input',
          action: () => {
            setDemoInputText('What are the key findings in this document?');
          },
          duration: 3000,
        },
        {
          description: 'Send to get instant AI insights on your file',
          highlight: 'send-button',
          action: () => {},
          duration: 2500,
        },
      ],
    },
  ];

  const scenario = activeScenario !== null ? scenarios[activeScenario] : null;
  const steps = scenario?.steps ?? [];
  const step = steps[currentStep];
  const progress = steps.length > 0 ? ((currentStep + 1) / steps.length) * 100 : 0;

  // Run step action and set highlight whenever step changes
  useEffect(() => {
    if (activeScenario === null || done) return;
    const s = scenarios[activeScenario]?.steps[currentStep];
    if (!s) return;
    s.action();
    setDemoHighlight(s.highlight);
  }, [activeScenario, currentStep, done]);

  // Auto-advance timer
  useEffect(() => {
    if (activeScenario === null || demoPaused || done) return;
    const s = scenarios[activeScenario]?.steps[currentStep];
    if (!s) return;

    timerRef.current = setTimeout(() => {
      if (currentStep < steps.length - 1) {
        setCurrentStep((n) => n + 1);
      } else {
        setDone(true);
        setDemoHighlight(null);
        setDemoInputText('');
        setDemoShowModelPicker(false);
        setDemoAttachedFile(null);
      }
    }, s.duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeScenario, currentStep, demoPaused, done]);

  const handleExit = () => {
    setDemoActive(false);
    setActiveScenario(null);
    setCurrentStep(0);
    setDone(false);
    setDemoPaused(false);
  };

  const handleSkip = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (currentStep < steps.length - 1) {
      setCurrentStep((n) => n + 1);
    } else {
      setDone(true);
      setDemoHighlight(null);
      setDemoInputText('');
      setDemoShowModelPicker(false);
      setDemoAttachedFile(null);
    }
  };

  const handleReplay = () => {
    setCurrentStep(0);
    setDone(false);
    setDemoPaused(false);
  };

  const handlePickScenario = (index: number) => {
    setActiveScenario(index);
    setCurrentStep(0);
    setDone(false);
    setDemoPaused(false);
  };

  if (!demoActive) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-72 bg-white rounded-xl shadow-xl border border-vetted-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-vetted-border">
        <span className="text-xs font-semibold text-vetted-text-muted uppercase tracking-wider">
          {activeScenario === null ? 'Demo' : scenario?.title}
        </span>
        <button
          onClick={handleExit}
          className="p-1 rounded hover:bg-vetted-surface transition-colors text-vetted-text-muted hover:text-vetted-text-secondary"
        >
          <X size={14} />
        </button>
      </div>

      {/* Scenario Picker */}
      {activeScenario === null && (
        <div className="p-4 space-y-2">
          <p className="text-xs text-vetted-text-muted mb-3">Select a scenario to walk through</p>
          {scenarios.map((s, i) => (
            <button
              key={i}
              onClick={() => handlePickScenario(i)}
              className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border border-vetted-border hover:border-vetted-accent hover:bg-vetted-surface transition-colors group"
            >
              <span className="text-vetted-accent mt-0.5">{s.icon}</span>
              <div>
                <p className="text-sm font-medium text-vetted-primary">{s.title}</p>
                <p className="text-xs text-vetted-text-muted">{s.subtitle}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Active Scenario — Running */}
      {activeScenario !== null && !done && (
        <div className="p-4">
          <p className="text-sm text-vetted-primary mb-4 leading-snug">{step?.description}</p>

          {/* Progress */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-vetted-text-muted mb-1.5">
              <span>Step {currentStep + 1} of {steps.length}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full bg-vetted-border rounded-full h-1">
              <div
                className="bg-vetted-accent h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            <button
              onClick={() => setDemoPaused(!demoPaused)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-vetted-border rounded-lg hover:bg-vetted-surface transition-colors text-xs text-vetted-text-secondary"
            >
              {demoPaused ? <Play size={12} /> : <Pause size={12} />}
              {demoPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={handleSkip}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-vetted-border rounded-lg hover:bg-vetted-surface transition-colors text-xs text-vetted-text-secondary"
            >
              <SkipForward size={12} />
              Next
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {activeScenario !== null && done && (
        <div className="p-4 text-center">
          <p className="text-sm font-medium text-vetted-primary mb-1">Done!</p>
          <p className="text-xs text-vetted-text-muted mb-4">{scenario?.title} complete</p>
          <div className="flex gap-2">
            <button
              onClick={handleReplay}
              className="flex-1 px-3 py-1.5 border border-vetted-border rounded-lg text-xs text-vetted-text-secondary hover:bg-vetted-surface transition-colors"
            >
              Replay
            </button>
            <button
              onClick={() => { setActiveScenario(null); setDone(false); }}
              className="flex-1 px-3 py-1.5 border border-vetted-accent text-vetted-accent rounded-lg text-xs hover:bg-vetted-surface transition-colors"
            >
              Scenarios
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
