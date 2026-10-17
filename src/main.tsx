import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { applyEmbeddedMode } from './utils/discordEmbed';
import './index.css';

// Adapt the page when launched from Discord's in-app (Embedded App) frame.
applyEmbeddedMode();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
