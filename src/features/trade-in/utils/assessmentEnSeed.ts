import type { ConditionSetGroup } from './conditionSets';

/**
 * Thai -> English seed table for condition-set labels.
 *
 * MIRRORS `EN_ASSESSMENT_EXACT` in bkk-frontend-next `app/i18n/dataDisplay.tsx`
 * (the canonical display-fallback table the customer site uses on /en) minus
 * the variant-picker attribute keys, which are not condition-set text. The
 * parts map (`ASSESSMENT_EN_PARTS`) mirrors `EN_ASSESSMENT_PARTS` and the
 * compositional engine in `translateAssessmentText` mirrors
 * `localizeAssessmentText` there. When a pair or engine rule is added/changed
 * there, update it here too — and vice versa.
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
  // --- Expanded vocabulary (native buyback-industry phrasing) ---------------
  // Condition tiers
  'ใหม่': 'New',
  'เหมือนใหม่': 'Like New',
  'สภาพเหมือนใหม่': 'Like New',
  'พอใช้': 'Fair',
  'สภาพพอใช้': 'Fair condition',
  'ชำรุด': 'Damaged',
  'เสีย': 'Broken',
  // Cosmetic grades
  'สภาพนางฟ้า': 'Like new condition',
  'สภาพนางฟ้า ไม่มีรอย': 'Like new, no scratches',
  'สวยมาก': 'Excellent condition',
  'สภาพสวยมาก': 'Excellent condition',
  'สภาพดีมาก': 'Very good condition',
  'สภาพดี': 'Good condition',
  'มีรอยใช้งานเล็กน้อย': 'Light signs of use',
  'มีรอยใช้งานทั่วไป': 'Normal signs of use',
  'มีรอยใช้งานชัดเจน': 'Noticeable signs of use such as scratches, dents, or scuffs',
  'มีตำหนิชัดเจน': 'Visible blemishes',
  'มีรอยเคสกัด': 'Case markings',
  'มีรอยตกกระแทก': 'Dents or impact marks',
  'สภาพโดยรวมดี ไม่มีรอยใช้งาน': 'Overall good cosmetic condition with no signs of use',
  'ไม่มีรอยแตกหรือร้าว': 'No chips or cracks',
  'กระจกหน้าและกระจกหลังไม่มีรอยแตกร้าว': 'No chips or cracks in front or back glass',
  'มือหนึ่ง ยังไม่แกะซีล': 'Brand new, sealed in box',
  'ของใหม่ ไม่เคยใช้งาน': 'Brand new, never used',
  // Screen / glass damage
  'กระจกหน้าแตก': 'Cracked front glass',
  'กระจกหน้าแตก/ร้าว': 'Cracked front glass',
  'กระจกหลังแตก': 'Cracked back glass',
  'กระจกหน้าหรือกระจกหลังแตก': 'Cracked front or back glass',
  'กระจกหน้าแตก จอยังใช้งานได้ปกติ': 'Cracked front glass with fully functional LCD screen',
  'กระจกแตกแต่จอใช้งานได้ปกติ': 'Cracked front or back glass with fully functional LCD screen',
  'จอลอย': 'Screen separation',
  'จอแยก': 'Screen separation',
  'จอลอย/จอแยก': 'Screen separation',
  'จอเบิร์น': 'Burn-in on the LCD',
  'จอมีเงา/จอเบิร์น': 'Burn-in on the LCD',
  'จอมีจุด': 'Spots or marks on the LCD',
  'จอมีเม็ดสี': 'Spots or marks on the LCD',
  'จอมีจุด/เม็ดสี': 'Spots or marks on the LCD',
  'จอเป็นเส้น': 'Lines on the LCD',
  'จอมีเส้น': 'Lines on the LCD',
  'จอไม่มีจุด ไม่มีเส้น ไม่มีเบิร์น': 'No spots, marks, or burn-in on the LCD',
  'ทัชไม่ได้บางจุด': 'Touchscreen partially unresponsive',
  'ทัชสกรีนใช้งานไม่ได้บางจุด': 'Touchscreen partially unresponsive',
  'ทัชไม่ได้': 'Touchscreen not working',
  'ทัชสกรีนใช้งานไม่ได้': 'Touchscreen not working',
  'เปลี่ยนจอมาแล้ว': 'Screen previously replaced',
  'เปลี่ยนจอไม่แท้': 'Non-genuine replacement screen',
  // Power / general function
  'เปิดไม่ติด': 'Does not power on',
  'เครื่องเปิดไม่ติด': 'Does not power on',
  'เปิดเครื่องไม่ได้': 'Does not power on',
  'เครื่องดับเอง': 'Shuts down unexpectedly',
  'เครื่องรีสตาร์ทเอง': 'Restarts by itself',
  'เครื่องค้าง': 'Freezes',
  'แอคทิเวทไม่ได้': 'Does not activate',
  'ใช้งานได้สมบูรณ์ ไม่มีปัญหาการใช้งาน': 'Fully functional with no operational defects',
  'ทุกฟังก์ชันใช้งานได้ปกติ': 'Fully functional',
  'ใช้งานได้ปกติทุกฟังก์ชัน': 'Fully functional',
  // Biometrics
  'Face ID เสีย': 'Non-working Face ID',
  'Face ID ใช้งานไม่ได้': 'Non-working Face ID',
  'สแกนหน้าไม่ได้': 'Non-working Face ID',
  'Touch ID เสีย': 'Non-working Touch ID',
  'สแกนนิ้วไม่ได้': 'Non-working fingerprint sensor',
  'สแกนใบหน้าหรือสแกนนิ้วไม่ได้': 'Non-working Face ID or fingerprint sensor',
  // Liquid damage
  'โดนน้ำ': 'Liquid damage',
  'ตกน้ำ': 'Liquid damage',
  'มีคราบน้ำ': 'Liquid damage',
  'เครื่องเคยโดนน้ำ': 'Liquid damage',
  'ตกน้ำ/โดนน้ำ': 'Liquid damage',
  // Body / metal
  'มีสนิม': 'Rust or corrosion',
  'มีคราบหรือสนิมที่ตัวเครื่อง': 'Staining or discoloration of metal',
  'ตัวเครื่องมีคราบ/สีลอก': 'Staining or discoloration of metal',
  'สีลอกที่ตัวเครื่อง': 'Paint wear on the body',
  'เครื่องงอ': 'Bent body',
  'มีรอยสลัก': 'Engraved',
  'สลักชื่อ': 'Engraved',
  'มีรอยสลักชื่อ/ข้อความ': 'Engraved',
  // Camera
  'เลนส์กล้องแตก': 'Cracked camera lens',
  'กระจกเลนส์กล้องแตก': 'Cracked camera lens',
  'กล้องมีฝ้า': 'Haze or spots in the camera',
  'กล้องเสีย': 'Non-working camera',
  'กล้องหน้าเสีย': 'Non-working front camera',
  'กล้องหลังเสีย': 'Non-working rear camera',
  // Audio / connectivity / hardware
  'ลำโพงเสีย': 'Non-working speaker',
  'ไมค์เสีย': 'Non-working microphone',
  'ลำโพงหรือไมค์เสีย': 'Non-working speaker or microphone',
  'ชาร์จไม่เข้า': 'Does not charge',
  'พอร์ตชาร์จเสีย': 'Non-working charging port',
  'ปุ่มกดเสีย': 'Non-working buttons',
  'ระบบสั่นเสีย': 'Non-working vibration',
  'Wi-Fi ใช้งานไม่ได้': 'Non-working Wi-Fi',
  'ไม่มีสัญญาณ': 'No signal',
  'ซิมใช้งานไม่ได้': 'SIM not working',
  // Locks / obligations
  'ติดล็อค iCloud': 'iCloud-locked',
  'ติด iCloud': 'iCloud-locked',
  'ติดล็อคเครือข่าย': 'Carrier-locked',
  'ติดล็อคซิม': 'Carrier-locked',
  'ติดแบล็คลิสต์': 'Blacklisted',
  'ติดล็อคเครือข่าย/ติดแบล็คลิสต์': 'Carrier-locked or blacklisted',
  'ติดสัญญา': 'Outstanding financial obligations',
  'ติดผ่อน': 'Outstanding financial obligations',
  'ติดสัญญา/ติดผ่อน': 'Outstanding financial obligations',
  'ไม่ติดล็อค ไม่ติดแบล็คลิสต์ ไม่ติดผ่อน': 'Free of any lock, carrier blacklist, or financial obligations',
  'ไม่ติดสัญญา/ไม่ติดผ่อน': 'No outstanding financial obligations',
  // Battery
  'สุขภาพแบต 90% ขึ้นไป ไม่ขึ้น Service': 'Battery health 90% or above with no Service alert',
  'สุขภาพแบตอย่างน้อย 90% ไม่ขึ้น Service': 'Battery health at least 90% with no Service alert in Settings',
  'สุขภาพแบต 70-79%': 'Battery health 70-79%',
  'สุขภาพแบต 60-69%': 'Battery health 60-69%',
  'สุขภาพแบต 60-80%': 'Battery health 60-80%',
  'สุขภาพแบตต่ำกว่า 60%': 'Battery health below 60%',
  'แบตขึ้น Service': 'Battery Service alert in Settings',
  'แบตเสื่อม': 'Degraded battery',
  'แบตบวม': 'Swollen battery',
  'เปลี่ยนแบตมาแล้ว': 'Battery previously replaced',
  // Box / accessories
  'มีกล่อง': 'Box included',
  'กล่องตรงเครื่อง': 'Matching box included',
  'กล่องไม่ตรงเครื่อง': 'Box does not match the device',
  'มีสายชาร์จ': 'Charging cable included',
  'มีหัวชาร์จ': 'Power adapter included',
  'มีอะแดปเตอร์': 'Power adapter included',
  'ครบกล่อง อุปกรณ์แท้ครบ': 'Complete in box with genuine accessories',
  'อุปกรณ์แท้จาก Apple': 'Genuine Apple accessories',
  'อุปกรณ์ไม่แท้': 'Non-genuine accessories',
  'ไม่มีอุปกรณ์': 'No accessories',
  // Repair / parts history
  'ไม่เคยแกะเครื่อง ไม่เคยเปิดซ่อม': 'Never opened or repaired',
  'อะไหล่แท้ทั้งหมด': 'All genuine parts',
  'อะไหล่ไม่แท้': 'Non-genuine parts',
  // Mac (keyboard / trackpad / ports)
  'คีย์บอร์ดเสีย': 'Non-working keyboard',
  'คีย์บอร์ดใช้งานได้ปกติ': 'Keyboard works normally',
  'ทัชแพด': 'Trackpad',
  'ทัชแพดเสีย': 'Non-working trackpad',
  'ทัชแพดใช้งานได้ปกติ': 'Trackpad works normally',
  'ปุ่มคีย์บอร์ดหลุด/หาย': 'Missing or detached keycaps',
  'พอร์ตเชื่อมต่อ': 'Ports',
  'พอร์ตใช้งานได้ครบทุกพอร์ต': 'All ports working',
  'พอร์ตเสียบางพอร์ต': 'Some ports not working',
  'บานพับหลวม': 'Loose hinge',
  'บานพับเสีย': 'Broken hinge',
  // Apple Watch
  'เม็ดมะยม': 'Digital Crown',
  'เม็ดมะยม (Digital Crown)': 'Digital Crown',
  'เม็ดมะยมเสีย': 'Non-working Digital Crown',
  'เม็ดมะยมใช้งานได้ปกติ': 'Digital Crown works normally',
  'สายนาฬิกา': 'Watch band',
  'มีสายนาฬิกา': 'Watch band included',
  'ไม่มีสายนาฬิกา': 'No watch band',
  'สายแท้': 'Genuine band',
  'สายไม่แท้': 'Non-genuine band',
};

/**
 * Piece-wise vocabulary for "A / B" and "A + B" style labels whose whole
 * string has no exact pair. MIRRORS `EN_ASSESSMENT_PARTS` in bkk-frontend-next
 * `app/i18n/dataDisplay.tsx` — keep the two maps in sync.
 */
export const ASSESSMENT_EN_PARTS: Record<string, string> = {
  'ปกติ': 'Normal',
  'ใช้งานได้': 'working',
  'ใช้งานทั่วไป': 'General use',
  'มีปัญหา': 'Has an issue',
  'ใช้งานไม่ได้': 'not working',
  'จอ': 'Screen',
  'หน้าจอ': 'Display',
  'ทัชสกรีน': 'Touchscreen',
  'ตัวเครื่อง': 'Body',
  'ฝาหลัง': 'Back',
  'ซิม': 'SIM',
  'สัญญาณ': 'Signal',
  'กล้องหน้า': 'Front camera',
  'กล้องหลัง': 'Rear camera',
  'ลำโพง': 'Speaker',
  'ไมโครโฟน': 'Microphone',
  'ไมค์': 'Mic',
  'แฟลช': 'Flash',
  'สั่น': 'Vibration',
  'ปุ่มกด': 'Buttons',
  // Expanded parts vocabulary
  'กระจกหน้า': 'front glass',
  'กระจกหลัง': 'back glass',
  'กระจก': 'glass',
  'เลนส์กล้อง': 'camera lens',
  'คราบ': 'staining',
  'คราบน้ำ': 'liquid damage',
  'สนิม': 'rust',
  'สีลอก': 'paint wear',
  'จอเบิร์น': 'burn-in',
  'โดนน้ำ': 'liquid damage',
  'ตกน้ำ': 'liquid damage',
  'ค้าง': 'freezes',
  'ดับเอง': 'shuts down',
  'รีสตาร์ทเอง': 'restarts by itself',
  'รอยบุบ': 'dents',
  'รอยบิ่น': 'chips',
  'รอยขีดข่วน': 'scratches',
  'รอยขนแมว': 'light scratches',
  'แตก': 'cracked',
  'ร้าว': 'cracked',
  'พอร์ตชาร์จ': 'charging port',
  'สายชาร์จ': 'charging cable',
  'หัวชาร์จ': 'power adapter',
  'อะแดปเตอร์': 'power adapter',
  'กล่อง': 'box',
  'หูฟัง': 'earphones',
};

/** Trim + collapse internal whitespace so lookups match the seed keys. */
const normalizeThai = (s: string): string => s.trim().replace(/\s+/g, ' ');

// A part resolves if it maps directly or is already English/ASCII (Wi-Fi,
// Face ID, 256GB...). Mirrors `resolvePart` in dataDisplay.tsx (minus the
// runtime admin registry, which does not exist on the admin side).
function resolvePart(part: string): string | null {
  const p = normalizeThai(part);
  if (!p) return null;
  const mapped = ASSESSMENT_EN_SEED[p] || ASSESSMENT_EN_PARTS[p];
  if (mapped) return mapped;
  // eslint-disable-next-line no-control-regex -- same ASCII test as dataDisplay.tsx
  if (/^[\x00-\x7F]+$/.test(p)) return p; // already English/ASCII
  return null;
}

function trySeparated(text: string, sep: ' / ' | ' + '): string | null {
  if (!text.includes(sep)) return null;
  const parts = text.split(sep).map(resolvePart);
  if (parts.some((p) => p === null)) return null;
  return parts.join(sep);
}

/**
 * Compositional Thai -> English translation for condition-set text. Mirrors
 * the engine in `localizeAssessmentText` (bkk-frontend-next dataDisplay.tsx):
 * exact pair -> "head (inner)" parenthetical -> battery-health patterns ->
 * part-wise ' / ' and ' + ' splits. FAIL-CLOSED: returns null unless the
 * WHOLE string resolves — never emits mixed Thai/English output.
 */
export function translateAssessmentText(thai: string): string | null {
  const trimmed = normalizeThai(thai || '');
  if (!trimmed) return null;
  const exact = ASSESSMENT_EN_SEED[trimmed];
  if (exact) return exact;

  // "หัวข้อ (รายละเอียด)" — translate head and the details inside the parens
  // independently, e.g. "การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)".
  const paren = trimmed.match(/^(.+?)\s*\((.+)\)$/);
  if (paren) {
    const head = resolvePart(paren[1]) ?? trySeparated(paren[1], ' / ') ?? trySeparated(paren[1], ' + ');
    const inner = resolvePart(paren[2]) ?? trySeparated(paren[2], ' / ') ?? trySeparated(paren[2], ' + ');
    if (head && inner) return `${head} (${inner})`;
  }

  // Battery-health option patterns: "สุขภาพแบต 85-89%", "สุขภาพแบต 90% ขึ้นไป",
  // "แบตต่ำกว่า 80%", "แบตเตอรี่ 90% - 100%".
  const bh = trimmed.match(/^สุขภาพแบต(?:เตอรี่)?\s*(.+)$/);
  if (bh) {
    const tail = bh[1].replace('ขึ้นไป', 'or above').trim();
    if (!/[ก-๙]/.test(tail)) return `Battery health ${tail}`;
  }
  const bl = trimmed.match(/^แบต(?:เตอรี่)?ต่ำกว่า\s*(.+)$/);
  if (bl && !/[ก-๙]/.test(bl[1])) return `Battery below ${bl[1].trim()}`;
  const bp = trimmed.match(/^แบต(?:เตอรี่)?\s+(\d.*)$/);
  if (bp && !/[ก-๙]/.test(bp[1])) return `Battery ${bp[1].trim()}`;

  return trySeparated(trimmed, ' / ') ?? trySeparated(trimmed, ' + ');
}

/** Engine lookup on a Thai field value; ''/non-string/unresolvable -> undefined. */
const seedFor = (thai: unknown): string | undefined =>
  typeof thai === 'string' ? translateAssessmentText(thai) ?? undefined : undefined;

const isEmpty = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

/**
 * Pre-fill empty `*_en` fields of a condition set's groups via
 * `translateAssessmentText` (exact pairs + compositional engine). Pure:
 * returns a NEW groups array plus how many fields were filled. NEVER
 * overwrites an existing non-empty `*_en` value; Thai strings the engine
 * cannot fully resolve are left untouched.
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
