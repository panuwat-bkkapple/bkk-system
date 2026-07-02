import React from 'react';
import {
  Power, Monitor, Camera, Wifi, Usb, Volume2, Keyboard, Battery,
  CircleDot, Heart, Watch, ShieldCheck, Box, Package, Cpu, HardDrive,
  HelpCircle, type LucideIcon,
} from 'lucide-react';

// Icon registry for condition-set groups (assessment topics). The `icon`
// field stored on a condition group is a key into this map; the customer
// frontend (bkk-frontend-next `lib/conditionIcons.ts`) mirrors the SAME key
// set so both surfaces render the same glyph. Keep the two in sync.
export const CONDITION_ICONS: Record<string, LucideIcon> = {
  power: Power,
  screen: Monitor,
  camera: Camera,
  connectivity: Wifi,
  ports: Usb,
  audio: Volume2,
  keyboard: Keyboard,
  battery: Battery,
  crown: CircleDot,
  sensors: Heart,
  watch: Watch,
  shield: ShieldCheck,
  box: Box,
  accessories: Package,
  cpu: Cpu,
  storage: HardDrive,
  help: HelpCircle,
};

// Thai labels shown in the admin icon picker.
export const CONDITION_ICON_LABELS: Record<string, string> = {
  power: 'เปิดเครื่อง / ชาร์จ',
  screen: 'หน้าจอ',
  camera: 'กล้อง',
  connectivity: 'Wi-Fi / สัญญาณ',
  ports: 'พอร์ต / USB',
  audio: 'ลำโพง / ไมค์',
  keyboard: 'คีย์บอร์ด',
  battery: 'แบตเตอรี่',
  crown: 'ปุ่ม / Crown',
  sensors: 'เซ็นเซอร์',
  watch: 'นาฬิกา',
  shield: 'สภาพเครื่อง',
  box: 'กล่อง',
  accessories: 'อุปกรณ์',
  cpu: 'ชิป / ประสิทธิภาพ',
  storage: 'ความจุ / ที่เก็บข้อมูล',
  help: 'อื่นๆ',
};

export const CONDITION_ICON_KEYS: string[] = Object.keys(CONDITION_ICONS);

// Ordered keyword table for guessing an icon from a group title when the group
// has no explicit `icon` key (legacy / seeded data). Order matters — the first
// key whose keyword is found in the title wins. `ports` is checked before
// `connectivity` so "พอร์ต + Wi-Fi / Bluetooth" resolves to USB (matching the
// old hardcoded Mac screening), not Wi-Fi.
const KEYWORD_TABLE: Array<[string, string[]]> = [
  ['ports', ['พอร์ต', 'port', 'usb', 'thunderbolt', 'hdmi']],
  ['connectivity', ['wi-fi', 'wifi', 'บลูทูธ', 'bluetooth', 'สัญญาณ', 'เชื่อมต่อ', 'ซิม', 'sim', 'เครือข่าย', 'network']],
  ['camera', ['กล้อง', 'camera', 'เลนส์']],
  ['screen', ['หน้าจอ', 'จอ', 'ทัช', 'touch', 'screen', 'display']],
  ['audio', ['ลำโพง', 'เสียง', 'ไมโคร', 'ไมค์', 'audio', 'speaker', 'mic', 'sound']],
  ['keyboard', ['คีย์บอร์ด', 'แทร็ค', 'keyboard', 'trackpad', 'แป้นพิมพ์']],
  ['battery', ['แบต', 'battery']],
  ['sensors', ['เซ็นเซอร์', 'sensor', 'ชีพจร', 'heart']],
  ['crown', ['crown', 'ปุ่ม', 'button']],
  ['power', ['เปิดเครื่อง', 'เปิด', 'ชาร์จ', 'charge', 'power', 'บูต', 'boot']],
  ['watch', ['นาฬิกา', 'watch']],
  ['box', ['กล่อง', 'box']],
  ['accessories', ['อุปกรณ์', 'สายชาร์จ', 'accessor', 'อะแดปเตอร์']],
  ['shield', ['สภาพ', 'ตัวเครื่อง', 'ภายนอก', 'บอดี้', 'body', 'รอย', 'ตำหนิ']],
  ['cpu', ['ชิป', 'chip', 'cpu', 'ประสิทธิภาพ', 'performance']],
  ['storage', ['ความจุ', 'storage', 'ssd', 'disk', 'ฮาร์ด']],
];

/** Best-effort icon key from a free-text group title. Returns undefined when nothing matches. */
export function guessConditionIconKey(title?: string): string | undefined {
  if (!title) return undefined;
  const t = title.toLowerCase();
  for (const [key, words] of KEYWORD_TABLE) {
    if (words.some((w) => t.includes(w))) return key;
  }
  return undefined;
}

/**
 * Resolve a group's icon component: explicit `icon` key first, then a keyword
 * guess from the title, finally HelpCircle. Mirrored on the customer frontend.
 */
export function getConditionIcon(key?: string, title?: string): LucideIcon {
  if (key && CONDITION_ICONS[key]) return CONDITION_ICONS[key];
  const guessed = guessConditionIconKey(title);
  if (guessed && CONDITION_ICONS[guessed]) return CONDITION_ICONS[guessed];
  return HelpCircle;
}
