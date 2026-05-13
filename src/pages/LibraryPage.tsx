import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import * as api from '../api';
import {
  Upload,
  Download,
  Trash2,
  MoreHorizontal,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  FaFilePdf,
  FaFileWord,
  FaFileExcel,
  FaFilePowerpoint,
  FaFileImage,
  FaFileArchive,
  FaFileCode,
  FaFileAlt,
  FaFigma,
} from 'react-icons/fa';
import type { IconType } from 'react-icons';
import type { LibraryFile } from '../types';

export default function LibraryPage() {
  const { addToast } = useStore();
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [stats, setStats] = useState({ totalSize: 0, fileCount: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (col: 'name' | 'size' | 'date') => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir(col === 'name' ? 'asc' : 'desc');
    }
  };

  const sortArrow = (col: 'name' | 'size' | 'date') => {
    if (sortBy !== col) return <ArrowUpDown size={12} />;
    return sortDir === 'asc' ? <ArrowUp size={12} className="text-vetted-accent" /> : <ArrowDown size={12} className="text-vetted-accent" />;
  };
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadFileName, setUploadFileName] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      const data = await api.library.list();
      const libStats = await api.library.stats();
      setFiles(data);
      setStats(libStats);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to load files',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadFileName(file.name);
    setUploadProgress(0);

    try {
      await api.library.upload(file, undefined, (percent) => {
        setUploadProgress(percent);
      });
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(null), 1500);
      loadFiles();
      addToast({
        type: 'success',
        title: 'File uploaded',
      });
    } catch (err) {
      setUploadProgress(null);
      addToast({
        type: 'error',
        title: 'Upload failed',
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (fileId: string) => {
    if (!window.confirm('Delete this file?')) return;
    try {
      await api.library.delete(fileId);
      setFiles(files.filter((f) => f.id !== fileId));
      addToast({
        type: 'success',
        title: 'File deleted',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to delete file',
      });
    }
  };

  const getFileIcon = (type: string) => {
    const ext = type.toLowerCase().replace(/^\./, '');
    const map: { [key: string]: { Icon: IconType; color: string } } = {
      pdf: { Icon: FaFilePdf, color: 'text-red-600' },
      doc: { Icon: FaFileWord, color: 'text-blue-600' },
      docx: { Icon: FaFileWord, color: 'text-blue-600' },
      rtf: { Icon: FaFileWord, color: 'text-blue-600' },
      xls: { Icon: FaFileExcel, color: 'text-green-600' },
      xlsx: { Icon: FaFileExcel, color: 'text-green-600' },
      csv: { Icon: FaFileExcel, color: 'text-green-600' },
      ppt: { Icon: FaFilePowerpoint, color: 'text-orange-600' },
      pptx: { Icon: FaFilePowerpoint, color: 'text-orange-600' },
      key: { Icon: FaFilePowerpoint, color: 'text-orange-600' },
      jpg: { Icon: FaFileImage, color: 'text-purple-600' },
      jpeg: { Icon: FaFileImage, color: 'text-purple-600' },
      png: { Icon: FaFileImage, color: 'text-purple-600' },
      gif: { Icon: FaFileImage, color: 'text-purple-600' },
      svg: { Icon: FaFileImage, color: 'text-purple-600' },
      webp: { Icon: FaFileImage, color: 'text-purple-600' },
      fig: { Icon: FaFigma, color: 'text-pink-600' },
      sketch: { Icon: FaFigma, color: 'text-pink-600' },
      zip: { Icon: FaFileArchive, color: 'text-yellow-600' },
      tar: { Icon: FaFileArchive, color: 'text-yellow-600' },
      gz: { Icon: FaFileArchive, color: 'text-yellow-600' },
      json: { Icon: FaFileCode, color: 'text-amber-600' },
      js: { Icon: FaFileCode, color: 'text-amber-600' },
      ts: { Icon: FaFileCode, color: 'text-amber-600' },
      tsx: { Icon: FaFileCode, color: 'text-amber-600' },
      jsx: { Icon: FaFileCode, color: 'text-amber-600' },
      py: { Icon: FaFileCode, color: 'text-amber-600' },
      html: { Icon: FaFileCode, color: 'text-amber-600' },
      css: { Icon: FaFileCode, color: 'text-amber-600' },
      txt: { Icon: FaFileAlt, color: 'text-vetted-text-secondary' },
      md: { Icon: FaFileAlt, color: 'text-vetted-text-secondary' },
    };
    const { Icon, color } = map[ext] || { Icon: FaFileAlt, color: 'text-vetted-text-secondary' };
    return <Icon size={18} className={color} />;
  };

  const filtered = files.filter((f) =>
    f.original_name.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortBy) {
      case 'name':
        return a.original_name.localeCompare(b.original_name) * dir;
      case 'size':
        return (a.file_size - b.file_size) * dir;
      case 'date':
      default:
        return (new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime()) * dir;
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-vetted-text-secondary">Loading library...</p>
      </div>
    );
  }

  const STORAGE_LIMIT = 50 * 1024 * 1024; // 50 MB
  const sizeInMB = (stats.totalSize / (1024 * 1024)).toFixed(1);
  const limitInMB = (STORAGE_LIMIT / (1024 * 1024)).toFixed(0);
  const storagePercent = Math.min((stats.totalSize / STORAGE_LIMIT) * 100, 100);
  const selectedSize = selected.reduce((sum, id) => {
    const file = files.find((f) => f.id === id);
    return sum + (file?.file_size || 0);
  }, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-vetted-border p-6 space-y-4">
        <div>
          <h1 className="text-3xl font-serif text-vetted-primary mb-2">Library</h1>
          <p className="text-vetted-text-secondary">
            {sizeInMB} MB of {limitInMB} MB used · {stats.fileCount} files
          </p>
          {/* Storage Meter */}
          <div className="mt-3 bg-vetted-surface rounded-full h-2">
            <div
              className="bg-vetted-accent h-full rounded-full"
              style={{ width: `${storagePercent}%` }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex gap-4 items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search
              size={18}
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-vetted-text-muted"
            />
            <input
              type="text"
              placeholder="Search files..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-vetted-border rounded-lg focus:outline-none focus:ring-2 focus:ring-vetted-accent input-field"
            />
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadProgress !== null && uploadProgress < 100}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            <Upload size={18} />
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleUpload}
            hidden
          />
        </div>

        {/* Upload Progress */}
        {uploadProgress !== null && (
          <div className="bg-vetted-surface rounded-lg p-4 border border-vetted-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-vetted-primary truncate mr-4">
                {uploadProgress < 100 ? 'Uploading' : 'Complete'}: {uploadFileName}
              </span>
              <span className="text-sm font-medium text-vetted-accent whitespace-nowrap">
                {Math.round(uploadProgress)}%
              </span>
            </div>
            <div className="bg-vetted-border rounded-full h-2 overflow-hidden">
              <div
                className="bg-vetted-accent h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Bulk Actions */}
      {selected.length > 0 && (
        <div className="bg-vetted-surface p-4 flex items-center justify-between border-b border-vetted-border">
          <span className="text-sm font-medium">
            {selected.length} file{selected.length !== 1 ? 's' : ''} selected ({(selectedSize / 1024).toFixed(1)} KB)
          </span>
          <div className="flex gap-2">
            <button className="btn-secondary flex items-center gap-2 text-sm">
              <Download size={16} />
              Download
            </button>
            <button
              onClick={() => {
                selected.forEach((id) => handleDelete(id));
                setSelected([]);
              }}
              className="btn-danger flex items-center gap-2 text-sm"
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* File Table */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Upload size={48} className="mx-auto text-vetted-text-muted mb-4 opacity-50" />
              <p className="text-vetted-text-secondary">No files uploaded yet</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1 p-4">
            {/* Headers */}
            <div className="flex items-center gap-4 px-4 py-2 text-xs font-medium text-vetted-text-muted border-b border-vetted-border">
              <input
                type="checkbox"
                checked={selected.length === sorted.length}
                onChange={(e) =>
                  setSelected(e.target.checked ? sorted.map((f) => f.id) : [])
                }
                className="w-4 h-4"
              />
              <button type="button" className="flex-1 flex items-center gap-2 cursor-pointer text-left hover:text-vetted-primary transition-colors" onClick={() => toggleSort('name')}>
                Name {sortArrow('name')}
              </button>
              <button type="button" className="w-20 text-right cursor-pointer flex items-center justify-end gap-2 hover:text-vetted-primary transition-colors" onClick={() => toggleSort('size')}>
                Size {sortArrow('size')}
              </button>
              <button type="button" className="w-32 cursor-pointer flex items-center gap-2 hover:text-vetted-primary transition-colors" onClick={() => toggleSort('date')}>
                Date {sortArrow('date')}
              </button>
              <div className="w-10" />
            </div>

            {/* Files */}
            {sorted.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-vetted-surface transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(file.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelected([...selected, file.id]);
                    } else {
                      setSelected(selected.filter((id) => id !== file.id));
                    }
                  }}
                  className="w-4 h-4"
                />

                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {getFileIcon(file.file_type)}
                  <span className="text-sm font-medium text-vetted-primary truncate">
                    {file.original_name}
                  </span>
                </div>

                <span className="text-sm text-vetted-text-muted w-20 text-right">
                  {(file.file_size / 1024).toFixed(1)} KB
                </span>

                <span className="text-sm text-vetted-text-muted w-32">
                  {new Date(file.uploaded_at).toLocaleDateString()}
                </span>

                <div className="flex gap-1">
                  <button
                    onClick={() =>
                      api.library.downloadAsBlob(file.id, file.original_name).catch((err) =>
                        alert(err instanceof Error ? err.message : 'Download failed')
                      )
                    }
                    className="p-1.5 hover:bg-white rounded transition-colors text-vetted-text-secondary hover:text-vetted-primary"
                    title="Download"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(file.id)}
                    className="p-1.5 hover:bg-red-50 rounded transition-colors text-vetted-text-secondary hover:text-vetted-danger"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
