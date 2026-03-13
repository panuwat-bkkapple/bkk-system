// Firebase Cloud Messaging Service Worker
// Handles background push notifications for admin panel

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

messaging.onBackgroundMessage((payload) => {
  // ไม่แสดง notification ซ้ำถ้า foreground handler จัดการแล้ว
  const data = payload.data || {};
  const isNewTicket = data.type === 'new_ticket';

  const notificationTitle = payload.notification?.title || (isNewTicket ? '📱 Ticket ใหม่!' : 'BKK Admin');
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/vite.svg',
    badge: '/vite.svg',
    tag: isNewTicket ? `ticket-${data.jobId}` : 'bkk-admin',
    data: data,
    vibrate: [200, 100, 200],
    requireInteraction: isNewTicket,
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

  // ถ้ากด "ปิด" ก็แค่ปิด notification
  if (action === 'dismiss') return;

  // กำหนด URL เป้าหมาย
  let targetUrl = '/';
  if (data.type === 'new_ticket') {
    targetUrl = '/tickets';
  } else if (data.jobId) {
    targetUrl = `/workspace/${data.jobId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // ถ้ามี window เปิดอยู่แล้ว → focus แล้ว navigate
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // ไม่มี window → เปิดใหม่
      return clients.openWindow(targetUrl);
    })
  );
});
