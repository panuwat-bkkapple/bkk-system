import React, { useState, useEffect, useMemo } from 'react';
import { X, Search, Database, ArrowRight, ArrowLeft, CheckCircle2, MapPin, Store, Bike, Mail, Phone } from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';
import { useDatabase } from '../../../hooks/useDatabase'; // 🌟 1. นำเข้า useDatabase

const BANKS = ["กสิกรไทย (KBank)", "ไทยพาณิชย์ (SCB)", "กรุงเทพ (BBL)", "กรุงศรี (BAY)", "ออมสิน (GSB)", "พร้อมเพย์ (PromptPay)"];
const RECEIVE_METHODS = [
  { id: 'Store-in', label: 'หน้าร้าน (Store-in)', icon: Store },
  { id: 'Pickup', label: 'เรียกไรเดอร์ (Pickup)', icon: Bike },
  { id: 'Mail-in', label: 'ส่งพัสดุ (Mail-in)', icon: Mail }
];

export const CreateTicketModal = ({ onClose, onSubmit, basePricing, jobs }: any) => {
  const [step, setStep] = useState(1);
  const [modelSearch, setModelSearch] = useState('');
  const [isExistingCustomer, setIsExistingCustomer] = useState(false);
  
  // 🌟 2. เพิ่ม State สำหรับระบบค้นหา Autocomplete
  const { data: customers } = useDatabase('customers');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const [formData, setFormData] = useState({
    model: '', price: '', receive_method: 'Store-in', tier: '', category: '',
    cust_name: '', cust_phone: '', cust_id_card: '', cust_address: '',
    bank_name: BANKS[0], bank_account: '', bank_holder: '', status: 'New Lead',
    customer_id: '' // 🌟 เก็บ ID อ้างอิงเวลาดึงจาก CRM
  });

  const filteredBasePricing = Array.isArray(basePricing) 
    ? basePricing.filter(item => item.model.toLowerCase().includes(modelSearch.toLowerCase())).slice(0, 5) 
    : [];

  // 🧠 3. ระบบประมวลผลการค้นหา (พิมพ์ชื่อ, เบอร์, หรือ Tax ID ก็เจอ)
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    
    const list = Array.isArray(customers) ? customers : Object.keys(customers || {}).map(k => ({ id: k, ...(customers as any)[k] }));
    const term = searchQuery.toLowerCase();
    
    return list.filter(c => 
      c.name?.toLowerCase().includes(term) || 
      c.phone?.includes(term) || 
      c.tax_id?.includes(term)
    ).slice(0, 5);
  }, [customers, searchQuery]);

  // 🎯 4. ฟังก์ชันเมื่อกดเลือกรายชื่อลูกค้าจาก Dropdown
  const handleSelectCustomer = (cust: any) => {
    setFormData((prev: any) => ({
      ...prev,
      cust_name: cust.name,
      cust_phone: cust.phone || '',
      cust_id_card: cust.tax_id || cust.id_card || '', // ใช้ Tax ID หรือบัตรประชาชน
      cust_address: cust.address || '',
      // ดึงข้อมูลธนาคารไปรอไว้ที่ Step 3 เลย!
      bank_name: cust.bank_name || prev.bank_name,
      bank_account: cust.bank_account || '',
      bank_holder: cust.bank_holder || cust.name, // ถ้าไม่มีชื่อบัญชี ให้ใช้ชื่อลูกค้าไปก่อน
      customer_id: cust.id
    }));
    
    setSearchQuery(cust.name);
    setShowDropdown(false);
    setIsExistingCustomer(true);
  };

  // (ระบบสำรอง: ค้นหาจากประวัติเก่า กรณีไม่ได้เลือกจาก CRM)
  useEffect(() => {
    const cleanPhone = formData.cust_phone?.replace(/\D/g, '');
    if (cleanPhone?.length >= 10 && !formData.customer_id) {
      const pastCustomer = Array.isArray(jobs) ? jobs.filter(j => j.cust_phone === formData.cust_phone && j.cust_name).sort((a, b) => b.created_at - a.created_at)[0] : null;
      if (pastCustomer) {
        setIsExistingCustomer(true);
        setFormData((prev: any) => ({ ...prev, cust_name: prev.cust_name || pastCustomer.cust_name || '', cust_id_card: prev.cust_id_card || pastCustomer.cust_id_card || '', cust_address: prev.cust_address || pastCustomer.cust_address || '', bank_name: pastCustomer.bank_name || prev.bank_name, bank_account: pastCustomer.bank_account || prev.bank_account, bank_holder: pastCustomer.bank_holder || prev.bank_holder }));
      } else setIsExistingCustomer(false);
    } else if (!formData.customer_id) {
        setIsExistingCustomer(false);
    }
  }, [formData.cust_phone, jobs, formData.customer_id]);

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[3rem] w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
          <div><h3 className="text-2xl font-black text-slate-800 uppercase">Create New Ticket</h3><p className="text-[10px] font-bold text-blue-500 tracking-widest uppercase mt-1">Step {step} of 3</p></div>
          <button onClick={onClose} className="p-3 hover:bg-slate-100 rounded-2xl transition-colors text-slate-400"><X size={28} /></button>
        </div>

        <div className="p-10 overflow-y-auto flex-1 no-scrollbar space-y-8">
          
          {/* ================= STEP 1 ================= */}
          {step === 1 && (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Database size={14} /> ค้นหารุ่นสินค้าจากราคากลาง</label>
                <div className="relative"><Search className="absolute left-4 top-3.5 text-slate-300" size={18} /><input type="text" className="w-full p-4 pl-12 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200" placeholder="พิมพ์ชื่อรุ่น..." value={modelSearch} onChange={e => setModelSearch(e.target.value)} /></div>
                <div className="space-y-2">
                  {filteredBasePricing.map((item: any) => (
                    <div key={item.id} onClick={() => { setFormData({ ...formData, model: `${item.model} (${item.storage})`, price: item.basePrice }); setModelSearch(`${item.model} (${item.storage})`); }} className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex justify-between items-center ${formData.model.includes(item.model) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-100'}`}>
                      <div className="font-black text-sm">{item.model} {item.storage}</div><div className="font-black">{formatCurrency(item.basePrice)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ราคาเสนอรับซื้อเริ่มต้น</label><input type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} className="w-full p-4 bg-emerald-50 text-emerald-700 rounded-2xl font-black text-2xl outline-none" placeholder="0.00" /></div>
              <button onClick={() => setStep(2)} className="w-full bg-slate-900 text-white py-5 rounded-[2rem] font-black flex items-center justify-center gap-2 hover:bg-black uppercase">NEXT: CUSTOMER KYC <ArrowRight size={18} /></button>
            </div>
          )}

          {/* ================= STEP 2 (🌟 อัปเกรด Autocomplete) ================= */}
          {step === 2 && (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <div className="flex justify-between items-end">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  ข้อมูลผู้ขาย {isExistingCustomer && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-md text-[8px] flex items-center gap-1 shadow-sm border border-green-200"><CheckCircle2 size={10} /> VERIFIED CUSTOMER</span>}
                </label>
              </div>
              
              <div className="space-y-4">
                {/* 🔍 ช่องค้นหาอัจฉริยะ */}
                <div className="relative">
                   <div className="relative">
                      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                      <input 
                         type="text" 
                         value={searchQuery || formData.cust_name} 
                         onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setFormData({...formData, cust_name: e.target.value, customer_id: ''}); // ถ้าพิมพ์เองแปลว่าอาจเป็นคนใหม่
                            setShowDropdown(true);
                         }}
                         onFocus={() => setShowDropdown(true)}
                         onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                         className="w-full pl-12 pr-4 py-4 bg-blue-50/50 border border-blue-200 rounded-2xl font-black text-sm outline-none focus:border-blue-500 focus:bg-white transition-all shadow-sm" 
                         placeholder="🔍 ค้นหาประวัติลูกค้าด้วย ชื่อ, เบอร์โทร หรือ Tax ID..."
                      />
                   </div>

                   {/* 🔽 Dropdown แสดงผลลัพธ์ */}
                   {showDropdown && searchResults.length > 0 && (
                      <div className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2">
                         <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                            Customer CRM Results
                         </div>
                         <div className="max-h-60 overflow-y-auto">
                            {searchResults.map((cust) => (
                               <div 
                                  key={cust.id} 
                                  onClick={() => handleSelectCustomer(cust)}
                                  className="p-4 border-b border-slate-50 hover:bg-blue-50 cursor-pointer transition-colors flex items-center justify-between group"
                               >
                                  <div>
                                     <div className="font-black text-slate-800 text-sm group-hover:text-blue-700">{cust.name}</div>
                                     <div className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-2">
                                        <span className="text-blue-500 flex items-center gap-1"><Phone size={10} />{cust.phone}</span>
                                        {cust.tax_id && <span className="text-slate-400">| Tax: {cust.tax_id}</span>}
                                     </div>
                                  </div>
                                  <div className="text-[9px] font-black px-2 py-1 rounded bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600 uppercase">
                                     {cust.type}
                                  </div>
                               </div>
                            ))}
                         </div>
                      </div>
                   )}
                </div>

                {/* ฟอร์มที่ถูก Auto-fill */}
                <div className="grid grid-cols-2 gap-4">
                  <input type="text" value={formData.cust_phone} onChange={e => setFormData({ ...formData, cust_phone: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none" placeholder="เบอร์โทรศัพท์..." />
                  <input type="text" value={formData.cust_id_card} onChange={e => setFormData({ ...formData, cust_id_card: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none" placeholder="เลขบัตร ปชช. / Tax ID" />
                </div>
              </div>

              <div className="flex gap-4">
                <button onClick={() => setStep(1)} className="flex-1 py-5 font-bold text-slate-400 uppercase text-[10px]"><ArrowLeft size={16} className="inline mr-2" /> BACK</button>
                <button onClick={() => setStep(3)} className="flex-[2] bg-slate-900 text-white py-5 rounded-[2rem] font-black uppercase">NEXT: METHOD <ArrowRight size={18} className="inline ml-2" /></button>
              </div>
            </div>
          )}

          {/* ================= STEP 3 ================= */}
          {step === 3 && (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ช่องทางการรับเครื่อง (Method)</label>
                <div className="grid grid-cols-3 gap-3">
                  {RECEIVE_METHODS.map(m => (
                    <button key={m.id} onClick={() => setFormData({ ...formData, receive_method: m.id })} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${formData.receive_method === m.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-100 bg-white text-slate-500 hover:border-blue-200'}`}>
                      <m.icon size={24} /><span className="text-[10px] font-black uppercase tracking-tight">{m.id}</span>
                    </button>
                  ))}
                </div>
              </div>
              
              {formData.receive_method === 'Pickup' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest"><MapPin size={14} className="text-red-500" /> พิกัดรับเครื่อง (Pickup Location) <span className="text-red-500">*</span></label>
                  <input type="text" value={formData.cust_address} onChange={e => setFormData({ ...formData, cust_address: e.target.value })} className="w-full p-4 bg-blue-50/30 border border-blue-200 rounded-2xl font-bold outline-none text-sm focus:border-blue-500 focus:bg-white transition-all shadow-inner" placeholder="ระบุบ้านเลขที่, ถนน, แขวง/เขต หรือวางลิงก์ Google Maps..." />
                </div>
              )}

              {/* 🌟 ข้อมูลธนาคารที่ถูกดึงมารอไว้แล้วจาก Step 2 */}
              <div className="space-y-2 bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100">
                <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">ข้อมูลการโอนเงิน (ดึงจากประวัติ)</label>
                <div className="grid grid-cols-2 gap-4">
                  <select value={formData.bank_name} onChange={e => setFormData({ ...formData, bank_name: e.target.value })} className="p-4 bg-white border border-emerald-200 rounded-2xl font-bold outline-none text-xs text-emerald-800">
                    {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <input type="text" value={formData.bank_account} onChange={e => setFormData({ ...formData, bank_account: e.target.value })} className="p-4 bg-white border border-emerald-200 rounded-2xl font-black tracking-wider outline-none text-xs text-emerald-800" placeholder="เลขบัญชี" />
                </div>
                <input type="text" value={formData.bank_holder} onChange={e => setFormData({ ...formData, bank_holder: e.target.value })} className="w-full mt-2 p-3 bg-white border border-emerald-200 rounded-xl font-bold outline-none text-xs text-emerald-800" placeholder="ชื่อบัญชี (Account Name)" />
              </div>

              <div className="flex gap-4 pt-4">
                <button onClick={() => setStep(2)} className="flex-1 py-5 font-bold text-slate-400 uppercase text-[10px]"><ArrowLeft size={16} className="inline mr-2" /> BACK</button>
                <button onClick={() => onSubmit(formData)} className="flex-[2] bg-blue-600 text-white py-5 rounded-[2rem] font-black uppercase shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all">CREATE TICKET</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};