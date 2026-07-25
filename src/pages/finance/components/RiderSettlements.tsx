// src/pages/finance/components/RiderSettlements.tsx
import React, { useMemo } from 'react';
import { useDatabase } from '../../../hooks/useDatabase';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { CheckCircle2, FileText, Zap, AlertTriangle } from 'lucide-react';
import { ref, update, push, child, runTransaction } from 'firebase/database';
import { db } from '../../../api/firebase';
import { useToast } from '../../../components/ui/ToastProvider';

export const RiderSettlements = () => {
  const toast = useToast();
  const { data: jobs, loading } = useDatabase('jobs');

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

  // อนุมัติหนึ่งรายการแบบกันซ้ำ:
  //   1) claim ด้วย runTransaction บน rider_fee_status (Pending -> Paid) —
  //      สองแอดมินกดพร้อมกันจะ commit ได้คนเดียว อีกคน abort ไม่เกิดเครดิตซ้ำ
  //   2) เขียน settled_at + CREDIT transaction; ถ้าพลาดให้ดึงสถานะกลับ Pending
  //      เพื่อไม่ให้ค้างเป็น "Paid แต่เงินไม่เข้ากระเป๋า"
  // ไม่มี fallback 150: งานที่ rider_fee ยังไม่ถูกคำนวณต้องรอ Cloud Function
  // หรือให้แอดมินตั้งค่าเอง ห้ามจ่ายเลขเดา
  const approveOne = async (job: any): Promise<'ok' | 'no_fee' | 'taken' | 'error'> => {
    const fee = Number(job.rider_fee);
    if (!Number.isFinite(fee) || fee <= 0) return 'no_fee';

    const claim = await runTransaction(
      ref(db, `jobs/${job.id}/rider_fee_status`),
      (current) => {
        if (current !== 'Pending') return undefined;
        return 'Paid';
      }
    );
    if (!claim.committed) return 'taken';

    try {
        const now = Date.now();
        const txKey = push(child(ref(db), 'transactions')).key;
        const updates: Record<string, any> = {};
        updates[`jobs/${job.id}/settled_at`] = now;
        updates[`transactions/${txKey}`] = {
            rider_id: job.rider_id,
            amount: fee,
            type: 'CREDIT',
            category: 'JOB_PAYOUT',
            description: `ค่าเที่ยวงาน ${job.model || 'Unknown'} (${job.ref_no || '-'})`,
            timestamp: now,
            ref_job_id: job.id
        };
        await update(ref(db), updates);
        return 'ok';
    } catch (e) {
        // เครดิตไม่เข้า — คืนสถานะให้กลับเข้าคิว ไม่ปล่อยให้ Paid ค้างแบบไม่มีเงิน
        try { await update(ref(db, `jobs/${job.id}`), { rider_fee_status: 'Pending' }); } catch { /* best effort */ }
        console.error('approveOne settlement error:', e);
        return 'error';
    }
  };

  // 💰 อนุมัติทีละรายการ
  const handleApproveFee = async (job: any) => {
    const fee = Number(job.rider_fee);
    if (!Number.isFinite(fee) || fee <= 0) {
        toast.error('งานนี้ยังไม่มีค่ารอบ (rider_fee) — รอระบบคำนวณหรือให้แอดมินกำหนดก่อน');
        return;
    }
    if(!confirm(`ยืนยันอนุมัติค่าเที่ยวงาน ${job.ref_no} จำนวน ${formatCurrency(fee)} ใช่หรือไม่?`)) return;

    const result = await approveOne(job);
    if (result === 'ok') toast.success('อนุมัติเข้า Wallet ไรเดอร์เรียบร้อย');
    else if (result === 'taken') toast.error('รายการนี้ถูกอนุมัติไปแล้วโดยผู้ใช้อื่น');
    else if (result === 'error') toast.error('บันทึกเครดิตไม่สำเร็จ — รายการถูกคืนกลับเข้าคิว กรุณาลองใหม่');
  };

  // ⚡ อนุมัติทั้งหมดในคลิกเดียว (ข้ามงานที่ยังไม่มีค่ารอบ)
  const handleApproveAll = async () => {
    const payable = pendingFees.filter(j => Number(j.rider_fee) > 0);
    const skipped = pendingFees.length - payable.length;
    if (payable.length === 0) {
        toast.warning('ไม่มีรายการที่พร้อมจ่าย — งานในคิวยังไม่มีค่ารอบ (rider_fee)');
        return;
    }
    if (!confirm(
        `ยืนยันอนุมัติจ่ายค่ารอบ ${payable.length} รายการ?` +
        (skipped > 0 ? `\n(ข้าม ${skipped} รายการที่ยังไม่มีค่ารอบ)` : '')
    )) return;

    let ok = 0, failed = 0;
    for (const job of payable) {
        const result = await approveOne(job);
        if (result === 'ok') ok++;
        else if (result === 'error') failed++;
        // 'taken' = อีกเครื่องอนุมัติไปแล้วระหว่างรอ — ไม่นับเป็น error
    }
    if (failed > 0) toast.error(`อนุมัติสำเร็จ ${ok} รายการ, ล้มเหลว ${failed} รายการ (ถูกคืนกลับเข้าคิว)`);
    else toast.success(`อนุมัติ ${ok} รายการเข้า Wallet ไรเดอร์เรียบร้อยแล้ว!`);
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
                   {Number(item.rider_fee) > 0 ? (
                     <span className="font-black text-emerald-600 text-lg bg-emerald-50 px-3 py-1 rounded-xl">+{formatCurrency(item.rider_fee)}</span>
                   ) : (
                     <span className="font-bold text-amber-600 text-[10px] bg-amber-50 px-3 py-1.5 rounded-xl inline-flex items-center gap-1">
                       <AlertTriangle size={12}/> รอคำนวณค่ารอบ
                     </span>
                   )}
                </td>
                <td className="p-6 text-right pr-10">
                  <button
                    onClick={() => handleApproveFee(item)}
                    disabled={!(Number(item.rider_fee) > 0)}
                    className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-md hover:bg-black active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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