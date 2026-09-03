// ---------------------------------------------------------------------------
// ขอบเขตของ role HR ในระบบแอดมิน
//
// ปัญหาที่ไฟล์นี้แก้: route ในแอดมิน 28 เส้นทาง**ไม่มี guard เลย** (เช่น
// /tickets, /inventory, /crm, /customer-crm) — ค่าเริ่มต้นของแอปนี้คือ
// "พนักงานที่ล็อกอินแล้วเข้าได้" การเพิ่ม role ที่ 5 จึงแปลว่า HR ได้สิทธิ์
// ระดับ STAFF มาฟรีๆ รวมถึงฐานข้อมูลลูกค้า ซึ่งไม่มีใครขอและเป็นเรื่อง PDPA
//
// **นี่คือด่านระดับ UX ไม่ใช่ขอบเขตความปลอดภัย และต้องพูดให้ตรง** — database
// rules ยังให้สิทธิ์ตาม /admins/{uid} แบบเหมารวมเหมือนเดิม คนที่มี role HR
// เปิด devtools แล้วอ่าน RTDB ตรงได้เท่ากับ STAFF ทุกประการ การแยกสิทธิ์
// ระดับฐานข้อมูลตาม role เป็นงานของ P2 (พอร์ทัล HR แยกโดเมน) ซึ่งเป็นเหตุผล
// ที่พอร์ทัลแยกตั้งแต่แรก ไม่ใช่ของที่ค่อยมาเติมทีหลัง
//
// สิ่งที่ไฟล์นี้ทำได้จริงและมีค่า: บัญชี HR ที่เปิดขึ้นมาแล้วเจอ Tickets,
// POS, คลังสินค้า เต็มหน้าจอ คือคำเชิญให้ใช้ การไม่แสดงและไม่พาไปคือการบอกว่า
// อะไรเป็นงานของใคร
// ---------------------------------------------------------------------------

/** หน้าที่ role HR เปิดได้ — ทุกอย่างนอกลิสต์นี้ถูกพากลับไปที่ /employees */
// ตอนนี้มีหน้าเดียว — เฟสหลัง (เงินเดือน ลา ลงเวลา) จะเพิ่มที่นี่
// **ไม่ใส่ `/settings`** โดยตั้งใจ: ไม่มี entry ไหนใน settingsNav ที่ให้สิทธิ์
// HR หน้า hub จึงจะว่างเปล่า ซึ่งแย่กว่าการไม่พาไปเลย
export const HR_ALLOWED_PREFIXES = [
  '/employees',
  '/payroll',
  '/hr-settings',
];

/** หน้าแรกของ HR — ทะเบียนพนักงาน ไม่ใช่แดชบอร์ดรับซื้อ */
export const HR_HOME = '/employees';

export const isHrRole = (role: string | undefined | null): boolean =>
  String(role || '').toUpperCase() === 'HR';

/**
 * เส้นทางนี้อยู่ในขอบเขตของ HR ไหม
 *
 * เทียบแบบ prefix ที่ขอบเขตของ segment เท่านั้น — `startsWith('/employees')`
 * เปล่าๆ จะปล่อย `/employees-payroll-secret` ผ่านด้วย ซึ่งเป็นรูของ prefix
 * matching ที่คลาสสิกพอที่จะกันไว้ตั้งแต่บรรทัดแรก
 */
export const isPathInHrScope = (pathname: string): boolean => {
  const path = String(pathname || '');
  return HR_ALLOWED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`)
  );
};

/**
 * ต้องพาไปที่ไหนไหม — คืน path ปลายทาง หรือ null ถ้าอยู่ถูกที่แล้ว
 *
 * role อื่นคืน null เสมอ: ฟังก์ชันนี้ไม่ใช่ที่รวมกติกาสิทธิ์ของทั้งระบบ
 * มันแคบไว้ที่ HR ตัวเดียวโดยตั้งใจ เพราะ role อื่นมี guard ของตัวเองอยู่แล้ว
 * และการรวบมาไว้ที่นี่แปลว่ามีสองที่ที่ตัดสินเรื่องเดียวกัน
 */
export const hrScopeRedirect = (
  role: string | undefined | null,
  pathname: string
): string | null => {
  if (!isHrRole(role)) return null;
  return isPathInHrScope(pathname) ? null : HR_HOME;
};
