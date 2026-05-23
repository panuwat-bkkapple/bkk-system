// Firebase Cloud Messaging + Caching Service Worker
// Handles background push notifications AND offline caching

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyB4AMaQ2cAEj8zVkLpIOSIiW9CV_wzP7BQ',
  authDomain: 'bkk-apple-tradein.firebaseapp.com',
  projectId: 'bkk-apple-tradein',
  storageBucket: 'bkk-apple-tradein.firebasestorage.app',
  messagingSenderId: '786220636196',
  appId: '1:786220636196:web:91c95c2f9265d5f66ba0b1'
});

const messaging = firebase.messaging();

// =============================================================================
// Push Notifications (Background)
// =============================================================================

messaging.onBackgroundMessage((payload) => {
  // Cloud Functions send data-only messages (no top-level `notification`)
  // so iOS PWA does not auto-display a duplicate alongside this handler.
  const data = payload.data || {};
  const isNewTicket = data.type === 'new_ticket';
  const isStatusChange = data.type === 'status_change';
  const isChatMessage = data.type === 'chat_message';

  const notificationTitle = data.title || (isNewTicket ? '📱 Ticket ใหม่!' : 'BKK Admin');
  // Keep options to the iOS-PWA-supported subset (body, icon, badge, tag,
  // data). WebKit silently DROPS the notification when it encounters
  // unsupported fields like `actions`, `vibrate`, `requireInteraction`,
  // `renotify` — no error, no log, just nothing on screen. That mismatch is
  // exactly why the rider PWA (which has only used these five fields all
  // along) kept working while admin pushes silently disappeared after each
  // iOS Safari update tightened option validation.
  //
  // Android still gets vibration/sound via the FCM `android.notification`
  // block on the Cloud Function side (defaultVibrateTimings, defaultSound),
  // so removing them here only loses the desktop "เปิดดู / ปิด" buttons —
  // tapping the notification still opens the right page via notificationclick.
  const notificationOptions = {
    body: data.body || '',
    icon: '/android-chrome-192x192.png',
    badge: '/android-chrome-192x192.png',
    tag: isNewTicket ? `ticket-${data.jobId}` : isStatusChange ? `status-${data.jobId}` : isChatMessage ? `chat-${data.jobId}` : 'bkk-admin',
    data,
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Note: do not register a custom 'push' listener here. Firebase Messaging
// SDK already handles the push event and dispatches to onBackgroundMessage
// above. Adding a second listener risks showing a duplicate notification.

// Handle notification click - focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;

  if (action === 'dismiss') return;

  let targetUrl = '/mobile';
  if (data.type === 'new_ticket') {
    targetUrl = '/mobile';
  } else if (data.type === 'status_change' && data.jobId) {
    targetUrl = `/mobile/job/${data.jobId}`;
  } else if (data.type === 'chat_message' && data.jobId) {
    targetUrl = `/mobile/job/${data.jobId}`;
  } else if (data.jobId) {
    targetUrl = `/mobile/job/${data.jobId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// =============================================================================
// Caching (Offline Support)
// =============================================================================

// Bump CACHE_NAME whenever STATIC_ASSETS or critical SW logic changes —
// this forces stuck SWs to re-install on the next page load so admins who
// silently lost notifications get a clean state. Asset paths align with
// the favicon_io set referenced from manifest.json (PR #159).
const CACHE_NAME = 'bkk-system-v4';
const STATIC_ASSETS = [
  '/mobile',
  '/manifest.json',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
];

self.addEventListener('install', (event) => {
  // cache.addAll is atomic — a single 404 rejects the whole promise and the
  // install event fails, leaving the old SW (or no SW) active and silently
  // killing push notifications. The bkk-rider repo hit this exact bug
  // (rider PR #421df35). Add each asset individually with .catch so a missing
  // file only loses its own caching, not the entire install.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Failed to cache ${url}, continuing:`, err?.message || err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis') || url.hostname.includes('gstatic')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/mobile')))
  );
});
