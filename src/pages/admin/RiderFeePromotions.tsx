import React, { useState, useEffect, useMemo } from 'react';
import {
    Bike, PlusCircle, Search, Edit2, Trash2, X,
    Save, ToggleLeft, ToggleRight, Gift, Percent, Zap,
    Calendar, CheckCircle2, AlertCircle, Smartphone, ChevronDown, ChevronRight, MapPin
} from 'lucide-react';
import { ref, push, update, remove, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import { THAI_PROVINCES } from '../../data/thaiProvinces';

// Promotions that discount the CUSTOMER pickup_fee (the company absorbs the
// difference; the rider's pay is never reduced). Master records live at
// /rider_fee_promotions. Mirrors CouponManager: fail-closed model restriction
// (is_model_restricted paired with applicable_models), date window, quota.

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

            <div className="flex items-center justify-between mb-2 px-0.5">
                <span className="text-[10px] font-bold text-slate-400">{filteredIds.length} รุ่น{query ? ' (กรองอยู่)' : ''}</span>
                <span className={`text-[10px] font-black ${selected.length ? c.text : 'text-slate-400'}`}>เลือกแล้ว {selected.length} รุ่น</span>
            </div>

            <div className="min-h-[200px] max-h-[340px] border border-slate-200 rounded-xl overflow-y-auto bg-white">
                {tree.length === 0 ? (
                    <div className="text-center text-xs text-slate-400 font-bold py-8">ไม่พบรุ่นที่ตรงกับคำค้นหา</div>
                ) : tree.map((node) => renderNode(node, 0))}
            </div>
        </div>
    );
};

// ─── Province picker: ค้นหา + เลือกหลายจังหวัด ──────────────────────────────
// คืนเป็น array ของ province id (เลข kongvut) ตรงกับ job.provinceId ฝั่งลูกค้า
const ProvinceMultiPicker: React.FC<{
    selected: number[];
    onChange: (ids: number[]) => void;
}> = ({ selected, onChange }) => {
    const [q, setQ] = useState('');
    const selectedSet = useMemo(() => new Set(selected), [selected]);
    const query = q.trim().toLowerCase();

    const filtered = useMemo(() => {
        if (!query) return THAI_PROVINCES;
        return THAI_PROVINCES.filter((p) =>
            p.name_th.toLowerCase().includes(query) || p.name_en.toLowerCase().includes(query)
        );
    }, [query]);
    const filteredIds = useMemo(() => filtered.map((p) => p.id), [filtered]);
    const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedSet.has(id));

    const apply = (ids: number[], on: boolean) => {
        const s = new Set(selected);
        ids.forEach((id) => (on ? s.add(id) : s.delete(id)));
        onChange([...s]);
    };

    return (
        <div className="flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="ค้นหาจังหวัด..."
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 rounded-lg border border-slate-200 text-xs font-bold outline-none focus:ring-2 focus:border-blue-500 focus:ring-blue-100 focus:bg-white"
                    />
                </div>
                <button
                    type="button"
                    onClick={() => apply(filteredIds, !allFilteredSelected)}
                    disabled={!filteredIds.length}
                    className={`px-3 py-2 rounded-lg text-[11px] font-black whitespace-nowrap border transition disabled:opacity-40 ${allFilteredSelected ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-transparent bg-blue-50 text-blue-600 hover:brightness-95'}`}
                >
                    {allFilteredSelected ? 'ล้างที่ค้นเจอ' : 'เลือกทั้งหมด'}
                </button>
            </div>

            <div className="flex items-center justify-between mb-2 px-0.5">
                <span className="text-[10px] font-bold text-slate-400">{filteredIds.length} จังหวัด{query ? ' (กรองอยู่)' : ''}</span>
                <span className={`text-[10px] font-black ${selected.length ? 'text-blue-600' : 'text-slate-400'}`}>เลือกแล้ว {selected.length} จังหวัด</span>
            </div>

            <div className="min-h-[180px] max-h-[300px] border border-slate-200 rounded-xl overflow-y-auto bg-white grid grid-cols-2 sm:grid-cols-3 gap-x-2 p-1">
                {filtered.length === 0 ? (
                    <div className="col-span-full text-center text-xs text-slate-400 font-bold py-8">ไม่พบจังหวัดที่ตรงกับคำค้นหา</div>
                ) : filtered.map((p) => {
                    const checked = selectedSet.has(p.id);
                    return (
                        <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-blue-50/60 transition-colors">
                            <input type="checkbox" checked={checked} onChange={() => apply([p.id], !checked)} className="w-4 h-4 rounded accent-blue-600 cursor-pointer shrink-0" />
                            <span className="text-sm font-bold text-slate-700 truncate">{p.name_th}</span>
                        </label>
                    );
                })}
            </div>
        </div>
    );
};

export const RiderFeePromotions = () => {
    const toast = useToast();
    const [promos, setPromos] = useState<any[]>([]);
    const [modelsData, setModelsData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [seriesData, setSeriesData] = useState<any[]>([]);

    const seriesSubcat = useMemo(() => {
        const map: Record<string, string> = {};
        for (const s of seriesData) { if (s.name) map[s.name] = s.subcategory || ''; }
        return map;
    }, [seriesData]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<any>(null);

    useEffect(() => {
        const promosRef = ref(db, 'rider_fee_promotions');
        const unsubPromos = onValue(promosRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const formatted = Object.keys(data).map(key => ({ id: key, ...data[key] }));
                formatted.sort((a: any, b: any) => (b.created_at || 0) - (a.created_at || 0));
                setPromos(formatted);
            } else {
                setPromos([]);
            }
            setLoading(false);
        });

        const modelsRef = ref(db, 'models');
        const unsubModels = onValue(modelsRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const modelsArray = Object.keys(data).map(key => ({ id: key, ...data[key] }));
                setModelsData(modelsArray.filter((m: any) => m.isActive));
            }
        });

        const seriesRef = ref(db, 'series');
        const unsubSeries = onValue(seriesRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setSeriesData(Object.keys(data).map(key => ({ id: key, ...data[key] })));
            } else {
                setSeriesData([]);
            }
        });

        return () => { unsubPromos(); unsubModels(); unsubSeries(); };
    }, []);

    const handleOpenModal = (item: any = null) => {
        if (item) {
            setEditingItem(JSON.parse(JSON.stringify(item)));
        } else {
            setEditingItem({
                code: '', name: '', discount_type: 'fixed', value: 0,
                max_discount: 0,
                start_date: '', end_date: '',
                total_limit: 100, used_count: 0,
                is_active: true,
                applicable_models: [],
                excluded_models: [],
                applicable_provinces: [],
            });
        }
        setIsModalOpen(true);
    };

    const handleSavePromo = async () => {
        if (!editingItem.code.trim() || !editingItem.name.trim()) { toast.warning('กรุณากรอกรหัสโค้ดและชื่อแคมเปญ'); return; }

        // waive = ลดเต็มจำนวน (value ไม่ต้องกรอก); fixed/percentage ต้อง > 0
        if (editingItem.discount_type !== 'waive' && editingItem.value <= 0) {
            toast.warning('มูลค่าส่วนลดแบบเงินสด/เปอร์เซ็นต์ ต้องมากกว่า 0'); return;
        }

        try {
            // Same fail-closed contract as coupons: is_model_restricted paired
            // with applicable_models so consumers tell "all models" ([] + false)
            // from "restricted but list empty/corrupt" (true + [] => ineligible).
            const isModelRestricted = Array.isArray(editingItem.applicable_models)
                && editingItem.applicable_models.length > 0;
            const isProvinceRestricted = Array.isArray(editingItem.applicable_provinces)
                && editingItem.applicable_provinces.length > 0;
            const payload = {
                ...editingItem,
                is_model_restricted: isModelRestricted,
                is_province_restricted: isProvinceRestricted,
                updated_at: Date.now(),
            };

            if (editingItem.id) {
                await update(ref(db, `rider_fee_promotions/${editingItem.id}`), payload);
            } else {
                payload.created_at = Date.now();
                await push(ref(db, 'rider_fee_promotions'), payload);
            }
            setIsModalOpen(false);
        } catch (error) {
            toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        }
    };

    const handleDeletePromo = async (id: string) => {
        if (confirm('ยืนยันการลบโปรโมชั่นนี้ใช่หรือไม่?')) {
            try {
                await remove(ref(db, `rider_fee_promotions/${id}`));
            } catch (error) {
                toast.error('เกิดข้อผิดพลาดในการลบโปรโมชั่น');
            }
        }
    };

    const handleToggleStatus = async (item: any) => {
        try {
            await update(ref(db, `rider_fee_promotions/${item.id}`), { is_active: !item.is_active });
        } catch (error) {
            toast.error('เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
        }
    };

    const filteredPromos = promos.filter(p =>
        (p.code || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const rewardLabel = (p: any) =>
        p.discount_type === 'percentage' ? `-${p.value}%`
        : p.discount_type === 'waive' ? 'ฟรีค่าบริการ'
        : `-฿${Number(p.value || 0).toLocaleString()}`;

    return (
        <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-slate-50/50">

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Bike className="text-blue-600" size={32} />
                        โปรโมชั่นส่วนลดค่าไรเดอร์
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">ลดค่าบริการรับเครื่อง (Pickup) ให้ลูกค้า โดยบริษัทรับภาระส่วนต่าง — ไม่หักค่าจ้างไรเดอร์</p>
                </div>
                <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-6 py-3.5 rounded-2xl text-sm font-black flex items-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 shrink-0">
                    <PlusCircle size={18} /> สร้างโปรโมชั่นใหม่
                </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-14 h-14 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center"><CheckCircle2 size={24} /></div>
                    <div><p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Active Promotions</p><p className="text-2xl font-black text-slate-800">{promos.filter(p => p.is_active).length}</p></div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-14 h-14 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center"><Bike size={24} /></div>
                    <div><p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Total Applied</p><p className="text-2xl font-black text-slate-800">{promos.reduce((sum, p) => sum + (p.used_count || 0), 0)}</p></div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center"><Zap size={24} /></div>
                    <div><p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Waive Campaigns</p><p className="text-2xl font-black text-slate-800">{promos.filter(p => p.discount_type === 'waive' && p.is_active).length}</p></div>
                </div>
            </div>

            {/* Search */}
            <div className="relative max-w-xl bg-white rounded-2xl shadow-sm border border-slate-200 flex items-center px-5 py-3.5 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-50 transition-all mb-6">
                <Search size={20} className="text-slate-400 mr-3" />
                <input type="text" placeholder="ค้นหาด้วยรหัสโค้ด หรือ ชื่อแคมเปญ..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-transparent border-none outline-none text-sm font-bold text-slate-700 placeholder:text-slate-400" />
            </div>

            {/* Table */}
            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-400 font-black uppercase text-[10px] tracking-widest">
                        <tr>
                            <th className="p-5 pl-8 w-24">Status</th>
                            <th className="p-5">Promotion Details</th>
                            <th className="p-5">Discount / Target</th>
                            <th className="p-5">Usage limit</th>
                            <th className="p-5 text-right pr-8">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan={5} className="p-12 text-center text-slate-400 font-bold animate-pulse">กำลังโหลดข้อมูล...</td></tr>
                        ) : filteredPromos.length === 0 ? (
                            <tr><td colSpan={5} className="p-12 text-center text-slate-400 font-bold">ยังไม่มีโปรโมชั่นค่าไรเดอร์</td></tr>
                        ) : (
                            filteredPromos.map((p) => (
                                <tr key={p.id} className={`hover:bg-blue-50/30 transition-colors ${!p.is_active && 'bg-slate-50/50 opacity-60'}`}>
                                    <td className="p-5 pl-8"><StatusToggle isActive={p.is_active} onToggle={() => handleToggleStatus(p)} /></td>
                                    <td className="p-5">
                                        <div className="flex items-start gap-4">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${p.discount_type === 'percentage' ? 'bg-purple-50 text-purple-500 border-purple-100' : p.discount_type === 'waive' ? 'bg-amber-50 text-amber-500 border-amber-100' : 'bg-emerald-50 text-emerald-500 border-emerald-100'}`}>
                                                {p.discount_type === 'percentage' ? <Percent size={20} /> : p.discount_type === 'waive' ? <Zap size={20} /> : <Gift size={20} />}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-black text-slate-800 text-base">{p.code}</span>
                                                </div>
                                                <div className="text-sm font-bold text-slate-500">{p.name}</div>
                                                <div className="text-[10px] text-slate-400 font-bold mt-1 flex items-center gap-1"><Calendar size={12} /> {p.start_date || '-'} ถึง {p.end_date || 'ไม่มีกำหนด'}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <div className="font-black text-lg text-[#144EE3]">
                                            {rewardLabel(p)}
                                            {p.discount_type === 'percentage' && p.max_discount > 0 && (
                                                <span className="text-[10px] font-bold text-slate-400 ml-1">สูงสุด ฿{Number(p.max_discount).toLocaleString()}</span>
                                            )}
                                        </div>
                                        <div className="text-[10px] font-bold text-slate-500 mt-1 flex items-center gap-1">
                                            <Smartphone size={12} />
                                            {(!p.applicable_models || p.applicable_models.length === 0) ? 'ใช้ได้กับทุกรุ่น' : `จำกัดเฉพาะ ${p.applicable_models.length} รุ่น`}
                                            {p.excluded_models && p.excluded_models.length > 0 && (
                                                <span className="text-rose-500 ml-1">· ยกเว้น {p.excluded_models.length} รุ่น</span>
                                            )}
                                        </div>
                                        <div className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-1">
                                            <MapPin size={12} />
                                            {(!p.applicable_provinces || p.applicable_provinces.length === 0) ? 'ทุกจังหวัด' : `เฉพาะ ${p.applicable_provinces.length} จังหวัด`}
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <div className="w-full bg-slate-100 rounded-full h-2 mb-2 overflow-hidden">
                                            <div className="bg-blue-500 h-full rounded-full" style={{ width: `${Math.min(((p.used_count || 0) / (p.total_limit || 1)) * 100, 100)}%` }}></div>
                                        </div>
                                        <div className="flex justify-between text-[11px] font-black text-slate-500">
                                            <span>{p.used_count || 0} Used</span>
                                            <span>{p.total_limit || 0} Max</span>
                                        </div>
                                    </td>
                                    <td className="p-5 text-right pr-8">
                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => handleOpenModal(p)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition"><Edit2 size={18} /></button>
                                            <button onClick={() => handleDeletePromo(p.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition"><Trash2 size={18} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* MODAL CREATE / EDIT */}
            {isModalOpen && editingItem && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 sm:p-6 lg:p-10">
                    <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-5xl h-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95">

                        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0 z-10">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><Bike size={24} /></div>
                                <div>
                                    <h3 className="font-black text-2xl text-slate-800 tracking-tight">{editingItem.id ? 'แก้ไขโปรโมชั่น' : 'สร้างโปรโมชั่นใหม่'}</h3>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Rider Fee Promotion</p>
                                </div>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full text-slate-400 transition"><X size={20} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 space-y-8">

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Basic Info */}
                                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-5">
                                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2"><Edit2 size={14} /> ข้อมูลแคมเปญพื้นฐาน</h4>

                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">รหัสโค้ด (Promo Code) <span className="text-red-500">*</span></label>
                                        <input type="text" placeholder="เช่น FREERIDE, RIDER50" value={editingItem.code} onChange={(e) => setEditingItem({ ...editingItem, code: e.target.value.toUpperCase() })} className="w-full p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-sm font-black uppercase outline-none focus:border-blue-500 focus:bg-white transition-all" />
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">ชื่อแคมเปญ (Campaign Name) <span className="text-red-500">*</span></label>
                                        <input type="text" placeholder="เช่น ฟรีค่าไรเดอร์ iPhone 17" value={editingItem.name} onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })} className="w-full p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-blue-500 focus:bg-white transition-all" />
                                    </div>

                                    <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-2xl">
                                        <p className="text-[11px] font-bold text-blue-700 leading-relaxed">โปรนี้ลดเฉพาะ "ค่าบริการรับเครื่อง" (Pickup) ที่หักจากลูกค้าเท่านั้น — Store-in / Mail-in ไม่มีค่าบริการ และค่าจ้างไรเดอร์ยังจ่ายเต็ม</p>
                                    </div>
                                </div>

                                {/* Discount Value */}
                                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-5">
                                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2"><Gift size={14} /> รูปแบบส่วนลด</h4>

                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">ประเภทส่วนลด (Discount Type)</label>
                                        <select value={editingItem.discount_type} onChange={(e) => {
                                            const newValue = e.target.value === 'waive' ? 0 : editingItem.value;
                                            setEditingItem({ ...editingItem, discount_type: e.target.value, value: newValue });
                                        }} className="w-full p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-blue-500">
                                            <option value="fixed">ลดเป็นจำนวนเงินคงที่ (Fixed)</option>
                                            <option value="percentage">ลดเป็นเปอร์เซ็นต์ของค่าบริการ (%)</option>
                                            <option value="waive">ฟรีเต็มจำนวน (Waive)</option>
                                        </select>
                                    </div>

                                    {editingItem.discount_type !== 'waive' && (
                                        <div className="flex gap-4">
                                            <div className="flex-1">
                                                <label className="text-xs font-bold text-slate-500 mb-1.5 block">มูลค่า {editingItem.discount_type === 'percentage' ? '(%)' : '(บาท)'}</label>
                                                <div className="relative">
                                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-rose-500 font-black text-lg">-</span>
                                                    <input type="number" placeholder="0" value={editingItem.value || ''} onChange={(e) => setEditingItem({ ...editingItem, value: Number(e.target.value) })} className="w-full pl-10 p-3.5 bg-rose-50/50 rounded-xl border border-rose-100 text-base font-black text-rose-600 outline-none focus:ring-2 ring-rose-200" />
                                                </div>
                                            </div>

                                            {(editingItem.discount_type === 'percentage' || editingItem.discount_type === 'fixed') && (
                                                <div className="flex-1">
                                                    <label className="text-xs font-bold text-slate-500 mb-1.5 block">ลดสูงสุดไม่เกิน (บาท)</label>
                                                    <input type="number" placeholder="ไม่จำกัด" value={editingItem.max_discount || ''} onChange={(e) => setEditingItem({ ...editingItem, max_discount: Number(e.target.value) })} className="w-full p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none" />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <p className="text-[11px] font-bold text-slate-400">ส่วนลดจะถูกจำกัดไม่ให้เกินค่าบริการจริง (สุทธิต่ำสุด = 0 บาท ลูกค้าไม่ได้เงินคืนเกินค่าบริการ)</p>
                                </div>
                            </div>

                            {/* Rules & Models */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 space-y-6">
                                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2"><AlertCircle size={14} /> กติกาการใช้งาน</h4>

                                    <div>
                                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">จำนวนสิทธิ์ทั้งหมด (สิทธิ์)</label>
                                        <input type="number" placeholder="100" value={editingItem.total_limit} onChange={(e) => setEditingItem({ ...editingItem, total_limit: Number(e.target.value) })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-blue-500" />
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

                                {/* Targeted Models */}
                                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col">
                                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2"><Smartphone size={14} /> ผูกโปรเฉพาะรุ่น (Targeted Models)</h4>

                                    <div className="flex gap-4 mb-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" checked={!editingItem.applicable_models || editingItem.applicable_models.length === 0} onChange={() => setEditingItem({ ...editingItem, applicable_models: [] })} className="w-4 h-4 text-blue-600" />
                                            <span className="text-sm font-bold text-slate-700">ใช้ได้ทุกรุ่น</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" checked={editingItem.applicable_models && editingItem.applicable_models.length > 0} onChange={() => setEditingItem({ ...editingItem, applicable_models: modelsData[0] ? [modelsData[0].id] : [] })} className="w-4 h-4 text-blue-600" />
                                            <span className="text-sm font-bold text-slate-700">ระบุรุ่นเอง</span>
                                        </label>
                                    </div>

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

                            {/* Excluded Models */}
                            <div className="bg-white p-6 rounded-3xl shadow-sm border border-rose-200 flex flex-col">
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-rose-400 border-b border-rose-100 pb-3 mb-2 flex items-center gap-2"><AlertCircle size={14} /> รุ่นที่ไม่ร่วมรายการ (Excluded Models)</h4>
                                <p className="text-[11px] font-bold text-slate-500 mb-4">เลือกรุ่นที่ "ไม่ให้ใช้โปรนี้" — exclude ชนะ include เสมอ</p>

                                <ModelMultiPicker
                                    models={modelsData}
                                    selected={editingItem.excluded_models || []}
                                    onChange={(ids) => setEditingItem({ ...editingItem, excluded_models: ids })}
                                    seriesSubcat={seriesSubcat}
                                    accent="rose"
                                />
                            </div>

                            {/* Targeted Provinces — เข้าร่วมเฉพาะพื้นที่จังหวัดที่กำหนด */}
                            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col">
                                <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2"><MapPin size={14} /> พื้นที่จังหวัดที่ร่วมโปรโมชั่น (Targeted Provinces)</h4>

                                <div className="flex gap-4 mb-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" checked={!editingItem.applicable_provinces || editingItem.applicable_provinces.length === 0} onChange={() => setEditingItem({ ...editingItem, applicable_provinces: [] })} className="w-4 h-4 text-blue-600" />
                                        <span className="text-sm font-bold text-slate-700">ทุกจังหวัด</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" checked={editingItem.applicable_provinces && editingItem.applicable_provinces.length > 0} onChange={() => setEditingItem({ ...editingItem, applicable_provinces: THAI_PROVINCES[0] ? [THAI_PROVINCES[0].id] : [] })} className="w-4 h-4 text-blue-600" />
                                        <span className="text-sm font-bold text-slate-700">ระบุจังหวัดเอง</span>
                                    </label>
                                </div>

                                <p className="text-[11px] font-bold text-slate-500 mb-4">ใช้จับคู่กับจุดรับเครื่อง (Pickup) ของลูกค้า — ต้องเข้าเงื่อนไขทั้งรุ่นและจังหวัด ลูกค้าจึงจะได้ส่วนลด</p>

                                {editingItem.applicable_provinces && editingItem.applicable_provinces.length > 0 && (
                                    <ProvinceMultiPicker
                                        selected={editingItem.applicable_provinces || []}
                                        onChange={(ids) => setEditingItem({ ...editingItem, applicable_provinces: ids })}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-8 py-5 border-t border-slate-200 bg-white flex justify-end gap-4 shrink-0 z-10 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.05)]">
                            <button onClick={() => setIsModalOpen(false)} className="px-8 py-3.5 rounded-2xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition">ยกเลิก</button>
                            <button onClick={handleSavePromo} className="px-10 py-3.5 rounded-2xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2">
                                <Save size={18} /> บันทึกโปรโมชั่น
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default RiderFeePromotions;
