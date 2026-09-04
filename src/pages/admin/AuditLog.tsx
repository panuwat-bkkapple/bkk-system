// หน้า audit log — ใครแก้อะไร จากค่าอะไรเป็นค่าอะไร เมื่อไหร่ (CEO เท่านั้น)
//
// **คนละหน้ากับ "ประวัติพนักงาน"** (`src/pages/hr/EmployeeHistory.tsx`) และนั่น
// คือทั้งเหตุผลที่หน้านี้มีอยู่ — ของเดิมยัดสองอย่างไว้ที่เดียวแล้วทำได้ไม่ดี
// สักอย่าง: ประวัติต้องตอบเรื่องของ *คน* (ทำงานมากี่ปี เงินเดือนขึ้นครั้งละ
// เท่าไร) ส่วนหน้านี้ตอบเรื่องของ *การแก้ข้อมูล* (ใครกด ค่าเดิมคืออะไร)
//
// สิ่งที่หน้านี้ห้ามมี: ปุ่มแก้ ปุ่มลบ — โหนดนี้ append-only และ callable ฝั่ง
// server ก็ไม่มีเส้นทางเขียนให้เรียกอยู่แล้ว (ดู functions/audit-log-api.js)

import React, { useCallback, useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  ShieldCheck, RefreshCw, Search, AlertTriangle, ArrowRight, Lock,
} from 'lucide-react';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  auditDateTime, changeLine, subjectText, actorText, filterAuditRows,
  type AuditListResult, type AuditRow,
} from './auditLogView';

const fns = () => getFunctions(app, 'asia-southeast1');

const ACTION_TONE: Record<string, string> = {
  created: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  updated: 'bg-blue-50 text-blue-700 border-blue-100',
  account_revoked: 'bg-rose-50 text-rose-700 border-rose-100',
};

// ── ส่วนที่เรนเดอร์อย่างเดียว (ไม่ import firebase จึงเทสเรนเดอร์ได้จริง) ────

export const AuditLogView: React.FC<{
  data: AuditListResult | null;
  loading: boolean;
  action: string;
  q: string;
}> = ({ data, loading, action, q }) => {
  if (loading) return <p className="text-sm text-gray-400">กำลังโหลด...</p>;
  if (!data) return <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>;

  const rows = filterAuditRows(data.rows, { action, q }, data.names, data.field_meta);

  return (
    <div className="space-y-3">
      {data.capped && (
        // ชนเพดานต้องบอก ไม่ตัดเงียบ — audit log ที่ตัดท่อนต้นทิ้งโดยไม่บอก
        // ตอบผิดเรื่อง "เปลี่ยนครั้งแรกเมื่อไหร่"
        <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
          <AlertTriangle size={14} className="text-amber-700 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-800">
            แสดงได้สูงสุด {data.max_rows.toLocaleString('th-TH')} รายการล่าสุดเท่านั้น
            รายการที่เก่ากว่านี้ยังอยู่ในระบบแต่ไม่ได้แสดงบนหน้านี้
            — เลือกดูรายบุคคลเพื่อให้เห็นย้อนหลังได้ไกลขึ้น
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-400">ไม่พบรายการที่ตรงกับเงื่อนไข</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r: AuditRow) => (
            <div key={r.id} className="rounded-xl border border-gray-100 bg-white p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                    ACTION_TONE[r.action] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                    {data.action_labels[r.action] || r.action}
                  </span>
                  <span className="text-xs font-bold text-gray-800">
                    {subjectText(r, data.names)}
                  </span>
                </div>
                <span className="text-[11px] text-gray-400 shrink-0">{auditDateTime(r.at)}</span>
              </div>

              <p className="text-[11px] text-gray-500">โดย {actorText(r)}</p>
              {r.reason && <p className="text-[11px] text-gray-600">เหตุผล: {r.reason}</p>}

              {(r.changes || []).length > 0 && (
                <div className="space-y-0.5 pt-0.5">
                  {(r.changes || []).map((c, i) => {
                    const line = changeLine(c, data.field_meta);
                    return (
                      <div key={`${c.field}-${i}`}
                        className="flex items-center gap-1.5 flex-wrap text-[11px]">
                        <span className="text-gray-500 min-w-[110px]">{line.label}</span>
                        {line.withheld ? (
                          // ฟิลด์นอก allowlist — "เปลี่ยน แต่ระบบตั้งใจไม่เก็บว่า
                          // เปลี่ยนเป็นอะไร" ต้องอ่านออกว่าคนละเรื่องกับค่าว่าง
                          <span className="text-gray-400 italic">
                            มีการเปลี่ยนแปลง (ระบบไม่ได้เก็บค่าไว้)
                          </span>
                        ) : (
                          <>
                            <span className="font-mono text-gray-500">{line.from}</span>
                            <ArrowRight size={11} className="text-gray-300" />
                            <span className="font-mono font-bold text-gray-800">{line.to}</span>
                            {line.masked && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                                <Lock size={9} /> เก็บเฉพาะ 4 ตัวท้าย
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── ตัวหน้าจริง ────────────────────────────────────────────────────────────

const AuditLog: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<AuditListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const call = httpsCallable(fns(), 'adminAuditLogList');
      const res = await call({ entity: 'employee' });
      setData(res.data as AuditListResult);
    } catch (e) {
      const msg = (e as { message?: string })?.message || 'โหลดไม่สำเร็จ';
      toast.error(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const actions = Object.keys((data && data.action_labels) || {});

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-black text-gray-800 flex items-center gap-2">
            <ShieldCheck size={18} /> บันทึกการแก้ไขข้อมูล
          </h1>
          <p className="text-[11px] text-gray-500 mt-0.5">
            ใครแก้อะไร จากค่าอะไรเป็นค่าอะไร · บันทึกนี้เพิ่มได้อย่างเดียว แก้และลบไม่ได้
            {data && data.entities_scanned > 0 &&
              ` · ตรวจจากแฟ้มพนักงาน ${data.entities_scanned.toLocaleString('th-TH')} คน`}
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> โหลดใหม่
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อคน ผู้กระทำ เหตุผล หรือชื่อฟิลด์"
            className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-1.5 text-xs" />
        </div>
        <select value={action} onChange={(e) => setAction(e.target.value)}
          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs">
          <option value="">ทุกการกระทำ</option>
          {actions.map((a) => (
            <option key={a} value={a}>{(data && data.action_labels[a]) || a}</option>
          ))}
        </select>
      </div>

      <AuditLogView data={data} loading={loading} action={action} q={q} />
    </div>
  );
};

export default AuditLog;
