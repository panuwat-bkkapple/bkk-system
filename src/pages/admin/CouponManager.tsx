import React, { useState, useEffect } from 'react';
import {
    Ticket, PlusCircle, Search, Edit2, Trash2, X,
    Save, ToggleLeft, ToggleRight, Gift, Percent, Zap,
    Calendar, CheckCircle2, AlertCircle, Smartphone
} from 'lucide-react';
import { ref, push, update, remove, onValue } from 'firebase/database';
// ⚠️ เช็ค Path ของ Firebase ให้ตรงกับโปรเจกต์ของคุณ
import { db } from '../../api/firebase';

const StatusToggle = ({ isActive, onToggle }: { isActive: boolean, onToggle: () => void }) => (
    <button onClick={onToggle} className="flex items-center gap-2 group cursor-pointer w-fit">
        <div className={`text-xs font-black uppercase ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
            {isActive ? 'Active' : 'Inactive'}
        </div>
        {isActive ? (
            <ToggleRight size={28} className="text-emerald-500 group-hover:text-emerald-600 transition" />
        ) : (
            <ToggleLeft size={28} className="text-slate-300 group-hover:text-slate-400 transition" />
        )}
    </button>
);

export const CouponManager = () => {
    const [coupons, setCoupons] = useState<any[]>([]);
    const [modelsData, setModelsData] = useState<any[]>([]); // 🌟 ดึงข้อมูลรุ่นมือถือมาไว้ให้เลือก
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<any>(null);

    useEffect(() => {
        // 🌟 โหลดข้อมูลคูปอง
        const couponsRef = ref(db, 'coupons');
        const unsubCoupons = onValue(couponsRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const formattedData = Object.keys(data).map(key => ({ id: key, ...data[key] }));
                formattedData.sort((a: any, b: any) => (b.created_at || 0) - (a.created_at || 0));
                setCoupons(formattedData);
            } else {
                setCoupons([]);
            }
            setLoading(false);
        });

        // 🌟 โหลดข้อมูลรุ่นโทรศัพท์ (เพื่อเอามาผูกกับคูปอง)
        const modelsRef = ref(db, 'models');
        const unsubModels = onValue(modelsRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const modelsArray = Object.keys(data).map(key => ({ id: key, ...data[key] }));
                // เอาเฉพาะที่เปิด Active อยู่
                setModelsData(modelsArray.filter((m: any) => m.isActive));
            }
        });

        return () => { unsubCoupons(); unsubModels(); };
    }, []);

    const handleOpenModal = (item: any = null) => {
        if (item) {
            setEditingItem(JSON.parse(JSON.stringify(item)));
        } else {
            setEditingItem({
                code: '', name: '', type: 'fixed', value: 0,
                min_trade_value: 0, max_discount: 0,
                start_date: '', end_date: '',
                total_limit: 100, used_count: 0,
                is_active: true, show_on_homepage: true,
                applicable_models: [] // 🌟 [] = ใช้ได้ทุกรุ่น, ถ้าระบุ ID จะใช้ได้เฉพาะรุ่นนั้นๆ
            });
        }
        setIsModalOpen(true);
    };

    const handleSaveCoupon = async () => {
        if (!editingItem.code.trim() || !editingItem.name.trim()) return alert('กรุณากรอกรหัสโค้ดและชื่อแคมเปญ');

        // 🌟 แก้บั๊ก: ถ้าไม่ใช่ประเภท Service (ฟรีบริการ) ค่าถึงจะห้ามเป็น 0
        if (editingItem.type !== 'service' && editingItem.value <= 0) {
            return alert('มูลค่าคูปองเงินสด/เปอร์เซ็นต์ ต้องมากกว่า 0');
        }

        try {
            const payload = { ...editingItem, updated_at: Date.now() };

            if (editingItem.id) {
                await update(ref(db, `coupons/${editingItem.id}`), payload);
            } else {
                payload.created_at = Date.now();
                await push(ref(db, 'coupons'), payload);
            }
            setIsModalOpen(false);
        } catch (error) {
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        }
    };

    const handleDeleteCoupon = async (id: string) => {
        if (confirm('ยืนยันการลบคูปองนี้ใช่หรือไม่?')) await remove(ref(db, `coupons/${id}`));
    };

    const handleToggleStatus = async (item: any) => {
        await update(ref(db, `coupons/${item.id}`), { is_active: !item.is_active });
    };

    // 🌟 ฟังก์ชันจัดการการเลือกรุ่น
    const toggleModelSelection = (modelId: string) => {
        const currentList = editingItem.applicable_models || [];
        if (currentList.includes(modelId)) {
            setEditingItem({ ...editingItem, applicable_models: currentList.filter((id: string) => id !== modelId) });
        } else {
            setEditingItem({ ...editingItem, applicable_models: [...currentList, modelId] });
        }
    };

    const filteredCoupons = coupons.filter(c =>
        c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-slate-50/50">

            {/* 🔝 Header Section */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Ticket className="text-blue-600" size={32} />
                        Coupon & Campaigns
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">จัดการคูปอง สิทธิพิเศษ และโบนัสเพิ่มมูลค่ารับซื้อ (Top-up Value)</p>
                </div>
                <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-6 py-3.5 rounded-2xl text-sm font-black flex items-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 shrink-0">
                    <PlusCircle size={18} /> สร้างแคมเปญใหม่
                </button>
            </div>

            {/* 📊 Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-14 h-14 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center"><CheckCircle2 size={24} /></div>
                    <div><p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Active Campaigns</p><p className="text-2xl font-black text-slate-800">{coupons.filter(c => c.is_active).length}</p></div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-14 h-14 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center"><Ticket size={24} /></div>
                    <div><p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total Redeemed</p><p className="text-2xl font-black text-slate-800">{coupons.reduce((sum, c) => sum + (c.used_count || 0), 0)}</p></div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center"><Zap size={24} /></div>
                    <div><p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Homepage Featured</p><p className="text-2xl font-black text-slate-800">{coupons.filter(c => c.show_on_homepage && c.is_active).length}</p></div>
                </div>
            </div>

            {/* 🔍 Search Bar */}
            <div className="relative max-w-xl bg-white rounded-2xl shadow-sm border border-slate-200 flex items-center px-5 py-3.5 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-50 transition-all mb-6">
                <Search size={20} className="text-slate-400 mr-3" />
                <input type="text" placeholder="ค้นหาด้วยรหัสโค้ด หรือ ชื่อแคมเปญ..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-transparent border-none outline-none text-sm font-bold text-slate-700 placeholder:text-slate-400" />
            </div>

            {/* 📋 Table Section */}
            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-400 font-black uppercase text-[10px] tracking-widest">
                        <tr>
                            <th className="p-5 pl-8 w-24">Status</th>
                            <th className="p-5">Campaign Details</th>
                            <th className="p-5">Reward / Target</th>
                            <th className="p-5">Usage limit</th>
                            <th className="p-5 text-right pr-8">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan={5} className="p-12 text-center text-slate-400 font-bold animate-pulse">กำลังโหลดข้อมูลคูปอง...</td></tr>
                        ) : filteredCoupons.length === 0 ? (
                            <tr><td colSpan={5} className="p-12 text-center text-slate-400 font-bold">ไม่พบข้อมูลคูปอง</td></tr>
                        ) : (
                            filteredCoupons.map((c) => (
                                <tr key={c.id} className={`hover:bg-blue-50/30 transition-colors ${!c.is_active && 'bg-slate-50/50 opacity-60'}`}>
                                    <td className="p-5 pl-8"><StatusToggle isActive={c.is_active} onToggle={() => handleToggleStatus(c)} /></td>
                                    <td className="p-5">
                                        <div className="flex items-start gap-4">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${c.type === 'percentage' ? 'bg-purple-50 text-purple-500 border-purple-100' : c.type === 'service' ? 'bg-amber-50 text-amber-500 border-amber-100' : 'bg-emerald-50 text-emerald-500 border-emerald-100'}`}>
                                                {c.type === 'percentage' ? <Percent size={20} /> : c.type === 'service' ? <Zap size={20} /> : <Gift size={20} />}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-black text-slate-800 text-base">{c.code}</span>
                                                    {c.show_on_homepage && <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest">Show in Home</span>}
                                                </div>
                                                <div className="text-sm font-bold text-slate-500">{c.name}</div>
                                                <div className="text-[10px] text-slate-400 font-bold mt-1 flex items-center gap-1"><Calendar size={12} /> {c.start_date || '-'} ถึง {c.end_date || 'ไม่มีกำหนด'}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <div className="font-black text-lg text-[#144EE3]">
                                            {c.type === 'percentage' ? `+${c.value}%` : c.type === 'service' ? 'Free Service' : `+฿${c.value.toLocaleString()}`}
                                        </div>
                                        {/* 🌟 โชว์สถานะว่าใช้ได้ทุกรุ่น หรือล็อครุ่น */}
                                        <div className="text-[10px] font-bold text-slate-500 mt-1 flex items-center gap-1">
                                            <Smartphone size={12} />
                                            {(!c.applicable_models || c.applicable_models.length === 0) ? 'ใช้ได้กับทุกรุ่น' : `จำกัดเฉพาะ ${c.applicable_models.length} รุ่น`}
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <div className="w-full bg-slate-100 rounded-full h-2 mb-2 overflow-hidden">
                                            <div className="bg-blue-500 h-full rounded-full" style={{ width: `${Math.min(((c.used_count || 0) / c.total_limit) * 100, 100)}%` }}></div>
                                        </div>
                                        <div className="flex justify-between text-[11px] font-black text-slate-500">
                                            <span>{c.used_count || 0} Used</span>
                                            <span>{c.total_limit} Max</span>
                                        </div>
                                    </td>
                                    <td className="p-5 text-right pr-8">
                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => handleOpenModal(c)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition"><Edit2 size={18} /></button>
                                            <button onClick={() => handleDeleteCoupon(c.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition"><Trash2 size={18} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* --- 🛠️ MODAL CREATE / EDIT COUPON --- */}
            {isModalOpen && editingItem && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 sm:p-6 lg:p-10">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-5xl h-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95">

                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0 z-10">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><Ticket size={24} /></div>
                                <div>
                                    <h3 className="font-black text-2xl text-slate-800 tracking-tight">{editingItem.id ? 'แก้ไขคูปอง' : 'สร้างคูปองใหม่ (New Coupon)'}</h3>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Campaign Setup</p>
                                </div>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full text-slate-400 transition"><X size={20} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 space-y-8">

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* 🏷️ Basic Info */}
                                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-5">
                                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2"><Edit2 size={14} /> ข้อมูลแคมเปญพื้นฐาน</h4>

                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">รหัสโค้ดคูปอง (Coupon Code) <span className="text-red-500">*</span></label>
                                        <input type="text" placeholder="เช่น NEW500, IPHONE15" value={editingItem.code} onChange={(e) => setEditingItem({ ...editingItem, code: e.target.value.toUpperCase() })} className="w-full p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-sm font-black uppercase outline-none focus:border-blue-500 focus:bg-white transition-all" />
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">ชื่อแคมเปญ (Campaign Name) <span className="text-red-500">*</span></label>
                                        <input type="text" placeholder="เช่น โบนัสผู้ใช้ใหม่ ขายครั้งแรก" value={editingItem.name} onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })} className="w-full p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white transition-all" />
                                    </div>

                                    <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-2xl flex items-center justify-between cursor-pointer hover:bg-blue-50 transition" onClick={() => setEditingItem({ ...editingItem, show_on_homepage: !editingItem.show_on_homepage })}>
                                        <div>
                                            <p className="text-sm font-black text-blue-900">แสดงในหน้าแรก (Homepage)</p>
                                            <p className="text-[10px] font-bold text-blue-500 mt-1">ให้ลูกค้ากด "เก็บคูปอง" สไตล์ Trip.com ได้เลย</p>
                                        </div>
                                        <input type="checkbox" checked={editingItem.show_on_homepage} readOnly className="w-5 h-5 rounded text-blue-600 pointer-events-none" />
                                    </div>
                                </div>

                                {/* 💰 Reward Value */}
                                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-5">
                                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2"><Gift size={14} /> มูลค่าและรูปแบบของรางวัล</h4>

                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">ประเภทคูปอง (Discount Type)</label>
                                        <select value={editingItem.type} onChange={(e) => {
                                            // ถ้าย้ายมาเป็น Service ให้บังคับ Value = 0
                                            const newValue = e.target.value === 'service' ? 0 : editingItem.value;
                                            setEditingItem({ ...editingItem, type: e.target.value, value: newValue });
                                        }} className="w-full p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-blue-500">
                                            <option value="fixed">บวกเงินเพิ่ม คงที่ (Fixed Top-up)</option>
                                            <option value="percentage">บวกเงินเพิ่ม เปอร์เซ็นต์ (% Top-up)</option>
                                            <option value="service">ฟรีบริการ (เช่น ฟรีค่ารถรับ)</option>
                                        </select>
                                    </div>

                                    {/* ซ่อนช่องกรอกมูลค่า ถ้าเป็นประเภท Service */}
                                    {editingItem.type !== 'service' && (
                                        <div className="flex gap-4">
                                            <div className="flex-1">
                                                <label className="text-xs font-bold text-slate-500 mb-1.5 block">มูลค่า {editingItem.type === 'percentage' ? '(%)' : '(บาท)'}</label>
                                                <div className="relative">
                                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 font-black text-lg">+</span>
                                                    <input type="number" placeholder="0" value={editingItem.value || ''} onChange={(e) => setEditingItem({ ...editingItem, value: Number(e.target.value) })} className="w-full pl-10 p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100 text-base font-black text-emerald-600 outline-none focus:ring-2 ring-emerald-200" />
                                                </div>
                                            </div>

                                            {editingItem.type === 'percentage' && (
                                                <div className="flex-1">
                                                    <label className="text-xs font-bold text-slate-500 mb-1.5 block">ลดสูงสุดไม่เกิน (บาท)</label>
                                                    <input type="number" placeholder="ไม่จำกัด" value={editingItem.max_discount || ''} onChange={(e) => setEditingItem({ ...editingItem, max_discount: Number(e.target.value) })} className="w-full p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none" />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* เพิ่มช่องกรอกเงื่อนไขใน Modal หลังบ้าน */}
                            <div className="col-span-full">
                                <label className="text-xs font-bold text-slate-500 mb-1.5 block">รายละเอียดและเงื่อนไข (Terms & Conditions)</label>
                                <textarea
                                    placeholder="ระบุรายละเอียด เช่น เฉพาะรุ่นที่ร่วมรายการ, จำกัด 1 สิทธิ์/คน..."
                                    value={editingItem.description || ''}
                                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                                    className="w-full p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-sm h-24 resize-none"
                                />
                            </div>

                            {/* 🛑 Rules & Limitations */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                                {/* ฝั่งซ้าย: กฎทั่วไป */}
                                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-6">
                                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2"><AlertCircle size={14} /> กติกาการใช้งาน (General Rules)</h4>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 mb-1.5 block">ยอดรับซื้อขั้นต่ำ (บาท)</label>
                                            <input type="number" placeholder="0" value={editingItem.min_trade_value} onChange={(e) => setEditingItem({ ...editingItem, min_trade_value: Number(e.target.value) })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-blue-500" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 mb-1.5 block">จำนวนสิทธิ์ทั้งหมด (สิทธิ์)</label>
                                            <input type="number" placeholder="100" value={editingItem.total_limit} onChange={(e) => setEditingItem({ ...editingItem, total_limit: Number(e.target.value) })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-blue-500" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 mb-1.5 block">เริ่มแคมเปญ (Start Date)</label>
                                            <input type="date" value={editingItem.start_date} onChange={(e) => setEditingItem({ ...editingItem, start_date: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-blue-500" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 mb-1.5 block">สิ้นสุดแคมเปญ (End Date)</label>
                                            <input type="date" value={editingItem.end_date} onChange={(e) => setEditingItem({ ...editingItem, end_date: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-blue-500" />
                                        </div>
                                    </div>
                                </div>

                                {/* ฝั่งขวา: 🌟 ระบบล็อกรุ่น (Target Models) */}
                                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col h-[300px]">
                                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2"><Smartphone size={14} /> ผูกแคมเปญเฉพาะรุ่น (Targeted Models)</h4>

                                    <div className="flex gap-4 mb-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" checked={!editingItem.applicable_models || editingItem.applicable_models.length === 0} onChange={() => setEditingItem({ ...editingItem, applicable_models: [] })} className="w-4 h-4 text-blue-600" />
                                            <span className="text-sm font-bold text-slate-700">ใช้ได้ทุกรุ่น</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" checked={editingItem.applicable_models && editingItem.applicable_models.length > 0} onChange={() => setEditingItem({ ...editingItem, applicable_models: [modelsData[0]?.id] })} className="w-4 h-4 text-blue-600" />
                                            <span className="text-sm font-bold text-slate-700">ระบุรุ่นเอง</span>
                                        </label>
                                    </div>

                                    {/* กล่องเลือกรุ่น (จะโชว์ก็ต่อเมื่อเลือกระบุรุ่นเอง) */}
                                    {editingItem.applicable_models && editingItem.applicable_models.length > 0 && (
                                        <div className="flex-1 border border-slate-200 rounded-xl overflow-y-auto p-2 bg-slate-50">
                                            {modelsData.map((model) => (
                                                <label key={model.id} className="flex items-center gap-3 p-2 hover:bg-blue-50 rounded-lg cursor-pointer transition-colors border-b border-slate-100 last:border-0">
                                                    <input
                                                        type="checkbox"
                                                        checked={editingItem.applicable_models.includes(model.id)}
                                                        onChange={() => toggleModelSelection(model.id)}
                                                        className="w-4 h-4 text-blue-600 rounded"
                                                    />
                                                    <div className="flex-1 flex items-center gap-3">
                                                        <span className="text-[10px] font-black text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200 uppercase w-16 text-center">{model.brand}</span>
                                                        <span className="text-sm font-bold text-slate-700 truncate">{model.name}</span>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                    {editingItem.applicable_models && editingItem.applicable_models.length > 0 && (
                                        <div className="text-[10px] font-bold text-blue-500 mt-2 text-right">
                                            เลือกแล้ว {editingItem.applicable_models.length} รุ่น
                                        </div>
                                    )}
                                </div>

                            </div>
                        </div>

                        {/* Footer Buttons */}
                        <div className="px-8 py-5 border-t border-slate-200 bg-white flex justify-end gap-4 shrink-0 z-10 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.05)]">
                            <button onClick={() => setIsModalOpen(false)} className="px-8 py-3.5 rounded-2xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition">ยกเลิก</button>
                            <button onClick={handleSaveCoupon} className="px-10 py-3.5 rounded-2xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2">
                                <Save size={18} /> บันทึกแคมเปญ
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};