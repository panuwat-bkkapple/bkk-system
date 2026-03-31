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
        // ตรวจสอบ browser รองรับ notification หรือไม่
        if (!('Notification' in window)) {
          console.warn('[Push] Browser does not support notifications');
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.warn('[Push] Notification permission denied');
          return;
        }

        // Register unified service worker (handles both push + caching)
        let swRegistration: ServiceWorkerRegistration | undefined;
        if ('serviceWorker' in navigator) {
          swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
          await navigator.serviceWorker.ready;
        }

        const messaging = await getFirebaseMessaging();
        if (!messaging) {
          console.warn('[Push] Firebase Messaging not supported on this browser');
          return;
        }

        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim();
        if (!vapidKey) {
          console.error('[Push] VITE_FIREBASE_VAPID_KEY is not set! Push notifications will not work.');
          return;
        }

        // Patch window.atob ชั่วคราว เพื่อให้ Firebase SDK decode VAPID key ได้
        // Firebase SDK ใช้ atob() ภายใน getToken() แต่ VAPID key เป็น base64url ไม่มี padding
        const originalAtob = window.atob.bind(window);
        (window as any).atob = (str: string) => {
          try {
            return originalAtob(str);
          } catch {
            // Fallback: เติม padding + แปลง base64url → base64
            const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
            const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
            return originalAtob(base64);
          }
        };

        let token: string | null = null;
        try {
          token = await getToken(messaging, {
            vapidKey,
            serviceWorkerRegistration: swRegistration,
          });
        } finally {
          // Restore original atob
          window.atob = originalAtob;
        }

        if (token) {
          const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
          const tokenKey = token.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
          await set(ref(db, `admin_fcm_tokens/${staffId}/${tokenKey}`), {
            token,
            device: isMobile ? 'mobile' : 'desktop',
            updated_at: Date.now()
          });
          console.log(`[Push] FCM token registered (${isMobile ? 'mobile' : 'desktop'})`);
        } else {
          console.warn('[Push] Failed to get FCM token');
        }

        // Handle foreground messages from Cloud Functions
        onMessage(messaging, (payload) => {
          const data = payload.data || {};

          // ถ้าเป็น new_ticket + tab กำลัง focus → useNewTicketAlert จัดการแล้ว
          if (data.type === 'new_ticket' && document.hasFocus()) return;

          if (payload.notification) {
            const tag = data.type === 'new_ticket' ? `ticket-${data.jobId}`
              : data.type === 'status_change' ? `status-${data.jobId}`
              : data.type === 'chat_message' ? `chat-${data.jobId}`
              : undefined;
            new Notification(payload.notification.title || 'BKK Admin', {
              body: payload.notification.body,
              icon: '/icons/icon-192.png',
              tag,
            });
          }
        });
      } catch (err) {
        console.error('[Push] Failed to setup push notifications:', err);
      }
    };

    setupPush();
  }, [staffId]);
};
