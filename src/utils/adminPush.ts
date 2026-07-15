// Admin FCM push — shared client helpers.
//
// One implementation of the iOS-fragile getToken() dance, used by BOTH the
// background hook (useAdminPushNotifications) and the manual "Notification
// Status" panel, so the two can never drift. Also exposes a health read and
// the test-push callable that power the in-app diagnostic panel.

import { getToken, deleteToken } from 'firebase/messaging';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref, set, get } from 'firebase/database';
import { app, db, getFirebaseMessaging } from '../api/firebase';

// Stable per-browser id so token refreshes overwrite the same DB entry instead
// of leaving stale duplicates. MUST match the key the hook has always used.
const DEVICE_ID_KEY = 'bkk_admin_fcm_device_id';

export const getAdminDeviceId = (): string => {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 20);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};

// Temporarily patch window.atob so Firebase SDK can decode the padding-less
// base64url VAPID key inside getToken(). Restored by the returned cleanup fn.
const patchAtob = (): (() => void) => {
  const originalAtob = window.atob.bind(window);
  (window as unknown as { atob: typeof window.atob }).atob = (str: string) => {
    try {
      return originalAtob(str);
    } catch {
      const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
      return originalAtob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    }
  };
  return () => {
    window.atob = originalAtob;
  };
};

export interface AdminTokenHealth {
  permission: NotificationPermission | 'unsupported';
  swActive: boolean;
  hasToken: boolean;
  updatedAt: number | null;
  lastFailureAt: number | null;
  lastFailureCode: string | null;
  deviceLabel: 'mobile' | 'desktop' | string | null;
}

export async function readAdminTokenHealth(staffId: string): Promise<AdminTokenHealth> {
  const permission: NotificationPermission | 'unsupported' =
    'Notification' in window ? Notification.permission : 'unsupported';

  let swActive = false;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
      swActive = !!reg?.active;
    }
  } catch {
    // ignore — treated as inactive
  }

  const health: AdminTokenHealth = {
    permission,
    swActive,
    hasToken: false,
    updatedAt: null,
    lastFailureAt: null,
    lastFailureCode: null,
    deviceLabel: null,
  };

  try {
    const snap = await get(ref(db, `admin_fcm_tokens/${staffId}/${getAdminDeviceId()}`));
    const v = snap.val() as
      | { token?: string; updated_at?: number; last_failure_at?: number; last_failure_code?: string; device?: string }
      | null;
    if (v) {
      health.hasToken = !!v.token;
      health.updatedAt = v.updated_at ?? null;
      health.lastFailureAt = v.last_failure_at ?? null;
      health.lastFailureCode = v.last_failure_code ?? null;
      health.deviceLabel = v.device ?? null;
    }
  } catch {
    // best-effort read
  }

  return health;
}

export interface RefreshResult {
  ok: boolean;
  reason?: string;
  error?: string;
}

/**
 * (Re)register the admin FCM token for this device and write it to
 * admin_fcm_tokens/{staffId}/{deviceId} (a successful set() clears any
 * failure markers the Cloud Function stamped).
 *
 * force=true (or a stored last_failure_at) deletes the cached token first so
 * iOS PWA mints a fresh web-push endpoint instead of handing back the dead one.
 */
// `app` tags which PWA registered this token so the Cloud Function can route
// customer-chat pushes to the chat app only (dispatchAdminPush audience). The
// admin app and the standalone chat app (bkk-apple-chat) each register on
// their own origin — separate localStorage deviceId, separate token entry.
export async function refreshAdminPushToken(
  staffId: string,
  opts: { force?: boolean; app?: 'admin' | 'chat' } = {},
): Promise<RefreshResult> {
  if (!('Notification' in window)) return { ok: false, reason: 'unsupported' };

  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: `permission-${permission}` };

  const vapidKey = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim();
  if (!vapidKey) return { ok: false, reason: 'no-vapid' };

  let swRegistration: ServiceWorkerRegistration | undefined;
  if ('serviceWorker' in navigator) {
    swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) return { ok: false, reason: 'no-messaging' };

  const deviceId = getAdminDeviceId();

  // Force a clean re-subscription when asked, or when the Cloud Function has
  // stamped a delivery failure on the stored entry (iOS handed back a dead
  // token from cache).
  let force = opts.force === true;
  if (!force) {
    try {
      const snap = await get(ref(db, `admin_fcm_tokens/${staffId}/${deviceId}`));
      const existing = snap.val() as { last_failure_at?: number } | null;
      if (existing?.last_failure_at) force = true;
    } catch {
      // best-effort — fall through to a normal getToken
    }
  }
  if (force) {
    try {
      await deleteToken(messaging);
    } catch (e) {
      console.warn('[Push] deleteToken failed (continuing):', e);
    }
  }

  const restoreAtob = patchAtob();
  try {
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swRegistration });
    if (!token) return { ok: false, reason: 'empty-token' };
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    await set(ref(db, `admin_fcm_tokens/${staffId}/${deviceId}`), {
      token,
      device: isMobile ? 'mobile' : 'desktop',
      app: opts.app === 'chat' ? 'chat' : 'admin',
      updated_at: Date.now(),
    });
    console.log(`[Push] FCM token saved (${isMobile ? 'mobile' : 'desktop'})`);
    return { ok: true };
  } catch (err) {
    console.error('[Push] Failed to fetch FCM token:', err);
    return { ok: false, error: String(err) };
  } finally {
    restoreAtob();
  }
}

export interface TestPushResult {
  total: number;
  successCount: number;
  failureCount: number;
  results: { device: string; ok: boolean; code: string | null }[];
  message?: string;
}

// Ask the Cloud Function to push a test alert to this admin's own tokens and
// return the per-token delivery result (token-dead vs delivered-not-rendered).
export async function sendTestAdminPush(): Promise<TestPushResult> {
  const fn = httpsCallable<Record<string, never>, TestPushResult>(
    getFunctions(app, 'asia-southeast1'),
    'sendTestAdminPush',
  );
  const res = await fn({});
  return res.data;
}
