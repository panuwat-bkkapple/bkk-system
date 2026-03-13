// src/pages/SettlementPage.tsx
import React, { useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { CheckCircle2, FileText } from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { logTransaction } from '../../utils/transactionLogger';

export const SettlementPage = () => {
  const { data: jobs, loading } = useDatabase('jobs');

  const pendingFees = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list
      .filter(j => (j.status === 'Delivered' || j.status === 'Completed') && j.rider_fee_status === 'Pending' && j.type !== 'Withdrawal')
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }, [jobs]);

  const handleApproveFee = async (jobInput: any) => { 
    // ✅ 1. Safety Check: ถ้าส่งมาแต่ ID (String) ให้ไปหา Object จริงมาก่อน
    let job = jobInput;
    if (typeof jobInput === 'string') {
        job = pendingFees.find(j => j.id === jobInput);
    }

    // ถ้าหาไม่เจอจริงๆ ให้หยุด (กัน Error)
    if (!job) {
        alert("Error: ไม่พบข้อมูลงาน (Job Data Not Found)");
        return;
    }

    console.log("Job Data to Approve:", job); // เช็คใน Console

    if(!confirm(`ยืนยันอนุมัติค่าเที่ยวงาน ${job.ref_no}?`)) return;

    try {
        // 1. อัปเดตสถานะงาน
        await update(ref(db, `jobs/${job.id}`), { rider_fee_status: 'Paid', settled_at: Date.now() });
        
        // ✅ 2. เตรียมข้อมูลที่ปลอดภัย (กันค่า undefined)
        const safeRiderId = job.rider_id || "Unknown_Rider";
        const safeAmount = Number(job.rider_fee || 150);

        // 3. บันทึก Transaction
        await logTransaction({
            rider_id: safeRiderId, // ✅ ใช้ตัวแปร safeRiderId ที่เตรียมไว้
            amount: safeAmount,
            type: 'CREDIT',
            category: 'JOB_PAYOUT',
            description: `ค่าเที่ยวงาน ${job.model || 'Unknown'} (${job.ref_no || '-'})`,
            ref_job_id: job.id
        });

    } catch (e) { 
        console.error(e);
        alert('เกิดข้อผิดพลาด: ' + e); 
    }
  };

  const handleApproveAll = async () => {
    if (!confirm(`อนุมัติทั้งหมด ${pendingFees.length} รายการ?`)) return;
    const updates: any = {};
    
    // Note: การ Approve All แบบ Batch ปกติจะไม่ได้ Trigger logTransaction รายตัว
    // เพื่อความรวดเร็ว แต่สถานะเงินใน Rider App จะเปลี่ยนเป็น Paid ปกติ
    pendingFees.forEach(j => {
      updates[`jobs/${j.id}/rider_fee_status`] = 'Paid';
      updates[`jobs/${j.id}/settled_at`] = Date.now();
    });
    
    try {
        await update(ref(db), updates);
        alert("อนุมัติทั้งหมดเรียบร้อย");
    } catch(e) {
        alert(e);
    }
  };

  if (loading) return <div className="p-10 text-center font-black text-gray-400">LOADING PAYOUTS...</div>;

  return (
    <div className="p-8 space-y-6 max-w-[1200px] mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-black text-gray-800 uppercase tracking-tighter">Rider Payouts</h2>
          <p className="text-sm text-gray-500">อนุมัติค่าเที่ยวรายครั้งเข้า Wallet ไรเดอร์</p>
        </div>
        {pendingFees.length > 0 && (
          <button onClick={handleApproveAll} className="bg-green-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase shadow-lg shadow-green-100 flex items-center gap-2">
            <CheckCircle2 size={16}/> Approve All ({pendingFees.length})
          </button>
        )}
      </div>

      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b text-[10px] uppercase font-black text-gray-400">
            <tr>
              <th className="p-6 pl-10">Job Ref</th>
              <th className="p-6">Rider</th>
              <th className="p-6 text-center">Fee</th>
              <th className="p-6 text-right pr-10">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pendingFees.map(item => (
              <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="p-6 pl-10">
                  <div className="font-bold text-blue-600 flex items-center gap-2"><FileText size={14}/> {item.ref_no}</div>
                  <div className="text-[10px] text-gray-400">{formatDate(item.created_at)}</div>
                </td>
                <td className="p-6 font-bold text-gray-700">{item.rider_id}</td>
                <td className="p-6 text-center font-black">{formatCurrency(item.rider_fee || 150)}</td>
                <td className="p-6 text-right pr-10">
                  {/* ✅ แก้ไขจุดนี้: ส่ง item (Object) ไปทั้งก้อนเลย ไม่ใช่ส่งแค่ item.id */}
                  <button 
                    onClick={() => handleApproveFee(item)} 
                    className="bg-blue-600 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-blue-700 transition-all"
                  >
                    Approve
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pendingFees.length === 0 && <div className="p-20 text-center text-gray-300 font-bold uppercase">No Pending Payouts</div>}
      </div>
    </div>
  );
};