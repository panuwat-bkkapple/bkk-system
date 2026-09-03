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

  /* ซ่อนทุกอย่างที่ไม่ใช่ใบเสร็จ ไม่ใช่บรรพบุรุษของมัน และไม่ได้อยู่ในมัน
     — ต้องเป็น display:none ไม่ใช่ visibility:hidden

     ของเดิมใช้ \`body * { visibility: hidden }\` ซึ่งซ่อนแค่ "หมึก" ไม่ซ่อน
     "พื้นที่": ตารางประวัติการขายยังกินความสูงเท่าเดิม จำนวนหน้าที่พิมพ์จึงมา
     จากความสูงของทั้งหน้า ไม่ใช่ของใบเสร็จ — สั่งพิมพ์บิลใบเดียวจาก
     /sales-history แล้วได้ 3 หน้า ว่างเปล่า 2 หน้า (วัดจริง 3 ก.ย. 2569)
     **บนหน้าเปล่ามันดูปกติ** ซึ่งเป็นเหตุผลที่รอดสายตามาได้ */
  body *:not(:has(#${domId})):not(#${domId}):not(#${domId} *) { display: none !important; }

  /* บรรพบุรุษเหลือไว้แค่กล่องเปล่า — ไม่งั้น padding กับ min-h-screen ของหน้า
     ยังดันความสูงอยู่ */
  body *:has(#${domId}) {
    display: block !important;
    min-height: 0 !important;
    height: auto !important;
    padding: 0 !important;
    margin: 0 !important;
    border: 0 !important;
    box-shadow: none !important;
  }
  body { margin: 0 !important; }

  /* ดึงตัวเองกลับมาให้เห็นเสมอ — หน้าที่โฮสต์ใบเสร็จอาจมี print CSS ของตัวเอง
     ที่สั่ง \`body * { visibility: hidden }\` อยู่ (SalesHistory มีจริง เป็นของ
     Z-Read) แล้วซ่อนใบเสร็จไปด้วย. เคสนี้หลุดถึงมือผู้ใช้มาแล้ว: หลังเปลี่ยน
     มาใช้ display:none เราถอด visibility:visible ที่เคยดึงกลับออกไป ผลคือ
     พิมพ์ได้ 1 หน้า **ว่างเปล่า** (3 ก.ย. 2569)
     — display:none คุม "พื้นที่", visibility คุม "หมึก" ต้องคุมทั้งสองแกน */
  #${domId},
  #${domId} * {
    visibility: visible !important;
  }

  #${domId} {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = any;

interface BodyProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sale: any;
  items: Item[];
  settings: ReceiptSettings;
  footerLines: string[];
  receivedAmount?: number;
  changeAmount?: number;
}

const lineTotal = (item: Item) => Number(item.price || 0) * (Number(item.qty) || 0);

const imeiOf = (item: Item, showImei: boolean) =>
  showImei && item.type === 'DEVICE' && item.code ? String(item.code) : '';

// -- สลิปกระดาษความร้อน 80mm -------------------------------------------------
// เรียงลงเป็นแถบเดียว คั่นด้วยเส้นประ ตามธรรมเนียมสลิปหน้าร้าน
// (บนความกว้าง 72mm ตารางหลายคอลัมน์อ่านไม่ออก)
const ThermalBody: React.FC<BodyProps> = ({ sale, items, settings, footerLines, receivedAmount, changeAmount }) => {
  const row = 'flex justify-between mb-1';
  const hasCashRows = typeof receivedAmount === 'number' || typeof changeAmount === 'number';

  return (
    <>
      <div className="text-center mb-6">
        <h2 className="font-black tracking-tight uppercase" style={{ fontSize: '1.6em' }}>
          {settings.shopName}
        </h2>
        {settings.addressLine && (
          <p className="font-bold text-gray-500 mt-1" style={{ fontSize: '0.8em' }}>{settings.addressLine}</p>
        )}
        {settings.taxId && (
          <p className="font-bold text-gray-500" style={{ fontSize: '0.8em' }}>Tax ID: {settings.taxId}</p>
        )}
      </div>

      <div className="font-mono mb-4 border-b border-dashed border-gray-300 pb-4" style={{ fontSize: '0.85em' }}>
        <div className={row}><span>Receipt No:</span> <span className="font-bold">{sale.receipt_no}</span></div>
        <div className={row}><span>Date:</span> <span>{new Date(sale.sold_at).toLocaleString('th-TH')}</span></div>
        <div className={row}><span>Cashier:</span> <span>{sale.cashier || '-'}</span></div>
        <div className="flex justify-between"><span>Customer:</span> <span>{sale.customer_name || 'ลูกค้าทั่วไป'}</span></div>
      </div>

      <div className="mb-4 border-b border-dashed border-gray-300 pb-4 relative z-10">
        <div className="font-bold uppercase mb-2" style={{ fontSize: '0.85em' }}>Items</div>
        {items.map((item, idx) => (
          <div key={idx} className="mb-2" style={{ fontSize: '0.85em' }}>
            {/* ชื่อรุ่นอยู่บรรทัดของตัวเองและ **ตัดบรรทัด ไม่ตัดทิ้ง** — ของเดิมใช้
                `truncate` แล้วชื่อยาวโดนตัดเป็น `MacBook Air 15" (ชิป M4, 2025) M4 | 16…`
                ลูกค้าที่ถือสลิปไปเคลมประกันจึงอ่านไม่ออกว่าซื้อความจุเท่าไร.
                บนกระดาษม้วน ความยาวกระดาษไม่ใช่ของหายาก ข้อมูลเป็น */}
            <div className="font-bold break-words">{item.name}</div>
            {imeiOf(item, settings.showImei) && (
              <div className="text-gray-500" style={{ fontSize: '0.8em' }}>IMEI/SN: {imeiOf(item, settings.showImei)}</div>
            )}
            <div className="flex justify-between mt-0.5">
              <span>{Number(item.qty) || 0} x {money(item.price)}</span>
              <span>฿{money(lineTotal(item))}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6" style={{ fontSize: '0.85em' }}>
        <div className={row}><span>Subtotal:</span> <span>฿{money(sale.subtotal)}</span></div>
        {Number(sale.discount) > 0 && (
          <div className={`${row} text-red-500`}><span>Discount:</span> <span>-฿{money(sale.discount)}</span></div>
        )}
        <div className="flex justify-between font-black mt-2 pt-2 border-t border-gray-200" style={{ fontSize: '1.15em' }}>
          <span>TOTAL:</span> <span>฿{money(sale.grand_total)}</span>
        </div>
      </div>

      <div className="mb-6 border-b border-dashed border-gray-300 pb-4" style={{ fontSize: '0.85em' }}>
        <div className={hasCashRows ? row : 'flex justify-between'}>
          <span>Payment Method:</span> <span>{sale.payment_method || '-'}</span>
        </div>
        {typeof receivedAmount === 'number' && (
          <div className={row}><span>Cash Received:</span> <span>฿{money(receivedAmount)}</span></div>
        )}
        {typeof changeAmount === 'number' && (
          <div className="flex justify-between"><span>Change:</span> <span>฿{money(changeAmount)}</span></div>
        )}
      </div>

      {footerLines.length > 0 && (
        <div className="text-center text-gray-500" style={{ fontSize: '0.8em' }}>
          {footerLines.map((line, idx) => (
            <p key={idx} className={idx === 0 ? 'font-bold text-black mb-1' : undefined}>{line}</p>
          ))}
        </div>
      )}
    </>
  );
};

// -- เอกสาร A4 ---------------------------------------------------------------
// คนละรูปกับสลิป ไม่ใช่สลิปที่ถูกยืด: หัวเอกสารสองคอลัมน์ (ร้านซ้าย เลขที่บิลขวา),
// รายการเป็นตารางมีหัวคอลัมน์จริง, ยอดรวมเป็นบล็อกชิดขวา — บนหน้ากว้าง 180mm
// การเรียงลงเป็นแถบเดียวทำให้ตาต้องกวาดข้ามหน้ากระดาษทั้งใบเพื่ออ่านเลขคู่กับป้าย
const A4Body: React.FC<BodyProps> = ({ sale, items, settings, footerLines, receivedAmount, changeAmount }) => {
  const cell = 'py-2 align-top';
  const totalRow = 'flex justify-between py-1';

  return (
    <>
      <div className="flex justify-between items-start gap-8 mb-6">
        <div className="min-w-0">
          <h2 className="font-black tracking-tight uppercase leading-tight" style={{ fontSize: '1.9em' }}>
            {settings.shopName}
          </h2>
          {settings.addressLine && (
            <p className="text-gray-600 mt-1.5 leading-snug" style={{ fontSize: '0.85em' }}>{settings.addressLine}</p>
          )}
          {settings.taxId && (
            <p className="text-gray-600 leading-snug" style={{ fontSize: '0.85em' }}>Tax ID: {settings.taxId}</p>
          )}
        </div>
        <div className="text-right shrink-0" style={{ fontSize: '0.85em' }}>
          <div className="font-black uppercase tracking-widest text-gray-400" style={{ fontSize: '0.85em' }}>Receipt</div>
          <div className="font-black font-mono mt-0.5" style={{ fontSize: '1.3em' }}>{sale.receipt_no}</div>
          <div className="text-gray-600 mt-1">{new Date(sale.sold_at).toLocaleString('th-TH')}</div>
        </div>
      </div>

      <div className="flex justify-between gap-8 border-y border-gray-300 py-3 mb-6" style={{ fontSize: '0.85em' }}>
        <div className="min-w-0">
          <div className="text-gray-500">Customer</div>
          <div className="font-bold truncate">{sale.customer_name || 'ลูกค้าทั่วไป'}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-gray-500">Cashier</div>
          <div className="font-bold">{sale.cashier || '-'}</div>
        </div>
      </div>

      <table className="w-full border-collapse mb-6 relative z-10" style={{ fontSize: '0.85em' }}>
        <thead>
          <tr className="border-b-2 border-gray-800 text-left">
            <th className="pb-2 font-black uppercase tracking-wider" style={{ fontSize: '0.85em' }}>Item</th>
            <th className="pb-2 font-black uppercase tracking-wider text-center w-20" style={{ fontSize: '0.85em' }}>Qty</th>
            <th className="pb-2 font-black uppercase tracking-wider text-right w-32" style={{ fontSize: '0.85em' }}>Unit Price</th>
            <th className="pb-2 font-black uppercase tracking-wider text-right w-32" style={{ fontSize: '0.85em' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx} className="border-b border-gray-200 break-inside-avoid">
              <td className={cell}>
                <div className="font-bold">{item.name}</div>
                {imeiOf(item, settings.showImei) && (
                  <div className="text-gray-500 font-mono" style={{ fontSize: '0.85em' }}>
                    IMEI/SN: {imeiOf(item, settings.showImei)}
                  </div>
                )}
              </td>
              <td className={`${cell} text-center`}>{Number(item.qty) || 0}</td>
              <td className={`${cell} text-right`}>{money(item.price)}</td>
              <td className={`${cell} text-right font-bold`}>฿{money(lineTotal(item))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mb-8 break-inside-avoid">
        <div className="w-2/5 min-w-[60mm]" style={{ fontSize: '0.85em' }}>
          <div className={totalRow}><span className="text-gray-600">Subtotal</span> <span>฿{money(sale.subtotal)}</span></div>
          {Number(sale.discount) > 0 && (
            <div className={`${totalRow} text-red-600`}><span>Discount</span> <span>-฿{money(sale.discount)}</span></div>
          )}
          <div className="flex justify-between font-black border-t-2 border-gray-800 mt-1 pt-2" style={{ fontSize: '1.3em' }}>
            <span>TOTAL</span> <span>฿{money(sale.grand_total)}</span>
          </div>
          <div className="border-t border-gray-200 mt-3 pt-2">
            <div className={totalRow}>
              <span className="text-gray-600">Payment Method</span> <span className="font-bold">{sale.payment_method || '-'}</span>
            </div>
            {typeof receivedAmount === 'number' && (
              <div className={totalRow}><span className="text-gray-600">Cash Received</span> <span>฿{money(receivedAmount)}</span></div>
            )}
            {typeof changeAmount === 'number' && (
              <div className={totalRow}><span className="text-gray-600">Change</span> <span>฿{money(changeAmount)}</span></div>
            )}
          </div>
        </div>
      </div>

      {footerLines.length > 0 && (
        <div className="text-center text-gray-500 border-t border-gray-200 pt-4" style={{ fontSize: '0.8em' }}>
          {footerLines.map((line, idx) => (
            <p key={idx} className={idx === 0 ? 'font-bold text-black mb-1' : undefined}>{line}</p>
          ))}
        </div>
      )}
    </>
  );
};

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

  const { paperSize, fontSizePx } = settings;
  const items: Item[] = Array.isArray(sale.items)
    ? sale.items
    : Object.values((sale.items || {}) as Record<string, unknown>);
  const footerLines = Array.isArray(settings.footerLines) ? settings.footerLines : [];
  const isVoided = sale.status === 'VOIDED';
  const isThermal = paperSize === 'thermal80';
  const Body = isThermal ? ThermalBody : A4Body;

  return (
    <>
      {!previewOnly && <style>{printCss(domId, paperSize)}</style>}
      <div
        id={previewOnly ? undefined : domId}
        className={`bg-white text-black font-sans relative overflow-hidden ${isThermal ? 'p-6' : 'p-10'} ${className}`}
        style={{
          fontSize: `${fontSizePx}px`,
          width: isThermal ? '80mm' : '210mm',
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
              fontSize: `${fontSizePx * (isThermal ? 4 : 6)}px`,
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            }}
          >
            VOIDED
          </div>
        )}

        <Body
          sale={sale}
          items={items}
          settings={settings}
          footerLines={footerLines}
          receivedAmount={receivedAmount}
          changeAmount={changeAmount}
        />
      </div>
    </>
  );
};

export default ReceiptTemplate;
