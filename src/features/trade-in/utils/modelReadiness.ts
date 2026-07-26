// Derived "Buying Status" ของรุ่นในแคตตาล็อก: รุ่นจะรับซื้อได้จริงต่อเมื่อ
// ตั้งค่าครบ 3 อย่าง — (1) เปิดวิธีรับซื้ออย่างน้อย 1 ทาง (2) ผูกชุดประเมินสภาพ
// ที่มีอยู่จริง (3) มีราคารับซื้อมากกว่า 0. `isActive` ยังเป็นสวิตช์เปิด/ปิดมือ
// ของแอดมินเหมือนเดิม — helper นี้เป็น display-only ฝั่ง admin บอกว่าสวิตช์นั้น
// มีผลจริงหรือเปล่า (ไม่มีผลต่อ logic ฝั่งลูกค้า/สูตรเงินใดๆ)

export type ReadinessIssue = 'purchasing_method' | 'condition_group' | 'pricing';

export type BuyingStatus = 'active' | 'incomplete' | 'inactive';

export interface ModelReadiness {
  ready: boolean;
  issues: ReadinessIssue[];
  status: BuyingStatus;
}

export const READINESS_ISSUE_LABELS: Record<ReadinessIssue, string> = {
  purchasing_method: 'ยังไม่เปิดวิธีรับซื้อ (In-store / Pickup / Mail-in)',
  condition_group: 'ยังไม่ได้ผูกชุดประเมินสภาพ (Condition Set)',
  pricing: 'ยังไม่มีราคารับซื้อ (ทุกตัวเลือกเป็น 0)',
};

// ฟิลด์ที่ไม่เคยถูกเซ็ต = เปิด — สอดคล้องกับ handleSaveModel (`?? true`) และ
// ตัวอ่านฝั่งลูกค้าที่เช็คเฉพาะค่า false ชัดๆ
const methodEnabled = (v: unknown) => v !== false;

export function hasAnyPurchasingMethod(model: any): boolean {
  return methodEnabled(model?.inStore) || methodEnabled(model?.pickup) || methodEnabled(model?.mailIn);
}

export function hasAnyPrice(model: any): boolean {
  const variants = Array.isArray(model?.variants) ? model.variants : Object.values(model?.variants || {});
  if (variants.some((v: any) => Number(v?.usedPrice || v?.price || 0) > 0)) return true;
  return Number(model?.baseUsedPrice || 0) > 0 || Number(model?.baseNewPrice || 0) > 0;
}

export function getModelReadiness(model: any, conditionSets: any[]): ModelReadiness {
  const issues: ReadinessIssue[] = [];
  if (!hasAnyPurchasingMethod(model)) issues.push('purchasing_method');
  // conditionSets ว่าง = ยังโหลดไม่เสร็จ → เช็คแค่ว่ามี id ผูกไว้ กัน false alarm
  const setOk = !!model?.conditionSetId
    && (conditionSets.length === 0 || conditionSets.some((s: any) => s.id === model.conditionSetId));
  if (!setOk) issues.push('condition_group');
  if (!hasAnyPrice(model)) issues.push('pricing');
  const ready = issues.length === 0;
  const status: BuyingStatus = model?.isActive === false ? 'inactive' : ready ? 'active' : 'incomplete';
  return { ready, issues, status };
}
