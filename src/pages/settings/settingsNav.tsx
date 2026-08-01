import React from 'react';
import {
  Store, MapPin, Users, Calculator, Gift, PackageSearch, ClipboardList,
  Ticket, Bike, Settings, MessageSquareQuote, Bot, Share2, HandCoins, Bell
} from 'lucide-react';

// Single source of truth ของโครงเมนูตั้งค่า (Reusely-style 3 กลุ่ม):
// ใช้ทั้งหน้า hub (/settings), เมนูซ้ายใน SettingsLayout และการ gate ตาม role.
// เพิ่มหน้าตั้งค่าใหม่ = เพิ่ม 1 entry ที่นี่ (route จริงยังประกาศใน App.tsx)

export interface SettingsNavItem {
  path: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  /** role ที่เข้าได้ — ต้องตรงกับ gate ของ route ใน App.tsx */
  roles: string[];
  /** true = หน้า immersive เต็มจอ (ไม่ถูกครอบด้วย SettingsLayout) */
  fullWidth?: boolean;
}

export interface SettingsNavGroup {
  key: string;
  title: string;
  subtitle: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    key: 'company',
    title: 'Company Settings',
    subtitle: 'ข้อมูลบริษัท ทีมงาน และบัญชี',
    items: [
      { path: '/store-settings', label: 'ข้อมูลร้าน', description: 'เบอร์โทร LINE อีเมล เวลาทำการ (ค่ากลางของระบบ)', icon: <Store size={18} />, roles: ['CEO', 'MANAGER'] },
      { path: '/admin/branches', label: 'สาขา (Locations)', description: 'จัดการสาขา ที่อยู่ หมุดแผนที่ เวลาเปิด-ปิด', icon: <MapPin size={18} />, roles: ['CEO', 'MANAGER'] },
      { path: '/staff', label: 'พนักงาน (Users)', description: 'บัญชีพนักงาน role และสถานะการใช้งาน', icon: <Users size={18} />, roles: ['CEO'] },
      { path: '/accounting-settings', label: 'ระบบบัญชี & ใบกำกับภาษี', description: 'ข้อมูลนิติบุคคล VAT เลขรันใบกำกับ อีเมลเอกสาร', icon: <Calculator size={18} />, roles: ['CEO', 'FINANCE'] },
    ],
  },
  {
    key: 'basic',
    title: 'Basic Settings',
    subtitle: 'แคตตาล็อก ราคารับซื้อ และโปรโมชั่น',
    items: [
      { path: '/pricing', label: 'Catalog', description: 'รุ่นสินค้า ราคารับซื้อ วิธีรับซื้อ และสถานะความพร้อม', icon: <PackageSearch size={18} />, roles: ['CEO', 'MANAGER'], fullWidth: true },
      { path: '/pricing/condition-sets', label: 'Condition Sets', description: 'ชุดคำถามประเมินสภาพและค่าหักเงินของแต่ละรุ่น', icon: <ClipboardList size={18} />, roles: ['CEO', 'MANAGER'], fullWidth: true },
      { path: '/coupons', label: 'แคมเปญคูปอง (Offers)', description: 'สร้าง/แก้คูปองส่วนลด เงื่อนไขรุ่น และโควตา', icon: <Ticket size={18} />, roles: ['CEO', 'MANAGER'] },
      { path: '/rider-fee-promos', label: 'โปรส่วนลดค่าไรเดอร์', description: 'โปรโมชั่นลดค่าบริการรับเครื่องถึงบ้าน', icon: <Bike size={18} />, roles: ['CEO', 'MANAGER'] },
      { path: '/offer-settings', label: 'เสนอราคาเอง (Make Offer)', description: 'Master switch + เพดานรับอัตโนมัติ ของระบบลูกค้าเสนอราคา', icon: <HandCoins size={18} />, roles: ['CEO', 'MANAGER'] },
      { path: '/membership-settings', label: 'สมาชิก & สิทธิพิเศษ', description: 'การ์ดสิทธิประโยชน์สมาชิกที่โชว์ตอน checkout', icon: <Gift size={18} />, roles: ['CEO', 'MANAGER'] },
    ],
  },
  {
    key: 'advanced',
    title: 'Advanced Settings',
    subtitle: 'ค่าระบบส่วนกลาง และ AI',
    items: [
      { path: '/notification-settings', label: 'การแจ้งเตือน', description: 'ช่องทาง (Push/Telegram) เหตุการณ์ที่แจ้ง เกณฑ์เวลา และสถานะเครื่อง', icon: <Bell size={18} />, roles: ['CEO', 'MANAGER'] },
      { path: '/global-settings', label: 'ตั้งค่าระบบส่วนกลาง', description: 'ค่าส่งลูกค้า เรทค่าตอบแทนไรเดอร์ Sickw IMEI', icon: <Settings size={18} />, roles: ['CEO'] },
      { path: '/chat-settings', label: 'Chat Widget (AI)', description: 'ชื่อผู้ช่วย ป๊อปอัพชวนแชท เวลาทำการแชท', icon: <MessageSquareQuote size={18} />, roles: ['CEO', 'MANAGER'] },
      { path: '/ai-profile', label: 'โปรไฟล์ AI (Persona)', description: 'โทนการตอบ ความยาวคำตอบ ของ AI แชท', icon: <Bot size={18} />, roles: ['CEO', 'MANAGER'] },
      { path: '/chat-kb', label: 'คลังคำตอบ AI', description: 'ฐานความรู้ที่ AI ใช้ตอบลูกค้า', icon: <Share2 size={18} />, roles: ['CEO', 'MANAGER'] },
    ],
  },
];

export const visibleSettingsGroups = (role: string | undefined): SettingsNavGroup[] =>
  SETTINGS_NAV
    .map(g => ({ ...g, items: g.items.filter(i => role && i.roles.includes(role)) }))
    .filter(g => g.items.length > 0);
