'use client';

import { getAuth } from 'firebase/auth';
import React, { useState, useEffect } from 'react';
import {
  Smartphone, Tablet, Laptop, Watch, Camera,
  Gamepad2, Search, PlusCircle, Settings, FolderTree, Layers
} from 'lucide-react';
import { ref, push, update, remove, onValue } from 'firebase/database';
import { db, app } from '../../api/firebase';
import toast from 'react-hot-toast';

import { CATEGORY_SCHEMAS } from './constants/categorySchemas';
import { EngineSettingsModal } from './modals/EngineSettingsModal';
import { SeriesManagementModal } from './modals/SeriesManagementModal';
import { SubcategoryManagementModal } from './modals/SubcategoryManagementModal';
import { ProductEditorModal } from './modals/ProductEditorModal';
import { ModelsTable } from './components/pricing/ModelsTable';
import { PriceAnomalyBanner } from './components/pricing/PriceAnomalyBanner';
import { BatchPriceAdjustModal } from './modals/BatchPriceAdjustModal';
import { generateVariantsFromModifiers } from './utils/variantGenerator';

export const PriceEditor = () => {
  const [activeCategory, setActiveCategory] = useState('Smart Watch');
  const [activeBrand, setActiveBrand] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [availableSeries, setAvailableSeries] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [modelsData, setModelsData] = useState<any[]>([]);
  const [conditionSets, setConditionSets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isSeriesModalOpen, setIsSeriesModalOpen] = useState(false);
  const [isSubcategoryModalOpen, setIsSubcategoryModalOpen] = useState(false);
  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);
  const [batchAdjust, setBatchAdjust] = useState<{ seriesName: string; models: any[] } | null>(null);

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

    const subcategoriesRef = ref(db, 'subcategories');
    const unsubSubcategories = onValue(subcategoriesRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const formatted = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        formatted.sort((a, b) => a.name.localeCompare(b.name));
        setSubcategories(formatted);
      } else {
        setSubcategories([]);
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

    return () => { unsubModels(); unsubConditions(); unsubSeries(); unsubSubcategories(); };
  }, []);

  const handleSaveModel = async () => {
    if (!editingItem.name.trim()) return toast.error('กรุณากรอกชื่อรุ่นด้วยครับ');
    if (!editingItem.conditionSetId) return toast.error('กรุณาเลือก Assign Your Condition Item ด้วยครับ');

    try {
      const auth = getAuth(app);
      const adminUser = auth.currentUser?.email || 'System Admin';
      const originalModel = modelsData.find(m => m.id === editingItem.id);
      const schema = editingItem.attributesSchema || CATEGORY_SCHEMAS[editingItem.category] || CATEGORY_SCHEMAS['Smartphones'];
      const pricingMode = editingItem.pricingMode || 'legacy';

      let processedVariants: any[];

      if (pricingMode === 'modifier') {
        // Modifier Mode: generate flat variants จาก base price + modifiers
        const generated = generateVariantsFromModifiers(
          schema,
          editingItem.attributeModifiers || {},
          editingItem.baseNewPrice || 0,
          editingItem.baseUsedPrice || 0,
          editingItem.priceOverrides
        );
        processedVariants = generated;
      } else {
        // Legacy Mode: แปลง Attributes กลับเป็น String ยาวๆ
        processedVariants = (editingItem.variants || []).map((v: any) => {
          const orderedValues = schema
            .map((schemaAttr: any) => v.attributes?.[schemaAttr.key])
            .filter(Boolean);
          return { ...v, name: orderedValues.join(' | ') || v.name };
        });
      }

      const payload: any = {
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
        attributesSchema: editingItem.attributesSchema,
        pricingMode,
        variants: processedVariants,
        updatedAt: Date.now()
      };

      // เก็บ modifier data เฉพาะ modifier mode
      if (pricingMode === 'modifier') {
        payload.baseNewPrice = editingItem.baseNewPrice || 0;
        payload.baseUsedPrice = editingItem.baseUsedPrice || 0;
        payload.attributeModifiers = editingItem.attributeModifiers || {};
        if (editingItem.priceOverrides) {
          payload.priceOverrides = editingItem.priceOverrides;
        }
      }

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
        await Promise.all(processedVariants.map(async (v: any) => {
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
        }));
      }

      setIsModalOpen(false);
      toast.success('บันทึกข้อมูลและโครงสร้างใหม่เรียบร้อยครับ! 🚀');
    } catch (error) {
      toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูลครับ');
    }
  };

  const handleDeleteModel = async (id: string) => { if (confirm('ยืนยันการลบรุ่นสินค้านี้ใช่หรือไม่?')) await remove(ref(db, `models/${id}`)); };
  const handleToggleStatus = async (item: any) => { await update(ref(db, `models/${item.id}`), { isActive: !item.isActive }); };
  const handleToggleFeatured = async (item: any) => { await update(ref(db, `models/${item.id}`), { isFeatured: !item.isFeatured }); };

  const handleDuplicateModel = (item: any) => {
    const cloned = JSON.parse(JSON.stringify(item));
    cloned.id = Date.now().toString();
    cloned.name = `${item.name} (Copy)`;
    cloned.isActive = false;
    cloned.isFeatured = false;

    // Reset variant IDs so they are treated as new
    cloned.variants = (cloned.variants || []).map((v: any, idx: number) => ({
      ...v,
      id: `v${idx + 1}`,
    }));

    // Auto-migration for attributes (same logic as edit)
    const schema = cloned.attributesSchema || CATEGORY_SCHEMAS[cloned.category] || CATEGORY_SCHEMAS['Smartphones'];
    cloned.attributesSchema = schema;
    cloned.variants = cloned.variants.map((v: any) => {
      if (!v.attributes) {
        v.attributes = {};
        const parts = (v.name || '').split('|').map((s: string) => s.trim());
        if (cloned.category === 'Mac / Laptop') {
          v.attributes.processor = parts[0] || '';
          v.attributes.ram = parts[1] || '';
          v.attributes.storage = parts[2] || '';
          v.attributes.display = parts[3] || '';
        } else if (cloned.category === 'Tablets') {
          v.attributes.connectivity = parts[0] || '';
          v.attributes.storage = parts[1] || '';
        } else if (cloned.category === 'Smart Watch') {
          v.attributes.size = parts[0] || '';
          v.attributes.case_material = parts[1] || '';
          v.attributes.connectivity = parts[2] || '';
        } else {
          v.attributes.storage = parts[0] || v.name || '';
        }
      }
      return v;
    });

    setEditingItem(cloned);
    setIsModalOpen(true);
    toast.success('สำเนาสินค้าเรียบร้อย กรุณาตรวจสอบและบันทึกครับ');
  };

  const handleOpenModal = (item: any = null) => {
    if (item) {
      // Auto-Migration: ดึงข้อมูลเดิมมาหั่นเป็น Attributes ชั่วคราวถ้ายังไม่มี
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
      // ของใหม่ → default เป็น modifier mode
      const schema = CATEGORY_SCHEMAS[activeCategory] || CATEGORY_SCHEMAS['Smartphones'];
      const initialModifiers: Record<string, { options: any[] }> = {};
      for (const attr of schema) {
        initialModifiers[attr.key] = { options: [] };
      }
      setEditingItem({
        id: Date.now().toString(),
        brand: activeBrand === 'All' ? 'Apple' : activeBrand,
        category: activeCategory,
        series: '', name: '', imageUrl: '', isActive: true, isFeatured: false, inStore: true, pickup: true, mailIn: true,
        conditionSetId: conditionSets.length > 0 ? conditionSets[0].id : '',
        attributesSchema: schema,
        pricingMode: 'modifier',
        baseNewPrice: 0,
        baseUsedPrice: 0,
        attributeModifiers: initialModifiers,
        variants: []
      });
    }
    setIsModalOpen(true);
  };

  const filteredModels = modelsData.filter(item => {
    const matchCategory = item.category === activeCategory;
    const matchBrand = activeBrand === 'All' || item.brand === activeBrand;
    const matchSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || (item.series && item.series.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCategory && matchBrand && matchSearch;
  });

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
          <button onClick={() => setIsSubcategoryModalOpen(true)} className="bg-white border text-slate-700 px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition whitespace-nowrap shadow-sm"><Layers size={18} className="text-violet-500" /> Subcategories</button>
          <button onClick={() => setIsSeriesModalOpen(true)} className="bg-white border text-slate-700 px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition whitespace-nowrap shadow-sm"><FolderTree size={18} className="text-blue-500" /> Manage Series</button>
          <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-black flex items-center gap-2 hover:bg-blue-700 transition shadow-md whitespace-nowrap"><PlusCircle size={18} /> เพิ่มรุ่นใหม่</button>
        </div>
      </div>

      {/* --- Anomaly Banner --- */}
      <PriceAnomalyBanner
        models={filteredModels}
        onEditModel={(modelId) => {
          const model = modelsData.find(m => m.id === modelId);
          if (model) handleOpenModal(model);
        }}
      />

      {/* --- Main Table --- */}
      <ModelsTable
        models={filteredModels}
        conditionSets={conditionSets}
        loading={loading}
        onEdit={handleOpenModal}
        onDelete={handleDeleteModel}
        onDuplicate={handleDuplicateModel}
        onToggleStatus={handleToggleStatus}
        onToggleFeatured={handleToggleFeatured}
        onBatchAdjust={(seriesName, models) => setBatchAdjust({ seriesName, models })}
      />

      <EngineSettingsModal
        conditionSets={conditionSets}
        isOpen={isEngineModalOpen}
        onClose={() => setIsEngineModalOpen(false)}
      />

      <SubcategoryManagementModal
        subcategories={subcategories}
        availableSeries={availableSeries}
        isOpen={isSubcategoryModalOpen}
        onClose={() => setIsSubcategoryModalOpen(false)}
      />

      <SeriesManagementModal
        availableSeries={availableSeries}
        subcategories={subcategories}
        modelsData={modelsData}
        isOpen={isSeriesModalOpen}
        onClose={() => setIsSeriesModalOpen(false)}
      />

      <ProductEditorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        editingItem={editingItem}
        conditionSets={conditionSets}
        availableSeries={availableSeries}
        categorySchemas={CATEGORY_SCHEMAS}
        onSave={handleSaveModel}
        onEditingItemChange={setEditingItem}
      />

      <BatchPriceAdjustModal
        isOpen={!!batchAdjust}
        onClose={() => setBatchAdjust(null)}
        seriesName={batchAdjust?.seriesName || ''}
        models={batchAdjust?.models || []}
      />
    </div>
  );
};

export default PriceEditor;
