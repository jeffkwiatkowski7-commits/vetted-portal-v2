import { useState } from 'react';
import { FileText, FileSpreadsheet, Download, Loader2, Check } from 'lucide-react';
import * as api from '../../api';
import type { MessageAttachment as MessageAttachmentType } from '../../types';

interface Props {
  attachment: MessageAttachmentType;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function MessageAttachment({ attachment }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState(attachment.library_visible);

  const isExcel = attachment.mime_type === XLSX_MIME || attachment.filename.toLowerCase().endsWith('.xlsx');
  const isWord = attachment.mime_type === DOCX_MIME || attachment.filename.toLowerCase().endsWith('.docx');

  const Icon = isExcel ? FileSpreadsheet : FileText;
  const accentClass = isExcel ? 'text-emerald-600 bg-emerald-50' : isWord ? 'text-blue-600 bg-blue-50' : 'text-vetted-text-secondary bg-vetted-surface';

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await api.library.downloadAsBlob(attachment.id, attachment.filename);
    } catch (err) {
      console.error('[MessageAttachment] download failed:', err);
      alert(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handlePromote = async () => {
    setPromoting(true);
    try {
      await api.library.promoteToLibrary(attachment.id);
      setPromoted(true);
    } catch (err) {
      console.error('[MessageAttachment] promote failed:', err);
      alert(err instanceof Error ? err.message : 'Could not add to Library');
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-3 rounded-xl border border-vetted-border bg-white px-3 py-2.5 shadow-sm hover:shadow-md transition-shadow max-w-md">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accentClass}`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-vetted-text-primary truncate">{attachment.filename}</div>
        <div className="text-xs text-vetted-text-muted">
          {isExcel ? 'Excel spreadsheet' : isWord ? 'Word document' : 'File'}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-1 rounded-lg border border-vetted-border px-2.5 py-1.5 text-xs font-medium text-vetted-text-primary hover:bg-vetted-surface disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          title="Download"
        >
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          <span>Download</span>
        </button>
        {promoted ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
            <Check size={13} />
            In Library
          </span>
        ) : (
          <button
            type="button"
            onClick={handlePromote}
            disabled={promoting}
            className="inline-flex items-center gap-1 rounded-lg bg-vetted-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-vetted-accent-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            title="Save to your Library"
          >
            {promoting && <Loader2 size={13} className="animate-spin" />}
            <span>Add to Library</span>
          </button>
        )}
      </div>
    </div>
  );
}
