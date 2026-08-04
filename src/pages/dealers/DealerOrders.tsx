// /dealer-orders — บอร์ดคำสั่งซื้อดีลเลอร์ (Phase 2: ชำระเงิน + จัดของ + จัดส่ง)
// ตรวจสลิป/ยืนยันชำระ = CEO/FINANCE (เขียน /sales → ใบกำกับภาษีอัตโนมัติ),
// จัดของ = สแกนบาร์โค้ดเช็คครบทุกเครื่องก่อนส่ง (four-eyes: คนออกรายการห้ามจัดเอง
// — server บังคับใน adminDealerOrderPicking), จัดส่ง/ปิดงาน = ทุก role (ship ถูก
// block จนกว่า picking done), ยกเลิก = CEO/MANAGER — ทั้งหมดผ่าน callable
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../hooks/useAuth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { ClipboardList, ExternalLink, Truck, CheckCircle2, Ban, FileText, X, ScanBarcode, PackageCheck, Undo2 } from 'lucide-react';
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

  // จัดของ — เก็บแค่ id แล้วอ่าน order สดจาก realtime เสมอ (สแกนจากเครื่องอื่น
  // ก็เห็นติ๊กขึ้นทันที), input โฟกัสค้างไว้รับ barcode scanner (พิมพ์+Enter)
  const [pickOrderId, setPickOrderId] = useState<string | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const pickOrder: DealerOrder | null = useMemo(() => {
    if (!pickOrderId) return null;
    const list = Array.isArray(ordersRaw) ? ordersRaw : [];
    return list.find((o: DealerOrder) => o.id === pickOrderId) || null;
  }, [ordersRaw, pickOrderId]);

  useEffect(() => {
    if (pickOrderId) setTimeout(() => scanInputRef.current?.focus(), 100);
  }, [pickOrderId]);

  const pickedCountOf = (o: DealerOrder) => Object.keys(o.picking?.items || {}).length;
  const pickingDone = (o: DealerOrder) => o.picking?.status === 'done';

  const handleScan = async () => {
    const code = scanCode.trim();
    if (!code || !pickOrder || scanBusy) return;
    setScanBusy(true);
    try {
      const res = await call('adminDealerOrderPicking', { orderId: pickOrder.id, action: 'scan', code });
      if (res.already) toast.info(`${res.model} — สแกนไปแล้วก่อนหน้านี้`);
      else toast.success(`✓ ${res.model} (${res.picked}/${res.total})`);
      setScanCode('');
    } catch (err: any) {
      toast.error(err?.message || 'สแกนไม่สำเร็จ');
    } finally {
      setScanBusy(false);
      scanInputRef.current?.focus();
    }
  };

  const handleUndoPick = async (jobId: string) => {
    if (!pickOrder || scanBusy) return;
    setScanBusy(true);
    try {
      await call('adminDealerOrderPicking', { orderId: pickOrder.id, action: 'undo', jobId });
    } catch (err: any) {
      toast.error(err?.message || 'ยกเลิกรายการไม่สำเร็จ');
    } finally {
      setScanBusy(false);
    }
  };

  const handleCompletePicking = async () => {
    if (!pickOrder || scanBusy) return;
    setScanBusy(true);
    try {
      await call('adminDealerOrderPicking', { orderId: pickOrder.id, action: 'complete' });
      toast.success('จัดของครบแล้ว — พร้อมจัดส่ง');
      setPickOrderId(null);
    } catch (err: any) {
      toast.error(err?.message || 'ปิดการจัดของไม่สำเร็จ');
    } finally {
      setScanBusy(false);
    }
  };

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
    // เครดิตจากเคลม = วิธีชำระ (server หักจาก credit_balance เท่าที่มีจริง — ไม่มี = ไม่มีผล)
    const useCredit = confirm('ใช้เครดิตคงเหลือของดีลเลอร์ (จากการเคลม) หักยอดนี้ด้วยไหม?\n\nOK = ใช้เครดิตเท่าที่มี · Cancel = รับชำระเต็มยอดตามสลิป');
    run(async () => {
      await call('adminDealerOrderMarkPaid', { orderId: o.id, use_credit: useCredit });
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
                        {['paid', 'preparing'].includes(o.status) && !pickingDone(o) && (
                          <button onClick={() => setPickOrderId(o.id)} disabled={busy} className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 text-[10px] font-black uppercase flex items-center gap-1 disabled:opacity-50">
                            <ScanBarcode size={12} /> จัดของ {pickedCountOf(o) > 0 ? `${pickedCountOf(o)}/${o.item_count}` : ''}
                          </button>
                        )}
                        {['paid', 'preparing'].includes(o.status) && pickingDone(o) && (
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

      {/* Picking modal — สแกนบาร์โค้ด (QC TXN / IMEI / SN / GM) เช็คของครบก่อนส่ง */}
      {pickOrder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-black text-lg text-slate-800 uppercase tracking-tight flex items-center gap-2">
                  <ScanBarcode size={20} className="text-blue-500" /> จัดของ {pickOrder.order_no}
                </h3>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                  ผู้ออกรายการ: {pickOrder.created_by || '-'} — ต้องให้แอดมินคนอื่นเป็นผู้สแกนจัดของ
                </p>
              </div>
              <button onClick={() => setPickOrderId(null)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              {/* ช่องสแกน — barcode scanner พิมพ์รหัส+Enter ให้เอง / พิมพ์มือได้ */}
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 bg-blue-50 border-2 border-blue-200 rounded-xl px-4 focus-within:border-blue-500">
                  <ScanBarcode size={18} className="text-blue-400 shrink-0" />
                  <input
                    ref={scanInputRef}
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } }}
                    placeholder="ยิงบาร์โค้ด QC TXN / IMEI / Serial / เลข GM..."
                    className="flex-1 py-3.5 bg-transparent font-mono font-bold text-sm outline-none"
                    autoComplete="off"
                  />
                </div>
                <button onClick={handleScan} disabled={scanBusy || !scanCode.trim()} className="bg-blue-600 text-white px-5 rounded-xl font-black text-xs uppercase disabled:opacity-40">
                  เช็ค
                </button>
              </div>

              {/* Progress */}
              {(() => {
                const total = pickOrder.item_count || Object.keys(pickOrder.items || {}).length;
                const picked = pickedCountOf(pickOrder);
                return (
                  <div>
                    <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 mb-1">
                      <span>สแกนแล้ว {picked}/{total} เครื่อง</span>
                      {pickOrder.picking?.started_by && <span>ผู้จัด: {pickOrder.picking.started_by}</span>}
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${total > 0 ? (picked / total) * 100 : 0}%` }} />
                    </div>
                  </div>
                );
              })()}

              {/* รายการเครื่อง */}
              <div className="border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
                {Object.entries(pickOrder.items || {}).map(([jobId, it]) => {
                  const scanned = pickOrder.picking?.items?.[jobId];
                  return (
                    <div key={jobId} className={`flex items-center gap-3 px-4 py-3 ${scanned ? 'bg-emerald-50' : 'bg-white'}`}>
                      {scanned ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" /> : <span className="w-[18px] h-[18px] rounded-full border-2 border-slate-200 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm truncate">{it.model}</div>
                        <div className="text-[10px] font-mono font-bold text-slate-400">
                          {it.ref_no || '-'}
                          {scanned && ` · สแกน "${scanned.code}" โดย ${scanned.by || '-'} ${fmtDateTime(scanned.at)}`}
                        </div>
                      </div>
                      {scanned && !pickingDone(pickOrder) && (
                        <button onClick={() => handleUndoPick(jobId)} disabled={scanBusy} className="text-slate-300 hover:text-red-500 p-1" title="ยกเลิกรายการนี้">
                          <Undo2 size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50 shrink-0">
              {pickingDone(pickOrder) ? (
                <div className="text-center text-xs font-black text-emerald-600 uppercase flex items-center justify-center gap-2">
                  <PackageCheck size={16} /> จัดของครบแล้ว — กดจัดส่งได้เลย
                </div>
              ) : (
                <button
                  onClick={handleCompletePicking}
                  disabled={scanBusy || pickedCountOf(pickOrder) < (pickOrder.item_count || 0)}
                  className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-emerald-700 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <PackageCheck size={16} /> ยืนยันจัดของครบ {pickedCountOf(pickOrder)}/{pickOrder.item_count}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
