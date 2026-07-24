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
    { title: 'หน้าจอ + ทัชสกรีน', icon: 'screen', description: 'ทัชสกรีนตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว', options: [OK('จอชัด ทัชลื่น ไม่มีตำหนิ'), BAD('จอเสีย / ทัชมีปัญหา', 'มีจุดดำ เส้น แสงรั่ว หรือทัชสกรีนไม่ตอบสนอง')] },
    { title: 'กล้องหน้า / กล้องหลัง', icon: 'camera', description: 'ถ่ายรูป/วิดีโอได้ ไม่มีฝ้า ไม่มีรอยร้าวที่เลนส์', options: [OK('ถ่ายได้คมชัด เลนส์ปกติ'), BAD('กล้องมีปัญหา', 'ถ่ายไม่ได้ ภาพเบลอ มีฝ้า หรือเลนส์ร้าว')] },
    { title: 'การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)', icon: 'connectivity', description: 'โทรได้ รับสายได้ เชื่อมต่อ Wi-Fi ได้ สัญญาณปกติ', options: [OK('โทร/เน็ต/Wi-Fi ใช้ได้ปกติ'), BAD('สัญญาณ / การเชื่อมต่อมีปัญหา', 'โทร/รับสายไม่ได้ ต่อ Wi-Fi ไม่ได้ หรือสัญญาณผิดปกติ')] },
    { title: 'ลำโพง / ไมโครโฟน', icon: 'audio', description: 'เสียงดังชัด ไม่มีเสียงแตก ไมค์รับเสียงได้', options: [OK('เสียงดังชัด ไมค์ปกติ'), BAD('เสียง / ไมค์มีปัญหา', 'เสียงแตก ไม่ดัง หรือไมค์รับเสียงไม่ได้')] },
    { title: 'แบตเตอรี่', icon: 'battery', description: 'แบตเตอรี่ชาร์จเข้า ใช้งานได้นานพอสมควร ไม่บวม สุขภาพแบตเตอรี่ (Battery Health) อยู่ในเกณฑ์ดี', options: [OK('แบตชาร์จเข้า อยู่ได้นาน ไม่บวม'), BAD('แบตเตอรี่เสื่อม', 'สุขภาพแบตต่ำ ไฟหมดเร็ว ชาร์จไม่เข้า หรือแบตบวม')] },
  ] },
  ipad: { label: 'iPad', items: [
    { title: 'เปิดเครื่อง / ใช้งานทั่วไป', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง', options: [OK('เปิดเครื่องได้ ใช้งานได้ตามปกติ'), BAD('เปิดไม่ติด / ค้าง / ดับเอง', 'เปิดไม่ติด หรือค้าง ดับเอง รีสตาร์ทเอง')] },
    { title: 'หน้าจอ + ทัชสกรีน', icon: 'screen', description: 'ทัชสกรีนตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว', options: [OK('จอชัด ทัชลื่น ไม่มีตำหนิ'), BAD('จอเสีย / ทัชมีปัญหา', 'มีจุดดำ เส้น แสงรั่ว หรือทัชสกรีนไม่ตอบสนอง')] },
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
  watch: { label: 'Apple Watch', items: [
    { title: 'เปิดเครื่อง / ชาร์จไฟ', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง ชาร์จแบตได้ปกติ', options: [OK('เปิดติด ชาร์จเข้า ใช้งานได้ปกติ'), BAD('เปิดไม่ติด / ชาร์จไม่เข้า', 'เปิดไม่ติด ค้าง ดับเอง หรือชาร์จไฟไม่เข้า')] },
    { title: 'หน้าจอ + ทัชสกรีน', icon: 'screen', description: 'หน้าจอสัมผัสตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีจอเบิร์น', options: [OK('จอชัด ทัชลื่น ไม่มีตำหนิ'), BAD('จอเสีย / ทัชมีปัญหา', 'มีจุดดำ เส้น จอเบิร์น หรือทัชไม่ตอบสนอง')] },
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
    { title: 'สภาพหน้าจอ', icon: 'screen', kind: 'cosmetic', description: 'รอยหรือความเสียหายของกระจกหน้าจอ', options: [
      { label: 'สวยมาก ไม่มีรอย', description: 'หน้าจอใส ไม่มีรอย ไม่มีตำหนิ', deduct: 0 },
      { label: 'มีรอยขนแมวบางๆ', description: 'รอยขนแมวเล็กน้อยบนหน้าจอ', pct: 3 },
      { label: 'มีรอยขีดข่วนเห็นชัด', description: 'มีรอยขีดข่วนบนหน้าจอที่มองเห็นได้ชัด', pct: 12 },
      { label: 'จอแตก / ร้าว', description: 'กระจกหน้าจอแตกหรือร้าว', pct: 30 },
    ] },
    { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง (ไม่มีผลต่อเกรดสภาพ)', options: [
      { label: 'เหลือประกันศูนย์ / AppleCare+', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
      { label: 'หมดประกัน', description: 'พ้นระยะประกันศูนย์แล้ว', deduct: 0 },
    ] },
  ] },
};
