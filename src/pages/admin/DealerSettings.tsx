// /dealer-settings (CEO) — คอนฟิกโดเมนขายส่ง: tier, prefix เลขเอกสาร, บัญชีรับโอน
// เขียนตรงที่ settings/dealer (rule เดิม: write = admin) — ห้ามแตะ *_seq_by_period
// (counter ของเลขเอกสาร — จองผ่าน transaction ฝั่ง functions เท่านั้น)
import React, { useEffect, useState } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../api/firebase';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import { Handshake, Save, Trash2, AlertTriangle } from 'lucide-react';
import { DEALER_TIERS, TIER_META, type DealerTier } from '../../types/dealer';

// สรุปจาก adminDealerPurgeTestData (dry-run + ผลลบจริง)
interface PurgeSummary {
  lots: string[];
  orders: string[];
  applications: string[];
  sales_to_delete: number;
  jobs_to_restore: number;
  notifications_cleared: number;
  dealer_stats_reset: number;
}

interface TierConfig {
  label: string;
  early_access_min: number;
  // เกณฑ์แนะนำอัปเกรด tier (ผ่านอย่างใดอย่างหนึ่ง = ระบบเสนอให้แอดมินยืนยันที่ /dealers)
  min_order_amount: number; // ยอดออเดอร์เดียว (บาท) — 0 = ไม่ใช้เกณฑ์นี้
  min_monthly_amount: number; // ยอดสะสมในเดือน (บาท, เดือนไทย) — 0 = ไม่ใช้เกณฑ์นี้
}

const DEFAULT_TIERS: Record<DealerTier, TierConfig> = {
  A: { label: 'Gold', early_access_min: 60, min_order_amount: 500000, min_monthly_amount: 5000000 },
  B: { label: 'Silver', early_access_min: 0, min_order_amount: 300000, min_monthly_amount: 3000000 },
  C: { label: 'Bronze', early_access_min: 0, min_order_amount: 100000, min_monthly_amount: 1000000 },
};

const DealerSettings = () => {
  const toast = useToast();
  const [tiers, setTiers] = useState<Record<DealerTier, TierConfig>>(DEFAULT_TIERS);
  const [lotPrefix, setLotPrefix] = useState('LOT-');
  const [orderPrefix, setOrderPrefix] = useState('DO-');
  const [quotationPrefix, setQuotationPrefix] = useState('QT-');
  const [payment, setPayment] = useState({ bank: '', account_no: '', account_name: '' });
  // ช่องทางติดต่อที่โชว์ในหน้า Help & Support ของ portal — ว่าง = portal ซ่อนการ์ดนั้น
  const [support, setSupport] = useState({ line_id: '', phone: '', hours: '' });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // ล้างข้อมูลทดสอบ: dry-run ก่อน แล้วพิมพ์ PURGE ยืนยันลบจริง
  const [purgePreview, setPurgePreview] = useState<PurgeSummary | null>(null);
  const [purgeText, setPurgeText] = useState('');
  const [purgeBusy, setPurgeBusy] = useState(false);

  const callPurge = async (confirm?: string) => {
    const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'adminDealerPurgeTestData');
    return (await fn(confirm ? { confirm } : {})).data as { dry_run?: boolean; ok?: boolean; summary: PurgeSummary };
  };

  const handlePurgePreview = async () => {
    if (purgeBusy) return;
    setPurgeBusy(true);
    try {
      const res = await callPurge();
      setPurgePreview(res.summary);
      setPurgeText('');
    } catch (err: any) {
      toast.error(err?.message || 'ตรวจสอบข้อมูลไม่สำเร็จ');
    } finally {
      setPurgeBusy(false);
    }
  };

  const handlePurgeConfirm = async () => {
    if (purgeBusy || purgeText !== 'PURGE') return;
    setPurgeBusy(true);
    try {
      const res = await callPurge('PURGE');
      toast.success(`ล้างข้อมูลทดสอบแล้ว — คืนเครื่อง ${res.summary.jobs_to_restore} ใบกลับเข้าคลัง`);
      setPurgePreview(null);
      setPurgeText('');
    } catch (err: any) {
      toast.error(err?.message || 'ล้างข้อมูลไม่สำเร็จ');
    } finally {
      setPurgeBusy(false);
    }
  };

  useEffect(() => {
    // node เล็ก + หน้าตั้งค่าเปิดไม่บ่อย — listener ต่อหน้าไม่กระทบบิล
    const unsub = onValue(ref(db, 'settings/dealer'), (snap) => {
      const v = snap.val() || {};
      setTiers({
        A: { ...DEFAULT_TIERS.A, ...(v.tiers?.A || {}) },
        B: { ...DEFAULT_TIERS.B, ...(v.tiers?.B || {}) },
        C: { ...DEFAULT_TIERS.C, ...(v.tiers?.C || {}) },
      });
      if (v.lot_no_prefix) setLotPrefix(v.lot_no_prefix);
      if (v.order_prefix) setOrderPrefix(v.order_prefix);
      if (v.quotation_prefix) setQuotationPrefix(v.quotation_prefix);
      if (v.payment_info) setPayment({ bank: '', account_no: '', account_name: '', ...v.payment_info });
      if (v.support) setSupport({ line_id: '', phone: '', hours: '', ...v.support });
      setLoaded(true);
    });
    return unsub;
  }, []);

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await update(ref(db, 'settings/dealer'), {
        tiers,
        lot_no_prefix: lotPrefix.trim() || 'LOT-',
        order_prefix: orderPrefix.trim() || 'DO-',
        quotation_prefix: quotationPrefix.trim() || 'QT-',
        payment_info: payment,
        support: {
          line_id: support.line_id.trim() || null,
          phone: support.phone.trim() || null,
          hours: support.hours.trim() || null,
        },
      });
      toast.success('บันทึกการตั้งค่า Dealer แล้ว');
    } catch (err: any) {
      toast.error(err?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <div className="p-10 text-center text-slate-400">Loading...</div>;

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
          <Handshake className="text-blue-600" /> ตั้งค่า Dealer Portal
        </h1>
        <p className="text-xs font-bold text-slate-500 mt-1">
          Tier ดีลเลอร์ · เลขรันเอกสารขายส่ง · บัญชีรับชำระเงิน
        </p>
      </div>

      <div className="space-y-6">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-black text-xs uppercase tracking-widest text-slate-500 mb-4">Tier ดีลเลอร์</h2>
          <div className="space-y-4">
            {DEALER_TIERS.map((t) => (
              <div key={t} className="border border-slate-100 rounded-xl p-3">
                <div className="grid grid-cols-[80px_1fr_180px] gap-3 items-center">
                  <span className={`text-xs font-black uppercase px-2 py-1.5 rounded-lg border text-center ${TIER_META[t].cls}`}>{TIER_META[t].label}</span>
                  <input
                    value={tiers[t].label}
                    onChange={(e) => setTiers({ ...tiers, [t]: { ...tiers[t], label: e.target.value } })}
                    placeholder="ชื่อเรียก"
                    className="p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none focus:border-blue-500"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={tiers[t].early_access_min}
                      onChange={(e) => setTiers({ ...tiers, [t]: { ...tiers[t], early_access_min: Number(e.target.value) || 0 } })}
                      className="w-20 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none focus:border-blue-500"
                    />
                    <span className="text-[10px] font-bold text-slate-400">นาที เห็นก่อน (early access)</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ยอด/ออเดอร์ขั้นต่ำ (บาท)</label>
                    <input
                      type="number"
                      value={tiers[t].min_order_amount}
                      onChange={(e) => setTiers({ ...tiers, [t]: { ...tiers[t], min_order_amount: Number(e.target.value) || 0 } })}
                      className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono font-bold text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ยอดสะสม/เดือนขั้นต่ำ (บาท)</label>
                    <input
                      type="number"
                      value={tiers[t].min_monthly_amount}
                      onChange={(e) => setTiers({ ...tiers, [t]: { ...tiers[t], min_monthly_amount: Number(e.target.value) || 0 } })}
                      className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono font-bold text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-bold text-slate-400 mt-3">
            Early access: tier ที่ตั้งค่าไว้จะเห็น lot และเสนอราคาได้ก่อน tier อื่นตามจำนวนนาทีที่กำหนด
          </p>
          <p className="text-[10px] font-bold text-slate-400 mt-1">
            เกณฑ์อัปเกรด: ดีลเลอร์ที่ชำระออเดอร์ถึง "ยอด/ออเดอร์ขั้นต่ำ" หรือยอดสะสมในเดือนถึง
            "ยอดสะสม/เดือนขั้นต่ำ" ของ tier ที่สูงกว่า → ระบบจะแนะนำอัปเกรดที่หน้า Dealers
            (แอดมินกดยืนยันเอง ระบบไม่เปลี่ยนให้อัตโนมัติ · ใส่ 0 = ปิดเกณฑ์นั้น)
          </p>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-black text-xs uppercase tracking-widest text-slate-500 mb-4">เลขรันเอกสาร (reset รายเดือน)</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lot</label>
              <input value={lotPrefix} onChange={(e) => setLotPrefix(e.target.value)} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono font-bold text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">คำสั่งซื้อ</label>
              <input value={orderPrefix} onChange={(e) => setOrderPrefix(e.target.value)} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono font-bold text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ใบเสนอราคา</label>
              <input value={quotationPrefix} onChange={(e) => setQuotationPrefix(e.target.value)} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono font-bold text-sm outline-none" />
            </div>
          </div>
          <p className="text-[10px] font-bold text-slate-400 mt-2">
            รูปแบบ: {lotPrefix}202608-0001 — เลขลำดับจองแบบ atomic ฝั่งระบบ ห้ามแก้ counter เอง
          </p>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-black text-xs uppercase tracking-widest text-slate-500 mb-4">บัญชีรับชำระเงิน (โชว์ในใบเสนอราคา + Portal)</h2>
          <div className="grid grid-cols-3 gap-3">
            <input value={payment.bank} onChange={(e) => setPayment({ ...payment, bank: e.target.value })} placeholder="ธนาคาร" className="p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none" />
            <input value={payment.account_no} onChange={(e) => setPayment({ ...payment, account_no: e.target.value })} placeholder="เลขบัญชี" className="p-3 rounded-xl border border-slate-200 font-mono font-bold text-sm outline-none" />
            <input value={payment.account_name} onChange={(e) => setPayment({ ...payment, account_name: e.target.value })} placeholder="ชื่อบัญชี" className="p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none" />
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-black text-xs uppercase tracking-widest text-slate-500 mb-4">ช่องทางติดต่อ (โชว์ในหน้า Help ของ Portal)</h2>
          <div className="grid grid-cols-3 gap-3">
            <input value={support.line_id} onChange={(e) => setSupport({ ...support, line_id: e.target.value })} placeholder="LINE ID เช่น @getmobie" className="p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none" />
            <input value={support.phone} onChange={(e) => setSupport({ ...support, phone: e.target.value })} placeholder="เบอร์โทร" className="p-3 rounded-xl border border-slate-200 font-mono font-bold text-sm outline-none" />
            <input value={support.hours} onChange={(e) => setSupport({ ...support, hours: e.target.value })} placeholder="เวลาทำการ เช่น จ-ส 9:00-18:00" className="p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none" />
          </div>
          <p className="text-[10px] font-bold text-slate-400 mt-2">ช่องที่เว้นว่าง portal จะไม่โชว์การ์ดช่องทางนั้น</p>
        </section>

        <button onClick={handleSave} disabled={busy} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50">
          <Save size={16} /> {busy ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
        </button>

        {/* Danger zone: ล้างข้อมูลทดสอบก่อน go-live — CEO เท่านั้น (server เช็คซ้ำ) */}
        <section className="bg-white rounded-2xl border-2 border-red-200 shadow-sm p-5">
          <h2 className="font-black text-xs uppercase tracking-widest text-red-500 mb-2 flex items-center gap-2">
            <AlertTriangle size={14} /> ล้างข้อมูลทดสอบ (ใช้ก่อนเปิดใช้จริงเท่านั้น)
          </h2>
          <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
            ลบ lot / ซองประมูล / คำสั่งซื้อ / ใบสมัคร / การแจ้งเตือนทดสอบทั้งหมด, คืนเครื่องที่ติด lot
            หรือถูกขายผ่าน dealer กลับเข้าคลัง, ลบรายการขาย + ใบกำกับภาษีฝั่ง dealer ออกจากบัญชี
            และ reset เลขรันเอกสาร LOT-/DO-/QT-/REG- — <span className="text-red-500">บัญชีดีลเลอร์ไม่ถูกลบ</span> (เคลียร์แค่สถิติ)
            <br />ห้ามใช้หลังมีดีลจริง: เลขเอกสารจะซ้ำและบัญชีเพี้ยน · เลขใบกำกับภาษีกลาง reset แยกที่หน้าตั้งค่าระบบบัญชี
          </p>
          {!purgePreview ? (
            <button onClick={handlePurgePreview} disabled={purgeBusy} className="mt-3 bg-slate-100 text-slate-600 border border-slate-200 px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-slate-200 disabled:opacity-50">
              {purgeBusy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบข้อมูลที่จะถูกลบ (ยังไม่ลบ)'}
            </button>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[11px] font-bold text-slate-600 space-y-1">
                <div>Lot: {purgePreview.lots.length > 0 ? purgePreview.lots.join(', ') : 'ไม่มี'}</div>
                <div>คำสั่งซื้อ: {purgePreview.orders.length > 0 ? purgePreview.orders.join(', ') : 'ไม่มี'}</div>
                <div>ใบสมัคร: {purgePreview.applications.length > 0 ? purgePreview.applications.join(', ') : 'ไม่มี'}</div>
                <div>รายการขาย+ใบกำกับที่จะลบ: {purgePreview.sales_to_delete} · เครื่องคืนเข้าคลัง: {purgePreview.jobs_to_restore} · ร้านที่เคลียร์แจ้งเตือน/สถิติ: {purgePreview.notifications_cleared}/{purgePreview.dealer_stats_reset}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={purgeText}
                  onChange={(e) => setPurgeText(e.target.value)}
                  placeholder='พิมพ์ PURGE เพื่อยืนยัน'
                  className="p-2.5 rounded-lg border border-red-300 font-mono font-bold text-sm outline-none focus:border-red-500 w-44"
                />
                <button
                  onClick={handlePurgeConfirm}
                  disabled={purgeBusy || purgeText !== 'PURGE'}
                  className="bg-red-600 text-white px-4 py-2.5 rounded-lg text-[10px] font-black uppercase hover:bg-red-700 disabled:opacity-40 flex items-center gap-1.5"
                >
                  <Trash2 size={13} /> {purgeBusy ? 'กำลังลบ...' : 'ลบข้อมูลทดสอบถาวร'}
                </button>
                <button onClick={() => { setPurgePreview(null); setPurgeText(''); }} className="text-[10px] font-black uppercase text-slate-400 hover:text-slate-600 px-2">
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default DealerSettings;
