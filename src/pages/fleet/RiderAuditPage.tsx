// src/pages/fleet/RiderAuditPage.tsx — ใบตรวจงานไรเดอร์ (อ่านอย่างเดียว)
//
// หนึ่งแถว = หนึ่งใบงาน คอลัมน์ที่เหลือคือข้อเท็จจริงฝั่งไรเดอร์ทั้งหมด
// จอนี้มีไว้ให้ไล่สอบก่อนงานไปถึงคิวจ่ายเงิน ซึ่งเป็นขั้นที่ระบบไม่เคยมี:
// เดิมงานจบแล้วเข้าคิว RiderSettlements ทันที และคนกดอนุมัติเห็นแค่ 4 ช่อง
// (Job Ref / Rider / Device / Fee) จึงไม่มีทางรู้ว่าค่ารอบนั้นคิดจากอะไร
//
// รอบนี้ **อ่านอย่างเดียว** — การย้ายปุ่มอนุมัติมาที่นี่เป็นงานแยกอีกใบ
// เพราะมันแตะเงินของคนอื่นและต้องตัดสินเรื่องงานที่ค้างอยู่ในคิวเดิมก่อน
//
// ใช้ useDatabase('jobs') ซึ่งแอปนี้ subscribe อยู่แล้วทั้งแอป การเปิดหน้านี้
// จึงไม่เพิ่มค่า download ของ RTDB เลย (กฎค่า RTDB ใน CLAUDE.md)
import { useMemo, useState } from 'react';
import { Download, AlertTriangle, MapPin, Route, Timer, Search } from 'lucide-react';
import { useDatabase } from '../../hooks/useDatabase';
import { formatCurrency } from '../../utils/formatters';
import { buildRiderAuditRow, involvesRider, auditFlags } from '../../utils/riderAudit';
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

const CSV_HEADERS = [
  'job_id', 'ref_no', 'receive_method', 'status', 'rider_id', 'rider_name',
  'departure_lat', 'departure_lng', 'departure_gps_status', 'departure_at',
  'customer_lat', 'customer_lng', 'geocode_status',
  'rider_distance_km', 'rider_duration_min', 'travel_mode', 'eta_travel_mode',
  'branch_source', 'fee_reason',
  'customer_distance_km', 'distance_basis',
  'settled_fee', 'estimate_fee', 'fee_breakdown_type',
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
  const [q, setQ] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const riderName = useMemo(() => {
    const m: Record<string, string> = {};
    (Array.isArray(riders) ? riders : []).forEach((r: any) => {
      if (r?.id) m[r.id] = r.name || r.id;
    });
    return m;
  }, [riders]);

  const rows = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list
      .filter(involvesRider)
      .map((j: any) => {
        const row = buildRiderAuditRow(j);
        return row ? { row, flags: auditFlags(row) } : null;
      })
      .filter((x): x is { row: RiderAuditRow; flags: ReturnType<typeof auditFlags> } => x !== null)
      .sort((a, b) => (b.row.completedAt ?? b.row.createdAt ?? 0) - (a.row.completedAt ?? a.row.createdAt ?? 0));
  }, [jobs]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(({ row, flags }) => {
      if (onlyFlagged && flags.length === 0) return false;
      if (!needle) return true;
      const who = row.riderId ?? row.riderIdFromCancel ?? '';
      return (
        (row.refNo || '').toLowerCase().includes(needle) ||
        who.toLowerCase().includes(needle) ||
        (riderName[who] || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, q, onlyFlagged, riderName]);

  const flaggedCount = rows.filter((r) => r.flags.length > 0).length;

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
        row.branchSource, row.feeReason,
        row.customerDistanceKm, row.distanceBasis,
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

  if (loading) return <div className="p-8 text-slate-400">กำลังโหลด...</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800">ใบตรวจงานไรเดอร์</h1>
          <p className="text-xs text-slate-500 mt-1">
            {rows.length} ใบงาน · <span className="text-amber-600 font-bold">{flaggedCount} ใบมีจุดที่ระบบตอบไม่ได้</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            onClick={exportCsv}
            className="px-3 py-2 text-xs font-bold rounded-xl bg-slate-800 text-white flex items-center gap-1.5"
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

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
                {['ใบงาน', 'ไรเดอร์', 'จุดออกเดินทาง', 'หมุดลูกค้า', 'ระยะ (ค่ารอบ)', 'เวลา',
                  'ระยะ (ค่าบริการ)', 'ค่ารอบ', 'ลูกค้าจ่าย', 'สถานะจ่าย', 'ต้องดู'].map((h) => (
                  <th key={h} className="p-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {visible.map(({ row, flags }) => {
                const who = row.riderId ?? row.riderIdFromCancel;
                return (
                  <tr key={row.id} className={flags.length ? 'bg-amber-50/40' : ''}>
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
                    </td>
                    <td className="p-3">
                      <span className="flex items-center gap-1"><Timer size={11} className="text-slate-400" />{num(row.elapsedMin, ' นาที')}</span>
                      <div className="text-[10px] text-slate-400">ทำนายไว้ {row.riderDurationMin ?? '-'} นาที</div>
                    </td>
                    <td className="p-3">
                      {num(row.customerDistanceKm, ' กม.', 1)}
                      <div className="text-[10px] text-slate-400">ที่มา {row.distanceBasis ?? '-'}</div>
                    </td>
                    <td className="p-3">
                      {row.settledFee === null
                        ? <span className="text-slate-400">ประมาณ {row.estimateFee ?? '-'}</span>
                        : <span className="font-bold text-slate-800">{formatCurrency(row.settledFee)}</span>}
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
                    <td className="p-3">{row.feeStatus ?? <Unknown />}</td>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="p-10 text-center text-slate-400 text-sm">ไม่มีใบงานที่ตรงเงื่อนไข</div>
          )}
        </div>
      </div>
    </div>
  );
};
