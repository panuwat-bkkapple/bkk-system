// /lots/:id — รายละเอียด lot: เครื่องในล็อต, ตัวนับซอง (5/30), timeline audit,
// ปุ่มตาม lifecycle (publish/close/cancel = CEO/MANAGER) และโซนเปิดซอง + อนุมัติ
// ราคาในซองไม่มีทางเห็นจนกด "เปิดซอง" (callable — CEO/MANAGER + lot ปิดรับแล้ว)
import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../hooks/useAuth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import {
  ArrowLeft, Boxes, Lock, Unlock, Send, Ban, Clock3, CheckCircle2, History,
} from 'lucide-react';
import {
  LOT_STATUS_META, TIER_META, DEALER_TIERS, fmtBaht, fmtDateTime,
  type Lot, type UnsealedBid,
} from '../../types/dealer';

const call = async (name: string, data: Record<string, unknown>) => {
  const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), name);
  return (await fn(data)).data as any;
};

const AUDIT_LABEL: Record<string, string> = {
  published: 'เปิดรับราคา (Publish)',
  bid_placed: 'มีผู้เสนอราคา',
  bid_revised: 'มีการแก้ไขซอง',
  closed: 'ปิดรับราคา',
  unsealed: 'เปิดซอง',
  awarded: 'อนุมัติผู้ชนะ',
  order_paid: 'รับชำระเงิน',
  order_cancelled: 'ยกเลิกคำสั่งซื้อ',
  cancelled: 'ยกเลิก lot',
  completed: 'จบงาน',
};

export const LotDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { hasAccess } = useAuth();
  const canManage = hasAccess(['CEO', 'MANAGER']);
  const { data: lotsRaw, loading } = useDatabase('lots');
  const { data: privRaw } = useDatabase('lot_private');
  const { data: auditRaw } = useDatabase('lot_audit');

  const [busy, setBusy] = useState(false);
  const [unsealed, setUnsealed] = useState<{ bids: UnsealedBid[]; private: any } | null>(null);
  // per-item award selection: jobId -> dealer_uid
  const [itemWinners, setItemWinners] = useState<Record<string, string>>({});
  const [awardMode, setAwardMode] = useState<'whole_lot' | 'per_item'>('whole_lot');
  const [wholeLotWinner, setWholeLotWinner] = useState<string>('');

  const lot: Lot | undefined = useMemo(() => {
    const list = Array.isArray(lotsRaw) ? lotsRaw : [];
    return list.find((l: Lot) => l.id === id);
  }, [lotsRaw, id]);

  const priv = useMemo(() => {
    const list = Array.isArray(privRaw) ? privRaw : [];
    return list.find((p: any) => p.id === id) || {};
  }, [privRaw, id]);

  const audit = useMemo(() => {
    const list = Array.isArray(auditRaw) ? auditRaw : [];
    const row = list.find((a: any) => a.id === id);
    if (!row) return [];
    return Object.entries(row)
      .filter(([k]) => k !== 'id')
      .map(([k, v]: [string, any]) => ({ key: k, ...v }))
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }, [auditRaw, id]);

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

  const handlePublish = () => {
    if (!confirm('Publish lot นี้? เครื่องทุกตัวจะถูกล็อก (Reserved) และระบบจะแจ้งดีลเลอร์ tier ที่มีสิทธิ์ทันที')) return;
    run(async () => {
      const res = await call('adminDealerLotPublish', { lotId: id });
      toast.success(`เปิดรับราคาแล้ว — ${res.lot_no} (แจ้งดีลเลอร์ ${res.eligible_count} ราย)`);
    });
  };

  const handleClose = () => {
    if (!confirm('ปิดรับราคาก่อนกำหนด?')) return;
    run(async () => {
      await call('adminDealerLotClose', { lotId: id });
      toast.success('ปิดรับราคาแล้ว');
    });
  };

  const handleCancel = () => {
    const reason = prompt('เหตุผลการยกเลิก lot (บันทึกลง audit):');
    if (reason === null) return;
    run(async () => {
      await call('adminDealerLotCancel', { lotId: id, reason });
      toast.success('ยกเลิก lot แล้ว — เครื่องกลับเข้าสต๊อก');
    });
  };

  const handleUnseal = () => {
    if (!lot?.unsealed_at && !confirm('เปิดซองราคา? การเปิดซองจะถูกบันทึกชื่อผู้เปิด + เวลาลง audit ถาวร')) return;
    run(async () => {
      const res = await call('adminDealerLotUnsealBids', { lotId: id });
      setUnsealed(res);
      // ตั้งค่าเริ่มต้น award: ยกล็อตสูงสุด / รายตัว = ผู้เสนอสูงสุดต่อเครื่อง
      const wholeBids = (res.bids as UnsealedBid[]).filter((b) => b.type === 'whole_lot' && b.amount_total);
      if (wholeBids.length > 0) setWholeLotWinner(wholeBids[0].dealer_uid);
      const winners: Record<string, string> = {};
      for (const jobId of Object.keys(lot?.items || {})) {
        let best: { uid: string; amt: number } | null = null;
        for (const b of res.bids as UnsealedBid[]) {
          const amt = b.item_bids?.[jobId];
          if (amt && (!best || amt > best.amt)) best = { uid: b.dealer_uid, amt };
        }
        if (best) winners[jobId] = best.uid;
      }
      setItemWinners(winners);
      if (wholeBids.length === 0 && Object.keys(winners).length > 0) setAwardMode('per_item');
    });
  };

  const perItemTotal = useMemo(() => {
    if (!unsealed) return 0;
    let sum = 0;
    for (const [jobId, uid] of Object.entries(itemWinners)) {
      if (!uid) continue;
      const bid = unsealed.bids.find((b) => b.dealer_uid === uid);
      sum += bid?.item_bids?.[jobId] || 0;
    }
    return sum;
  }, [unsealed, itemWinners]);

  const wholeLotAmount = useMemo(() => {
    if (!unsealed || !wholeLotWinner) return 0;
    return unsealed.bids.find((b) => b.dealer_uid === wholeLotWinner)?.amount_total || 0;
  }, [unsealed, wholeLotWinner]);

  const handleAward = () => {
    if (!unsealed) return;
    const total = awardMode === 'whole_lot' ? wholeLotAmount : perItemTotal;
    const reserve = Number(unsealed.private?.reserve_price) || 0;
    const belowReserve = reserve > 0 && total < reserve;
    const msg = `อนุมัติขาย${awardMode === 'whole_lot' ? 'ยกล็อต' : 'รายตัว'} ยอดรวม ${total.toLocaleString()} บาท?` +
      (belowReserve ? `\n\n⚠️ ต่ำกว่าราคาขั้นต่ำ (${reserve.toLocaleString()}) — ยืนยันเพื่ออนุมัติต่ำกว่า reserve` : '') +
      '\n\nระบบจะสร้างคำสั่งซื้อ + ออกใบเสนอราคา PDF + แจ้งดีลเลอร์ทันที';
    if (!confirm(msg)) return;
    run(async () => {
      const payload: Record<string, unknown> = { lotId: id, type: awardMode, below_reserve_ack: belowReserve };
      if (awardMode === 'whole_lot') payload.dealer_uid = wholeLotWinner;
      else payload.item_awards = Object.fromEntries(Object.entries(itemWinners).filter(([, uid]) => uid));
      const res = await call('adminDealerLotAward', payload);
      toast.success(`อนุมัติแล้ว — สร้าง ${res.orders.length} คำสั่งซื้อ`);
      setUnsealed(null);
    });
  };

  if (loading) return <div className="p-10 text-center text-slate-400">Loading...</div>;
  if (!lot) return <div className="p-10 text-center text-slate-400 font-bold">ไม่พบ lot นี้</div>;

  const meta = LOT_STATUS_META[lot.status] || LOT_STATUS_META.draft;
  const items = Object.entries(lot.items || {});
  const bidCount = priv.bid_count || 0;
  const canUnseal = canManage && ['closed', 'awarding'].includes(lot.status);

  return (
    <div className="p-6 bg-slate-100 min-h-screen font-sans text-slate-800">
      <button onClick={() => navigate('/lots')} className="flex items-center gap-1 text-xs font-black text-slate-500 uppercase mb-4 hover:text-slate-800">
        <ArrowLeft size={14} /> กลับ Lot Manager
      </button>

      <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-slate-800 flex items-center gap-2">
              <Boxes className="text-blue-600" /> {lot.lot_no || '(Draft)'}
            </h1>
            <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border ${meta.cls}`}>{meta.label}</span>
          </div>
          <p className="font-bold text-slate-600 mt-1">{lot.title}</p>
          {lot.description && <p className="text-xs text-slate-400 font-bold mt-0.5">{lot.description}</p>}
          <div className="flex gap-1 mt-2">
            {DEALER_TIERS.filter((t) => lot.visible_tiers?.[t]).map((t) => (
              <span key={t} className={`text-[9px] font-black px-2 py-0.5 rounded border ${TIER_META[t].cls}`}>Tier {t}</span>
            ))}
            <span className="text-[9px] font-black px-2 py-0.5 rounded border bg-slate-50 text-slate-500 border-slate-200">
              {lot.show_bid_stats ? 'ดีลเลอร์เห็นจำนวนผู้เสนอ' : 'จำนวนผู้เสนอเห็นเฉพาะแอดมิน'}
            </span>
          </div>
        </div>

        {canManage && (
          <div className="flex gap-2">
            {lot.status === 'draft' && (
              <button onClick={handlePublish} disabled={busy} className="bg-green-600 text-white px-5 py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50">
                <Send size={14} /> Publish เปิดรับราคา
              </button>
            )}
            {lot.status === 'open' && (
              <button onClick={handleClose} disabled={busy} className="bg-amber-500 text-white px-5 py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-amber-600 flex items-center gap-2 disabled:opacity-50">
                <Clock3 size={14} /> ปิดรับก่อนกำหนด
              </button>
            )}
            {canUnseal && (
              <button onClick={handleUnseal} disabled={busy} className="bg-purple-600 text-white px-5 py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50">
                <Unlock size={14} /> {lot.unsealed_at ? 'ดูซองอีกครั้ง' : 'เปิดซองราคา'}
              </button>
            )}
            {['draft', 'open', 'closed', 'awarding'].includes(lot.status) && (
              <button onClick={handleCancel} disabled={busy} className="bg-red-50 text-red-600 border border-red-200 px-4 py-3 rounded-xl font-black text-xs uppercase hover:bg-red-100 flex items-center gap-2 disabled:opacity-50">
                <Ban size={14} /> ยกเลิก
              </button>
            )}
          </div>
        )}
      </div>

      {/* สถิติแถวบน */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="จำนวนเครื่อง" value={`${lot.item_count}`} />
        <Stat label="ผู้เสนอราคา" value={`${bidCount}/${lot.eligible_count || 0}`} accent="text-purple-600" icon={<Lock size={14} />} />
        <Stat label="ปิดรับราคา" value={fmtDateTime(lot.close_at)} />
        <Stat
          label={lot.award ? 'ยอดอนุมัติ' : canManage ? 'ต้นทุนรวม (แอดมิน)' : 'ราคาตั้งรวม'}
          value={lot.award ? fmtBaht(lot.award.total_amount) : canManage ? fmtBaht(priv.total_cost) : fmtBaht(lot.asking_total)}
          accent={lot.award ? 'text-blue-600' : undefined}
        />
      </div>

      {lot.award && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6 flex items-center justify-between">
          <div className="text-sm font-bold text-blue-800 flex items-center gap-2">
            <CheckCircle2 size={16} />
            อนุมัติแล้วโดย {lot.award.approved_by_name || '-'} · {fmtDateTime(lot.award.approved_at)} · ยอดรวม {fmtBaht(lot.award.total_amount)}
            {lot.award.below_reserve && <span className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">ต่ำกว่า reserve</span>}
          </div>
          <button onClick={() => navigate('/dealer-orders')} className="text-xs font-black text-blue-700 underline">ดูคำสั่งซื้อ →</button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ตารางเครื่อง */}
        <div className="xl:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 font-black text-xs uppercase tracking-widest text-slate-500">เครื่องในล็อต</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3 text-[10px] font-black text-slate-400 uppercase">เครื่อง</th>
                  <th className="p-3 text-[10px] font-black text-slate-400 uppercase text-center">เกรด</th>
                  <th className="p-3 text-[10px] font-black text-slate-400 uppercase text-right">ราคาตั้ง</th>
                  {canManage && <th className="p-3 text-[10px] font-black text-slate-400 uppercase text-right">ทุน</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map(([jobId, it]) => (
                  <tr key={jobId}>
                    <td className="p-3">
                      <div className="font-bold text-sm">{it.model}</div>
                      <div className="text-[10px] font-mono text-slate-400">{it.ref_no} · SN {it.serial_masked || '-'}</div>
                    </td>
                    <td className="p-3 text-center font-black">{it.grade || '-'}</td>
                    <td className="p-3 text-right font-bold text-slate-600">{fmtBaht(it.asking_price)}</td>
                    {canManage && <td className="p-3 text-right font-bold text-slate-400">{fmtBaht(priv.item_costs?.[jobId])}</td>}
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-slate-400 italic font-bold text-sm">
                    ยังไม่ snapshot เครื่อง (จะเกิดตอน Publish) — {Object.keys(lot.item_ids || {}).length} เครื่องที่เลือกไว้
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Timeline audit */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 font-black text-xs uppercase tracking-widest text-slate-500 flex items-center gap-2">
            <History size={14} /> Timeline (Audit)
          </div>
          <div className="p-4 space-y-3 max-h-[50vh] overflow-y-auto">
            {audit.map((a: any) => (
              <div key={a.key} className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                <div>
                  <div className="text-xs font-black text-slate-700">
                    {AUDIT_LABEL[a.event] || a.event}
                    {a.detail?.bid_no && <span className="text-slate-400 font-bold"> · {a.detail.bid_no}</span>}
                    {a.detail?.by && <span className="text-slate-400 font-bold"> · โดย {a.detail.by}</span>}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400">{fmtDateTime(a.at)}</div>
                </div>
              </div>
            ))}
            {audit.length === 0 && <div className="text-slate-400 italic font-bold text-sm">ยังไม่มีเหตุการณ์</div>}
          </div>
        </div>
      </div>

      {/* ───── โซนเปิดซอง + อนุมัติ ───── */}
      {unsealed && (
        <div className="mt-6 bg-white rounded-2xl shadow-xl border-2 border-purple-200 overflow-hidden">
          <div className="p-4 bg-purple-50 border-b border-purple-100 flex items-center justify-between">
            <div className="font-black text-sm text-purple-800 uppercase tracking-widest flex items-center gap-2">
              <Unlock size={16} /> ซองราคา ({unsealed.bids.length} ราย)
            </div>
            <div className="text-xs font-bold text-purple-600">
              ต้นทุนรวม {fmtBaht(unsealed.private?.total_cost)}
              {unsealed.private?.reserve_price ? ` · Reserve ${fmtBaht(unsealed.private.reserve_price)}` : ''}
            </div>
          </div>

          {/* ซองยกล็อต */}
          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-black text-xs uppercase tracking-widest text-slate-500">เสนอยกล็อต</div>
                <label className="flex items-center gap-1 text-xs font-black cursor-pointer">
                  <input type="radio" checked={awardMode === 'whole_lot'} onChange={() => setAwardMode('whole_lot')} /> อนุมัติแบบยกล็อต
                </label>
              </div>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                {unsealed.bids.filter((b) => b.type === 'whole_lot' && b.amount_total).map((b) => {
                  const margin = (b.amount_total || 0) - (unsealed.private?.total_cost || 0);
                  return (
                    <label key={b.dealer_uid} className={`flex items-center gap-3 p-3 cursor-pointer ${wholeLotWinner === b.dealer_uid && awardMode === 'whole_lot' ? 'bg-purple-50' : ''}`}>
                      <input type="radio" name="wholeLotWinner" disabled={awardMode !== 'whole_lot'} checked={wholeLotWinner === b.dealer_uid} onChange={() => setWholeLotWinner(b.dealer_uid)} />
                      <div className="flex-1">
                        <div className="font-bold text-sm">{b.company_name} <span className="text-[10px] text-slate-400">({b.bid_no} · Tier {b.tier})</span></div>
                        {b.note && <div className="text-[10px] text-slate-400 font-bold">"{b.note}"</div>}
                        {b.revision_count > 0 && <div className="text-[9px] text-amber-500 font-bold">แก้ไข {b.revision_count} ครั้ง</div>}
                      </div>
                      <div className="text-right">
                        <div className="font-black text-purple-700">{fmtBaht(b.amount_total)}</div>
                        <div className={`text-[10px] font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-500'}`}>margin {fmtBaht(margin)}</div>
                      </div>
                    </label>
                  );
                })}
                {unsealed.bids.filter((b) => b.type === 'whole_lot').length === 0 && (
                  <div className="p-4 text-center text-slate-400 italic font-bold text-sm">ไม่มีซองแบบยกล็อต</div>
                )}
              </div>
            </div>

            {/* ซองรายตัว */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-black text-xs uppercase tracking-widest text-slate-500">เสนอรายตัว (เลือกผู้ชนะต่อเครื่อง)</div>
                <label className="flex items-center gap-1 text-xs font-black cursor-pointer">
                  <input type="radio" checked={awardMode === 'per_item'} onChange={() => setAwardMode('per_item')} /> อนุมัติแบบรายตัว
                </label>
              </div>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[40vh] overflow-y-auto">
                {items.map(([jobId, it]) => {
                  const bidders = unsealed.bids.filter((b) => b.item_bids?.[jobId]);
                  if (bidders.length === 0) return (
                    <div key={jobId} className="p-3 flex justify-between items-center opacity-50">
                      <div className="text-sm font-bold">{it.model}</div>
                      <div className="text-[10px] font-bold text-slate-400">ไม่มีผู้เสนอ — คืนเข้าสต๊อก</div>
                    </div>
                  );
                  return (
                    <div key={jobId} className="p-3">
                      <div className="text-sm font-bold mb-1">{it.model} <span className="text-[10px] text-slate-400 font-mono">{it.ref_no}</span></div>
                      <select
                        value={itemWinners[jobId] || ''}
                        disabled={awardMode !== 'per_item'}
                        onChange={(e) => setItemWinners({ ...itemWinners, [jobId]: e.target.value })}
                        className="w-full p-2 rounded-lg border border-slate-200 text-xs font-bold outline-none"
                      >
                        <option value="">— ไม่ขายเครื่องนี้ (คืนสต๊อก) —</option>
                        {bidders
                          .sort((a, b) => (b.item_bids![jobId] || 0) - (a.item_bids![jobId] || 0))
                          .map((b) => (
                            <option key={b.dealer_uid} value={b.dealer_uid}>
                              {b.company_name} — {(b.item_bids![jobId] || 0).toLocaleString()} บาท
                            </option>
                          ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* แถบสรุป + ปุ่มอนุมัติ */}
          {lot.status === 'awarding' && (
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-black text-slate-700">
                {awardMode === 'whole_lot'
                  ? `ยกล็อต: ${fmtBaht(wholeLotAmount)}`
                  : `รายตัว ${Object.values(itemWinners).filter(Boolean).length} เครื่อง: ${fmtBaht(perItemTotal)}`}
                <span className="text-slate-400 font-bold text-xs ml-2">
                  (เทียบ: ยกล็อตสูงสุด {fmtBaht(Math.max(0, ...unsealed.bids.filter((b) => b.type === 'whole_lot').map((b) => b.amount_total || 0)))} / ผลรวม best รายตัว {fmtBaht(perItemTotal)})
                </span>
              </div>
              <button
                onClick={handleAward}
                disabled={busy || (awardMode === 'whole_lot' ? !wholeLotWinner : Object.values(itemWinners).filter(Boolean).length === 0)}
                className="bg-purple-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-purple-700 disabled:opacity-40 flex items-center gap-2"
              >
                <CheckCircle2 size={16} /> อนุมัติ + ออกใบเสนอราคา
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, accent, icon }: { label: string; value: string; accent?: string; icon?: React.ReactNode }) => (
  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1">{icon}{label}</div>
    <div className={`text-lg font-black ${accent || 'text-slate-800'}`}>{value}</div>
  </div>
);
