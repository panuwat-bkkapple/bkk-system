/**
 * Built-in condition-set seed templates for the Engine editor
 * (EngineSettingsModal "+ ชุดคัดกรองการทำงาน…" / "+ ชุดคัดกรองสภาพ / คุณสมบัติ…"
 * dropdowns). Data only — the modal owns id-minting and insertion order.
 *
 * INVARIANT (tested in assessmentSeedTemplates.test.ts): EVERY Thai string in
 * these templates (group title/description, option label/description) must be
 * resolvable by `translateAssessmentText` so `fillEnFields` — which now runs
 * whenever the admin opens a set — leaves ZERO empty `*_en` fields on seeded
 * groups. When adding/changing a Thai string here, add its English pair to
 * ASSESSMENT_EN_SEED (and mirror it in bkk-frontend-next
 * `app/i18n/dataDisplay.tsx` EN_ASSESSMENT_EXACT).
 */

export interface SeedFunctionalOption {
  label: string;
  description: string;
  failBehavior: 'pass' | 'reject';
}

export interface SeedFunctionalGroup {
  title: string;
  icon: string;
  description: string;
  options: SeedFunctionalOption[];
}

// One-click standard functional-check groups per subcategory. Mirrors the old
// hardcoded screening questions (now data-driven). Each group carries its OWN
// two options — a "ปกติ" pass and a topic-specific reject (e.g. battery reads
// ปกติ / แบตเตอรี่เสื่อม, not a generic "มีปัญหา") so the labels read naturally
// to the customer per topic. Admin can still tweak per model and assign the
// set via PriceEditor. Each seeded group carries an `icon` key (see
// constants/conditionIcons) so the customer frontend renders the matching
// topic glyph. `description` = คำอธิบายใต้หัวข้อที่ลูกค้าเห็นตอนประเมิน — แอดมิน
// แก้ทับได้ทุกช่อง.
export const OK = (description = 'ใช้งานได้ตามปกติ ไม่มีปัญหา'): SeedFunctionalOption =>
  ({ label: 'ปกติ', description, failBehavior: 'pass' as const });
export const BAD = (label: string, description: string): SeedFunctionalOption =>
  ({ label, description, failBehavior: 'reject' as const });

export const FUNCTIONAL_TEMPLATES: Record<string, { label: string; items: SeedFunctionalGroup[] }> = {
  iphone: { label: 'iPhone', items: [
    { title: 'เปิดเครื่อง / ใช้งานทั่วไป', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง', options: [OK('เปิดเครื่องได้ ใช้งานได้ตามปกติ'), BAD('เปิดไม่ติด / ค้าง / ดับเอง', 'เปิดไม่ติด หรือค้าง ดับเอง รีสตาร์ทเอง')] },
    // "การแสดงผล" ไม่ใช่ "หน้าจอ" — ถามเฉพาะการทำงาน (ภาพขึ้น/ทัชตอบสนอง)
    // กระจกแตกแต่ยังใช้งานได้ = ปกติ แล้วไปหักที่หัวข้อสภาพจอภาพ (จอแตก/ร้าว)
    { title: 'การแสดงผล + ทัชสกรีน', icon: 'screen', description: 'ทัชสกรีนตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว', options: [OK('ภาพขึ้นปกติ ทัชตอบสนองทุกจุด แม้กระจกจะมีรอยหรือแตก'), BAD('จอเสีย / ทัชมีปัญหา', 'มีจุดดำ เส้น แสงรั่ว หรือทัชสกรีนไม่ตอบสนอง')] },
    { title: 'กล้องหน้า / กล้องหลัง', icon: 'camera', description: 'ถ่ายรูป/วิดีโอได้ ไม่มีฝ้า ไม่มีรอยร้าวที่เลนส์', options: [OK('ถ่ายได้คมชัด เลนส์ปกติ'), BAD('กล้องมีปัญหา', 'ถ่ายไม่ได้ ภาพเบลอ มีฝ้า หรือเลนส์ร้าว')] },
    { title: 'การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)', icon: 'connectivity', description: 'โทรได้ รับสายได้ เชื่อมต่อ Wi-Fi ได้ สัญญาณปกติ', options: [OK('โทร/เน็ต/Wi-Fi ใช้ได้ปกติ'), BAD('สัญญาณ / การเชื่อมต่อมีปัญหา', 'โทร/รับสายไม่ได้ ต่อ Wi-Fi ไม่ได้ หรือสัญญาณผิดปกติ')] },
    { title: 'ลำโพง / ไมโครโฟน', icon: 'audio', description: 'เสียงดังชัด ไม่มีเสียงแตก ไมค์รับเสียงได้', options: [OK('เสียงดังชัด ไมค์ปกติ'), BAD('เสียง / ไมค์มีปัญหา', 'เสียงแตก ไม่ดัง หรือไมค์รับเสียงไม่ได้')] },
    { title: 'แบตเตอรี่', icon: 'battery', description: 'แบตเตอรี่ชาร์จเข้า ใช้งานได้นานพอสมควร ไม่บวม สุขภาพแบตเตอรี่ (Battery Health) อยู่ในเกณฑ์ดี', options: [OK('แบตชาร์จเข้า อยู่ได้นาน ไม่บวม'), BAD('แบตเตอรี่เสื่อม', 'สุขภาพแบตต่ำ ไฟหมดเร็ว ชาร์จไม่เข้า หรือแบตบวม')] },
  ] },
  ipad: { label: 'iPad', items: [
    { title: 'เปิดเครื่อง / ใช้งานทั่วไป', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง', options: [OK('เปิดเครื่องได้ ใช้งานได้ตามปกติ'), BAD('เปิดไม่ติด / ค้าง / ดับเอง', 'เปิดไม่ติด หรือค้าง ดับเอง รีสตาร์ทเอง')] },
    // "การแสดงผล" ไม่ใช่ "หน้าจอ" — ถามเฉพาะการทำงาน (ภาพขึ้น/ทัชตอบสนอง)
    // กระจกแตกแต่ยังใช้งานได้ = ปกติ แล้วไปหักที่หัวข้อสภาพจอภาพ (จอแตก/ร้าว)
    { title: 'การแสดงผล + ทัชสกรีน', icon: 'screen', description: 'ทัชสกรีนตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว', options: [OK('ภาพขึ้นปกติ ทัชตอบสนองทุกจุด แม้กระจกจะมีรอยหรือแตก'), BAD('จอเสีย / ทัชมีปัญหา', 'มีจุดดำ เส้น แสงรั่ว หรือทัชสกรีนไม่ตอบสนอง')] },
    { title: 'กล้องหน้า / กล้องหลัง', icon: 'camera', description: 'ถ่ายรูป/วิดีโอได้ ไม่มีฝ้า ไม่มีรอยร้าวที่เลนส์', options: [OK('ถ่ายได้คมชัด เลนส์ปกติ'), BAD('กล้องมีปัญหา', 'ถ่ายไม่ได้ ภาพเบลอ มีฝ้า หรือเลนส์ร้าว')] },
    { title: 'Wi-Fi / Bluetooth / สัญญาณ', icon: 'connectivity', description: 'เชื่อมต่อ Wi-Fi / Bluetooth ได้ สัญญาณปกติ', options: [OK('ต่อ Wi-Fi/Bluetooth ได้ปกติ'), BAD('การเชื่อมต่อมีปัญหา', 'ต่อ Wi-Fi หรือ Bluetooth ไม่ได้ หรือสัญญาณผิดปกติ')] },
    { title: 'ลำโพง / ไมโครโฟน', icon: 'audio', description: 'เสียงดังชัด ไม่มีเสียงแตก ไมค์รับเสียงได้', options: [OK('เสียงดังชัด ไมค์ปกติ'), BAD('เสียง / ไมค์มีปัญหา', 'เสียงแตก ไม่ดัง หรือไมค์รับเสียงไม่ได้')] },
    { title: 'แบตเตอรี่', icon: 'battery', description: 'แบตเตอรี่ชาร์จเข้า ใช้งานได้นานพอสมควร ไม่บวม สุขภาพแบตเตอรี่อยู่ในเกณฑ์ดี', options: [OK('แบตชาร์จเข้า อยู่ได้นาน ไม่บวม'), BAD('แบตเตอรี่เสื่อม', 'สุขภาพแบตต่ำ ไฟหมดเร็ว ชาร์จไม่เข้า หรือแบตบวม')] },
  ] },
  mac: { label: 'Mac', items: [
    { title: 'เปิดเครื่อง / ชาร์จไฟ', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง ชาร์จแบตได้ปกติ', options: [OK('เปิดติด ชาร์จเข้า ใช้งานได้ปกติ'), BAD('เปิดไม่ติด / ชาร์จไม่เข้า', 'เปิดไม่ติด ค้าง ดับเอง หรือชาร์จไฟไม่เข้า')] },
    { title: 'หน้าจอแสดงผล', icon: 'screen', description: 'ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว สีสม่ำเสมอ ไม่มีจอเบิร์น', options: [OK('จอชัด สีปกติ ไม่มีตำหนิ'), BAD('จอเสีย / จอเบิร์น', 'มีจุดดำ เส้น แสงรั่ว หรือจอเบิร์น')] },
    { title: 'คีย์บอร์ด + แทร็คแพด', icon: 'keyboard', description: 'ปุ่มกดได้ทุกปุ่ม ไม่มีปุ่มค้าง แทร็คแพดคลิกและเลื่อนได้ปกติ', options: [OK('ปุ่ม + แทร็คแพดใช้ได้ครบ'), BAD('คีย์บอร์ด / แทร็คแพดมีปัญหา', 'มีปุ่มค้าง กดไม่ติด หรือแทร็คแพดผิดปกติ')] },
    { title: 'พอร์ต + Wi-Fi / Bluetooth', icon: 'ports', description: 'พอร์ต USB-C/Thunderbolt ใช้งานได้ เชื่อมต่อ Wi-Fi และ Bluetooth ได้ปกติ', options: [OK('พอร์ต + การเชื่อมต่อใช้ได้ปกติ'), BAD('พอร์ต / การเชื่อมต่อมีปัญหา', 'พอร์ตใช้ไม่ได้ ต่อ Wi-Fi หรือ Bluetooth ไม่ได้')] },
    { title: 'แบตเตอรี่', icon: 'battery', description: 'แบตเตอรี่ชาร์จเข้า อยู่ได้นานพอสมควร ไม่บวม ไม่ร้อนผิดปกติ', options: [OK('แบตชาร์จเข้า อยู่ได้นาน ไม่บวม'), BAD('แบตเตอรี่เสื่อม', 'แบตหมดเร็ว ชาร์จไม่เข้า บวม หรือร้อนผิดปกติ')] },
  ] },
  // Mac desktop (mini / Studio / Pro) — ไม่มีจอ ไม่มีคีย์บอร์ด ไม่มีแบตในตัว
  // จึงเหลือแค่เปิดเครื่อง + พอร์ต/การเชื่อมต่อ. iMac มีจอในตัว (แต่ไม่มีแบต)
  // จึงได้หัวข้อจอเพิ่ม. ทั้งคู่ใช้หัวข้อ "เปิดเครื่อง / การทำงานพื้นฐาน"
  // (ไม่พูดเรื่องชาร์จแบตแบบ MacBook)
  mac_desktop: { label: 'Mac mini / Studio / Pro', items: [
    { title: 'เปิดเครื่อง / การทำงานพื้นฐาน', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง', options: [OK('เปิดติด ใช้งานได้ปกติ'), BAD('เปิดไม่ติด / ค้าง / ดับเอง', 'เปิดไม่ติด หรือค้าง ดับเอง รีสตาร์ทเอง')] },
    { title: 'พอร์ต + Wi-Fi / Bluetooth', icon: 'ports', description: 'พอร์ต USB-C/Thunderbolt ใช้งานได้ เชื่อมต่อ Wi-Fi และ Bluetooth ได้ปกติ', options: [OK('พอร์ต + การเชื่อมต่อใช้ได้ปกติ'), BAD('พอร์ต / การเชื่อมต่อมีปัญหา', 'พอร์ตใช้ไม่ได้ ต่อ Wi-Fi หรือ Bluetooth ไม่ได้')] },
  ] },
  mac_imac: { label: 'iMac', items: [
    { title: 'เปิดเครื่อง / การทำงานพื้นฐาน', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง', options: [OK('เปิดติด ใช้งานได้ปกติ'), BAD('เปิดไม่ติด / ค้าง / ดับเอง', 'เปิดไม่ติด หรือค้าง ดับเอง รีสตาร์ทเอง')] },
    { title: 'หน้าจอแสดงผล', icon: 'screen', description: 'ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว สีสม่ำเสมอ ไม่มีจอเบิร์น', options: [OK('จอชัด สีปกติ ไม่มีตำหนิ'), BAD('จอเสีย / จอเบิร์น', 'มีจุดดำ เส้น แสงรั่ว หรือจอเบิร์น')] },
    { title: 'พอร์ต + Wi-Fi / Bluetooth', icon: 'ports', description: 'พอร์ต USB-C/Thunderbolt ใช้งานได้ เชื่อมต่อ Wi-Fi และ Bluetooth ได้ปกติ', options: [OK('พอร์ต + การเชื่อมต่อใช้ได้ปกติ'), BAD('พอร์ต / การเชื่อมต่อมีปัญหา', 'พอร์ตใช้ไม่ได้ ต่อ Wi-Fi หรือ Bluetooth ไม่ได้')] },
  ] },
  watch: { label: 'Apple Watch', items: [
    { title: 'เปิดเครื่อง / ชาร์จไฟ', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง ชาร์จแบตได้ปกติ', options: [OK('เปิดติด ชาร์จเข้า ใช้งานได้ปกติ'), BAD('เปิดไม่ติด / ชาร์จไม่เข้า', 'เปิดไม่ติด ค้าง ดับเอง หรือชาร์จไฟไม่เข้า')] },
    { title: 'การแสดงผล + ทัชสกรีน', icon: 'screen', description: 'หน้าจอสัมผัสตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีจอเบิร์น', options: [OK('จอชัด ทัชลื่น ไม่มีตำหนิ'), BAD('จอเสีย / ทัชมีปัญหา', 'มีจุดดำ เส้น จอเบิร์น หรือทัชไม่ตอบสนอง')] },
    { title: 'Digital Crown + ปุ่มข้าง', icon: 'crown', description: 'หมุน Digital Crown ได้ลื่น กดปุ่มด้านข้างได้ปกติ ไม่ค้าง', options: [OK('Crown + ปุ่มใช้ได้ปกติ'), BAD('Crown / ปุ่มมีปัญหา', 'หมุน Crown ไม่ลื่น หรือกดปุ่มไม่ติด/ค้าง')] },
    { title: 'เซ็นเซอร์ (วัดชีพจร ฯลฯ)', icon: 'sensors', description: 'เซ็นเซอร์วัดชีพจร ตรวจจับการสวมใส่ และเซ็นเซอร์อื่นๆ ทำงานได้ปกติ', options: [OK('เซ็นเซอร์ทำงานได้ครบปกติ'), BAD('เซ็นเซอร์มีปัญหา', 'เซ็นเซอร์วัดชีพจร/ตรวจจับการสวมใส่ไม่ทำงาน')] },
    { title: 'Wi-Fi / Bluetooth', icon: 'connectivity', description: 'เชื่อมต่อ Bluetooth กับ iPhone ได้ เชื่อมต่อ Wi-Fi ได้ปกติ', options: [OK('ต่อ Bluetooth/Wi-Fi ได้ปกติ'), BAD('การเชื่อมต่อมีปัญหา', 'ต่อ Bluetooth กับ iPhone หรือ Wi-Fi ไม่ได้')] },
    { title: 'แบตเตอรี่', icon: 'battery', description: 'แบตเตอรี่ชาร์จเข้า อยู่ได้นานพอสมควร ไม่บวม สุขภาพแบตเตอรี่อยู่ในเกณฑ์ดี', options: [OK('แบตชาร์จเข้า อยู่ได้นาน ไม่บวม'), BAD('แบตเตอรี่เสื่อม', 'สุขภาพแบตต่ำ ไฟหมดเร็ว ชาร์จไม่เข้า หรือแบตบวม')] },
  ] },
};

// Standard COSMETIC + QUALIFYING screening (a second seed template beside the
// functional one). Splits into:
//   • สภาพภายนอก (kind 'cosmetic') — body + screen. The customer picks the
//     actual condition; we do NOT ask "which grade" — the A/B/C/D grade is
//     summarised at checkout from the WORDING of the chosen options
//     (bkk-frontend-next app/utils/conditionGrade.ts). So the labels here are
//     worded to hit that grader: ขนแมว→B, ขีดข่วน/บุบ/บิ่น→C, แตก/ร้าว/งอ→D.
//     Damage options carry a % default so the grade classifies out of the box
//     (grade only looks at options that deduct > 0) — admin tunes the numbers.
//   • คุณสมบัติเครื่อง — ประกัน / ประเทศที่ซื้อ / ประวัติการซ่อม. ALL kind
//     'cosmetic': the customer answers every group, and the no-buy decision
//     (ซ่อมนอกศูนย์/อะไหล่เทียบ, ล็อกเครือข่าย) is surfaced on the end-of-flow
//     summary card (Rejected), NOT as a mid-flow dead-end. Those options still
//     carry failBehavior:'reject' in the data so the summary can read it; we
//     do NOT make the group 'functional' — that would (a) mislabel provenance
//     as a working check and (b) let this template alone replace the hardcoded
//     working-check screening (any functional group does). ประกัน + ประเทศ are
//     excluded from the A/B/C/D grade (see GRADE_EXCLUDE_RE) — grade = สภาพ only.
export type SeedCondOpt = { label: string; description: string; pct?: number; deduct?: number; failBehavior?: 'pass' | 'reject' | 'deduct' };
export type SeedCondGroup = { title: string; icon: string; description: string; kind: 'cosmetic' | 'functional'; options: SeedCondOpt[] };

// ประเทศที่ซื้อ / รหัสโมเดล — สองเวอร์ชันตามรุ่น: ตั้งแต่ iPhone 14 ขึ้นไป
// ไม่มีรหัส TH/A แล้ว เครื่องศูนย์ไทยใช้ ZP/A แทน; iPhone 13 ลงไปศูนย์ไทยคือ
// TH/A. ตัวเลือกเครื่องนอกจัดเป็น 3 กลุ่มตามนโยบายเจ้าของร้าน (ก.ค. 2026):
//   1. เอเชียสเปกโกลบอล — ใช้ในไทยได้ครบทุกฟังก์ชัน แค่ไม่ใช่เครื่องศูนย์ไทย
//      → หักเบา
//   2. กลุ่มมีข้อจำกัดฝังเครื่อง (แก้ไม่ได้ ราคาตกแรง สภาพคล่องต่ำ):
//      LL = eSIM เท่านั้นตั้งแต่ 14 (ไม่มีถาดซิม), J/KH = ปิดเสียงชัตเตอร์ไม่ได้,
//      CH = FaceTime Audio/Group ถูกปิดถาวร (วิดีโอ 1:1 ยังใช้ได้) → หักแรง
//   3. ติดล็อกเครือข่าย/ติดสัญญา (ค่ายไทยหรือต่างประเทศ เช่น สหรัฐฯ) → ปฏิเสธ
//      รับซื้อ วางเป็นตัวเลือกท้ายสุดเสมอ
// ใช้ประกอบใน template แบตรายรุ่นด้านล่าง.
const REGION_ZP_GROUP: SeedCondGroup = {
  title: 'ประเทศที่ซื้อ', icon: 'help', kind: 'cosmetic', description: 'เครื่องศูนย์ไทยหรือเครื่องนอก (ดูจากรหัสรุ่นท้าย)', options: [
    { label: 'ศูนย์ไทย (ZP/A)', description: 'เครื่องศูนย์ไทย รหัสรุ่นลงท้าย ZP/A', failBehavior: 'pass', deduct: 0 },
    { label: 'เครื่องนอกเอเชีย สเปกโกลบอล (SG / MY / VN / อื่นๆ)', description: 'ใช้งานในไทยได้ครบทุกฟังก์ชัน แต่ไม่ใช่เครื่องศูนย์ไทย', failBehavior: 'deduct', pct: 10 },
    { label: 'เครื่องนอกมีข้อจำกัด (LL / J / CH / KH)', description: 'LL ไม่มีถาดซิม (eSIM เท่านั้น), J/KH ปิดเสียงชัตเตอร์ไม่ได้, CH ใช้ FaceTime Audio ไม่ได้ — สภาพคล่องต่ำ', failBehavior: 'deduct', pct: 25 },
    { label: 'ติดล็อกเครือข่าย / ติดสัญญา (ไทยหรือต่างประเทศ)', description: 'ติดล็อกค่ายมือถือในไทย หรือติดสัญญา/แบล็กลิสต์จากต่างประเทศ ใช้ซิมไทยไม่ได้ตามปกติ', failBehavior: 'reject' },
  ],
};
// สภาพภายนอก (จอ + บอดี้) — โครงเดียวกันทุกรุ่น แต่ % หักไล่ระดับตามอายุรุ่น
// แบบ "ยิ่งเครื่องถูก % ยิ่งสูง": ต้นทุนส่วนลด/ขัดเงาตอนขายต่อเป็นเงินบาทเกือบ
// คงที่ ไม่ได้แปรตามราคาเครื่อง (ขนแมวบน iPhone 17 หัก 3% ~ 1,200 บาท กับบน
// iPhone 13 หัก 10% ~ 1,000 บาท = ภาระจริงใกล้กัน). ถ้อยคำตัวเลือกผูกกับตัวตัด
// เกรดฝั่งเว็บลูกค้า (conditionGrade.ts): ขนแมว/เคสกัด -> B, ขีดข่วน/บุบ/บิ่น -> C,
// แตก/งอ/ผิดรูป -> D. "จอแตก/ร้าว" = กระจกแตกแต่จอ+ทัชยังทำงาน (จอ/ทัชเสียจริง
// ถูกดักปฏิเสธที่ชั้นคัดกรองการทำงานตั้งแต่ต้น flow) — นโยบายเจ้าของร้าน:
// ยังรับซื้อแต่หักหนักตามรุ่น (ค่าเปลี่ยนกระจก/จอเป็นเงินบาทเกือบคงที่
// เครื่องยิ่งถูก % ยิ่งสูง).
const SCREEN_GROUP = (light: number, deep: number, cracked: number): SeedCondGroup => ({
  title: 'สภาพจอภาพและกระจก', icon: 'screen', kind: 'cosmetic', description: 'รอยหรือความเสียหายของกระจกหน้าจอ', options: [
    { label: 'สมบูรณ์ ไร้รอยขีดข่วน', description: 'ต้องไม่มีตำหนิใดๆ บนจอภาพหรือกระจก', deduct: 0 },
    { label: 'รอยขนแมวบางๆ (ไม่ลึก)', description: 'อาจมองเห็นได้เมื่อส่องไฟ', pct: light },
    { label: 'รอยขีดข่วนลึก/เห็นชัด', description: 'มองเห็นชัดแม้ไม่ส่องไฟ', pct: deep },
    { label: 'จอแตก/ร้าว', description: 'กระจกหน้าจอแตกหรือร้าว', pct: cracked, failBehavior: 'deduct' },
  ],
});
const BODY_GROUP = (hairline: number, scratch: number, dent: number, bent: number): SeedCondGroup => ({
  title: 'สภาพตัวเครื่องและฝาหลัง', icon: 'shield', kind: 'cosmetic', description: 'รอย ตำหนิ หรือความเสียหายของตัวเครื่องและฝาหลัง', options: [
    { label: 'สมบูรณ์ ไร้รอยตำหนิ', description: 'ตัวเครื่องสวย ไม่มีรอย ไม่มีตำหนิ', deduct: 0 },
    { label: 'มีรอยขนแมว/รอยเคสกัด/รอยสีลอก', description: 'รอยจากการใช้งานปกติ มองเห็นเมื่อสะท้อนแสง', pct: hairline },
    { label: 'มีรอยขีดข่วน / ถลอกเห็นชัด', description: 'มีรอยขีดข่วนหรือถลอกที่มองเห็นได้ชัดเจน', pct: scratch },
    { label: 'รอยบุบ/รอยบิ่นตามมุม', description: 'ตัวเครื่องบุบ บิ่น หรือมีร่องรอยตกกระแทก', pct: dent },
    { label: 'เครื่องงอ/ฝาหลังแตก', description: 'ตัวเครื่องงอ ผิดรูป หรือฝาหลังแตกร้าว', pct: bent, failBehavior: 'deduct' },
  ],
});

// iPad: ส่วนใหญ่เป็นเครื่อง Wi-Fi ไม่มีประเด็น eSIM/ชัตเตอร์แบบ iPhone —
// แยกแค่ศูนย์ไทย/เครื่องนอกพอ (ไม่ระบุรหัสท้ายเพราะต่างจากยุค iPhone)
const REGION_SIMPLE_GROUP: SeedCondGroup = {
  title: 'ประเทศที่ซื้อ', icon: 'help', kind: 'cosmetic', description: 'เครื่องศูนย์ไทยหรือเครื่องนอก (ดูจากรหัสรุ่นท้าย)', options: [
    { label: 'เครื่องศูนย์ไทย', description: 'ซื้อจากศูนย์ / ตัวแทนจำหน่ายในไทย', failBehavior: 'pass', deduct: 0 },
    { label: 'เครื่องนอก / ต่างประเทศ', description: 'เครื่องหิ้ว/นอก ใช้งานได้ปกติในไทย', failBehavior: 'deduct', pct: 10 },
  ],
};
const REGION_TH_GROUP: SeedCondGroup = {
  title: 'ประเทศที่ซื้อ', icon: 'help', kind: 'cosmetic', description: 'เครื่องศูนย์ไทยหรือเครื่องนอก (ดูจากรหัสรุ่นท้าย)', options: [
    { label: 'ศูนย์ไทย (TH/A)', description: 'เครื่องศูนย์ไทย รหัสรุ่นลงท้าย TH/A', failBehavior: 'pass', deduct: 0 },
    { label: 'เครื่องนอก สเปกโกลบอล (ZP / MY / LL / อื่นๆ)', description: 'ใช้งานในไทยได้ครบทุกฟังก์ชัน แต่ไม่ใช่เครื่องศูนย์ไทย', failBehavior: 'deduct', pct: 10 },
    { label: 'เครื่องนอกมีข้อจำกัด (J / KH / CH)', description: 'J/KH ปิดเสียงชัตเตอร์ไม่ได้, CH ใช้ FaceTime Audio ไม่ได้ — สภาพคล่องต่ำ', failBehavior: 'deduct', pct: 25 },
    { label: 'ติดล็อกเครือข่าย / ติดสัญญา (ไทยหรือต่างประเทศ)', description: 'ติดล็อกค่ายมือถือในไทย หรือติดสัญญา/แบล็กลิสต์จากต่างประเทศ ใช้ซิมไทยไม่ได้ตามปกติ', failBehavior: 'reject' },
  ],
};

// ประวัติการซ่อม — ใช้ร่วมทุก tier (kind cosmetic ตามเหตุผลใน comment ด้านบน:
// reject โชว์ที่สรุปท้าย flow ไม่ dead-end กลางทาง). อยู่ใน template รุ่นด้วย
// เพื่อ normalize ชุดเก่าที่ field kind เพี้ยน (เคยถูกมาร์ค functional แล้วโดน
// ตัว normalize คัดกรองกลืนหายไปรอบหนึ่ง — ดู PR #442)
const REPAIR_GROUP: SeedCondGroup = {
  title: 'ประวัติการซ่อม', icon: 'help', kind: 'cosmetic', description: 'เครื่องเคยเปิดซ่อมหรือเปลี่ยนอะไหล่มาหรือไม่', options: [
    { label: 'ไม่เคยซ่อม', description: 'เครื่องเดิมจากโรงงาน ไม่เคยเปิดซ่อม', failBehavior: 'pass', deduct: 0 },
    { label: 'เคยซ่อมศูนย์ / อะไหล่แท้', description: 'เคยเข้าศูนย์ Apple เปลี่ยนอะไหล่แท้', failBehavior: 'deduct', deduct: 0 },
    { label: 'ซ่อมนอกศูนย์ / อะไหล่เทียบ (ไม่แท้)', description: 'เคยซ่อมร้านนอก หรือเปลี่ยนอะไหล่เทียบ/ไม่แท้', failBehavior: 'reject' },
  ],
};

// กล่อง / อุปกรณ์ที่นำมาด้วย — ใช้ร่วมทุก tier (default ไม่หัก แอดมินจูนได้).
// อยู่ใน template ด้วยเหตุผลเดียวกับ REPAIR_GROUP: ชุดเก่าบางชุดไม่มีหัวข้อนี้
// หรือเก็บด้วย kind เพี้ยนจนเคยถูกตัว normalize กลืนหาย
const BOX_GROUP: SeedCondGroup = {
  title: 'อุปกรณ์เสริมที่นำมาด้วย', icon: 'box', kind: 'cosmetic', description: 'อุปกรณ์ที่ให้มาพร้อมเครื่อง', options: [
    { label: 'ครบกล่อง (เครื่อง+สาย+กล่อง)', description: 'กล่องตรงเครื่อง อุปกรณ์แท้ครบ', failBehavior: 'pass', deduct: 0 },
    { label: 'ขาดกล่อง (มีเครื่อง+สายชาร์จ)', description: 'มีเครื่องและสายชาร์จ แต่ไม่มีกล่อง', failBehavior: 'deduct', deduct: 0 },
    { label: 'เครื่องเปล่า (ไม่มีสาย/กล่อง)', description: 'มีเฉพาะตัวเครื่อง ไม่มีสายชาร์จและกล่อง', failBehavior: 'deduct', deduct: 0 },
  ],
};

// ── กลุ่มหักราคาเฉพาะ Mac ─────────────────────────────────────────────────
// แบต Mac ไม่มีเมนู % แบบ iPhone — ลูกค้าดูได้ 2 อย่าง: สถานะ (Normal /
// Service Recommended) + Cycle Count (การตั้งค่า > แบตเตอรี่ / System Report)
// เกณฑ์คู่ "รอบชาร์จ หรือ แบต%" (นโยบายเจ้าของร้าน ส.ค. 2026 — เคสจริง: เครื่อง
// ต่อจอใช้งานตลอด รอบชาร์จร้อยกว่าแต่แบตเหลือ 81% เกณฑ์รอบชาร์จอย่างเดียวหักไม่ได้)
// ระดับปกติต้องผ่านทั้งสองเกณฑ์ ระดับหักใช้เกณฑ์ที่แย่กว่า — หัก 5/10/15% ทุก tier Mac
const MAC_BATTERY_GROUP = (): SeedCondGroup => ({
  title: 'สุขภาพแบตเตอรี่', icon: 'battery', kind: 'functional', description: 'ดูสถานะแบต + ความจุสูงสุด (Maximum Capacity) จาก การตั้งค่า > แบตเตอรี่ และ Cycle Count ใน System Report — ถ้าเข้าเกณฑ์หลายระดับ เลือกระดับที่แย่กว่า', options: [
    { label: 'แบตปกติ (รอบชาร์จไม่เกิน 300 และแบต 90% ขึ้นไป)', description: 'สถานะ Normal, Cycle Count ไม่เกิน 300 และความจุสูงสุด 90-100%', deduct: 0 },
    { label: 'รอบชาร์จเกิน 300 หรือแบต 85-89%', description: 'Cycle Count 301-400 หรือความจุสูงสุด 85-89%', pct: 5, failBehavior: 'deduct' },
    { label: 'รอบชาร์จเกิน 400 หรือแบต 80-84%', description: 'Cycle Count 401-500 หรือความจุสูงสุด 80-84%', pct: 10, failBehavior: 'deduct' },
    { label: 'รอบชาร์จเกิน 500 หรือแบตต่ำกว่า 80% หรือขึ้น Service Recommended', description: 'Cycle Count เกิน 500, ความจุสูงสุดต่ำกว่า 80% หรือขึ้นสถานะ Service Recommended (เข้าเกณฑ์เปลี่ยนแบต)', pct: 15, failBehavior: 'deduct' },
  ],
});
// จอ MacBook/iMac — เพิ่มตัวเลือกชั้นเคลือบจอลอก (Staingate) ซึ่งเป็นอาการ
// เฉพาะจอ Mac ที่เจอบ่อยในตลาดมือสอง (รวมกับรอยขีดข่วนลึกเป็นขั้นเดียว)
const MAC_SCREEN_GROUP = (light: number, deep: number, cracked: number): SeedCondGroup => ({
  title: 'สภาพจอภาพและกระจก', icon: 'screen', kind: 'cosmetic', description: 'รอยหรือความเสียหายของกระจกหน้าจอ', options: [
    { label: 'สมบูรณ์ ไร้รอยขีดข่วน', description: 'ต้องไม่มีตำหนิใดๆ บนจอภาพหรือกระจก', deduct: 0 },
    { label: 'รอยขนแมวบางๆ (ไม่ลึก)', description: 'อาจมองเห็นได้เมื่อส่องไฟ', pct: light },
    { label: 'รอยขีดข่วนลึก / ชั้นเคลือบจอลอก', description: 'รอยลึกมองเห็นชัด หรือชั้นเคลือบกันสะท้อนหลุดลอกเป็นดวง', pct: deep },
    { label: 'จอแตก/ร้าว', description: 'กระจกหน้าจอแตกหรือร้าว', pct: cracked, failBehavior: 'deduct' },
  ],
});
const MAC_BODY_GROUP = (hairline: number, scratch: number, dent: number, bent: number): SeedCondGroup => ({
  title: 'สภาพตัวเครื่อง (บอดี้)', icon: 'shield', kind: 'cosmetic', description: 'รอย ตำหนิ หรือความเสียหายของตัวเครื่อง', options: [
    { label: 'สมบูรณ์ ไร้รอยตำหนิ', description: 'ตัวเครื่องสวย ไม่มีรอย ไม่มีตำหนิ', deduct: 0 },
    { label: 'มีรอยขนแมว/รอยเคสกัด/รอยสีลอก', description: 'รอยจากการใช้งานปกติ มองเห็นเมื่อสะท้อนแสง', pct: hairline },
    { label: 'มีรอยขีดข่วน / ถลอกเห็นชัด', description: 'มีรอยขีดข่วนหรือถลอกที่มองเห็นได้ชัดเจน', pct: scratch },
    { label: 'รอยบุบ/รอยบิ่นตามมุม', description: 'ตัวเครื่องบุบ บิ่น หรือมีร่องรอยตกกระแทก', pct: dent },
    { label: 'ตัวเครื่อง/บานพับผิดรูป ฝาปิดไม่สนิท', description: 'ตัวเครื่องบิดงอ บานพับหลวมหรือผิดรูป ปิดฝาแล้วไม่สนิท', pct: bent, failBehavior: 'deduct' },
  ],
});
// เครื่องนอกของ Mac แยกตาม layout คีย์บอร์ด — คีย์ US ไม่มีสกรีนภาษาไทย
// ขายต่อในตลาดไทยยากกว่าจึงหักแรงกว่า (title มีคำว่า "ประเทศ" ให้ตัว
// normalize จับเป็นหัวข้อ pricing และตัวตัดเกรดฝั่งลูกค้า exclude ให้เอง)
const MAC_REGION_GROUP: SeedCondGroup = {
  title: 'ประเทศที่ซื้อ + คีย์บอร์ด', icon: 'help', kind: 'cosmetic', description: 'เครื่องศูนย์ไทยหรือเครื่องนอก และ layout ของคีย์บอร์ด', options: [
    { label: 'ศูนย์ไทย คีย์บอร์ดไทย', description: 'เครื่องศูนย์ไทย คีย์บอร์ดสกรีนภาษาไทย', failBehavior: 'pass', deduct: 0 },
    { label: 'เครื่องนอก คีย์บอร์ดไทย', description: 'เครื่องจากต่างประเทศ คีย์บอร์ดสกรีนภาษาไทย', failBehavior: 'deduct', pct: 8 },
    { label: 'เครื่องนอก คีย์บอร์ด US / layout อื่น', description: 'เครื่องจากต่างประเทศ คีย์บอร์ดไม่มีสกรีนภาษาไทย', failBehavior: 'deduct', pct: 15 },
  ],
};
const MAC_WARRANTY_INFO_GROUP: SeedCondGroup = {
  title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง', options: [
    { label: 'มีประกัน', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
    { label: 'หมดประกัน', description: 'พ้นระยะประกันศูนย์แล้ว', deduct: 0 },
  ],
};
// อะแดปเตอร์ Mac เป็นเงินจริง (แท้ 70W-140W ~2,000-3,500 บาท) — เครื่องเปล่า
// จึงหัก 3% ต่างจาก BOX_GROUP ของ iPhone ที่ default ไม่หัก
const MAC_BOX_GROUP: SeedCondGroup = {
  title: 'อุปกรณ์เสริมที่นำมาด้วย', icon: 'box', kind: 'cosmetic', description: 'อุปกรณ์ที่ให้มาพร้อมเครื่อง', options: [
    { label: 'ครบกล่อง (เครื่อง+อะแดปเตอร์+กล่อง)', description: 'กล่องตรงเครื่อง อะแดปเตอร์แท้ครบ', failBehavior: 'pass', deduct: 0 },
    { label: 'ขาดกล่อง (มีเครื่อง+อะแดปเตอร์)', description: 'มีเครื่องและอะแดปเตอร์ แต่ไม่มีกล่อง', failBehavior: 'deduct', deduct: 0 },
    { label: 'เครื่องเปล่า (ไม่มีอะแดปเตอร์/กล่อง)', description: 'มีเฉพาะตัวเครื่อง ไม่มีอะแดปเตอร์และกล่อง', failBehavior: 'deduct', pct: 3 },
  ],
};

export const CONDITION_TEMPLATES: Record<string, { label: string; items: SeedCondGroup[] }> = {
  standard: { label: 'สภาพ + ประกัน + ประเทศ + ประวัติซ่อม', items: [
    { title: 'ประวัติการซ่อม', icon: 'help', kind: 'cosmetic', description: 'เครื่องเคยเปิดซ่อมหรือเปลี่ยนอะไหล่มาหรือไม่', options: [
      { label: 'ไม่เคยซ่อม', description: 'เครื่องเดิมจากโรงงาน ไม่เคยเปิดซ่อม', failBehavior: 'pass', deduct: 0 },
      { label: 'เคยซ่อมศูนย์ / อะไหล่แท้', description: 'เคยเข้าศูนย์ Apple เปลี่ยนอะไหล่แท้', failBehavior: 'deduct', deduct: 0 },
      { label: 'ซ่อมนอกศูนย์ / อะไหล่เทียบ (ไม่แท้)', description: 'เคยซ่อมร้านนอก หรือเปลี่ยนอะไหล่เทียบ/ไม่แท้', failBehavior: 'reject' },
    ] },
    { title: 'ประเทศที่ซื้อ', icon: 'help', kind: 'cosmetic', description: 'เครื่องศูนย์ไทยหรือเครื่องนอก (ดูจากรหัสรุ่นท้าย)', options: [
      { label: 'ศูนย์ไทย (TH)', description: 'เครื่องศูนย์ไทย รหัสรุ่นลงท้าย TH/A', failBehavior: 'pass', deduct: 0 },
      { label: 'เครื่องนอก (ZP / LL / อื่นๆ)', description: 'เครื่องหิ้ว/นอก ใช้งานได้ปกติในไทย', failBehavior: 'deduct', deduct: 0 },
      { label: 'ล็อกเครือข่าย / ใช้ในไทยไม่ได้', description: 'เครื่องติดล็อกเครือข่ายผู้ให้บริการ ใช้ซิมไทยไม่ได้', failBehavior: 'reject' },
    ] },
    { title: 'สภาพตัวเครื่อง (บอดี้ / ฝาหลัง)', icon: 'shield', kind: 'cosmetic', description: 'รอย ตำหนิ หรือความเสียหายของตัวเครื่องและฝาหลัง', options: [
      { label: 'สวยมาก ไม่มีรอย', description: 'ตัวเครื่องสวย ไม่มีรอย ไม่มีตำหนิ', deduct: 0 },
      { label: 'มีรอยขนแมวบางๆ', description: 'รอยขนแมวเล็กน้อย มองเห็นเมื่อสะท้อนแสง', pct: 3 },
      { label: 'มีรอยขีดข่วน / ถลอกเห็นชัด', description: 'มีรอยขีดข่วนหรือถลอกที่มองเห็นได้ชัดเจน', pct: 10 },
      { label: 'บุบ / บิ่น / ตกกระแทก', description: 'ตัวเครื่องบุบ บิ่น หรือมีร่องรอยตกกระแทก', pct: 12 },
      { label: 'เครื่องงอ / ผิดรูป', description: 'ตัวเครื่องงอ ผิดรูป หรือบิดเบี้ยว', pct: 25 },
    ] },
    { title: 'สภาพจอภาพและกระจก', icon: 'screen', kind: 'cosmetic', description: 'รอยหรือความเสียหายของกระจกหน้าจอ', options: [
      { label: 'สวยมาก ไม่มีรอย', description: 'หน้าจอใส ไม่มีรอย ไม่มีตำหนิ', deduct: 0 },
      { label: 'มีรอยขนแมวบางๆ', description: 'รอยขนแมวเล็กน้อยบนหน้าจอ', pct: 3 },
      { label: 'มีรอยขีดข่วนเห็นชัด', description: 'มีรอยขีดข่วนบนหน้าจอที่มองเห็นได้ชัด', pct: 12 },
      { label: 'จอแตก / ร้าว', description: 'กระจกหน้าจอแตกหรือร้าว', pct: 30 },
    ] },
    { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง', options: [
      { label: 'เหลือประกันศูนย์ / AppleCare+', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
      { label: 'หมดประกัน', description: 'พ้นระยะประกันศูนย์แล้ว', deduct: 0 },
    ] },
  ] },
  // แบต + ประกัน + ประเทศที่ซื้อ 4 ระดับตามอายุรุ่น — สำหรับชุดประเมินรายรุ่น
  // (1 รุ่น : 1 ชุด). นโยบายเจ้าของร้าน (ก.ค. 2026):
  //   • รุ่นล่าสุด (iPhone 17 ทั้งซีรีส์) — แบต 100/98/95 มีผลจริงต่อราคาขายต่อ
  //     → ถาม % ช่วงละเอียด + ประกันหักตามระยะเวลาที่เหลือ
  //   • รุ่นปีกว่า (iPhone 16) — ตลาดยอมรับแบต >= 90% ว่า "ดีมากแล้ว" และรับรู้
  //     ทั่วไปว่ารุ่นนี้ประกันใกล้หมด/หมดแล้ว → 90-100% ไม่หัก, ประกันถามเก็บ
  //     เป็นข้อมูลอย่างเดียว ไม่หักทุกกรณี
  //   • รุ่น 2-3 ปี (iPhone 14-15) — เกณฑ์รับได้ = แบต >= 85%, หมดประกันไม่หัก
  //   • รุ่นเก่า (iPhone 11-13 ลงไป) — ถามแค่ ดี (>= 80%) / เสื่อม, ประกันไม่หัก
  // รหัสโมเดลศูนย์ไทยเปลี่ยนที่ iPhone 14: ตั้งแต่ 14 ขึ้นไปไม่มีรหัส TH/A แล้ว —
  // เครื่องศูนย์ไทยเป็น ZP/A แทน (REGION_ZP_GROUP) ส่วน 13 ลงไปศูนย์ไทยคือ TH/A
  // และ ZP นับเป็นเครื่องนอก (REGION_TH_GROUP)
  // ค่าหักเป็น pct (สเกลตามราคา variant อัตโนมัติ) — เป็นแค่ค่าตั้งต้น แอดมิน
  // จูนต่อรายรุ่นได้. ทั้งแบตและประกันถูก exclude จากเกรด A/B/C/D อยู่แล้ว
  // (GRADE_EXCLUDE_RE ใน bkk-frontend-next conditionGrade.ts จับจากชื่อหัวข้อ
  // "แบต"/"ประกัน") — จึงหักราคาได้โดยเกรดสภาพไม่ตก ตามนโยบาย "แบต 98% ยังเกรด A".
  battery_latest: { label: 'แบต % ละเอียด + ประกันละเอียด + ZP/A (รุ่นล่าสุด iPhone 17)', items: [
    // เครื่องรุ่นล่าสุดยังใหม่ทั้งตลาด — ไม่มีเครื่องแบตต่ำจริง จึงถามแค่ 4 ช่วง
    // (ต่ำกว่า 90% เป็น catch-all หักหนัก ไม่ต้องมีขั้น 80s/เสื่อม)
    { title: 'สุขภาพแบตเตอรี่', icon: 'battery', kind: 'functional', description: 'ดูจาก ตั้งค่า > แบตเตอรี่ > สุขภาพแบตเตอรี่และการชาร์จ', options: [
      { label: 'สุขภาพแบต 100%', description: 'แบตเตอรี่ยังเต็ม 100% เหมือนใหม่', deduct: 0 },
      { label: 'สุขภาพแบต 95-99%', description: 'เสื่อมเล็กน้อยตามการใช้งาน', pct: 2, failBehavior: 'deduct' },
      { label: 'สุขภาพแบต 90-94%', description: 'เสื่อมตามการใช้งาน ยังใช้ได้ปกติ', pct: 6, failBehavior: 'deduct' },
      { label: 'แบตต่ำกว่า 90%', description: 'เสื่อมค่อนข้างมาก เริ่มต้องชาร์จบ่อย', pct: 12, failBehavior: 'deduct' },
    ] },
    SCREEN_GROUP(3, 8, 55),
    BODY_GROUP(3, 6, 12, 40),
    { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง', options: [
      { label: 'เหลือประกันศูนย์มากกว่า 6 เดือน / AppleCare+', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
      { label: 'เหลือประกันศูนย์น้อยกว่า 6 เดือน', description: 'เหลือระยะประกันศูนย์ไม่ถึง 6 เดือน', pct: 2 },
      { label: 'หมดประกันศูนย์แล้ว', description: 'พ้นระยะประกันศูนย์แล้ว', pct: 4 },
    ] },
    REGION_ZP_GROUP,
    REPAIR_GROUP,
    BOX_GROUP,
  ] },
  battery_recent: { label: 'แบต ≥90% ไม่หัก + ประกันไม่หัก + ZP/A (iPhone 16)', items: [
    { title: 'สุขภาพแบตเตอรี่', icon: 'battery', kind: 'functional', description: 'ดูจาก ตั้งค่า > แบตเตอรี่ > สุขภาพแบตเตอรี่และการชาร์จ', options: [
      { label: 'สุขภาพแบต 90-100%', description: 'สุขภาพแบตเตอรี่ยังอยู่ในเกณฑ์ดี', deduct: 0 },
      { label: 'สุขภาพแบต 85-89%', description: 'เสื่อมค่อนข้างมาก เริ่มต้องชาร์จบ่อย', pct: 5, failBehavior: 'deduct' },
      { label: 'สุขภาพแบต 80-84%', description: 'เสื่อมมาก แบตหมดเร็วกว่าปกติ', pct: 10, failBehavior: 'deduct' },
      { label: 'แบตต่ำกว่า 80% (Service)', description: 'เสื่อมมาก หรือขึ้นเตือน Service ใน Settings', pct: 15, failBehavior: 'deduct' },
    ] },
    SCREEN_GROUP(4, 10, 60),
    BODY_GROUP(4, 8, 14, 45),
    { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง', options: [
      { label: 'มีประกัน', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
      { label: 'เหลือประกันศูนย์น้อยกว่า 6 เดือน', description: 'เหลือระยะประกันศูนย์ไม่ถึง 6 เดือน', deduct: 0 },
      { label: 'หมดประกัน', description: 'พ้นระยะประกันศูนย์แล้ว', deduct: 0 },
    ] },
    REGION_ZP_GROUP,
    REPAIR_GROUP,
    BOX_GROUP,
  ] },
  battery_mid: { label: 'แบต ≥85% ไม่หัก + ประกันไม่หัก + ZP/A (iPhone 14-15)', items: [
    { title: 'สุขภาพแบตเตอรี่', icon: 'battery', kind: 'functional', description: 'ดูจาก ตั้งค่า > แบตเตอรี่ > สุขภาพแบตเตอรี่และการชาร์จ', options: [
      { label: 'สุขภาพแบต 85-100%', description: 'สุขภาพแบตเตอรี่ยังอยู่ในเกณฑ์ดี', deduct: 0 },
      { label: 'สุขภาพแบต 80-84%', description: 'เสื่อมมาก แบตหมดเร็วกว่าปกติ', pct: 8, failBehavior: 'deduct' },
      { label: 'แบตต่ำกว่า 80% (Service)', description: 'เสื่อมมาก หรือขึ้นเตือน Service ใน Settings', pct: 15, failBehavior: 'deduct' },
    ] },
    SCREEN_GROUP(6, 14, 65),
    BODY_GROUP(6, 10, 18, 50),
    { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง', options: [
      { label: 'มีประกัน', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
      { label: 'หมดประกัน', description: 'พ้นระยะประกันศูนย์แล้ว', deduct: 0 },
    ] },
    REGION_ZP_GROUP,
    REPAIR_GROUP,
    BOX_GROUP,
  ] },
  battery_old: { label: 'แบตดี/เสื่อม เกณฑ์ ≥80% + TH/A (iPhone 11-13 ลงไป)', items: [
    { title: 'สุขภาพแบตเตอรี่', icon: 'battery', kind: 'functional', description: 'แบตเตอรี่ยังดีหรือเสื่อม ไม่ต้องระบุเปอร์เซ็นต์', options: [
      { label: 'แบตเตอรี่ดี', description: 'สุขภาพแบต 80% ขึ้นไป ไม่ขึ้น Service', deduct: 0 },
      // 20% ตามนโยบายราคา: รุ่นต่ำกว่า 20,000 หักแบตเสื่อม ~2,000-3,500 บาท
      // (ใกล้ค่าเปลี่ยนแบตจริง) — รุ่น 20,000-30,000 ใช้ 15% (tier 14-16)
      { label: 'แบตเตอรี่เสื่อม', description: 'สุขภาพแบตต่ำกว่า 80% หรือขึ้นเตือน Service', pct: 20, failBehavior: 'deduct' },
    ] },
    SCREEN_GROUP(10, 20, 70),
    BODY_GROUP(10, 15, 25, 60),
    { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง', options: [
      { label: 'มีประกัน', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
      { label: 'หมดประกัน', description: 'พ้นระยะประกันศูนย์แล้ว', deduct: 0 },
    ] },
    REGION_TH_GROUP,
    REPAIR_GROUP,
    BOX_GROUP,
  ] },
  // iPad 2 ระดับ — เส้นแบ่งคือเมนู Battery Health (%): มีเฉพาะ iPad ปี 2024
  // ขึ้นไป (Pro M4/M5, Air M2/M3/M4, mini A17 Pro, Gen 11) รุ่นก่อนหน้านั้น
  // ลูกค้าดูเปอร์เซ็นต์เองไม่ได้ → ถามได้แค่ ดี/เสื่อม. ประกันเก็บเป็นข้อมูล
  // ไม่หัก (default — จูนรายรุ่นได้).
  battery_ipad_new: { label: 'iPad แบต % + ประกัน (รุ่นปี 2024 ขึ้นไป)', items: [
    { title: 'สุขภาพแบตเตอรี่', icon: 'battery', kind: 'functional', description: 'ดูจาก ตั้งค่า > แบตเตอรี่ > สุขภาพแบตเตอรี่ (มีในรุ่นปี 2024 ขึ้นไป)', options: [
      { label: 'สุขภาพแบต 90-100%', description: 'สุขภาพแบตเตอรี่ยังอยู่ในเกณฑ์ดี', deduct: 0 },
      { label: 'สุขภาพแบต 85-89%', description: 'เสื่อมค่อนข้างมาก เริ่มต้องชาร์จบ่อย', pct: 5, failBehavior: 'deduct' },
      { label: 'สุขภาพแบต 80-84%', description: 'เสื่อมมาก แบตหมดเร็วกว่าปกติ', pct: 10, failBehavior: 'deduct' },
      { label: 'แบตต่ำกว่า 80% (Service)', description: 'เสื่อมมาก หรือขึ้นเตือน Service ใน Settings', pct: 15, failBehavior: 'deduct' },
    ] },
    SCREEN_GROUP(4, 10, 60),
    // บอดี้ iPad หักหนักกว่า iPhone (นโยบายเจ้าของร้าน ส.ค. 2026): ตัวเครื่อง
    // อะลูมิเนียมชิ้นใหญ่ ขัดเงา/เปลี่ยนฝาไม่คุ้ม รอยเห็นชัดกว่าเครื่องเล็ก
    // และเครื่องบุบ/งอทำให้จอแตกตามได้ง่าย — ตลาดมือสองต่อราคาแรงกว่า iPhone
    BODY_GROUP(5, 15, 45, 75),
    { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง', options: [
      { label: 'มีประกัน', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
      { label: 'เหลือประกันศูนย์น้อยกว่า 6 เดือน', description: 'เหลือระยะประกันศูนย์ไม่ถึง 6 เดือน', deduct: 0 },
      { label: 'หมดประกัน', description: 'พ้นระยะประกันศูนย์แล้ว', deduct: 0 },
    ] },
    REGION_SIMPLE_GROUP,
    REPAIR_GROUP,
    BOX_GROUP,
  ] },
  battery_ipad_old: { label: 'iPad แบตดี/เสื่อม + ประกัน (ก่อนปี 2024)', items: [
    { title: 'สุขภาพแบตเตอรี่', icon: 'battery', kind: 'functional', description: 'แบตเตอรี่ยังดีหรือเสื่อม ไม่ต้องระบุเปอร์เซ็นต์', options: [
      { label: 'แบตเตอรี่ดี', description: 'ใช้งานได้ปกติ แบตไม่หมดเร็วผิดปกติ ไม่บวม', deduct: 0 },
      { label: 'แบตเตอรี่เสื่อม', description: 'แบตหมดเร็ว ชาร์จไม่เข้า บวม หรือร้อนผิดปกติ', pct: 10, failBehavior: 'deduct' },
    ] },
    SCREEN_GROUP(10, 20, 70),
    // รุ่นเก่าหักแรงกว่าชุดรุ่นใหม่ทุกขั้น ตามหลัก "เครื่องยิ่งถูก % ยิ่งสูง"
    // (ต้นทุนขัดเงา/ส่วนลดตอนขายต่อเป็นเงินบาทเกือบคงที่)
    BODY_GROUP(15, 25, 55, 75),
    { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง', options: [
      { label: 'มีประกัน', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
      { label: 'หมดประกัน', description: 'พ้นระยะประกันศูนย์แล้ว', deduct: 0 },
    ] },
    REGION_SIMPLE_GROUP,
    REPAIR_GROUP,
    BOX_GROUP,
  ] },
  // ── Mac (นโยบายเจ้าของร้าน ก.ค. 2026 — ร่าง policy อนุมัติ "ทำตามนี้ก่อน
  // ค่อยปรับทีหลัง") ──────────────────────────────────────────────────────
  // Tier ตามชิป: mac_new = M3+, mac_mid = M1-M2, mac_intel = Intel,
  // mac_imac = iMac (มีจอ ไม่มีแบต), mac_desktop = mini/Studio/Pro (ไม่มีจอ
  // ไม่มีแบต). % จอแตกหนักเท่า iPhone (ค่าเปลี่ยนชุดฝาจอศูนย์ ~15,000-25,000
  // บาท), แบตอิงสถานะ Normal/Service + Cycle Count (Mac ไม่มีเมนู % แบบ
  // iPhone), เครื่องนอกแยกตาม layout คีย์บอร์ด (คีย์ US ไม่มีสกรีนไทย
  // ขายต่อในไทยยากกว่า), เครื่องเปล่าไม่มีอะแดปเตอร์หัก 3% (อะแดปเตอร์แท้
  // 70W-140W ราคา 2,000-3,500 บาท — ต่างจาก iPhone ที่ default ไม่หัก)
  mac_new: { label: 'MacBook ชิป M3 ขึ้นไป (แบต cycle + ประกันละเอียด)', items: [
    MAC_BATTERY_GROUP(),
    MAC_SCREEN_GROUP(3, 10, 50),
    MAC_BODY_GROUP(3, 6, 12, 40),
    { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง', options: [
      { label: 'เหลือประกันศูนย์มากกว่า 6 เดือน / AppleCare+', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
      { label: 'เหลือประกันศูนย์น้อยกว่า 6 เดือน', description: 'เหลือระยะประกันศูนย์ไม่ถึง 6 เดือน', pct: 2 },
      { label: 'หมดประกันศูนย์แล้ว', description: 'พ้นระยะประกันศูนย์แล้ว', pct: 4 },
    ] },
    MAC_REGION_GROUP,
    REPAIR_GROUP,
    MAC_BOX_GROUP,
  ] },
  mac_mid: { label: 'MacBook ชิป M1-M2 (แบต cycle + ประกันไม่หัก)', items: [
    MAC_BATTERY_GROUP(),
    MAC_SCREEN_GROUP(5, 14, 60),
    MAC_BODY_GROUP(5, 9, 16, 45),
    MAC_WARRANTY_INFO_GROUP,
    MAC_REGION_GROUP,
    REPAIR_GROUP,
    MAC_BOX_GROUP,
  ] },
  mac_intel: { label: 'MacBook Intel (แบตปกติ/เสื่อม + ประกันไม่หัก)', items: [
    { title: 'สุขภาพแบตเตอรี่', icon: 'battery', kind: 'functional', description: 'ดูสถานะแบตจาก การตั้งค่า > แบตเตอรี่ และ Cycle Count ใน System Report', options: [
      { label: 'แบตปกติ (Normal)', description: 'สถานะแบต Normal ใช้งานได้ตามปกติ ไม่บวม', deduct: 0 },
      { label: 'เสื่อม / ขึ้น Service Recommended', description: 'ขึ้นสถานะ Service Recommended หรือแบตหมดเร็วผิดปกติ', pct: 18, failBehavior: 'deduct' },
    ] },
    MAC_SCREEN_GROUP(8, 20, 70),
    MAC_BODY_GROUP(8, 13, 22, 55),
    MAC_WARRANTY_INFO_GROUP,
    MAC_REGION_GROUP,
    REPAIR_GROUP,
    MAC_BOX_GROUP,
  ] },
  mac_imac: { label: 'iMac (มีจอ ไม่มีแบต)', items: [
    MAC_SCREEN_GROUP(5, 14, 60),
    MAC_BODY_GROUP(5, 9, 16, 45),
    MAC_WARRANTY_INFO_GROUP,
    MAC_REGION_GROUP,
    REPAIR_GROUP,
    MAC_BOX_GROUP,
  ] },
  mac_desktop: { label: 'Mac mini / Studio / Pro (ไม่มีจอ ไม่มีแบต)', items: [
    MAC_BODY_GROUP(5, 9, 16, 45),
    MAC_WARRANTY_INFO_GROUP,
    REGION_SIMPLE_GROUP,
    REPAIR_GROUP,
    MAC_BOX_GROUP,
  ] },
};
