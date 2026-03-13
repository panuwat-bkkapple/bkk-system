'use client';

import { getAuth } from 'firebase/auth';
import React, { useState, useEffect } from 'react';
import {
  Smartphone, Tablet, Laptop, Watch, Camera,
  Gamepad2, Search, ToggleLeft, ToggleRight,
  PlusCircle, Settings, Pencil, Trash2,
  X, Image as ImageIcon, Plus, ClipboardList, Layers, Star, Save, FolderTree
} from 'lucide-react';
import { ref, push, update, remove, onValue } from 'firebase/database';
import { db, app } from '../../api/firebase';
import toast from 'react-hot-toast';

// 🌟 SCHEMA มาตรฐานระดับ ENTERPRISE
const CATEGORY_SCHEMAS: Record<string, {key: string, label: string, type: string, options?: string[]}[]> = {
  'Smartphones': [
    { key: 'storage', label: 'Storage (ความจุ)', type: 'text' }
  ],
  'Tablets': [
    { key: 'connectivity', label: 'Network (เครือข่าย)', type: 'select', options: ['Wi-Fi', 'Wi-Fi + Cellular'] },
    { key: 'storage', label: 'Storage (ความจุ)', type: 'text' }
  ],
  'Mac / Laptop': [
    { key: 'processor', label: 'Processor (ชิป)', type: 'text' },
    { key: 'ram', label: 'RAM (หน่วยความจำ)', type: 'text' },
    { key: 'storage', label: 'Storage (ความจุ)', type: 'text' },
    { key: 'display', label: 'Display (จอ)', type: 'select', options: ['Standard Glass', 'Nano-Texture'] }
  ],
  'Smart Watch': [
    { key: 'size', label: 'Size (ขนาด)', type: 'text' },
    { key: 'case_material', label: 'Case (วัสดุ)', type: 'select', options: ['Aluminium', 'Stainless Steel', 'Titanium', 'Black Titanium'] },
    { key: 'connectivity', label: 'Network (ระบบ)', type: 'select', options: ['GPS', 'GPS + Cellular'] }
  ],
  'Camera': [
    { key: 'type', label: 'Type (ประเภท)', type: 'text' }
  ],
  'Game System': [
    { key: 'storage', label: 'Storage / Edition', type: 'text' }
  ]
};

// --- Component สำหรับปุ่ม เปิด/ปิด Status ---
const StatusToggle = ({ isActive, onToggle }: { isActive: boolean, onToggle: () => void }) => {
  return (
    <button onClick={onToggle} className="flex items-center gap-2 group cursor-pointer w-fit">
      <div className={`text-xs font-black uppercase ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
        {isActive ? 'On' : 'Off'}
      </div>
      {isActive ? (
        <ToggleRight size={28} className="text-emerald-500 group-hover:text-emerald-600 transition" />
      ) : (
        <ToggleLeft size={28} className="text-slate-300 group-hover:text-slate-400 transition" />
      )}
    </button>
  );
};

export const PriceEditor = () => {
  // --- States หลัก ---
  const [activeCategory, setActiveCategory] = useState('Smart Watch'); 
  const [activeBrand, setActiveBrand] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // --- States สำหรับจัดการ Series ---
  const [availableSeries, setAvailableSeries] = useState<any[]>([]);
  const [isAddingSeries, setIsAddingSeries] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState('');

  const [modelsData, setModelsData] = useState<any[]>([]);
  const [conditionSets, setConditionSets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // --- States สำหรับ Modal เพิ่ม/แก้ไขสินค้า ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isSeriesModalOpen, setIsSeriesModalOpen] = useState(false);

  // --- States สำหรับ Modal จัดการ Engine ---
  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);

  // --- ข้อมูลพื้นฐาน ---
  const categories = [
    { id: 'Smartphones', icon: <Smartphone size={18} /> },
    { id: 'Tablets', icon: <Tablet size={18} /> },
    { id: 'Mac / Laptop', icon: <Laptop size={18} /> },
    { id: 'Smart Watch', icon: <Watch size={18} /> },
    { id: 'Camera', icon: <Camera size={18} /> },
    { id: 'Game System', icon: <Gamepad2 size={18} /> },
  ];
  const brands = ['All', 'Apple', 'Samsung', 'Google', 'Oppo', 'Vivo', 'Sony', 'Nintendo'];

  // --- ดึงข้อมูลจาก Firebase ---
  useEffect(() => {
    const modelsRef = ref(db, 'models');
    const unsubModels = onValue(modelsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const formattedData = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        formattedData.sort((a: any, b: any) => b.updatedAt - a.updatedAt);
        setModelsData(formattedData);
      } else {
        setModelsData([]);
      }
      setLoading(false);
    });

    const seriesRef = ref(db, 'series');
    const unsubSeries = onValue(seriesRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const formatted = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        formatted.sort((a, b) => a.name.localeCompare(b.name));
        setAvailableSeries(formatted);
      } else {
        setAvailableSeries([]);
      }
    });

    const conditionsRef = ref(db, 'settings/condition_sets');
    const unsubConditions = onValue(conditionsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const formattedSets = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        setConditionSets(formattedSets);
      } else {
        setConditionSets([]);
      }
    });

    return () => { unsubModels(); unsubConditions(); unsubSeries(); };
  }, []);

  const handleSaveModel = async () => {
    if (!editingItem.name.trim()) return toast.error('กรุณากรอกชื่อรุ่นด้วยครับ');
    if (!editingItem.conditionSetId) return toast.error('กรุณาเลือก Assign Your Condition Item ด้วยครับ');

    try {
      const auth = getAuth(app);
      const adminUser = auth.currentUser?.email || 'System Admin';
      const originalModel = modelsData.find(m => m.id === editingItem.id);

      // 🌟 แปลง Attributes กลับเป็น String ยาวๆ เพื่อให้ระบบเก่า (เช่น Statement) ทำงานได้ปกติ
      const processedVariants = editingItem.variants.map((v: any) => {
          // ใช้ schema เป็นตัวอ้างอิงลำดับการต่อ string
          const schema = editingItem.attributesSchema || CATEGORY_SCHEMAS[editingItem.category] || CATEGORY_SCHEMAS['Smartphones'];
          const orderedValues = schema
            .map((schemaAttr: any) => v.attributes?.[schemaAttr.key])
            .filter(Boolean);
          
          return {
             ...v,
             name: orderedValues.join(' | ') || v.name // Backup name
          };
      });

      const payload = {
        brand: editingItem.brand,
        category: editingItem.category,
        series: editingItem.series || '',
        name: editingItem.name,
        imageUrl: editingItem.imageUrl || '',
        isActive: editingItem.isActive ?? true,
        isFeatured: editingItem.isFeatured ?? false,
        inStore: editingItem.inStore ?? true,
        pickup: editingItem.pickup ?? true,
        mailIn: editingItem.mailIn ?? true,
        conditionSetId: editingItem.conditionSetId,
        attributesSchema: editingItem.attributesSchema, // 🌟 Save Schema สำหรับหน้าบ้าน
        variants: processedVariants,
        updatedAt: Date.now()
      };

      let finalModelId = editingItem.id;

      if (editingItem.id && !editingItem.id.startsWith(Date.now().toString().substring(0, 5))) {
        await update(ref(db, `models/${editingItem.id}`), payload);
      } else {
        const newRef = push(ref(db, 'models'));
        await update(newRef, payload);
        finalModelId = newRef.key;
      }

      // บันทึก Statement
      if (processedVariants.length > 0) {
        processedVariants.forEach(async (v: any) => {
          const newPrice = Number(v.usedPrice || v.price || 0);
          let prevPrice = newPrice; 

          if (originalModel && originalModel.variants) {
            const origVariant = originalModel.variants.find((ov: any) => ov.id === v.id || ov.name === v.name);
            if (origVariant) { prevPrice = Number(origVariant.usedPrice || origVariant.price || 0); } 
            else { prevPrice = 0; }
          }

          if (newPrice !== prevPrice || prevPrice === 0) {
            const ledgerPayload = {
              model_id: finalModelId,
              model_name: editingItem.name,
              variant_name: v.name,
              price: newPrice,
              previous_price: prevPrice,
              updated_by: adminUser,
              updated_at: Date.now()
            };
            const ledgerRef = push(ref(db, 'price_ledger'));
            await update(ledgerRef, ledgerPayload);
          }
        });
      }

      setIsModalOpen(false);
      toast.success('บันทึกข้อมูลและโครงสร้างใหม่เรียบร้อยครับ! 🚀');
    } catch (error) {
      toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูลครับ');
      console.error(error);
    }
  };

  const handleAddNewSeries = async () => {
    if (!newSeriesName.trim()) return toast.error('กรุณาพิมพ์ชื่อ Series ก่อนบันทึกครับ');
    try {
      const newRef = push(ref(db, 'series'));
      await update(newRef, { name: newSeriesName.trim(), brand: editingItem.brand || 'Apple', category: editingItem.category || 'Tablets' });
      toast.success(`เพิ่ม Series: ${newSeriesName} สำเร็จ!`);
      setEditingItem({ ...editingItem, series: newSeriesName.trim() });
      setNewSeriesName('');
      setIsAddingSeries(false);
    } catch (error) { console.error(error); toast.error('เกิดข้อผิดพลาดในการเพิ่ม Series'); }
  };

  const handleDeleteModel = async (id: string) => { if (confirm('ยืนยันการลบรุ่นสินค้านี้ใช่หรือไม่?')) await remove(ref(db, `models/${id}`)); };
  const handleToggleStatus = async (item: any) => { await update(ref(db, `models/${item.id}`), { isActive: !item.isActive }); };
  const handleToggleFeatured = async (item: any) => { await update(ref(db, `models/${item.id}`), { isFeatured: !item.isFeatured }); };

  const handleOpenModal = (item: any = null) => {
    if (item) {
      // 🌟 Auto-Migration: ดึงข้อมูลเดิมมาหั่นเป็น Attributes ชั่วคราวถ้ายังไม่มี
      const editingObj = JSON.parse(JSON.stringify(item));
      const schema = editingObj.attributesSchema || CATEGORY_SCHEMAS[editingObj.category] || CATEGORY_SCHEMAS['Smartphones'];
      
      editingObj.attributesSchema = schema;
      editingObj.variants = editingObj.variants.map((v: any) => {
          if (!v.attributes) {
              v.attributes = {};
              const parts = (v.name || '').split('|').map((s: string) => s.trim());
              
              if (editingObj.category === 'Mac / Laptop') {
                  v.attributes.processor = parts[0] || '';
                  v.attributes.ram = parts[1] || '';
                  v.attributes.storage = parts[2] || '';
                  v.attributes.display = parts[3] || '';
              } else if (editingObj.category === 'Tablets') {
                  v.attributes.connectivity = parts[0] || '';
                  v.attributes.storage = parts[1] || '';
              } else if (editingObj.category === 'Smart Watch') {
                  v.attributes.size = parts[0] || '';
                  v.attributes.case_material = parts[1] || '';
                  v.attributes.connectivity = parts[2] || '';
              } else {
                  v.attributes.storage = parts[0] || v.name || '';
              }
          }
          return v;
      });
      setEditingItem(editingObj);
    } else {
      // ของใหม่
      const schema = CATEGORY_SCHEMAS[activeCategory] || CATEGORY_SCHEMAS['Smartphones'];
      setEditingItem({
        id: Date.now().toString(),
        brand: activeBrand === 'All' ? 'Apple' : activeBrand,
        category: activeCategory,
        series: '', name: '', imageUrl: '', isActive: true, isFeatured: false, inStore: true, pickup: true, mailIn: true,
        conditionSetId: conditionSets.length > 0 ? conditionSets[0].id : '',
        attributesSchema: schema,
        variants: [{ id: 'v1', attributes: {}, name: '', newPrice: 0, usedPrice: 0 }]
      });
    }
    setIsModalOpen(true);
  };

  const handleCategoryChange = (newCat: string) => {
     const schema = CATEGORY_SCHEMAS[newCat] || CATEGORY_SCHEMAS['Smartphones'];
     setEditingItem({ ...editingItem, category: newCat, attributesSchema: schema });
  };

  const handleAddVariant = () => {
    setEditingItem({ ...editingItem, variants: [...(editingItem.variants || []), { id: Date.now().toString(), attributes: {}, name: '', newPrice: 0, usedPrice: 0 }] });
  };

  const handleRemoveVariant = (id: string) => {
    setEditingItem({ ...editingItem, variants: editingItem.variants.filter((v: any) => v.id !== id) });
  };

  // --- Dynamic Attribute Change Handler ---
  const handleAttributeChange = (variantIndex: number, attrKey: string, value: string) => {
     const newVariants = [...editingItem.variants];
     if (!newVariants[variantIndex].attributes) newVariants[variantIndex].attributes = {};
     newVariants[variantIndex].attributes[attrKey] = value;
     setEditingItem({ ...editingItem, variants: newVariants });
  };

  const filteredModels = modelsData.filter(item => {
    const matchCategory = item.category === activeCategory;
    const matchBrand = activeBrand === 'All' || item.brand === activeBrand;
    const matchSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || (item.series && item.series.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCategory && matchBrand && matchSearch;
  });

  // =========================================================================
  // 🌟 FULL ENGINE SETTINGS MODAL (ตัวเต็ม 100%)
  // =========================================================================
  const EngineSettingsModal = () => {
    const [activeSetId, setActiveSetId] = useState<string | null>(conditionSets.length > 0 ? conditionSets[0].id : null);
    const [editingSet, setEditingSet] = useState<any>(null);

    useEffect(() => {
      if (activeSetId) {
        const found = conditionSets.find(c => c.id === activeSetId);
        if (found) setEditingSet(JSON.parse(JSON.stringify(found)));
      } else {
        setEditingSet(null);
      }
    }, [activeSetId, conditionSets]);

    const handleCreateNewSet = async () => {
      const newRef = await push(ref(db, 'settings/condition_sets'), {
        name: 'ชุดประเมินใหม่',
        groups: [{ id: 'g_' + Date.now(), title: 'หัวข้อประเมินใหม่', options: [{ id: 'o_' + Date.now(), label: 'ตัวเลือก 1', t1: 0, t2: 0, t3: 0 }] }]
      });
      setActiveSetId(newRef.key);
    };

    const handleSaveSet = async () => {
      if (!editingSet) return;
      await update(ref(db, `settings/condition_sets/${editingSet.id}`), { name: editingSet.name, groups: editingSet.groups || [] });
      toast.success('บันทึกชุดประเมินสำเร็จ!');
    };

    const handleDeleteSet = async (id: string) => {
      if (confirm('ยืนยันการลบชุดประเมินนี้? หากมีสินค้ารุ่นไหนใช้อยู่จะทำให้การประเมินราคาพังได้')) {
        await remove(ref(db, `settings/condition_sets/${id}`));
        setActiveSetId(conditionSets.length > 0 ? conditionSets[0].id : null);
      }
    }

    const handleAddGroup = () => {
      const newGroups = [...(editingSet.groups || [])];
      newGroups.push({ id: 'g_' + Date.now(), title: 'หัวข้อประเมินใหม่', options: [{ id: 'o_' + Date.now(), label: 'ตัวเลือกใหม่', t1: 0, t2: 0, t3: 0 }] });
      setEditingSet({ ...editingSet, groups: newGroups });
    }

    const handleRemoveGroup = (groupIndex: number) => {
      const newGroups = [...editingSet.groups];
      newGroups.splice(groupIndex, 1);
      setEditingSet({ ...editingSet, groups: newGroups });
    }

    const handleAddOption = (groupIndex: number) => {
      const newGroups = [...editingSet.groups];
      newGroups[groupIndex].options.push({ id: 'o_' + Date.now(), label: '', t1: 0, t2: 0, t3: 0 });
      setEditingSet({ ...editingSet, groups: newGroups });
    }

    const handleRemoveOption = (groupIndex: number, optionIndex: number) => {
      const newGroups = [...editingSet.groups];
      newGroups[groupIndex].options.splice(optionIndex, 1);
      setEditingSet({ ...editingSet, groups: newGroups });
    }

    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-[60] p-4 lg:p-10">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden">
          <div className="px-8 py-5 border-b flex justify-between items-center bg-white shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center"><ClipboardList size={24} /></div>
              <div>
                <h3 className="font-black text-2xl text-slate-800">Condition Sets Engine</h3>
                <p className="text-sm text-slate-500 font-bold">สร้างชุดคำถามประเมินสภาพ และผูกกับหมวดหมู่สินค้า</p>
              </div>
            </div>
            <button onClick={() => setIsEngineModalOpen(false)} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full transition"><X size={24} /></button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar Left: List of Sets */}
            <div className="w-80 bg-slate-50 border-r p-6 flex flex-col gap-3 overflow-y-auto shrink-0">
              <button onClick={handleCreateNewSet} className="w-full py-3 bg-white border border-dashed border-indigo-300 text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition mb-2 flex items-center justify-center gap-2">
                <Plus size={18} /> สร้างชุดประเมินใหม่
              </button>
              {conditionSets.map(set => (
                <div key={set.id} className={`p-4 rounded-2xl cursor-pointer border-2 transition-all group relative ${activeSetId === set.id ? 'bg-indigo-50 border-indigo-500' : 'bg-white border-transparent hover:border-slate-200'}`} onClick={() => setActiveSetId(set.id)}>
                  <div className={`font-black text-sm pr-6 ${activeSetId === set.id ? 'text-indigo-900' : 'text-slate-700'}`}>{set.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{set.groups?.length || 0} หัวข้อคำถาม</div>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteSet(set.id); }} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            {/* Main Area: Editor */}
            <div className="flex-1 bg-white flex flex-col overflow-hidden">
              {editingSet ? (
                <>
                  <div className="p-8 pb-4 border-b flex justify-between items-center bg-white shrink-0 z-10 shadow-sm">
                    <div className="flex-1 mr-8">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Condition Set Name (ชื่อชุดประเมิน)</label>
                      <input type="text" value={editingSet.name} onChange={(e) => setEditingSet({ ...editingSet, name: e.target.value })} className="text-2xl font-black text-slate-800 border-none outline-none focus:ring-0 p-0 w-full bg-transparent" />
                    </div>
                    <button onClick={handleSaveSet} className="px-8 py-3 bg-indigo-600 text-white font-black rounded-xl hover:bg-indigo-700 transition flex items-center gap-2 shadow-lg hover:shadow-indigo-500/30">
                      <Save size={18} /> Save Set
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 space-y-8">
                    {editingSet.groups?.map((g: any, gi: number) => (
                      <div key={g.id} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative group/group">

                        {/* Group Header */}
                        <div className="flex justify-between items-center mb-6">
                          <input type="text" placeholder="ชื่อหัวข้อ (เช่น สภาพตัวเครื่อง)" value={g.title} onChange={(e) => { const n = [...editingSet.groups]; n[gi].title = e.target.value; setEditingSet({ ...editingSet, groups: n }); }} className="font-black text-xl bg-transparent border-none outline-none w-full flex-1 mr-4 focus:text-indigo-600 transition-colors" />
                          <button onClick={() => handleRemoveGroup(gi)} className="text-slate-300 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition opacity-0 group-hover/group:opacity-100">
                            <Trash2 size={20} />
                          </button>
                        </div>

                        {/* Options Table Header */}
                        <div className="grid grid-cols-12 gap-3 mb-2 px-2">
                          <div className="col-span-5"><span className="text-[10px] font-black uppercase text-slate-400">Condition Option (ตัวเลือก)</span></div>
                          <div className="col-span-2 text-center"><span className="text-[10px] font-black uppercase text-red-500">Tier 1 Deduct (฿)</span></div>
                          <div className="col-span-2 text-center"><span className="text-[10px] font-black uppercase text-amber-500">Tier 2 Deduct (฿)</span></div>
                          <div className="col-span-2 text-center"><span className="text-[10px] font-black uppercase text-emerald-500">Tier 3 Deduct (฿)</span></div>
                          <div className="col-span-1"></div>
                        </div>

                        {/* Options List */}
                        <div className="space-y-2">
                          {g.options.map((o: any, oi: number) => (
                            <div key={o.id} className="grid grid-cols-12 gap-3 items-center bg-slate-50 p-2 rounded-xl border border-slate-100 group/option hover:border-indigo-200 transition-colors">
                              <div className="col-span-5">
                                <input type="text" placeholder="เช่น สวยสมบูรณ์" value={o.label} onChange={(e) => { const n = [...editingSet.groups]; n[gi].options[oi].label = e.target.value; setEditingSet({ ...editingSet, groups: n }); }} className="w-full px-4 py-2.5 rounded-lg border-none bg-white shadow-sm text-sm font-bold focus:ring-2 focus:ring-indigo-500" />
                              </div>
                              <div className="col-span-2">
                                <input type="number" value={o.t1} onChange={(e) => { const n = [...editingSet.groups]; n[gi].options[oi].t1 = Number(e.target.value); setEditingSet({ ...editingSet, groups: n }); }} className="w-full px-2 py-2.5 rounded-lg border-none bg-white shadow-sm text-center font-black text-red-600 focus:ring-2 focus:ring-red-500" />
                              </div>
                              <div className="col-span-2">
                                <input type="number" value={o.t2} onChange={(e) => { const n = [...editingSet.groups]; n[gi].options[oi].t2 = Number(e.target.value); setEditingSet({ ...editingSet, groups: n }); }} className="w-full px-2 py-2.5 rounded-lg border-none bg-white shadow-sm text-center font-black text-amber-600 focus:ring-2 focus:ring-amber-500" />
                              </div>
                              <div className="col-span-2">
                                <input type="number" value={o.t3} onChange={(e) => { const n = [...editingSet.groups]; n[gi].options[oi].t3 = Number(e.target.value); setEditingSet({ ...editingSet, groups: n }); }} className="w-full px-2 py-2.5 rounded-lg border-none bg-white shadow-sm text-center font-black text-emerald-600 focus:ring-2 focus:ring-emerald-500" />
                              </div>
                              <div className="col-span-1 flex justify-center">
                                <button onClick={() => handleRemoveOption(gi, oi)} className="text-slate-300 hover:text-red-500 p-2 rounded-lg opacity-0 group-hover/option:opacity-100 transition">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        <button onClick={() => handleAddOption(gi)} className="mt-4 text-sm font-bold text-indigo-600 flex items-center gap-1 hover:text-indigo-800 transition px-2 py-1">
                          <Plus size={16} /> เพิ่มตัวเลือก
                        </button>
                      </div>
                    ))}

                    <button onClick={handleAddGroup} className="w-full py-6 rounded-[2rem] border-2 border-dashed border-indigo-200 text-indigo-500 font-black hover:bg-indigo-50 hover:border-indigo-400 transition flex items-center justify-center gap-2">
                      <PlusCircle size={24} /> เพิ่มหัวข้อการประเมินใหม่
                    </button>
                  </div>
                </>
              ) : <div className="flex-1 flex items-center justify-center text-slate-400 font-bold bg-slate-50/50">👈 เลือกหรือสร้างชุดประเมินจากเมนูด้านซ้าย</div>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // =========================================================================
  // 🌟 FULL SERIES MANAGEMENT MODAL (ตัวเต็ม 100%)
  // =========================================================================
  const SeriesManagementModal = () => {
    const [activeSeriesId, setActiveSeriesId] = useState<string | null>(availableSeries.length > 0 ? availableSeries[0].id : null);
    const [editingSeries, setEditingSeries] = useState<any>(null);

    useEffect(() => {
      if (activeSeriesId) {
        const found = availableSeries.find(s => s.id === activeSeriesId);
        if (found) setEditingSeries(JSON.parse(JSON.stringify(found)));
      } else {
        setEditingSeries(null);
      }
    }, [activeSeriesId, availableSeries]);

    const handleCreateNewSeriesModal = async () => {
      const newRef = push(ref(db, 'series'));
      await update(newRef, {
        name: 'New Series',
        brand: 'Apple',
        category: 'Tablets',
        imageUrl: ''
      });
      setActiveSeriesId(newRef.key);
      toast.success('สร้าง Series ใหม่เรียบร้อย');
    };

    const handleSaveSeriesModal = async () => {
      if (!editingSeries || !editingSeries.name.trim()) return toast.error('กรุณาระบุชื่อ Series');

      await update(ref(db, `series/${editingSeries.id}`), {
        name: editingSeries.name,
        brand: editingSeries.brand || 'Apple',
        category: editingSeries.category || 'Tablets',
        imageUrl: editingSeries.imageUrl || ''
      });

      toast.success('บันทึกข้อมูล Series สำเร็จ!');
    };

    const handleDeleteSeriesModal = async (id: string, seriesName: string) => {
      const modelsInThisSeries = modelsData.filter(m => m.series === seriesName);
      if (modelsInThisSeries.length > 0) {
        toast.error(`ลบไม่ได้! มีสินค้าผูกกับ Series นี้อยู่ ${modelsInThisSeries.length} รายการ`);
        return;
      }

      if (confirm('ยืนยันการลบ Series นี้ใช่หรือไม่?')) {
        await remove(ref(db, `series/${id}`));
        setActiveSeriesId(availableSeries.length > 0 ? availableSeries[0].id : null);
        toast.success('ลบ Series สำเร็จ');
      }
    }

    const modelsInActiveSeries = editingSeries ? modelsData.filter(m => m.series === editingSeries.name) : [];

    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-[60] p-4 lg:p-10 animate-in fade-in duration-200">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">

          {/* Header */}
          <div className="px-8 py-5 border-b flex justify-between items-center bg-white shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><FolderTree size={24} /></div>
              <div>
                <h3 className="font-black text-2xl text-slate-800">Series Management</h3>
                <p className="text-sm text-slate-500 font-bold">จัดการตระกูลสินค้า รูปไอคอน และรายการที่เกี่ยวข้อง</p>
              </div>
            </div>
            <button onClick={() => setIsSeriesModalOpen(false)} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full transition"><X size={24} /></button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar Left: List of Series */}
            <div className="w-72 bg-slate-50 border-r p-6 flex flex-col gap-3 overflow-y-auto shrink-0">
              <button onClick={handleCreateNewSeriesModal} className="w-full py-3 bg-white border border-dashed border-blue-300 text-blue-600 font-bold rounded-xl hover:bg-blue-50 transition mb-2 flex items-center justify-center gap-2">
                <Plus size={18} /> สร้าง Series ใหม่
              </button>

              {availableSeries.map(series => (
                <div key={series.id} className={`p-4 rounded-2xl cursor-pointer border-2 transition-all group relative ${activeSeriesId === series.id ? 'bg-blue-50 border-blue-500' : 'bg-white border-transparent hover:border-slate-200 shadow-sm'}`} onClick={() => setActiveSeriesId(series.id)}>
                  <div className="flex items-center gap-3">
                    {series.imageUrl ? (
                      <img src={series.imageUrl} alt={series.name} className="w-8 h-8 object-contain drop-shadow-sm" />
                    ) : (
                      <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400"><ImageIcon size={14} /></div>
                    )}
                    <div className={`font-black text-sm truncate pr-6 ${activeSeriesId === series.id ? 'text-blue-900' : 'text-slate-700'}`}>{series.name}</div>
                  </div>

                  <button onClick={(e) => { e.stopPropagation(); handleDeleteSeriesModal(series.id, series.name); }} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            {/* Main Area: Editor */}
            <div className="flex-1 bg-white flex flex-col overflow-hidden">
              {editingSeries ? (
                <>
                  <div className="p-8 pb-4 border-b flex justify-between items-center bg-white shrink-0 z-10">
                    <h3 className="text-xl font-black text-slate-800">แก้ไขข้อมูล: {editingSeries.name}</h3>
                    <button onClick={handleSaveSeriesModal} className="px-6 py-2.5 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 transition flex items-center gap-2 shadow-md">
                      <Save size={18} /> บันทึกการเปลี่ยนแปลง
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
                    <div className="grid grid-cols-2 gap-8 mb-8">
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2">Basic Info</h4>
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">ชื่อ Series (เช่น iPad Pro, iPhone 15)</label>
                          <input type="text" value={editingSeries.name} onChange={e => setEditingSeries({ ...editingSeries, name: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs font-bold text-slate-500 block mb-1">Brand</label>
                            <select value={editingSeries.brand} onChange={e => setEditingSeries({ ...editingSeries, brand: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold outline-none">
                              {brands.filter(b => b !== 'All').map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-bold text-slate-500 block mb-1">Category</label>
                            <select value={editingSeries.category} onChange={e => setEditingSeries({ ...editingSeries, category: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold outline-none">
                              {categories.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2">Menu Icon Image</h4>
                        <div className="flex gap-4 items-start">
                          <div className="w-24 h-24 bg-slate-50 rounded-2xl border border-dashed border-slate-300 flex items-center justify-center shrink-0 p-2">
                            {editingSeries.imageUrl ? <img src={editingSeries.imageUrl} alt="icon" className="max-w-full max-h-full object-contain drop-shadow-md" /> : <ImageIcon className="text-slate-300" size={32} />}
                          </div>
                          <div className="flex-1">
                            <label className="text-xs font-bold text-slate-500 block mb-1">Image URL (รูปโปร่งใสพื้นหลัง PNG)</label>
                            <input type="text" placeholder="https://..." value={editingSeries.imageUrl} onChange={e => setEditingSeries({ ...editingSeries, imageUrl: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-2" />
                            <p className="text-[10px] text-slate-400">รูปนี้จะถูกนำไปแสดงเป็นไอคอนเมนูด้านบน (Sub-navigation) แบบเดียวกับหน้าเว็บ Apple</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <h4 className="text-sm font-black text-slate-800 mb-4 flex justify-between items-center">
                        <span>รายการสินค้าที่อยู่ใน {editingSeries.name}</span>
                        <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full">{modelsInActiveSeries.length} รายการ</span>
                      </h4>

                      {modelsInActiveSeries.length === 0 ? (
                        <div className="text-center py-8 text-slate-400 font-bold bg-slate-50 rounded-xl border border-dashed border-slate-200">
                          ยังไม่มีสินค้ารุ่นไหนถูกจัดให้อยู่ใน Series นี้
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                          {modelsInActiveSeries.map(m => (
                            <div key={m.id} className="flex items-center gap-3 p-3 border border-slate-100 rounded-xl bg-slate-50 hover:bg-white hover:shadow-sm transition-all">
                              {m.imageUrl ? <img src={m.imageUrl} alt={m.name} className="w-10 h-10 object-contain drop-shadow-sm" /> : <div className="w-10 h-10 bg-slate-200 rounded-lg"></div>}
                              <div>
                                <div className="text-xs font-black text-slate-800 line-clamp-1">{m.name}</div>
                                <div className="text-[10px] text-slate-400 font-bold">{m.variants?.length || 0} ความจุ</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                </>
              ) : <div className="flex-1 flex items-center justify-center text-slate-400 font-bold bg-slate-50/50">👈 เลือกหรือสร้าง Series จากเมนูด้านซ้าย</div>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-slate-50/50">

      {/* --- Top Navigation --- */}
      <div className="bg-white rounded-t-2xl border-b border-slate-200 shadow-sm px-4 pt-4 flex gap-6 overflow-x-auto">
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCategory(cat.id)} className={`flex items-center gap-2 pb-4 px-2 border-b-4 transition-all whitespace-nowrap ${activeCategory === cat.id ? 'border-blue-600 text-blue-600 font-black' : 'border-transparent text-slate-500 font-bold hover:text-slate-700'}`}>
            {cat.icon} {cat.id}
          </button>
        ))}
      </div>

      <div className="bg-white px-6 py-3 flex gap-6 border-b shadow-sm overflow-x-auto">
        {brands.map(brand => (
          <button key={brand} onClick={() => setActiveBrand(brand)} className={`text-sm font-bold transition-colors whitespace-nowrap ${activeBrand === brand ? 'text-slate-900 underline decoration-2 underline-offset-8 decoration-blue-500' : 'text-slate-400 hover:text-slate-700'}`}>
            {brand}
          </button>
        ))}
      </div>

      {/* --- Toolbar --- */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center my-6 gap-4">
        <div className="relative w-full max-w-xl bg-white rounded-xl shadow-sm border px-4 py-3 flex items-center focus-within:border-blue-500 transition-all">
          <Search size={20} className="text-slate-400 mr-3" />
          <input type="text" placeholder="Search models or series..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-transparent border-none outline-none text-sm font-bold text-slate-700" />
        </div>
        <div className="flex gap-3 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
          <button onClick={() => setIsEngineModalOpen(true)} className="bg-white border text-slate-700 px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition whitespace-nowrap shadow-sm"><Settings size={18} className="text-indigo-500" /> Engine Settings</button>
          <button onClick={() => setIsSeriesModalOpen(true)} className="bg-white border text-slate-700 px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition whitespace-nowrap shadow-sm"><FolderTree size={18} className="text-blue-500" /> Manage Series</button>
          <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-black flex items-center gap-2 hover:bg-blue-700 transition shadow-md whitespace-nowrap"><PlusCircle size={18} /> เพิ่มรุ่นใหม่</button>
        </div>
      </div>

      {/* --- Main Table --- */}
      <div className="bg-white rounded-3xl shadow-sm border overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[1000px]">
          <thead className="bg-slate-50/80 border-b text-slate-500 font-bold uppercase text-[10px] tracking-widest">
            <tr>
              <th className="p-4 pl-6 w-24">Activate</th>
              <th className="p-4 w-32">Brand / Series</th>
              <th className="p-4">Model Name</th>
              <th className="p-4 w-64">Variants Overview</th>
              <th className="p-4 w-32">Buying Type</th>
              <th className="p-4 text-right pr-6 w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="p-10 text-center text-slate-400 font-bold animate-pulse">กำลังโหลดข้อมูล...</td></tr>
            ) : filteredModels.length === 0 ? (
              <tr><td colSpan={6} className="p-10 text-center text-slate-400">ไม่พบรุ่นสินค้า</td></tr>
            ) : (
              filteredModels.map((item) => {
                const assignedSet = conditionSets.find(c => c.id === item.conditionSetId);
                return (
                  <tr key={item.id} className={`hover:bg-blue-50/30 transition-colors ${!item.isActive && 'bg-slate-50/50 opacity-60'}`}>
                    <td className="p-4 pl-6"><StatusToggle isActive={item.isActive} onToggle={() => handleToggleStatus(item)} /></td>
                    <td className="p-4">
                      <div className="font-bold text-slate-700">{item.brand}</div>
                      {item.series && <div className="text-[10px] text-slate-400 font-medium uppercase mt-0.5">{item.series}</div>}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <button onClick={() => handleToggleFeatured(item)} className={`p-1.5 rounded-full ${item.isFeatured ? 'bg-amber-100 text-amber-500' : 'text-slate-300 hover:text-amber-300 transition'}`}><Star size={18} className={item.isFeatured ? "fill-amber-500" : ""} /></button>
                        <div className="flex items-center gap-3">
                          {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="w-8 h-8 object-contain" />}
                          <div>
                            <div className="font-black text-slate-900">{item.name}</div>
                            <div className="text-[10px] text-indigo-500 font-bold mt-0.5 flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 w-fit"><ClipboardList size={12} /> {assignedSet?.name || 'No Set Assigned'}</div>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {/* 🌟 โชว์สรุป Variants แบบยืดหยุ่น */}
                        <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded-md border border-slate-200 text-slate-600">
                          {item.variants?.length || 0} ตัวเลือก
                        </span>
                        {item.attributesSchema && item.attributesSchema.length > 1 && (
                            <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-1 rounded border border-blue-100 uppercase">
                                Multi-Step UI Ready
                            </span>
                        )}
                      </div>
                    </td>

                    <td className="p-4">
                      <div className="flex gap-2 opacity-60">
                        {item.inStore && <Layers size={14} title="Store" className="text-emerald-600" />}
                        {item.pickup && <Layers size={14} title="Pickup" className="text-blue-600" />}
                        {item.mailIn && <Layers size={14} title="Mail" className="text-orange-600" />}
                      </div>
                    </td>
                    <td className="p-4 text-right pr-6">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleOpenModal(item)} className="p-2 text-slate-400 hover:text-blue-600 transition hover:bg-white rounded-lg"><Pencil size={18} /></button>
                        <button onClick={() => handleDeleteModel(item.id)} className="p-2 text-slate-400 hover:text-red-600 transition hover:bg-white rounded-lg"><Trash2 size={18} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {isEngineModalOpen && <EngineSettingsModal />}
      {isSeriesModalOpen && <SeriesManagementModal />}

      {/* ========================================================================= */}
      {/* 🌟 MODAL เพิ่ม/แก้ไขรุ่นสินค้า (DYNAMIC JSON SCHEMA BUILDER) */}
      {/* ========================================================================= */}
      {isModalOpen && editingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 lg:p-10">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[1400px] h-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

            <div className="px-8 py-5 border-b flex justify-between items-center bg-white shrink-0 z-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><Smartphone size={24} /></div>
                <div><h3 className="font-black text-2xl text-slate-800">{editingItem.id.length > 15 ? 'Edit Model' : 'Add New Model'}</h3><p className="text-sm font-bold text-slate-400">Enterprise Database Structure</p></div>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full transition"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 max-w-7xl mx-auto w-full">

                {/* Left Column (Info & Settings) */}
                <div className="xl:col-span-4 space-y-6">
                  <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-200 space-y-5">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                      <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400">1. General Info</h4>
                      <label className="flex items-center gap-2 cursor-pointer bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100">
                        <input type="checkbox" checked={editingItem.isFeatured} onChange={(e) => setEditingItem({ ...editingItem, isFeatured: e.target.checked })} className="w-4 h-4 rounded text-amber-500" />
                        <span className="text-[10px] font-black text-amber-600 uppercase">โชว์หน้าแรก</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">Category</label>
                        <select className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.category} onChange={(e) => handleCategoryChange(e.target.value)}>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">Brand</label>
                        <select className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.brand} onChange={(e) => setEditingItem({ ...editingItem, brand: e.target.value })}>
                          {brands.filter(b => b !== 'All').map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 mb-1.5 flex justify-between items-center">
                        <span>Series (ตระกูล)</span>
                        <span className="text-[10px] text-slate-400 font-normal">Optional</span>
                      </label>

                      {!isAddingSeries ? (
                        <div className="flex gap-2">
                          <select value={editingItem.series || ''} onChange={(e) => setEditingItem({ ...editingItem, series: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-colors outline-none">
                            <option value="">-- ไม่ระบุ --</option>
                            {availableSeries.filter(s => s.brand === editingItem.brand && s.category === editingItem.category).map(s => (
                                <option key={s.id} value={s.name}>{s.name}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => setIsAddingSeries(true)} className="px-4 bg-slate-100 text-blue-600 rounded-xl hover:bg-blue-50 font-bold border border-slate-200 whitespace-nowrap transition-colors text-sm">+ เพิ่มใหม่</button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input type="text" placeholder="เช่น iPad Pro..." value={newSeriesName} onChange={(e) => setNewSeriesName(e.target.value)} className="w-full p-3 bg-blue-50/50 rounded-xl border border-blue-200 text-sm font-bold text-blue-700 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors outline-none" autoFocus />
                          <button type="button" onClick={handleAddNewSeries} className="px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors text-sm shadow-sm">บันทึก</button>
                          <button type="button" onClick={() => setIsAddingSeries(false)} className="px-3 bg-white text-slate-400 rounded-xl font-bold hover:bg-red-50 hover:text-red-500 transition-colors text-sm border border-slate-200">✕</button>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-500 mb-1.5 block">Model Name (ชื่อรุ่น)</label>
                      <input type="text" placeholder="เช่น MacBook Pro 14 นิ้ว..." className="w-full p-3 bg-white rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.name} onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })} />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-500 mb-1.5 block">Image URL</label>
                      <div className="flex gap-2">
                        <div className="w-12 h-12 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-center shrink-0">
                          {editingItem.imageUrl ? <img src={editingItem.imageUrl} alt="preview" className="max-h-full p-1 object-contain" /> : <ImageIcon size={20} className="text-slate-300" />}
                        </div>
                        <input type="text" placeholder="https://..." className="w-full p-3 bg-white rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500" value={editingItem.imageUrl} onChange={(e) => setEditingItem({ ...editingItem, imageUrl: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-200 space-y-5">
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3">2. Trade-in Settings</h4>

                    <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={editingItem.inStore} onChange={(e) => setEditingItem({ ...editingItem, inStore: e.target.checked })} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                        <span className="text-sm font-bold text-slate-700">หน้าร้าน (In-Store)</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={editingItem.pickup} onChange={(e) => setEditingItem({ ...editingItem, pickup: e.target.checked })} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                        <span className="text-sm font-bold text-slate-700">แมสเซนเจอร์ (Pickup)</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" checked={editingItem.mailIn} onChange={(e) => setEditingItem({ ...editingItem, mailIn: e.target.checked })} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                        <span className="text-sm font-bold text-slate-700">ส่งพัสดุ (Mail-in)</span>
                      </label>
                    </div>

                    <div>
                      <label className="text-xs font-black text-indigo-600 mb-2 block flex items-center gap-1"><ClipboardList size={14} /> Assign Condition Item</label>
                      <select className="w-full p-4 bg-indigo-50 rounded-xl border border-indigo-200 text-sm font-bold text-indigo-900 focus:ring-2 focus:ring-indigo-500 outline-none" value={editingItem.conditionSetId} onChange={(e) => setEditingItem({ ...editingItem, conditionSetId: e.target.value })}>
                        <option value="" disabled>-- เลือกชุดประเมินสภาพที่ตรงกับสินค้านี้ --</option>
                        {conditionSets.map(set => (<option key={set.id} value={set.id}>{set.name}</option>))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Right Column (DYNAMIC SPEC BUILDER) */}
                <div className="xl:col-span-8">
                  <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-200 h-full flex flex-col">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-4">
                      <div>
                        <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400">3. Dynamic Variants (Step-by-Step UI)</h4>
                        <p className="text-[10px] text-emerald-500 font-bold mt-1">โครงสร้างนี้รองรับการสร้าง UI แบบทีละสเต็ปบนหน้าเว็บ (Progressive Disclosure)</p>
                      </div>
                      <button onClick={handleAddVariant} className="text-sm font-bold text-blue-600 border-2 border-blue-100 bg-blue-50 px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all shadow-sm"><Plus size={16} /> Add Variant</button>
                    </div>

                    <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 flex-1 overflow-y-auto space-y-4">
                      {editingItem.variants?.map((v: any, index: number) => {
                        const currentSchema = editingItem.attributesSchema || CATEGORY_SCHEMAS['Smartphones'];

                        return (
                          <div key={v.id} className="grid grid-cols-12 gap-4 items-start bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative group hover:border-blue-200 transition-colors pr-12">

                            {/* 🌟 Dynamic Inputs Based on Category Schema 🌟 */}
                            <div className="col-span-12 xl:col-span-7">
                               <div className="grid grid-cols-2 gap-3">
                                  {currentSchema.map((attr: any) => (
                                     <div key={attr.key}>
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                                          {attr.label}
                                        </label>
                                        
                                        {attr.type === 'select' ? (
                                           <select 
                                              className="w-full p-2.5 bg-slate-50 rounded-lg text-sm font-bold border border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                              value={v.attributes?.[attr.key] || ''}
                                              onChange={(e) => handleAttributeChange(index, attr.key, e.target.value)}
                                           >
                                              <option value="">-- เลือก --</option>
                                              {attr.options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                                           </select>
                                        ) : (
                                           <input 
                                              type="text" 
                                              placeholder={`e.g. ${attr.key === 'ram' ? '8GB' : attr.key === 'storage' ? '256GB' : '...'}`} 
                                              className="w-full p-2.5 bg-slate-50 rounded-lg text-sm font-bold border border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none" 
                                              value={v.attributes?.[attr.key] || ''} 
                                              onChange={(e) => handleAttributeChange(index, attr.key, e.target.value)} 
                                           />
                                        )}
                                     </div>
                                  ))}
                                  <div className="col-span-2 text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                                    <span className="font-bold text-slate-500">ผลลัพธ์ที่จะโชว์ในฐานข้อมูลเก่า:</span> 
                                    {currentSchema.map((a: any) => v.attributes?.[a.key]).filter(Boolean).join(' | ') || '...'}
                                  </div>
                               </div>
                            </div>

                            {/* Pricing Inputs */}
                            <div className="col-span-12 xl:col-span-5 grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[9px] font-black uppercase text-emerald-500 tracking-wider block mb-1">ราคาเครื่องซีล</label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-bold">฿</span>
                                  <input type="number" className="w-full pl-8 pr-3 py-3 bg-emerald-50/50 rounded-lg text-sm font-black text-emerald-600 border border-emerald-100 focus:ring-2 focus:ring-emerald-500 outline-none" value={v.newPrice || ''} onChange={(e) => { const newV = [...editingItem.variants]; newV[index].newPrice = Number(e.target.value); setEditingItem({ ...editingItem, variants: newV }); }} />
                                </div>
                              </div>
                              <div>
                                <label className="text-[9px] font-black uppercase text-blue-500 tracking-wider block mb-1">ราคาเครื่องมือสอง (รับซื้อ)</label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 font-bold">฿</span>
                                  <input type="number" className="w-full pl-8 pr-3 py-3 bg-blue-50/50 rounded-lg text-sm font-black text-blue-600 border border-blue-100 focus:ring-2 focus:ring-blue-500 outline-none" value={v.usedPrice || v.price || ''} onChange={(e) => { const newV = [...editingItem.variants]; newV[index].usedPrice = Number(e.target.value); setEditingItem({ ...editingItem, variants: newV }); }} />
                                </div>
                              </div>
                            </div>

                            {editingItem.variants.length > 1 && (
                              <button onClick={() => handleRemoveVariant(v.id)} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors">
                                <Trash2 size={18} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

              </div>
            </div>

            <div className="px-8 py-5 border-t bg-white flex justify-end gap-4 shrink-0 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] z-10">
              <button onClick={() => setIsModalOpen(false)} className="px-8 py-3 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition">Cancel</button>
              <button onClick={handleSaveModel} className="px-10 py-3 rounded-xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition active:scale-95 flex items-center gap-2">
                <Save size={18} /> Save & Apply Schema
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PriceEditor;