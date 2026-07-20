import type { ConditionSetGroup } from './conditionSets';

/**
 * Thai -> English seed table for condition-set labels.
 *
 * MIRRORS `EN_ASSESSMENT_EXACT` in bkk-frontend-next `app/i18n/dataDisplay.tsx`
 * (the canonical display-fallback table the customer site uses on /en) minus
 * the variant-picker attribute keys, which are not condition-set text. When a
 * pair is added/changed there, update it here too — and vice versa.
 *
 * Used only by the "เติมคำแปลอัตโนมัติ" button in EngineSettingsModal to
 * PRE-FILL empty `*_en` fields for admin review. Thai stays canonical; the
 * English values are display-only (never used for matching or payloads).
 */
export const ASSESSMENT_EN_SEED: Record<string, string> = {
  // Topics / groups
  'เปิดเครื่อง / ใช้งานทั่วไป': 'Power / General use',
  'เปิดเครื่อง': 'Power',
  'หน้าจอ': 'Display',
  'จอแสดงผล': 'Display',
  'สภาพหน้าจอ': 'Screen condition',
  'สภาพตัวเครื่อง': 'Body condition',
  'สภาพภายนอก': 'Exterior condition',
  'กล้อง': 'Camera',
  'กล้องหน้า': 'Front camera',
  'กล้องหลัง': 'Rear camera',
  'แบตเตอรี่': 'Battery',
  'สุขภาพแบตเตอรี่': 'Battery health',
  'ระบบเสียง': 'Audio',
  'ลำโพง / ไมโครโฟน': 'Speaker / Microphone',
  'การเชื่อมต่อ': 'Connectivity',
  'ระบบสแกน Face ID / Touch ID': 'Face ID / Touch ID',
  'อุปกรณ์เสริม': 'Accessories',
  'อุปกรณ์ในกล่อง': 'In-box accessories',
  'กล่อง / อุปกรณ์': 'Box / Accessories',
  // Cosmetic topics (iPad/Mac/Watch condition sets)
  'สภาพจอภาพและกระจก': 'Screen & Glass Condition',
  'สภาพจอภาพ': 'Screen condition',
  'สภาพกระจกหลัง': 'Back glass condition',
  'สภาพตัวเครื่องและฝาหลัง': 'Body & back condition',
  'สภาพโดยรวม': 'Overall condition',
  'สภาพขอบและมุมตัวเครื่อง': 'Edges & corners',
  // Topics seen in the live iPhone condition set
  'หน้าจอ + ทัชสกรีน': 'Display + Touchscreen',
  'การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)': 'Connectivity (SIM / Wi-Fi / Signal)',
  'กล้องหน้า + กล้องหลัง': 'Front + rear cameras',
  'ลำโพง + ไมโครโฟน': 'Speaker + microphone',
  'ลำโพง / ไมค์': 'Speaker / mic',
  'สแกนใบหน้า (Face ID)': 'Face ID',
  'สภาพหน้าจอ (รอยขีดข่วน)': 'Screen condition (scratches)',
  'สภาพรอบตัวเครื่อง': 'Body condition',
  'อุปกรณ์เสริมที่นำมาด้วย': 'Included accessories',
  'รหัสโมเดล (Model Identifier)': 'Model identifier',
  'รหัสโมเดล': 'Model identifier',
  'สถานะการรับประกัน (Warranty)': 'Warranty status',
  'สถานะการรับประกัน': 'Warranty status',
  'ประวัติการซ่อมหรือเปลี่ยนชิ้นส่วนอะไหล่': 'Repair / parts replacement history',
  'ประวัติการซ่อม': 'Repair history',
  // Options
  'ปกติ / ใช้งานได้': 'Works normally',
  'ใช้งานได้ปกติ': 'Works normally',
  'มีปัญหา / ใช้งานไม่ได้': 'Has an issue / not working',
  'สมบูรณ์ ไร้รอยตำหนิ': 'Flawless / No blemishes',
  'มีรอยขนแมว/รอยเคสกัด/รอยสีลอก': 'Light scratches / case marks / paint wear',
  'รอยบุบ/รอยบิ่นตามมุม': 'Dents/chips on corners',
  'เครื่องงอ/ฝาหลังแตก': 'Bent body / cracked back',
  'สุขภาพแบต 90% ขึ้นไป': 'Battery health 90% or above',
  'สุขภาพแบต 85-89%': 'Battery health 85-89%',
  'สุขภาพแบต 80-84%': 'Battery health 80-84%',
  'แบตต่ำกว่า 80% (Service)': 'Battery below 80% (Service)',
  'รุ่น TH (ไทย) — TH/A, ZP/A': 'Thai model — TH/A, ZP/A',
  'รุ่น US / EU / JP (ต่างประเทศ)': 'US / EU / JP model (international)',
  'รุ่น CN / KR / HK (จีน/เกาหลี/ฮ่องกง)': 'CN / KR / HK model (China / Korea / Hong Kong)',
  'ประกันศูนย์ Apple มากกว่า 4 เดือน': 'Apple warranty: over 4 months left',
  'ประกันศูนย์ Apple น้อยกว่า 4 เดือน': 'Apple warranty: under 4 months left',
  'หมดประกันศูนย์แล้ว': 'Out of warranty',
  'ไม่เคยผ่านการซ่อม/ไม่มีประวัติการซ่อม': 'Never repaired / no repair history',
  'เคยซ่อม/เปลี่ยนอะไหล่มาแล้ว': 'Previously repaired / parts replaced',
  'ครบกล่อง (เครื่อง+สาย+กล่อง)': 'Complete in box (device + cable + box)',
  'ขาดกล่อง (มีเครื่อง+สายชาร์จ)': 'No box (device + charging cable)',
  'เครื่องเปล่า (ไม่มีสาย/กล่อง)': 'Device only (no cable/box)',
  // Mac condition-set variants
  'ครบกล่อง (เครื่อง+ที่ชาร์จ+กล่อง)': 'Complete in box (device + charger + box)',
  'ขาดกล่อง (มีเครื่อง+ที่ชาร์จ)': 'No box (device + charger)',
  'เครื่องเปล่า (ไม่มีที่ชาร์จ/กล่อง)': 'Device only (no charger/box)',
  'คีย์บอร์ด': 'Keyboard',
  'คีย์บอร์ด + ทัชแพด': 'Keyboard + trackpad',
  'คีย์บอร์ด ภาษาไทย / อังกฤษ': 'Thai / English keyboard',
  'คีย์บอร์ดภาษาไทย/อังกฤษ': 'Thai / English keyboard',
  'คีย์บอร์ดภาษาอังกฤษ': 'English keyboard',
  'สมบูรณ์ ไร้รอยขีดข่วน': 'Flawless / No scratches',
  'สมบูรณ์ ไม่มีตำหนิ': 'Flawless / No blemishes',
  'รอยขนแมวบางๆ (ไม่ลึก)': 'Minor light scratches',
  'รอยขนแมวบางๆ': 'Minor light scratches',
  'รอยขีดข่วนลึก/เห็นชัด': 'Deep/Visible scratches',
  'จอแตก/ร้าว': 'Cracked/Broken screen',
  'กระจกหลังแตก/ร้าว': 'Cracked/Broken back glass',
  'มีรอยบุบ/บิ่น': 'Dents/chips',
  'ไม่มีรอย': 'No scratches',
  'ไม่มีตำหนิ': 'No blemishes',
  'มีรอยขีดข่วนเล็กน้อย': 'Light scratches',
  'มีรอยขีดข่วนชัดเจน': 'Visible scratches',
  'มีรอยบุบ / แตก': 'Dents / cracks',
  'ครบกล่อง': 'Complete in box',
  'ไม่มีกล่อง': 'No box',
  'เครื่องเปล่า': 'Device only',
  // Strings from the July admin revision of the live condition sets
  'ปกติ': 'Normal',
  'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง': 'Turns on — no random shutdowns, freezes, or restarts',
  'เปิดเครื่องได้ ใช้งานได้ตามปกติ': 'Turns on and works normally',
  'เปิดไม่ติด / ค้าง / ดับเอง': 'Does not turn on / freezes / shuts down',
  'เปิดไม่ติด หรือค้าง ดับเอง รีสตาร์ทเอง': 'Does not turn on, freezes, shuts down, or restarts by itself',
  'ไม่เคยซ่อม': 'Never repaired',
  'เคยซ่อม': 'Previously repaired',
  'ประเทศที่ซื้อ': 'Country of purchase',
  'ศูนย์ไทย (ZP/A)': 'Thai model (ZP/A)',
  'ศูนย์ไทย (TH/A)': 'Thai model (TH/A)',
  'เครื่องนอก / ต่างประเทศ': 'International model',
  'สภาพตัวเครื่อง (บอดี้ / ฝาหลัง)': 'Body condition (body / back)',
  'สวยมาก ไม่มีรอย': 'Excellent, no marks',
  'ประกัน': 'Warranty',
  'เหลือประกันศูนย์มากกว่า 6 เดือน / AppleCare+': 'Apple warranty over 6 months left / AppleCare+',
  'เหลือประกันศูนย์น้อยกว่า 6 เดือน': 'Apple warranty under 6 months left',
  'หมดประกัน': 'Out of warranty',
  // Condition-grade summary labels (utils/conditionGrade.ts) shown on the
  // checkout device card
  'สภาพดีเยี่ยม ไม่มีรอย': 'Excellent condition, no scratches',
  'สภาพดี มีรอยขนแมวบาง': 'Good condition, light scratches',
  'มีตำหนิเห็นได้ชัด': 'Visible blemishes',
  'มีความเสียหาย/อะไหล่ไม่แท้': 'Damaged / non-genuine parts',
};

/** Seed lookup on a trimmed Thai string; '' / unknown -> undefined. */
const seedFor = (thai: unknown): string | undefined =>
  typeof thai === 'string' ? ASSESSMENT_EN_SEED[thai.trim()] : undefined;

const isEmpty = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

/**
 * Pre-fill empty `*_en` fields of a condition set's groups from
 * ASSESSMENT_EN_SEED (exact match on the trimmed Thai value). Pure: returns a
 * NEW groups array plus how many fields were filled. NEVER overwrites an
 * existing non-empty `*_en` value; unknown Thai strings are left untouched.
 */
export function fillEnFields(groups: ConditionSetGroup[]): { groups: ConditionSetGroup[]; filled: number } {
  let filled = 0;
  const next = (groups || []).map((g) => {
    const ng: ConditionSetGroup = { ...g };
    if (isEmpty(ng.title_en)) {
      const en = seedFor(ng.title);
      if (en) { ng.title_en = en; filled++; }
    }
    if (isEmpty(ng.description_en)) {
      const en = seedFor(ng.description);
      if (en) { ng.description_en = en; filled++; }
    }
    ng.options = (g.options || []).map((o) => {
      const no = { ...o };
      if (isEmpty(no.label_en)) {
        const en = seedFor(no.label);
        if (en) { no.label_en = en; filled++; }
      }
      if (isEmpty(no.description_en)) {
        const en = seedFor(no.description);
        if (en) { no.description_en = en; filled++; }
      }
      return no;
    });
    return ng;
  });
  return { groups: next, filled };
}
