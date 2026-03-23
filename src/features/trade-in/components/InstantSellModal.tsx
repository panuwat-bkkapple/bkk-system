import React, { useState, useMemo } from 'react';
import { X, Search, ArrowRight, ArrowLeft, CheckCircle2, Phone, Zap, MessageCircle, Package, Banknote } from 'lucide-react';
import { formatCurrency } from '../../../utils/formatters';
import { useDatabase } from '../../../hooks/useDatabase';

const BANKS = ["กสิกรไทย (KBank)", "ไทยพาณิชย์ (SCB)", "กรุงเทพ (BBL)", "กรุงศรี (BAY)", "ออมสิน (GSB)", "พร้อมเพย์ (PromptPay)"];

export const InstantSellModal = ({ onClose, onSubmit, jobs }: any) => {
  const [step, setStep] = useState(1);
  const [modelSearch, setModelSearch] = useState('');
  const [isExistingCustomer, setIsExistingCustomer] = useState(false);
  const [isCustomPrice, setIsCustomPrice] = useState(false);

  const { data: customers } = useDatabase('customers');
  const { data: modelsData } = useDatabase('models');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [offerNote, setOfferNote] = useState('');

  const [formData, setFormData] = useState({
    model: '', price: '', receive_method: 'Store-in',
    cust_name: '', cust_phone: '', cust_id_card: '', cust_address: '',
    bank_name: BANKS[0], bank_account: '', bank_holder: '',
    customer_id: ''
  });

  // Flatten models → variants เป็นรายการเดียวสำหรับค้นหา
  const flattenedProducts = useMemo(() => {
    const list = Array.isArray(modelsData) ? modelsData : [];
    const items: any[] = [];
    list.forEach((model: any) => {
      if (!model.name) return;
      if (!model.isActive && model.isActive !== undefined) return;
      // Firebase อาจเก็บ variants เป็น object หรือ array
      const rawVariants = model.variants;
      const variants: any[] = !rawVariants ? [] : Array.isArray(rawVariants) ? rawVariants : Object.values(rawVariants);
      if (variants.length === 0) {
        items.push({ id: model.id, model: model.name, brand: model.brand || '', category: model.category || '', variant: '', newPrice: 0, usedPrice: 0, imageUrl: model.imageUrl || '' });
      } else {
        variants.forEach((v: any) => {
          if (!v) return;
          items.push({
            id: `${model.id}_${v.id || v.name}`,
            model: model.name,
            brand: model.brand || '',
            category: model.category || '',
            variant: v.name || '',
            newPrice: Number(v.newPrice || 0),
            usedPrice: Number(v.usedPrice || v.price || 0),
            imageUrl: model.imageUrl || '',
          });
        });
      }
    });
    return items;
  }, [modelsData]);

  const filteredProducts = useMemo(() => {
    if (!modelSearch || modelSearch.length < 1) return [];
    const term = modelSearch.toLowerCase();
    return flattenedProducts
      .filter((item: any) => `${item.model} ${item.variant} ${item.brand}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [flattenedProducts, modelSearch]);

  // Customer search from CRM
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const list = Array.isArray(customers) ? customers : Object.keys(customers || {}).map(k => ({ id: k, ...(customers as any)[k] }));
    const term = searchQuery.toLowerCase();
    return list.filter((c: any) =>
      c.name?.toLowerCase().includes(term) ||
      c.phone?.includes(term) ||
      c.tax_id?.includes(term)
    ).slice(0, 5);
  }, [customers, searchQuery]);

  // Also search from past jobs
  const pastJobResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const list = Array.isArray(jobs) ? jobs : [];
    const term = searchQuery.toLowerCase();
    const seen = new Set<string>();
    return list
      .filter((j: any) => {
        if (!j.cust_name && !j.cust_phone) return false;
        const match = j.cust_name?.toLowerCase().includes(term) || j.cust_phone?.includes(term);
        if (!match) return false;
        const key = `${j.cust_phone}-${j.cust_name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a: any, b: any) => b.created_at - a.created_at)
      .slice(0, 3);
  }, [jobs, searchQuery]);

  const handleSelectCustomer = (cust: any) => {
    setFormData((prev: any) => ({
      ...prev,
      cust_name: cust.name,
      cust_phone: cust.phone || '',
      cust_id_card: cust.tax_id || cust.id_card || '',
      cust_address: cust.address || '',
      bank_name: cust.bank_name || prev.bank_name,
      bank_account: cust.bank_account || '',
      bank_holder: cust.bank_holder || cust.name,
      customer_id: cust.id
    }));
    setSearchQuery(cust.name);
    setShowDropdown(false);
    setIsExistingCustomer(true);
  };

  const handleSelectFromJob = (job: any) => {
    setFormData((prev: any) => ({
      ...prev,
      cust_name: job.cust_name || '',
      cust_phone: job.cust_phone || '',
      cust_id_card: job.cust_id_card || '',
      cust_address: job.cust_address || '',
      bank_name: job.bank_name || prev.bank_name,
      bank_account: job.bank_account || '',
      bank_holder: job.bank_holder || job.cust_name,
    }));
    setSearchQuery(job.cust_name);
    setShowDropdown(false);
    setIsExistingCustomer(true);
  };

  const handleSubmit = () => {
    onSubmit({
      ...formData,
      offer_note: offerNote,
    });
  };

  const canProceedStep1 = formData.cust_name && formData.cust_phone;
  const canProceedStep2 = formData.model && formData.price;

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[3rem] w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-8 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-orange-50 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-2xl font-black text-slate-800 uppercase flex items-center gap-3">
              <Zap size={24} className="text-amber-500" /> Instant Sell
            </h3>
            <p className="text-[10px] font-bold text-amber-600 tracking-widest uppercase mt-1">
              เปิดรับซื้อด่วน — ลูกค้าแจ้งผ่าน LINE / Walk-in • Step {step} of 3
            </p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white/80 rounded-2xl transition-colors text-slate-400"><X size={28} /></button>
        </div>

        <div className="p-10 overflow-y-auto flex-1 no-scrollbar space-y-8">

          {/* ================= STEP 1: ค้นหาลูกค้า ================= */}
          {step === 1 && (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <div className="flex justify-between items-end">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <MessageCircle size={14} className="text-green-500" /> ข้อมูลลูกค้า
                  {isExistingCustomer && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-md text-[8px] flex items-center gap-1 shadow-sm border border-green-200"><CheckCircle2 size={10} /> ลูกค้าเก่า</span>}
                </label>
              </div>

              {/* Smart search */}
              <div className="relative">
                <div className="relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-500" />
                  <input
                    type="text"
                    value={searchQuery || formData.cust_name}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setFormData({ ...formData, cust_name: e.target.value, customer_id: '' });
                      setShowDropdown(true);
                      setIsExistingCustomer(false);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                    className="w-full pl-12 pr-4 py-4 bg-amber-50/50 border border-amber-200 rounded-2xl font-black text-sm outline-none focus:border-amber-500 focus:bg-white transition-all shadow-sm"
                    placeholder="ค้นหาลูกค้าจาก ชื่อ, เบอร์โทร หรือ Tax ID..."
                  />
                </div>

                {/* CRM Dropdown */}
                {showDropdown && (searchResults.length > 0 || pastJobResults.length > 0) && (
                  <div className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2">
                    {searchResults.length > 0 && (
                      <>
                        <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          CRM Database
                        </div>
                        <div className="max-h-40 overflow-y-auto">
                          {searchResults.map((cust: any) => (
                            <div key={cust.id} onClick={() => handleSelectCustomer(cust)}
                              className="p-4 border-b border-slate-50 hover:bg-amber-50 cursor-pointer transition-colors flex items-center justify-between group">
                              <div>
                                <div className="font-black text-slate-800 text-sm group-hover:text-amber-700">{cust.name}</div>
                                <div className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-2">
                                  <span className="text-amber-500 flex items-center gap-1"><Phone size={10} />{cust.phone}</span>
                                  {cust.tax_id && <span className="text-slate-400">| Tax: {cust.tax_id}</span>}
                                </div>
                              </div>
                              <div className="text-[9px] font-black px-2 py-1 rounded bg-green-100 text-green-600 uppercase">CRM</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {pastJobResults.length > 0 && (
                      <>
                        <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          ประวัติ Trade-in
                        </div>
                        <div className="max-h-40 overflow-y-auto">
                          {pastJobResults.map((job: any) => (
                            <div key={job.id} onClick={() => handleSelectFromJob(job)}
                              className="p-4 border-b border-slate-50 hover:bg-amber-50 cursor-pointer transition-colors flex items-center justify-between group">
                              <div>
                                <div className="font-black text-slate-800 text-sm group-hover:text-amber-700">{job.cust_name}</div>
                                <div className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-2">
                                  <span className="text-amber-500 flex items-center gap-1"><Phone size={10} />{job.cust_phone}</span>
                                  <span className="text-slate-400">| {job.model}</span>
                                </div>
                              </div>
                              <div className="text-[9px] font-black px-2 py-1 rounded bg-blue-100 text-blue-600 uppercase">History</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Phone & ID */}
              <div className="grid grid-cols-2 gap-4">
                <input type="text" value={formData.cust_phone} onChange={e => setFormData({ ...formData, cust_phone: e.target.value })}
                  className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none" placeholder="เบอร์โทรศัพท์..." />
                <input type="text" value={formData.cust_id_card} onChange={e => setFormData({ ...formData, cust_id_card: e.target.value })}
                  className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none" placeholder="เลขบัตร ปชช. / Tax ID" />
              </div>

              <button onClick={() => setStep(2)} disabled={!canProceedStep1}
                className={`w-full py-5 rounded-[2rem] font-black flex items-center justify-center gap-2 uppercase transition-all ${canProceedStep1 ? 'bg-slate-900 text-white hover:bg-black' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                NEXT: เลือกสินค้า & ตั้งราคา <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* ================= STEP 2: เลือกสินค้า & ตั้งราคา ================= */}
          {step === 2 && (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <label className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <Package size={14} /> เลือกรุ่นสินค้า
              </label>

              {/* Toggle: ค้นหาจากราคากลาง vs พิมพ์เอง */}
              <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                <button onClick={() => setIsCustomPrice(false)}
                  className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${!isCustomPrice ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>
                  ค้นหาจากราคากลาง
                </button>
                <button onClick={() => setIsCustomPrice(true)}
                  className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${isCustomPrice ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-400'}`}>
                  พิมพ์ชื่อรุ่นเอง (ราคาพิเศษ)
                </button>
              </div>

              {!isCustomPrice ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-4 top-3.5 text-slate-300" size={18} />
                    <input type="text" className="w-full p-4 pl-12 bg-slate-50 rounded-2xl font-bold outline-none border border-slate-200"
                      placeholder="พิมพ์ชื่อรุ่น เช่น iPhone, iPad..." value={modelSearch} onChange={e => setModelSearch(e.target.value)} />
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {filteredProducts.map((item: any) => {
                      const displayName = item.variant ? `${item.model} (${item.variant})` : item.model;
                      const isSelected = formData.model === displayName;
                      return (
                        <div key={item.id} onClick={() => { setFormData({ ...formData, model: displayName, price: item.usedPrice || '' }); setModelSearch(displayName); }}
                          className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${isSelected ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-100 hover:border-amber-200'}`}>
                          <div className="flex items-center gap-3">
                            {item.imageUrl && <img src={item.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-black text-sm truncate">{item.model}</span>
                                {item.brand && <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${isSelected ? 'bg-amber-400/50 text-white' : 'bg-slate-100 text-slate-400'}`}>{item.brand}</span>}
                              </div>
                              {item.variant && <div className={`text-[10px] font-bold mt-0.5 ${isSelected ? 'text-amber-100' : 'text-slate-400'}`}>{item.variant}</div>}
                            </div>
                            <div className="text-right shrink-0">
                              {item.usedPrice > 0 && <div className="font-black text-sm">{formatCurrency(item.usedPrice)}</div>}
                              {item.newPrice > 0 && <div className={`text-[9px] font-bold ${isSelected ? 'text-amber-200' : 'text-emerald-500'}`}>ซีล {formatCurrency(item.newPrice)}</div>}
                              {!item.usedPrice && !item.newPrice && <div className="font-black text-sm">-</div>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {modelSearch && filteredProducts.length === 0 && (
                      <div className="text-center py-4 text-slate-400 text-sm font-bold">ไม่พบรุ่นที่ค้นหา — ลองใช้ "พิมพ์ชื่อรุ่นเอง"</div>
                    )}
                  </div>
                </>
              ) : (
                <input type="text" value={formData.model} onChange={e => setFormData({ ...formData, model: e.target.value })}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none"
                  placeholder="พิมพ์ชื่อรุ่น เช่น iPhone 16 Pro 256GB" />
              )}

              {/* Offer Price */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-2">
                  <Banknote size={14} /> ราคารับซื้อ (Offer Price)
                </label>
                <input type="number" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })}
                  className="w-full p-4 bg-amber-50 text-amber-700 rounded-2xl font-black text-2xl outline-none border border-amber-200" placeholder="0" />
                {isCustomPrice && (
                  <p className="text-[10px] text-amber-500 font-bold">ราคาพิเศษสำหรับลูกค้าเก่า — ไม่ตรงกับราคาหน้าเว็บ</p>
                )}
              </div>

              {/* Offer Note */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">หมายเหตุ / เหตุผลราคาพิเศษ (ไม่บังคับ)</label>
                <input type="text" value={offerNote} onChange={e => setOfferNote(e.target.value)}
                  className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none text-sm"
                  placeholder="เช่น ลูกค้าเก่าขายซ้ำ, ต่อราคาจาก LINE, offer พิเศษ..." />
              </div>

              <div className="flex gap-4">
                <button onClick={() => setStep(1)} className="flex-1 py-5 font-bold text-slate-400 uppercase text-[10px]">
                  <ArrowLeft size={16} className="inline mr-2" /> BACK
                </button>
                <button onClick={() => setStep(3)} disabled={!canProceedStep2}
                  className={`flex-[2] py-5 rounded-[2rem] font-black uppercase transition-all ${canProceedStep2 ? 'bg-slate-900 text-white hover:bg-black' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                  NEXT: ข้อมูลโอนเงิน <ArrowRight size={18} className="inline ml-2" />
                </button>
              </div>
            </div>
          )}

          {/* ================= STEP 3: ข้อมูลธนาคาร & ยืนยัน ================= */}
          {step === 3 && (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              {/* Summary */}
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border border-amber-200">
                <div className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-3">สรุปรายการ</div>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-slate-600 text-sm">{formData.cust_name}</span>
                  <span className="text-[10px] font-bold text-slate-400">{formData.cust_phone}</span>
                </div>
                <div className="font-black text-slate-800 text-sm mb-2">{formData.model}</div>
                <div className="text-2xl font-black text-amber-600">{formData.price ? formatCurrency(Number(formData.price)) : '—'}</div>
                {offerNote && <div className="text-[10px] text-amber-600 font-bold mt-2 bg-amber-100/50 px-3 py-1.5 rounded-lg">"{offerNote}"</div>}
              </div>

              {/* Bank info */}
              <div className="space-y-2 bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100">
                <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">ข้อมูลการโอนเงิน</label>
                <div className="grid grid-cols-2 gap-4">
                  <select value={formData.bank_name} onChange={e => setFormData({ ...formData, bank_name: e.target.value })}
                    className="p-4 bg-white border border-emerald-200 rounded-2xl font-bold outline-none text-xs text-emerald-800">
                    {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <input type="text" value={formData.bank_account} onChange={e => setFormData({ ...formData, bank_account: e.target.value })}
                    className="p-4 bg-white border border-emerald-200 rounded-2xl font-black tracking-wider outline-none text-xs text-emerald-800" placeholder="เลขบัญชี" />
                </div>
                <input type="text" value={formData.bank_holder} onChange={e => setFormData({ ...formData, bank_holder: e.target.value })}
                  className="w-full mt-2 p-3 bg-white border border-emerald-200 rounded-xl font-bold outline-none text-xs text-emerald-800" placeholder="ชื่อบัญชี (Account Name)" />
              </div>

              <div className="flex gap-4 pt-4">
                <button onClick={() => setStep(2)} className="flex-1 py-5 font-bold text-slate-400 uppercase text-[10px]">
                  <ArrowLeft size={16} className="inline mr-2" /> BACK
                </button>
                <button onClick={handleSubmit}
                  className="flex-[2] bg-amber-500 text-white py-5 rounded-[2rem] font-black uppercase shadow-lg shadow-amber-200 hover:bg-amber-600 transition-all flex items-center justify-center gap-2">
                  <Zap size={18} /> เปิดรับซื้อทันที
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
