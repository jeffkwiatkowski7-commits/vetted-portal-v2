import React, { useEffect, useState } from 'react';
import { X, Folder } from 'lucide-react';
import * as api from '../../api';

interface Project {
  id: string;
  name: string;
  pptx_template_id?: string | null;
}

interface Props {
  templateId: string;
  templateName: string;
  onClose: () => void;
  onApplied: () => void;
}

export default function ProjectPickerModal({ templateId, templateName, onClose, onApplied }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmFor, setConfirmFor] = useState<Project | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    api.projects.list()
      .then((data: any) => setProjects(data.projects || data || []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  const apply = async (proj: Project) => {
    setApplying(true);
    try {
      await api.projects.update(proj.id, { pptx_template_id: templateId });
      onApplied();
      onClose();
    } catch (e) {
      alert(`Failed: ${(e as Error).message}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-vetted-border">
          <h3 className="text-base font-medium text-vetted-primary">Apply to Project</h3>
          <button onClick={onClose} className="p-1 hover:bg-vetted-surface rounded-lg">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-vetted-border">
          {loading ? (
            <p className="text-sm text-vetted-text-muted text-center py-8">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-vetted-text-muted text-center py-8">No projects.</p>
          ) : projects.map((proj) => {
            const alreadyBranded = !!proj.pptx_template_id;
            return (
              <button
                key={proj.id}
                onClick={() => setConfirmFor(proj)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-vetted-surface text-left"
              >
                <Folder size={16} className="text-vetted-text-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{proj.name}</p>
                  {alreadyBranded && (
                    <p className="text-xs text-vetted-text-muted">Currently branded — will be replaced</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {confirmFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h4 className="text-base font-medium text-vetted-primary mb-2">Confirm</h4>
            <p className="text-sm text-vetted-text-secondary mb-5">
              Apply "{templateName}" as the branding template for project "{confirmFor.name}"?
              {confirmFor.pptx_template_id && ' This replaces the current template.'}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmFor(null)} className="btn-secondary text-sm py-1.5 px-3">Cancel</button>
              <button
                onClick={() => apply(confirmFor)}
                disabled={applying}
                className="btn-primary text-sm py-1.5 px-3"
              >
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
