// src/pages/fleet/RiderStatementPage.tsx — สมุดบัญชีไรเดอร์ (statement) อ่านอย่างเดียว
//
// หน้านี้ **ไม่มีปุ่มเขียนเงินใดๆ** และไม่ import โมดูลที่เขียน ledger — ด่านคือ
// `src/utils/riderStatementReadOnly.test.ts` (grep ไฟล์นี้ + view + util ว่าไม่มีเมธอดเขียน
// RTDB และไม่ import transactionLogger/riderSettlement/ฯลฯ)
//
// การอ่าน: /transactions ตาม index rider_id (get ครั้งเดียวต่อการเลือกคน — index มีอยู่แล้ว
// ใน database.rules.json ของ bkk-frontend-next ตัวเดียวกับที่ RiderWithdrawals ใช้) ·
// /jobs /withdrawals /riders ผ่าน useDatabase (store แชร์ทั้งแอป เปิดหน้านี้ไม่เพิ่มค่า download) ·
// jobs_archived/{id}/ref_no เฉพาะ ref ที่หาไม่พบ (subpath เล็ก มีเพดาน) — ไม่กวาด node ใหญ่
//
// role = เท่ากับหน้าจ่ายถอน (/finance): CEO / MANAGER / FINANCE — guard อยู่ที่ App.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ref, get, query, orderByChild, equalTo } from 'firebase/database';
import { db } from '../../api/firebase';
import { useDatabase } from '../../hooks/useDatabase';
import { buildStatement, defaultRange, statementCsv, type Loose } from '../../utils/riderStatement';
import { RiderStatementView, type RiderOption } from './RiderStatementView';

/** เพดานการเช็ค jobs_archived ต่อการเปิดหนึ่งครั้ง — เกินนี้บอกบนหน้า ไม่กวาดต่อ */
const ARCHIVE_LOOKUP_CAP = 50;

const ymdOf = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const startOfYmd = (ymd: string): number | null => (ymd ? new Date(`${ymd}T00:00:00`).getTime() : null);
const endOfYmd = (ymd: string): number | null => (ymd ? new Date(`${ymd}T23:59:59.999`).getTime() : null);

export const RiderStatementPage = () => {
  const { riderId: riderIdParam } = useParams<{ riderId: string }>();
  const riderId = riderIdParam || '';
  const navigate = useNavigate();

  const { data: riders } = useDatabase('riders');
  const { data: jobs } = useDatabase('jobs');
  const { data: withdrawals } = useDatabase('withdrawals');

  const initial = useMemo(() => defaultRange(), []);
  const [fromYmd, setFromYmd] = useState(ymdOf(initial.from));
  const [toYmd, setToYmd] = useState(ymdOf(initial.to));

  const [tx, setTx] = useState<{ riderId: string; rows: Loose[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState<{ riderId: string; map: Record<string, string | null>; capped: boolean }>({ riderId: '', map: {}, capped: false });

  // อ่าน ledger ของคนที่เลือก — ครั้งเดียวต่อการเลือก ไม่ subscribe
  useEffect(() => {
    if (!riderId) { setTx(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    get(query(ref(db, 'transactions'), orderByChild('rider_id'), equalTo(riderId)))
      .then((snap) => {
        if (cancelled) return;
        const rows: Loose[] = [];
        snap.forEach((c) => { rows[rows.length] = { id: c.key as string, ...(c.val() || {}) }; return false; });
        setTx({ riderId, rows });
        setArchived({ riderId, map: {}, capped: false });
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('[RiderStatement] ledger read failed:', e);
        setError('อ่าน ledger ของไรเดอร์ไม่ได้ — ลองใหม่อีกครั้ง');
        setTx(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [riderId]);

  const statement = useMemo(() => {
    if (!tx || tx.riderId !== riderId) return null;
    return buildStatement({
      riderId,
      transactions: tx.rows,
      jobs: (Array.isArray(jobs) ? jobs : []) as Loose[],
      withdrawals: (Array.isArray(withdrawals) ? withdrawals : []) as Loose[],
      archived: archived.riderId === riderId ? archived.map : {},
      from: startOfYmd(fromYmd),
      to: endOfYmd(toYmd),
    });
  }, [tx, riderId, jobs, withdrawals, archived, fromYmd, toYmd]);

  // ref ที่หาไม่พบใน /jobs → เช็ค jobs_archived ทีละใบ (subpath เล็ก) ไม่เกินเพดาน
  // buildStatement ส่งเฉพาะ id ที่ยังไม่มีใน archived map จึงไม่วนซ้ำ (เช็คแล้วไม่พบ = บันทึก null)
  const unresolvedKey = statement ? statement.unresolvedJobIds.join('|') : '';
  useEffect(() => {
    if (!statement || !riderId || statement.unresolvedJobIds.length === 0) return;
    let cancelled = false;
    const batch = statement.unresolvedJobIds.slice(0, ARCHIVE_LOOKUP_CAP);
    const capped = statement.unresolvedJobIds.length > ARCHIVE_LOOKUP_CAP;
    Promise.all(
      batch.map((id) =>
        get(ref(db, `jobs_archived/${id}/ref_no`))
          .then((snap) => [id, snap.exists() ? String(snap.val()) : null] as const)
          .catch(() => [id, null] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const found: Record<string, string | null> = {};
      for (const [id, refNo] of pairs) found[id] = refNo;
      setArchived((prev) => ({ riderId, map: prev.riderId === riderId ? { ...prev.map, ...found } : found, capped }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolvedKey, riderId]);

  const riderOptions: RiderOption[] = useMemo(() => {
    const list = ((Array.isArray(riders) ? riders : []) as Loose[]).map((r): RiderOption => ({
      id: String(r.id),
      name: String(r.name || ''),
      approvalStatus: r.approval_status ? String(r.approval_status) : r.status ? String(r.status) : null,
    }));
    list.sort((a, b) => a.name.localeCompare(b.name, 'th'));
    if (riderId && !list.some((r) => r.id === riderId)) {
      return [...list, { id: riderId, name: riderId, approvalStatus: null, orphan: true }];
    }
    return list;
  }, [riders, riderId]);

  const riderName = useMemo(() => {
    const r = ((Array.isArray(riders) ? riders : []) as Loose[]).find((x) => x.id === riderId);
    return r ? String(r.name || '') || null : null;
  }, [riders, riderId]);

  const onExport = () => {
    if (!statement) return;
    const csv = statementCsv(statement);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rider-statement-${riderId}-${fromYmd}-${toYmd}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <RiderStatementView
      riders={riderOptions}
      riderId={riderId}
      riderName={riderName}
      fromYmd={fromYmd}
      toYmd={toYmd}
      statement={statement}
      loading={loading || (!!riderId && !tx)}
      error={error}
      archiveLookupCapped={archived.riderId === riderId && archived.capped}
      onRiderChange={(id) => navigate(id ? `/riders/${encodeURIComponent(id)}/statement` : '/riders/statement')}
      onFromChange={setFromYmd}
      onToChange={setToYmd}
      onExport={onExport}
      jobHref={(jobId) => `/workspace/${jobId}`}
    />
  );
};
