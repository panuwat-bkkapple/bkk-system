// =============================================================================
// Master on/off switches for every outgoing notification (settings/notifications)
//
// Before this existed, "ปิดการแจ้งเตือนแบบนี้" had no answer short of a deploy:
// push/Telegram fired unconditionally from ~20 call sites. Rather than thread a
// flag through all of them, we gate at the three dispatch helpers in index.js
// (dispatchAdminPush / pushToRider / dispatchTelegram) and key the decision off
// `message.data.type`, which every call site already sets.
//
// **MIRROR:** the category map + defaults are duplicated in
// `src/utils/notificationSettings.ts` (the admin UI) because functions is plain
// JS and cannot import the TS module. Adding an event type = edit BOTH files.
//
// FAIL-OPEN is deliberate everywhere: an unknown data.type, a missing settings
// node, or a read error must never silence a notification. Only an explicit
// `false` written by an admin turns something off.
// =============================================================================

const SETTINGS_PATH = "settings/notifications";

// Each container serves many triggers; re-reading a tiny config node on every
// push would add an RTDB round-trip to the hot path for no benefit (see the
// RTDB cost rules in CLAUDE.md). 30s is short enough that toggling in the UI
// takes effect while the admin is still looking at the page.
const CACHE_TTL_MS = 30 * 1000;

/** push `data.type` → category toggled in the UI. Types absent from this map
 *  are never gated (fail-open) — that covers `test` pushes and any new type
 *  added before its UI entry exists. */
const EVENT_CATEGORY = {
  new_ticket: "new_ticket",

  status_change: "status_change",
  order_status: "status_change",

  chat_message: "chat_message",

  offer_approval: "approval",
  customer_offer: "approval",
  amendment_requested: "approval",
  amendment_approved: "approval",
  amendment_rejected: "approval",
  amendment_applied: "approval",
  amendment_escalated: "approval",
  amendment_expired: "approval",

  job_withdrawn: "field_ops",
  appointment_rescheduled: "field_ops",
  pickup_location_changed: "field_ops",
  rider_overdue: "field_ops",
  rider_auto_flagged: "field_ops",

  sickw_usage_alert: "system_alert",

  dealer_bid: "dealer",
  dealer_lot: "dealer",
  dealer_payment: "dealer",
  dealer_order: "dealer",
  dealer_tier: "dealer",
  dealer_register: "dealer",
};

const CHANNELS = ["admin_push", "rider_push", "telegram"];
const CATEGORIES = [
  "new_ticket",
  "status_change",
  "chat_message",
  "approval",
  "field_ops",
  "system_alert",
  "dealer",
];

let cache = null; // { at: number, value: object }

/** Read settings/notifications with a short in-process cache.
 *  Returns `{}` on any failure so callers fall through to the enabled default. */
async function loadNotificationSettings(db) {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const snap = await db.ref(SETTINGS_PATH).once("value");
    const value = snap.val() || {};
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error("[notifySettings] read failed, defaulting to enabled:", err);
    return {};
  }
}

/** Test seam + a way for a trigger to force a re-read after writing. */
function clearNotificationSettingsCache() {
  cache = null;
}

function notificationCategory(type) {
  return EVENT_CATEGORY[type] || null;
}

/** Only an explicit `false` disables — undefined/null/anything else = enabled. */
function isChannelEnabled(settings, channel) {
  const channels = (settings && settings.channels) || {};
  return channels[channel] !== false;
}

function isEventEnabled(settings, type) {
  const category = notificationCategory(type);
  if (!category) return true; // unmapped type — never gate it
  const events = (settings && settings.events) || {};
  return events[category] !== false;
}

/** The single decision used by the dispatch helpers.
 *  @param {object} settings result of loadNotificationSettings
 *  @param {string} channel one of CHANNELS
 *  @param {object|null} message the FCM message (its `data.type` picks the event)
 *  @returns {{allowed: boolean, reason: string|null}} reason is for the log line */
function shouldNotify(settings, channel, message) {
  if (!isChannelEnabled(settings, channel)) {
    return { allowed: false, reason: `channel:${channel}` };
  }
  const type = message && message.data && message.data.type;
  if (type && !isEventEnabled(settings, type)) {
    return { allowed: false, reason: `event:${notificationCategory(type)}` };
  }
  return { allowed: true, reason: null };
}

module.exports = {
  SETTINGS_PATH,
  CHANNELS,
  CATEGORIES,
  EVENT_CATEGORY,
  loadNotificationSettings,
  clearNotificationSettingsCache,
  notificationCategory,
  isChannelEnabled,
  isEventEnabled,
  shouldNotify,
};
