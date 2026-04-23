// src/pages/finance/components/RiderSettlements.tsx
import React, { useMemo } from 'react';
import { useDatabase } from '../../../hooks/useDatabase';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { CheckCircle2, FileText, Zap } from 'lucide-react';
import { ref, update, push, child } from 'firebase/database';
import { db } from '../../../api/firebase';
import { useToast } from '../../../components/ui/ToastProvider';
import { RIDER_SETTLEMENT_READ_STATUSES } from '../../../constants/statusGroups';

export const RiderSettlements = () => {
  const toast = useToast();
  const { data: jobs, loading } = useDatabase('jobs');

  // 🧠 กรองเฉพาะงานที่จบแล้ว แต่ยังไม่ได้จ่ายค่าเที่ยว
  const pendingFees = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list
      .filter(j =>
        // เช็คสถานะที่ถือว่างานจบ (ส่งเครื่องถึงมือร้าน)
        (RIDER_SETTLEMENT_READ_STATUSES as readonly string[]).includes(j.status) &&
        j.rider_fee_status === 'Pending' &&
        j.type !== 'Withdrawal' &&
        j.rider_id != null
      )
      .sort((a, b) => (b.completed_at || b.created_at || 0) - (a.completed_at || a.created_at || 0));
  }, [jobs]);

  // 💰 อนุมัติทีละรายการ
  const handleApproveFee = async (job: any) => { 
    if(!confirm(`ยืนยันอนุมัติค่าเที่ยวงาน ${job.ref_no} จำนวน ${formatCurrency(job.rider_fee || 150)} ใช่หรือไม่?`)) return;

    try {
        const now = Date.now();
        // Atomic multi-path update: job + transaction ในครั้งเดียว
        const txKey = push(child(ref(db), 'transactions')).key;
        const updates: Record<string, any> = {};
        updates[`jobs/${job.id}/rider_fee_status`] = 'Paid';
        updates[`jobs/${job.id}/settled_at`] = now;
        updates[`transactions/${txKey}`] = {
            rider_id: job.rider_id,
            amount: Number(job.rider_fee || 150),
            type: 'CREDIT',
            category: 'JOB_PAYOUT',
            description: `ค่าเที่ยวงาน ${job.model || 'Unknown'} (${job.ref_no || '-'})`,
            timestamp: now,
            ref_job_id: job.id
        };
        await update(ref(db), updates);
    } catch (e) { toast.error('เกิดข้อผิดพลาด: ' + e); }
  };

  // ⚡ อนุมัติทั้งหมดในคลิกเดียว
  const handleApproveAll = async () => {
    if (!confirm(`ยืนยันอนุมัติจ่ายค่ารอบทั้งหมด ${pendingFees.length} รายการ?`)) return;
    
    try {
        const now = Date.now();
        // Atomic multi-path update: jobs + transactions ทั้งหมดในครั้งเดียว
        const updates: Record<string, any> = {};

        pendingFees.forEach(job => {
            updates[`jobs/${job.id}/rider_fee_status`] = 'Paid';
            updates[`jobs/${job.id}/settled_at`] = now;

            const txKey = push(child(ref(db), 'transactions')).key;
            updates[`transactions/${txKey}`] = {
                rider_id: job.rider_id,
                amount: Number(job.rider_fee || 150),
                type: 'CREDIT',
                category: 'JOB_PAYOUT',
                description: `ค่าเที่ยวงาน ${job.model || 'Unknown'} (${job.ref_no || '-'}) [Batch]`,
                timestamp: now,
                ref_job_id: job.id
            };
        });

        await update(ref(db), updates);

        toast.success("อนุมัติทั้งหมดเข้า Wallet ไรเดอร์เรียบร้อยแล้ว!");
    } catch(e) { toast.error('เกิดข้อผิดพลาด: ' + e); }
  };

  if (loading) return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Loading Settlements...</div>;

  return (
    <div className="space-y-6">
      
      <div className="flex justify-between items-center bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
        <div>
           <h3 className="text-lg font-black text-slate-800 flex items-center gap-2"><Zap className="text-emerald-500"/> ค่ารอบรออนุมัติ (Pending Rider Fees)</h3>
           <p className="text-xs font-bold text-slate-400 mt-1">อนุมัติเพื่อให้เงินเข้ากระเป๋า Wallet ของไรเดอร์</p>
        </div>
        {pendingFees.length > 0 && (
          <button onClick={handleApproveAll} className="bg-emerald-600 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase shadow-lg shadow-emerald-200 hover:bg-emerald-700 active:scale-95 transition-all flex items-center gap-2">
            <CheckCircle2 size={18}/> Approve All ({pendingFees.length})
          </button>
        )}
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black text-slate-400 tracking-widest">
            <tr>
              <th className="p-6 pl-10">Job Ref</th>
              <th className="p-6">Rider ID</th>
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
                <td className="p-6 font-mono font-bold text-slate-600">{item.rider_id}</td>
                <td className="p-6 font-bold text-xs text-slate-700 uppercase">{item.model || 'Unknown Device'}</td>
                <td className="p-6 text-center">
                   <span className="font-black text-emerald-600 text-lg bg-emerald-50 px-3 py-1 rounded-xl">+{formatCurrency(item.rider_fee || 150)}</span>
                </td>
                <td className="p-6 text-right pr-10">
                  <button 
                    onClick={() => handleApproveFee(item)} 
                    className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-md hover:bg-black active:scale-95 transition-all"
                  >
                    Approve
                  </button>
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