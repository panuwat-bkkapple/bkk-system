import { useEffect } from 'react';
import { getFirebaseMessaging } from '../api/firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { ref, set } from 'firebase/database';
import { db } from '../api/firebase';

/**
 * แปลง base64url string เป็น Uint8Array โดยไม่ใช้ atob()
 * หลีกเลี่ยง InvalidCharacterError ที่เกิดกับ atob ใน browser บางตัว
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const lookup = new Uint8Array(128);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const len = base64.length;
  let bufLen = (len * 3) >> 2;
  if (base64[len - 1] === '=') bufLen--;
  if (base64[len - 2] === '=') bufLen--;

  const bytes = new Uint8Array(bufLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[base64.charCodeAt(i)];
    const b = lookup[base64.charCodeAt(i + 1)];
    const c = lookup[base64.charCodeAt(i + 2)];
    const d = lookup[base64.charCodeAt(i + 3)];
    bytes[p++] = (a << 2) | (b >> 4);
    if (p < bufLen) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < bufLen) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

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

        // Subscribe push ด้วย applicationServerKey ตรงๆ (bypass atob ของ Firebase SDK)
        if (swRegistration) {
          const existingSub = await swRegistration.pushManager.getSubscription();
          if (!existingSub) {
            await swRegistration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidKey),
            });
            console.log('[Push] PushManager subscribed with VAPID key');
          }
        }

        // getToken ไม่ต้องส่ง vapidKey อีก เพราะ subscribe ไปแล้ว
        const token = await getToken(messaging, {
          serviceWorkerRegistration: swRegistration,
        });

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
