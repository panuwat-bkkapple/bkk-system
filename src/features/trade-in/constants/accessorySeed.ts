// One-time seed catalog for iPad accessories (Apple Pencil / Magic Keyboard).
//
// PriceEditor runs this when the "Tablet Accessories" category exists but has
// no models yet (mirrors the seedDefaultCategories pattern — idempotent,
// admin-session write so it passes the DB rules). Everything seeds as
// isActive: false ("งดรับซื้อ") with STARTING prices — admin reviews the
// prices and activates each model before it is offered anywhere (inactive
// models are filtered out of every add-on picker, client and server).
//
// compatible_series is resolved at seed time against the store's REAL iPad
// series names (category Tablets) via keyword kinds — pro / air / mini /
// standard. A kind list that matches nothing seeds as null (= ทุกรุ่น) so a
// rename never silently hides an accessory; physical check happens at intake.
import { ACCESSORY_CATEGORY } from '../../../utils/accessoryItems';
import { CATEGORY_SCHEMAS } from './categorySchemas';

type SeriesKind = 'pro' | 'air' | 'mini' | 'standard';

interface AccessorySeedDef {
  name: string;
  alias_th: string;
  alias_en?: string;
  usedPrice: number;
  newPrice: number;
  /** ว่าง = ใช้ร่วมกับ iPad ทุกรุ่น */
  kinds: SeriesKind[];
}

// ราคา = ราคารับซื้อตั้งต้น (บาท) — ตลาดมือสองไทย ก.ค. 2026 โดยประมาณ.
// แอดมินต้องตรวจ/ปรับก่อนกด Activate.
const ACCESSORY_SEED_DEFS: AccessorySeedDef[] = [
  { name: 'Apple Pencil (1st generation)', alias_th: 'ปากกาไอแพด รุ่น 1', alias_en: 'Apple Pencil 1', usedPrice: 800, newPrice: 1500, kinds: ['standard', 'air', 'mini'] },
  { name: 'Apple Pencil (2nd generation)', alias_th: 'ปากกาไอแพด รุ่น 2', alias_en: 'Apple Pencil 2', usedPrice: 1800, newPrice: 2800, kinds: ['pro', 'air', 'mini'] },
  { name: 'Apple Pencil (USB-C)', alias_th: 'ปากกาไอแพด USB-C', usedPrice: 1300, newPrice: 2000, kinds: [] },
  { name: 'Apple Pencil Pro', alias_th: 'ปากกาไอแพดโปร', usedPrice: 2500, newPrice: 3500, kinds: ['pro', 'air', 'mini'] },
  { name: 'Smart Keyboard Folio 11"', alias_th: 'สมาร์ทคีย์บอร์ด 11 นิ้ว', usedPrice: 1800, newPrice: 3000, kinds: ['pro', 'air'] },
  { name: 'Smart Keyboard Folio 12.9"', alias_th: 'สมาร์ทคีย์บอร์ด 12.9 นิ้ว', usedPrice: 2200, newPrice: 3500, kinds: ['pro'] },
  { name: 'Magic Keyboard 11"', alias_th: 'เมจิกคีย์บอร์ด 11 นิ้ว', usedPrice: 4000, newPrice: 6000, kinds: ['pro', 'air'] },
  { name: 'Magic Keyboard 13"', alias_th: 'เมจิกคีย์บอร์ด 13 นิ้ว', alias_en: 'Magic Keyboard 12.9', usedPrice: 4500, newPrice: 6500, kinds: ['pro', 'air'] },
  { name: 'Magic Keyboard Folio', alias_th: 'เมจิกคีย์บอร์ดโฟลิโอ (iPad 10)', usedPrice: 2500, newPrice: 4000, kinds: ['standard'] },
];

// ชุดประเมินกลางสำหรับอุปกรณ์เสริมทุกรุ่น (แนวทางระบบคือ 1 ชุด/1 รุ่น — แอดมิน
// กด Clone จาก ProductEditorModal ได้ทีหลังถ้าอยากแยกค่าต่อรุ่น). ค่าหักใหญ่
// ใช้ pct เพื่อสเกลตามราคาของแต่ละรุ่น (Pencil ~800 ถึง Keyboard ~4,500).
export const ACCESSORY_CONDITION_SET = {
  name: 'อุปกรณ์เสริม iPad — ชุดประเมินมาตรฐาน',
  groups: [
    {
      id: 'g_acc_authenticity',
      title: 'ความแท้ของสินค้า (รับเฉพาะ Apple แท้)',
      options: [
        { id: 'o_acc_auth_genuine', label: 'ของแท้ Apple ยืนยันได้ (โลโก้/Serial/จับคู่กับ iPad ได้)', deduct: 0 },
        { id: 'o_acc_auth_unsure', label: 'ไม่มั่นใจ / ตรวจสอบไม่ได้ (รอตรวจหน้างานก่อนสรุปราคา)', pct: 50 },
      ],
    },
    {
      id: 'g_acc_body',
      title: 'สภาพภายนอก',
      options: [
        { id: 'o_acc_body_mint', label: 'สวยเหมือนใหม่ ไม่มีรอย', deduct: 0 },
        { id: 'o_acc_body_minor', label: 'มีรอยใช้งานเล็กน้อย', deduct: 200 },
        { id: 'o_acc_body_heavy', label: 'มีรอยชัดเจน / สีถลอก / มุมบุบ', deduct: 500 },
      ],
    },
    {
      id: 'g_acc_function',
      title: 'การทำงาน',
      options: [
        { id: 'o_acc_fn_ok', label: 'ใช้งานได้ปกติทุกฟังก์ชัน (จับคู่/ชาร์จ/ปุ่ม/ทัชแพด)', deduct: 0 },
        { id: 'o_acc_fn_flaky', label: 'ใช้งานได้แต่มีอาการบางครั้ง (หลุดการเชื่อมต่อ/ปุ่มฝืด)', pct: 30 },
        { id: 'o_acc_fn_dead', label: 'ใช้งานไม่ได้ (รับซื้อเป็นอะไหล่)', pct: 70 },
      ],
    },
    {
      id: 'g_acc_box',
      title: 'อุปกรณ์และกล่อง',
      options: [
        { id: 'o_acc_box_full', label: 'มีกล่อง/อุปกรณ์ครบ', deduct: 0 },
        { id: 'o_acc_box_none', label: 'ไม่มีกล่อง (เฉพาะตัวสินค้า)', deduct: 100 },
      ],
    },
  ],
};

const kindOf = (seriesName: string): SeriesKind => {
  if (/pro/i.test(seriesName)) return 'pro';
  if (/air/i.test(seriesName)) return 'air';
  if (/mini/i.test(seriesName)) return 'mini';
  return 'standard';
};

/** สร้าง payload ของ model อุปกรณ์เสริมทั้งชุด พร้อม compatible_series ที่ map
 *  จากชื่อ series iPad จริงในระบบ (availableSeries จาก /series) */
export const buildAccessorySeedModels = (
  availableSeries: Array<{ name?: string; category?: string }>,
  conditionSetId: string,
) => {
  const tabletSeries = (availableSeries || [])
    .filter((s) => s?.category === 'Tablets' && s.name)
    .map((s) => ({ name: s.name as string, kind: kindOf(s.name as string) }));

  return ACCESSORY_SEED_DEFS.map((def) => {
    const compat = def.kinds.length === 0
      ? []
      : tabletSeries.filter((s) => def.kinds.includes(s.kind)).map((s) => s.name);
    return {
      brand: 'Apple',
      category: ACCESSORY_CATEGORY,
      series: '',
      name: def.name,
      label_en: null,
      alias_th: def.alias_th,
      alias_en: def.alias_en || null,
      imageUrl: '',
      // เริ่มปิดรับซื้อไว้ก่อน — แอดมินตรวจราคาแล้วค่อยเปิดทีละรุ่น (ตัวเลือก
      // add-on ทุกจุดกรอง isActive === false ออก จึงยังไม่โผล่ที่ไหน)
      isActive: false,
      isFeatured: false,
      inStore: true,
      // มูลค่าต่ำ ไม่คุ้มเรียกไรเดอร์เดี่ยวๆ — ขายพ่วงกับงาน iPad ได้ตามปกติ
      pickup: false,
      mailIn: true,
      maxPickupDistanceKm: 0,
      conditionSetId,
      liquidityFactor: 1,
      // ไม่ match series ไหนเลย (เช่น เปลี่ยนชื่อ series) = null = ทุกรุ่น
      compatible_series: compat.length > 0 ? compat : null,
      attributesSchema: CATEGORY_SCHEMAS[ACCESSORY_CATEGORY] || [],
      pricingMode: 'legacy',
      variants: [{ id: 'v1', name: '', attributes: {}, newPrice: def.newPrice, usedPrice: def.usedPrice }],
      updatedAt: Date.now(),
    };
  });
};
