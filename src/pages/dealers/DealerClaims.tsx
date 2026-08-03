// /dealer-claims — ตรวจคำขอเคลมดีลเลอร์ (CEO/MANAGER อนุมัติ/ปฏิเสธ, FINANCE บันทึกโอนคืน)
// อนุมัติ = ออกใบลดหนี้อัตโนมัติ (อ้างใบกำกับขายเดิม) + เลือกชดเชย โอนคืน/ตั้งเครดิต
// ข้อมูลผ่าน callable ทั้งหมด (rules ปิด client read ที่ dealer_claims)
import React, { useCallback, useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../hooks/useAuth';
import { ShieldCheck, RefreshCw, X, FileText, Wallet } from 'lucide-react';
import { fmtDateTime } from '../../types/dealer';

interface AdminClaim {
  id: string;
  claim_no: string;
  dealer_uid: string;
  company_name: string | null;
  order_no: string | null;
  model: string | null;
  ref_no: string | null;
  amount: number;
  warranty_days?: number;
  reason: string;
<<<<<<< HEAD
  photos?: string[] | null;
=======
>>>>>>> origin/main
  status: 'submitted' | 'approved' | 'resolved' | 'rejected';
  resolution?: 'refund' | 'credit' | null;
  approved_amount?: number | null;
  reject_reason?: string | null;
  credit_note?: { number: string; url?: string | null } | null;
  created_at?: number;
  decided_at?: number;
  decided_by?: string | null;
  resolved_at?: number;
}

const fns = () => getFunctions(app, 'asia-southeast1');
const call = async <T,>(name: string, data: Record<string, unknown> = {}): Promise<T> => {
  const fn = httpsCallable(fns(), name);
  return (await fn(data)).data as T;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'รอตรวจสอบ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'รอโอนเงินคืน', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  resolved: { label: 'เสร็จสิ้น', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'ปฏิเสธ', cls: 'bg-red-50 text-red-600 border-red-200' },
};

export const DealerClaims = () => {
  const toast = useToast();
  const { currentUser } = useAuth();
  const canDecide = ['CEO', 'MANAGER'].includes(currentUser?.role || '');
  const canRefund = ['CEO', 'FINANCE'].includes(currentUser?.role || '');
  const [claims, setClaims] = useState<AdminClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // โมดอลอนุมัติ
  const [deciding, setDeciding] = useState<AdminClaim | null>(null);
  const [resolution, setResolution] = useState<'refund' | 'credit'>('credit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call<{ claims: AdminClaim[] }>('adminDealerListClaims');
      setClaims(res.claims);
    } catch (err: any) {
      toast.error(err?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = () => {
    if (!deciding) return;
    const amt = Number(amount) || deciding.amount;
    run(async () => {
      const res = await call<{ ok: boolean; credit_note: string | null }>('adminDealerClaimApprove', {
        claimId: deciding.id,
        resolution,
        amount: amt,
        note: note.trim() || undefined,
      });
      toast.success(
        `อนุมัติ ${deciding.claim_no} (${resolution === 'credit' ? 'ตั้งเครดิต' : 'รอโอนคืน'})${res.credit_note ? ` · ใบลดหนี้ ${res.credit_note}` : ''}`
      );
      setDeciding(null);
    });
  };

  const handleReject = (c: AdminClaim) => {
    const reason = prompt(`ปฏิเสธคำขอเคลม ${c.claim_no}? ระบุเหตุผล (แจ้งดีลเลอร์):`);
    if (reason === null) return;
    run(async () => {
      await call('adminDealerClaimReject', { claimId: c.id, reason });
      toast.success('ปฏิเสธคำขอแล้ว');
    });
  };

  const handleMarkRefunded = (c: AdminClaim) => {
    if (!confirm(`ยืนยันว่าโอนเงินคืน ${c.claim_no} ยอด ฿${(c.approved_amount || 0).toLocaleString()} ให้ ${c.company_name} แล้ว?`)) return;
    run(async () => {
      await call('adminDealerClaimMarkRefunded', { claimId: c.id });
      toast.success('บันทึกการโอนคืนแล้ว');
    });
  };

  const pending = claims.filter((c) => c.status === 'submitted');
  const awaitingRefund = claims.filter((c) => c.status === 'approved');
  const history = claims.filter((c) => ['resolved', 'rejected'].includes(c.status));

  const ClaimCard = ({ c, actions }: { c: AdminClaim; actions?: React.ReactNode }) => {
    const meta = STATUS_META[c.status] || { label: c.status, cls: '' };
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-black text-sm text-slate-800">{c.claim_no}</span>
              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${meta.cls}`}>{meta.label}</span>
              {c.resolution && (
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded border bg-slate-50 text-slate-500 border-slate-200">
                  {c.resolution === 'credit' ? 'ตั้งเครดิต' : 'โอนคืน'}
                </span>
              )}
            </div>
            <div className="text-xs font-bold text-slate-600 mt-1">
              {c.company_name || '-'} · {c.model || '-'}{c.ref_no ? ` (${c.ref_no})` : ''} · ออเดอร์ {c.order_no || '-'}
            </div>
            <div className="text-[11px] text-slate-500 font-bold mt-1 whitespace-pre-wrap">อาการ: {c.reason}</div>
<<<<<<< HEAD
            {Array.isArray(c.photos) && c.photos.length > 0 && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {c.photos.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={`รูปเคลมที่ ${i + 1}`} className="w-14 h-14 object-cover rounded-lg border border-slate-200 hover:border-blue-400" />
                  </a>
                ))}
              </div>
            )}
=======
>>>>>>> origin/main
            <div className="text-[10px] text-slate-400 font-bold mt-1">
              ยื่นเมื่อ {fmtDateTime(c.created_at)}
              {c.decided_by ? ` · ตัดสินโดย ${c.decided_by}` : ''}
              {c.reject_reason ? ` · เหตุผล: ${c.reject_reason}` : ''}
            </div>
            {c.credit_note?.number && (
              <a
                href={c.credit_note.url || undefined}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-black text-blue-600 mt-1 hover:underline"
              >
                <FileText size={11} /> ใบลดหนี้ {c.credit_note.number}
              </a>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono font-black text-slate-800">฿{(c.approved_amount ?? c.amount).toLocaleString()}</div>
            <div className="flex gap-2 mt-2 justify-end flex-wrap">{actions}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <ShieldCheck size={22} className="text-amber-500" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800">เคลมดีลเลอร์</h1>
            <p className="text-xs text-slate-500 font-bold">อนุมัติ = ออกใบลดหนี้อัตโนมัติ + เลือกชดเชย โอนคืน/ตั้งเครดิต</p>
          </div>
        </div>
        <button onClick={() => void load()} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-slate-200 flex items-center gap-1.5">
          <RefreshCw size={13} /> รีเฟรช
        </button>
      </div>

      {loading && <div className="text-center text-slate-400 font-bold py-10">กำลังโหลด...</div>}

      {!loading && (
        <>
          <section className="space-y-3">
            <h2 className="font-black text-xs uppercase tracking-widest text-amber-600">รอตรวจสอบ ({pending.length})</h2>
            {pending.length === 0 && <div className="text-xs text-slate-400 font-bold italic">ไม่มีคำขอค้าง</div>}
            {pending.map((c) => (
              <ClaimCard
                key={c.id}
                c={c}
                actions={canDecide && (
                  <>
                    <button
                      onClick={() => { setDeciding(c); setResolution('credit'); setAmount(String(c.amount)); setNote(''); }}
                      disabled={busy}
                      className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50"
                    >
                      อนุมัติ
                    </button>
                    <button onClick={() => handleReject(c)} disabled={busy} className="bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase hover:bg-red-100 disabled:opacity-50">
                      ปฏิเสธ
                    </button>
                  </>
                )}
              />
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="font-black text-xs uppercase tracking-widest text-blue-600">อนุมัติแล้ว — รอโอนเงินคืน ({awaitingRefund.length})</h2>
            {awaitingRefund.length === 0 && <div className="text-xs text-slate-400 font-bold italic">ไม่มีรายการค้างโอน</div>}
            {awaitingRefund.map((c) => (
              <ClaimCard
                key={c.id}
                c={c}
                actions={canRefund && (
                  <button onClick={() => handleMarkRefunded(c)} disabled={busy} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                    <Wallet size={12} /> บันทึกโอนแล้ว
                  </button>
                )}
              />
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="font-black text-xs uppercase tracking-widest text-slate-400">ประวัติ ({history.length})</h2>
            {history.map((c) => <ClaimCard key={c.id} c={c} />)}
          </section>
        </>
      )}

      {/* โมดอลอนุมัติ */}
      {deciding && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-black text-slate-800">อนุมัติเคลม {deciding.claim_no}</h3>
              <button onClick={() => setDeciding(null)} className="text-slate-400 hover:text-slate-600"><X size={22} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-xs font-bold text-slate-600">
                {deciding.company_name} · {deciding.model} · มูลค่าเครื่อง ฿{deciding.amount.toLocaleString()}
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">วิธีชดเชย</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    onClick={() => setResolution('credit')}
                    className={`py-2.5 rounded-xl border text-xs font-black ${resolution === 'credit' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}
                  >
                    ตั้งเครดิต (หักออเดอร์หน้า)
                  </button>
                  <button
                    onClick={() => setResolution('refund')}
                    className={`py-2.5 rounded-xl border text-xs font-black ${resolution === 'refund' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}
                  >
                    โอนเงินคืน
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ยอดชดเชย (สูงสุด ฿{deciding.amount.toLocaleString()})</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono font-bold text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">หมายเหตุ (ไม่บังคับ)</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none" />
              </div>
              <p className="text-[10px] font-bold text-slate-400 leading-relaxed">
                ระบบจะออกใบลดหนี้อ้างใบกำกับภาษีขายเดิมอัตโนมัติ (ยอดลด VAT เข้ารายงาน ภ.พ.30)
                {resolution === 'credit' ? ' และเพิ่มเครดิตให้ดีลเลอร์ทันที' : ' — โอนเงินแล้วมาบันทึกที่รายการ "รอโอนเงินคืน"'}
              </p>
              <button onClick={handleApprove} disabled={busy} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-black text-xs uppercase hover:bg-emerald-700 disabled:opacity-50">
                {busy ? 'กำลังบันทึก...' : `อนุมัติ + ออกใบลดหนี้`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
