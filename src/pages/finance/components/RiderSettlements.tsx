// src/pages/finance/components/RiderSettlements.tsx
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDatabase } from '../../../hooks/useDatabase';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { CheckCircle2, FileText, Zap } from 'lucide-react';
import { ref, update, push, child } from 'firebase/database';
import { db } from '../../../api/firebase';
import { useToast } from '../../../components/ui/ToastProvider';
import { settledRiderFee } from '../../../utils/riderSettlement';


export const RiderSettlements = () => {
  const toast = useToast();
  const { data: jobs, loading } = useDatabase('jobs');
  // สถานะการจ้างของไรเดอร์ตัดสินวิธีทางภาษีของเงินก้อนนี้ คนที่กดจ่ายจึงต้อง
  // เห็นก่อนกด — ไรเดอร์ที่ยังไม่ระบุสถานะแปลว่ายังไม่รู้ว่าต้องหัก ณ ที่จ่าย
  // หรือเข้าระบบเงินเดือน ซึ่งแก้ย้อนหลังยากกว่ากรอกให้ครบก่อนจ่าย
  const { data: riders } = useDatabase('riders');
  const riderById = useMemo(() => {
    const m: Record<string, any> = {};
    (Array.isArray(riders) ? riders : []).forEach((r: any) => { if (r?.id) m[r.id] = r; });
    return m;
  }, [riders]);

  // 🧠 กรองเฉพาะงานที่จบแล้ว แต่ยังไม่ได้จ่ายค่าเที่ยว
  const pendingFees = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list
      .filter(j => 
        // เช็คสถานะที่ถือว่างานจบ (ส่งเครื่องถึงมือร้าน)
        (j.status === 'Pending QC' || j.status === 'Completed' || j.status === 'Waiting for Handover') && 
        j.rider_fee_status === 'Pending' && 
        j.type !== 'Withdrawal' && 
        j.rider_id != null
      )
      .sort((a, b) => (b.completed_at || b.created_at || 0) - (a.completed_at || a.created_at || 0));
  }, [jobs]);

  // งานที่ "อนุมัติได้จริง" = มีค่ารอบที่ระบบประทับไว้แล้วเท่านั้น
  // ที่เหลือยังอยู่ในตารางให้เห็น แต่กดจ่ายไม่ได้ (ดู settledRiderFee)
  const payableFees = useMemo(
    () => pendingFees.filter((j) => settledRiderFee(j) !== null),
    [pendingFees],
  );
  const unpricedCount = pendingFees.length - payableFees.length;

  // การอนุมัติค่ารอบย้ายไปที่ใบตรวจงานไรเดอร์ (/rider-audit) แล้ว
  //
  // เหตุผลไม่ใช่เรื่องการจัดเมนู: การอนุมัติคือการรับรองว่า "งานนี้ทำจริง ระยะ
  // เท่านี้ ค่ารอบเท่านี้" ซึ่งเป็นข้อเท็จจริงหน้างาน และจอนี้เห็นแค่ 4 ช่อง
  // (เลขที่งาน / ไรเดอร์ / เครื่อง / ยอด) คนกดจึงไม่มีข้อมูลจะรับรอง
  //
  // เส้นแบ่งนี้เป็นของระบบบัญชีอยู่แล้ว: อนุมัติค่ารอบ = ตั้งหนี้ เงินยังไม่ออก
  // จากบัญชีบริษัท ส่วนการถอนคือการจ่ายเงินจริงที่มีสลิปและเป็นจุดหักภาษี
  // ณ ที่จ่าย ซึ่งยังเป็นของหน้านี้ตามเดิม (ดู /rider-withdrawals)
  //
  // จอนี้จึงเหลือเป็น **คิวรอตรวจแบบอ่านอย่างเดียว** ให้ฝ่ายบัญชีเห็นว่ามีหนี้
  // ค้างตั้งอยู่เท่าไร โดยไม่ต้องเป็นคนรับรองเอง

  if (loading) return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Loading Settlements...</div>;

  return (
    <div className="space-y-6">
      
      <div className="flex justify-between items-center bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
        <div>
           <h3 className="text-lg font-black text-slate-800 flex items-center gap-2"><Zap className="text-emerald-500"/> ค่ารอบรออนุมัติ (Pending Rider Fees)</h3>
           <p className="text-xs font-bold text-slate-400 mt-1">การอนุมัติย้ายไปที่ใบตรวจงานไรเดอร์แล้ว จอนี้แสดงหนี้ค่ารอบที่ค้างตั้งอยู่</p>
           {unpricedCount > 0 && (
             <p className="text-xs font-bold text-amber-600 mt-2">
               {unpricedCount} รายการยังไม่มีค่ารอบที่ระบบคำนวณ — จ่ายไม่ได้จนกว่าจะมีตัวเลขจริง
             </p>
           )}
        </div>
        {payableFees.length > 0 && (
          <Link to="/rider-audit" className="px-4 py-2 text-xs font-black rounded-xl bg-sky-600 text-white">ไปที่ใบตรวจงานไรเดอร์</Link>
        )}
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black text-slate-400 tracking-widest">
            <tr>
              <th className="p-6 pl-10">Job Ref</th>
              <th className="p-6">Rider</th>
              <th className="p-6">Device Details</th>
              <th className="p-6 text-center">Fee Amount</th>
              <th className="p-6 text-right pr-10">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {pendingFees.map(item => (
              <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="p-6 pl-10">
                  <div className="font-bold text-blue-600 flex items-center gap-2"><FileText size={14}/> {item.ref_no}</div>
                  <div className="text-[10px] font-bold text-slate-400 mt-1">{formatDate(item.completed_at || item.created_at)}</div>
                </td>
                <td className="p-6">
                  <div className="font-mono font-bold text-slate-600">{item.rider_id}</div>
                  {(() => {
                    const t = riderById[item.rider_id]?.employment?.type;
                    if (t === 'employee') return <div className="text-[10px] font-black text-slate-400 mt-1">ลูกจ้างประจำ · เข้าระบบเงินเดือน</div>;
                    if (t === 'freelance') return <div className="text-[10px] font-black text-amber-600 mt-1">รับจ้างอิสระ · ต้องหัก ณ ที่จ่าย</div>;
                    return <div className="text-[10px] font-black text-rose-500 mt-1">ยังไม่ระบุสถานะการจ้าง</div>;
                  })()}
                </td>
                <td className="p-6 font-bold text-xs text-slate-700 uppercase">{item.model || 'Unknown Device'}</td>
                <td className="p-6 text-center">
                   {settledRiderFee(item) !== null ? (
                     <span className="font-black text-emerald-600 text-lg bg-emerald-50 px-3 py-1 rounded-xl">+{formatCurrency(settledRiderFee(item) as number)}</span>
                   ) : (
                     <div className="inline-flex flex-col items-center gap-1">
                       <span className="font-black text-slate-400 text-lg bg-slate-100 px-3 py-1 rounded-xl">—</span>
                       <span className="text-[9px] font-black text-amber-600 uppercase tracking-wide">ยังไม่มีค่ารอบ</span>
                     </div>
                   )}
                </td>
                <td className="p-6 text-right pr-10">
                  <Link to="/rider-audit" className="text-[10px] font-black uppercase text-sky-600 hover:underline">
                    ตรวจที่ใบตรวจงาน
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pendingFees.length === 0 && <div className="p-16 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">เคลียร์ยอดค่ารอบครบหมดแล้ว ยอดเยี่ยมมาก! 🎉</div>}
      </div>
    </div>
  );
};