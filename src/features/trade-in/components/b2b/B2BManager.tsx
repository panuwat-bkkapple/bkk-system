// src/features/trade-in/components/b2b/B2BManager.tsx
import React, { useState, useEffect } from 'react';
import {
  X, User, Phone, MapPin, CheckCircle2, AlertTriangle, ShieldCheck,
  Building2, FileText, Calculator, Lock, FileCheck2, Landmark,
  ArrowRight, Mail, ClipboardCheck, Wallet, Clock, PackageOpen, Smartphone, 
  ThumbsUp, ThumbsDown, MessageSquareText, ChevronLeft, History,
  MessageCircle, ExternalLink, Copy, Pencil, Save, CalendarClock, CalendarRange, Calendar
} from 'lucide-react';
import { ref, push, update } from 'firebase/database';
import { db } from '@/api/firebase';
import { formatDate, formatCurrency } from '@/utils/formatters';
import { AdminChatBox } from '@/components/Fleet/AdminChatBox';
import { useAuth } from '@/hooks/useAuth';

interface B2BManagerProps {
  job: any;
  onUpdateStatus: (id: string, status: string, log: string, data?: any) => void;
  onClose: () => void;
  basePricing: any[];
}

const SmartB2BPipeline = ({ status }: { status: string }) => {
  const s = String(status || '').toLowerCase();
  let currentStep = 0;
  
  if (['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(s)) currentStep = 1;
  else if (['site visit & grading', 'auditor assigned'].includes(s)) currentStep = 2;
  else if (['final quote sent', 'final quote accepted', 'negotiation'].includes(s)) currentStep = 3;
  else if (['po issued', 'waiting for invoice/tax inv.'].includes(s)) currentStep = 4;
  else if (['pending finance approval', 'payment completed'].includes(s)) currentStep = 5;
  else if (['in stock', 'completed'].includes(s)) currentStep = 6;
  else if (['cancelled', 'closed (lost)', 'returned'].includes(s)) currentStep = 0;

  const steps = [
    { num: 1, label: 'PRE-QUOTE' },
    { num: 2, label: 'INSPECT' },
    { num: 3, label: 'FINAL QUOTE' },
    { num: 4, label: 'DOCS' },
    { num: 5, label: 'FINANCE' },
    { num: 6, label: 'COMPLETED' }
  ];

  return (
    <div className="flex items-start justify-between w-full pt-2 pb-6">
       {steps.map((step, index) => {
          const isCompleted = currentStep > step.num;
          const isActive = currentStep === step.num;
          
          return (
            <React.Fragment key={step.num}>
               <div className="relative flex flex-col items-center z-10 shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-300 ${isCompleted ? 'bg-indigo-500 text-white' : isActive ? 'bg-indigo-700 text-white shadow-lg shadow-indigo-200 ring-4 ring-indigo-50' : 'bg-slate-200 text-slate-400'}`}>
                    {isCompleted ? <CheckCircle2 size={16}/> : step.num}
                  </div>
                  <span className={`absolute top-10 text-[8px] w-16 text-center font-black uppercase tracking-widest leading-tight ${isActive ? 'text-indigo-700' : isCompleted ? 'text-indigo-500' : 'text-slate-400'}`}>
                    {step.label}
                  </span>
               </div>
               {index < steps.length - 1 && (
                 <div className="flex-1 h-[2px] mx-1 bg-slate-200 relative mt-4">
                    <div className={`absolute top-0 left-0 h-full bg-indigo-500 transition-all duration-500 ${isCompleted ? 'w-full' : 'w-0'}`}></div>
                 </div>
               )}
            </React.Fragment>
          )
       })}
    </div>
  );
};

export const B2BManager = ({ job, onUpdateStatus, onClose, basePricing }: B2BManagerProps) => {
  const { currentUser } = useAuth();
  
  const [b2bGrandTotal, setB2bGrandTotal] = useState(job?.price ? Number(Number(job.price).toFixed(2)) : 0);
  const [poNumber, setPoNumber] = useState(job?.documents?.po_number || '');
  const [invoiceNumber, setInvoiceNumber] = useState(job?.documents?.invoice_number || '');
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState(job?.documents?.tax_invoice_number || '');
  const [b2bPriceReason, setB2bPriceReason] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [activeChatJobId, setActiveChatJobId] = useState<string | null>(null);

  const [expectedItems, setExpectedItems] = useState<any[]>(job?.expected_items || []);
  const [expModel, setExpModel] = useState('');
  const [expQty, setExpQty] = useState(1);
  const [expPrice, setExpPrice] = useState(0);

  // 🌟 State สำหรับ Due Dates
  const [quoteExpiryDate, setQuoteExpiryDate] = useState(job?.quote_expiry_date || '');
  const [siteVisitDate, setSiteVisitDate] = useState(job?.site_visit_date || '');
  const [paymentDueDate, setPaymentDueDate] = useState(job?.payment_due_date || '');

  const [printMode, setPrintMode] = useState<'none' | 'master_cert'>('none');

  const [isEditingCompany, setIsEditingCompany] = useState(false);
  const [editCompanyData, setEditCompanyData] = useState({
    companyName: job?.cust_name?.split('(')[0]?.trim() || job?.cust_name || '',
    contactName: job?.cust_name?.split('(')[1]?.replace(')', '')?.trim() || '',
    phone: job?.cust_phone || '',
    email: job?.cust_email || '',
    address: job?.cust_address || '',
    assetDetails: job?.asset_details || ''
  });

  useEffect(() => {
    const handleAfterPrint = () => setPrintMode('none');
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  useEffect(() => {
    if (job?.expected_items) setExpectedItems(job.expected_items);
    if (job?.price > 0 && b2bGrandTotal === 0) setB2bGrandTotal(job.price);
  }, [job, b2bGrandTotal]);

  const triggerPrintMasterCert = () => {
    setPrintMode('master_cert');
    setTimeout(() => window.print(), 800);
  };

  const preQuoteTotal = expectedItems.reduce((sum: number, item: any) => sum + (item.qty * item.unit_price), 0);
  const gradedItems = job?.graded_items || [];
  const validItems = gradedItems.filter((i: any) => i.grade !== 'Reject');
  const rejectItemsCount = gradedItems.length - validItems.length;

  const b2bPriceExVat = b2bGrandTotal * (100 / 107);
  const vatAmount = b2bGrandTotal - b2bPriceExVat;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('คัดลอกลิงก์เรียบร้อยแล้ว');
  };

  // Auto-Save สำหรับ Dates ทันทีที่เลือก
  const handleSaveDate = async (field: string, val: string) => {
    try {
      await update(ref(db, `jobs/${job.id}`), { [field]: val, updated_at: Date.now() });
    } catch (e) {
      console.error("Error saving date:", e);
    }
  };

  const handleSaveNotes = async () => {
    if (!callNotes.trim()) return;
    onUpdateStatus(job.id, job.status, callNotes);
    setCallNotes('');
  };

  const handleCallCustomer = async () => {
    if (!job?.cust_phone) return alert('ไม่พบเบอร์โทรศัพท์ลูกค้า');
    window.location.href = `tel:${job.cust_phone}`;
    if (String(job.status).toLowerCase() === 'new b2b lead') {
      onUpdateStatus(job.id, 'Following Up', 'แอดมินโทรติดต่อลูกค้าองค์กรเพื่อยืนยันข้อมูลและเตรียมเสนอราคา');
    }
  };

  const handleSaveCompanyInfo = async () => {
    if (!editCompanyData.companyName.trim()) return alert("กรุณาระบุชื่อบริษัท");
    const newCustName = editCompanyData.contactName ? `${editCompanyData.companyName} (${editCompanyData.contactName})` : editCompanyData.companyName;
    try {
      await update(ref(db, `jobs/${job.id}`), {
        cust_name: newCustName, cust_phone: editCompanyData.phone, cust_email: editCompanyData.email,
        cust_address: editCompanyData.address, asset_details: editCompanyData.assetDetails, updated_at: Date.now()
      });
      onUpdateStatus(job.id, job.status, "แอดมินแก้ไขข้อมูลบริษัท/ผู้ติดต่อ");
      setIsEditingCompany(false);
      alert("บันทึกข้อมูลบริษัทสำเร็จ");
    } catch (error) { alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล"); }
  };

  const handleAddExpectedItem = async () => {
    if (!expModel || expQty <= 0 || expPrice <= 0) return alert('กรุณากรอกรุ่น จำนวน และราคาประเมินให้ครบถ้วน');
    const newItem = { id: Date.now().toString(), model: expModel, qty: expQty, unit_price: expPrice };
    const updatedExpected = [...expectedItems, newItem];
    const newTotal = updatedExpected.reduce((sum: number, item: any) => sum + (item.qty * item.unit_price), 0);

    try {
      await update(ref(db, `jobs/${job.id}`), {
        expected_items: updatedExpected, price: (!job.price || job.price === 0) ? newTotal : job.price
      });
      setExpectedItems(updatedExpected);
      if (!job.price || job.price === 0) setB2bGrandTotal(newTotal);
      setExpModel(''); setExpQty(1); setExpPrice(0);
    } catch (error) { alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล'); }
  };

  const handleRemoveExpectedItem = async (id: string) => {
    const updatedExpected = expectedItems.filter((i: any) => i.id !== id);
    await update(ref(db, `jobs/${job.id}`), { expected_items: updatedExpected });
    setExpectedItems(updatedExpected);
  };

  const handleB2BAction = async (actionType: string) => {
    switch (actionType) {
      case 'send_pre_quote':
        if (expectedItems.length === 0) return alert('กรุณาเพิ่มรายการสินค้าใน Pre-Quote Builder ก่อนครับ');
        if (!quoteExpiryDate) return alert('กรุณากำหนดวันหมดอายุใบเสนอราคา (Quote Validity) ก่อนส่งครับ'); // 🌟 ล็อค Due Date
        onUpdateStatus(job.id, 'Pre-Quote Sent', `ส่งใบเสนอราคาเบื้องต้น (หมดอายุ: ${quoteExpiryDate})`, { price: preQuoteTotal, quote_expiry_date: quoteExpiryDate });
        break;
      case 'accept_pre_quote':
        onUpdateStatus(job.id, 'Pre-Quote Accepted', 'ลูกค้ายอมรับราคาเบื้องต้น เตรียมเข้าสู่ขั้นตอนนัดหมายหน้างาน');
        break;
      case 'dispatch_inspector':
        if (!siteVisitDate) return alert('กรุณากำหนดวัน-เวลานัดหมายหน้างาน (Site Visit Schedule) ก่อนจ่ายงานครับ'); // 🌟 ล็อค Due Date
        onUpdateStatus(job.id, 'Site Visit & Grading', `จ่ายงานให้ทีม Inspector ประเมินหน้างานวันที่ ${formatDate(new Date(siteVisitDate).getTime())}`, { site_visit_date: siteVisitDate });
        break;
      case 'send_final_quote':
        if (b2bGrandTotal <= 0) return alert('ระบบล็อค: กรุณาระบุยอดรวมสุทธิให้ถูกต้อง');
        if (validItems.length === 0) return alert('ระบบล็อค: ทีมงานยังไม่ได้ประเมินเกรดหน้างาน หรือไม่มีเครื่องที่ผ่านเกณฑ์');
        if (!quoteExpiryDate) return alert('กรุณากำหนดวันหมดอายุใบเสนอราคา (Quote Validity) ก่อนส่งครับ');
        onUpdateStatus(job.id, 'Final Quote Sent', `ส่งใบเสนอราคาจริง (ยอดสุทธิ: ฿${b2bGrandTotal.toLocaleString()}) สำหรับ ${validItems.length} เครื่อง`, { price: b2bGrandTotal, ex_vat: b2bPriceExVat, vat_amount: vatAmount });
        break;
      case 'accept_final_quote':
        onUpdateStatus(job.id, 'Final Quote Accepted', 'ลูกค้ายอมรับยอดประเมินจริง เตรียมออกเอกสารสั่งซื้อ (PO)');
        break;
      case 'enter_negotiation':
        onUpdateStatus(job.id, 'Negotiation', 'ลูกค้าขอต่อรองราคา เข้าสู่โหมดเจรจาพิเศษ');
        break;
      case 'issue_po':
        if (!poNumber) return alert('ระบบล็อค: กรุณากรอกเลขที่ P.O. ฝั่งเราในกล่องเอกสารซ้ายมือก่อนครับ');
        onUpdateStatus(job.id, 'PO Issued', `บริษัทออกเอกสาร PO เลขที่ ${poNumber} เรียบร้อยแล้ว`, { documents: { ...job.documents, po_number: poNumber } });
        break;
      case 'wait_invoice':
        onUpdateStatus(job.id, 'Waiting for Invoice/Tax Inv.', 'รอลูกค้าองค์กรส่ง Invoice และใบกำกับภาษีมาวางบิล');
        break;
      case 'submit_to_finance':
        if (!invoiceNumber) return alert('กรุณาระบุเลขที่ Invoice ของลูกค้าก่อนส่งเรื่องตั้งเบิกครับ');
        if (!paymentDueDate) return alert('กรุณากำหนด Payment Due Date ในคลังเอกสารให้บัญชีทราบกำหนดโอนก่อนครับ'); // 🌟 ล็อค Due Date
        onUpdateStatus(job.id, 'Pending Finance Approval', `แอดมินส่งเรื่องตั้งเบิกยอด ฿${b2bGrandTotal.toLocaleString()} ให้ฝ่ายบัญชี (กำหนดจ่าย: ${paymentDueDate})`, { finance_status: 'Waiting for Transfer', payment_due_date: paymentDueDate, documents: { ...job.documents, po_number: poNumber, invoice_number: invoiceNumber, tax_invoice_number: taxInvoiceNumber } });
        break;
      case 'unpack_to_stock':
        if (!taxInvoiceNumber) return alert('ระบบล็อค: ไม่สามารถรับเข้าคลังได้หากไม่มีเลขใบกำกับภาษี (Tax Invoice)');
        if (validItems.length === 0) return alert('ระบบล็อค: ไม่พบรายการเครื่องที่ประเมินไว้');
        if (!confirm(`ยืนยันการรับเครื่องเข้าคลัง? ระบบจะสร้างคิว QC จำนวน ${validItems.length} เครื่องอัตโนมัติ`)) return;

        onUpdateStatus(job.id, 'Completed', 'ระเบิดกล่องและกระจายเครื่องเข้าคลังสำเร็จ (สิ้นสุดงานแอดมิน B2B)');

        try {
          const promises = validItems.map((item: any, index: number) => {
            const childPayload = {
              ref_no: `${job.ref_no}-U${String(index + 1).padStart(3, '0')}`,
              type: 'B2B-Unpacked', model: item.model, price: item.price, pre_grade: item.grade,
              status: 'Pending QC', receive_method: 'Corporate Bulk', cust_name: `[Corporate] ${job.cust_name.split('(')[0]}`,
              imei: item.imei || '', serial: item.imei || '', created_at: Date.now(), updated_at: Date.now(),
              agent_name: job.agent_name || 'Admin', parent_b2b_id: job.id, 
              qc_logs: [{ action: 'Sent to QC Lab', details: `ระเบิดกล่องจากล็อต B2B (${job.ref_no}) รอกระบวนการ Test & Data Wipe`, timestamp: Date.now(), by: 'System' }]
            };
            return push(ref(db, 'jobs'), childPayload);
          });
          await Promise.all(promises);
          alert(`🎉 ปิดจ๊อบเหมา! ส่งเครื่องลูก ${validItems.length} เครื่องเข้าห้อง QC เรียบร้อยแล้วครับ`);
          onClose();
        } catch (error) { console.error("Error unpacking:", error); }
        break;
    }
  };

  if (!job) return null;

  const statusLower = String(job.status || '').toLowerCase();
  const isCancelled = ['cancelled', 'closed (lost)', 'returned'].includes(statusLower);

  return (
    <div className="fixed inset-0 bg-[#F1F5F9] flex flex-col z-[9999] overflow-hidden animate-in fade-in duration-300">
      
      {/* 🔝 Global Header */}
      <div className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-500">
            <ChevronLeft size={24} />
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight">Corporate Trade-in</h1>
            <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest">{job.ref_no}</span>
            {isCancelled && <span className="bg-red-100 text-red-600 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest">CANCELLED</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 bg-slate-50 px-5 py-2 rounded-full border border-slate-100">
           <Building2 size={16} className="text-indigo-500" />
           <span className="text-xs font-black text-slate-700">{job.cust_name.split('(')[0]}</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        {/* ⬅️ LEFT SIDE: ข้อมูล & เอกสาร */}
        <div className="flex-1 overflow-y-auto p-8 no-scrollbar pb-24">
          <div className="max-w-5xl mx-auto space-y-6">

            {/* 1. Company Details Card */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6 relative">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
                  <Building2 className="text-indigo-500" size={20}/> 1. Company Information
                </h3>
                {!isEditingCompany && !isCancelled && (
                  <button onClick={() => setIsEditingCompany(true)} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors">
                    <Pencil size={14} /> แก้ไขข้อมูล
                  </button>
                )}
              </div>

              {isEditingCompany ? (
                <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 space-y-4 animate-in fade-in">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Company Name</label><input type="text" value={editCompanyData.companyName} onChange={e=>setEditCompanyData({...editCompanyData, companyName: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
                    <div><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Contact Person</label><input type="text" value={editCompanyData.contactName} onChange={e=>setEditCompanyData({...editCompanyData, contactName: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
                    <div><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Phone</label><input type="text" value={editCompanyData.phone} onChange={e=>setEditCompanyData({...editCompanyData, phone: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
                    <div><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Email</label><input type="email" value={editCompanyData.email} onChange={e=>setEditCompanyData({...editCompanyData, email: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
                    <div className="col-span-2"><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Address</label><input type="text" value={editCompanyData.address} onChange={e=>setEditCompanyData({...editCompanyData, address: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
                    <div className="col-span-2"><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Asset Details</label><textarea value={editCompanyData.assetDetails} onChange={e=>setEditCompanyData({...editCompanyData, assetDetails: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400 min-h-[80px]" /></div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button onClick={() => setIsEditingCompany(false)} className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-200 transition-colors">ยกเลิก</button>
                    <button onClick={handleSaveCompanyInfo} className="px-6 py-2.5 rounded-xl text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 flex items-center gap-2 shadow-sm transition-transform active:scale-95"><Save size={14}/> บันทึกข้อมูล</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-6">
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">ผู้ติดต่อ</label><div className="font-black text-slate-800 flex items-center gap-2"><User size={16} className="text-indigo-500" />{job.cust_name.split('(')[1]?.replace(')', '') || job.cust_name}</div></div>
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">เบอร์โทรศัพท์</label><div className="font-black text-blue-600 flex items-center gap-2"><Phone size={16} />{job.cust_phone}</div></div>
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">อีเมล</label><div className="font-black text-slate-800 flex items-center gap-2"><Mail size={16} className="text-indigo-500" />{job.cust_email || '-'}</div></div>
                    {job.cust_address && <div className="col-span-3 bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">ที่อยู่องค์กร</label><div className="text-sm font-bold text-slate-700 flex items-center gap-2"><MapPin size={16} className="text-indigo-500"/> {job.cust_address}</div></div>}
                    <div className="col-span-3 bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">รายละเอียดทรัพย์สิน (แจ้งเบื้องต้น)</label><div className="text-sm font-bold text-slate-700">{job.asset_details || 'ระบุยกล็อต (ดูไฟล์แนบ)'}</div></div>
                  </div>
                  <div className="pt-2">
                    <button onClick={() => copyToClipboard(`http://localhost:3000/quote/${job.id}`)} className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-indigo-500 uppercase tracking-widest transition-colors"><Copy size={14} /> คัดลอกลิงก์ให้ลูกค้าติดตามสถานะ (Tracking Link)</button>
                  </div>
                </>
              )}
            </div>

            {/* 2. Pre-Quote Builder Card */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
                  <ClipboardCheck className="text-indigo-500" size={20}/> 2. Pre-Quote Builder (เสนอราคาเบื้องต้น)
                </h3>
              </div>
              
              <div className="bg-amber-50/50 p-6 rounded-3xl border border-amber-100">
                
                {/* 🌟 1. DUE DATE: Quote Validity */}
                <div className="flex items-center gap-3 mb-6 bg-white p-4 rounded-2xl border border-amber-200 shadow-sm w-fit">
                   <CalendarClock size={18} className="text-amber-500"/>
                   <label className="text-xs font-black text-amber-800 uppercase tracking-widest">Quote Validity (ใช้ได้ถึงวันที่):</label>
                   <input type="date" value={quoteExpiryDate} disabled={isCancelled}
                     onChange={e => { setQuoteExpiryDate(e.target.value); handleSaveDate('quote_expiry_date', e.target.value); }} 
                     className="bg-amber-50 border border-amber-200 text-amber-900 font-bold px-3 py-1.5 rounded-lg outline-none focus:border-amber-500" 
                   />
                </div>

                {['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(statusLower) && !isCancelled && (
                  <div className="flex gap-4 mb-6 items-end">
                    <div className="flex-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-amber-700 block mb-2">รุ่น / อุปกรณ์ (Model)</label>
                      <select 
                        value={expModel} 
                        onChange={(e) => {
                          const selectedName = e.target.value; setExpModel(selectedName);
                          let foundPrice = 0;
                          for (const model of basePricing) {
                            if (model.variants && model.variants.length > 0) {
                              const matchedVariant = model.variants.find((v: any) => `${model.name} ${v.name}`.trim() === selectedName);
                              if (matchedVariant) { foundPrice = Number(matchedVariant.usedPrice || matchedVariant.price || matchedVariant.newPrice || 0); break; }
                            } else {
                              if (model.name === selectedName) { foundPrice = Number(model.price || 0); break; }
                            }
                          }
                          setExpPrice(foundPrice);
                        }}
                        className="w-full bg-white border border-amber-200 p-4 rounded-xl font-bold text-sm outline-none focus:border-amber-500 shadow-sm"
                      >
                        <option value="">-- เลือกรุ่นและความจุ --</option>
                        {basePricing?.map((model: any) => {
                          if (model.variants && model.variants.length > 0) {
                            return model.variants.map((v: any) => <option key={`${model.id}-${v.id}`} value={`${model.name} ${v.name}`.trim()}>{`${model.name} ${v.name}`.trim()}</option>);
                          } else {
                            return <option key={model.id} value={model.name}>{model.name}</option>;
                          }
                        })}
                      </select>
                    </div>
                    <div className="w-32"><label className="text-[10px] font-black uppercase tracking-widest text-amber-700 block mb-2">จำนวน (Qty)</label><input type="number" value={expQty} onChange={e => setExpQty(Number(e.target.value))} className="w-full bg-white border border-amber-200 p-4 rounded-xl font-black text-sm outline-none text-center shadow-sm focus:border-amber-500" /></div>
                    <div className="w-48"><label className="text-[10px] font-black uppercase tracking-widest text-amber-700 block mb-2">ราคา/เครื่อง (Unit)</label><input type="number" value={expPrice || ''} onChange={e => setExpPrice(Number(e.target.value))} className="w-full bg-white border border-amber-200 p-4 rounded-xl font-black text-sm outline-none shadow-sm focus:border-amber-500 text-right" /></div>
                    <button onClick={handleAddExpectedItem} className="bg-amber-500 text-white px-8 py-4 rounded-xl font-black text-xs uppercase hover:bg-amber-600 shadow-sm transition-colors active:scale-95">Add</button>
                  </div>
                )}

                {expectedItems.length > 0 ? (
                  <div className="bg-white border border-amber-200 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-amber-50/80 border-b border-amber-100 text-amber-800">
                        <tr>
                          <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px]">รุ่น / สินทรัพย์ (Asset)</th>
                          <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-center">จำนวน</th>
                          <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-right">ราคา/เครื่อง</th>
                          <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-right">รวม (Subtotal)</th>
                          {['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(statusLower) && <th className="w-12"></th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-50">
                        {expectedItems.map((item: any) => (
                          <tr key={item.id}>
                            <td className="py-4 px-6 font-bold text-slate-800">{item.model}</td>
                            <td className="py-4 px-6 text-center font-black text-indigo-600 bg-indigo-50/30">{item.qty}</td>
                            <td className="py-4 px-6 text-right text-slate-600 font-medium">฿{item.unit_price.toLocaleString()}</td>
                            <td className="py-4 px-6 text-right font-black text-emerald-600 bg-emerald-50/30">฿{(item.qty * item.unit_price).toLocaleString()}</td>
                            {['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(statusLower) && (
                              <td className="py-4 px-2 text-center"><button onClick={() => handleRemoveExpectedItem(item.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><X size={16} /></button></td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-amber-100/50 border-t border-amber-200">
                        <tr>
                          <td colSpan={3} className="py-4 px-6 text-right font-black text-[11px] text-amber-800 uppercase tracking-widest">ยอดประเมินเบื้องต้น (Pre-Quote Total)</td>
                          <td className="py-4 px-6 text-right font-black text-2xl text-amber-600">฿{preQuoteTotal.toLocaleString()}</td>
                          {['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(statusLower) && <td></td>}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-amber-400">
                    <ClipboardCheck size={32} className="mb-2 opacity-50"/>
                    <p className="text-xs font-bold">ยังไม่มีการคีย์รายการเบื้องต้น</p>
                  </div>
                )}
              </div>
            </div>

            {/* 3. On-Site Auditor Summary Card */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
                  <Smartphone className="text-indigo-500" size={20}/> 3. On-Site Auditor Summary (ผลตรวจหน้างาน)
                </h3>
              </div>

              <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100">
                
                {/* 🌟 2. DUE DATE: Site Visit Schedule */}
                <div className="flex items-center gap-3 mb-6 bg-white p-4 rounded-2xl border border-indigo-200 shadow-sm w-fit">
                   <CalendarRange size={18} className="text-indigo-500"/>
                   <label className="text-xs font-black text-indigo-800 uppercase tracking-widest">Site Visit Schedule (เวลานัดหมายเข้าประเมิน):</label>
                   <input type="datetime-local" value={siteVisitDate} disabled={isCancelled}
                     onChange={e => { setSiteVisitDate(e.target.value); handleSaveDate('site_visit_date', e.target.value); }} 
                     className="bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold px-3 py-1.5 rounded-lg outline-none focus:border-indigo-500" 
                   />
                </div>

                <div className="flex items-center justify-between mb-6">
                  <div>
                    <div className="text-sm font-black text-slate-800 mb-1">รายการสแกน IMEI และประเมินเกรด</div>
                    {gradedItems.length > 0 ? (
                      <div className="text-xs font-bold text-slate-600 flex items-center gap-3 mt-2">
                        <span className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-200">ผ่านเกณฑ์ (Accepted): {validItems.length} เครื่อง</span>
                        {rejectItemsCount > 0 && <span className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg border border-red-200">ตีคืน (Reject): {rejectItemsCount} เครื่อง</span>}
                      </div>
                    ) : (
                      <div className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mt-2 flex items-center gap-2 bg-indigo-100/50 px-3 py-1.5 rounded-lg inline-flex"><Clock size={14} className="animate-pulse"/> Waiting for Inspection Scan</div>
                    )}
                  </div>
                  <div className="text-right bg-white px-6 py-4 rounded-2xl shadow-sm border border-indigo-50">
                    <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">ยอดรวมจากหน้างาน</div>
                    <div className="text-3xl font-black text-indigo-600">฿{(job.price || 0).toLocaleString()}</div>
                  </div>
                </div>

                {gradedItems.length > 0 && (
                  <div className="border border-indigo-100 rounded-2xl overflow-hidden bg-white shadow-sm">
                    <div className="max-h-80 overflow-y-auto no-scrollbar">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px]">IMEI / S/N</th>
                            <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px]">Model</th>
                            <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-center">Grade</th>
                            <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-right">Price</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {gradedItems.map((item: any, idx: number) => (
                            <tr key={item.id || idx} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-3 px-6 font-mono text-slate-500 font-bold text-xs">{item.imei}</td>
                              <td className="py-3 px-6 font-bold text-slate-800">{item.model}</td>
                              <td className="py-3 px-6 text-center">
                                <span className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${item.grade === 'A' ? 'bg-emerald-100 text-emerald-700' : item.grade === 'B' ? 'bg-indigo-100 text-indigo-700' : item.grade === 'C' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>{item.grade}</span>
                              </td>
                              <td className="py-3 px-6 text-right font-black text-slate-700 bg-slate-50/50">{item.grade === 'Reject' ? '-' : `฿${item.price.toLocaleString()}`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Calculator & Tax Card */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6">
              <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-4">
                <Calculator className="text-indigo-500" size={20}/> 4. Final Valuation & Tax (สรุปราคาและภาษี)
              </h3>
              <div className="bg-emerald-50/50 p-8 rounded-3xl border border-emerald-100">
                <div className="flex flex-col gap-6 mb-6">
                  <div className="flex items-center gap-6">
                    <label className="w-1/3 text-sm font-black uppercase text-emerald-800 tracking-wider">ยอดรวมสุทธิ (Inc. VAT):</label>
                    <div className="relative flex-1">
                      <span className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-600 font-black text-xl">฿</span>
                      <input
                        type="number"
                        value={b2bGrandTotal}
                        onChange={(e) => setB2bGrandTotal(Number(e.target.value))}
                        disabled={['po issued', 'waiting for invoice/tax inv.', 'pending finance approval', 'payment completed', 'completed', 'in stock'].includes(statusLower) || isCancelled}
                        className="w-full pl-12 p-5 bg-white border-2 border-emerald-200 rounded-2xl font-black text-3xl text-emerald-700 outline-none focus:border-emerald-500 disabled:opacity-70 disabled:bg-slate-50 transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  {b2bGrandTotal !== (job?.price || 0) && (
                    <div className="flex gap-3 animate-in slide-in-from-top-2 ml-[33%] bg-amber-50 p-4 rounded-2xl border border-amber-200">
                      <input type="text" placeholder="ระบุเหตุผลที่ปรับราคา (เช่น Negotiation)..." value={b2bPriceReason} onChange={(e) => setB2bPriceReason(e.target.value)} className="flex-1 bg-white border border-amber-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-amber-400 shadow-sm" />
                      <button onClick={() => {
                          if (!b2bPriceReason) return alert('กรุณาระบุเหตุผลการปรับราคา');
                          onUpdateStatus(job.id, job.status, `แอดมินปรับราคารวม (Inc. VAT) ใหม่เป็น ฿${b2bGrandTotal.toLocaleString()} (เหตุผล: ${b2bPriceReason})`, { price: b2bGrandTotal });
                          setB2bPriceReason('');
                          alert('บันทึกราคาเจรจาใหม่เรียบร้อยแล้ว');
                        }}
                        className="bg-amber-500 hover:bg-amber-600 text-white px-6 rounded-xl font-black text-xs uppercase shadow-sm transition-colors"
                      >
                        Update Price
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 pt-6 border-t border-emerald-200/60 ml-[33%]">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-500">มูลค่าเครื่อง (Ex-VAT):</label>
                    <div className="font-bold text-slate-700 text-lg">฿{b2bPriceExVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-500">ภาษีมูลค่าเพิ่ม (VAT 7%):</label>
                    <div className="font-bold text-slate-700 text-lg">฿{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 5. Document Vault Card */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6">
              <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-4">
                <FileCheck2 className="text-indigo-500" size={20}/> 5. Document Vault (คลังเอกสาร)
              </h3>
              
              {/* 🌟 3. DUE DATE: Payment Due Date */}
              <div className="flex items-center gap-3 mb-2 bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-sm w-fit">
                 <Calendar size={18} className="text-slate-500"/>
                 <label className="text-xs font-black text-slate-700 uppercase tracking-widest">Payment Due Date (กำหนดชำระเงิน):</label>
                 <input type="date" value={paymentDueDate} disabled={isCancelled}
                   onChange={e => { setPaymentDueDate(e.target.value); handleSaveDate('payment_due_date', e.target.value); }} 
                   className="bg-white border border-slate-200 text-slate-900 font-bold px-3 py-1.5 rounded-lg outline-none focus:border-slate-500" 
                 />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className={`p-6 rounded-2xl border flex flex-col gap-4 ${poNumber ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl ${poNumber ? 'bg-indigo-100 text-indigo-600' : 'bg-white shadow-sm text-slate-400'}`}><FileText size={20} /></div>
                    <div className="text-[10px] font-black text-slate-800 uppercase tracking-widest">Our P.O. Number <span className="text-red-500">*</span></div>
                  </div>
                  <input type="text" placeholder="ระบุเลขที่ใบสั่งซื้อ (Purchase Order)" value={poNumber} onChange={e => setPoNumber(e.target.value)} disabled={isCancelled} className="w-full p-4 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 outline-none font-black text-sm shadow-sm" />
                </div>

                <div className={`p-6 rounded-2xl border flex flex-col gap-4 ${invoiceNumber && taxInvoiceNumber ? 'bg-emerald-50/50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center gap-3">
                     <div className={`p-2.5 rounded-xl ${invoiceNumber && taxInvoiceNumber ? 'bg-emerald-100 text-emerald-600' : 'bg-white shadow-sm text-slate-400'}`}><Landmark size={20} /></div>
                     <div className="text-[10px] font-black text-slate-800 uppercase tracking-widest">Client Billing Docs <span className="text-red-500">*</span></div>
                  </div>
                  <div className="flex gap-3">
                    <input type="text" placeholder="Invoice No." value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} disabled={isCancelled} className="w-full p-4 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none font-black text-xs shadow-sm" />
                    <input type="text" placeholder="Tax Inv. No." value={taxInvoiceNumber} onChange={e => setTaxInvoiceNumber(e.target.value)} disabled={isCancelled} className="w-full p-4 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none font-black text-xs shadow-sm" />
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ➡️ RIGHT SIDEBAR: Action & Timeline */}
        <div className="w-[450px] bg-white border-l border-slate-200 flex flex-col shadow-2xl z-20 shrink-0">
          
          <div className="p-8 bg-slate-900 text-white relative shrink-0">
             <div className={`absolute top-0 right-0 w-40 h-40 blur-3xl rounded-full -mr-10 -mt-10 ${isCancelled ? 'bg-red-600/30' : 'bg-indigo-600/30'}`}></div>
             <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-2">ยอดรับซื้อเหมาสุทธิ (Total B2B Value)</p>
             <div className="flex items-baseline gap-2 relative z-10">
                <span className={`text-5xl font-black tracking-tighter ${isCancelled ? 'text-red-400 line-through' : 'text-white'}`}>{formatCurrency(b2bGrandTotal)}</span>
                <span className="text-xs font-bold text-slate-400">THB</span>
             </div>
          </div>

          <div className="p-6 bg-slate-50 border-b border-slate-200 shrink-0 shadow-inner">
             <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Corporate Pipeline</div>
             <SmartB2BPipeline status={job.status} />
             <div className="mt-2 text-center text-[10px] font-black text-indigo-700 uppercase tracking-widest bg-indigo-100/50 py-2.5 rounded-xl border border-indigo-200 shadow-sm">{job.status}</div>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar bg-slate-50">
             <div className="p-8 space-y-8">
              
              {!isCancelled && (
                <div className="space-y-4">
                  <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2"><ArrowRight size={14}/> Required Action</div>
                  
                  {['new b2b lead', 'following up'].includes(statusLower) && (
                     <div className="space-y-3">
                        <button onClick={handleCallCustomer} className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-md transition-all active:scale-95 flex justify-center items-center gap-2">
                           <Phone size={16}/> 1. โทรติดต่อลูกค้า (Follow Up)
                        </button>
                        <button onClick={() => handleB2BAction('send_pre_quote')} className={`w-full py-4 bg-slate-900 hover:bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all flex justify-center items-center gap-2 ${statusLower === 'new b2b lead' ? 'opacity-80' : ''}`}>
                           2. Send Pre-Quote <Lock size={14} className={quoteExpiryDate ? 'hidden' : 'block opacity-50'}/>
                        </button>
                     </div>
                  )}

                  {statusLower === 'pre-quote sent' && (
                    <div className="grid grid-cols-2 gap-3 animate-in zoom-in-95">
                      <button onClick={() => handleB2BAction('accept_pre_quote')} className="py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase flex flex-col items-center gap-2 shadow-md"><ThumbsUp size={20}/> ลูกค้ายอมรับ</button>
                      <button onClick={() => onUpdateStatus(job.id, 'Cancelled', 'ลูกค้าปฏิเสธราคาประเมินเบื้องต้น')} className="py-4 bg-white border border-red-100 hover:bg-red-50 text-red-500 rounded-xl font-black text-[10px] uppercase flex flex-col items-center gap-2 shadow-sm"><ThumbsDown size={20}/> ลูกค้าปฏิเสธ</button>
                    </div>
                  )}
                  {statusLower === 'pre-quote accepted' && <button onClick={() => handleB2BAction('dispatch_inspector')} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">2. Dispatch Inspector <Lock size={14} className={siteVisitDate ? 'hidden' : 'block opacity-50'}/></button>}

                  {['site visit & grading', 'auditor assigned'].includes(statusLower) && <button onClick={() => handleB2BAction('send_final_quote')} className="w-full py-4 bg-slate-900 hover:bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">3. Send Final Quote <FileText size={16}/></button>}

                  {statusLower === 'final quote sent' && (
                    <div className="space-y-3 animate-in slide-in-from-right-4">
                      <button onClick={() => handleB2BAction('accept_final_quote')} className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-md flex justify-center items-center gap-2"><CheckCircle2 size={16}/> ลค. ยอมรับราคา (Accept)</button>
                      <button onClick={() => handleB2BAction('enter_negotiation')} className="w-full py-3.5 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-2xl font-black text-[10px] uppercase tracking-widest flex justify-center items-center gap-2 shadow-sm"><MessageSquareText size={14}/> ลค. ขอต่อรอง (Negotiate)</button>
                    </div>
                  )}
                  {statusLower === 'negotiation' && (
                    <div className="p-5 bg-amber-50 border border-amber-200 rounded-3xl shadow-sm">
                      <div className="text-[10px] font-black text-amber-700 uppercase mb-4 text-center tracking-widest">⚠️ โหมดเจรจา (ปรับราคาในข้อ 4)</div>
                      <button onClick={() => handleB2BAction('accept_final_quote')} className="w-full py-3.5 bg-slate-900 text-white hover:bg-black rounded-xl font-black text-xs uppercase tracking-widest shadow-md">ตกลงราคาได้ (ปิดดีล)</button>
                    </div>
                  )}

                  {statusLower === 'final quote accepted' && (
                    <button onClick={() => handleB2BAction('issue_po')} className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2 ${poNumber ? 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                      {poNumber ? '4. Issue P.O.' : <><Lock size={16}/> ล็อก: ระบุ P.O. ซ้ายมือก่อน</>}
                    </button>
                  )}
                  {statusLower === 'po issued' && <button onClick={() => handleB2BAction('wait_invoice')} className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">Wait for Client Invoice <Clock size={16}/></button>}
                  {statusLower === 'waiting for invoice/tax inv.' && (
                    <button onClick={() => handleB2BAction('submit_to_finance')} className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2 ${invoiceNumber && paymentDueDate ? 'bg-slate-900 hover:bg-black text-white active:scale-95' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                      {invoiceNumber && paymentDueDate ? '5. Submit to Finance' : <><Lock size={16}/> ล็อก: รอ Invoice/Payment Date</>}
                    </button>
                  )}

                  {statusLower === 'pending finance approval' && (
                    <div className="p-6 bg-orange-50 border border-orange-200 rounded-3xl text-center shadow-sm">
                      <Clock size={40} className="mx-auto text-orange-400 mb-3 animate-pulse" />
                      <div className="font-black text-orange-800 text-sm uppercase tracking-widest">Pending Payment</div>
                      <div className="text-[10px] text-orange-600 mt-1 font-bold">รอฝ่ายบัญชี (Finance) ตรวจสอบและโอนเงิน</div>
                    </div>
                  )}

                  {statusLower === 'payment completed' && (
                    <button onClick={() => handleB2BAction('unpack_to_stock')} className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2 ${taxInvoiceNumber && validItems.length > 0 ? 'bg-purple-600 hover:bg-purple-700 text-white active:scale-95' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                      {taxInvoiceNumber ? <><PackageOpen size={18}/> 6. ระเบิดกล่องส่ง QC Lab</> : <><Lock size={16}/> ล็อก: รอเลข Tax Invoice</>}
                    </button>
                  )}
                  {['in stock', 'completed'].includes(statusLower) && (
                    <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-3xl text-center shadow-sm">
                      <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-3" />
                      <div className="font-black text-emerald-800 text-sm uppercase tracking-widest">B2B Deal Completed</div>
                      <div className="text-[10px] text-emerald-600 mt-1 font-bold mb-6">สร้างเครื่องลูกส่งเข้าคิว QC สำเร็จแล้ว</div>
                      <button onClick={triggerPrintMasterCert} className="w-full bg-slate-900 hover:bg-black text-white py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 active:scale-95"><ShieldCheck size={16}/> Print Certificate</button>
                    </div>
                  )}
                </div>
              )}

              {isCancelled && (
                <div className="p-6 bg-red-50 border border-red-200 rounded-3xl text-center shadow-sm">
                  <X size={40} className="mx-auto text-red-500 mb-3 p-2 bg-white rounded-full shadow-sm" />
                  <div className="font-black text-red-800 text-sm uppercase tracking-widest">Deal Cancelled</div>
                  <div className="text-[10px] text-red-600 mt-1 font-bold">ดีลรับซื้อเหมาถูกยกเลิก</div>
                  {job.cancel_reason && (
                    <div className="mt-4 p-4 bg-white border border-red-100 rounded-xl text-left"><div className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1">เหตุผล:</div><div className="text-xs font-bold text-red-700">{job.cancel_reason}</div></div>
                  )}
                </div>
              )}

              {/* Timeline */}
              <div className="pt-6 border-t border-slate-200">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><History size={14}/> Activity Timeline</div>
                <div className="space-y-4 relative before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200 ml-1">
                  {(job.qc_logs || []).map((log: any, i: number) => (
                    <div key={i} className="flex gap-4 relative">
                      <div className={`w-5 h-5 rounded-full border-[3px] border-[#F8FAFC] shadow-sm z-10 shrink-0 ${i === 0 ? 'bg-indigo-500' : 'bg-slate-300'}`}></div>
                      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm w-full">
                        <div className="flex items-center justify-between mb-1">
                          <p className={`text-[10px] font-black uppercase ${log.action === 'Cancelled' ? 'text-red-500' : 'text-slate-800'}`}>{log.action}</p>
                          <span className="text-[8px] font-black text-indigo-500 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded-md">BY: {log.by}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-bold mb-2">{log.details}</p>
                        <div className="border-t border-slate-100 pt-2 text-[8px] font-black text-slate-400 uppercase tracking-widest">{formatDate(log.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 🛑 Bottom Footer: ทางลัด, บันทึกภายใน และปุ่มยกเลิก */}
          <div className="p-6 bg-white border-t border-slate-200 z-10 shrink-0 space-y-4 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.05)]">
            
            <div className="flex gap-3">
               <button onClick={() => setActiveChatJobId(job.id)} className="flex-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase text-slate-600 transition-all">
                 <MessageCircle size={14} className="text-indigo-500" /> View Chats
               </button>
               <button onClick={() => window.open(`/invoice/${job.id}`, '_blank')} className="flex-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase text-slate-600 transition-all">
                 <ExternalLink size={14} /> Invoice
               </button>
            </div>

            <div className="flex gap-2">
              <input type="text" value={callNotes} onChange={e => setCallNotes(e.target.value)} placeholder="จดบันทึกภายใน..." className="flex-1 bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-xs font-bold outline-none focus:border-indigo-400" />
              <button onClick={handleSaveNotes} className="bg-slate-900 text-white px-5 rounded-xl text-[10px] font-black uppercase hover:bg-slate-800 transition-all">Save</button>
            </div>

            {!isCancelled && !['pending finance approval', 'payment completed', 'completed', 'in stock'].includes(statusLower) && (
              <button onClick={() => {
                  const reason = prompt('กรุณาระบุเหตุผลการยกเลิกดีล B2B:');
                  if(reason) onUpdateStatus(job.id, 'Cancelled', `ยกเลิกดีลรับซื้อเหมา (เหตุผล: ${reason})`, { cancel_reason: reason });
                }}
                className="w-full py-3 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
              >
                ยกเลิกดีล (Cancel B2B Deal)
              </button>
            )}
          </div>
        </div>
      </div>

      {activeChatJobId && (
        <div className="fixed inset-0 z-[100000]">
          <AdminChatBox jobId={activeChatJobId} onClose={() => setActiveChatJobId(null)} adminName={currentUser?.name || "Admin"} />
        </div>
      )}

      {/* Print Section (คงเดิม) */}
      {printMode === 'master_cert' && (
         <div className="fixed inset-0 bg-white z-[9999] flex justify-center items-start pt-10 print:pt-0 print:block print:static">
          <style>{`@media print { @page { size: A4 portrait; margin: 15mm; } body { visibility: hidden; background: white; } .master-cert-container { visibility: visible; position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
          <div className="master-cert-container w-[190mm] min-h-[270mm] bg-white p-10 flex flex-col font-sans text-black">
             {/* หัวกระดาษ */}
             <div className="flex justify-between items-center border-b-4 border-slate-900 pb-6 mb-8">
               <div><div className="flex items-center gap-3 mb-2"><ShieldCheck size={32} className="text-slate-900" /><h1 className="text-3xl font-black tracking-tighter uppercase text-slate-900">Certificate</h1></div><h2 className="text-lg font-black text-slate-700 uppercase tracking-widest">of Data Destruction</h2></div>
               <div className="text-right"><div className="font-mono text-sm font-black text-slate-600">REF: {job.ref_no}</div><div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">Date: {new Date().toLocaleDateString('en-GB')}</div></div>
             </div>
             {/* ข้อมูลลูกค้า */}
             <div className="mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-200 flex justify-between items-center">
               <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Corporate Client</p><h2 className="text-xl font-black text-slate-800">{job.cust_name.split('(')[0]}</h2><p className="text-xs font-bold text-slate-500 mt-1 flex items-center gap-2"><MapPin size={12} /> {job.cust_address || 'Head Office'}</p></div>
               <div className="text-right"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Devices Processed</p><div className="text-3xl font-black text-indigo-600">{validItems.length} <span className="text-sm text-slate-500">Units</span></div></div>
             </div>
             {/* คำประกาศ */}
             <div className="mb-8 text-sm text-slate-700 leading-relaxed font-medium text-justify">This document certifies that the data storage devices listed below have been securely erased and sanitized in accordance with industry-leading data destruction standards, including <strong>NIST 800-88 (Guidelines for Media Sanitization)</strong>. All user data, personal information, corporate profiles, and cloud-locks (e.g. iCloud/MDM) have been permanently removed and are irrecoverable.</div>
             {/* ตารางเครื่อง */}
             <div className="flex-1 mb-8">
               <table className="w-full text-left text-[11px] border-collapse">
                 <thead><tr className="bg-slate-900 text-white"><th className="py-2.5 px-3 font-bold uppercase tracking-wider border border-slate-800 w-12 text-center">No.</th><th className="py-2.5 px-3 font-bold uppercase tracking-wider border border-slate-800">Device Model</th><th className="py-2.5 px-3 font-bold uppercase tracking-wider border border-slate-800">IMEI / Serial Number</th><th className="py-2.5 px-3 font-bold uppercase tracking-wider border border-slate-800 text-center">Status</th></tr></thead>
                 <tbody>
                   {validItems.map((item: any, idx: number) => (
                     <tr key={item.id || idx} className="border-b border-slate-200"><td className="py-2 px-3 border-x border-slate-200 text-center font-bold text-slate-500">{idx + 1}</td><td className="py-2 px-3 border-x border-slate-200 font-bold text-slate-800">{item.model}</td><td className="py-2 px-3 border-x border-slate-200 font-mono font-bold text-slate-600">{item.imei}</td><td className="py-2 px-3 border-x border-slate-200 text-center font-black text-emerald-600 flex items-center justify-center gap-1"><CheckCircle2 size={12} /> WIPED</td></tr>
                   ))}
                 </tbody>
               </table>
             </div>
             {/* ลายเซ็น */}
             <div className="mt-auto pt-8 border-t-2 border-slate-100 flex justify-around">
               <div className="text-center w-56"><div className="h-16 border-b border-slate-300 mb-2"></div><p className="text-xs font-black text-slate-800 uppercase">Authorized Technician</p><p className="text-[10px] font-bold text-slate-400">QC Lab Operations</p></div>
               <div className="text-center w-56"><div className="h-16 border-b border-slate-300 mb-2"></div><p className="text-xs font-black text-slate-800 uppercase">Operations Manager</p><p className="text-[10px] font-bold text-slate-400">BKK System Co., Ltd.</p></div>
             </div>
             <div className="mt-8 text-center text-[9px] font-bold text-slate-400 uppercase tracking-widest">Confidential Corporate Document • Generated by BKK Trade-in Enterprise ERP</div>
          </div>
         </div>
      )}
    </div>
  );
};