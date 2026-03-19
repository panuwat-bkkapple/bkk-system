import { useEffect } from 'react';
import { getFirebaseMessaging } from '../api/firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { ref, set } from 'firebase/database';
import { db } from '../api/firebase';

/**
 * Hook สำหรับลงทะเบียน FCM token ของแอดมิน
 * เก็บ token ไว้ที่ admin_fcm_tokens/{staffId}/{tokenKey}
 * รับ foreground messages แล้วแสดง Browser Notification
 */
export const useAdminPushNotifications = (staffId: string | null) => {
  useEffect(() => {
    if (!staffId) return;

    const setupPush = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        // Register unified service worker (handles both push + caching)
        let swRegistration: ServiceWorkerRegistration | undefined;
        if ('serviceWorker' in navigator) {
          swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
          await navigator.serviceWorker.ready;
        }

        const messaging = await getFirebaseMessaging();
        if (!messaging) return;

        const token = await getToken(messaging, {
          vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined,
          serviceWorkerRegistration: swRegistration
        });

        if (token) {
          const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
          const tokenKey = btoa(token).slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
          await set(ref(db, `admin_fcm_tokens/${staffId}/${tokenKey}`), {
            token,
            device: isMobile ? 'mobile' : 'desktop',
            updated_at: Date.now()
          });
        }

        // Handle foreground messages from Cloud Functions
        onMessage(messaging, (payload) => {
          const data = payload.data || {};

          // ถ้าเป็น new_ticket + tab กำลัง focus → useNewTicketAlert จัดการแล้ว
          if (data.type === 'new_ticket' && document.hasFocus()) return;

          if (payload.notification) {
            new Notification(payload.notification.title || 'BKK Admin', {
              body: payload.notification.body,
              icon: '/icons/icon-192.png',
              tag: data.type === 'new_ticket' ? `ticket-${data.jobId}` : undefined,
            });
          }
        });
      } catch {
        // silently handled
      }
    };

    setupPush();
  }, [staffId]);
};
