/**
 * Margin Guidelines ตามประเภทสินค้า
 * ใช้แสดงสี indicator ตอนตั้งราคา
 *
 * ตาม business logic:
 * - iPhone: ขายง่าย มาไวไปไว → margin ต่ำ 20-30%
 * - iPad ธรรมดา: ราคาถูก → margin ~20%
 * - iPad Air/Pro: ขายยาก ติดมือนาน → margin สูง 25-35%
 * - Mac: margin สูงสุด 30%+ โดยเฉพาะรุ่นเก่า
 * - Smart Watch: คล้าย iPhone
 * - Camera/Game: case by case
 */

export interface MarginGuideline {
  category: string;
  series?: string; // optional: ถ้าระบุจะ override category default
  sealedMarginMin: number; // % ขั้นต่ำที่แนะนำ
  sealedMarginMax: number; // % สูงสุดที่แนะนำ
  usedMarginMin: number;
  usedMarginMax: number;
  note: string;
}

export const MARGIN_GUIDELINES: MarginGuideline[] = [
  // iPhone
  { category: 'Smartphones', sealedMarginMin: 15, sealedMarginMax: 30, usedMarginMin: 20, usedMarginMax: 35, note: 'iPhone ขายง่าย margin ต่ำได้' },

  // iPad
  { category: 'Tablets', series: 'iPad', sealedMarginMin: 15, sealedMarginMax: 25, usedMarginMin: 20, usedMarginMax: 30, note: 'iPad ธรรมดา ราคาถูก' },
  { category: 'Tablets', series: 'iPad Air', sealedMarginMin: 20, sealedMarginMax: 35, usedMarginMin: 25, usedMarginMax: 40, note: 'iPad Air ขายยาก margin สูง' },
  { category: 'Tablets', series: 'iPad Pro', sealedMarginMin: 25, sealedMarginMax: 35, usedMarginMin: 25, usedMarginMax: 40, note: 'iPad Pro ขายยาก margin สูง' },
  { category: 'Tablets', series: 'iPad mini', sealedMarginMin: 15, sealedMarginMax: 25, usedMarginMin: 20, usedMarginMax: 30, note: 'iPad mini คล้าย iPad ธรรมดา' },

  // Mac
  { category: 'Mac / Laptop', sealedMarginMin: 25, sealedMarginMax: 40, usedMarginMin: 30, usedMarginMax: 50, note: 'Mac margin สูง โดยเฉพาะรุ่นเก่า' },

  // Watch
  { category: 'Smart Watch', sealedMarginMin: 15, sealedMarginMax: 30, usedMarginMin: 20, usedMarginMax: 35, note: 'Watch คล้าย iPhone' },

  // Camera & Game
  { category: 'Camera', sealedMarginMin: 20, sealedMarginMax: 35, usedMarginMin: 25, usedMarginMax: 40, note: 'Camera case by case' },
  { category: 'Game System', sealedMarginMin: 15, sealedMarginMax: 30, usedMarginMin: 20, usedMarginMax: 35, note: 'Game System' },
];

/**
 * หา guideline ที่เหมาะกับ model
 * ถ้ามี series-specific จะใช้ก่อน, ถ้าไม่มีใช้ category default
 */
export function getMarginGuideline(category: string, series?: string): MarginGuideline {
  if (series) {
    const bySeriesPrefix = MARGIN_GUIDELINES.find(g =>
      g.category === category && g.series && series.toLowerCase().startsWith(g.series.toLowerCase())
    );
    if (bySeriesPrefix) return bySeriesPrefix;
  }
  const byCat = MARGIN_GUIDELINES.find(g => g.category === category && !g.series);
  return byCat || MARGIN_GUIDELINES[0];
}

/**
 * คำนวณ margin indicator
 */
export function getMarginStatus(
  marginPct: number,
  guide: MarginGuideline,
  type: 'sealed' | 'used'
): { color: string; label: string } {
  const min = type === 'sealed' ? guide.sealedMarginMin : guide.usedMarginMin;
  const max = type === 'sealed' ? guide.sealedMarginMax : guide.usedMarginMax;

  if (marginPct < 0) return { color: 'text-red-600 bg-red-50', label: 'ขาดทุน!' };
  if (marginPct < min) return { color: 'text-amber-600 bg-amber-50', label: 'ต่ำกว่าแนะนำ' };
  if (marginPct <= max) return { color: 'text-emerald-600 bg-emerald-50', label: 'เหมาะสม' };
  return { color: 'text-blue-600 bg-blue-50', label: 'สูง' };
}
