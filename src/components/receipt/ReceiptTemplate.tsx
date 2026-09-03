// src/components/receipt/ReceiptTemplate.tsx
import React from 'react';
import { RECEIPT_DEFAULTS, type ReceiptPaperSize, type ReceiptSettings } from './receiptSettings';

// =============================================================================
// ใบเสร็จขาย — หน้าตาเดียวของทั้งระบบ
//
// เดิมมาร์กอัปชุดนี้ถูกก๊อป 3 ที่ (POS หลังจ่ายเงิน, พรีวิวในประวัติการขาย,
// และฉบับที่ส่งเข้าเครื่องพิมพ์ในประวัติการขาย) แล้วค่อยๆ เพี้ยนจากกันทีละจุด
// จนฉบับที่ "พิมพ์จริง" กลายเป็นฉบับที่ข้อมูลน้อยที่สุด: ไม่มีแคชเชียร์
// ไม่มีชื่อลูกค้า และบิลที่ถูกยกเลิกพิมพ์ออกมาสะอาดเหมือนบิลปกติ
// ทั้งสามจุดใช้คอมโพเนนต์นี้แล้ว — **ห้ามก๊อปมาร์กอัปใบเสร็จไปไว้ที่อื่นอีก**
//
// เจ้าของ print CSS ก็อยู่ที่นี่ที่เดียว: `@page` มาจาก paperSize ของค่าตั้ง
// (เดิมไม่มี `@page` เลย เบราว์เซอร์จึงใช้ A4 ขณะที่เนื้อถูกบังคับกว้าง 80mm
// และมี min-height ค้างอยู่ — บิลรายการเดียวเลยล้นไปหน้าที่ 2)
// =============================================================================

export interface ReceiptTemplateProps {
  /** แถวจาก /sales (หรือ record ที่ POS เพิ่งสร้าง) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sale: any;
  settings?: ReceiptSettings;
  /** id ของกล่องที่ print CSS เล็ง — ต้องไม่ซ้ำกันในหน้าเดียว */
  domId?: string;
  /** POS เท่านั้นที่มีสองค่านี้ (ไม่ได้ถูกบันทึกลง /sales) */
  receivedAmount?: number;
  changeAmount?: number;
  /** true = เป็นพรีวิวบนจอเฉยๆ ไม่ใช่เป้าของการพิมพ์ → ไม่ปล่อย print CSS */
  previewOnly?: boolean;
  className?: string;
}

const money = (v: unknown) => Number(v || 0).toLocaleString();

// `size: 80mm auto` ใช้ไม่ได้ — CSS ห้ามผสม <length> กับ `auto` ในค่าเดียวกัน
// เบราว์เซอร์จึงทิ้งทั้งบรรทัดแล้วตกไปใช้กระดาษเริ่มต้น. วัดจริงด้วย Chromium
// (headless, preferCSSPageSize) 3 ก.ย. 2569:
//   size: 80mm auto     -> 215.9 x 279.4 mm (Letter — ค่าถูกทิ้ง)
//   size: 80mm          -> 80 x 80 mm (สี่เหลี่ยมจัตุรัส ตัดหน้าใหม่ทุก 80mm)
//   size: 80mm 297mm    -> 80 x 297 mm ✓
// จึงต้องระบุสองความยาวเสมอ ความสูงเป็นเพดานของกล่องหน้า ไม่ใช่ความยาวที่ป้อนจริง
// (เครื่องพิมพ์ม้วนตัดตามเนื้อ) — **ห้ามแก้กลับเป็น `auto`**
const paperCss = (paper: ReceiptPaperSize) =>
  paper === 'thermal80' ? 'size: 80mm 297mm; margin: 4mm;' : 'size: A4 portrait; margin: 15mm;';

// ความกว้างตอนพิมพ์ปล่อย 100% ทั้งสองแบบ — `@page` เป็นเจ้าของขนาดกระดาษ
// ที่เดียว. ตรึง 80mm ไว้ที่ตัวกล่องไม่ได้ เพราะพื้นที่พิมพ์จริงของกระดาษ
// 80mm หักขอบ 4mm สองข้างเหลือ 72mm — เนื้อจะล้นออกไป 8mm
// min-height ถูกล้างทิ้งตรงนี้โดยตั้งใจ — ใบเสร็จต้องสูงเท่าเนื้อ
const printCss = (domId: string, paper: ReceiptPaperSize) => `
@media print {
  @page { ${paperCss(paper)} }
  body * { visibility: hidden; }
  #${domId}, #${domId} * { visibility: visible; }
  #${domId} {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    max-width: none;
    min-height: 0;
    margin: 0;
    padding: 0;
    box-shadow: none;
    border-radius: 0;
  }
}
`;

export const ReceiptTemplate: React.FC<ReceiptTemplateProps> = ({
  sale,
  settings = RECEIPT_DEFAULTS,
  domId = 'printable-receipt',
  receivedAmount,
  changeAmount,
  previewOnly = false,
  className = '',
}) => {
  if (!sale) return null;

  const { paperSize, fontSizePx, showImei } = settings;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = Array.isArray(sale.items)
    ? sale.items
    : Object.values((sale.items || {}) as Record<string, unknown>);
  const footerLines = Array.isArray(settings.footerLines) ? settings.footerLines : [];
  const isVoided = sale.status === 'VOIDED';
  const hasCashRows = typeof receivedAmount === 'number' || typeof changeAmount === 'number';
  const label = 'flex justify-between mb-1';

  return (
    <>
      {!previewOnly && <style>{printCss(domId, paperSize)}</style>}
      <div
        id={previewOnly ? undefined : domId}
        className={`bg-white text-black font-sans p-6 relative overflow-hidden ${className}`}
        style={{
          fontSize: `${fontSizePx}px`,
          width: paperSize === 'thermal80' ? '80mm' : '210mm',
          maxWidth: '100%',
          // flex item ที่ไม่ตั้ง minWidth จะไม่ยอมหดต่ำกว่าเนื้อหา — พรีวิว A4
          // ข้างแผงปุ่มในโมดอลจึงล้นจอเล็ก
          minWidth: 0,
        }}
      >
        {/* บิลที่ถูกยกเลิกต้องไม่พิมพ์ออกมาสะอาด — ลายน้ำจึงต้องติดไปกับกระดาษด้วย
            (print-color-adjust: exact กันเบราว์เซอร์ตัดสีพื้นหลังทิ้งตอนพิมพ์) */}
        {isVoided && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-45 text-red-500 font-black opacity-20 border-8 border-red-500 p-4 rounded-xl pointer-events-none"
            style={{
              fontSize: `${fontSizePx * 4}px`,
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            }}
          >
            VOIDED
          </div>
        )}

        <div className="text-center mb-6">
          <h2 className="font-black tracking-tight uppercase" style={{ fontSize: '1.6em' }}>
            {settings.shopName}
          </h2>
          {settings.addressLine && (
            <p className="font-bold text-gray-500 mt-1" style={{ fontSize: '0.8em' }}>
              {settings.addressLine}
            </p>
          )}
          {settings.taxId && (
            <p className="font-bold text-gray-500" style={{ fontSize: '0.8em' }}>
              Tax ID: {settings.taxId}
            </p>
          )}
        </div>

        <div
          className="font-mono mb-4 border-b border-dashed border-gray-300 pb-4"
          style={{ fontSize: '0.85em' }}
        >
          <div className={label}>
            <span>Receipt No:</span> <span className="font-bold">{sale.receipt_no}</span>
          </div>
          <div className={label}>
            <span>Date:</span> <span>{new Date(sale.sold_at).toLocaleString('th-TH')}</span>
          </div>
          <div className={label}>
            <span>Cashier:</span> <span>{sale.cashier || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span>Customer:</span> <span>{sale.customer_name || 'ลูกค้าทั่วไป'}</span>
          </div>
        </div>

        <div className="mb-4 border-b border-dashed border-gray-300 pb-4 relative z-10">
          <div className="font-bold uppercase mb-2" style={{ fontSize: '0.85em' }}>
            Items
          </div>
          {items.map((item, idx) => (
            <div key={idx} className="mb-2" style={{ fontSize: '0.85em' }}>
              <div className="flex justify-between font-bold">
                <span className="truncate pr-2">{item.name}</span>
                <span>
                  {Number(item.qty) || 0} x {money(item.price)}
                </span>
              </div>
              {showImei && item.type === 'DEVICE' && item.code && (
                <div className="text-gray-500" style={{ fontSize: '0.8em' }}>
                  IMEI/SN: {item.code}
                </div>
              )}
              <div className="text-right mt-0.5">
                ฿{money(Number(item.price || 0) * (Number(item.qty) || 0))}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-6" style={{ fontSize: '0.85em' }}>
          <div className={label}>
            <span>Subtotal:</span> <span>฿{money(sale.subtotal)}</span>
          </div>
          {Number(sale.discount) > 0 && (
            <div className={`${label} text-red-500`}>
              <span>Discount:</span> <span>-฿{money(sale.discount)}</span>
            </div>
          )}
          <div
            className="flex justify-between font-black mt-2 pt-2 border-t border-gray-200"
            style={{ fontSize: '1.15em' }}
          >
            <span>TOTAL:</span> <span>฿{money(sale.grand_total)}</span>
          </div>
        </div>

        <div
          className="mb-6 border-b border-dashed border-gray-300 pb-4"
          style={{ fontSize: '0.85em' }}
        >
          <div className={hasCashRows ? label : 'flex justify-between'}>
            <span>Payment Method:</span> <span>{sale.payment_method || '-'}</span>
          </div>
          {typeof receivedAmount === 'number' && (
            <div className={label}>
              <span>Cash Received:</span> <span>฿{money(receivedAmount)}</span>
            </div>
          )}
          {typeof changeAmount === 'number' && (
            <div className="flex justify-between">
              <span>Change:</span> <span>฿{money(changeAmount)}</span>
            </div>
          )}
        </div>

        {footerLines.length > 0 && (
          <div className="text-center text-gray-500" style={{ fontSize: '0.8em' }}>
            {footerLines.map((line, idx) => (
              <p key={idx} className={idx === 0 ? 'font-bold text-black mb-1' : undefined}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default ReceiptTemplate;
