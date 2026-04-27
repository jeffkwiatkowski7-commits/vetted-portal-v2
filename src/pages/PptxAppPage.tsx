import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Upload, CheckCircle, AlertCircle, Loader2, ArrowLeft, Plus, Eye, Pencil, RefreshCw, Archive, ArchiveRestore, Trash2, Send } from 'lucide-react';
import { TemplateRow, PreviewModal } from '../components/templates';
import ProjectPickerModal from '../components/projects/ProjectPickerModal';
import { pptxTemplates } from '../api';
import type { PptxTemplate } from '../types';

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

  const [templates, setTemplates] = useState<PptxTemplate[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState<'ic_memo' | 'one_pager' | 'investor_update' | 'custom'>('ic_memo');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [applyForId, setApplyForId] = useState<string | null>(null);
  const [applyForName, setApplyForName] = useState<string>('');

  const refreshTemplates = useCallback(async () => {
    try {
      const list = await pptxTemplates.list({ includeArchived: showArchived });
      setTemplates(list);
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message || 'Failed to load templates' });
    }
  }, [showArchived, addToast]);

  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);

  const handleUpload = async () => {
    if (!uploadFile || !uploadName.trim()) return;
    setUploading(true);
    try {
      await pptxTemplates.upload(uploadFile, { name: uploadName.trim(), template_type: uploadType });
      addToast({ type: 'success', title: 'Template uploaded' });
      setShowUploadForm(false);
      setUploadFile(null);
      setUploadName('');
      setUploadType('ic_memo');
      await refreshTemplates();
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  };

  const handleArchiveToggle = async (t: PptxTemplate) => {
    try {
      await pptxTemplates.patch(t.id, { status: t.status === 'active' ? 'archived' : 'active' });
      addToast({ type: 'success', title: t.status === 'active' ? 'Archived' : 'Restored' });
      await refreshTemplates();
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message || 'Failed to update template' });
    }
  };

  const handleReplace = (t: PptxTemplate) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pptx';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await pptxTemplates.replace(t.id, file);
        addToast({ type: 'success', title: 'Template replaced' });
        await refreshTemplates();
      } catch (err) {
        addToast({ type: 'error', title: (err as Error).message || 'Replace failed' });
      }
    };
    input.click();
  };

  const handleRename = async () => {
    if (!renameId || !renameDraft.trim()) return;
    try {
      await pptxTemplates.patch(renameId, { name: renameDraft.trim() });
      addToast({ type: 'success', title: 'Template renamed' });
      setRenameId(null);
      setRenameDraft('');
      await refreshTemplates();
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message || 'Rename failed' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await pptxTemplates.remove(id);
      addToast({ type: 'success', title: 'Template deleted' });
      setConfirmDeleteId(null);
      await refreshTemplates();
    } catch (err) {
      addToast({ type: 'error', title: (err as Error).message || 'Delete failed' });
    }
  };

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

        {/* Your Templates section */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-xl text-vetted-primary">Your Templates</h2>
            <button
              onClick={() => setShowUploadForm(s => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-vetted-accent text-vetted-primary rounded text-sm font-medium hover:bg-vetted-accent/90"
            >
              <Plus size={14} />
              Upload
            </button>
          </div>

          {showUploadForm && (
            <div className="mb-4 p-4 border border-vetted-border rounded-lg bg-vetted-surface/30 space-y-3">
              <div>
                <label className="block text-xs font-medium text-vetted-text-muted uppercase tracking-wide mb-1">File</label>
                <input
                  type="file"
                  accept=".pptx"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    setUploadFile(f);
                    if (f && !uploadName) setUploadName(f.name.replace(/\.pptx$/i, ''));
                  }}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-muted uppercase tracking-wide mb-1">Name</label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={e => setUploadName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-vetted-border rounded text-sm"
                  placeholder="Template name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-vetted-text-muted uppercase tracking-wide mb-1">Type</label>
                <select
                  value={uploadType}
                  onChange={e => setUploadType(e.target.value as typeof uploadType)}
                  className="w-full px-3 py-1.5 border border-vetted-border rounded text-sm"
                >
                  <option value="ic_memo">IC Memo</option>
                  <option value="one_pager">One Pager</option>
                  <option value="investor_update">Investor Update</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleUpload}
                  disabled={uploading || !uploadFile || !uploadName.trim()}
                  className="px-3 py-1.5 bg-vetted-primary text-white rounded text-sm font-medium disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <button
                  onClick={() => { setShowUploadForm(false); setUploadFile(null); setUploadName(''); }}
                  className="px-3 py-1.5 border border-vetted-border rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {templates.length === 0 ? (
            <div className="p-6 text-center text-sm text-vetted-text-muted border border-dashed border-vetted-border rounded-lg">
              You don't have any templates yet. Use the Upload button above to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map(t => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  actions={
                    <>
                      <button onClick={() => setPreviewId(t.id)} title="Preview" className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted">
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={() => { setRenameId(t.id); setRenameDraft(t.name); }}
                        title="Rename"
                        className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted"
                      >
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleReplace(t)} title="Replace" className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted">
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={() => { setApplyForId(t.id); setApplyForName(t.name); }}
                        title="Apply to project…"
                        className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted"
                      >
                        <Send size={14} />
                      </button>
                      <button
                        onClick={() => handleArchiveToggle(t)}
                        title={t.status === 'active' ? 'Archive' : 'Restore'}
                        className="p-1.5 hover:bg-vetted-surface rounded text-vetted-text-muted"
                      >
                        {t.status === 'active' ? <Archive size={14} /> : <ArchiveRestore size={14} />}
                      </button>
                      <button onClick={() => setConfirmDeleteId(t.id)} title="Delete" className="p-1.5 hover:bg-red-50 rounded text-vetted-text-muted hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          )}

          <button
            onClick={() => setShowArchived(s => !s)}
            className="mt-3 text-xs text-vetted-text-muted hover:text-vetted-primary"
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
        </section>

        {/* Existing token extraction UI continues below — unchanged */}

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

        <PreviewModal templateId={previewId} onClose={() => setPreviewId(null)} />

        {renameId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setRenameId(null); setRenameDraft(''); }}>
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-medium text-vetted-primary mb-3">Rename template</h3>
              <input
                type="text"
                value={renameDraft}
                onChange={e => setRenameDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
                autoFocus
                className="w-full px-3 py-1.5 border border-vetted-border rounded text-sm mb-4"
                placeholder="Template name"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setRenameId(null); setRenameDraft(''); }} className="px-3 py-1.5 border border-vetted-border rounded text-sm">Cancel</button>
                <button
                  onClick={handleRename}
                  disabled={!renameDraft.trim()}
                  className="px-3 py-1.5 bg-vetted-primary text-white rounded text-sm font-medium disabled:opacity-50"
                >
                  Rename
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmDeleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmDeleteId(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-medium text-vetted-primary mb-2">Delete this template?</h3>
              <p className="text-sm text-vetted-text-secondary mb-4">This cannot be undone.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1.5 border border-vetted-border rounded text-sm">Cancel</button>
                <button onClick={() => handleDelete(confirmDeleteId)} className="px-3 py-1.5 bg-red-500 text-white rounded text-sm">Delete</button>
              </div>
            </div>
          </div>
        )}

        {applyForId && (
          <ProjectPickerModal
            templateId={applyForId}
            templateName={applyForName}
            onClose={() => { setApplyForId(null); setApplyForName(''); }}
            onApplied={() => addToast({ type: 'success', title: 'Applied to project' })}
          />
        )}
      </div>
    </div>
  );
}
