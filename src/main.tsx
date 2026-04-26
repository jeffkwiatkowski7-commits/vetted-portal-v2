import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import * as api from './api';
import './index.css';

window.addEventListener('error', (event) => {
  if (!localStorage.getItem('userId')) return;
  api.admin.reportClientError({
    message: String(event.message),
    stack: event.error?.stack,
    url: window.location.pathname,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  if (!localStorage.getItem('userId')) return;
  api.admin.reportClientError({
    message: String(event.reason),
    url: window.location.pathname,
  });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
