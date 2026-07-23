// iPad accessory trade-in (Apple Pencil / Magic Keyboard) — shared helpers.
//
// Data contract (see CLAUDE.md):
// - Catalog: accessory models live in /models with category ACCESSORY_CATEGORY
//   and an optional `compatible_series: string[]` (iPad series NAMES — same
//   name-string linking convention as model.series). Empty/missing = offered
//   for every iPad.
// - Job: `accessory_items[]` is a display/audit breakdown ONLY. `final_price`
//   (and `price`) stay the SINGLE total the customer is paid — device +
//   accessories — so the net_payout formula mirrored across repos/functions
//   never has to change. Device-only portion = total − sumAccessoryItems().
// - Stock: when a job with accessory_items reaches "In Stock", each item is
//   unpacked into its own child job (ref `{parent}-A1`, type ACCESSORY_JOB_TYPE,
//   status In Stock) mirroring the B2B unpack pattern, and the parent gets
//   `stock_cost` = total − accessories so inventory/POS cost is not
//   double-counted. Guarded by `accessories_unpacked_at` (idempotent — safe to
//   call from every "In Stock" writer, including POS void restock).
import { ref, push, update } from 'firebase/database';
import { db } from '../api/firebase';

export const ACCESSORY_CATEGORY = 'Tablet Accessories';
export const ACCESSORY_JOB_TYPE = 'Accessory';

export interface JobAccessoryItem {
  /** = model id (one add-on per accessory model) */
  id: string;
  model_id: string;
  model_name: string;
  /** ราคารับซื้อของชิ้นนี้ (บาท) — รวมอยู่ใน price/final_price ของ job แล้ว */
  price: number;
  serial?: string;
}

export const sumAccessoryItems = (items: any): number =>
  (Array.isArray(items) ? items : []).reduce(
    (sum: number, it: any) => sum + (Number(it?.price) || 0), 0);

/** Inventory/POS cost of a stock job. Parents that unpacked accessories carry
 *  `stock_cost` (= payout minus accessory value); everyone else keeps the
 *  original final_price/price fallback. */
export const stockCost = (job: any): number => {
  if (job && job.stock_cost != null) return Number(job.stock_cost) || 0;
  return Number(job?.final_price) || Number(job?.price) || 0;
};

/** Representative used-price of a model — first variant's used price, falling
 *  back to modifier-mode base prices. Used to prefill the add-on offer. */
export const representativeUsedPrice = (model: any): number => {
  const rawVariants = model?.variants;
  const variants: any[] = !rawVariants ? [] : Array.isArray(rawVariants) ? rawVariants : Object.values(rawVariants);
  for (const v of variants) {
    const p = Number(v?.usedPrice || v?.price || 0);
    if (p > 0) return p;
  }
  return Number(model?.baseUsedPrice || 0) || Number(model?.baseNewPrice || 0) || 0;
};

/** Resolve the model record behind a ticket's display name. Creation modals
 *  store `model` as "iPad Air 11 (Wi-Fi | 256GB)" — name plus variant. */
export const findModelByDisplayName = (modelsData: any, displayName: string): any | null => {
  const list = Array.isArray(modelsData) ? modelsData : [];
  const name = (displayName || '').trim();
  if (!name) return null;
  return list.find((m: any) => m?.name && (name === m.name || name.startsWith(m.name + ' ('))) || null;
};

/** ความเข้ากันได้ของ accessory กับ iPad หนึ่งรุ่น — ระดับรุ่นก่อน แล้วค่อย
 *  fallback ระดับ series (ข้อมูลเก่า):
 *  1. `compatible_models` (model ids — convention เดียวกับ coupon
 *     applicable_models) มีรายการ → ต้องมี id ของ iPad รุ่นนั้น
 *  2. ไม่มี → `compatible_series` (ชื่อ series) มีรายการ → ต้องมี series นั้น
 *  3. ไม่มีทั้งคู่ → เข้ากับ iPad ทุกรุ่น */
export const isAccessoryCompatible = (accessoryModel: any, deviceModel: any): boolean => {
  if (!deviceModel) return false;
  const byModel = Array.isArray(accessoryModel?.compatible_models)
    ? accessoryModel.compatible_models.filter(Boolean) : [];
  if (byModel.length > 0) return byModel.includes(deviceModel.id);
  const bySeries = Array.isArray(accessoryModel?.compatible_series)
    ? accessoryModel.compatible_series.filter(Boolean) : [];
  return bySeries.length === 0 || bySeries.includes(deviceModel.series);
};

/** Accessory models offerable alongside a given device model (must be an iPad
 *  = category Tablets). */
export const accessoryModelsForDevice = (modelsData: any, deviceModel: any): any[] => {
  if (!deviceModel || deviceModel.category !== 'Tablets') return [];
  const list = Array.isArray(modelsData) ? modelsData : [];
  return list.filter((m: any) => {
    if (!m || m.category !== ACCESSORY_CATEGORY) return false;
    if (m.isActive === false) return false;
    return isAccessoryCompatible(m, deviceModel);
  });
};

/**
 * Unpack a job's accessory_items into standalone stock jobs (child per item)
 * once the parent enters "In Stock" — the accessory version of the B2B
 * unpack. Children are created directly at In Stock so the create-triggers
 * (onNewTicketCreated / onJobCreatedSendEmails gate on new-order statuses)
 * stay silent. Returns the number of children created (0 = nothing to do).
 */
export const unpackAccessoryItemsToStock = async (job: any, by: string): Promise<number> => {
  const items = Array.isArray(job?.accessory_items) ? job.accessory_items.filter(Boolean) : [];
  if (!job?.id || items.length === 0 || job.accessories_unpacked_at) return 0;

  const now = Date.now();
  const total = Number(job.final_price) || Number(job.price) || 0;
  const parentRef = job.ref_no || job.id;
  const updates: Record<string, any> = {};

  items.forEach((it: any, idx: number) => {
    const childKey = push(ref(db, 'jobs')).key;
    updates[`jobs/${childKey}`] = {
      ref_no: `${parentRef}-A${idx + 1}`,
      type: ACCESSORY_JOB_TYPE,
      model: it.model_name || 'Accessory',
      model_id: it.model_id || '',
      // final_price = ต้นทุนชิ้นนี้ — inventory/POS อ่าน cost จาก final_price||price อยู่แล้ว
      price: Number(it.price) || 0,
      final_price: Number(it.price) || 0,
      serial: it.serial || '',
      parent_job_id: job.id,
      parent_ref_no: job.ref_no || '',
      cust_name: job.cust_name || '',
      receive_method: job.receive_method || '',
      status: 'In Stock',
      qc_date: now,
      created_at: now,
      updated_at: now,
      qc_logs: [{
        action: 'Accessory Unpacked',
        by,
        timestamp: now,
        details: `แตกอุปกรณ์เสริมจากงานแม่ ${parentRef} เข้าสต๊อก (฿${(Number(it.price) || 0).toLocaleString()})`,
      }],
    };
  });

  // Parent: mark unpacked + split the stock cost so the iPad's inventory cost
  // no longer includes the accessory value (children carry it now).
  updates[`jobs/${job.id}/accessories_unpacked_at`] = now;
  updates[`jobs/${job.id}/stock_cost`] = Math.max(0, total - sumAccessoryItems(items));
  updates[`jobs/${job.id}/updated_at`] = now;

  await update(ref(db), updates);
  return items.length;
};
