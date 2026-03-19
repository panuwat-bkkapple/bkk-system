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
  const data = payload.data || {};
  const isNewTicket = data.type === 'new_ticket';

  const notificationTitle = payload.notification?.title || (isNewTicket ? '📱 Ticket ใหม่!' : 'BKK Admin');
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: isNewTicket ? `ticket-${data.jobId}` : (data.type === 'chat_message' ? `chat-${data.jobId}` : 'bkk-admin'),
    data: data,
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: isNewTicket,
    renotify: true,
    actions: isNewTicket
      ? [
          { action: 'open', title: 'เปิดดู' },
          { action: 'dismiss', title: 'ปิด' },
        ]
      : [],
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click - focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;

  if (action === 'dismiss') return;

  let targetUrl = '/mobile';
  if (data.type === 'new_ticket') {
    targetUrl = '/mobile';
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

const CACHE_NAME = 'bkk-system-v2';
const STATIC_ASSETS = [
  '/mobile',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
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
