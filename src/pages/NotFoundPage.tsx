import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-serif font-bold text-vetted-accent mb-4">404</p>
      <h1 className="text-2xl font-serif text-vetted-primary mb-2">Page not found</h1>
      <p className="text-vetted-text-secondary mb-8">The page you're looking for doesn't exist.</p>
      <button
        onClick={() => navigate('/')}
        className="btn-primary px-6"
      >
        Go home
      </button>
    </div>
  );
}
