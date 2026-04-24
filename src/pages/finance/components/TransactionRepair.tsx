// src/pages/finance/components/TransactionRepair.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../../hooks/useDatabase';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { Search, Wrench, AlertTriangle, CheckCircle2, FileText, ExternalLink } from 'lucide-react';
import { ref, update, push, child, get } from 'firebase/database';
import { db } from '../../../api/firebase';
import { useToast } from '../../../components/ui/ToastProvider';

// คำนวณยอดโอนสุทธิสดจาก final_price ตลอด — ไม่ใช้ net_payout ที่เก็บใน DB เพราะอาจล้าสมัย
// (เช่น QC รอบหลังไม่ได้ sync) และต้องครอบด้วย Math.max(0, ...) ป้องกันยอดติดลบ
const getNetPayout = (tx: any) => {
  const base = Number(tx.final_price || tx.price || 0);
  const pickupFee = tx.receive_method === 'Pickup' ? Number(tx.pickup_fee || 0) : 0;
  const coupon = Number(tx.applied_coupon?.actual_value || tx.applied_coupon?.value || 0);
  return Math.max(0, base - pickupFee + coupon);
};

export const TransactionRepair = () => {
  const toast = useToast();
  const { data: jobs, loading: jobsLoading } = useDatabase('jobs');
  const { data: transactions, loading: txLoading } = useDatabase('transactions');
  const [searchQuery, setSearchQuery] = useState('');
  const [repairing, setRepairing] = useState<string | null>(null);

  // หา jobs ที่ paid แล้ว แต่ไม่มี transaction record
  const orphanedJobs = useMemo(() => {
    if (jobsLoading || txLoading) return [];

    const jobList = Array.isArray(jobs) ? jobs : [];
    const txList = Array.isArray(transactions) ? transactions : [];

    // สร้าง Set ของ ref_job_id ทั้งหมดที่มี transaction แล้ว
    const txJobIds = new Set(txList.map(t => t.ref_job_id).filter(Boolean));

    return jobList.filter(j => {
      // เฉพาะ job ที่จ่ายแล้ว (มี paid_at) แต่ไม่มี transaction
      const isPaid = j.paid_at && (j.status === 'Waiting for Handover' || j.status === 'Sent to QC Lab' || j.status === 'Completed' || j.status === 'Payment Completed' || j.status === 'Pending QC');
      const hasTransaction = txJobIds.has(j.id);
      return isPaid && !hasTransaction;
    }).sort((a: any, b: any) => (b.paid_at || 0) - (a.paid_at || 0));
  }, [jobs, transactions, jobsLoading, txLoading]);

  // กรอง search
  const filteredJobs = useMemo(() => {
    if (!searchQuery.trim()) return orphanedJobs;
    const q = searchQuery.toLowerCase();
    return orphanedJobs.filter((j: any) =>
      (j.ref_no || '').toLowerCase().includes(q) ||
      (j.cust_name || '').toLowerCase().includes(q) ||
      (j.model || '').toLowerCase().includes(q) ||
      (j.id || '').toLowerCase().includes(q)
    );
  }, [orphanedJobs, searchQuery]);

  const handleRepairTransaction = async (job: any) => {
    const isB2B = job.type === 'B2B Trade-in';
    const isWithdrawal = job.type === 'Withdrawal';
    const netPayout = isWithdrawal ? Number(job.withdraw_amount || 0) : getNetPayout(job);
    // ค่าวิ่งจริงที่ Cloud Function คำนวณไว้ตอน Pending QC (ไม่ใช่ pickup_fee ที่เก็บจากลูกค้า)
    const riderFee = Number(job.rider_fee || 0);

    if (!confirm(`ยืนยันสร้าง transaction สำหรับ ${job.ref_no || job.id}?\n\nยอดจ่าย: ฿${netPayout.toLocaleString()}\nค่าวิ่งไรเดอร์: ฿${riderFee.toLocaleString()}`)) return;

    setRepairing(job.id);
    try {
      const updates: Record<string, any> = {};
      const timestamp = job.paid_at || Date.now();

      if (isWithdrawal) {
        // Withdrawal: DEBIT
        const txKey = push(child(ref(db), 'transactions')).key;
        updates[`transactions/${txKey}`] = {
          rider_id: job.rider_id || 'SYSTEM',
          amount: netPayout,
          type: 'DEBIT',
          category: 'WITHDRAWAL',
          description: `[ซ่อม] ถอนเงินเข้าบัญชี ${job.bank_name || '-'} (${job.bank_account || '-'})`,
          timestamp,
          ref_job_id: job.id,
          slip_url: job.payment_slip || null
        };
      } else {
        // Trade-In / B2B: DEBIT (payout)
        const debitKey = push(child(ref(db), 'transactions')).key;
        updates[`transactions/${debitKey}`] = {
          rider_id: 'SYSTEM',
          amount: netPayout,
          type: 'DEBIT',
          category: isB2B ? 'B2B_PURCHASE' : 'TRADE_IN_PAYOUT',
          description: `[ซ่อม] จ่ายเงินรับซื้อสุทธิ ${job.model || 'Unknown'} (${(job.cust_name || 'Unknown').split('(')[0]})`,
          timestamp,
          ref_job_id: job.id,
          slip_url: job.payment_slip || null
        };

        // CREDIT (logistics revenue) ถ้ามีค่าวิ่งไรเดอร์
        if (riderFee > 0) {
          const creditKey = push(child(ref(db), 'transactions')).key;
          updates[`transactions/${creditKey}`] = {
            rider_id: job.rider_id || 'SYSTEM',
            amount: riderFee,
            type: 'CREDIT',
            category: 'LOGISTICS_REVENUE',
            description: `[ซ่อม] รายได้ค่าบริการไรเดอร์รับเครื่อง - Ref: ${job.ref_no || job.id}`,
            timestamp,
            ref_job_id: job.id
          };
        }
      }

      await update(ref(db), updates);
      toast.success(`สร้าง transaction สำหรับ ${job.ref_no || job.id} สำเร็จ!`);
    } catch (e) {
      toast.error('เกิดข้อผิดพลาด: ' + e);
    } finally {
      setRepairing(null);
    }
  };

  if (jobsLoading || txLoading) {
    return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">กำลังตรวจสอบข้อมูล...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-6">
        <h3 className="text-lg font-black text-amber-800 flex items-center gap-2">
          <Wrench className="text-amber-600" /> ซ่อม Transaction ที่หายไป
        </h3>
        <p className="text-xs font-bold text-amber-600 mt-1">
          แสดง Jobs ที่จ่ายเงินแล้ว (มี paid_at) แต่ไม่มี Transaction Record ใน Audit Log
        </p>
      </div>

      {/* Summary */}
      {orphanedJobs.length > 0 ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="text-red-500" size={20} />
          <span className="font-bold text-red-700 text-sm">
            พบ {orphanedJobs.length} รายการที่จ่ายเงินแล้วแต่ไม่มี Transaction
          </span>
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle2 className="text-emerald-500" size={20} />
          <span className="font-bold text-emerald-700 text-sm">
            ไม่พบรายการที่ผิดปกติ — Transaction ครบถ้วนทุกรายการ
          </span>
        </div>
      )}

      {/* Search */}
      {orphanedJobs.length > 0 && (
        <div className="relative">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="ค้นหาด้วย OID, ชื่อลูกค้า, รุ่นเครื่อง..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-6 py-4 border border-slate-200 rounded-2xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          />
        </div>
      )}

      {/* Table */}
      {filteredJobs.length > 0 && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black text-slate-400 tracking-widest">
              <tr>
                <th className="p-5 pl-8">Job / OID</th>
                <th className="p-5">ลูกค้า & เครื่อง</th>
                <th className="p-5">สถานะ</th>
                <th className="p-5 text-right">ยอดจ่าย</th>
                <th className="p-5">วันที่จ่าย</th>
                <th className="p-5 text-center">สลิป</th>
                <th className="p-5 text-right pr-8">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredJobs.map((job: any) => {
                const isWithdrawal = job.type === 'Withdrawal';
                const netPayout = isWithdrawal ? Number(job.withdraw_amount || 0) : getNetPayout(job);
                return (
                  <tr key={job.id} className="hover:bg-amber-50/50 transition-colors">
                    <td className="p-5 pl-8">
                      <div className="font-bold text-blue-600 text-sm">{job.ref_no || '-'}</div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">{job.id}</div>
                    </td>
                    <td className="p-5">
                      <div className="font-bold text-slate-800 text-sm">{job.cust_name || job.rider_id || '-'}</div>
                      <div className="text-xs text-slate-500">{job.model || job.type || '-'}</div>
                    </td>
                    <td className="p-5">
                      <span className="text-[10px] font-black uppercase bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">
                        {job.status}
                      </span>
                    </td>
                    <td className="p-5 text-right">
                      <span className="font-black text-red-600">-฿{netPayout.toLocaleString()}</span>
                      {!isWithdrawal && Number(job.rider_fee || 0) > 0 && (
                        <div className="text-[10px] text-emerald-600 font-bold">+฿{Number(job.rider_fee).toLocaleString()} ค่าวิ่งไรเดอร์</div>
                      )}
                    </td>
                    <td className="p-5 text-xs font-bold text-slate-500">
                      {job.paid_at ? formatDate(job.paid_at) : '-'}
                    </td>
                    <td className="p-5 text-center">
                      {job.payment_slip ? (
                        <a href={job.payment_slip} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700">
                          <ExternalLink size={16} />
                        </a>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                    <td className="p-5 text-right pr-8">
                      <button
                        onClick={() => handleRepairTransaction(job)}
                        disabled={repairing === job.id}
                        className="bg-amber-500 text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase shadow-md hover:bg-amber-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ml-auto"
                      >
                        <Wrench size={14} />
                        {repairing === job.id ? 'กำลังซ่อม...' : 'สร้าง Transaction'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
