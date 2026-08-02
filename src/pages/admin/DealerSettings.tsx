// /dealer-settings (CEO) — คอนฟิกโดเมนขายส่ง: tier, prefix เลขเอกสาร, บัญชีรับโอน
// เขียนตรงที่ settings/dealer (rule เดิม: write = admin) — ห้ามแตะ *_seq_by_period
// (counter ของเลขเอกสาร — จองผ่าน transaction ฝั่ง functions เท่านั้น)
import React, { useEffect, useState } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import { Handshake, Save } from 'lucide-react';
import { DEALER_TIERS, TIER_META, type DealerTier } from '../../types/dealer';

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
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

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

        <button onClick={handleSave} disabled={busy} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50">
          <Save size={16} /> {busy ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
        </button>
      </div>
    </div>
  );
};

export default DealerSettings;
