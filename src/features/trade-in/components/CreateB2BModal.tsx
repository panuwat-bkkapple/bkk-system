import React, { useState, useMemo } from 'react';
import { X, Building2, Phone, Mail, MapPin, FileText, ArrowRight, ArrowLeft, Search, Upload } from 'lucide-react';
import { useDatabase } from '../../../hooks/useDatabase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../../api/firebase';

export const CreateB2BModal = ({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: any) => void }) => {
  const [step, setStep] = useState(1);
  const { data: customers } = useDatabase('customers');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [formData, setFormData] = useState({
    cust_name: '',
    cust_phone: '',
    cust_email: '',
    cust_address: '',
    asset_details: '',
    price: '',
    notes: '',
    attached_file_name: '',
    attached_file_url: '',
    customer_id: '',
  });

  // ค้นหาลูกค้าจาก CRM
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

  const handleSelectCustomer = (cust: any) => {
    setFormData(prev => ({
      ...prev,
      cust_name: cust.name,
      cust_phone: cust.phone || '',
      cust_email: cust.email || '',
      cust_address: cust.address || '',
      customer_id: cust.id,
    }));
    setSearchQuery(cust.name);
    setShowDropdown(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileRef = storageRef(storage, `b2b_attachments/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      setFormData(prev => ({ ...prev, attached_file_name: file.name, attached_file_url: url }));
    } catch {
      alert('อัปโหลดไฟล์ล้มเหลว');
    } finally {
      setUploading(false);
    }
  };

  const isStep1Valid = formData.cust_name.trim() && formData.cust_phone.trim();
  const isStep2Valid = formData.asset_details.trim() || formData.attached_file_name;

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[3rem] w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-8 border-b border-slate-100 bg-slate-900 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-2xl font-black text-white uppercase flex items-center gap-3">
              <Building2 size={24} /> New B2B Deal
            </h3>
            <p className="text-[10px] font-bold text-blue-400 tracking-widest uppercase mt-1">Step {step} of 2</p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-slate-800 rounded-2xl transition-colors text-slate-400">
            <X size={28} />
          </button>
        </div>

        <div className="p-10 overflow-y-auto flex-1 no-scrollbar space-y-8">

          {/* ================= STEP 1: Company Info ================= */}
          {step === 1 && (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Building2 size={14} /> ข้อมูลบริษัท / ผู้ติดต่อ
              </label>

              {/* ค้นหาจาก CRM */}
              <div className="relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                <input
                  type="text"
                  value={searchQuery || formData.cust_name}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setFormData(prev => ({ ...prev, cust_name: e.target.value, customer_id: '' }));
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                  className="w-full pl-12 pr-4 py-4 bg-blue-50/50 border border-blue-200 rounded-2xl font-black text-sm outline-none focus:border-blue-500 focus:bg-white transition-all shadow-sm"
                  placeholder="ค้นหาชื่อบริษัท หรือพิมพ์ใหม่..."
                />
                {showDropdown && searchResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-2">
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      Customer CRM Results
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {searchResults.map((cust: any) => (
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
                            {cust.type || 'B2B'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <Phone size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={formData.cust_phone}
                    onChange={e => setFormData(prev => ({ ...prev, cust_phone: e.target.value }))}
                    className="w-full pl-12 p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none text-sm"
                    placeholder="เบอร์ติดต่อ"
                  />
                </div>
                <div className="relative">
                  <Mail size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={formData.cust_email}
                    onChange={e => setFormData(prev => ({ ...prev, cust_email: e.target.value }))}
                    className="w-full pl-12 p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none text-sm"
                    placeholder="อีเมล (ถ้ามี)"
                  />
                </div>
              </div>

              <div className="relative">
                <MapPin size={14} className="absolute left-4 top-4 text-slate-400" />
                <input
                  type="text"
                  value={formData.cust_address}
                  onChange={e => setFormData(prev => ({ ...prev, cust_address: e.target.value }))}
                  className="w-full pl-12 p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none text-sm"
                  placeholder="ที่อยู่บริษัท (ถ้ามี)"
                />
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!isStep1Valid}
                className={`w-full py-5 rounded-[2rem] font-black flex items-center justify-center gap-2 uppercase transition-all ${isStep1Valid ? 'bg-slate-900 text-white hover:bg-black' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
              >
                NEXT: ASSET DETAILS <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* ================= STEP 2: Asset Details ================= */}
          {step === 2 && (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <FileText size={14} /> รายละเอียดสินค้า / ล็อต
              </label>

              <textarea
                value={formData.asset_details}
                onChange={e => setFormData(prev => ({ ...prev, asset_details: e.target.value }))}
                rows={4}
                className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none text-sm resize-none"
                placeholder="เช่น iPhone 15 Pro Max x20, iPhone 14 x30, iPad Air x10..."
              />

              {/* File Upload */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">แนบไฟล์รายการ (Excel, PDF)</label>
                <label className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${formData.attached_file_name ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 hover:border-blue-300 text-slate-400 hover:text-blue-500'}`}>
                  {uploading ? (
                    <span className="font-bold text-sm animate-pulse">กำลังอัปโหลด...</span>
                  ) : formData.attached_file_name ? (
                    <>
                      <FileText size={16} />
                      <span className="font-black text-sm">{formData.attached_file_name}</span>
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      <span className="font-bold text-sm">เลือกไฟล์</span>
                    </>
                  )}
                  <input type="file" className="hidden" accept=".xlsx,.xls,.pdf,.csv" onChange={handleFileUpload} />
                </label>
              </div>

              {/* Estimated Value */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">มูลค่าประเมินเบื้องต้น (ไม่รวม VAT)</label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={e => setFormData(prev => ({ ...prev, price: e.target.value }))}
                  className="w-full p-4 bg-emerald-50 text-emerald-700 rounded-2xl font-black text-2xl outline-none"
                  placeholder="0"
                />
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">หมายเหตุเพิ่มเติม</label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none text-sm"
                  placeholder="เช่น นัดเข้าสำรวจสัปดาห์หน้า..."
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button onClick={() => setStep(1)} className="flex-1 py-5 font-bold text-slate-400 uppercase text-[10px]">
                  <ArrowLeft size={16} className="inline mr-2" /> BACK
                </button>
                <button
                  onClick={() => onSubmit(formData)}
                  disabled={!isStep2Valid}
                  className={`flex-[2] py-5 rounded-[2rem] font-black uppercase shadow-lg transition-all ${isStep2Valid ? 'bg-slate-900 text-white hover:bg-black shadow-slate-300' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                >
                  CREATE B2B DEAL
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
