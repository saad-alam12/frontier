import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// macOS gets a translucent sidebar and an inset title bar (backend/main.ts); the CSS needs to know.
document.documentElement.classList.toggle('is-mac', navigator.userAgent.includes('Mac OS X'));

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
