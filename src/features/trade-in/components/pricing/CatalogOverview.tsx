'use client';

import React, { useMemo, useState } from 'react';
import { Info, X, PackageCheck, AlertTriangle, PauseCircle } from 'lucide-react';
import { getModelReadiness } from '../../utils/modelReadiness';

const INFO_DISMISS_KEY = 'bkk_catalog_info_dismissed';

// Banner กติกาความพร้อมของแคตตาล็อก — ปิดแล้วจำไว้ใน localStorage
export const CatalogInfoBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(INFO_DISMISS_KEY) === '1'; } catch { return false; }
  });
  if (dismissed) return null;
  return (
    <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 mb-6">
      <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
      <p className="flex-1 text-sm font-bold text-blue-800">
        รุ่นจะเปิดรับซื้อได้จริงเมื่อตั้งค่าครบ 3 อย่าง: วิธีรับซื้อ (Purchasing Method), ชุดประเมินสภาพ (Condition Group) และราคารับซื้อ (Pricing)
      </p>
      <button
        onClick={() => { setDismissed(true); try { localStorage.setItem(INFO_DISMISS_KEY, '1'); } catch { /* private mode */ } }}
        className="p-1 text-blue-400 hover:text-blue-600 transition shrink-0"
        aria-label="ปิดข้อความ"
      >
        <X size={16} />
      </button>
    </div>
  );
};

const KpiCard: React.FC<{
  icon: React.ReactNode;
  value: number;
  label: string;
  sub?: string;
  tone: 'emerald' | 'amber' | 'slate';
}> = ({ icon, value, label, sub, tone }) => {
  const iconTone = {
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-500',
  }[tone];
  return (
    <div className="flex items-center gap-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconTone}`}>{icon}</div>
      <div>
        <div className="text-2xl font-black text-slate-900 leading-none">{value}</div>
        <div className="text-xs font-bold text-slate-500 mt-1">{label}</div>
        {sub && <div className="text-[10px] font-medium text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
};

// แถวสถิติหัวหน้า Catalog (นับจากรุ่นทั้งหมดใน category ที่เลือก):
// Active = เปิดและ config ครบ / Incomplete = เปิดอยู่แต่ config ไม่ครบ /
// Inactive = งดรับซื้อ
export const CatalogKpiCards: React.FC<{ models: any[]; conditionSets: any[] }> = ({ models, conditionSets }) => {
  const stats = useMemo(() => {
    let active = 0, incomplete = 0, inactive = 0;
    for (const m of models) {
      const s = getModelReadiness(m, conditionSets).status;
      if (s === 'active') active++;
      else if (s === 'incomplete') incomplete++;
      else inactive++;
    }
    return { active, incomplete, inactive };
  }, [models, conditionSets]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <KpiCard icon={<PackageCheck size={20} />} value={stats.active} label="Active Models" sub="เปิดรับซื้อและตั้งค่าครบ" tone="emerald" />
      <KpiCard icon={<AlertTriangle size={20} />} value={stats.incomplete} label="Incomplete" sub="เปิดอยู่แต่ตั้งค่าไม่ครบ — ลูกค้าอาจขายไม่ได้" tone="amber" />
      <KpiCard icon={<PauseCircle size={20} />} value={stats.inactive} label="Inactive" sub="งดรับซื้อ" tone="slate" />
    </div>
  );
};
