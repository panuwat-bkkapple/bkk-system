import { useEffect } from 'react';
import { getFirebaseMessaging } from '../api/firebase';
import { onMessage } from 'firebase/messaging';
import { refreshAdminPushToken } from '../utils/adminPush';

// FCM tokens on iOS PWA can silently expire after weeks/months. We re-validate
// on visibility change (cheap) and every 12h while the app stays open. The
// actual getToken()/save logic lives in utils/adminPush.refreshAdminPushToken
// so the manual "Notification Status" panel shares the exact same code path.
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * Hook สำหรับลงทะเบียน FCM token ของแอดมิน
 * เก็บ token ไว้ที่ admin_fcm_tokens/{staffId}/{deviceId}
 * รับ foreground messages แล้วแสดง Browser Notification
 *
 * Token freshness: re-fetched on app mount, visibility change → visible, and
 * every 12h. refreshAdminPushToken() force-deletes a failing token (when the
 * Cloud Function stamped last_failure_at) before re-registering, so an iOS PWA
 * that lost its web-push subscription recovers on the next visit.
 */
export const useAdminPushNotifications = (staffId: string | null) => {
  useEffect(() => {
    if (!staffId) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let visibilityHandler: (() => void) | null = null;
    let cancelled = false;

    const refresh = async () => {
      if (cancelled) return;
      try {
        await refreshAdminPushToken(staffId);
      } catch (err) {
        console.error('[Push] token refresh failed:', err);
      }
    };

    const setupPush = async () => {
      try {
        if (!('Notification' in window)) {
          console.warn('[Push] Browser does not support notifications');
          return;
        }

        // Only prompt when the user hasn't decided yet. Re-calling
        // requestPermission() on every mount re-asks on iOS and is fragile;
        // once granted we re-use the grant and just refresh the token.
        let permission = Notification.permission;
        if (permission === 'default') {
          permission = await Notification.requestPermission();
        }
        if (permission !== 'granted') {
          console.warn('[Push] Notification permission not granted:', permission);
          return;
        }

        const messaging = await getFirebaseMessaging();
        if (!messaging) {
          console.warn('[Push] Firebase Messaging not supported on this browser');
          return;
        }

        // Register + save the token (refreshAdminPushToken registers the SW and
        // runs the iOS atob-patched getToken dance internally).
        await refresh();

        intervalId = setInterval(refresh, REFRESH_INTERVAL_MS);

        visibilityHandler = () => {
          if (document.visibilityState === 'visible') {
            refresh();
          }
        };
        document.addEventListener('visibilitychange', visibilityHandler);

        // Handle foreground messages from Cloud Functions
        onMessage(messaging, (payload) => {
          const data = payload.data || {};

          // ถ้าเป็น new_ticket + tab กำลัง focus → useNewTicketAlert จัดการแล้ว
          if (data.type === 'new_ticket' && document.hasFocus()) return;

          // All Cloud Functions in this codebase send data-only messages (no
          // top-level `notification` field) so the SW's onBackgroundMessage
          // can render the iOS-PWA-compatible notification itself. The old
          // `if (payload.notification)` guard here meant foreground messages
          // silently dropped because that field is always undefined for our
          // payloads. Build the foreground notification from `data` to match.
          if (data.title || data.body) {
            const tag =
              data.type === 'new_ticket' ? `ticket-${data.jobId}`
                : data.type === 'status_change' ? `status-${data.jobId}`
                  : data.type === 'chat_message' ? `chat-${data.jobId}`
                    : undefined;
            new Notification(data.title || 'BKK Admin', {
              body: data.body || '',
              icon: '/android-chrome-192x192.png',
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
