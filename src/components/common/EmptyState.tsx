import React from 'lucide-react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  heading: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon: Icon, heading, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <Icon size={48} className="text-vetted-text-muted mb-4 opacity-50" />
      <h3 className="text-lg font-serif text-vetted-primary mb-2">{heading}</h3>
      <p className="text-vetted-text-secondary text-center mb-6">{description}</p>
      {action && (
        <button onClick={action.onClick} className="btn-primary">
          {action.label}
        </button>
      )}
    </div>
  );
}
