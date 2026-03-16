import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function Modal({ isOpen, title, onClose, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card max-w-md w-full mx-4 animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-serif text-vetted-primary">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-vetted-surface rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div>{children}</div>
      </div>
    </div>
  );
}
