import React, { useState, useEffect, useMemo } from 'react';
import {
    Ticket, PlusCircle, Search, Edit2, Trash2, X,
    Save, ToggleLeft, ToggleRight, Gift, Percent, Zap,
    Calendar, CheckCircle2, AlertCircle, Smartphone, ChevronDown, ChevronRight
} from 'lucide-react';
import { ref, push, update, remove, onValue } from 'firebase/database';
// ⚠️ เช็ค Path ของ Firebase ให้ตรงกับโปรเจกต์ของคุณ
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';

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

// ─── Model picker: ค้นหา + จัดกลุ่มตามหมวดหมู่ + เลือกทั้งกลุ่ม/ทั้งหมด ───────
// ใช้ร่วมกันทั้ง Targeted (include) และ Excluded models. รับ/คืนเป็น array
// ของ model id เท่านั้น — logic การ merge เป็นของ component นี้ที่เดียว
const PICKER_ACCENT = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-600', rowHover: 'hover:bg-blue-50/60', focus: 'focus:border-blue-500 focus:ring-blue-100', check: 'accent-blue-600' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-600', rowHover: 'hover:bg-rose-50/60', focus: 'focus:border-rose-400 focus:ring-rose-100', check: 'accent-rose-600' },
};

interface TreeNode {
    key: string;
    label: string;
    modelIds: string[];
    children?: TreeNode[];
    model?: any;
}

// สร้าง tree 4 ชั้น: Category > Subcategory > Series > Model
// subcategory resolve จาก series.subcategory (ผ่าน seriesSubcat map)
function buildModelTree(models: any[], seriesSubcat: Record<string, string>): TreeNode[] {
    const root = new Map<string, Map<string, Map<string, any[]>>>();
    for (const m of models) {
        const cat = m.category || 'ไม่ระบุหมวดหมู่';
        const ser = m.series || 'ไม่ระบุซีรีส์';
        const sub = (m.series && seriesSubcat[m.series]) || 'ทั่วไป';
        if (!root.has(cat)) root.set(cat, new Map());
        const subMap = root.get(cat)!;
        if (!subMap.has(sub)) subMap.set(sub, new Map());
        const serMap = subMap.get(sub)!;
        if (!serMap.has(ser)) serMap.set(ser, []);
        serMap.get(ser)!.push(m);
    }
    const byKey = <T,>(entries: [string, T][]) => entries.sort((a, b) => a[0].localeCompare(b[0]));
    return byKey([...root]).map(([cat, subMap]) => {
        const subChildren = byKey([...subMap]).map(([sub, serMap]) => {
            const serChildren = byKey([...serMap]).map(([ser, list]) => {
                const modelNodes: TreeNode[] = [...list]
                    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                    .map((m) => ({ key: `m:${m.id}`, label: m.name, modelIds: [m.id], model: m }));
                return { key: `ser:${cat}>${sub}>${ser}`, label: ser, modelIds: modelNodes.flatMap((n) => n.modelIds), children: modelNodes };
            });
            return { key: `sub:${cat}>${sub}`, label: sub, modelIds: serChildren.flatMap((n) => n.modelIds), children: serChildren };
        });
        return { key: `cat:${cat}`, label: cat, modelIds: subChildren.flatMap((n) => n.modelIds), children: subChildren };
    });
}

const ModelMultiPicker: React.FC<{
    models: any[];
    selected: string[];
    onChange: (ids: string[]) => void;
    seriesSubcat: Record<string, string>;
    accent?: 'blue' | 'rose';
}> = ({ models, selected, onChange, seriesSubcat, accent = 'blue' }) => {
    const c = PICKER_ACCENT[accent];
    const [q, setQ] = useState('');
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const selectedSet = useMemo(() => new Set(selected), [selected]);
    const query = q.trim().toLowerCase();

    const filtered = useMemo(() => {
        if (!query) return models;
        return models.filter((m: any) =>
            [m.name, m.brand, m.category, m.series, seriesSubcat[m.series]]
                .some((v: any) => String(v || '').toLowerCase().includes(query))
        );
    }, [models, query, seriesSubcat]);

    const tree = useMemo(() => buildModelTree(filtered, seriesSubcat), [filtered, seriesSubcat]);
    const filteredIds = useMemo(() => filtered.map((m: any) => m.id), [filtered]);
    const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id: string) => selectedSet.has(id));

    const apply = (ids: string[], on: boolean) => {
        const s = new Set(selected);
        ids.forEach((id) => (on ? s.add(id) : s.delete(id)));
        onChange([...s]);
    };

    const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
        // Leaf = model
        if (node.model) {
            const checked = selectedSet.has(node.model.id);
            return (
                <label key={node.key} style={{ paddingLeft: 12 + depth * 18 }} className={`flex items-center gap-2.5 pr-3 py-2 cursor-pointer transition-colors ${c.rowHover}`}>
                    <input type="checkbox" checked={checked} onChange={() => apply([node.model.id], !checked)} className={`w-4 h-4 rounded ${c.check} cursor-pointer shrink-0`} />
                    <span className="text-[10px] font-black text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 uppercase shrink-0">{node.model.brand}</span>
                    <span className="text-sm font-bold text-slate-700 truncate">{node.label}</span>
                </label>
            );
        }
        // Branch (category / subcategory / series)
        const ids = node.modelIds;
        const selCount = ids.filter((id) => selectedSet.has(id)).length;
        const allSel = selCount === ids.length && ids.length > 0;
        const someSel = selCount > 0 && !allSel;
        const expanded = !!query || !collapsed[node.key];
        const labelCls = depth === 0
            ? 'text-[11px] font-black uppercase tracking-wide text-slate-700'
            : depth === 1 ? 'text-xs font-black text-slate-600' : 'text-xs font-bold text-slate-500';
        return (
            <div key={node.key}>
                <div style={{ paddingLeft: 8 + depth * 18 }} className={`flex items-center gap-2 pr-3 py-2 border-b border-slate-50 ${depth === 0 ? `${c.bg} sticky top-0 z-10` : 'bg-white'}`}>
                    <input type="checkbox" checked={allSel} ref={(el) => { if (el) el.indeterminate = someSel; }} onChange={() => apply(ids, !allSel)} className={`w-4 h-4 rounded ${c.check} cursor-pointer shrink-0`} />
                    <button type="button" onClick={() => setCollapsed((p) => ({ ...p, [node.key]: !p[node.key] }))} className="flex items-center gap-1 flex-1 text-left min-w-0">
                        {expanded ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                        <span className={`truncate ${labelCls}`}>{node.label}</span>
                    </button>
                    <span className={`text-[10px] font-black shrink-0 ${selCount ? c.text : 'text-slate-400'}`}>{selCount}/{ids.length}</span>
                </div>
                {expanded && node.children!.map((child) => renderNode(child, depth + 1))}
            </div>
        );
    };

    return (
        <div className="flex flex-col min-h-0">
            {/* Toolbar: search + select-all */}
            <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="ค้นหาหมวดหมู่ / แบรนด์ / รุ่น..."
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        className={`w-full pl-9 pr-3 py-2 bg-slate-50 rounded-lg border border-slate-200 text-xs font-bold outline-none focus:ring-2 ${c.focus} focus:bg-white`}
                    />
                </div>
                <button
                    type="button"
                    onClick={() => apply(filteredIds, !allFilteredSelected)}
                    disabled={!filteredIds.length}
                    className={`px-3 py-2 rounded-lg text-[11px] font-black whitespace-nowrap border transition disabled:opacity-40 ${allFilteredSelected ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : `border-transparent ${c.bg} ${c.text} hover:brightness-95`}`}
                >
                    {allFilteredSelected ? 'ล้างที่ค้นเจอ' : 'เลือกทั้งหมด'}
                </button>
            </div>

            {/* Summary line */}
            <div className="flex items-center justify-between mb-2 px-0.5">
                <span className="text-[10px] font-bold text-slate-400">{filteredIds.length} รุ่น{query ? ' (กรองอยู่)' : ''}</span>
                <span className={`text-[10px] font-black ${selected.length ? c.text : 'text-slate-400'}`}>เลือกแล้ว {selected.length} รุ่น</span>
            </div>

            {/* Tree: Category > Subcategory > Series > Model */}
            <div className="min-h-[200px] max-h-[340px] border border-slate-200 rounded-xl overflow-y-auto bg-white">
                {tree.length === 0 ? (
                    <div className="text-center text-xs text-slate-400 font-bold py-8">ไม่พบรุ่นที่ตรงกับ "{q}"</div>
                ) : tree.map((node) => renderNode(node, 0))}
            </div>
        </div>
    );
};

export const CouponManager = () => {
    const toast = useToast();
    const [coupons, setCoupons] = useState<any[]>([]);
    const [modelsData, setModelsData] = useState<any[]>([]); // 🌟 ดึงข้อมูลรุ่นมือถือมาไว้ให้เลือก
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [seriesData, setSeriesData] = useState<any[]>([]);

    // map ชื่อ series -> subcategory (ใช้สร้าง tree 4 ชั้น Category>Subcategory>Series>Model ใน picker)
    const seriesSubcat = useMemo(() => {
        const map: Record<string, string> = {};
        for (const s of seriesData) { if (s.name) map[s.name] = s.subcategory || ''; }
        return map;
    }, [seriesData]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<any>(null);
    // Global policy: require login before a "new customer only" coupon can be
    // used (settings/coupons/require_login_for_new_customer). Default off.
    const [requireLoginNewCustomer, setRequireLoginNewCustomer] = useState(false);

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

        // โหลด series เพื่อ map subcategory ของแต่ละ series (ใช้ใน tree)
        const seriesRef = ref(db, 'series');
        const unsubSeries = onValue(seriesRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setSeriesData(Object.keys(data).map(key => ({ id: key, ...data[key] })));
            } else {
                setSeriesData([]);
            }
        });

        // นโยบายบังคับ login สำหรับคูปองลูกค้าใหม่
        const reqLoginRef = ref(db, 'settings/coupons/require_login_for_new_customer');
        const unsubReqLogin = onValue(reqLoginRef, (snap) => {
            setRequireLoginNewCustomer(snap.val() === true);
        });

        return () => { unsubCoupons(); unsubModels(); unsubSeries(); unsubReqLogin(); };
    }, []);

    const handleOpenModal = (item: any = null) => {
        if (item) {
            setEditingItem(JSON.parse(JSON.stringify(item)));
        } else {
            setEditingItem({
                code: '', name: '', description: '', type: 'fixed', value: 0,
                min_trade_value: 0, max_discount: 0,
                start_date: '', end_date: '',
                total_limit: 100, used_count: 0,
                is_active: true, show_on_homepage: true,
                new_customer_only: false, // ใช้ได้เฉพาะลูกค้าใหม่ (เช็คฝั่ง server ด้วย uid/เบอร์)
                applicable_models: [], // 🌟 [] = ใช้ได้ทุกรุ่น, ถ้าระบุ ID จะใช้ได้เฉพาะรุ่นนั้นๆ
                excluded_models: [] // 🌟 รุ่นที่ "ไม่ร่วมรายการ" — exclude ชนะ include เสมอ
            });
        }
        setIsModalOpen(true);
    };

    const handleSaveCoupon = async () => {
        if (!editingItem.code.trim() || !editingItem.name.trim()) { toast.warning('กรุณากรอกรหัสโค้ดและชื่อแคมเปญ'); return; }

        // 🌟 แก้บั๊ก: ถ้าไม่ใช่ประเภท Service (ฟรีบริการ) ค่าถึงจะห้ามเป็น 0
        if (editingItem.type !== 'service' && editingItem.value <= 0) {
            toast.warning('มูลค่าคูปองเงินสด/เปอร์เซ็นต์ ต้องมากกว่า 0'); return;
        }

        try {
            // Persist an explicit restriction flag alongside applicable_models.
            // Consumers (checkout, /sell, validateAndCreateOrder) read this to
            // distinguish "intentionally usable on all models" ([] + flag false)
            // from "restricted but the model list is empty/corrupt" (flag true +
            // [] => fail closed). Without it, an empty applicable_models silently
            // means "all models" and a model-locked coupon leaks across categories.
            const isModelRestricted = Array.isArray(editingItem.applicable_models)
                && editingItem.applicable_models.length > 0;
            // Denormalize the human model names next to the IDs so the customer
            // coupon detail can show "iPhone 16, iPhone 16 Pro..." without
            // loading /models on the storefront. IDs stay the source of truth
            // for eligibility; names are display-only and refreshed on each save.
            const nameOfModel = (id: string) => modelsData.find((m: any) => m.id === id)?.name || '';
            const applicable_model_names = (Array.isArray(editingItem.applicable_models) ? editingItem.applicable_models : [])
                .map(nameOfModel)
                .filter(Boolean);
            const payload = { ...editingItem, is_model_restricted: isModelRestricted, applicable_model_names, updated_at: Date.now() };

            if (editingItem.id) {
                await update(ref(db, `coupons/${editingItem.id}`), payload);
            } else {
                payload.created_at = Date.now();
                await push(ref(db, 'coupons'), payload);
            }
            setIsModalOpen(false);
        } catch (error) {
            toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        }
    };

    const handleDeleteCoupon = async (id: string) => {
        if (confirm('ยืนยันการลบคูปองนี้ใช่หรือไม่?')) {
            try {
                await remove(ref(db, `coupons/${id}`));
            } catch (error) {
                toast.error('เกิดข้อผิดพลาดในการลบคูปอง');
            }
        }
    };

    const handleToggleStatus = async (item: any) => {
        try {
            await update(ref(db, `coupons/${item.id}`), { is_active: !item.is_active });
        } catch (error) {
            toast.error('เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
        }
    };

    const handleToggleRequireLogin = async () => {
        const next = !requireLoginNewCustomer;
        try {
            await update(ref(db, 'settings/coupons'), { require_login_for_new_customer: next });
            toast.success(next ? 'เปิดบังคับเข้าสู่ระบบสำหรับคูปองลูกค้าใหม่' : 'ปิดบังคับเข้าสู่ระบบ');
        } catch (error) {
            toast.error('บันทึกการตั้งค่าไม่สำเร็จ');
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

            {/* นโยบายคูปองลูกค้าใหม่ */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between gap-4 mb-6">
                <div>
                    <p className="text-sm font-black text-slate-800">บังคับเข้าสู่ระบบสำหรับคูปอง "เฉพาะลูกค้าใหม่"</p>
                    <p className="text-[11px] font-bold text-slate-400 mt-1">เปิด = ลูกค้าต้องเข้าสู่ระบบก่อนใช้คูปองลูกค้าใหม่ (กันกรอกเบอร์มั่ว) · ปิด = ตรวจด้วยเบอร์/uid เฉยๆ</p>
                </div>
                <button onClick={handleToggleRequireLogin} aria-label="สลับบังคับเข้าสู่ระบบ" className={`relative w-14 h-8 rounded-full transition-colors shrink-0 ${requireLoginNewCustomer ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <span className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${requireLoginNewCustomer ? 'translate-x-6' : ''}`} />
                </button>
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
                                            {c.excluded_models && c.excluded_models.length > 0 && (
                                                <span className="text-rose-500 ml-1">· ยกเว้น {c.excluded_models.length} รุ่น</span>
                                            )}
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

                                    <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-2xl flex items-center justify-between cursor-pointer hover:bg-emerald-50 transition" onClick={() => setEditingItem({ ...editingItem, new_customer_only: !editingItem.new_customer_only })}>
                                        <div>
                                            <p className="text-sm font-black text-emerald-900">เฉพาะลูกค้าใหม่</p>
                                            <p className="text-[10px] font-bold text-emerald-600 mt-1">ใช้ได้เฉพาะคนที่ไม่เคยมีออเดอร์ — ตรวจฝั่ง server ด้วย uid/เบอร์</p>
                                        </div>
                                        <input type="checkbox" checked={!!editingItem.new_customer_only} readOnly className="w-5 h-5 rounded text-emerald-600 pointer-events-none" />
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
                                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col">
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

                                    {/* tree เลือกรุ่น (โชว์เมื่อเลือก "ระบุรุ่นเอง") */}
                                    {editingItem.applicable_models && editingItem.applicable_models.length > 0 && (
                                        <ModelMultiPicker
                                            models={modelsData}
                                            selected={editingItem.applicable_models || []}
                                            onChange={(ids) => setEditingItem({ ...editingItem, applicable_models: ids })}
                                            seriesSubcat={seriesSubcat}
                                            accent="blue"
                                        />
                                    )}
                                </div>

                            </div>

                            {/* 🚫 รุ่นที่ไม่ร่วมรายการ (Excluded Models) — exclude ชนะ include เสมอ */}
                            <div className="bg-white p-6 rounded-3xl shadow-sm border border-rose-200 flex flex-col">
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-rose-400 border-b border-rose-100 pb-3 mb-2 flex items-center gap-2"><AlertCircle size={14} /> รุ่นที่ไม่ร่วมรายการ (Excluded Models)</h4>
                                <p className="text-[11px] font-bold text-slate-500 mb-4">เลือกรุ่นที่ "ไม่ให้ใช้คูปองนี้" — ใช้คู่กับ "ใช้ได้ทุกรุ่น" เพื่อยกเว้นบางรุ่น. หากรุ่นถูกตั้ง Exclude จะใช้คูปองไม่ได้แม้จะอยู่ในรายการที่ระบุ (exclude ชนะ include)</p>

                                {(!editingItem.excluded_models || editingItem.excluded_models.length === 0) && (
                                    <p className="text-xs font-bold text-slate-400 mb-3">ยังไม่มีรุ่นที่ยกเว้น — คูปองนี้ใช้ได้กับทุกรุ่นตามเงื่อนไขด้านบน</p>
                                )}

                                <ModelMultiPicker
                                    models={modelsData}
                                    selected={editingItem.excluded_models || []}
                                    onChange={(ids) => setEditingItem({ ...editingItem, excluded_models: ids })}
                                    seriesSubcat={seriesSubcat}
                                    accent="rose"
                                />
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