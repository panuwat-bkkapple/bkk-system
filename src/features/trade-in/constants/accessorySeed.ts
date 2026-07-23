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

// ราคา = ราคารับซื้อจริงที่เจ้าของร้านกำหนด (23 ก.ค. 2026). newPrice (ซีล)
// เป็นค่าประมาณ — แอดมินปรับได้จากหน้าแก้ไขรุ่น
const ACCESSORY_SEED_DEFS: AccessorySeedDef[] = [
  { name: 'Apple Pencil (1st generation)', alias_th: 'ปากกาไอแพด รุ่น 1', alias_en: 'Apple Pencil 1', usedPrice: 300, newPrice: 1500, kinds: ['standard', 'air', 'mini'] },
  { name: 'Apple Pencil (2nd generation)', alias_th: 'ปากกาไอแพด รุ่น 2', alias_en: 'Apple Pencil 2', usedPrice: 500, newPrice: 2800, kinds: ['pro', 'air', 'mini'] },
  { name: 'Apple Pencil (USB-C)', alias_th: 'ปากกาไอแพด USB-C', usedPrice: 500, newPrice: 2000, kinds: [] },
  { name: 'Apple Pencil Pro', alias_th: 'ปากกาไอแพดโปร', usedPrice: 1000, newPrice: 3500, kinds: ['pro', 'air', 'mini'] },
  { name: 'Smart Keyboard Folio 11"', alias_th: 'สมาร์ทคีย์บอร์ด 11 นิ้ว', usedPrice: 500, newPrice: 3000, kinds: ['pro', 'air'] },
  { name: 'Smart Keyboard Folio 12.9"', alias_th: 'สมาร์ทคีย์บอร์ด 12.9 นิ้ว', usedPrice: 500, newPrice: 3500, kinds: ['pro'] },
  { name: 'Magic Keyboard 11"', alias_th: 'เมจิกคีย์บอร์ด 11 นิ้ว', usedPrice: 500, newPrice: 6000, kinds: ['pro', 'air'] },
  { name: 'Magic Keyboard 13"', alias_th: 'เมจิกคีย์บอร์ด 13 นิ้ว', alias_en: 'Magic Keyboard 12.9', usedPrice: 500, newPrice: 6500, kinds: ['pro', 'air'] },
  { name: 'Magic Keyboard Folio', alias_th: 'เมจิกคีย์บอร์ดโฟลิโอ (iPad 10)', usedPrice: 1500, newPrice: 4000, kinds: ['standard'] },
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

// ---------------------------------------------------------------------------
// ความเข้ากันได้ระดับรุ่น (per-model) — อ้างอิงตาราง Apple:
// support.apple.com/th-th/guide/ipad/ipad47ee2e98/ipados (Apple Pencil)
// + หน้า Magic Keyboard / Smart Keyboard Folio ของ Apple.
// key = ชื่อ accessory model, value = รายชื่อ "ชื่อรุ่น iPad" ในแคตตาล็อกร้าน
// (PriceEditor แปลงชื่อ → model id ตอน migrate — เทียบแบบ trim กันช่องว่างเกิน,
// ชื่อไหนไม่พบในแคตตาล็อกก็ข้ามเฉพาะชื่อนั้น)
// ---------------------------------------------------------------------------
const PRO_11_G1_G4 = ['iPad Pro 11" (2018)', 'iPad Pro 11" (2020)', 'iPad Pro 11" (ชิป M1, 2021)', 'iPad Pro 11" (ชิป M2, 2022)'];
const PRO_129_G3_G6 = ['iPad Pro 12.9" (2018)', 'iPad Pro 12.9" (2020)', 'iPad Pro 12.9" (ชิป M1, 2021)', 'iPad Pro 12.9" (ชิป M2, 2022)'];
const PRO_M4_M5_11 = ['iPad Pro 11" (ชิป M4, 2024)', 'iPad Pro 11" (ชิป M5, 2025)'];
const PRO_M4_M5_13 = ['iPad Pro 13" (ชิป M4, 2024)', 'iPad Pro 13" (ชิป M5, 2025)'];
const AIR_11_M2_UP = ['iPad Air 11" (ชิป M2, 2024)', 'iPad Air 11" (ชิป M3, 2025)', 'iPad Air 11" (ชิป M4, 2026)'];
const AIR_13_M2_UP = ['iPad Air 13" (ชิป M2, 2024)', 'iPad Air 13" (ชิป M3, 2025)', 'iPad Air 13" (ชิป M4, 2026)'];
const AIR_4_5 = ['iPad Air 4 (2020)', 'iPad Air 5 (ชิป M1, 2022)'];

export const ACCESSORY_COMPAT_BY_NAME: Record<string, string[]> = {
  // iPad 6-9 (Lightning), iPad 10 (ผ่านอะแดปเตอร์ USB-C — Apple ระบุรองรับ),
  // Air 3, mini 5, Pro รุ่นแรกๆ (9.7/10.5/12.9 gen 1-2)
  'Apple Pencil (1st generation)': [
    'iPad Generation 6 (2018)', 'iPad Generation 7 (2019)', 'iPad Generation 8 (2020)',
    'iPad Generation 9', 'iPad Generation 10',
    'iPad Air 3 (2019)', 'iPad mini 5 (2019)',
    'iPad Pro 9.7" (2016)', 'iPad Pro 10.5" (2017)', 'iPad Pro 12.9" (2015)', 'iPad Pro 12.9" (2017)',
  ],
  // mini 6, Air 4/5, Pro 11 gen 1-4, Pro 12.9 gen 3-6
  'Apple Pencil (2nd generation)': [
    'iPad mini (รุ่นที่ 6)', ...AIR_4_5, ...PRO_11_G1_G4, ...PRO_129_G3_G6,
  ],
  // ทุกรุ่นยุค USB-C + รุ่นที่รองรับ Pencil 2 (ตามตาราง Apple)
  'Apple Pencil (USB-C)': [
    'iPad mini (รุ่นที่ 6)', 'iPad mini รุ่นที่ 7 (ชิป A17 Pro)',
    'iPad Generation 10', 'iPad Generation 11',
    ...AIR_4_5, ...AIR_11_M2_UP, ...AIR_13_M2_UP,
    ...PRO_11_G1_G4, ...PRO_129_G3_G6, ...PRO_M4_M5_11, ...PRO_M4_M5_13,
  ],
  // เฉพาะรุ่นใหม่: Pro M4/M5, Air M2 ขึ้นไป, mini A17 Pro
  'Apple Pencil Pro': [
    'iPad mini รุ่นที่ 7 (ชิป A17 Pro)',
    ...AIR_11_M2_UP, ...AIR_13_M2_UP, ...PRO_M4_M5_11, ...PRO_M4_M5_13,
  ],
  'Smart Keyboard Folio 11"': [...PRO_11_G1_G4, ...AIR_4_5],
  'Smart Keyboard Folio 12.9"': [...PRO_129_G3_G6],
  // Magic Keyboard (2020) 11": Pro 11 gen 1-4, Air 4/5, Air 11 M2/M3
  'Magic Keyboard 11"': [...PRO_11_G1_G4, ...AIR_4_5, 'iPad Air 11" (ชิป M2, 2024)', 'iPad Air 11" (ชิป M3, 2025)'],
  // Magic Keyboard (2020) 12.9": Pro 12.9 gen 3-6, Air 13 M2/M3 (ตัว Pro M4 ใช้รุ่นใหม่แยก)
  'Magic Keyboard 13"': [...PRO_129_G3_G6, 'iPad Air 13" (ชิป M2, 2024)', 'iPad Air 13" (ชิป M3, 2025)'],
  'Magic Keyboard Folio': ['iPad Generation 10', 'iPad Generation 11'],
  'Magic Keyboard for iPad Pro 11" (M4)': [...PRO_M4_M5_11],
  'Magic Keyboard for iPad Pro 13" (M4)': [...PRO_M4_M5_13],
};

// รุ่นที่ seed รอบแรกยังไม่มี — Magic Keyboard รุ่นใหม่ของ iPad Pro M4/M5
// (คนละตัวกับ Magic Keyboard 2020, ใส่ด้วยกันไม่ได้) เพิ่มให้ตอน migrate
export const EXTRA_ACCESSORY_DEFS: AccessorySeedDef[] = [
  { name: 'Magic Keyboard for iPad Pro 11" (M4)', alias_th: 'เมจิกคีย์บอร์ดโปร M4 11 นิ้ว', usedPrice: 2000, newPrice: 8000, kinds: ['pro'] },
  { name: 'Magic Keyboard for iPad Pro 13" (M4)', alias_th: 'เมจิกคีย์บอร์ดโปร M4 13 นิ้ว', usedPrice: 2000, newPrice: 8500, kinds: ['pro'] },
];

/** แปลงรายชื่อ "ชื่อรุ่น iPad" → model ids จากแคตตาล็อกจริง (trim กันช่องว่างเกิน
 *  ที่ติดมากับข้อมูลบางรุ่น). ชื่อที่หาไม่พบถูกข้าม — คืน [] เมื่อไม่พบเลย */
export const resolveCompatModelIds = (allModels: Array<{ id?: string; name?: string; category?: string }>, names: string[]): string[] => {
  const byName = new Map<string, string>();
  (allModels || []).forEach((m) => {
    if (m?.category === 'Tablets' && m.name && m.id) byName.set(String(m.name).trim(), m.id);
  });
  return names.map((n) => byName.get(n.trim())).filter((id): id is string => !!id);
};

// ---------------------------------------------------------------------------
// One-shot price patch (เจ้าของร้านกำหนดราคารับซื้อจริง 23 ก.ค. 2026).
// ใช้ได้เฉพาะเมื่อราคาปัจจุบันยังเท่าค่า seed เดิม (from) — ราคาที่แอดมินแก้เอง
// ทีหลังจะไม่ถูกทับ และหลัง patch ค่าไม่เท่า from แล้วจึงไม่ apply ซ้ำ
// ---------------------------------------------------------------------------
export const ACCESSORY_PRICE_PATCH: Record<string, { from: number; to: number }> = {
  'Apple Pencil (1st generation)': { from: 800, to: 300 },
  'Apple Pencil (2nd generation)': { from: 1800, to: 500 },
  'Apple Pencil (USB-C)': { from: 1300, to: 500 },
  'Apple Pencil Pro': { from: 2500, to: 1000 },
  'Smart Keyboard Folio 11"': { from: 1800, to: 500 },
  'Smart Keyboard Folio 12.9"': { from: 2200, to: 500 },
  'Magic Keyboard 11"': { from: 4000, to: 500 },
  'Magic Keyboard 13"': { from: 4500, to: 500 },
  'Magic Keyboard for iPad Pro 11" (M4)': { from: 5500, to: 2000 },
  'Magic Keyboard for iPad Pro 13" (M4)': { from: 6000, to: 2000 },
  'Magic Keyboard Folio': { from: 2500, to: 1500 },
};

const kindOf = (seriesName: string): SeriesKind => {
  if (/pro/i.test(seriesName)) return 'pro';
  if (/air/i.test(seriesName)) return 'air';
  if (/mini/i.test(seriesName)) return 'mini';
  return 'standard';
};

/** โครง payload กลางของ accessory model — ใช้ทั้ง seed แรกและ migrate เพิ่มรุ่น */
export const buildAccessoryModelPayload = (
  def: AccessorySeedDef,
  conditionSetId: string,
  compat: { series?: string[] | null; models?: string[] | null },
) => ({
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
  // ระดับรุ่นชนะระดับ series; ไม่มีทั้งคู่ (null) = ทุกรุ่น
  compatible_models: (compat.models && compat.models.length > 0) ? compat.models : null,
  compatible_series: (compat.series && compat.series.length > 0) ? compat.series : null,
  attributesSchema: CATEGORY_SCHEMAS[ACCESSORY_CATEGORY] || [],
  pricingMode: 'legacy',
  variants: [{ id: 'v1', name: '', attributes: {}, newPrice: def.newPrice, usedPrice: def.usedPrice }],
  updatedAt: Date.now(),
});

/** สร้าง payload ของ model อุปกรณ์เสริมทั้งชุดสำหรับ seed ครั้งแรก —
 *  compatible_models map ตามตาราง Apple จากแคตตาล็อกจริง (allModels), และเก็บ
 *  compatible_series (map จากชื่อ series) เป็น fallback สำรอง */
export const buildAccessorySeedModels = (
  availableSeries: Array<{ name?: string; category?: string }>,
  allModels: Array<{ id?: string; name?: string; category?: string }>,
  conditionSetId: string,
) => {
  const tabletSeries = (availableSeries || [])
    .filter((s) => s?.category === 'Tablets' && s.name)
    .map((s) => ({ name: s.name as string, kind: kindOf(s.name as string) }));

  return [...ACCESSORY_SEED_DEFS, ...EXTRA_ACCESSORY_DEFS].map((def) => {
    const seriesCompat = def.kinds.length === 0
      ? []
      : tabletSeries.filter((s) => def.kinds.includes(s.kind)).map((s) => s.name);
    const modelCompat = resolveCompatModelIds(allModels, ACCESSORY_COMPAT_BY_NAME[def.name] || []);
    return buildAccessoryModelPayload(def, conditionSetId, { series: seriesCompat, models: modelCompat });
  });
};
