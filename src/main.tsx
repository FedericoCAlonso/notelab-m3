import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initPwaUpdates } from './services/pwa/updateManager';
import './index.css';
import App from './App';

initPwaUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
