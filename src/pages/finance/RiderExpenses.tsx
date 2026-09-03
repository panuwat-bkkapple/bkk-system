// รีวิวคำขอเบิกค่าใช้จ่ายที่ไรเดอร์สำรองจ่าย (ค่าทางด่วน / ค่าจอดรถ)
//
// **หน้านี้ไม่เขียน DB เอง** — การอนุมัติ/ปฏิเสธไปผ่าน callable
// `adminReviewExpense` เท่านั้น เพราะการอนุมัติหนึ่งครั้งแตะสามโหนดพร้อมกัน
// (สถานะรายการ / กระเป๋าไรเดอร์ / บัญชีบริษัท) ซึ่งต้องเป็น atomic
// และต้อง idempotent — กดสองครั้งแล้วเติมเงินสองรอบคือความพังที่แพงที่สุด
// ของฟีเจอร์นี้ และไม่มีใครเห็นจนกว่าจะมีคนกระทบยอด
//
// ดีไซน์เต็ม: bkk-rider-app docs/reports/2026-09-02-rider-expense-claim-design.md

import { useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  ReceiptText, CheckCircle2, XCircle, Loader2, ExternalLink, AlertTriangle,
  Clock, ShieldAlert, Search,
} from 'lucide-react';
import { useDatabase } from '../../hooks/useDatabase';
import { useAuth } from '../../hooks/useAuth';
import { app } from '../../api/firebase';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useToast } from '../../components/ui/ToastProvider';
import { canReviewAdjustments } from '../../utils/adjustments';

const CATEGORY_LABEL: Record<string, string> = {
  toll: 'ค่าทางด่วน',
  parking: 'ค่าที่จอดรถ',
  other: 'ค่าใช้จ่ายอื่น',
};

type Tab = 'submitted' | 'paid' | 'rejected';

const TAB_LABEL: Record<Tab, string> = {
  submitted: 'รออนุมัติ',
  paid: 'อนุมัติแล้ว',
  rejected: 'ปฏิเสธแล้ว',
};

export const RiderExpenses = () => {
  const toast = useToast();
  const { currentUser } = useAuth();
  // โหนดนี้มีแต่คำขอเบิก จึงเล็กมาก subscribe ทั้งก้อนได้ตามกฎค่า RTDB
  // (เหตุผลเดียวกับ /withdrawals ใน RiderWithdrawals.tsx) — ถ้าวันหนึ่ง
  // ปริมาณโตจริง ให้ query ตาม .indexOn ["rider_id","status","submitted_at"]
  // ที่มีอยู่แล้ว ไม่ใช่ปล่อยให้ subscribe ทั้ง node ต่อไป
  const { data: rows, loading } = useDatabase('rider_expenses');
  const { data: riders } = useDatabase('riders');

  const [tab, setTab] = useState<Tab>('submitted');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const isCeo = String(currentUser?.role || '').toUpperCase() === 'CEO';
  // gate เดียวกับที่ server ใช้ — ห้ามเขียนเงื่อนไข role ขึ้นมาใหม่
  const canReview = canReviewAdjustments(currentUser?.role);

  const riderName = useMemo(() => {
    const m: Record<string, string> = {};
    (Array.isArray(riders) ? riders : []).forEach((r: { id?: string; name?: string }) => {
      if (r?.id) m[r.id] = r.name || r.id;
    });
    return m;
  }, [riders]);

  const list = useMemo(() => {
    const all = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
    const q = search.trim().toLowerCase();
    return all
      .filter((r) => {
        const status = String(r.status || '');
        if (tab === 'submitted') return status === 'submitted';
        if (tab === 'paid') return status === 'paid';
        return status === 'rejected';
      })
      .filter((r) => {
        if (!q) return true;
        const name = riderName[String(r.rider_id)] || '';
        return (
          name.toLowerCase().includes(q) ||
          String(r.job_id || '').toLowerCase().includes(q) ||
          String(r.note || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => Number(b.submitted_at || 0) - Number(a.submitted_at || 0));
  }, [rows, tab, search, riderName]);

  const pendingCount = useMemo(
    () => ((Array.isArray(rows) ? rows : []) as { status?: string }[])
      .filter((r) => r?.status === 'submitted').length,
    [rows]
  );

  const review = async (id: string, approve: boolean, rejectReason?: string) => {
    setBusyId(id);
    try {
      // repo นี้ไม่มี export `functions` ส่วนกลาง — ทุก call site สร้าง instance
      // เองพร้อม region (ดู DiagnosStartPanel / useFinanceGate) region ต้องตรงกับ
      // ฝั่ง functions ไม่งั้น callable หา endpoint ไม่เจอ
      await httpsCallable(getFunctions(app, 'asia-southeast1'), 'adminReviewExpense')({
        id,
        approve,
        reason: rejectReason || '',
      });
      toast.success(approve ? 'อนุมัติแล้ว เงินเข้ากระเป๋าไรเดอร์เรียบร้อย' : 'ปฏิเสธรายการแล้ว');
      setRejecting(null);
      setReason('');
    } catch (e) {
      // ข้อความจาก server เขียนมาให้อ่านได้อยู่แล้ว (เกินเพดาน / รีวิวซ้ำ /
      // ต้องให้ CEO อนุมัติ) — ห้ามกลืนแล้วโชว์ "เกิดข้อผิดพลาด" เฉยๆ
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  if (!canReview) {
    return (
      <div className="p-8">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center max-w-md mx-auto">
          <ShieldAlert size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="font-bold text-gray-700 mb-1">เฉพาะ CEO หรือ Manager</p>
          <p className="text-sm text-gray-500">
            การอนุมัติรายการนี้คือการสั่งจ่ายเงินออก จึงจำกัดสิทธิ์ไว้
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600"><ReceiptText size={22} /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">เบิกค่าใช้จ่ายไรเดอร์</h1>
          <p className="text-xs text-gray-500">
            ค่าทางด่วน / ค่าจอดรถ ที่ไรเดอร์สำรองจ่ายไปเอง — อนุมัติแล้วเงินเข้ากระเป๋าและลงบัญชีอัตโนมัติ
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-bold border ${
              tab === t
                ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                : 'bg-white border-gray-200 text-gray-500'
            }`}
          >
            {TAB_LABEL[t]}
            {t === 'submitted' && pendingCount > 0 && (
              <span className="ml-2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อไรเดอร์ / เลขงาน"
            className="pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-sm w-64"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm p-8">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
          <p className="font-bold text-gray-600 mb-1">ไม่มีรายการในหมวดนี้</p>
          <p className="text-sm text-gray-400">
            {tab === 'submitted' ? 'ยังไม่มีคำขอที่รออนุมัติ' : 'ยังไม่มีประวัติ'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => {
            const id = String(r.id);
            const evidence = (Array.isArray(r.evidence) ? r.evidence : []) as { url?: string }[];
            const needsCeo = r.needs_ceo === true;
            const blockedForMe = needsCeo && !isCeo;
            return (
              <div key={id} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900">
                        {CATEGORY_LABEL[String(r.category)] || CATEGORY_LABEL.other}
                      </span>
                      <span className="text-sm text-gray-500">
                        {riderName[String(r.rider_id)] || String(r.rider_id)}
                      </span>
                      {needsCeo && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200">
                          เกินเพดาน ต้อง CEO อนุมัติ
                        </span>
                      )}
                      {r.late === true && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                          <Clock size={10} /> เบิกย้อนหลัง
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {/* สองเวลาคนละตัว: จ่ายเมื่อไร กับ ส่งถึงระบบเมื่อไร —
                          คิวออฟไลน์ทำให้ห่างกันเป็นชั่วโมงได้ ต้องไม่ถูกอ่านว่า
                          ไรเดอร์ย้อนวันที่ */}
                      จ่ายเมื่อ {formatDate(Number(r.occurred_at))} · ส่งเมื่อ {formatDate(Number(r.submitted_at))}
                      {r.job_id ? ` · งาน #${String(r.job_id).slice(-6)}` : ' · ไม่ผูกกับงาน'}
                    </div>
                    {r.note ? <p className="text-sm text-gray-600 mt-2">{String(r.note)}</p> : null}
                  </div>
                  <div className="text-2xl font-bold text-gray-900 shrink-0">
                    {formatCurrency(Number(r.amount_thb))}
                  </div>
                </div>

                {/* หลักฐานต้องเปิดดูได้จริงก่อนกดอนุมัติ — ปุ่มอนุมัติที่กดได้
                    โดยไม่เคยเห็นรูปคือปุ่มที่เชิญให้กดผ่านๆ */}
                <div className="flex gap-2 mt-4 flex-wrap">
                  {evidence.map((e, i) =>
                    e?.url ? (
                      <a
                        key={i}
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-24 h-24 rounded-xl overflow-hidden border border-gray-200 relative group"
                      >
                        <img src={e.url} alt={`หลักฐาน ${i + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                          <ExternalLink size={16} className="text-white opacity-0 group-hover:opacity-100" />
                        </div>
                      </a>
                    ) : null
                  )}
                  {evidence.length === 0 && (
                    <div className="flex items-center gap-2 text-xs text-red-600">
                      <AlertTriangle size={14} /> ไม่มีหลักฐานแนบ — ไม่ควรอนุมัติ
                    </div>
                  )}
                </div>

                {String(r.status) === 'submitted' && (
                  rejecting === id ? (
                    <div className="mt-4 space-y-2">
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="เหตุผลที่ปฏิเสธ (ไรเดอร์จะเห็นข้อความนี้)"
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          disabled={busyId === id || reason.trim() === ''}
                          onClick={() => review(id, false, reason.trim())}
                          className="px-4 py-2 rounded-xl bg-red-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-bold"
                        >
                          ยืนยันปฏิเสธ
                        </button>
                        <button
                          onClick={() => { setRejecting(null); setReason(''); }}
                          className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-500"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-4 flex-wrap">
                      <button
                        disabled={busyId === id || blockedForMe || evidence.length === 0}
                        onClick={() => review(id, true)}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-bold flex items-center gap-2"
                      >
                        {busyId === id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        อนุมัติและจ่ายเข้ากระเป๋า
                      </button>
                      <button
                        disabled={busyId === id}
                        onClick={() => setRejecting(id)}
                        className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 flex items-center gap-2"
                      >
                        <XCircle size={14} /> ปฏิเสธ
                      </button>
                      {blockedForMe && (
                        <span className="text-xs text-violet-700">
                          ยอดนี้เกินเพดานของ Manager — รอ CEO อนุมัติ
                        </span>
                      )}
                    </div>
                  )
                )}

                {String(r.status) !== 'submitted' && (
                  <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-1">
                    <div>
                      {String(r.status) === 'paid' ? 'อนุมัติโดย' : 'ปฏิเสธโดย'}{' '}
                      {String(r.reviewed_by_name || '-')} · {formatDate(Number(r.reviewed_at))}
                    </div>
                    {r.reject_reason ? <div className="text-red-600">เหตุผล: {String(r.reject_reason)}</div> : null}
                    {/* ตามรอยกลับได้ทั้งสองทาง: จากรายการ → แถวกระเป๋า/แถวบัญชี */}
                    {r.paid_tx_id ? (
                      <div className="text-gray-400">
                        แถวกระเป๋า {String(r.paid_tx_id)} · แถวบัญชี {String(r.expense_doc_id || '-')}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
