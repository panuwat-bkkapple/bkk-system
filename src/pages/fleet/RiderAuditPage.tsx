// src/pages/fleet/RiderAuditPage.tsx — ใบตรวจงานไรเดอร์ (อ่านอย่างเดียว)
//
// หนึ่งแถว = หนึ่งใบงาน คอลัมน์ที่เหลือคือข้อเท็จจริงฝั่งไรเดอร์ทั้งหมด
// จอนี้มีไว้ให้ไล่สอบก่อนงานไปถึงคิวจ่ายเงิน ซึ่งเป็นขั้นที่ระบบไม่เคยมี:
// เดิมงานจบแล้วเข้าคิว RiderSettlements ทันที และคนกดอนุมัติเห็นแค่ 4 ช่อง
// (Job Ref / Rider / Device / Fee) จึงไม่มีทางรู้ว่าค่ารอบนั้นคิดจากอะไร
//
// **การอนุมัติค่ารอบเกิดที่จอนี้** ไม่ใช่ที่หน้าการเงินอีกต่อไป เพราะการอนุมัติ
// คือการรับรองว่า "งานนี้ทำจริง ระยะเท่านี้ ค่ารอบเท่านี้" ซึ่งเป็นข้อเท็จจริง
// หน้างาน ไม่ใช่งานบัญชี — และระบบบัญชีขีดเส้นนี้ไว้อยู่แล้ว: อนุมัติค่ารอบ =
// ตั้งหนี้ (เงินยังไม่ออกจากบัญชีบริษัท) ส่วนการถอนคือการจ่ายเงินจริงที่มีสลิป
// และเป็นจุดที่หักภาษี ณ ที่จ่าย ซึ่งยังเป็นของฝั่งการเงินตามเดิม
//
// เลือกทีละแถวเท่านั้น ไม่มีปุ่มอนุมัติทั้งหมดรวด — ปุ่มนั้นทำให้จอตรวจสอบ
// ไม่มีความหมาย เพราะไม่มีใครต้องดูอะไรก่อนกด
//
// **จอนี้ไม่เขียน RTDB เองอีกแล้ว (5 ก.ย. 2569)** — อนุมัติ/ยกเว้นผ่าน callable
// `adminRiderFeeApprove` / `adminRiderFeeWaive` (src/utils/riderFeeAdmin.ts) เพราะ
// ด่าน "บัญชีเจ้าของ / ไม่มีไรเดอร์ ห้ามได้ค่ารอบ" ต้องอยู่ฝั่ง server ที่ข้ามไม่ได้
// ป้ายและ checkbox ที่นี่เป็น UX ให้เห็นก่อนกด server ตัดสินซ้ำเองทุกใบ
//
// ใบ Waived ซ่อนเป็นค่าเริ่มต้น (มีสวิตช์ดู) · ใบที่ไม่มีไรเดอร์แยกออกจากคิว
// อนุมัติเป็นส่วนของตัวเอง ไม่มีปุ่มจ่าย มีแต่ยกเว้น
//
// ใช้ useDatabase('jobs') ซึ่งแอปนี้ subscribe อยู่แล้วทั้งแอป การเปิดหน้านี้
// จึงไม่เพิ่มค่า download ของ RTDB เลย (กฎค่า RTDB ใน CLAUDE.md)
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../hooks/useAuth';
import { Download, AlertTriangle, MapPin, Route, Timer, Search } from 'lucide-react';
import { useDatabase } from '../../hooks/useDatabase';
import { formatCurrency } from '../../utils/formatters';
import { buildRiderAuditRow, involvesRider, auditFlags } from '../../utils/riderAudit';
import {
  settledRiderFee, riderFeeBlockReason, RIDER_FEE_BLOCK_LABEL, type RiderFeeBlockReason,
} from '../../utils/riderSettlement';
import { RIDER_FEE_STATUS } from '../../types/riderFeeStatus';
import {
  approveRiderFees, waiveRiderFees, fetchRiderFeeConfig, riderFeeErrorMessage,
} from '../../utils/riderFeeAdmin';
import type { RiderAuditRow } from '../../utils/riderAudit';

/** ค่าที่ระบบไม่รู้ ต้องอ่านออกว่า "ไม่รู้" ไม่ใช่ขีดกลางที่แปลว่าศูนย์ */
const Unknown = ({ why }: { why?: string | null }) => (
  <span className="text-amber-600 text-[11px] font-semibold" title={why || undefined}>
    ไม่มีข้อมูล{why ? ` (${why})` : ''}
  </span>
);

const num = (v: number | null, suffix = '', digits = 0) =>
  v === null ? <Unknown /> : <span>{v.toFixed(digits)}{suffix}</span>;

const time = (ts: number | null) =>
  ts === null ? <Unknown /> : new Date(ts).toLocaleString('th-TH', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

const pointText = (p: { lat: number; lng: number } | null) =>
  p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : null;

/** ข้อความอธิบายกฎที่ตัดสินยอด — `formula` ไม่ต้องบอก เพราะเลขอธิบายตัวเองอยู่แล้ว */
const FEE_RULE_LABEL: Record<string, string | null> = {
  formula: null,
  min_floor: 'ชนขั้นต่ำ',
  max_cap: 'ชนเพดาน',
  no_distance: 'ไม่มีระยะ จ่ายขั้นต่ำ',
  unknown: 'ไม่มีการ์ดอัตราเก็บไว้',
};

const CSV_HEADERS = [
  'job_id', 'ref_no', 'receive_method', 'status', 'rider_id', 'rider_name',
  'departure_lat', 'departure_lng', 'departure_gps_status', 'departure_at',
  'customer_lat', 'customer_lng', 'geocode_status',
  'rider_distance_km', 'rider_duration_min', 'travel_mode', 'eta_travel_mode',
  'branch_source', 'measured_from_lat', 'measured_from_lng', 'measured_to_lat', 'measured_to_lng', 'fee_reason',
  'customer_distance_km', 'distance_basis',
  'rate_base', 'rate_per_km', 'rate_min_fee', 'rate_max_fee', 'rate_vehicle',
  'fee_before_clamp', 'fee_rule', 'settled_fee', 'estimate_fee', 'fee_breakdown_type',
  'pickup_fee', 'rider_fee_discount', 'effective_pickup_fee',
  'created_at', 'completed_at', 'elapsed_min',
  'cancel_category', 'cancel_reason', 'cancelled_by',
  'rider_fee_status', 'flags',
];

const csvCell = (v: unknown): string => {
  // ช่องว่างใน CSV = "ระบบไม่มีค่านี้" ซึ่งต่างจาก 0 — ห้ามเติมศูนย์ให้สวย
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const RiderAuditPage = () => {
  const { data: jobs, loading } = useDatabase('jobs');
  const { data: riders } = useDatabase('riders');
  const toast = useToast();
  const { hasAccess } = useAuth();
  // อนุมัติ = รับรองข้อเท็จจริงหน้างาน (CEO/MANAGER) · ยกเว้น = สิทธิ์เท่าหน้า finance
  // — server เช็ค role ซ้ำเองใน callable ค่าตรงนี้แค่ตัดสินว่าจะวาดปุ่มไหม
  const canApprove = hasAccess(['CEO', 'MANAGER']);
  const canWaive = hasAccess(['CEO', 'MANAGER', 'FINANCE']);
  const [q, setQ] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [showWaived, setShowWaived] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // รายชื่อบัญชีเจ้าของมาจาก env ของ functions (OWNER_RIDER_IDS) ผ่าน callable —
  // ไม่ hardcode ที่นี่. โหลดไม่ได้ = เซ็ตว่าง + ป้ายเตือน ไม่ใช่เงียบ
  const [ownerIds, setOwnerIds] = useState<ReadonlySet<string>>(new Set());
  const [ownerConfig, setOwnerConfig] = useState<'loading' | 'ok' | 'unset' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    fetchRiderFeeConfig()
      .then((c) => {
        if (!alive) return;
        setOwnerIds(new Set(c.ownerRiderIds));
        setOwnerConfig(c.configured ? 'ok' : 'unset');
      })
      .catch(() => { if (alive) setOwnerConfig('error'); });
    return () => { alive = false; };
  }, []);

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const riderName = useMemo(() => {
    const m: Record<string, string> = {};
    (Array.isArray(riders) ? riders : []).forEach((r: any) => {
      if (r?.id) m[r.id] = r.name || r.id;
    });
    return m;
  }, [riders]);

  const jobById = useMemo(() => {
    const m: Record<string, any> = {};
    (Array.isArray(jobs) ? jobs : []).forEach((j: any) => { if (j?.id) m[j.id] = j; });
    return m;
  }, [jobs]);

  type AuditEntry = { row: RiderAuditRow; flags: ReturnType<typeof auditFlags>; block: RiderFeeBlockReason | null };

  const rows = useMemo<AuditEntry[]>(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list
      .filter(involvesRider)
      .map((j: any) => {
        const row = buildRiderAuditRow(j);
        return row ? { row, flags: auditFlags(row), block: riderFeeBlockReason(j, ownerIds) } : null;
      })
      .filter((x): x is AuditEntry => x !== null)
      .sort((a, b) => (b.row.completedAt ?? b.row.createdAt ?? 0) - (a.row.completedAt ?? a.row.createdAt ?? 0));
  }, [jobs, ownerIds]);

  const waivedCount = rows.filter((r) => r.row.feeStatus === RIDER_FEE_STATUS.WAIVED).length;

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(({ row, flags }) => {
      if (!showWaived && row.feeStatus === RIDER_FEE_STATUS.WAIVED) return false;
      if (onlyFlagged && flags.length === 0) return false;
      if (!needle) return true;
      const who = row.riderId ?? row.riderIdFromCancel ?? '';
      return (
        (row.refNo || '').toLowerCase().includes(needle) ||
        who.toLowerCase().includes(needle) ||
        (riderName[who] || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, q, onlyFlagged, showWaived, riderName]);

  // คิวอนุมัติ = ใบที่มีไรเดอร์ (รวมใบบัญชีเจ้าของซึ่งขึ้นป้ายและติ๊กจ่ายไม่ได้)
  // ส่วนใบที่ไม่มีไรเดอร์แยกออกไปเป็นส่วนของตัวเอง — ห้ามมีปุ่มจ่าย
  const queue = visible.filter((e) => e.block !== 'no_rider');
  const noRider = visible.filter((e) => e.block === 'no_rider');

  const flaggedCount = rows.filter((r) => r.flags.length > 0).length;

  const isPending = (row: RiderAuditRow) => row.feeStatus === RIDER_FEE_STATUS.PENDING;
  /** จ่ายได้ = รออยู่ + มีค่ารอบที่ระบบประทับ + ผ่านด่าน OWNER/ไม่มีไรเดอร์ */
  const isPayable = (e: AuditEntry) =>
    isPending(e.row) && e.block === null && settledRiderFee(jobById[e.row.id]) !== null;

  const pickedEntries = useMemo(
    () => visible.filter(({ row }) => picked.has(row.id) && isPending(row)),
    [visible, picked],
  );
  const pickedPayable = useMemo(
    () => pickedEntries.filter(isPayable),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickedEntries, jobById],
  );

  const approvePicked = async () => {
    if (pickedPayable.length === 0) return;
    const total = pickedPayable.reduce((s, { row }) => s + (row.settledFee ?? 0), 0);
    if (!confirm(`อนุมัติค่ารอบ ${pickedPayable.length} ใบงาน รวม ${formatCurrency(total)} เข้ากระเป๋าไรเดอร์?`)) return;
    setBusy(true);
    try {
      // server เขียน jobs + transactions ใน multi-path เดียว และปฏิเสธทั้งชุดถ้ามีใบ
      // ที่ชนด่าน — จอนี้ส่งแค่ id ไม่ส่งยอด ไม่ส่งไรเดอร์
      const res = await approveRiderFees(pickedPayable.map(({ row }) => row.id));
      setPicked(new Set());
      toast.success(
        `อนุมัติแล้ว ${res.approved.length} ใบงาน${res.skipped.length ? ` (ข้าม ${res.skipped.length} ใบที่จ่ายไม่ได้)` : ''}`,
      );
    } catch (e) {
      toast.error(riderFeeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const waive = async (ids: string[]) => {
    if (ids.length === 0) return;
    const reason = window.prompt(`ยกเว้นค่ารอบ ${ids.length} ใบงาน — ระบุเหตุผล (บังคับ):`, '');
    if (reason === null) return;
    if (!reason.trim()) { toast.error('ต้องระบุเหตุผลที่ยกเว้นค่ารอบ'); return; }
    setBusy(true);
    try {
      const res = await waiveRiderFees(ids, reason.trim());
      setPicked((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
      toast.success(
        `ยกเว้นค่ารอบแล้ว ${res.waived.length} ใบ${res.skipped.length ? ` (ข้าม ${res.skipped.length} ใบที่ไม่ได้รออยู่)` : ''}`,
      );
    } catch (e) {
      toast.error(riderFeeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const lines = [CSV_HEADERS.join(',')];
    for (const { row, flags } of visible) {
      const who = row.riderId ?? row.riderIdFromCancel;
      lines.push([
        row.id, row.refNo, row.receiveMethod, row.status, who, who ? riderName[who] : null,
        row.departure?.point?.lat ?? null, row.departure?.point?.lng ?? null,
        row.departure?.gpsStatus ?? null, row.departure?.at ?? null,
        row.customerPin?.lat ?? null, row.customerPin?.lng ?? null, row.geocodeStatus,
        row.riderDistanceKm, row.riderDurationMin, row.travelMode, row.etaTravelMode,
        row.branchSource,
        row.measuredFrom?.lat ?? null, row.measuredFrom?.lng ?? null,
        row.measuredTo?.lat ?? null, row.measuredTo?.lng ?? null,
        row.feeReason,
        row.customerDistanceKm, row.distanceBasis,
        row.rateBase, row.ratePerKm, row.rateMinFee, row.rateMaxFee, row.rateVehicle,
        row.feeBeforeClamp, row.feeRule,
        row.settledFee, row.estimateFee, row.feeBreakdownType,
        row.pickupFee, row.riderFeeDiscount, row.effectivePickupFee,
        row.createdAt, row.completedAt, row.elapsedMin,
        row.cancelCategory, row.cancelReason, row.cancelledBy,
        row.feeStatus, flags.map((f) => f.code).join(' '),
      ].map(csvCell).join(','));
    }
    // BOM เพื่อให้ Excel อ่านภาษาไทยไม่เป็นขยะ (แบบเดียวกับ /wht-report)
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rider-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const COLUMNS = ['ใบงาน', 'ไรเดอร์', 'จุดออกเดินทาง', 'หมุดลูกค้า', 'ระยะ (ค่ารอบ)', 'เวลา',
    'ระยะ (ค่าบริการ)', 'ฐาน', 'ต่อ กม.', 'ค่ารอบรวม', 'ลูกค้าจ่าย', 'สถานะจ่าย', 'ต้องดู'];

  /** เซลล์ข้อเท็จจริงของหนึ่งใบ — ใช้ร่วมกันทั้งคิวอนุมัติและส่วน "ไม่มีไรเดอร์" */
  const renderCells = ({ row, flags, block }: AuditEntry) => {
    const who = row.riderId ?? row.riderIdFromCancel;
    return (
      <>
        <td className="p-3">
          <div className="font-bold text-slate-800">{row.refNo ?? row.id}</div>
          <div className="text-[10px] text-slate-400">
            {row.receiveMethod ?? '-'} · {row.status ?? row.rawStatus ?? '-'}
          </div>
        </td>
        <td className="p-3">
          {who ? (
            <>
              <div>{riderName[who] ?? who}</div>
              {!row.riderId && <div className="text-[10px] text-amber-600">หลุดจากงานแล้ว</div>}
            </>
          ) : <Unknown />}
          {/* ป้ายด่าน — บอกก่อนกดว่าใบนี้จ่ายไม่ได้เพราะอะไร (server ตัดสินซ้ำเอง) */}
          {block && (
            <div className="text-[10px] font-bold text-rose-600">{RIDER_FEE_BLOCK_LABEL[block]} · ห้ามจ่ายค่ารอบ</div>
          )}
        </td>
        <td className="p-3">
          {row.departure
            ? row.departure.point
              ? <span className="flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{pointText(row.departure.point)}</span>
              : <Unknown why={row.departure.gpsStatus} />
            : <Unknown why="ไม่มีบันทึก" />}
          <div className="text-[10px] text-slate-400">{row.departure?.at ? time(row.departure.at) : null}</div>
        </td>
        <td className="p-3">
          {row.customerPin ? pointText(row.customerPin) : <Unknown why={row.geocodeStatus} />}
        </td>
        <td className="p-3">
          <span className="flex items-center gap-1"><Route size={11} className="text-slate-400" />{num(row.riderDistanceKm, ' กม.', 1)}</span>
          <div className="text-[10px] text-slate-400">
            {row.travelMode ?? '-'} · ฐานสาขา {row.branchSource ?? '-'}
            {row.feeReason && row.feeReason !== 'calculated' ? ` · ${row.feeReason}` : ''}
          </div>
          {/* หมุดที่ใช้วัดจริง — งานเก่าที่คำนวณก่อนมีฟิลด์นี้จะไม่มี
              และต้องอ่านออกว่าไม่มี ไม่ใช่เงียบไป */}
          <div className="text-[10px] text-slate-400">
            {row.measuredFrom && row.measuredTo
              ? `วัดจาก ${pointText(row.measuredFrom)} ถึง ${pointText(row.measuredTo)}`
              : 'ไม่ได้บันทึกหมุดที่ใช้วัด'}
          </div>
        </td>
        <td className="p-3">
          <span className="flex items-center gap-1"><Timer size={11} className="text-slate-400" />{num(row.elapsedMin, ' นาที')}</span>
          <div className="text-[10px] text-slate-400">ทำนายไว้ {row.riderDurationMin ?? '-'} นาที</div>
        </td>
        <td className="p-3">
          {num(row.customerDistanceKm, ' กม.', 1)}
          <div className="text-[10px] text-slate-400">ที่มา {row.distanceBasis ?? '-'}</div>
        </td>
        {/* ฐาน / ต่อ กม. / รวม — แยกช่องเพราะอัตราแตกต่างกันได้ตาม
            ยานพาหนะวันนี้ และอาจต่างรายคนในอนาคต การ์ดอัตราถูก
            snapshot ไว้ต่อใบงาน ยอดเก่าจึงยังอธิบายได้แม้อัตราเปลี่ยน */}
        <td className="p-3">
          {row.rateBase === null ? <Unknown /> : formatCurrency(row.rateBase)}
          {row.rateVehicle && (
            <div className="text-[10px] text-slate-400">{row.rateVehicle}</div>
          )}
        </td>
        <td className="p-3">
          {row.ratePerKm === null ? <Unknown /> : (
            <>
              <div>{formatCurrency(row.ratePerKm)}</div>
              {row.feeBeforeClamp !== null && (
                <div className="text-[10px] text-slate-400">
                  รวมสูตร {row.feeBeforeClamp.toFixed(0)}
                </div>
              )}
            </>
          )}
        </td>
        <td className="p-3">
          {row.settledFee === null
            ? <span className="text-slate-400">ประมาณ {row.estimateFee ?? '-'}</span>
            : <span className="font-bold text-slate-800">{formatCurrency(row.settledFee)}</span>}
          {/* บอกว่ากฎไหนตัดสินยอด ไม่งั้นแถวที่ชนขั้นต่ำ/เพดานจะดู
              เหมือนบวกเลขผิด */}
          {FEE_RULE_LABEL[row.feeRule] && (
            <div className="text-[10px] text-slate-400">{FEE_RULE_LABEL[row.feeRule]}</div>
          )}
          {row.feeBreakdownType && (
            <div className="text-[10px] text-amber-600">{row.feeBreakdownType}</div>
          )}
        </td>
        <td className="p-3">
          {row.effectivePickupFee === null ? <Unknown /> : formatCurrency(row.effectivePickupFee)}
          {row.riderFeeDiscount ? (
            <div className="text-[10px] text-slate-400">ส่วนลด {row.riderFeeDiscount}</div>
          ) : null}
        </td>
        <td className="p-3">
          {row.feeStatus ?? <Unknown />}
          {row.feeStatus === RIDER_FEE_STATUS.WAIVED && jobById[row.id]?.rider_fee_waived_reason && (
            <div className="text-[10px] text-slate-400" title={String(jobById[row.id].rider_fee_waived_reason)}>
              {String(jobById[row.id].rider_fee_waived_reason)}
            </div>
          )}
          {canWaive && isPending(row) && (
            <button
              onClick={() => waive([row.id])}
              disabled={busy}
              className="mt-1 block text-[10px] font-bold text-rose-600 hover:underline disabled:opacity-40"
            >
              ยกเว้นค่ารอบ
            </button>
          )}
        </td>
        <td className="p-3">
          {flags.length === 0 ? (
            <span className="text-slate-300">-</span>
          ) : (
            <div className="space-y-0.5">
              {flags.map((f) => (
                <div key={f.code} className="flex items-center gap-1 text-[10px] text-amber-700">
                  <AlertTriangle size={10} /> {f.label}
                </div>
              ))}
            </div>
          )}
        </td>
      </>
    );
  };

  const pickCell = (e: AuditEntry, forApprove: boolean) => (
    <td className="p-3">
      {/* ติ๊กได้เฉพาะใบที่รออยู่ — ใบที่ชนด่านหรือไม่มีค่ารอบยังติ๊กเพื่อ "ยกเว้น" ได้
          แต่จะไม่ถูกนับเข้าปุ่มอนุมัติ (isPayable) ไม่ใช่เลือกได้แล้วเงียบตอนกด */}
      <input
        type="checkbox"
        disabled={!isPending(e.row) || (forApprove && !canWaive && !isPayable(e))}
        checked={picked.has(e.row.id)}
        onChange={() => togglePick(e.row.id)}
        className={`w-4 h-4 disabled:opacity-30 ${isPayable(e) ? 'accent-emerald-600' : 'accent-rose-500'}`}
      />
    </td>
  );

  const showPickColumn = canApprove || canWaive;

  if (loading) return <div className="p-8 text-slate-400">กำลังโหลด...</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800">ใบตรวจงานไรเดอร์</h1>
          <p className="text-xs text-slate-500 mt-1">
            {rows.length} ใบงาน · <span className="text-amber-600 font-bold">{flaggedCount} ใบมีจุดที่ระบบตอบไม่ได้</span>
            {noRider.length > 0 && <> · <span className="text-rose-600 font-bold">{noRider.length} ใบไม่มีไรเดอร์</span></>}
            {waivedCount > 0 && <> · {waivedCount} ใบยกเว้นแล้ว{showWaived ? '' : ' (ซ่อนอยู่)'}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาเลขที่งาน หรือไรเดอร์"
              className="pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 w-64"
            />
          </div>
          <button
            onClick={() => setOnlyFlagged((v) => !v)}
            className={`px-3 py-2 text-xs font-bold rounded-xl border ${
              onlyFlagged ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            เฉพาะที่ต้องดู
          </button>
          <button
            onClick={() => setShowWaived((v) => !v)}
            className={`px-3 py-2 text-xs font-bold rounded-xl border ${
              showWaived ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {showWaived ? 'ซ่อนใบที่ยกเว้น' : 'ดูใบที่ยกเว้น'}
          </button>
          <button
            onClick={exportCsv}
            className="px-3 py-2 text-xs font-bold rounded-xl bg-slate-800 text-white flex items-center gap-1.5"
          >
            <Download size={14} /> CSV
          </button>
          {canWaive && (
            <button
              onClick={() => waive(pickedEntries.map(({ row }) => row.id))}
              disabled={busy || pickedEntries.length === 0}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 text-white disabled:bg-slate-200 disabled:text-slate-400"
            >
              ยกเว้นค่ารอบ {pickedEntries.length} ใบ
            </button>
          )}
          {canApprove && (
            <button
              onClick={approvePicked}
              disabled={busy || pickedPayable.length === 0}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white disabled:bg-slate-200 disabled:text-slate-400"
            >
              {busy ? 'กำลังทำงาน...' : `อนุมัติค่ารอบ ${pickedPayable.length} ใบ`}
            </button>
          )}
        </div>
      </div>

      {/* ด่าน OWNER อ่านจาก env ของ functions — ถ้ายังไม่ตั้ง server ปฏิเสธการอนุมัติ
          ทุกใบ (fail closed) จอต้องบอกก่อนกด ไม่ใช่ให้เจอ error ตอนกด */}
      {ownerConfig === 'unset' && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-[11px] text-rose-800">
          <strong>OWNER_RIDER_IDS ยังไม่ตั้งบน Cloud Functions</strong> — ระบบจะปฏิเสธการอนุมัติค่ารอบทุกใบจนกว่าจะตั้ง
          (GitHub Secret แล้ว Run workflow deploy functions)
        </div>
      )}
      {ownerConfig === 'error' && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-[11px] text-amber-800">
          โหลดรายชื่อบัญชีเจ้าของไม่สำเร็จ — ป้าย "บัญชีเจ้าของ" บนหน้านี้อาจไม่ครบ แต่ server ยังกันให้ตอนกดอนุมัติ
        </div>
      )}

      {/* หมายเหตุที่ห้ามลบ: สองคอลัมน์ระยะทางวัดคนละคู่พิกัด คนละ endpoint
          ถ้าไม่บอกไว้ คนอ่านจะเห็นเลขไม่ตรงแล้วนึกว่าระบบผิด */}
      <div className="bg-sky-50 border border-sky-100 rounded-2xl p-3 text-[11px] text-sky-900 leading-relaxed">
        <strong>อ่านตารางนี้อย่างไร</strong> — <em>ระยะ (ค่ารอบ)</em> คือลูกค้าถึงสาขา ขาเดียว ที่ใช้คิดเงินให้ไรเดอร์
        ส่วน <em>ระยะ (ค่าบริการ)</em> คือสาขาถึงลูกค้า ที่ใช้คิดเงินจากลูกค้า และอาจมาจากเส้นตรงคูณ 1.3 แทนถนนจริง
        (ดูช่อง <em>ที่มา</em>) <strong>สองเลขนี้ต่างกันได้โดยไม่มีใครผิด</strong> ·
        <em>จุดออกเดินทาง</em> คือพิกัด GPS ของไรเดอร์ตอนกดเดินทาง <strong>ไม่ใช่ต้นทางที่ระบบใช้คิดเงิน</strong>
        (ระบบคิดจากพิกัดสาขา — ดูช่อง <em>ฐานสาขา</em>)
      </div>

      <div className="bg-white rounded-[1.5rem] shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-black">
              <tr>
                {showPickColumn && <th className="p-3 w-8" />}
                {COLUMNS.map((h) => (
                  <th key={h} className="p-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {queue.map((e) => (
                <tr key={e.row.id} className={e.block ? 'bg-rose-50/40' : e.flags.length ? 'bg-amber-50/40' : ''}>
                  {showPickColumn && pickCell(e, true)}
                  {renderCells(e)}
                </tr>
              ))}
            </tbody>
          </table>
          {queue.length === 0 && (
            <div className="p-10 text-center text-slate-400 text-sm">ไม่มีใบงานที่ตรงเงื่อนไข</div>
          )}
        </div>
      </div>

      {/* ใบที่ไม่มีไรเดอร์ — ส่วนใหญ่คือ Store-in/Mail-in ที่ trigger คิดค่ารอบขั้นต่ำให้ก่อน
          มีด่าน (survey 5 ก.ย. 2569 ข้อ A4) ไม่มีใครให้จ่าย จึงไม่มีปุ่มจ่าย มีแต่ยกเว้น */}
      {noRider.length > 0 && (
        <div className="bg-white rounded-[1.5rem] shadow-sm border border-rose-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-rose-100 bg-rose-50/60">
            <h2 className="text-sm font-black text-rose-700">ไม่มีไรเดอร์ · {noRider.length} ใบ</h2>
            <p className="text-[11px] text-rose-700/80">งานที่ระบบคิดค่ารอบไว้แต่ไม่มีไรเดอร์ให้จ่าย — จ่ายไม่ได้ ทำได้แค่ยกเว้น</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-black">
                <tr>
                  {canWaive && <th className="p-3 w-8" />}
                  {COLUMNS.map((h) => (
                    <th key={h} className="p-3 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {noRider.map((e) => (
                  <tr key={e.row.id} className="bg-rose-50/20">
                    {canWaive && pickCell(e, false)}
                    {renderCells(e)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
