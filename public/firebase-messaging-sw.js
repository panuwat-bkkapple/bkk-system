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
  const notificationTitle = payload.notification?.title || 'BKK Admin';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/vite.svg',
    badge: '/vite.svg',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click - focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const jobId = event.notification.data?.jobId;
  const targetUrl = jobId ? `/workspace/${jobId}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        const client = clientList[0];
        if (jobId) client.navigate(targetUrl);
        return client.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
