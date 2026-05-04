import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Vite emits this event when a code-split chunk fails to load — typically
// happens after a deploy when the user's cached index.html references a
// chunk hash the server no longer has (PWA on iOS is the worst offender).
// The new index returns 404 → browser tries to execute HTML as JS → MIME
// type error → blank page. One reload pulls fresh HTML + chunk URLs and
// the navigation just works. Use a flag so we don't reload-loop on a real
// network outage.
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
    <App />
  </StrictMode>,
)
