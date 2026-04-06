// src/pages/admin/B2BDispatchQueue.tsx
// หน้าเตรียมรายการ B2B → เพิ่มรายการสินค้า → คิวรอ → ส่งงานไปให้ B2B Auditor Tool
import React, { useState, useMemo } from 'react';
import { useDatabase } from '@/hooks/useDatabase';
import { ref, update, push as fbPush } from 'firebase/database';
import { db } from '@/api/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/ToastProvider';
import {
  Building2, Package, Plus, X, Send, Clock,
  CheckCircle2, ClipboardCheck, CalendarClock,
  ScanLine, AlertCircle, FileText, Phone, PlusCircle
} from 'lucide-react';

export const B2BDispatchQueue = () => {
  const toast = useToast();
  const { currentUser } = useAuth();
  const { data: jobs, loading } = useDatabase('jobs');
  const { data: modelsData } = useDatabase('models');

  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [expModel, setExpModel] = useState('');
  const [expQty, setExpQty] = useState(1);
  const [expPrice, setExpPrice] = useState(0);
  const [siteVisitDate, setSiteVisitDate] = useState('');
  const [quoteExpiryDate, setQuoteExpiryDate] = useState('');

  // สร้างงาน B2B ใหม่
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCompany, setNewCompany] = useState('');
  const [newContact, setNewContact] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAssetDetails, setNewAssetDetails] = useState('');

  // กรอง B2B jobs ที่อยู่ในสถานะเตรียมงาน (ยังไม่ส่งไป auditor)
  const queueJobs = useMemo(() => {
    if (!jobs) return [];
    return (jobs as any[])
      .filter(j => j.type === 'B2B Trade-in' && ['New B2B Lead', 'Following Up', 'Pre-Quote Sent', 'Pre-Quote Accepted'].includes(j.status))
      .sort((a, b) => b.created_at - a.created_at);
  }, [jobs]);

  // งานที่ส่งไป auditor แล้ว
  const dispatchedJobs = useMemo(() => {
    if (!jobs) return [];
    return (jobs as any[])
      .filter(j => j.type === 'B2B Trade-in' && ['Site Visit & Grading', 'Auditor Assigned'].includes(j.status))
      .sort((a, b) => b.updated_at - a.updated_at);
  }, [jobs]);

  const currentJob = queueJobs.find(j => j.id === selectedJobId);
  const expectedItems: any[] = currentJob?.expected_items || [];
  const preQuoteTotal = expectedItems.reduce((sum: number, item: any) => sum + (item.qty * item.unit_price), 0);

  // Flatten models → variants สำหรับ dropdown
  const flattenedModels = useMemo(() => {
    const list = Array.isArray(modelsData) ? modelsData : [];
    const items: { id: string; name: string; price: number }[] = [];
    list.forEach((model: any) => {
      if (!model.name) return;
      if (model.isActive === false) return;
      const rawVariants = model.variants;
      const variants: any[] = !rawVariants ? [] : Array.isArray(rawVariants) ? rawVariants : Object.values(rawVariants);
      if (variants.length === 0) {
        items.push({ id: model.id, name: model.name, price: Number(model.price || 0) });
      } else {
        variants.forEach((v: any) => {
          if (!v) return;
          items.push({
            id: `${model.id}_${v.id || v.name}`,
            name: `${model.name} ${v.name || ''}`.trim(),
            price: Number(v.usedPrice || v.price || v.newPrice || 0),
          });
        });
      }
    });
    return items;
  }, [modelsData]);

  // เพิ่มรายการสินค้าใน expected_items
  const handleAddItem = async () => {
    if (!selectedJobId || !currentJob) { toast.warning('กรุณาเลือกล็อตงาน B2B ก่อนครับ'); return; }
    if (!expModel || expQty <= 0 || expPrice <= 0) { toast.warning('กรุณากรอกรุ่น จำนวน และราคาประเมินให้ครบถ้วน'); return; }

    const newItem = { id: Date.now().toString(), model: expModel, qty: expQty, unit_price: expPrice };
    const updatedItems = [...expectedItems, newItem];
    const newTotal = updatedItems.reduce((sum: number, item: any) => sum + (item.qty * item.unit_price), 0);

    try {
      await update(ref(db, `jobs/${selectedJobId}`), {
        expected_items: updatedItems,
        price: (!currentJob.price || currentJob.price === 0) ? newTotal : currentJob.price,
        updated_at: Date.now()
      });
      setExpModel(''); setExpQty(1); setExpPrice(0);
      toast.success('เพิ่มรายการสำเร็จ');
    } catch {
      toast.error('เพิ่มรายการล้มเหลว กรุณาลองใหม่');
    }
  };

  // ลบรายการ
  const handleRemoveItem = async (itemId: string) => {
    if (!confirm('ต้องการลบรายการนี้ใช่หรือไม่?')) return;
    const updatedItems = expectedItems.filter((i: any) => i.id !== itemId);
    try {
      await update(ref(db, `jobs/${selectedJobId}`), { expected_items: updatedItems, updated_at: Date.now() });
    } catch {
      toast.error('ลบรายการล้มเหลว');
    }
  };

  // ส่งงานไปให้ B2B Auditor
  const handleDispatchToAuditor = async () => {
    if (!selectedJobId || !currentJob) return;
    if (expectedItems.length === 0) { toast.warning('กรุณาเพิ่มรายการสินค้าก่อนส่งงานครับ'); return; }
    if (!siteVisitDate) { toast.warning('กรุณากำหนดวันนัดหมายหน้างานก่อนส่งครับ'); return; }
    if (!confirm(`ยืนยันส่งงาน ${currentJob.cust_name?.split('(')[0]} ไปให้ Auditor?`)) return;

    try {
      await update(ref(db, `jobs/${selectedJobId}`), {
        status: 'Site Visit & Grading',
        site_visit_date: siteVisitDate,
        quote_expiry_date: quoteExpiryDate || null,
        price: preQuoteTotal,
        updated_at: Date.now(),
        qc_logs: [
          { action: 'Site Visit & Grading', by: currentUser?.name || 'Admin', timestamp: Date.now(), details: `ส่งงานไป Auditor — นัดหมาย ${siteVisitDate} (${expectedItems.length} รายการ / ฿${preQuoteTotal.toLocaleString()})` },
          ...(currentJob.qc_logs || [])
        ]
      });
      toast.success('ส่งงานไปให้ Auditor เรียบร้อย!');
      setSelectedJobId('');
      setSiteVisitDate('');
      setQuoteExpiryDate('');
    } catch {
      toast.error('ส่งงานล้มเหลว กรุณาลองใหม่');
    }
  };

  // สร้างงาน B2B ใหม่
  const handleCreateB2BJob = async () => {
    if (!newCompany.trim()) { toast.warning('กรุณาระบุชื่อบริษัท'); return; }
    if (!newPhone.trim()) { toast.warning('กรุณาระบุเบอร์ติดต่อ'); return; }

    const custName = newContact ? `${newCompany} (${newContact})` : newCompany;
    try {
      const newRef = await fbPush(ref(db, 'jobs'), {
        cust_name: custName,
        cust_phone: newPhone,
        asset_details: newAssetDetails || '',
        type: 'B2B Trade-in',
        status: 'New B2B Lead',
        source: 'admin-b2b',
        price: 0,
        created_at: Date.now(),
        created_by: currentUser?.name || 'Admin',
        agent_name: currentUser?.name || 'Admin',
        agent_id: currentUser?.id || 'admin_1',
        is_read: true,
        ref_no: `OID-${Math.floor(100000 + Math.random() * 900000)}`,
        updated_at: Date.now(),
        qc_logs: [{
          action: 'New B2B Lead Created',
          by: currentUser?.name || 'Admin',
          timestamp: Date.now(),
          details: `สร้างดีล B2B — ${custName}`
        }]
      });
      toast.success('สร้างงาน B2B สำเร็จ!');
      setNewCompany(''); setNewContact(''); setNewPhone(''); setNewAssetDetails('');
      setShowCreateForm(false);
      if (newRef.key) setSelectedJobId(newRef.key);
    } catch {
      toast.error('สร้างงานล้มเหลว');
    }
  };

  // ส่งใบเสนอราคาเบื้องต้น (Pre-Quote)
  const handleSendPreQuote = async () => {
    if (!selectedJobId || !currentJob) return;
    if (expectedItems.length === 0) { toast.warning('กรุณาเพิ่มรายการสินค้าก่อนส่ง Pre-Quote'); return; }
    if (!quoteExpiryDate) { toast.warning('กรุณากำหนดวันหมดอายุใบเสนอราคา'); return; }
    if (!confirm(`ยืนยันส่งใบเสนอราคาเบื้องต้น ฿${preQuoteTotal.toLocaleString()} ให้ ${currentJob.cust_name?.split('(')[0]}?`)) return;

    try {
      await update(ref(db, `jobs/${selectedJobId}`), {
        status: 'Pre-Quote Sent',
        price: preQuoteTotal,
        quote_expiry_date: quoteExpiryDate,
        updated_at: Date.now(),
        qc_logs: [
          { action: 'Pre-Quote Sent', by: currentUser?.name || 'Admin', timestamp: Date.now(), details: `ส่งใบเสนอราคาเบื้องต้น ฿${preQuoteTotal.toLocaleString()} (หมดอายุ: ${quoteExpiryDate})` },
          ...(currentJob.qc_logs || [])
        ]
      });
      toast.success('ส่ง Pre-Quote สำเร็จ!');
    } catch {
      toast.error('ส่ง Pre-Quote ล้มเหลว');
    }
  };

  if (loading) return <div className="p-10 text-center font-bold text-slate-400 animate-pulse">Loading B2B Queue...</div>;

  return (
    <div className="p-8 bg-[#F8FAFC] min-h-screen font-sans space-y-6">

      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase flex items-center gap-3">
            <Package size={28} className="text-indigo-500" /> B2B Dispatch Queue
          </h2>
          <p className="text-sm font-bold text-slate-500 mt-1">เตรียมรายการสินค้า → ส่งงานให้ Auditor ประเมินหน้างาน</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="bg-amber-100 text-amber-700 px-4 py-2 rounded-xl font-black flex items-center gap-2">
            <Clock size={16} /> รอเตรียม: {queueJobs.length}
          </div>
          <div className="bg-indigo-100 text-indigo-700 px-4 py-2 rounded-xl font-black flex items-center gap-2">
            <ScanLine size={16} /> กำลังประเมิน: {dispatchedJobs.length}
          </div>
          <button onClick={() => setShowCreateForm(true)} className="bg-slate-900 text-white px-5 py-2 rounded-xl font-black flex items-center gap-2 hover:bg-black transition-colors">
            <PlusCircle size={16} /> สร้างงาน B2B
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">

        {/* LEFT: Job Queue List */}
        <div className="col-span-12 lg:col-span-4 space-y-4">

          {/* รอเตรียมงาน */}
          <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 bg-amber-50 border-b border-amber-100">
              <h3 className="text-[11px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-2">
                <ClipboardCheck size={14} /> งานรอเตรียม (Queue)
              </h3>
            </div>
            <div className="divide-y divide-slate-50 max-h-[40vh] overflow-y-auto no-scrollbar">
              {queueJobs.length === 0 ? (
                <div className="p-8 text-center text-slate-400 font-bold text-sm">ไม่มีงาน B2B ที่รอเตรียม</div>
              ) : (
                queueJobs.map(job => (
                  <div
                    key={job.id}
                    onClick={() => {
                      setSelectedJobId(job.id);
                      setSiteVisitDate(job.site_visit_date || '');
                      setQuoteExpiryDate(job.quote_expiry_date || '');
                    }}
                    className={`p-4 cursor-pointer transition-all ${selectedJobId === job.id ? 'bg-indigo-50 border-l-4 border-indigo-500' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-black text-sm text-slate-800 flex items-center gap-2">
                          <Building2 size={14} className="text-indigo-500" />
                          {job.cust_name?.split('(')[0] || 'ไม่ระบุ'}
                        </div>
                        <div className="text-[10px] text-slate-400 font-bold mt-1">{job.ref_no} • {new Date(job.created_at).toLocaleDateString('th-TH')}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${job.status === 'New B2B Lead' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                          {job.status === 'New B2B Lead' ? 'NEW' : job.status === 'Pre-Quote Sent' ? 'QUOTED' : job.status === 'Pre-Quote Accepted' ? 'ACCEPTED' : 'FOLLOW UP'}
                        </span>
                        {(job.expected_items?.length || 0) > 0 && (
                          <span className="text-[9px] font-bold text-emerald-600">{job.expected_items.length} รายการ</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ส่งแล้ว (Dispatched) */}
          <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 bg-indigo-50 border-b border-indigo-100">
              <h3 className="text-[11px] font-black text-indigo-700 uppercase tracking-widest flex items-center gap-2">
                <ScanLine size={14} /> ส่ง Auditor แล้ว
              </h3>
            </div>
            <div className="divide-y divide-slate-50 max-h-[30vh] overflow-y-auto no-scrollbar">
              {dispatchedJobs.length === 0 ? (
                <div className="p-6 text-center text-slate-400 font-bold text-sm">ยังไม่มีงานที่ส่งไป Auditor</div>
              ) : (
                dispatchedJobs.map(job => (
                  <div key={job.id} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-bold text-sm text-slate-700 flex items-center gap-2">
                          <CheckCircle2 size={14} className="text-emerald-500" />
                          {job.cust_name?.split('(')[0]}
                        </div>
                        <div className="text-[10px] text-slate-400 font-bold mt-1">
                          {job.ref_no} • นัด: {job.site_visit_date || '-'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-black text-indigo-600">
                          {job.graded_items?.length || 0} / {job.expected_items?.length || 0}
                        </div>
                        <div className="text-[9px] text-slate-400 font-bold">สแกนแล้ว</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: Item Entry & Dispatch */}
        <div className="col-span-12 lg:col-span-8">
          {currentJob ? (
            <div className="space-y-6">

              {/* Job Info Header */}
              <div className="bg-slate-900 text-white p-6 rounded-[2rem] shadow-xl">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-1">กำลังเตรียมงาน</div>
                    <h3 className="text-2xl font-black tracking-tighter">{currentJob.cust_name?.split('(')[0]}</h3>
                    <div className="text-sm text-slate-400 font-bold mt-1">{currentJob.ref_no} • {currentJob.asset_details || 'ไม่ระบุรายละเอียด'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">ยอดรวม Pre-Quote</div>
                    <div className="text-3xl font-black text-emerald-400">฿{preQuoteTotal.toLocaleString()}</div>
                    <div className="text-xs text-slate-500 font-bold mt-1">{expectedItems.length} รายการ</div>
                  </div>
                </div>
              </div>

              {/* Add Item Form */}
              <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200">
                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Plus size={14} /> เพิ่มรายการสินค้า (Expected Items)
                </h3>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2">รุ่น / อุปกรณ์</label>
                    <select
                      value={expModel}
                      onChange={(e) => {
                        const selectedName = e.target.value;
                        setExpModel(selectedName);
                        const found = flattenedModels.find(m => m.name === selectedName);
                        if (found) setExpPrice(found.price);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-bold text-sm outline-none focus:border-indigo-500 transition-all"
                    >
                      <option value="">-- เลือกรุ่นและความจุ --</option>
                      {flattenedModels.map(m => (
                        <option key={m.id} value={m.name}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2">จำนวน</label>
                    <input type="number" min={1} value={expQty} onChange={e => setExpQty(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-black text-sm text-center outline-none focus:border-indigo-500" />
                  </div>
                  <div className="w-40">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2">ราคา/เครื่อง</label>
                    <input type="number" value={expPrice || ''} onChange={e => setExpPrice(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-black text-sm text-right outline-none focus:border-indigo-500" placeholder="0" />
                  </div>
                  <button onClick={handleAddItem} className="bg-indigo-600 text-white px-6 py-3.5 rounded-xl font-black text-xs uppercase hover:bg-indigo-700 shadow-sm transition-all active:scale-95 flex items-center gap-2">
                    <Plus size={16} /> Add
                  </button>
                </div>
              </div>

              {/* Expected Items Table */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-5 bg-amber-50/50 border-b border-amber-100 flex justify-between items-center">
                  <h3 className="text-[11px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-2">
                    <ClipboardCheck size={14} /> รายการสินค้า ({expectedItems.length} รายการ)
                  </h3>
                  <div className="text-sm font-black text-amber-600">Total: ฿{preQuoteTotal.toLocaleString()}</div>
                </div>
                {expectedItems.length === 0 ? (
                  <div className="p-10 text-center text-slate-400 font-bold">
                    <Package size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">ยังไม่มีรายการ — เพิ่มรายการสินค้าด้านบน</p>
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="py-3 px-6 font-black uppercase tracking-widest text-[10px] text-slate-400">รุ่น / สินทรัพย์</th>
                        <th className="py-3 px-6 font-black uppercase tracking-widest text-[10px] text-slate-400 text-center">จำนวน</th>
                        <th className="py-3 px-6 font-black uppercase tracking-widest text-[10px] text-slate-400 text-right">ราคา/เครื่อง</th>
                        <th className="py-3 px-6 font-black uppercase tracking-widest text-[10px] text-slate-400 text-right">รวม</th>
                        <th className="w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {expectedItems.map((item: any) => (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3.5 px-6 font-bold text-slate-800">{item.model}</td>
                          <td className="py-3.5 px-6 text-center font-black text-indigo-600">{item.qty}</td>
                          <td className="py-3.5 px-6 text-right text-slate-600">฿{item.unit_price.toLocaleString()}</td>
                          <td className="py-3.5 px-6 text-right font-black text-emerald-600">฿{(item.qty * item.unit_price).toLocaleString()}</td>
                          <td className="py-3.5 px-2">
                            <button onClick={() => handleRemoveItem(item.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              <X size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Actions: Pre-Quote & Dispatch */}
              <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-indigo-200 space-y-5">
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2 flex items-center gap-1">
                      <CalendarClock size={12} /> ใบเสนอราคาหมดอายุ (Quote Validity)
                    </label>
                    <input type="date" value={quoteExpiryDate} onChange={e => setQuoteExpiryDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-bold outline-none focus:border-indigo-500" />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2 flex items-center gap-1">
                      <CalendarClock size={12} /> วันนัดหมายหน้างาน (Site Visit)
                    </label>
                    <input type="date" value={siteVisitDate} onChange={e => setSiteVisitDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-bold outline-none focus:border-indigo-500" />
                  </div>
                </div>

                <div className="flex gap-3">
                  {/* ปุ่มส่ง Pre-Quote */}
                  <button
                    onClick={handleSendPreQuote}
                    disabled={expectedItems.length === 0 || !quoteExpiryDate || currentJob?.status === 'Pre-Quote Sent'}
                    className={`flex-1 py-3.5 rounded-xl font-black text-sm uppercase flex items-center justify-center gap-2 transition-all active:scale-95 ${
                      expectedItems.length > 0 && quoteExpiryDate && currentJob?.status !== 'Pre-Quote Sent'
                        ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-md'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <FileText size={16} /> {currentJob?.status === 'Pre-Quote Sent' ? 'Pre-Quote ส่งแล้ว' : 'ส่ง Pre-Quote'}
                  </button>

                  {/* ปุ่มส่งไป Auditor */}
                  <button
                    onClick={handleDispatchToAuditor}
                    disabled={expectedItems.length === 0 || !siteVisitDate}
                    className={`flex-1 py-3.5 rounded-xl font-black text-sm uppercase flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg ${
                      expectedItems.length > 0 && siteVisitDate
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                    }`}
                  >
                    <Send size={16} /> Dispatch to Auditor
                  </button>
                </div>

                {expectedItems.length === 0 && (
                  <div className="flex items-center gap-2 text-amber-600 text-xs font-bold">
                    <AlertCircle size={14} /> เพิ่มรายการสินค้าก่อนจึงจะส่งงาน/ออก Quote ได้
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-20 text-center">
              <Building2 size={64} className="mx-auto text-slate-200 mb-4" />
              <h2 className="text-xl font-black text-slate-400">เลือกงาน B2B จากคิวทางซ้ายมือ</h2>
              <p className="text-slate-400 text-sm mt-2">เพิ่มรายการสินค้าและส่งงานให้ Auditor ประเมินหน้างาน</p>
            </div>
          )}
        </div>
      </div>

      {/* Create B2B Job Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[3rem] w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-8 border-b border-slate-100 bg-slate-900 flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-black text-white uppercase flex items-center gap-3">
                  <Building2 size={24} /> สร้างงาน B2B ใหม่
                </h3>
              </div>
              <button onClick={() => setShowCreateForm(false)} className="p-3 hover:bg-slate-800 rounded-2xl text-slate-400"><X size={28} /></button>
            </div>
            <div className="p-8 space-y-5">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">ชื่อบริษัท <span className="text-red-500">*</span></label>
                <input type="text" value={newCompany} onChange={e => setNewCompany(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-black outline-none focus:border-indigo-500" placeholder="เช่น ABC Corporation" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">ชื่อผู้ติดต่อ</label>
                  <input type="text" value={newContact} onChange={e => setNewContact(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:border-indigo-500" placeholder="ชื่อ-สกุล" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">เบอร์ติดต่อ <span className="text-red-500">*</span></label>
                  <input type="text" value={newPhone} onChange={e => setNewPhone(e.target.value)} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:border-indigo-500" placeholder="08X-XXX-XXXX" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">รายละเอียดสินค้า / ล็อต</label>
                <textarea value={newAssetDetails} onChange={e => setNewAssetDetails(e.target.value)} rows={3} className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl font-bold outline-none focus:border-indigo-500 resize-none" placeholder="เช่น iPhone 15 Pro Max x20, iPad Air x10..." />
              </div>
              <button onClick={handleCreateB2BJob} disabled={!newCompany.trim() || !newPhone.trim()} className={`w-full py-4 rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 transition-all ${newCompany.trim() && newPhone.trim() ? 'bg-slate-900 text-white hover:bg-black shadow-lg' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                <PlusCircle size={18} /> สร้างงาน B2B
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
