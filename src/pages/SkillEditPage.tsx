import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store';
import * as api from '../api';
import { ArrowLeft, Upload, X, FileText, Check } from 'lucide-react';
import type { Skill, LibraryFile } from '../types';

function LibraryPickerModal({
  selected,
  onClose,
  onConfirm,
}: {
  selected: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [checked, setChecked] = useState<string[]>(selected);

  useEffect(() => {
    api.library.list().then(setFiles).catch(() => {});
  }, []);

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-vetted-border">
          <h3 className="text-base font-medium text-vetted-primary">Select Files from Library</h3>
          <button onClick={onClose} className="p-1 hover:bg-vetted-surface rounded-lg">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-vetted-border">
          {files.length === 0 ? (
            <p className="text-sm text-vetted-text-muted text-center py-8">No files in library yet.</p>
          ) : (
            files.map((file) => (
              <label
                key={file.id}
                className="flex items-center gap-3 px-5 py-3 hover:bg-vetted-surface cursor-pointer"
              >
                <div
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    checked.includes(file.id)
                      ? 'bg-vetted-accent border-vetted-accent'
                      : 'border-vetted-border'
                  }`}
                >
                  {checked.includes(file.id) && <Check size={10} className="text-white" strokeWidth={3} />}
                </div>
                <input
                  type="checkbox"
                  hidden
                  checked={checked.includes(file.id)}
                  onChange={() => toggle(file.id)}
                />
                <FileText size={15} className="text-vetted-text-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{file.original_name}</p>
                  <p className="text-xs text-vetted-text-muted">{(file.file_size / 1024).toFixed(1)} KB</p>
                </div>
              </label>
            ))
          )}
        </div>
        <div className="flex gap-2 justify-end px-5 py-4 border-t border-vetted-border">
          <button onClick={onClose} className="btn-secondary text-sm py-1.5 px-3">
            Cancel
          </button>
          <button onClick={() => onConfirm(checked)} className="btn-primary text-sm py-1.5 px-3">
            Attach {checked.length > 0 ? `(${checked.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SkillEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useStore();
  const isNew = !id || id === 'new';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [attachedFileIds, setAttachedFileIds] = useState<string[]>([]);
  const [allFiles, setAllFiles] = useState<LibraryFile[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.library.list().then(setAllFiles).catch(() => {});
    if (!isNew) {
      api.skills
        .get(id!)
        .then((skill: Skill) => {
          setName(skill.name);
          setDescription(skill.description || '');
          setInstructions(skill.instructions);
          setAttachedFileIds((skill.files || []).map((f) => f.id));
        })
        .catch(() => {
          addToast({ type: 'error', title: 'Skill not found' });
          navigate('/skills');
        })
        .finally(() => setLoading(false));
    }
  }, [id]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.max(160, el.scrollHeight) + 'px';
    }
  }, [instructions]);

  const handleSave = async () => {
    if (!name.trim() || !instructions.trim()) {
      addToast({ type: 'warning', title: 'Name and instructions are required' });
      return;
    }
    setSaving(true);
    try {
      let skillId = id;
      if (isNew) {
        const created = await api.skills.create({ name, description, instructions });
        skillId = created.id;
      } else {
        await api.skills.update(id!, { name, description, instructions });
      }

      // Sync attached files
      const existing = isNew ? [] : ((await api.skills.get(skillId!)).files || []).map((f: LibraryFile) => f.id);
      const toAttach = attachedFileIds.filter((fid) => !existing.includes(fid));
      const toDetach = existing.filter((fid: string) => !attachedFileIds.includes(fid));
      for (const fid of toAttach) await api.skills.attachFile(skillId!, fid);
      for (const fid of toDetach) await api.skills.detachFile(skillId!, fid);

      addToast({ type: 'success', title: isNew ? 'Skill created' : 'Skill updated' });
      navigate('/skills');
    } catch {
      addToast({ type: 'error', title: 'Failed to save skill' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete skill "${name}"? This will remove it from all projects.`)) return;
    try {
      await api.skills.delete(id!);
      addToast({ type: 'success', title: 'Skill deleted' });
      navigate('/skills');
    } catch {
      addToast({ type: 'error', title: 'Failed to delete skill' });
    }
  };

  const attachedFiles = allFiles.filter((f) => attachedFileIds.includes(f.id));

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-vetted-text-muted">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate('/skills')}
            className="p-1.5 hover:bg-vetted-surface rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-serif font-bold text-vetted-primary">
            {isNew ? 'New Skill' : 'Edit Skill'}
          </h1>
        </div>

        <div className="space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-vetted-primary mb-1.5">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Code Reviewer, Legal Analyst"
              className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-vetted-primary mb-1.5">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of what this skill does"
              className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent"
            />
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-sm font-medium text-vetted-primary mb-1">
              Instructions <span className="text-red-400">*</span>
            </label>
            <p className="text-xs text-vetted-text-muted mb-1.5">
              This becomes part of the system prompt when the skill is active.
            </p>
            <textarea
              ref={textareaRef}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Describe how the AI should behave when this skill is active. Be specific — this becomes part of the system prompt."
              className="w-full px-3 py-2 text-sm border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent resize-none font-mono"
              style={{ minHeight: 160 }}
            />
          </div>

          {/* Attached Files */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <label className="text-sm font-medium text-vetted-primary">Attached Files</label>
                <p className="text-xs text-vetted-text-muted mt-0.5">
                  File content is injected into context when this skill is active.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLibrary(true)}
                className="flex items-center gap-1.5 text-xs text-vetted-accent hover:text-vetted-primary border border-vetted-accent/40 hover:border-vetted-accent px-2.5 py-1 rounded-lg transition-colors"
              >
                <Upload size={12} /> Browse Library
              </button>
            </div>
            {attachedFiles.length === 0 ? (
              <div className="px-3 py-3 border border-dashed border-vetted-border rounded-lg text-sm text-vetted-text-muted text-center">
                No files attached
              </div>
            ) : (
              <div className="border border-vetted-border rounded-lg divide-y divide-vetted-border">
                {attachedFiles.map((file) => (
                  <div key={file.id} className="flex items-center gap-3 px-3 py-2">
                    <FileText size={14} className="text-vetted-text-muted flex-shrink-0" />
                    <p className="text-sm flex-1 truncate">{file.original_name}</p>
                    <button
                      type="button"
                      onClick={() => setAttachedFileIds((prev) => prev.filter((fid) => fid !== file.id))}
                      className="p-0.5 hover:bg-vetted-surface rounded transition-colors"
                    >
                      <X size={13} className="text-vetted-text-muted" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-vetted-border">
          {!isNew ? (
            <button
              onClick={handleDelete}
              className="text-sm text-red-500 hover:text-red-600 transition-colors"
            >
              Delete skill
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button onClick={() => navigate('/skills')} className="btn-secondary text-sm py-1.5 px-4">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !instructions.trim()}
              className="bg-vetted-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-vetted-accent hover:text-vetted-primary disabled:opacity-50"
            >
              {saving ? 'Saving…' : isNew ? 'Create Skill' : 'Save Skill'}
            </button>
          </div>
        </div>
      </div>

      {showLibrary && (
        <LibraryPickerModal
          selected={attachedFileIds}
          onClose={() => setShowLibrary(false)}
          onConfirm={(ids) => {
            setAttachedFileIds(ids);
            setShowLibrary(false);
          }}
        />
      )}
    </div>
  );
}
