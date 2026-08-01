// Shape + labels for settings/notifications (หน้า /notification-settings).
//
// **MIRROR:** categories, channel keys and the fail-open default are duplicated
// in `functions/notification-settings.js`, which is what actually gates the
// sends (functions is plain JS and cannot import this file). Adding a category
// or channel = edit BOTH files, and map the push `data.type` on the server side.
//
// Fail-open contract: only an explicit `false` disables a notification. Nothing
// written yet = everything on, which is exactly how the system behaved before
// these switches existed.

export const NOTIFICATION_SETTINGS_PATH = 'settings/notifications';

export type NotificationChannelKey = 'admin_push' | 'rider_push' | 'telegram';
export type NotificationEventKey =
  | 'new_ticket'
  | 'status_change'
  | 'chat_message'
  | 'approval'
  | 'field_ops'
  | 'system_alert';

export interface NotificationSettings {
  channels: Record<NotificationChannelKey, boolean>;
  events: Record<NotificationEventKey, boolean>;
}

export interface NotificationOptionMeta<K extends string> {
  key: K;
  label: string;
  description: string;
}

export const NOTIFICATION_CHANNELS: NotificationOptionMeta<NotificationChannelKey>[] = [
  {
    key: 'admin_push',
    label: 'Push แอดมิน',
    description: 'แจ้งเตือนเด้งบนเครื่องแอดมินทุกคน (แอปมือถือ + เดสก์ท็อป + คอนโซลแชท) · ปิด = เงียบทั้งทีม',
  },
  {
    key: 'rider_push',
    label: 'Push ไรเดอร์',
    description: 'แจ้งเตือนที่ส่งเข้าแอปไรเดอร์ เช่น ถูกถอนงาน เลื่อนนัด จุดรับเครื่องเปลี่ยน',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    description: 'ช่องทางสำรองที่ส่งเข้ากลุ่ม Telegram (งานใหม่ + สถานะเปลี่ยน) · ใช้ได้เมื่อตั้ง Secret ครบแล้วเท่านั้น',
  },
];

export const NOTIFICATION_EVENTS: NotificationOptionMeta<NotificationEventKey>[] = [
  {
    key: 'new_ticket',
    label: 'งานใหม่เข้าระบบ',
    description: 'ลูกค้าสั่งขายเข้ามา หรือแอดมินเปิดงานใหม่ (New Lead / Active Leads / New B2B Lead)',
  },
  {
    key: 'status_change',
    label: 'สถานะงานเปลี่ยน',
    description: 'งานถูกยกเลิก ส่งคืน ต่อรองราคา หรือเลื่อนไปสถานะที่ต้องรีบดู',
  },
  {
    key: 'chat_message',
    label: 'ข้อความแชท',
    description: 'ลูกค้าหรือไรเดอร์ทักเข้ามาในแชทของงาน',
  },
  {
    key: 'approval',
    label: 'ข้อเสนอ / รออนุมัติ',
    description: 'Offer ที่รอ CEO/MANAGER อนุมัติ, ผลอนุมัติกลับไปหาผู้เสนอ, คำขอแก้ไขงานของไรเดอร์',
  },
  {
    key: 'field_ops',
    label: 'งานภาคสนาม / ไรเดอร์',
    description: 'ถอนงาน เลื่อนนัด จุดรับเครื่องเปลี่ยน งานค้างเกินกำหนด ไรเดอร์ถูก flag อัตโนมัติ',
  },
  {
    key: 'system_alert',
    label: 'แจ้งเตือนระบบ',
    description: 'เรื่องของระบบเอง เช่น โควตา Sickw IMEI ใกล้หมด',
  },
];

/** Normalize a raw RTDB snapshot into the full shape, defaulting to enabled. */
export const parseNotificationSettings = (raw: unknown): NotificationSettings => {
  const value = (raw || {}) as { channels?: Record<string, unknown>; events?: Record<string, unknown> };
  const channels = value.channels || {};
  const events = value.events || {};
  return {
    channels: NOTIFICATION_CHANNELS.reduce((acc, c) => {
      acc[c.key] = channels[c.key] !== false;
      return acc;
    }, {} as Record<NotificationChannelKey, boolean>),
    events: NOTIFICATION_EVENTS.reduce((acc, e) => {
      acc[e.key] = events[e.key] !== false;
      return acc;
    }, {} as Record<NotificationEventKey, boolean>),
  };
};
