// ใบเบิกค่าใช้จ่ายที่ไรเดอร์สำรองจ่าย (ค่าทางด่วน / ค่าจอดรถ)
//
// **หน้านี้ไม่เขียน DB เอง** — ทุกการกดไปผ่าน callable `adminReviewExpense`
// เท่านั้น เพราะขั้นจ่ายเงินแตะสามโหนดพร้อมกัน (สถานะ / กระเป๋าไรเดอร์ /
// บัญชีบริษัท) ซึ่งต้อง atomic และต้อง idempotent
//
// **สามขั้น ไม่ใช่ปุ่มเดียว** ตามที่เจ้าของงานกำหนด: หัวหน้าไรเดอร์ยืนยันว่างาน
// นั้นวิ่งจริง → ฝ่ายบัญชีตรวจเอกสารแล้วตั้งเบิก → ฝ่ายบัญชีจ่ายเงิน. เหตุผลที่
// สองขั้นหลังไม่ยุบเป็นปุ่มเดียวแม้เป็นคนเดียวกันกด: สถานะ "ตั้งเบิกแล้วแต่ยัง
// ไม่จ่าย" คือสิ่งเดียวที่บอกว่าค้างจ่ายอยู่เท่าไร ยุบแล้วตัวเลขนั้นหายไปจาก
// ระบบโดยไม่มีที่อื่นเก็บแทน
//
// ดีไซน์เต็ม: bkk-rider-app docs/reports/2026-09-02-rider-expense-claim-design.md

import { useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  ReceiptText, CheckCircle2, XCircle, Loader2, ExternalLink, AlertTriangle,
  Clock, ShieldAlert, Search, Undo2, Wallet, FileCheck2,
} from 'lucide-react';
import { useDatabase } from '../../hooks/useDatabase';
import { useAuth } from '../../hooks/useAuth';
import { app } from '../../api/firebase';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useToast } from '../../components/ui/ToastProvider';
import { canReviewAdjustments } from '../../utils/adjustments';
import { isFinanceActor } from '../../utils/financeGate';
import { useFinanceGate } from '../../hooks/useFinanceGate';
import {
  expenseActionsFor,
  EXPENSE_ACTION_LABEL,
  EXPENSE_ACTION_NEEDS_REASON,
  EXPENSE_STATUS_LABEL,
  type ExpenseAction,
  type ExpenseStatus,
} from '../../utils/riderExpenseFlow';

const CATEGORY_LABEL: Record<string, string> = {
  toll: 'ค่าทางด่วน',
  parking: 'ค่าที่จอดรถ',
  other: 'ค่าใช้จ่ายอื่น',
};

const ACTION_ICON: Record<ExpenseAction, typeof CheckCircle2> = {
  ops_approve: CheckCircle2,
  finance_approve: FileCheck2,
  pay: Wallet,
  send_back: Undo2,
  reject: XCircle,
  resubmit: Undo2,
};

/** แท็บจัดตาม "ใครต้องกด" ไม่ใช่ตามชื่อสถานะ — คนเปิดหน้านี้มาหาคิวของตัวเอง */
type Tab = 'ops' | 'finance' | 'needs_info' | 'paid' | 'rejected';

const TAB_LABEL: Record<Tab, string> = {
  ops: 'รอหัวหน้าตรวจ',
  finance: 'รอฝ่ายบัญชี',
  needs_info: 'ส่งกลับให้แก้',
  paid: 'จ่ายแล้ว',
  rejected: 'ปฏิเสธ',
};

const TAB_STATUSES: Record<Tab, ExpenseStatus[]> = {
  ops: ['submitted'],
  finance: ['approved', 'finance_approved'],
  needs_info: ['needs_info'],
  paid: ['paid'],
  rejected: ['rejected'],
};

const STATUS_CHIP: Record<string, string> = {
  submitted: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-sky-50 text-sky-800 border-sky-200',
  finance_approved: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  paid: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  needs_info: 'bg-orange-50 text-orange-800 border-orange-200',
  rejected: 'bg-gray-100 text-gray-600 border-gray-200',
};

export const RiderExpenses = () => {
  const toast = useToast();
  const { currentUser } = useAuth();
  // ประตูฝั่งบัญชีตัวเดียวกับที่หน้าอื่นใช้ — ห้ามเขียนเงื่อนไข role ขึ้นใหม่
  // (การตัดสินจริงอยู่ฝั่ง server ที่ `financeActorVerdict` ตัวนี้แค่ซ่อนปุ่ม)
  const { hasClaim, guard } = useFinanceGate();
  // โหนดนี้มีแต่คำขอเบิก จึงเล็กมาก subscribe ทั้งก้อนได้ตามกฎค่า RTDB
  // (เหตุผลเดียวกับ /withdrawals ใน RiderWithdrawals.tsx) — ถ้าวันหนึ่ง
  // ปริมาณโตจริง ให้ query ตาม .indexOn ["rider_id","status","submitted_at"]
  // ที่มีอยู่แล้ว ไม่ใช่ปล่อยให้ subscribe ทั้ง node ต่อไป
  const { data: rows, loading } = useDatabase('rider_expenses');
  const { data: riders } = useDatabase('riders');

  const isOps = canReviewAdjustments(currentUser?.role);
  const isFinance = isFinanceActor({ role: currentUser?.role, hasClaim });

  const [tab, setTab] = useState<Tab>(isOps ? 'ops' : 'finance');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ id: string; action: ExpenseAction } | null>(null);
  const [reason, setReason] = useState('');

  const isCeo = String(currentUser?.role || '').toUpperCase() === 'CEO';

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
    const want = TAB_STATUSES[tab] as string[];
    return all
      .filter((r) => want.includes(String(r.status || '')))
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

  const countByTab = useMemo(() => {
    const all = (Array.isArray(rows) ? rows : []) as { status?: string }[];
    const out = {} as Record<Tab, number>;
    (Object.keys(TAB_STATUSES) as Tab[]).forEach((t) => {
      const want = TAB_STATUSES[t] as string[];
      out[t] = all.filter((r) => want.includes(String(r?.status || ''))).length;
    });
    return out;
  }, [rows]);

  const run = async (id: string, action: ExpenseAction, why?: string) => {
    // ขั้นจ่ายเงินคือเงินออกจากบริษัทจริง — ต้องลง audit ทั้งที่ผ่านและถูกปฏิเสธ
    // เหมือนทุกปุ่มจ่ายเงินในระบบ (การตัดสินจริงยังอยู่ฝั่ง server)
    if (action === 'pay') {
      const row = ((Array.isArray(rows) ? rows : []) as Record<string, unknown>[])
        .find((r) => String(r.id) === id);
      // บันทึกความพยายามเสมอ ทั้งที่ผ่านและถูกปฏิเสธ (เหมือนทุกปุ่มเงินออก)
      guard('rider_expense_pay', { refId: id, amount: Number(row?.amount_thb) || null });
      if (!isFinance) {
        toast.error('บัญชีนี้ไม่มีสิทธิ์จ่ายเงินออก — ให้ CEO เปิดสิทธิ์ให้ที่หน้าจัดการพนักงาน');
        return;
      }
    }

    setBusyId(id);
    try {
      // repo นี้ไม่มี export `functions` ส่วนกลาง — ทุก call site สร้าง instance
      // เองพร้อม region (ดู DiagnosStartPanel / useFinanceGate) region ต้องตรงกับ
      // ฝั่ง functions ไม่งั้น callable หา endpoint ไม่เจอ
      const res = await httpsCallable(getFunctions(app, 'asia-southeast1'), 'adminReviewExpense')({
        id,
        action,
        reason: why || '',
      });
      const status = (res.data as { status?: string })?.status;
      toast.success(
        status === 'paid'
          ? 'จ่ายแล้ว เงินเข้ากระเป๋าไรเดอร์เรียบร้อย'
          : `บันทึกแล้ว: ${EXPENSE_STATUS_LABEL[status as ExpenseStatus] || 'สำเร็จ'}`
      );
      setAsking(null);
      setReason('');
    } catch (e) {
      // ข้อความจาก server เขียนมาให้อ่านได้อยู่แล้ว (เกินเพดาน / ข้ามขั้น /
      // ไม่ใช่ฝ่ายที่ถือใบ) — ห้ามกลืนแล้วโชว์ "เกิดข้อผิดพลาด" เฉยๆ
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  if (!isOps && !isFinance) {
    return (
      <div className="p-8">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center max-w-md mx-auto">
          <ShieldAlert size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="font-bold text-gray-700 mb-1">เฉพาะหัวหน้าไรเดอร์และฝ่ายบัญชี</p>
          <p className="text-sm text-gray-500">
            การอนุมัติรายการนี้นำไปสู่การสั่งจ่ายเงินออก จึงจำกัดสิทธิ์ไว้
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
            หัวหน้ายืนยันว่างานวิ่งจริง → ฝ่ายบัญชีตรวจเอกสารแล้วตั้งเบิก → ฝ่ายบัญชีจ่ายเงิน
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
            {(t === 'ops' || t === 'finance' || t === 'needs_info') && countByTab[t] > 0 && (
              <span className="ml-2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {countByTab[t]}
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
            {tab === 'ops' || tab === 'finance' ? 'ยังไม่มีคำขอที่รอคุณ' : 'ยังไม่มีประวัติ'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((r) => {
            const id = String(r.id);
            const status = String(r.status || '');
            const evidence = (Array.isArray(r.evidence) ? r.evidence : []) as { url?: string }[];
            const needsCeo = r.needs_ceo === true;
            const actions = expenseActionsFor(status, { isOps, isFinance });
            // ธงเพดานบังคับที่ขั้นของฝ่ายบัญชีทั้งสองขั้น (server ก็เช็คซ้ำ)
            const ceoBlocked = needsCeo && !isCeo && (status === 'approved' || status === 'finance_approved');
            const history = r.history && typeof r.history === 'object'
              ? Object.values(r.history as Record<string, Record<string, unknown>>)
                  .sort((a, b) => Number(a.at || 0) - Number(b.at || 0))
              : [];
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
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                        STATUS_CHIP[status] || STATUS_CHIP.rejected
                      }`}>
                        {EXPENSE_STATUS_LABEL[status as ExpenseStatus] || status}
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

                {asking?.id === id ? (
                  <div className="mt-4 space-y-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={
                        asking.action === 'send_back'
                          ? 'ต้องแก้อะไร (ไรเดอร์จะเห็นข้อความนี้)'
                          : 'เหตุผลที่ปฏิเสธ (ไรเดอร์จะเห็นข้อความนี้)'
                      }
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={busyId === id || reason.trim() === ''}
                        onClick={() => run(id, asking.action, reason.trim())}
                        className={`px-4 py-2 rounded-xl disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-bold ${
                          asking.action === 'reject' ? 'bg-red-500' : 'bg-orange-500'
                        }`}
                      >
                        ยืนยัน{EXPENSE_ACTION_LABEL[asking.action]}
                      </button>
                      <button
                        onClick={() => { setAsking(null); setReason(''); }}
                        className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-500"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                ) : actions.length > 0 ? (
                  <div className="flex items-center gap-2 mt-4 flex-wrap">
                    {actions.map((a, i) => {
                      const Icon = ACTION_ICON[a];
                      const primary = i === 0;
                      const needsReason = EXPENSE_ACTION_NEEDS_REASON.includes(a);
                      // ปุ่มเดินหน้าต้องมีหลักฐาน — ปฏิเสธ/ตีกลับกดได้เสมอ
                      const blocked =
                        busyId === id ||
                        (primary && ceoBlocked) ||
                        (primary && a !== 'resubmit' && evidence.length === 0);
                      return (
                        <button
                          key={a}
                          disabled={blocked}
                          onClick={() => (needsReason ? setAsking({ id, action: a }) : run(id, a))}
                          className={
                            primary
                              ? 'px-5 py-2.5 rounded-xl bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-bold flex items-center gap-2'
                              : 'px-4 py-2.5 rounded-xl border border-gray-200 disabled:text-gray-300 text-sm font-bold text-gray-600 flex items-center gap-2'
                          }
                        >
                          {primary && busyId === id
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Icon size={14} />}
                          {EXPENSE_ACTION_LABEL[a]}
                        </button>
                      );
                    })}
                    {ceoBlocked && (
                      <span className="text-xs text-violet-700">
                        ยอดนี้เกินเพดาน — รอ CEO อนุมัติ
                      </span>
                    )}
                  </div>
                ) : (
                  ['submitted', 'approved', 'finance_approved', 'needs_info'].includes(status) && (
                    <div className="mt-4 text-xs text-gray-400">
                      รอฝ่ายอื่นดำเนินการ — ขั้นนี้ไม่ใช่ของบัญชีคุณ
                    </div>
                  )
                )}

                {/* ประวัติต่อขั้น: ฟิลด์เดี่ยวตอบ "ใครอนุมัติขั้นไหน" ไม่ได้
                    เมื่อใบหนึ่งเดินวนผ่านการตีกลับหลายรอบ */}
                {history.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-1">
                    {history.map((h, i) => (
                      <div key={i}>
                        {EXPENSE_ACTION_LABEL[String(h.action) as ExpenseAction] || String(h.action)}
                        {' · '}{String(h.by_name || '-')}{' · '}{formatDate(Number(h.at))}
                        {h.reason ? <span className="text-orange-600"> — {String(h.reason)}</span> : null}
                      </div>
                    ))}
                    {/* ตามรอยกลับได้ทั้งสองทาง: จากรายการ → แถวกระเป๋า/แถวบัญชี */}
                    {r.paid_tx_id ? (
                      <div className="text-gray-400">
                        แถวกระเป๋า {String(r.paid_tx_id)} · แถวบัญชี {String(r.expense_doc_id || '-')}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* แถวเก่าที่เกิดก่อนมีประวัติต่อขั้น — ยังต้องอ่านออก */}
                {history.length === 0 && r.reviewed_at ? (
                  <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-1">
                    <div>{String(r.reviewed_by_name || '-')} · {formatDate(Number(r.reviewed_at))}</div>
                    {(r.review_reason || r.reject_reason) ? (
                      <div className="text-red-600">
                        เหตุผล: {String(r.review_reason || r.reject_reason)}
                      </div>
                    ) : null}
                    {r.paid_tx_id ? (
                      <div className="text-gray-400">
                        แถวกระเป๋า {String(r.paid_tx_id)} · แถวบัญชี {String(r.expense_doc_id || '-')}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
