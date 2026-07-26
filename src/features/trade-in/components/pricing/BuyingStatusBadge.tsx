'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { getModelReadiness, READINESS_ISSUE_LABELS } from '../../utils/modelReadiness';

// Badge สถานะการรับซื้อแบบ derived (ไม่ใช่แค่ isActive): Active = เปิดและ
// config ครบ, Incomplete = เปิดอยู่แต่ config ไม่ครบ (hover ดูว่าขาดอะไร),
// Inactive = แอดมินปิดรับซื้อเอง
export const BuyingStatusBadge: React.FC<{ item: any; conditionSets: any[] }> = ({ item, conditionSets }) => {
  const r = getModelReadiness(item, conditionSets);

  if (r.status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full whitespace-nowrap">
        <CheckCircle2 size={12} /> Active
      </span>
    );
  }

  if (r.status === 'inactive') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full whitespace-nowrap">
        <XCircle size={12} /> Inactive
      </span>
    );
  }

  return (
    <span
      title={r.issues.map(i => READINESS_ISSUE_LABELS[i]).join('\n')}
      className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full whitespace-nowrap cursor-help"
    >
      <AlertTriangle size={12} /> Incomplete
    </span>
  );
};

export default BuyingStatusBadge;
