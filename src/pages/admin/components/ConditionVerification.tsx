import React from 'react';
import {
  ShieldCheck, CheckCircle2, Search, Camera, PackageOpen,
  Monitor, Battery, Globe, Info, Package, Cpu, Smartphone
} from 'lucide-react';
import { formatCurrency } from '@/utils/formatters';

interface ConditionVerificationProps {
  job: any;
  modelsData: any[];
  conditionSets: any[];
}

const getConditionIcon = (text: string) => {
  const t = text || '';
  if (t.includes('จอ') || t.includes('กระจก')) return Monitor;
  if (t.includes('ตัวเครื่อง') || t.includes('ฝาหลัง') || t.includes('รอย')) return Smartphone;
  if (t.includes('แบต')) return Battery;
  if (t.includes('ทำงาน') || t.includes('ระบบ')) return Cpu;
  if (t.includes('อุปกรณ์') || t.includes('กล่อง')) return Package;
  if (t.includes('โมเดล') || t.includes('ประเทศ') || t.includes('รหัส')) return Globe;
  return Info;
};

const getConditionText = (item: any): string => {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const textValue = item.value || item.label;
    if (item.title && textValue) return `[${item.title}] ${textValue}`;
    return textValue || item.title || JSON.stringify(item);
  }
  return '';
};

const checkMatch = (arr: any[], text: string) => {
  if (!arr) return false;
  return arr.some(item => {
    const t = getConditionText(item);
    return text.includes(t) || t.includes(text) || text === t;
  });
};

export const ConditionVerification: React.FC<ConditionVerificationProps> = ({ job }) => {
  const statusLower = String(job.status || '').trim().toLowerCase();

  return (
    <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-200 space-y-8">
      <div className="flex justify-between items-center border-b border-slate-100 pb-4">
        <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
          <ShieldCheck className="text-blue-500" size={20} /> Condition Match Verification
        </h3>
      </div>

      {(job.devices && job.devices.length > 0 ? job.devices : [job]).map((device: any, idx: number) => {
        const riderChecks = device.rider_conditions || device.deductions || (idx === 0 ? job.deductions : []) || [];
        const isInspected = device.inspection_status === "Inspected" || statusLower === "qc review";
        const devicePhotos = device.photos || (idx === 0 && job.photos ? job.photos : []);

        return (
          <div key={idx} className="space-y-4 pt-6 first:pt-0 border-t first:border-t-0 border-slate-100">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="bg-slate-800 text-white px-3 py-1 rounded-lg text-[10px] font-black tracking-widest">DEVICE {idx + 1}</span>
                <h4 className="text-sm font-black text-slate-800 uppercase">{device.model || job.model}</h4>
              </div>
              {job.initial_customer_price && (
                <div className="bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-sm">
                  <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">ลูกค้าประเมินมา</span>
                  <span className="text-xs font-black text-blue-700">{formatCurrency(job.initial_customer_price)}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Left side: Customer reported */}
              <div className="space-y-3">
                <p className="text-[9px] font-black text-slate-400 uppercase text-center tracking-widest">ลูกค้าแจ้ง</p>
                <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100 min-h-[120px]">
                  {device.isNewDevice && (
                    <div className="text-xs font-bold text-blue-600 flex items-center gap-2 bg-blue-50 p-3 rounded-xl border border-blue-100 mb-2"><PackageOpen size={16} /> เครื่องใหม่มือ 1</div>
                  )}
                  {device.customer_conditions?.length > 0 ? (
                    <ul className="space-y-1.5">
                      {device.customer_conditions.map((c: any, i: number) => {
                        const cText = getConditionText(c);

                        let isMatchWithRider = false;
                        if (riderChecks.length > 0) {
                          isMatchWithRider = riderChecks.some((rItem: any) => {
                            const rText = getConditionText(rItem);
                            return cText.includes(rText) || rText.includes(cText) || cText === rText;
                          });
                        }

                        const Icon = getConditionIcon(cText);

                        if (riderChecks.length === 0) {
                          return (
                            <li key={i} className="text-[11px] font-bold text-slate-600 flex items-start gap-2 bg-slate-100/50 p-2 rounded-lg border border-slate-100">
                              <Icon size={14} className="text-slate-400 shrink-0 mt-0.5" />{cText}
                            </li>
                          );
                        }

                        return isMatchWithRider ? (
                          <li key={i} className="text-[11px] font-bold text-emerald-600 flex items-start gap-2 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                            <Icon size={14} className="shrink-0 mt-0.5" />{cText}
                          </li>
                        ) : (
                          <li key={i} className="text-[11px] font-bold text-red-600 flex items-start gap-2 bg-red-50 p-2 rounded-lg border border-red-100">
                            <Icon size={14} className="shrink-0 mt-0.5" />{cText}
                          </li>
                        );
                      })}
                    </ul>
                  ) : !device.isNewDevice ? (
                    <div className="text-[11px] text-slate-400 text-center py-4">ไม่มีข้อมูลสภาพเครื่อง</div>
                  ) : null}
                </div>
              </div>

              {/* Right side: Actual inspection */}
              <div className="space-y-3">
                <p className="text-[9px] font-black text-slate-400 uppercase text-center tracking-widest">ผลตรวจจริง</p>
                <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100 min-h-[120px]">
                  {riderChecks.length > 0 ? (
                    <ul className="space-y-1.5">
                      {riderChecks.map((d: any, i: number) => {
                        const dText = getConditionText(d);

                        const isExactMatch = checkMatch(device.customer_conditions, dText);
                        const isGoodCondition = dText.includes('สมบูรณ์') || dText.includes('ปกติ') || (device.isNewDevice && dText.includes('เครื่องใหม่'));
                        const isMatch = isExactMatch || isGoodCondition;

                        const Icon = getConditionIcon(dText);

                        return isMatch ? (
                          <li key={i} className="text-[11px] font-bold text-emerald-600 flex items-start gap-2 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                            <Icon size={14} className="shrink-0 mt-0.5" />{dText}
                          </li>
                        ) : (
                          <li key={i} className="text-[11px] font-bold text-red-600 flex items-start gap-2 bg-red-50 p-2 rounded-lg border border-red-100">
                            <Icon size={14} className="shrink-0 mt-0.5" />{dText}
                          </li>
                        );
                      })}
                    </ul>
                  ) : isInspected ? (
                    <div className="text-xs font-bold text-emerald-600 flex items-center gap-2 h-full justify-center"><CheckCircle2 size={16} /> สภาพสมบูรณ์ 100%</div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300"><Search size={32} className="mb-2 opacity-20" /><p className="text-[9px] font-black uppercase tracking-widest opacity-50">Waiting QC</p></div>
                  )}
                </div>
              </div>
            </div>

            {devicePhotos.length > 0 && (
              <div className="pt-2">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Camera size={14} /> รูปถ่ายตัวเครื่อง</p>
                <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                  {devicePhotos.map((url: string, i: number) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" className="w-24 h-24 shrink-0 rounded-2xl overflow-hidden border border-slate-200 hover:border-blue-400 transition-all shadow-sm">
                      <img src={url} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};