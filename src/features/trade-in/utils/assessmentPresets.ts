/**
 * Curated bilingual preset catalog for condition-set text.
 *
 * Lets the admin PICK topic titles / option labels instead of writing Thai
 * and English by hand. Every TH/EN pair is drawn from (or written in the same
 * voice as) `assessmentEnSeed.ts`, which mirrors the tone-approved display
 * table used by the customer site's /en pages — professional buyback-platform
 * phrasing, approved glossary, no literal translation.
 *
 * DISPLAY-ONLY TEXT: picking a preset writes the four text fields only
 * (`title`/`title_en` + `description`/`description_en` for groups,
 * `label`/`label_en` + `description`/`description_en` for options). It never
 * touches pricing fields (`deduct` / `pct` / `failBehavior` / tiers). Thai
 * stays canonical for matching and payloads; `*_en` is display-only.
 */

export interface PresetEntry {
  th: string;
  en: string;
  desc_th?: string;
  desc_en?: string;
}

export interface PresetCategory {
  label: string;
  topics: PresetEntry[];
  options: PresetEntry[];
}

export const ASSESSMENT_PRESETS: Record<string, PresetCategory> = {
  screen: {
    label: 'สภาพหน้าจอ',
    topics: [
      { th: 'สภาพหน้าจอ', en: 'Screen condition', desc_th: 'รอยขีดข่วนหรือความเสียหายของกระจกหน้าจอ', desc_en: 'Scratches or damage on the front glass' },
      { th: 'หน้าจอ + ทัชสกรีน', en: 'Display + Touchscreen', desc_th: 'ทัชสกรีนตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว', desc_en: 'Touchscreen responds normally with no dark spots, lines, or backlight bleed' },
      { th: 'สภาพจอภาพและกระจก', en: 'Screen & Glass Condition', desc_th: 'สภาพโดยรวมของจอแสดงผลและกระจกหน้า', desc_en: 'Overall condition of the display and front glass' },
      { th: 'สภาพกระจกหลัง', en: 'Back glass condition', desc_th: 'รอยแตกหรือร้าวของกระจกฝาหลัง', desc_en: 'Chips or cracks in the back glass' },
    ],
    options: [
      { th: 'สมบูรณ์ ไร้รอยขีดข่วน', en: 'Flawless / No scratches', desc_th: 'หน้าจอใส ไม่มีรอย ไม่มีตำหนิ', desc_en: 'Clean screen with no scratches or blemishes' },
      { th: 'รอยขนแมวบางๆ (ไม่ลึก)', en: 'Minor light scratches', desc_th: 'มองเห็นเมื่อสะท้อนแสงเท่านั้น', desc_en: 'Visible only under reflected light' },
      { th: 'มีรอยขีดข่วนชัดเจน', en: 'Visible scratches', desc_th: 'มีรอยขีดข่วนบนหน้าจอที่มองเห็นได้ชัด', desc_en: 'Clearly visible scratches on the screen' },
      { th: 'จอแตก/ร้าว', en: 'Cracked/Broken screen', desc_th: 'กระจกหน้าจอแตกหรือร้าว', desc_en: 'Cracked or broken front glass' },
      { th: 'กระจกหลังแตก/ร้าว', en: 'Cracked/Broken back glass' },
      { th: 'กระจกหน้าแตก จอยังใช้งานได้ปกติ', en: 'Cracked front glass with fully functional LCD screen', desc_th: 'ทัชและการแสดงผลยังทำงานปกติ', desc_en: 'Touch and display still work normally' },
      { th: 'จอมีจุด/เม็ดสี', en: 'Spots or marks on the LCD' },
      { th: 'จอเป็นเส้น', en: 'Lines on the LCD' },
      { th: 'จอมีเงา/จอเบิร์น', en: 'Burn-in on the LCD' },
      { th: 'จอลอย/จอแยก', en: 'Screen separation', desc_th: 'ขอบจอแยกหรือลอยจากตัวเครื่อง', desc_en: 'Display lifting or separating from the frame' },
      { th: 'ทัชสกรีนใช้งานไม่ได้บางจุด', en: 'Touchscreen partially unresponsive' },
      { th: 'เปลี่ยนจอมาแล้ว', en: 'Screen previously replaced' },
    ],
  },
  body: {
    label: 'สภาพตัวเครื่อง',
    topics: [
      { th: 'สภาพตัวเครื่อง', en: 'Body condition', desc_th: 'รอย ตำหนิ หรือความเสียหายของตัวเครื่อง', desc_en: 'Scratches, blemishes, or damage on the body' },
      { th: 'สภาพตัวเครื่อง (บอดี้ / ฝาหลัง)', en: 'Body condition (body / back)', desc_th: 'รอย ตำหนิ หรือความเสียหายของตัวเครื่องและฝาหลัง', desc_en: 'Scratches, blemishes, or damage on the body and back' },
      { th: 'สภาพภายนอก', en: 'Exterior condition' },
      { th: 'สภาพขอบและมุมตัวเครื่อง', en: 'Edges & corners', desc_th: 'รอยบุบหรือบิ่นตามขอบและมุมตัวเครื่อง', desc_en: 'Dents or chips along the edges and corners' },
    ],
    options: [
      { th: 'สวยมาก ไม่มีรอย', en: 'Excellent, no marks', desc_th: 'ตัวเครื่องสวย ไม่มีรอย ไม่มีตำหนิ', desc_en: 'Clean body with no scratches or blemishes' },
      { th: 'มีรอยขนแมวบางๆ', en: 'Minor light scratches', desc_th: 'รอยขนแมวเล็กน้อย มองเห็นเมื่อสะท้อนแสง', desc_en: 'Fine scratches visible only under reflected light' },
      { th: 'มีรอยใช้งานเล็กน้อย', en: 'Light signs of use' },
      { th: 'มีรอยใช้งานชัดเจน', en: 'Noticeable signs of use such as scratches, dents, or scuffs' },
      { th: 'มีรอยเคสกัด', en: 'Case markings', desc_th: 'รอยจากการใส่เคสเป็นเวลานาน', desc_en: 'Marks left by a protective case' },
      { th: 'รอยบุบ/รอยบิ่นตามมุม', en: 'Dents/chips on corners' },
      { th: 'มีรอยตกกระแทก', en: 'Dents or impact marks' },
      { th: 'สีลอกที่ตัวเครื่อง', en: 'Paint wear on the body' },
      { th: 'มีคราบหรือสนิมที่ตัวเครื่อง', en: 'Staining or discoloration of metal' },
      { th: 'เครื่องงอ/ฝาหลังแตก', en: 'Bent body / cracked back' },
      { th: 'มีรอยสลักชื่อ/ข้อความ', en: 'Engraved', desc_th: 'มีการสลักชื่อหรือข้อความบนตัวเครื่อง', desc_en: 'Name or text engraved on the device' },
    ],
  },
  functional: {
    label: 'การทำงาน / ฟังก์ชัน',
    topics: [
      { th: 'เปิดเครื่อง / ใช้งานทั่วไป', en: 'Power / General use', desc_th: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง', desc_en: 'Turns on with no random shutdowns, freezes, or restarts' },
      { th: 'กล้องหน้า + กล้องหลัง', en: 'Front + rear cameras', desc_th: 'ถ่ายรูป/วิดีโอได้ ไม่มีฝ้า ไม่มีรอยร้าวที่เลนส์', desc_en: 'Photos and video work with no haze or cracked lens' },
      { th: 'ลำโพง / ไมโครโฟน', en: 'Speaker / Microphone', desc_th: 'เสียงดังชัด ไมค์รับเสียงได้ปกติ', desc_en: 'Clear audio and a working microphone' },
      { th: 'การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)', en: 'Connectivity (SIM / Wi-Fi / Signal)', desc_th: 'โทรได้ เชื่อมต่อ Wi-Fi ได้ สัญญาณปกติ', desc_en: 'Calls, Wi-Fi, and signal all work normally' },
      { th: 'สแกนใบหน้า (Face ID)', en: 'Face ID', desc_th: 'สแกนใบหน้าปลดล็อกได้ปกติ', desc_en: 'Face unlock works normally' },
    ],
    options: [
      { th: 'ใช้งานได้ปกติทุกฟังก์ชัน', en: 'Fully functional', desc_th: 'ไม่มีปัญหาการใช้งานใดๆ', desc_en: 'No operational defects' },
      { th: 'เปิดเครื่องได้ ใช้งานได้ตามปกติ', en: 'Turns on and works normally' },
      { th: 'เปิดไม่ติด / ค้าง / ดับเอง', en: 'Does not turn on / freezes / shuts down' },
      { th: 'Face ID ใช้งานไม่ได้', en: 'Non-working Face ID' },
      { th: 'Touch ID เสีย', en: 'Non-working Touch ID' },
      { th: 'กล้องเสีย', en: 'Non-working camera' },
      { th: 'กล้องมีฝ้า', en: 'Haze or spots in the camera' },
      { th: 'เลนส์กล้องแตก', en: 'Cracked camera lens' },
      { th: 'ลำโพงหรือไมค์เสีย', en: 'Non-working speaker or microphone' },
      { th: 'ชาร์จไม่เข้า', en: 'Does not charge', desc_th: 'เสียบสายแล้วไม่ขึ้นสถานะชาร์จ', desc_en: 'No charging indicator when plugged in' },
      { th: 'ซิมใช้งานไม่ได้', en: 'SIM not working' },
      { th: 'Wi-Fi ใช้งานไม่ได้', en: 'Non-working Wi-Fi' },
      { th: 'ตกน้ำ/โดนน้ำ', en: 'Liquid damage', desc_th: 'เครื่องเคยตกน้ำหรือมีคราบน้ำ', desc_en: 'Device has been exposed to liquid' },
      { th: 'ติดล็อค iCloud', en: 'iCloud-locked', desc_th: 'ยังไม่ได้ออกจากระบบ iCloud / Find My เปิดอยู่', desc_en: 'iCloud account still signed in / Find My enabled' },
    ],
  },
  battery: {
    label: 'แบตเตอรี่',
    topics: [
      { th: 'แบตเตอรี่', en: 'Battery', desc_th: 'ชาร์จเข้า ใช้งานได้นาน ไม่บวม', desc_en: 'Charges normally, holds a charge, no swelling' },
      { th: 'สุขภาพแบตเตอรี่', en: 'Battery health', desc_th: 'เปอร์เซ็นต์สุขภาพแบตใน Settings', desc_en: 'Battery health percentage in Settings' },
    ],
    options: [
      { th: 'สุขภาพแบต 90% ขึ้นไป', en: 'Battery health 90% or above', desc_th: 'แบตไม่ขึ้นเตือน Service ใน Settings', desc_en: 'No Service alert in Settings' },
      { th: 'สุขภาพแบต 85-89%', en: 'Battery health 85-89%' },
      { th: 'สุขภาพแบต 80-84%', en: 'Battery health 80-84%' },
      { th: 'สุขภาพแบต 70-79%', en: 'Battery health 70-79%' },
      { th: 'สุขภาพแบต 60-69%', en: 'Battery health 60-69%' },
      { th: 'สุขภาพแบตต่ำกว่า 60%', en: 'Battery health below 60%' },
      { th: 'แบตต่ำกว่า 80% (Service)', en: 'Battery below 80% (Service)', desc_th: 'แบตขึ้นเตือน Service ใน Settings', desc_en: 'Service alert shown in Settings' },
      { th: 'แบตขึ้น Service', en: 'Battery Service alert in Settings' },
      { th: 'แบตเสื่อม', en: 'Degraded battery', desc_th: 'ไฟหมดเร็วผิดปกติ', desc_en: 'Drains noticeably faster than normal' },
      { th: 'แบตบวม', en: 'Swollen battery', desc_th: 'ตัวเครื่องหรือจอโป่งจากแบตบวม', desc_en: 'Body or screen pushed out by a swollen battery' },
      { th: 'เปลี่ยนแบตมาแล้ว', en: 'Battery previously replaced' },
    ],
  },
  accessories: {
    label: 'กล่อง / อุปกรณ์',
    topics: [
      { th: 'กล่อง / อุปกรณ์', en: 'Box / Accessories', desc_th: 'อุปกรณ์ที่ให้มาพร้อมเครื่อง', desc_en: 'What is included with the device' },
      { th: 'อุปกรณ์เสริมที่นำมาด้วย', en: 'Included accessories' },
    ],
    options: [
      { th: 'ครบกล่อง (เครื่อง+สาย+กล่อง)', en: 'Complete in box (device + cable + box)', desc_th: 'กล่องตรงเครื่อง อุปกรณ์แท้ครบ', desc_en: 'Matching box with complete genuine accessories' },
      { th: 'ขาดกล่อง (มีเครื่อง+สายชาร์จ)', en: 'No box (device + charging cable)' },
      { th: 'เครื่องเปล่า (ไม่มีสาย/กล่อง)', en: 'Device only (no cable/box)' },
      { th: 'ครบกล่อง อุปกรณ์แท้ครบ', en: 'Complete in box with genuine accessories' },
      { th: 'กล่องตรงเครื่อง', en: 'Matching box included', desc_th: 'เลข Serial บนกล่องตรงกับตัวเครื่อง', desc_en: 'Serial number on the box matches the device' },
      { th: 'กล่องไม่ตรงเครื่อง', en: 'Box does not match the device' },
      { th: 'มีสายชาร์จ', en: 'Charging cable included' },
      { th: 'มีหัวชาร์จ', en: 'Power adapter included' },
      { th: 'อุปกรณ์ไม่แท้', en: 'Non-genuine accessories' },
      { th: 'ไม่มีอุปกรณ์', en: 'No accessories' },
    ],
  },
  warranty: {
    label: 'ประกัน / ประวัติซ่อม',
    topics: [
      { th: 'สถานะการรับประกัน (Warranty)', en: 'Warranty status', desc_th: 'ประกันศูนย์ Apple หรือ AppleCare+ ที่เหลืออยู่', desc_en: 'Remaining Apple warranty or AppleCare+ coverage' },
      { th: 'ประวัติการซ่อม', en: 'Repair history', desc_th: 'เครื่องเคยเปิดซ่อมหรือเปลี่ยนอะไหล่มาหรือไม่', desc_en: 'Whether the device has been opened or repaired' },
    ],
    options: [
      { th: 'เหลือประกันศูนย์มากกว่า 6 เดือน / AppleCare+', en: 'Apple warranty over 6 months left / AppleCare+' },
      { th: 'เหลือประกันศูนย์น้อยกว่า 6 เดือน', en: 'Apple warranty under 6 months left' },
      { th: 'ประกันศูนย์ Apple มากกว่า 4 เดือน', en: 'Apple warranty: over 4 months left' },
      { th: 'ประกันศูนย์ Apple น้อยกว่า 4 เดือน', en: 'Apple warranty: under 4 months left' },
      { th: 'หมดประกันศูนย์แล้ว', en: 'Out of warranty' },
      { th: 'ไม่เคยซ่อม', en: 'Never repaired', desc_th: 'เครื่องเดิมจากโรงงาน ไม่เคยเปิดซ่อม', desc_en: 'Original factory unit, never opened' },
      { th: 'ไม่เคยแกะเครื่อง ไม่เคยเปิดซ่อม', en: 'Never opened or repaired' },
      { th: 'เคยซ่อม/เปลี่ยนอะไหล่มาแล้ว', en: 'Previously repaired / parts replaced' },
      { th: 'อะไหล่แท้ทั้งหมด', en: 'All genuine parts' },
      { th: 'อะไหล่ไม่แท้', en: 'Non-genuine parts', desc_th: 'เคยเปลี่ยนอะไหล่เทียบ/ไม่แท้', desc_en: 'Repaired with third-party parts' },
    ],
  },
  model: {
    label: 'รหัสโมเดล / ประเทศ',
    topics: [
      { th: 'รหัสโมเดล (Model Identifier)', en: 'Model identifier', desc_th: 'ดูจากรหัสรุ่นท้ายใน Settings', desc_en: 'Check the model number suffix in Settings' },
      { th: 'ประเทศที่ซื้อ', en: 'Country of purchase', desc_th: 'เครื่องศูนย์ไทยหรือเครื่องนอก', desc_en: 'Thai or international model' },
    ],
    options: [
      { th: 'ศูนย์ไทย (TH/A)', en: 'Thai model (TH/A)', desc_th: 'รหัสรุ่นลงท้าย TH/A', desc_en: 'Model number ends in TH/A' },
      { th: 'ศูนย์ไทย (ZP/A)', en: 'Thai model (ZP/A)' },
      { th: 'รุ่น TH (ไทย) — TH/A, ZP/A', en: 'Thai model — TH/A, ZP/A' },
      { th: 'รุ่น US / EU / JP (ต่างประเทศ)', en: 'US / EU / JP model (international)' },
      { th: 'รุ่น CN / KR / HK (จีน/เกาหลี/ฮ่องกง)', en: 'CN / KR / HK model (China / Korea / Hong Kong)' },
      { th: 'เครื่องนอก / ต่างประเทศ', en: 'International model', desc_th: 'ใช้งานได้ปกติในไทย', desc_en: 'Works normally in Thailand' },
      { th: 'ติดล็อคเครือข่าย', en: 'Carrier-locked', desc_th: 'ใช้ซิมไทยไม่ได้', desc_en: 'Cannot use a Thai SIM' },
      { th: 'ติดแบล็คลิสต์', en: 'Blacklisted' },
      { th: 'ติดสัญญา/ติดผ่อน', en: 'Outstanding financial obligations' },
      { th: 'ไม่ติดล็อค ไม่ติดแบล็คลิสต์ ไม่ติดผ่อน', en: 'Free of any lock, carrier blacklist, or financial obligations' },
    ],
  },
  mac: {
    label: 'Mac: คีย์บอร์ด / ทัชแพด / พอร์ต / บานพับ',
    topics: [
      { th: 'คีย์บอร์ด + ทัชแพด', en: 'Keyboard + trackpad', desc_th: 'ปุ่มกดได้ทุกปุ่ม ทัชแพดคลิกและเลื่อนได้ปกติ', desc_en: 'All keys respond and the trackpad clicks and tracks normally' },
      { th: 'พอร์ตเชื่อมต่อ', en: 'Ports', desc_th: 'พอร์ต USB-C/Thunderbolt ใช้งานได้ครบ', desc_en: 'All USB-C/Thunderbolt ports working' },
    ],
    options: [
      { th: 'คีย์บอร์ดใช้งานได้ปกติ', en: 'Keyboard works normally', desc_th: 'กดได้ทุกปุ่ม ไม่มีปุ่มค้าง', desc_en: 'All keys respond with none stuck' },
      { th: 'คีย์บอร์ดเสีย', en: 'Non-working keyboard' },
      { th: 'ปุ่มคีย์บอร์ดหลุด/หาย', en: 'Missing or detached keycaps' },
      { th: 'ทัชแพดใช้งานได้ปกติ', en: 'Trackpad works normally' },
      { th: 'ทัชแพดเสีย', en: 'Non-working trackpad' },
      { th: 'พอร์ตใช้งานได้ครบทุกพอร์ต', en: 'All ports working' },
      { th: 'พอร์ตเสียบางพอร์ต', en: 'Some ports not working' },
      { th: 'บานพับหลวม', en: 'Loose hinge' },
      { th: 'บานพับเสีย', en: 'Broken hinge' },
      { th: 'ครบกล่อง (เครื่อง+ที่ชาร์จ+กล่อง)', en: 'Complete in box (device + charger + box)' },
      { th: 'ขาดกล่อง (มีเครื่อง+ที่ชาร์จ)', en: 'No box (device + charger)' },
      { th: 'เครื่องเปล่า (ไม่มีที่ชาร์จ/กล่อง)', en: 'Device only (no charger/box)' },
    ],
  },
  watch: {
    label: 'Watch: เม็ดมะยม / สาย / เซ็นเซอร์',
    topics: [
      { th: 'เม็ดมะยม (Digital Crown)', en: 'Digital Crown', desc_th: 'หมุนได้ลื่น กดได้ปกติ ไม่ค้าง', desc_en: 'Rotates smoothly and clicks without sticking' },
      { th: 'สายนาฬิกา', en: 'Watch band' },
      { th: 'เซ็นเซอร์ (วัดชีพจร ฯลฯ)', en: 'Sensors (heart rate, etc.)', desc_th: 'เซ็นเซอร์วัดชีพจรและตรวจจับการสวมใส่ทำงานปกติ', desc_en: 'Heart rate and wrist-detection sensors work normally' },
    ],
    options: [
      { th: 'เม็ดมะยมใช้งานได้ปกติ', en: 'Digital Crown works normally', desc_th: 'หมุนได้ลื่น ไม่ติดขัด', desc_en: 'Rotates smoothly without sticking' },
      { th: 'เม็ดมะยมเสีย', en: 'Non-working Digital Crown' },
      { th: 'เซ็นเซอร์วัดชีพจรทำงานปกติ', en: 'Heart rate sensor works normally' },
      { th: 'เซ็นเซอร์วัดชีพจรไม่ทำงาน', en: 'Non-working heart rate sensor' },
      { th: 'มีสายนาฬิกา', en: 'Watch band included' },
      { th: 'ไม่มีสายนาฬิกา', en: 'No watch band' },
      { th: 'สายแท้', en: 'Genuine band', desc_th: 'สาย Apple แท้', desc_en: 'Genuine Apple band' },
      { th: 'สายไม่แท้', en: 'Non-genuine band' },
    ],
  },
};
