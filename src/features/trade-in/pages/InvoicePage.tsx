import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '@/api/firebase'; // ⚠️ ปรับ path ให้ตรงกับโปรเจกต์ของคุณ
import { Printer, ChevronLeft, ShieldCheck } from 'lucide-react';

export const InvoicePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const jobRef = ref(db, `jobs/${id}`);
    const unsubscribe = onValue(jobRef, (snapshot) => {
      if (snapshot.exists()) {
        setJob({ id: snapshot.key, ...snapshot.val() });
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(amount || 0);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 font-bold text-slate-400">Loading Invoice...</div>;
  if (!job) return <div className="min-h-screen flex items-center justify-center bg-slate-50 font-bold text-red-400">Invoice not found.</div>;

  // Detect B2B job and prepare line items
  const isB2B = job.type === 'B2B Trade-in' || job.type === 'B2B';
  const b2bItems = (job.graded_items || []).filter((i: any) => i.grade !== 'Reject');
  const lineItems = isB2B
    ? b2bItems.map((item: any) => ({
        model: item.model,
        imei: item.imei,
        grade: item.grade,
        final_price: item.price,
        deductions: [`Grade ${item.grade}`],
      }))
    : (job.devices && job.devices.length > 0 ? job.devices : [job]);

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white py-10 print:py-0 font-sans text-slate-800">
      
      {/* 🛑 แถบเมนูด้านบน (ซ่อนตอนพรินต์) */}
      <div className="max-w-[210mm] mx-auto mb-6 flex justify-between items-center print:hidden px-4 sm:px-0">
        <button onClick={() => navigate(-1)} className="bg-white px-4 py-2 rounded-xl shadow-sm font-bold text-sm flex items-center gap-2 hover:bg-slate-50 transition-all">
          <ChevronLeft size={16}/> กลับไปหน้าระบบ
        </button>
        <button onClick={handlePrint} className="bg-blue-600 text-white px-6 py-2 rounded-xl shadow-md font-bold text-sm flex items-center gap-2 hover:bg-blue-700 active:scale-95 transition-all">
          <Printer size={16}/> พิมพ์เอกสาร (Print A4)
        </button>
      </div>

      {/* 📄 หน้ากระดาษ A4 */}
      <div className={`max-w-[210mm] mx-auto bg-white shadow-2xl print:shadow-none p-12 print:p-0 relative ${isB2B ? '' : 'min-h-[297mm]'}`}>
        
        {/* CSS สำหรับซ่อน/แสดงตอนพรินต์ */}
        <style>{`
          @media print {
            @page { size: A4 portrait; margin: 15mm; }
            body { -webkit-print-color-adjust: exact; }
          }
        `}</style>

        {/* 🏢 Header บริษัท */}
        <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6 mb-8">
          <div className="flex items-start gap-3">
            <ShieldCheck size={40} className="text-blue-600 shrink-0" />
            <div>
              <h1 className="text-3xl font-black tracking-tighter uppercase text-slate-900">BKK APPLE</h1>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Corporate Trade-in & Recommerce</p>
              <div className="mt-2 text-[10px] text-slate-600 leading-relaxed">
                <p className="font-bold">บริษัท เก็ทโมบี้ จำกัด <span className="font-normal text-slate-500">(0105565094088)</span></p>
                <p>เลขที่ 596/163 อารียา ทูบี ถนนลาดปลาเค้า</p>
                <p>แขวงจรเข้บัว เขตลาดพร้าว กรุงเทพฯ 10230</p>
                <p>โทร. 083-495-6556</p>
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-widest">ใบรับซื้อสินค้า</h2>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Purchase Receipt</p>
          </div>
        </div>

        {/* 👤 ข้อมูลลูกค้า & เลขที่เอกสาร */}
        <div className="flex justify-between gap-8 mb-8">
          <div className="flex-1 space-y-2 text-sm font-medium text-slate-600">
            <p><strong className="text-slate-800">ผู้ขาย (Seller):</strong> {job.cust_name || '-'}</p>
            <p><strong className="text-slate-800">เบอร์ติดต่อ (Phone):</strong> {job.cust_phone || '-'}</p>
            {job.cust_id_card && <p><strong className="text-slate-800">เลขบัตรประชาชน (ID Card):</strong> {job.cust_id_card}</p>}
            {job.cust_address && <p><strong className="text-slate-800">ที่อยู่ (Address):</strong> {job.cust_address}</p>}
          </div>
          <div className="w-64 space-y-2 text-sm font-medium text-slate-600 border border-slate-200 p-4 rounded-xl bg-slate-50/50">
            <p className="flex justify-between"><strong className="text-slate-800">เลขที่เอกสาร:</strong> <span>{job.ref_no}</span></p>
            <p className="flex justify-between"><strong className="text-slate-800">วันที่ทำรายการ:</strong> <span>{new Date(job.created_at).toLocaleDateString('th-TH')}</span></p>
            <p className="flex justify-between"><strong className="text-slate-800">ช่องทางรับเครื่อง:</strong> <span>{job.receive_method || 'Store-in'}</span></p>
          </div>
        </div>

        {/* 📱 ตารางรายการสินค้า */}
        <div className={isB2B ? '' : 'min-h-[300px]'}>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[10px] uppercase tracking-widest">
                <th className="py-2 px-3 w-10 text-center border border-slate-900">#</th>
                <th className="py-2 px-3 border border-slate-900">{isB2B ? 'รุ่น / IMEI / เกรด' : 'รายการสินค้า (Description)'}</th>
                <th className="py-2 px-3 border border-slate-900 text-right w-28">ราคา</th>
              </tr>
            </thead>
            <tbody className={isB2B ? 'text-[11px]' : 'text-sm'}>
              {lineItems.map((device: any, idx: number) => (
                <tr key={idx} className="border-b border-slate-200 align-top">
                  <td className={`${isB2B ? 'py-1.5 px-3' : 'py-4 px-4'} text-center font-bold text-slate-400 border-x border-slate-200`}>{idx + 1}</td>
                  <td className={`${isB2B ? 'py-1.5 px-3' : 'py-4 px-4'} border-x border-slate-200`}>
                    {isB2B ? (
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-black text-slate-800">{device.model || '-'}</span>
                        {device.imei && <span className="text-[10px] font-mono text-slate-500">IMEI: {device.imei}</span>}
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${device.grade === 'A' ? 'bg-emerald-100 text-emerald-700' : device.grade === 'B' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{device.grade}</span>
                      </div>
                    ) : (
                      <>
                        <p className="font-black text-slate-800 text-base">{device.model || '-'}</p>
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">หมายเหตุสภาพเครื่อง:</p>
                          {device.isNewDevice ? (
                            <p className="text-[11px] text-slate-600 flex items-center gap-1">- เครื่องใหม่มือ 1 (ยังไม่แกะซีล)</p>
                          ) : (
                            (device.deductions || job.deductions || []).map((d: string, i: number) => (
                              <p key={i} className="text-[11px] text-slate-600">- {d.replace(/^\[(.*?)\]\s*(.*)$/, '$1: $2')}</p>
                            ))
                          )}
                          {!(device.deductions || job.deductions || [])?.length && !device.isNewDevice && (
                            <p className="text-[11px] text-emerald-600 font-bold">- สภาพสมบูรณ์ 100%</p>
                          )}
                        </div>
                      </>
                    )}
                  </td>
                  <td className={`${isB2B ? 'py-1.5 px-3' : 'py-4 px-4'} text-right font-black text-slate-800 border-x border-slate-200`}>
                    {formatCurrency(device.final_price || device.estimated_price || (isB2B ? 0 : job.price))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 💰 สรุปยอดเงิน + ลายเซ็น (ไม่ให้แตกหน้ากลางคัน) */}
        {isB2B && <div className="mt-12 pt-6 border-t border-slate-200 print:mt-6 print:pt-4"></div>}
        <div className="flex justify-end mt-6" style={isB2B ? { pageBreakInside: 'avoid', breakInside: 'avoid' } : undefined}>
          <div className="w-1/2">
            {job.applied_coupon && (
              <div className="flex justify-between items-center py-2 border-b border-slate-100 text-sm">
                <span className="font-bold text-slate-500">คูปองเพิ่มมูลค่า ({job.applied_coupon.code})</span>
                <span className="font-black text-emerald-600">+{formatCurrency(job.applied_coupon.value)}</span>
              </div>
            )}
            <div className="flex justify-between items-center py-4 text-xl">
              <span className="font-black text-slate-800 uppercase tracking-widest">ยอดรับซื้อสุทธิ (Net Total)</span>
              <span className="font-black text-blue-600 text-2xl">{formatCurrency(job.final_price || job.price)}</span>
            </div>
          </div>
        </div>

        {/* 🏦 ข้อมูลการโอนเงิน (ถ้ามี) */}
        {(job.payment_info || job.bank_account) && (
          <div className="mt-8 p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 inline-block w-1/2">
            <p className="font-black text-slate-800 mb-1 uppercase text-xs tracking-widest">ช่องทางการโอนเงิน</p>
            <p>ธนาคาร: {job.payment_info?.bank || job.bank_name}</p>
            <p>ชื่อบัญชี: {job.payment_info?.account_name || job.bank_holder}</p>
            <p>เลขบัญชี: {job.payment_info?.account_number || job.bank_account}</p>
          </div>
        )}

        {/* 📝 ลายเซ็น */}
        <div
          className={`${isB2B ? 'mt-12' : 'absolute bottom-12 left-12 right-12'} flex justify-between pt-10 border-t-2 border-slate-100`}
          style={isB2B ? { pageBreakInside: 'avoid', breakInside: 'avoid' } : undefined}
        >
          <div className="text-center w-56">
            <p className="text-[10px] text-slate-400 mb-12">ลงชื่อผู้ขาย (Seller)</p>
            <div className="border-b border-slate-400 w-full mb-2"></div>
            <p className="text-xs font-bold text-slate-800">{job.cust_name || '...........................................'}</p>
            <p className="text-[10px] text-slate-500 mt-1">วันที่ _______/_______/_______</p>
          </div>

          <div className="text-center w-56">
            <p className="text-[10px] text-slate-400 mb-12">ลงชื่อผู้รับซื้อ (Authorized Buyer)</p>
            <div className="border-b border-slate-400 w-full mb-2"></div>
            <p className="text-xs font-bold text-slate-800">{job.agent_name || '...........................................'}</p>
            <p className="text-[10px] text-slate-500 mt-1">วันที่ _______/_______/_______</p>
          </div>
        </div>

      </div>
    </div>
  );
};