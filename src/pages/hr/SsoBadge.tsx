// src/pages/hr/SsoBadge.tsx
//
// ป้ายสถานะขึ้นทะเบียนประกันสังคมบนแถวพนักงาน — **ไม่ import firebase**
//
// **หน้านี้ไม่คิดกฎเอง** สถานะกับข้อความมาจาก server (`functions/hr-compliance.js`)
// ซึ่งเป็นกฎตัวเดียวกับที่รอบจ่ายเงินเดือนและ probe ใน /system-health ใช้ —
// ถ้าคิดซ้ำฝั่งนี้จะได้สำเนาที่สามที่ drift โดยไม่มีใครรู้ว่าฝั่งไหนถูก
//
// **`unknown` ต้องเห็นได้ ไม่ใช่เงียบ** — คนที่ไม่มีวันเริ่มงานในระบบอาจเข้า
// ทำงานมาแล้วครึ่งปี การไม่ขึ้นป้ายให้เขาคือการเดาไปทางที่สบายกว่า

import React from 'react';
import { ShieldAlert, ShieldQuestion, Clock3 } from 'lucide-react';

export interface SsoState {
  state: 'ok' | 'not_required' | 'unknown' | 'pending' | 'due_soon' | 'overdue';
  days_left?: number | null;
  message?: string | null;
}

const STYLES: Record<string, { cls: string; icon: React.ReactNode; text: (s: SsoState) => string }> = {
  overdue: {
    cls: 'bg-rose-100 text-rose-700 border-rose-200',
    icon: <ShieldAlert size={12} />,
    text: (s) => `ปกส. เลยกำหนด ${Math.abs(Number(s.days_left) || 0)} วัน`,
  },
  due_soon: {
    cls: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: <Clock3 size={12} />,
    text: (s) => `ปกส. เหลือ ${Number(s.days_left) || 0} วัน`,
  },
  unknown: {
    cls: 'bg-gray-100 text-gray-600 border-gray-200',
    icon: <ShieldQuestion size={12} />,
    text: () => 'ปกส. ยังไม่ขึ้นทะเบียน (ไม่มีวันเริ่มงาน)',
  },
};

/** คืน null เมื่อไม่มีอะไรต้องบอก — `ok`, `not_required` และ `pending` เงียบ */
export const SsoBadge: React.FC<{ sso?: SsoState | null }> = ({ sso }) => {
  const st = sso && STYLES[sso.state];
  if (!st || !sso) return null;
  return (
    <span title={sso.message || undefined}
      className={`inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded border ${st.cls}`}>
      {st.icon} {st.text(sso)}
    </span>
  );
};
