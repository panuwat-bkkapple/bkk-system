import { useEffect, useMemo, useState } from 'react';
import { get, ref, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { Receipt, Save, Store, MapPin, Hash, FileText, Ruler, Type, Smartphone } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../hooks/useAuth';
import { ReceiptTemplate } from '../../components/receipt/ReceiptTemplate';
import {
  RECEIPT_DEFAULTS,
  RECEIPT_FONT_MAX,
  RECEIPT_FONT_MIN,
  normalizeReceiptSettings,
  type ReceiptSettings,
} from '../../components/receipt/receiptSettings';
import { primeReceiptSettings } from '../../hooks/useReceiptSettings';

// =============================================================================
// ตั้งค่าใบเสร็จขาย — settings/receipt
//
// เจ้าของค่าที่ใบเสร็จของ POS และประวัติการขายใช้ร่วมกัน (ทั้งสองหน้า render
// ด้วย ReceiptTemplate ตัวเดียวกัน) พรีวิวทางขวาจึงเป็นคอมโพเนนต์ตัวเดียว
// กับที่พิมพ์จริง ไม่ใช่ภาพจำลอง — สิ่งที่เห็นคือสิ่งที่ออกจากเครื่องพิมพ์
// =============================================================================

// งานสมมติสำหรับพรีวิว — ห้ามดึงบิลจริงมาโชว์ (PDPA) และตรึงค่าไว้เพื่อให้
// พรีวิวเปลี่ยนตามค่าตั้งเท่านั้น ไม่กระพริบตามข้อมูลที่ไหลเข้ามา
const PREVIEW_SALE = {
  receipt_no: 'REC-000123',
  cashier: 'Admin (Main Store)',
  customer_name: 'ลูกค้าตัวอย่าง',
  payment_method: 'CASH',
  items: [
    { name: 'iPhone 15 Pro Max 256GB', qty: 1, price: 38900, type: 'DEVICE', code: '356789012345678' },
    { name: 'เคสใส MagSafe', qty: 2, price: 590, type: 'SKU', code: 'ACC-CASE-01' },
  ],
  subtotal: 40080,
  discount: 1080,
  grand_total: 39000,
};

export default function ReceiptSettingsPage() {
  const toast = useToast();
  const { currentUser } = useAuth();
  const [form, setForm] = useState<ReceiptSettings>(RECEIPT_DEFAULTS);
  const [footerText, setFooterText] = useState(RECEIPT_DEFAULTS.footerLines.join('\n'));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get(ref(db, 'settings/receipt'))
      .then((snap) => {
        const value = normalizeReceiptSettings(snap.exists() ? snap.val() : null);
        setForm(value);
        setFooterText(value.footerLines.join('\n'));
      })
      .catch(() => toast.error('โหลดค่าตั้งใบเสร็จไม่สำเร็จ — กำลังแสดงค่าตั้งต้น'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ท้ายใบเสร็จ: หนึ่งบรรทัดในกล่อง = หนึ่งบรรทัดบนกระดาษ. ตัดบรรทัดว่าง
  // ท้ายสุดทิ้ง (คนพิมพ์ Enter ค้างไว้) แต่ไม่ตัดบรรทัดว่างตรงกลาง
  // ซึ่งเป็นการเว้นวรรคที่ตั้งใจ
  const footerLines = useMemo(() => {
    const lines = footerText.split('\n').map((l) => l.trimEnd());
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    return lines;
  }, [footerText]);

  const preview: ReceiptSettings = useMemo(
    () => ({ ...form, footerLines }),
    [form, footerLines],
  );

  const previewSale = useMemo(() => ({ ...PREVIEW_SALE, sold_at: Date.now() }), []);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const next: ReceiptSettings = {
      ...form,
      shopName: form.shopName.trim(),
      addressLine: form.addressLine.trim(),
      taxId: form.taxId.trim(),
      footerLines,
    };
    try {
      await update(ref(db, 'settings/receipt'), {
        shopName: next.shopName,
        addressLine: next.addressLine,
        taxId: next.taxId,
        footerLines: next.footerLines,
        paperSize: next.paperSize,
        fontSizePx: next.fontSizePx,
        showImei: next.showImei,
        updated_at: Date.now(),
        // ห้ามเก็บอีเมลพนักงาน — ชื่อพอสำหรับ audit และไม่ทำให้โหนดตั้งค่า
        // กลายเป็นทะเบียนอีเมลทีม (บทเรียนเดียวกับ price_ledger)
        updated_by: currentUser?.name || currentUser?.uid || 'admin',
      });
      setForm(next);
      primeReceiptSettings(next);
      toast.success('บันทึกค่าตั้งใบเสร็จแล้ว — ใบถัดไปใช้ค่าใหม่ทันที');
    } catch {
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const textField = (
    label: string,
    icon: React.ReactNode,
    key: 'shopName' | 'addressLine' | 'taxId',
    placeholder: string,
    hint?: string,
  ) => (
    <div>
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        {icon} {label}
      </label>
      <input
        type="text"
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
      />
      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );

  if (loading) return <div className="p-10 text-center text-gray-400 font-bold animate-pulse">กำลังโหลด...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-blue-100 rounded-xl">
          <Receipt size={24} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-800">ตั้งค่าใบเสร็จขาย</h1>
          <p className="text-xs text-slate-400 font-bold">
            หัวกระดาษ ท้ายใบเสร็จ ขนาดกระดาษและตัวอักษร — ใช้ร่วมกันทั้ง POS และการพิมพ์ซ้ำจากประวัติการขาย
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* ฟอร์ม */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
              <Store size={16} className="text-blue-600" /> หัวใบเสร็จ
            </h2>
            {textField('ชื่อร้าน', <Store size={12} />, 'shopName', 'เช่น BKK APPLE PRO')}
            {textField('ที่อยู่ (บรรทัดเดียว)', <MapPin size={12} />, 'addressLine', 'เช่น Bangkok, Thailand')}
            {textField(
              'เลขประจำตัวผู้เสียภาษี',
              <Hash size={12} />,
              'taxId',
              'เช่น 0105500000000',
              'เว้นว่าง = ไม่พิมพ์บรรทัดนี้บนใบเสร็จ',
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
              <FileText size={16} className="text-amber-500" /> ท้ายใบเสร็จ
            </h2>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              หนึ่งบรรทัดในกล่องนี้ = หนึ่งบรรทัดบนกระดาษ. บรรทัดแรกจะถูกพิมพ์เป็นตัวหนา
              (ปกติใช้เป็นคำขอบคุณ) เว้นว่างทั้งกล่อง = ไม่พิมพ์ท้ายใบเสร็จเลย
            </p>
            <textarea
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              rows={5}
              placeholder={'ขอบคุณที่ใช้บริการ\nสินค้าซื้อแล้วไม่รับเปลี่ยนคืนทุกกรณี'}
              className="w-full px-4 py-3 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono leading-relaxed"
            />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
            <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
              <Ruler size={16} className="text-emerald-600" /> กระดาษและตัวอักษร
            </h2>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">ขนาดกระดาษ</label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: 'A4', label: 'A4', hint: 'เครื่องพิมพ์เอกสารทั่วไป' },
                  { id: 'thermal80', label: 'ความร้อน 80mm', hint: 'เครื่องพิมพ์สลิปหน้าร้าน' },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, paperSize: opt.id }))}
                    className={`p-3 rounded-xl border-2 text-left transition ${
                      form.paperSize === opt.id
                        ? 'bg-blue-50 border-blue-600 text-blue-700'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-sm font-black">{opt.label}</div>
                    <div className="text-[10px] font-bold opacity-70 mt-0.5">{opt.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Type size={12} /> ขนาดตัวอักษร (px)
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={RECEIPT_FONT_MIN}
                  max={RECEIPT_FONT_MAX}
                  value={form.fontSizePx}
                  onChange={(e) => setForm((f) => ({ ...f, fontSizePx: Number(e.target.value) }))}
                  className="flex-1 accent-blue-600"
                />
                <span className="w-16 text-center text-sm font-black text-slate-800 bg-slate-100 rounded-lg py-1.5">
                  {form.fontSizePx}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                เป็นขนาดฐาน — ส่วนอื่นของใบเสร็จปรับตามสัดส่วนนี้ทั้งใบ
              </p>
            </div>

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                  <Smartphone size={14} className="text-slate-400" /> พิมพ์ IMEI / Serial ของเครื่อง
                </p>
                <p className="text-[11px] font-bold text-slate-400 mt-0.5 leading-relaxed">
                  แสดงใต้ชื่อสินค้าที่เป็นเครื่อง (ไม่มีผลกับอุปกรณ์เสริม)
                </p>
              </div>
              <input
                type="checkbox"
                checked={form.showImei}
                onChange={(e) => setForm((f) => ({ ...f, showImei: e.target.checked }))}
                className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 shrink-0"
              />
            </label>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-black text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-md shadow-blue-200 flex items-center justify-center gap-2"
          >
            <Save size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึกค่าตั้งใบเสร็จ'}
          </button>

          {form.updated_at && (
            <p className="text-[11px] text-slate-400 text-center font-bold">
              แก้ไขล่าสุด {new Date(form.updated_at).toLocaleString('th-TH')}
              {form.updated_by ? ` โดย ${form.updated_by}` : ''}
            </p>
          )}
        </div>

        {/* พรีวิว */}
        <div className="lg:sticky lg:top-20">
          <div className="bg-slate-100 rounded-2xl border border-slate-200 p-5">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
              ตัวอย่าง (ข้อมูลสมมติ)
            </p>
            <div className="overflow-x-auto">
              <ReceiptTemplate
                sale={previewSale}
                settings={preview}
                previewOnly
                className="shadow-lg rounded-lg mx-auto"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
