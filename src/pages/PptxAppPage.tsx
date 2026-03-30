import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Upload, CheckCircle, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';

type PageState = 'upload' | 'processing' | 'success' | 'error';

interface Summary {
  colorCount: number;
  fonts: { heading?: string; body?: string };
  layoutCount: number;
  mediaCount: number;
}

interface ParseResult {
  file_id: string;
  summary: Summary;
  skippedMedia: string[];
  colors?: Record<string, string>;
}

const STEPS = [
  'Uploading file...',
  'Extracting theme...',
  'Processing media...',
  'Building design tokens...',
];

export default function PptxAppPage() {
  const navigate = useNavigate();
  const { user, addToast } = useStore();
  const [state, setState] = useState<PageState>('upload');
  const [fileName, setFileName] = useState('');
  const [currentStep, setCurrentStep] = useState(0);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      addToast({ type: 'error', title: 'Please upload a .pptx file' });
      return;
    }

    setFileName(file.name);
    setState('processing');
    setCurrentStep(0);

    // Simulate step progression while the upload/parse happens
    const stepTimer = setInterval(() => {
      setCurrentStep(prev => Math.min(prev + 1, STEPS.length - 1));
    }, 800);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/apps/pptx-parse', {
        method: 'POST',
        headers: { 'X-User-Id': user?.id || '' },
        body: formData,
      });

      clearInterval(stepTimer);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setState('error');
        setErrorMsg(data.error || 'Failed to parse PowerPoint file');
        return;
      }

      setCurrentStep(STEPS.length);
      setResult(data);
      setState('success');
    } catch {
      clearInterval(stepTimer);
      setState('error');
      setErrorMsg('Network error — could not reach the server');
    }
  }, [user, addToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const reset = () => {
    setState('upload');
    setFileName('');
    setCurrentStep(0);
    setResult(null);
    setErrorMsg('');
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Back button */}
        <button
          onClick={() => navigate('/apps')}
          className="flex items-center gap-1.5 text-sm text-vetted-text-secondary hover:text-vetted-primary mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Apps
        </button>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-serif text-vetted-primary">PowerPoint Template Extractor</h1>
          <p className="text-vetted-text-secondary mt-1">Upload a PowerPoint template to extract its design system</p>
        </div>

        {/* Upload State */}
        {state === 'upload' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              dragOver
                ? 'border-vetted-accent bg-vetted-accent/5'
                : 'border-vetted-border hover:border-vetted-accent/50'
            }`}
          >
            <Upload size={48} className="mx-auto text-vetted-text-muted mb-4 opacity-50" />
            <p className="text-vetted-text-secondary mb-4">
              Drag and drop a <span className="font-medium text-vetted-primary">.pptx</span> file here
            </p>
            <label className="btn-primary inline-flex items-center gap-2 cursor-pointer">
              Choose File
              <input
                type="file"
                accept=".pptx"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </div>
        )}

        {/* Processing State */}
        {state === 'processing' && (
          <div className="card p-8">
            <p className="font-medium text-vetted-primary mb-6">{fileName}</p>
            <div className="space-y-3">
              {STEPS.map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  {i < currentStep ? (
                    <CheckCircle size={18} className="text-green-500 shrink-0" />
                  ) : i === currentStep ? (
                    <Loader2 size={18} className="text-vetted-accent shrink-0 animate-spin" />
                  ) : (
                    <div className="w-[18px] h-[18px] rounded-full border border-vetted-border shrink-0" />
                  )}
                  <span className={i <= currentStep ? 'text-vetted-primary' : 'text-vetted-text-muted'}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Success State */}
        {state === 'success' && result && (
          <div className="space-y-6">
            <div className="card p-6 border-green-200 bg-green-50/30">
              <div className="flex items-center gap-3 mb-1">
                <CheckCircle size={24} className="text-green-500" />
                <p className="font-medium text-vetted-primary">Design tokens saved to your Library</p>
              </div>
            </div>

            {/* Summary Card */}
            <div className="card p-6 space-y-5">
              {/* Colors */}
              {result.summary.colorCount > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-vetted-text-secondary mb-2">Colors</h3>
                  <div className="flex flex-wrap gap-2">
                    {result.colors && Object.entries(result.colors).map(([name, hex]) => (
                      <div key={name} className="flex items-center gap-1.5" title={`${name}: ${hex}`}>
                        <div
                          className="w-7 h-7 rounded-full border border-vetted-border shadow-sm"
                          style={{ backgroundColor: hex }}
                        />
                      </div>
                    ))}
                    {!result.colors && (
                      <span className="text-sm text-vetted-text-muted">{result.summary.colorCount} colors extracted</span>
                    )}
                  </div>
                </div>
              )}

              {/* Fonts */}
              {(result.summary.fonts.heading || result.summary.fonts.body) && (
                <div>
                  <h3 className="text-sm font-medium text-vetted-text-secondary mb-2">Fonts</h3>
                  <div className="space-y-1 text-sm">
                    {result.summary.fonts.heading && (
                      <p><span className="text-vetted-text-muted">Heading:</span> <span className="font-medium">{result.summary.fonts.heading}</span></p>
                    )}
                    {result.summary.fonts.body && (
                      <p><span className="text-vetted-text-muted">Body:</span> <span className="font-medium">{result.summary.fonts.body}</span></p>
                    )}
                  </div>
                </div>
              )}

              {/* Layouts */}
              {result.summary.layoutCount > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-vetted-text-secondary mb-2">Layouts</h3>
                  <p className="text-sm">{result.summary.layoutCount} layouts extracted</p>
                </div>
              )}

              {/* Media */}
              {result.summary.mediaCount > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-vetted-text-secondary mb-2">Media</h3>
                  <p className="text-sm">{result.summary.mediaCount} images extracted</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={reset} className="btn-secondary">
                Upload Another
              </button>
              <button onClick={() => navigate('/library')} className="btn-primary">
                View in Library
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {state === 'error' && (
          <div className="card p-6 border-red-200 bg-red-50/30">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle size={24} className="text-red-500" />
              <p className="font-medium text-red-700">{errorMsg}</p>
            </div>
            <button onClick={reset} className="btn-secondary">
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
