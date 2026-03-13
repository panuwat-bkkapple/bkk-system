import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import {
    Users, Building2, UserPlus, Search,
    Phone, Mail, MapPin, FileText,
    ChevronRight, Trash2, Edit3, Plus, Globe, X, Save, Landmark, User
} from 'lucide-react';
import { ref, push, remove, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';

type CustomerType = 'B2C' | 'B2B';

export const CustomerCRM = () => {
    const toast = useToast();
    const { data: customers, loading } = useDatabase('customers');
    const [activeTab, setActiveTab] = useState<CustomerType>('B2B');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    // 📝 Form State (ใส่ให้ครบทุกฟิลด์)
    const [formData, setFormData] = useState({
        id: '',
        type: 'B2B' as CustomerType,
        relation_type: 'CUSTOMER',
        name: '',
        tax_id: '',
        branch: 'สำนักงานใหญ่',
        contact_person: '',
        phone: '',
        email: '',
        address: '',
        website: '',
        bank_name: '',
        bank_account: '',
        bank_holder: '',
        credit_term: '0',
        note: ''
    });

    const displayCustomers = useMemo(() => {
        const list = Array.isArray(customers) ? customers : Object.keys(customers || {}).map(k => ({ id: k, ...(customers as any)[k] }));
        return list.filter(c =>
            c.type === activeTab &&
            (c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.tax_id?.includes(searchTerm) ||
                c.phone?.includes(searchTerm))
        ).sort((a, b) => b.created_at - a.created_at);
    }, [customers, activeTab, searchTerm]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const payload = {
            ...formData,
            updated_at: Date.now(),
            created_at: formData.id ? undefined : Date.now()
        };

        try {
            if (formData.id) {
                await update(ref(db, `customers/${formData.id}`), payload);
            } else {
                await push(ref(db, 'customers'), payload);
            }
            setIsModalOpen(false);

            // 🌟 พระเอกอยู่ตรงนี้ครับ! ตอนเคลียร์ฟอร์ม ต้องใส่ค่าเริ่มต้นของธนาคารกลับเข้าไปด้วย
            setFormData({
                id: '', 
                type: activeTab, 
                relation_type: 'CUSTOMER', 
                name: '', 
                tax_id: '', 
                branch: 'สำนักงานใหญ่', 
                contact_person: '',
                phone: '', 
                email: '', 
                address: '', 
                website: '',
                bank_name: '', 
                bank_account: '', 
                bank_holder: '', 
                credit_term: '0', 
                note: ''
            });
        } catch (err) { toast.error('เกิดข้อผิดพลาด: ' + err); }
    };

    if (loading) return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Syncing CRM Data...</div>;

    return (
        <div className="p-8 space-y-6 bg-[#F8FAFC] min-h-screen font-sans">

            {/* 🚀 Header Section */}
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase flex items-center gap-3">
                        <Users className="text-blue-600" size={32} /> Customer CRM
                    </h2>
                    <p className="text-sm text-slate-500 font-bold mt-1">ฐานข้อมูลลูกค้าและคู่ค้าทางธุรกิจ</p>
                </div>
                <button
                    onClick={() => { setFormData({ ...formData, id: '', type: activeTab }); setIsModalOpen(true); }}
                    className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-black transition-all flex items-center gap-2"
                >
                    <UserPlus size={18} /> Register New Customer
                </button>
            </div>

            {/* 📂 Workspace Tabs & Search */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200">
                    <button onClick={() => setActiveTab('B2B')} className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-2 transition-all ${activeTab === 'B2B' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}>
                        <Building2 size={16} /> Corporate (B2B)
                    </button>
                    <button onClick={() => setActiveTab('B2C')} className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-2 transition-all ${activeTab === 'B2C' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}>
                        <Users size={16} /> Individual (B2C)
                    </button>
                </div>

                <div className="relative w-full md:w-96">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder={`ค้นหาชื่อ${activeTab === 'B2B' ? 'บริษัท' : 'ลูกค้า'}, Tax ID...`}
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-4 ring-blue-500/5 transition-all"
                    />
                </div>
            </div>

            {/* 📊 Customer Table */}
            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50/50 border-b border-slate-100">
                        <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <th className="p-6 pl-10">Customer Identity</th>
                            <th className="p-6">{activeTab === 'B2B' ? 'Tax ID / Registered' : 'ID Card / Address'}</th>
                            <th className="p-6">Contact Info</th>
                            <th className="p-6 text-right pr-10">Manage</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {displayCustomers.map(cust => (
                            <tr key={cust.id} className="hover:bg-slate-50/50 transition-colors group">
                                <td className="p-6 pl-10">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg ${activeTab === 'B2B' ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-600'}`}>
                                            {cust.name.charAt(0)}
                                        </div>
                                        <div>
                                            <div className="font-black text-slate-800 text-sm leading-tight">{cust.name}</div>
                                            <div className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-tighter">
                                                {activeTab === 'B2B' ? `Contact: ${cust.contact_person || '-'}` : 'Retail Customer'}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-6">
                                    <div className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded w-fit mb-1">
                                        {cust.tax_id || 'NO-ID'}
                                    </div>
                                    <div className="text-[11px] text-slate-500 font-bold truncate max-w-xs flex items-center gap-1">
                                        <MapPin size={12} className="shrink-0 text-red-400" /> {cust.address || 'No Address Recorded'}
                                    </div>
                                </td>
                                <td className="p-6">
                                    <div className="flex flex-col gap-1">
                                        <div className="text-xs font-black text-slate-700 flex items-center gap-2"><Phone size={12} className="text-blue-500" /> {cust.phone}</div>
                                        <div className="text-[11px] font-bold text-slate-400 flex items-center gap-2"><Mail size={12} /> {cust.email || '-'}</div>
                                    </div>
                                </td>
                                <td className="p-6 text-right pr-10">
                                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => { setFormData(cust); setIsModalOpen(true); }} className="p-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 shadow-sm"><Edit3 size={16} /></button>
                                        <button onClick={async () => { if (confirm('Delete?')) await remove(ref(db, `customers/${cust.id}`)); }} className="p-2.5 bg-white border border-slate-200 text-red-500 rounded-xl hover:bg-red-50 shadow-sm"><Trash2 size={16} /></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {displayCustomers.length === 0 && <tr><td colSpan={4} className="p-20 text-center text-slate-300 font-bold italic">ไม่พบข้อมูลลูกค้าในหมวดหมู่นี้</td></tr>}
                    </tbody>
                </table>
            </div>

            {/* 🏗️ Registration Modal (อัปเกรดแบ่ง 4 ส่วน) */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-[3rem] w-full max-w-4xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">

                        {/* Modal Header */}
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                            <div>
                                <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">
                                    {formData.id ? 'Edit Customer Profile' : 'Register New Customer'}
                                </h3>
                                <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mt-1">
                                    {activeTab === 'B2B' ? 'Corporate Account (นิติบุคคล)' : 'Individual Account (บุคคลธรรมดา)'}
                                </p>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-white rounded-full transition-colors"><X size={24} /></button>
                        </div>

                        {/* Modal Body (Scrollable) */}
                        <form id="customer-form" onSubmit={handleSubmit} className="p-8 overflow-y-auto space-y-8 flex-1 bg-slate-50/30">

                            {/* 🔴 ส่วนที่ 1: ข้อมูลผู้ติดต่อ */}
                            <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-blue-600 mb-4 border-b border-slate-100 pb-2 flex items-center gap-2">
                                    <User size={14} /> 1. ข้อมูลผู้ติดต่อ (Primary Info)
                                </h4>
                                <div className="grid grid-cols-2 gap-5">
                                    <div className="col-span-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ชื่อลูกค้า / ชื่อบริษัท <span className="text-red-500">*</span></label>
                                        <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-black text-lg outline-none focus:border-blue-500 transition-all" placeholder="เช่น บริษัท ฮอนด้า ลีสซิ่ง (ประเทศไทย) จำกัด" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{activeTab === 'B2B' ? 'เลขประจำตัวผู้เสียภาษี (Tax ID)' : 'เลขบัตรประชาชน'}</label>
                                        <input type="text" value={formData.tax_id} onChange={e => setFormData({ ...formData, tax_id: e.target.value })} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-mono font-bold outline-none focus:border-blue-500" placeholder="0XXXXXXXXXXXX" />
                                    </div>
                                    {activeTab === 'B2B' && (
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">สาขา (ตาม ภพ.20) <span className="text-red-500">*</span></label>
                                            <input type="text" value={formData.branch} onChange={e => setFormData({ ...formData, branch: e.target.value })} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-bold outline-none focus:border-blue-500" placeholder="สำนักงานใหญ่ หรือ 00001" />
                                        </div>
                                    )}
                                    {activeTab === 'B2B' && (
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ชื่อผู้ติดต่อ (Contact Person)</label>
                                            <input type="text" value={formData.contact_person} onChange={e => setFormData({ ...formData, contact_person: e.target.value })} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-bold outline-none focus:border-blue-500" placeholder="คุณสมชาย (ฝ่ายจัดซื้อ)" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 🟠 ส่วนที่ 2: รายละเอียดผู้ติดต่อ */}
                            <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-orange-500 mb-4 border-b border-slate-100 pb-2 flex items-center gap-2">
                                    <Phone size={14} /> 2. รายละเอียดการติดต่อ (Contact Details)
                                </h4>
                                <div className="grid grid-cols-2 gap-5">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">เบอร์โทรศัพท์ <span className="text-red-500">*</span></label>
                                        <input required type="text" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-bold outline-none focus:border-orange-500" placeholder="08X-XXX-XXXX" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">อีเมล (Email)</label>
                                        <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-bold outline-none focus:border-orange-500" placeholder="example@company.com" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ที่อยู่ (ตามหนังสือภพ.20 หรือ บัตรประชาชน)</label>
                                        <textarea rows={3} value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold outline-none focus:border-orange-500 text-sm" placeholder="เลขที่... ถนน... แขวง/ตำบล..." />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ประเภทความสัมพันธ์ (Business Relation)</label>
                                <select
                                    value={formData.relation_type || 'CUSTOMER'}
                                    onChange={e => setFormData({ ...formData, relation_type: e.target.value })}
                                    className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-xl font-bold outline-none focus:border-blue-500 text-sm"
                                >
                                    <option value="CUSTOMER">ลูกค้า (Customer - มาซื้อสินค้าจากเรา)</option>
                                    <option value="VENDOR">ผู้จำหน่าย/คู่ค้า (Vendor - นำเครื่องมาขาย/ซัพพลายเออร์)</option>
                                    <option value="BOTH">ทั้งซื้อและขาย (Customer & Vendor)</option>
                                </select>
                            </div>

                            {/* 🟢 ส่วนที่ 3: ข้อมูลธนาคาร */}
                            <div className="bg-emerald-50/50 p-6 rounded-[2rem] border border-emerald-200 shadow-sm">
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-emerald-600 mb-4 border-b border-emerald-100 pb-2 flex items-center gap-2">
                                    <Landmark size={14} /> 3. ข้อมูลบัญชีธนาคาร (Bank Details) <span className="text-[9px] text-emerald-500 font-bold lowercase normal-case">- สำหรับโอนเงินค่าเครื่อง</span>
                                </h4>
                                <div className="grid grid-cols-2 gap-5">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ธนาคาร (Bank Name)</label>
                                        <input type="text" value={formData.bank_name} onChange={e => setFormData({ ...formData, bank_name: e.target.value })} className="w-full bg-white border border-emerald-200 p-3.5 rounded-xl font-bold outline-none focus:border-emerald-500" placeholder="เช่น กสิกรไทย, KBank" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">เลขที่บัญชี (Account Number)</label>
                                        <input type="text" value={formData.bank_account} onChange={e => setFormData({ ...formData, bank_account: e.target.value })} className="w-full bg-white border border-emerald-200 p-3.5 rounded-xl font-mono font-black outline-none focus:border-emerald-500 tracking-widest" placeholder="123-4-56789-0" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ชื่อบัญชี (Account Name)</label>
                                        <input type="text" value={formData.bank_holder} onChange={e => setFormData({ ...formData, bank_holder: e.target.value })} className="w-full bg-white border border-emerald-200 p-3.5 rounded-xl font-bold outline-none focus:border-emerald-500" placeholder="ชื่อบัญชีรับเงินให้ตรงกับชื่อลูกค้า/บริษัท" />
                                    </div>
                                </div>
                            </div>

                            {/* 🟣 ส่วนที่ 4: ข้อมูลเพิ่มเติม */}
                            <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-purple-600 mb-4 border-b border-slate-100 pb-2 flex items-center gap-2">
                                    <FileText size={14} /> 4. ข้อมูลเพิ่มเติม (Additional Info)
                                </h4>
                                <div>
                                    <div className="col-span-1">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">เครดิตเทอม (วัน)</label>
                                        <div className="relative">
                                            <input type="number" value={formData.credit_term} onChange={e => setFormData({ ...formData, credit_term: e.target.value })} className="w-full bg-slate-50 border border-slate-200 p-3.5 pr-10 rounded-xl font-black text-lg outline-none focus:border-purple-500 text-right text-purple-600" min="0" />
                                            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">วัน</span>
                                        </div>
                                    </div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">หมายเหตุ / เงื่อนไขเครดิต (Notes & Remarks)</label>
                                    <textarea rows={2} value={formData.note} onChange={e => setFormData({ ...formData, note: e.target.value })} className="w-full bg-slate-50 border border-slate-200 p-3.5 rounded-2xl font-bold outline-none focus:border-purple-500 text-sm" placeholder="เช่น เครดิตเทอม 30 วัน, ห้ามหัก ณ ที่จ่าย 3% ฯลฯ" />
                                </div>
                            </div>

                        </form>

                        {/* Modal Footer (ปุ่มกด) */}
                        <div className="p-6 border-t border-slate-100 bg-white flex gap-4 shrink-0">
                            <button onClick={handleSubmit} className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-black uppercase text-sm shadow-xl hover:bg-black active:scale-95 transition-all flex items-center justify-center gap-2">
                                <Save size={18} /> {formData.id ? 'Save Changes' : 'Register Customer'}
                            </button>
                            <button type="button" onClick={() => setIsModalOpen(false)} className="px-8 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase text-sm hover:bg-slate-200 transition-all">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};