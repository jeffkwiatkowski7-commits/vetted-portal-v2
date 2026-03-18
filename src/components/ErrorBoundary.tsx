import React from 'react';
import * as api from '../api';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: React.ErrorInfo) {
    if (!localStorage.getItem('userId')) return;
    api.admin.reportClientError({
      message: error.message,
      stack: error.stack,
      url: window.location.href,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4">
          <p className="text-vetted-primary text-lg">Something went wrong.</p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
