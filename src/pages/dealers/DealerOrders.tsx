// /dealer-orders — บอร์ดคำสั่งซื้อดีลเลอร์ (Phase 2: ชำระเงิน + จัดส่ง)
// ตรวจสลิป/ยืนยันชำระ = CEO/FINANCE (เขียน /sales → ใบกำกับภาษีอัตโนมัติ),
// จัดส่ง/ปิดงาน = ทุก role, ยกเลิก = CEO/MANAGER — ทั้งหมดผ่าน callable
import React, { useMemo, useState } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../hooks/useAuth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { ClipboardList, ExternalLink, Truck, CheckCircle2, Ban, FileText, X } from 'lucide-react';
import { ORDER_STATUS_META, fmtBaht, fmtDateTime, type DealerOrder, type DealerOrderStatus } from '../../types/dealer';

const call = async (name: string, data: Record<string, unknown>) => {
  const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), name);
  return (await fn(data)).data as any;
};

const TABS: { key: 'active' | DealerOrderStatus | 'all'; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'payment_review', label: 'รอตรวจสลิป' },
  { key: 'paid', label: 'รอจัดส่ง' },
  { key: 'shipped', label: 'กำลังส่ง' },
  { key: 'all', label: 'ทั้งหมด' },
];

export const DealerOrders = () => {
  const toast = useToast();
  const { hasAccess } = useAuth();
  const canVerifyPayment = hasAccess(['CEO', 'FINANCE']);
  const canCancel = hasAccess(['CEO', 'MANAGER']);
  const { data: ordersRaw, loading } = useDatabase('dealer_orders');
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('active');
  const [busy, setBusy] = useState(false);
  const [shipModal, setShipModal] = useState<DealerOrder | null>(null);
  const [shipForm, setShipForm] = useState({ method: '', tracking_no: '' });

  const orders: DealerOrder[] = useMemo(() => {
    const list = Array.isArray(ordersRaw) ? ordersRaw : [];
    const filtered =
      tab === 'all' ? list
      : tab === 'active' ? list.filter((o: DealerOrder) => !['completed', 'cancelled'].includes(o.status))
      : list.filter((o: DealerOrder) => o.status === tab);
    return filtered.sort((a: DealerOrder, b: DealerOrder) => (b.created_at || 0) - (a.created_at || 0));
  }, [ordersRaw, tab]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      toast.error(err?.message || 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPaid = (o: DealerOrder) => {
    if (!confirm(`ยืนยันรับชำระ ${o.order_no} ยอด ${fmtBaht(o.amount)}?\n\nระบบจะ: บันทึกการขาย → ออกใบกำกับภาษีเต็มรูป → ตัดสต๊อกเป็น Sold`)) return;
    run(async () => {
      await call('adminDealerOrderMarkPaid', { orderId: o.id });
      toast.success('ยืนยันชำระแล้ว — ใบกำกับภาษีกำลังออกอัตโนมัติ');
    });
  };

  const handleShip = () => {
    if (!shipModal) return;
    run(async () => {
      await call('adminDealerOrderShip', { orderId: shipModal.id, ...shipForm });
      toast.success('บันทึกการจัดส่งแล้ว — ระบบแจ้งดีลเลอร์ทางอีเมล');
      setShipModal(null);
      setShipForm({ method: '', tracking_no: '' });
    });
  };

  const handleComplete = (o: DealerOrder) => {
    if (!confirm(`ปิดงาน ${o.order_no}?`)) return;
    run(async () => {
      await call('adminDealerOrderComplete', { orderId: o.id });
      toast.success('ปิดงานแล้ว');
    });
  };

  const handleCancel = (o: DealerOrder) => {
    const reason = prompt(`เหตุผลยกเลิก ${o.order_no} (เครื่องจะกลับเข้าสต๊อก):`);
    if (reason === null) return;
    run(async () => {
      await call('adminDealerOrderCancel', { orderId: o.id, reason });
      toast.success('ยกเลิกคำสั่งซื้อแล้ว');
    });
  };

  if (loading) return <div className="p-10 text-center text-slate-400">Loading Orders...</div>;

  return (
    <div className="p-6 bg-slate-100 min-h-screen font-sans text-slate-800">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
            <ClipboardList className="text-blue-600" /> Dealer Orders
          </h1>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
            คำสั่งซื้อขายส่ง · ตรวจสลิป · จัดส่ง
          </p>
        </div>
        <div className="flex gap-1 bg-white p-1 rounded-xl border border-slate-200">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-2 text-[10px] font-black uppercase rounded-lg ${tab === t.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Order</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">ดีลเลอร์</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">ยอด (รวม VAT)</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">สถานะ</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">เอกสาร / สลิป</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {orders.map((o) => {
                const meta = ORDER_STATUS_META[o.status] || ORDER_STATUS_META.pending_payment;
                return (
                  <tr key={o.id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="p-5">
                      <div className="font-black text-sm font-mono">{o.order_no}</div>
                      <div className="text-[10px] font-bold text-slate-400">{o.lot_no} · {o.item_count} เครื่อง · {fmtDateTime(o.created_at)}</div>
                    </td>
                    <td className="p-5">
                      <div className="font-bold text-sm">{o.dealer_snapshot?.company_name || '-'}</div>
                      <div className="text-[10px] font-bold text-slate-400">{o.dealer_snapshot?.phone || ''}</div>
                    </td>
                    <td className="p-5 text-right font-black text-blue-600">{fmtBaht(o.amount)}</td>
                    <td className="p-5 text-center">
                      <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg border ${meta.cls}`}>{meta.label}</span>
                      {o.shipping?.tracking_no && <div className="text-[9px] font-mono font-bold text-slate-400 mt-1">{o.shipping.tracking_no}</div>}
                    </td>
                    <td className="p-5">
                      <div className="flex flex-col gap-1">
                        {o.quotation?.url && (
                          <a href={o.quotation.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-600 flex items-center gap-1 hover:underline">
                            <FileText size={12} /> {o.quotation.number}
                          </a>
                        )}
                        {o.payment?.slip_url && (
                          <a href={o.payment.slip_url} target="_blank" rel="noreferrer" className="text-xs font-bold text-orange-600 flex items-center gap-1 hover:underline">
                            <ExternalLink size={12} /> สลิปโอน {o.payment.submitted_at ? `(${fmtDateTime(o.payment.submitted_at)})` : ''}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="p-5 text-right">
                      <div className="flex justify-end gap-2">
                        {['pending_payment', 'payment_review'].includes(o.status) && canVerifyPayment && (
                          <button onClick={() => handleMarkPaid(o)} disabled={busy} className="bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 text-[10px] font-black uppercase disabled:opacity-50">
                            ยืนยันชำระ
                          </button>
                        )}
                        {['paid', 'preparing'].includes(o.status) && (
                          <button onClick={() => { setShipModal(o); setShipForm({ method: o.shipping?.method || '', tracking_no: o.shipping?.tracking_no || '' }); }} disabled={busy} className="bg-purple-600 text-white px-3 py-2 rounded-lg hover:bg-purple-700 text-[10px] font-black uppercase flex items-center gap-1 disabled:opacity-50">
                            <Truck size={12} /> จัดส่ง
                          </button>
                        )}
                        {o.status === 'shipped' && (
                          <button onClick={() => handleComplete(o)} disabled={busy} className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 text-[10px] font-black uppercase flex items-center gap-1 disabled:opacity-50">
                            <CheckCircle2 size={12} /> ปิดงาน
                          </button>
                        )}
                        {['pending_payment', 'payment_review'].includes(o.status) && canCancel && (
                          <button onClick={() => handleCancel(o)} disabled={busy} className="bg-red-50 text-red-600 border border-red-200 p-2 rounded-lg hover:bg-red-100 disabled:opacity-50" title="ยกเลิก">
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-slate-400 italic font-bold">ไม่มีคำสั่งซื้อในมุมมองนี้</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ship modal */}
      {shipModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-black text-lg text-slate-800 uppercase tracking-tight flex items-center gap-2">
                <Truck size={20} className="text-purple-500" /> จัดส่ง {shipModal.order_no}
              </h3>
              <button onClick={() => setShipModal(null)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ขนส่ง</label>
                <input value={shipForm.method} onChange={(e) => setShipForm({ ...shipForm, method: e.target.value })} placeholder="เช่น Kerry / Flash / ส่งเอง" className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none focus:border-purple-500" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">เลข Tracking</label>
                <input value={shipForm.tracking_no} onChange={(e) => setShipForm({ ...shipForm, tracking_no: e.target.value })} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none focus:border-purple-500" />
              </div>
              <div className="pt-2 flex gap-3">
                <button onClick={() => setShipModal(null)} className="flex-1 py-3 text-slate-500 font-bold text-xs uppercase hover:bg-slate-50 rounded-xl">ยกเลิก</button>
                <button onClick={handleShip} disabled={busy} className="flex-[2] bg-purple-600 text-white py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-purple-700 disabled:opacity-50">
                  บันทึกจัดส่ง + แจ้งดีลเลอร์
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
