import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = document.getElementById('root');

function showStartupError(error: unknown) {
  if (!root) return;
  console.error('[WebOperator] Side panel startup failed', error);
  const message = document.createElement('p');
  message.role = 'alert';
  message.textContent = 'WebOperator could not load. Reload the extension and reopen this panel.';
  const detail = document.createElement('pre');
  detail.style.whiteSpace = 'pre-wrap';
  detail.textContent = error instanceof Error ? error.message : String(error);
  const retry = document.createElement('button');
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => window.location.reload());
  root.replaceChildren(message, detail, retry);
}

if (root) {
  void import('./App').then(({ App }) => {
    createRoot(root, { onUncaughtError: showStartupError }).render(<React.StrictMode><App /></React.StrictMode>);
  }).catch(showStartupError);
}
