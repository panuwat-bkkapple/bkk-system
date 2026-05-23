import { useEffect } from 'react';
import { getFirebaseMessaging } from '../api/firebase';
import { getToken, onMessage, deleteToken, type Messaging } from 'firebase/messaging';
import { ref, set, get } from 'firebase/database';
import { db } from '../api/firebase';

// Stable per-browser identifier so token refreshes overwrite the same DB entry
// instead of creating new ones. Without this each Service Worker reinstall left
// the old token entry behind and admin received duplicate push per order.
const getDeviceId = (): string => {
  const KEY = 'bkk_admin_fcm_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 20);
    localStorage.setItem(KEY, id);
  }
  return id;
};

// FCM tokens on iOS PWA can silently expire after weeks/months. We re-validate
// on visibility change (cheap) and every 12h while the app stays open.
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * Hook สำหรับลงทะเบียน FCM token ของแอดมิน
 * เก็บ token ไว้ที่ admin_fcm_tokens/{staffId}/{deviceId}
 * รับ foreground messages แล้วแสดง Browser Notification
 *
 * Token freshness: re-fetched on app mount, visibility change → visible, and
 * every 12h. If FCM rotates the token we overwrite the same RTDB entry; the
 * previous entry under a different deviceId would have been cleaned up by
 * pushToRider/dispatchAdminPush as soon as FCM returned not-registered.
 */
export const useAdminPushNotifications = (staffId: string | null) => {
  useEffect(() => {
    if (!staffId) return;

    let messagingInstance: Messaging | null = null;
    let swRegistration: ServiceWorkerRegistration | undefined;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let visibilityHandler: (() => void) | null = null;
    let cancelled = false;

    const saveToken = async (token: string) => {
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      const deviceId = getDeviceId();
      const path = `admin_fcm_tokens/${staffId}/${deviceId}`;

      // Always write (no freshness skip). set() replaces the node so any
      // first_failure_at / last_failure_at stamped by dispatchAdminPush gets
      // cleared whenever the page successfully re-fetches a token. Keeping
      // the skip would leave stale failure markers in place across refreshes
      // — and the Cloud Function would keep treating the entry as failing.
      await set(ref(db, path), {
        token,
        device: isMobile ? 'mobile' : 'desktop',
        updated_at: Date.now(),
      });
      console.log(`[Push] FCM token saved (${isMobile ? 'mobile' : 'desktop'})`);
    };

    const fetchAndSaveToken = async () => {
      if (!messagingInstance || cancelled) return;
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim();
      if (!vapidKey) return;

      // If dispatchAdminPush has marked the stored token as failing, iOS PWA's
      // FCM SDK is almost certainly handing us back the same dead token from
      // its local cache. Force a clean re-subscription by deleting first —
      // the next getToken() will register a fresh web-push endpoint.
      let forceRefresh = false;
      try {
        const deviceId = getDeviceId();
        const snap = await get(ref(db, `admin_fcm_tokens/${staffId}/${deviceId}`));
        const existing = snap.val() as { last_failure_at?: number } | null;
        if (existing?.last_failure_at) forceRefresh = true;
      } catch {
        // best-effort — fall through and try a normal getToken
      }

      if (forceRefresh && messagingInstance) {
        try {
          await deleteToken(messagingInstance);
          console.log('[Push] Forced FCM token delete — Cloud Function reported delivery failures');
        } catch (e) {
          console.warn('[Push] deleteToken failed (continuing):', e);
        }
      }

      // Patch window.atob ชั่วคราว เพื่อให้ Firebase SDK decode VAPID key ได้
      // Firebase SDK ใช้ atob() ภายใน getToken() แต่ VAPID key เป็น base64url ไม่มี padding
      const originalAtob = window.atob.bind(window);
      (window as unknown as { atob: typeof window.atob }).atob = (str: string) => {
        try {
          return originalAtob(str);
        } catch {
          const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
          const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
          return originalAtob(base64);
        }
      };

      try {
        const token = await getToken(messagingInstance, {
          vapidKey,
          serviceWorkerRegistration: swRegistration,
        });
        if (token && !cancelled) {
          await saveToken(token);
        } else if (!token) {
          // getToken() can return null for transient reasons (SW not yet
          // activated, FCM endpoint hiccup, iOS PWA quirk). Don't delete the
          // stored token — dispatchAdminPush already prunes tokens that FCM
          // rejects with token-not-registered. Just log and retry next cycle.
          console.warn('[Push] getToken returned empty; keeping stored token, will retry');
        }
      } catch (err) {
        console.error('[Push] Failed to fetch FCM token:', err);
      } finally {
        window.atob = originalAtob;
      }
    };

    const setupPush = async () => {
      try {
        if (!('Notification' in window)) {
          console.warn('[Push] Browser does not support notifications');
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.warn('[Push] Notification permission denied');
          return;
        }

        if ('serviceWorker' in navigator) {
          swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
          await navigator.serviceWorker.ready;
        }

        const messaging = await getFirebaseMessaging();
        if (!messaging) {
          console.warn('[Push] Firebase Messaging not supported on this browser');
          return;
        }
        messagingInstance = messaging;

        await fetchAndSaveToken();

        intervalId = setInterval(fetchAndSaveToken, REFRESH_INTERVAL_MS);

        visibilityHandler = () => {
          if (document.visibilityState === 'visible') {
            fetchAndSaveToken();
          }
        };
        document.addEventListener('visibilitychange', visibilityHandler);

        // Handle foreground messages from Cloud Functions
        onMessage(messaging, (payload) => {
          const data = payload.data || {};

          // ถ้าเป็น new_ticket + tab กำลัง focus → useNewTicketAlert จัดการแล้ว
          if (data.type === 'new_ticket' && document.hasFocus()) return;

          if (payload.notification) {
            const tag =
              data.type === 'new_ticket' ? `ticket-${data.jobId}`
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

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [staffId]);
};
