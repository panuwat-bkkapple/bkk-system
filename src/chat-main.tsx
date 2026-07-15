import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import ChatApp from './chat/ChatApp.tsx';

// Same stale-chunk recovery as main.tsx (see comments there) — the chat PWA
// on iOS caches chat.html just as aggressively.
const RELOAD_FLAG = 'bkk_chunk_reload_at';
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
  if (Date.now() - last < 30000) {
    console.error('[chunk] preload error within 30s of last reload — giving up to avoid loop', event);
    return;
  }
  sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatApp />
  </StrictMode>,
);
