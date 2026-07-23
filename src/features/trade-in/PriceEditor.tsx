'use client';

import { getAuth } from 'firebase/auth';
import React, { useState, useEffect, useRef } from 'react';
import {
  Search, PlusCircle, Settings, FolderTree, Layers, LayoutGrid, Archive, Tag
} from 'lucide-react';
import { ref, push, update, remove, onValue, get } from 'firebase/database';
import { db, app } from '../../api/firebase';
import toast from 'react-hot-toast';

import { CATEGORY_SCHEMAS, resolveCategorySchema } from './constants/categorySchemas';
import { getCategoryIcon } from './constants/categoryIcons';
import { generateModelAliases } from '../../utils/modelAliases';
import { EngineSettingsModal } from './modals/EngineSettingsModal';
import { SeriesManagementModal } from './modals/SeriesManagementModal';
import { SubcategoryManagementModal } from './modals/SubcategoryManagementModal';
import { CategoryBrandManagementModal } from './modals/CategoryBrandManagementModal';
import { ProductEditorModal } from './modals/ProductEditorModal';
import { ModelsTable } from './components/pricing/ModelsTable';
import { PriceListMobile } from './components/pricing/PriceListMobile';
import { MobilePriceEditPage } from './components/pricing/MobilePriceEditPage';
import { PriceAnomalyBanner } from './components/pricing/PriceAnomalyBanner';
import { BatchPriceAdjustModal } from './modals/BatchPriceAdjustModal';
import { generateVariantsFromModifiers } from './utils/variantGenerator';
import { DISCONTINUED_MODELS } from './constants/discontinuedModels';
import { ACCESSORY_CATEGORY } from '../../utils/accessoryItems';
import {
  ACCESSORY_CONDITION_SET, buildAccessorySeedModels, buildAccessoryModelPayload,
  ACCESSORY_COMPAT_BY_NAME, EXTRA_ACCESSORY_DEFS, resolveCompatModelIds,
  ACCESSORY_PRICE_PATCH,
} from './constants/accessorySeed';

export const PriceEditor = () => {
  const [activeCategory, setActiveCategory] = useState('Smart Watch');
  const [activeBrand, setActiveBrand] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [availableSeries, setAvailableSeries] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [modelsData, setModelsData] = useState<any[]>([]);
  const [conditionSets, setConditionSets] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [categoriesData, setCategoriesData] = useState<any[]>([]);
  const [brandsData, setBrandsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMobileEditOpen, setIsMobileEditOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isSeriesModalOpen, setIsSeriesModalOpen] = useState(false);
  const [isSubcategoryModalOpen, setIsSubcategoryModalOpen] = useState(false);
  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [batchAdjust, setBatchAdjust] = useState<{ seriesName: string; models: any[] } | null>(null);

  // Seed guards — ensure the idempotent default seeding only fires once per mount.
  const seededCategoriesRef = useRef(false);
  const seededBrandsRef = useRef(false);
  // Deployments seeded before the accessories category existed won't get it from
  // seedDefaultCategories (that only runs on an empty path) — backfill it once.
  const backfilledAccessoryCategoryRef = useRef(false);
  const seededAccessoryModelsRef = useRef(false);
  const upgradedAccessoryCompatRef = useRef(false);

  // Category tabs + brand filter are now derived from Firebase-backed data.
  const categories = [...categoriesData].sort(
    (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
  );
  const brands = ['All', ...[...brandsData]
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map(b => b.name)];

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

    // Coupons — read-only here, used to badge models with their promo
    // include/exclude status (source of truth stays on the coupon).
    const couponsRef = ref(db, 'coupons');
    const unsubCoupons = onValue(couponsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setCoupons(Object.keys(data).map(key => ({ id: key, ...data[key] })));
      } else {
        setCoupons([]);
      }
    });

    // Product categories (admin-editable). Seed defaults once if the path is empty.
    const categoriesRef = ref(db, 'product_categories');
    const unsubCategories = onValue(categoriesRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const formatted = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        formatted.sort((a, b) => {
          const oa = Number(a.order) || 0;
          const ob = Number(b.order) || 0;
          if (oa !== ob) return oa - ob;
          return (a.name || '').localeCompare(b.name || '');
        });
        setCategoriesData(formatted);
        if (!backfilledAccessoryCategoryRef.current
          && !formatted.some((c: any) => c?.name === ACCESSORY_CATEGORY)) {
          backfilledAccessoryCategoryRef.current = true;
          const maxOrder = formatted.reduce((mx, c: any) => Math.max(mx, Number(c.order) || 0), 0);
          update(push(ref(db, 'product_categories')), {
            name: ACCESSORY_CATEGORY,
            label_th: 'อุปกรณ์เสริม iPad',
            icon: 'tablet',
            route: '',
            slug: 'tablet-accessories',
            order: maxOrder + 1,
            active: true,
            schema: CATEGORY_SCHEMAS[ACCESSORY_CATEGORY] || [],
          }).catch(() => { backfilledAccessoryCategoryRef.current = false; });
        }
      } else {
        setCategoriesData([]);
        if (!seededCategoriesRef.current) {
          seededCategoriesRef.current = true;
          seedDefaultCategories();
        }
      }
    });

    // Product brands (admin-editable). Seed defaults once if the path is empty.
    const brandsRef = ref(db, 'product_brands');
    const unsubBrands = onValue(brandsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const formatted = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        formatted.sort((a, b) => {
          const oa = Number(a.order) || 0;
          const ob = Number(b.order) || 0;
          if (oa !== ob) return oa - ob;
          return (a.name || '').localeCompare(b.name || '');
        });
        setBrandsData(formatted);
      } else {
        setBrandsData([]);
        if (!seededBrandsRef.current) {
          seededBrandsRef.current = true;
          seedDefaultBrands();
        }
      }
    });

    return () => { unsubModels(); unsubConditions(); unsubSeries(); unsubSubcategories(); unsubCoupons(); unsubCategories(); unsubBrands(); };
  }, []);

  // Idempotent seed: only writes when the path is genuinely empty (double-checked
  // with a one-shot get() to avoid racing the onValue snapshot).
  const seedDefaultCategories = async () => {
    try {
      const snap = await get(ref(db, 'product_categories'));
      if (snap.exists()) return;
      // Camera / Game System seed as inactive ("Soon") to match the prior
      // customer-facing behaviour; admins flip them on once models exist.
      const defaults = [
        { name: 'Smartphones', label_th: 'โทรศัพท์มือถือ', icon: 'smartphone', route: '/iphone', slug: 'smartphones', order: 1, active: true },
        { name: 'Tablets', label_th: 'แท็บเล็ต', icon: 'tablet', route: '/ipad', slug: 'tablets', order: 2, active: true },
        { name: 'Mac / Laptop', label_th: 'คอมพิวเตอร์ / Mac', icon: 'laptop', route: '/mac', slug: 'mac-laptop', order: 3, active: true },
        { name: 'Smart Watch', label_th: 'สมาร์ทวอทช์', icon: 'watch', route: '/apple-watch', slug: 'smart-watch', order: 4, active: true },
        { name: 'Camera', label_th: 'กล้องถ่ายรูป', icon: 'camera', route: '', slug: 'camera', order: 5, active: false },
        { name: 'Game System', label_th: 'เครื่องเกมคอนโซล', icon: 'gamepad', route: '', slug: 'game-system', order: 6, active: false },
        // อุปกรณ์เสริม iPad (Apple Pencil / Magic Keyboard) — admin-only ไม่มีหน้า
        // customer web (route ว่าง) รับซื้อพ่วงกับ iPad หรือเดี่ยวผ่านแอดมิน
        { name: ACCESSORY_CATEGORY, label_th: 'อุปกรณ์เสริม iPad', icon: 'tablet', route: '', slug: 'tablet-accessories', order: 7, active: true },
      ];
      await Promise.all(defaults.map(d => {
        const newRef = push(ref(db, 'product_categories'));
        return update(newRef, {
          name: d.name,
          label_th: d.label_th,
          icon: d.icon,
          route: d.route,
          slug: d.slug,
          order: d.order,
          active: d.active,
          schema: CATEGORY_SCHEMAS[d.name] || [],
        });
      }));
    } catch {
      seededCategoriesRef.current = false;
    }
  };

  // One-time seed of the accessory catalog (Apple Pencil / Magic Keyboard):
  // fires when the accessories category exists but has no models yet. Creates
  // one shared condition set + all models as isActive:false so admin reviews
  // the starting prices and activates each model before it is offered.
  // Idempotent: guarded by ref + a one-shot get() re-check (races with other
  // admin sessions the same way seedDefaultCategories does).
  const seedDefaultAccessoryModels = async () => {
    try {
      const snap = await get(ref(db, 'models'));
      const existing = snap.exists() ? Object.values(snap.val() as Record<string, any>) : [];
      if (existing.some((m: any) => m?.category === ACCESSORY_CATEGORY)) return;

      const setRef = push(ref(db, 'settings/condition_sets'));
      await update(setRef, ACCESSORY_CONDITION_SET);

      const models = buildAccessorySeedModels(availableSeries, modelsData, setRef.key as string);
      await Promise.all(models.map(m => update(push(ref(db, 'models')), m)));
      toast.success(
        `เพิ่มรุ่นอุปกรณ์เสริม iPad ให้ ${models.length} รุ่น (Pencil/Keyboard) พร้อมชุดประเมินมาตรฐาน — ทุกรุ่นยัง "งดรับซื้อ" อยู่ ตรวจราคาแล้วกดเปิดใช้ทีละรุ่นได้เลย`,
        { duration: 10000 },
      );
    } catch {
      seededAccessoryModelsRef.current = false;
    }
  };

  // One-time upgrade: accessory models seeded with series-level compatibility
  // get precise per-model `compatible_models` (Apple's official compatibility
  // tables mapped against the store's real iPad catalog), and the Pro-M4-era
  // Magic Keyboards missing from the first seed are inserted. Self-guarding:
  // only touches accessory models whose name is in the mapping AND that don't
  // have compatible_models yet.
  const upgradeAccessoryCompat = async () => {
    try {
      const accessories = modelsData.filter((m: any) => m?.category === ACCESSORY_CATEGORY);
      if (accessories.length === 0) return;

      const writes: Promise<any>[] = [];
      let upgraded = 0;

      for (const acc of accessories) {
        if (Array.isArray(acc.compatible_models) && acc.compatible_models.length > 0) continue;
        const names = ACCESSORY_COMPAT_BY_NAME[String(acc.name || '').trim()];
        if (!names) continue;
        const ids = resolveCompatModelIds(modelsData, names);
        if (ids.length === 0) continue;
        upgraded += 1;
        writes.push(update(ref(db, `models/${acc.id}`), { compatible_models: ids, updatedAt: Date.now() }));
      }

      // Owner-set buy-in prices (one-shot): applies only while the current
      // usedPrice still equals the seed default, so manual edits are never
      // clobbered and the patch can't re-apply.
      let repriced = 0;
      for (const acc of accessories) {
        const patch = ACCESSORY_PRICE_PATCH[String(acc.name || '').trim()];
        if (!patch) continue;
        const rawVariants = Array.isArray(acc.variants) ? acc.variants : Object.values(acc.variants || {});
        const v0: any = rawVariants[0];
        if (!v0 || Number(v0.usedPrice) !== patch.from) continue;
        repriced += 1;
        writes.push(update(ref(db, `models/${acc.id}`), {
          variants: [{ ...v0, usedPrice: patch.to }, ...rawVariants.slice(1)],
          updatedAt: Date.now(),
        }));
      }

      // Insert the Pro-M4-era Magic Keyboards if absent (reuse the condition
      // set the other accessory models are already bound to).
      const existingNames = new Set(accessories.map((m: any) => String(m.name || '').trim()));
      const conditionSetId = accessories.find((m: any) => m.conditionSetId)?.conditionSetId;
      let inserted = 0;
      if (conditionSetId) {
        for (const def of EXTRA_ACCESSORY_DEFS) {
          if (existingNames.has(def.name)) continue;
          const ids = resolveCompatModelIds(modelsData, ACCESSORY_COMPAT_BY_NAME[def.name] || []);
          inserted += 1;
          writes.push(update(push(ref(db, 'models')), buildAccessoryModelPayload(def, conditionSetId, { models: ids })));
        }
      }

      if (writes.length === 0) return;
      await Promise.all(writes);
      const parts: string[] = [];
      if (upgraded > 0) parts.push(`ผูกความเข้ากันได้ระดับรุ่นตามตาราง Apple ${upgraded} รุ่น`);
      if (inserted > 0) parts.push(`เพิ่ม Magic Keyboard รุ่น Pro M4 อีก ${inserted} รุ่น`);
      if (repriced > 0) parts.push(`อัปเดตราคารับซื้อตามที่กำหนด ${repriced} รุ่น`);
      toast.success(`อุปกรณ์เสริม iPad: ${parts.join(' · ')} — ตรวจแล้วกดเปิดใช้ (Activate) รุ่นที่พร้อมรับซื้อได้เลย`, { duration: 10000 });
    } catch {
      upgradedAccessoryCompatRef.current = false;
    }
  };

  const seedDefaultBrands = async () => {
    try {
      const snap = await get(ref(db, 'product_brands'));
      if (snap.exists()) return;
      const defaults = ['Apple', 'Samsung', 'Google', 'Oppo', 'Vivo', 'Sony', 'Nintendo'];
      await Promise.all(defaults.map((name, idx) => {
        const newRef = push(ref(db, 'product_brands'));
        return update(newRef, { name, order: idx + 1, active: true });
      }));
    } catch {
      seededBrandsRef.current = false;
    }
  };

  // Once categories load, make sure the active tab points at a real category.
  useEffect(() => {
    if (categories.length === 0) return;
    if (!categories.some(c => c.name === activeCategory)) {
      setActiveCategory(categories[0].name);
    }
  }, [categoriesData]);

  // Seed the accessory catalog once everything needed is loaded: the category
  // exists, series are available (compatible_series maps against real iPad
  // series names), and no accessory model exists yet.
  useEffect(() => {
    if (loading || seededAccessoryModelsRef.current) return;
    if (!categoriesData.some((c: any) => c?.name === ACCESSORY_CATEGORY)) return;
    if (availableSeries.length === 0) return;
    if (modelsData.some((m: any) => m?.category === ACCESSORY_CATEGORY)) return;
    seededAccessoryModelsRef.current = true;
    seedDefaultAccessoryModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, modelsData, categoriesData, availableSeries]);

  // Upgrade series-level accessory compatibility to per-model (one-shot after
  // the models list is loaded; no-ops when everything already carries
  // compatible_models).
  useEffect(() => {
    if (loading || upgradedAccessoryCompatRef.current) return;
    if (!modelsData.some((m: any) => m?.category === ACCESSORY_CATEGORY)) return;
    upgradedAccessoryCompatRef.current = true;
    upgradeAccessoryCompat();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, modelsData]);

  // Breakpoint matches the list view swap (`lg` = 1024px): below it we use the
  // mobile card list + full-screen edit page; at/above it the desktop table + modal.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const handleSaveModel = async () => {
    if (!editingItem.name.trim()) return toast.error('กรุณากรอกชื่อรุ่นด้วยครับ');
    if (!editingItem.conditionSetId) return toast.error('กรุณาเลือก Assign Your Condition Item ด้วยครับ');

    try {
      const auth = getAuth(app);
      const adminUser = auth.currentUser?.email || 'System Admin';
      const originalModel = modelsData.find(m => m.id === editingItem.id);
      const schema = editingItem.attributesSchema || resolveCategorySchema(editingItem.category, categoriesData);
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

      // ชื่อภาษาอังกฤษ (ไม่บังคับ) — display-only สำหรับหน้า /en ของเว็บลูกค้า.
      // ค่าไทย (`name`) ยังเป็น canonical เสมอ (slug/matching/payload).
      // ค่าว่าง = เขียน null ให้ Firebase ลบฟิลด์ทิ้ง (ห้ามเก็บ '' ค้างไว้)
      const labelEn = typeof editingItem.label_en === 'string' ? editingItem.label_en.trim() : '';
      // ชื่อเรียกทั่วไป (alias) — ทุกรุ่นมีได้ 3 ชื่อ: `name` = ชื่อทางการที่ Apple
      // ประกาศ, `alias_th` = ชื่อที่คนทั่วไปเรียกภาษาไทย (เช่น "ไอแพดแอร์ 8"),
      // `alias_en` = ชื่อเรียกอังกฤษแบบบ้านๆ (เช่น "iPad Air 8"). ตัวค้นหาของ
      // AI แชท (chat-ai.js rankModels) ใช้ทั้ง 3 ชื่อ matching — ลูกค้าพิมพ์ชื่อ
      // ไหนก็เจอรุ่นเดียวกัน. ค่าว่าง = null ให้ Firebase ลบฟิลด์ทิ้ง
      const aliasTh = typeof editingItem.alias_th === 'string' ? editingItem.alias_th.trim() : '';
      const aliasEn = typeof editingItem.alias_en === 'string' ? editingItem.alias_en.trim() : '';

      const payload: any = {
        brand: editingItem.brand,
        category: editingItem.category,
        series: editingItem.series || '',
        name: editingItem.name,
        label_en: labelEn || null,
        alias_th: aliasTh || null,
        alias_en: aliasEn || null,
        imageUrl: editingItem.imageUrl || '',
        isActive: editingItem.isActive ?? true,
        isFeatured: editingItem.isFeatured ?? false,
        inStore: editingItem.inStore ?? true,
        pickup: editingItem.pickup ?? true,
        mailIn: editingItem.mailIn ?? true,
        maxPickupDistanceKm: Number(editingItem.maxPickupDistanceKm) || 0,
        conditionSetId: editingItem.conditionSetId,
        // เฉพาะ accessory models — ความเข้ากันได้ระดับรุ่น (model ids, convention
        // เดียวกับ coupon applicable_models) ชนะระดับ series; ว่าง = null ให้
        // Firebase ลบฟิลด์. compatible_series เก็บไว้เป็น fallback ข้อมูลเก่า
        compatible_models: (editingItem.category === ACCESSORY_CATEGORY
          && Array.isArray(editingItem.compatible_models)
          && editingItem.compatible_models.filter(Boolean).length > 0)
          ? editingItem.compatible_models.filter(Boolean)
          : null,
        compatible_series: (editingItem.category === ACCESSORY_CATEGORY
          && Array.isArray(editingItem.compatible_series)
          && editingItem.compatible_series.filter(Boolean).length > 0)
          ? editingItem.compatible_series.filter(Boolean)
          : null,
        liquidityFactor: Number(editingItem.liquidityFactor) > 0 ? Number(editingItem.liquidityFactor) : 1,
        attributesSchema: editingItem.attributesSchema,
        pricingMode,
        variants: processedVariants,
        updatedAt: Date.now()
      };

      // เก็บ modifier data เฉพาะ modifier mode
      if (pricingMode === 'modifier') {
        payload.baseRetailPrice = editingItem.baseRetailPrice || 0;
        payload.baseSellPrice = editingItem.baseSellPrice || 0;
        payload.baseSellUsedPrice = editingItem.baseSellUsedPrice || 0;
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
      setIsMobileEditOpen(false);
      toast.success('บันทึกข้อมูลและโครงสร้างใหม่เรียบร้อยครับ! 🚀');
    } catch (error) {
      toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูลครับ');
    }
  };

  const handleDeleteModel = async (id: string) => { if (confirm('ยืนยันการลบรุ่นสินค้านี้ใช่หรือไม่?')) await remove(ref(db, `models/${id}`)); };
  const handleToggleStatus = async (item: any) => { await update(ref(db, `models/${item.id}`), { isActive: !item.isActive }); };
  const handleToggleFeatured = async (item: any) => { await update(ref(db, `models/${item.id}`), { isFeatured: !item.isFeatured }); };

  // One-tap import of the discontinued ("งดรับซื้อ", isActive:false) catalogue.
  // Runs from the admin session (works on iPhone), idempotent: skips any model
  // whose name already exists.
  // เติมชื่อเรียก (alias ไทย/อังกฤษ) อัตโนมัติทุกรุ่นด้วย generator กติกาคงที่
  // (src/utils/modelAliases.ts) — เติมเฉพาะช่องที่ยังว่าง ไม่ทับที่แอดมินกรอกเอง
  // กดซ้ำได้เสมอ (รุ่นที่เพิ่มใหม่ภายหลังจะถูกเติมในรอบถัดไป)
  const [fillingAliases, setFillingAliases] = useState(false);
  const handleFillAliases = async () => {
    if (fillingAliases) return;
    if (!confirm('เติมชื่อเรียกทั่วไป (ไทย/อังกฤษ) อัตโนมัติให้ทุกรุ่นที่ยังไม่มี?\nช่องที่กรอกไว้แล้วจะไม่ถูกทับ')) return;
    setFillingAliases(true);
    try {
      const updates: Record<string, string> = {};
      let filled = 0;
      let models = 0;
      modelsData.forEach((m: any) => {
        if (!m?.id || !m?.name) return;
        const gen = generateModelAliases(m.name);
        const needTh = !(typeof m.alias_th === 'string' && m.alias_th.trim());
        const needEn = !(typeof m.alias_en === 'string' && m.alias_en.trim());
        if (!needTh && !needEn) return;
        models++;
        if (needTh && gen.alias_th) { updates[`models/${m.id}/alias_th`] = gen.alias_th; filled++; }
        if (needEn && gen.alias_en) { updates[`models/${m.id}/alias_en`] = gen.alias_en; filled++; }
      });
      if (!Object.keys(updates).length) {
        toast.success('ทุกรุ่นมีชื่อเรียกครบแล้ว');
        return;
      }
      await update(ref(db), updates);
      toast.success(`เติมชื่อเรียกให้ ${models} รุ่น (${filled} ช่อง) แล้ว — AI และช่องค้นหาใช้ได้ทันที`);
    } catch {
      toast.error('เติมชื่อเรียกไม่สำเร็จ');
    } finally {
      setFillingAliases(false);
    }
  };

  const [importingDiscontinued, setImportingDiscontinued] = useState(false);
  const handleImportDiscontinued = async () => {
    if (importingDiscontinued) return;
    const existingNames = new Set(modelsData.map((m: any) => String(m.name || '').trim()));
    const toAdd = DISCONTINUED_MODELS.filter((m) => !existingNames.has(String(m.name).trim()));
    if (toAdd.length === 0) {
      toast('รุ่นงดรับซื้อทั้งหมดอยู่ในระบบแล้วครับ');
      return;
    }
    if (!confirm(`นำเข้ารุ่นงดรับซื้อ (isActive:false) ${toAdd.length} รุ่น?\nรุ่นที่มีชื่อซ้ำจะถูกข้ามอัตโนมัติ ราคาเริ่มที่ 0 และยังไม่มีรูป (เติมทีหลังได้)`)) return;
    setImportingDiscontinued(true);
    const t = toast.loading(`กำลังนำเข้า 0/${toAdd.length}...`);
    try {
      let n = 0;
      for (const m of toAdd) {
        await update(push(ref(db, 'models')), { ...m, isActive: false, updatedAt: Date.now() });
        n++;
        toast.loading(`กำลังนำเข้า ${n}/${toAdd.length}...`, { id: t });
      }
      toast.success(`นำเข้าสำเร็จ ${n} รุ่น (งดรับซื้อ)`, { id: t });
    } catch {
      toast.error('นำเข้าไม่สำเร็จ ลองใหม่อีกครั้งครับ', { id: t });
    } finally {
      setImportingDiscontinued(false);
    }
  };

  // Schema-driven auto-migration. Legacy variants store the combined attribute
  // string in `v.name` joined by '|'. We resolve the (admin-editable) schema for
  // the category and assign each pipe-separated part to schema[i].key in order.
  // Fallback when no schema: a single `storage` key. Shared by clone + edit so
  // there is one migration path.
  const migrateVariantsToSchema = (obj: any) => {
    const schema = obj.attributesSchema || resolveCategorySchema(obj.category, categoriesData);
    obj.attributesSchema = schema;
    obj.variants = (obj.variants || []).map((v: any) => {
      if (!v.attributes) {
        v.attributes = {};
        const parts = (v.name || '').split('|').map((s: string) => s.trim());
        if (Array.isArray(schema) && schema.length > 0) {
          schema.forEach((attr: any, i: number) => {
            v.attributes[attr.key] = parts[i] || '';
          });
        } else {
          v.attributes.storage = parts[0] || v.name || '';
        }
      }
      return v;
    });
    return obj;
  };

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

    migrateVariantsToSchema(cloned);

    setEditingItem(cloned);
    setIsModalOpen(true);
    toast.success('สำเนาสินค้าเรียบร้อย กรุณาตรวจสอบและบันทึกครับ');
  };

  // Auto-Migration: ดึงข้อมูลเดิมมาหั่นเป็น Attributes ชั่วคราวถ้ายังไม่มี
  const migrateEditingItem = (item: any) => {
    return migrateVariantsToSchema(JSON.parse(JSON.stringify(item)));
  };

  // ของใหม่ → default เป็น modifier mode
  const buildNewModel = () => {
    const schema = resolveCategorySchema(activeCategory, categoriesData);
    const initialModifiers: Record<string, { options: any[] }> = {};
    for (const attr of schema) {
      initialModifiers[attr.key] = { options: [] };
    }
    return {
      id: Date.now().toString(),
      brand: activeBrand === 'All' ? 'Apple' : activeBrand,
      category: activeCategory,
      series: '', name: '', imageUrl: '', isActive: true, isFeatured: false, inStore: true, pickup: true, mailIn: true,
      maxPickupDistanceKm: 0,
      conditionSetId: conditionSets.length > 0 ? conditionSets[0].id : '',
      liquidityFactor: 1,
      attributesSchema: schema,
      pricingMode: 'modifier',
      baseNewPrice: 0,
      baseUsedPrice: 0,
      attributeModifiers: initialModifiers,
      variants: []
    };
  };

  // Single entry point for add/edit — routes to the mobile full-screen page or
  // the desktop modal based on the current breakpoint. Both views share the same
  // editingItem state + handleSaveModel, so there is one data/save path.
  const handleOpenModal = (item: any = null) => {
    setEditingItem(item ? migrateEditingItem(item) : buildNewModel());
    if (isMobile) setIsMobileEditOpen(true);
    else setIsModalOpen(true);
  };

  const filteredModels = modelsData.filter(item => {
    const matchCategory = item.category === activeCategory;
    const matchBrand = activeBrand === 'All' || item.brand === activeBrand;
    const matchSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || (item.series && item.series.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCategory && matchBrand && matchSearch;
  });

  return (
    <div className="h-full overflow-y-auto lg:h-auto lg:overflow-visible p-4 lg:p-6 max-w-[1600px] mx-auto lg:min-h-screen bg-slate-50/50">

      {/* --- Top Navigation --- */}
      <div className="bg-white rounded-t-2xl border-b border-slate-200 shadow-sm px-4 pt-4 flex gap-6 overflow-x-auto">
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCategory(cat.name)} className={`flex items-center gap-2 pb-4 px-2 border-b-4 transition-all whitespace-nowrap ${activeCategory === cat.name ? 'border-blue-600 text-blue-600 font-black' : 'border-transparent text-slate-500 font-bold hover:text-slate-700'}`}>
            {getCategoryIcon(cat.icon)} {cat.name}
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
          <button onClick={() => setIsCategoryModalOpen(true)} className="bg-white border text-slate-700 px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition whitespace-nowrap shadow-sm"><LayoutGrid size={18} className="text-emerald-500" /> Manage Categories</button>
          <button onClick={() => setIsSubcategoryModalOpen(true)} className="bg-white border text-slate-700 px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition whitespace-nowrap shadow-sm"><Layers size={18} className="text-violet-500" /> Subcategories</button>
          <button onClick={() => setIsSeriesModalOpen(true)} className="bg-white border text-slate-700 px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition whitespace-nowrap shadow-sm"><FolderTree size={18} className="text-blue-500" /> Manage Series</button>
          <button onClick={handleFillAliases} disabled={fillingAliases} className="bg-white border text-slate-700 px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition whitespace-nowrap shadow-sm disabled:opacity-50"><Tag size={18} className="text-amber-500" /> {fillingAliases ? 'กำลังเติมชื่อเรียก...' : 'เติมชื่อเรียกอัตโนมัติ'}</button>
          <button onClick={handleImportDiscontinued} disabled={importingDiscontinued} className="bg-white border text-slate-700 px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition whitespace-nowrap shadow-sm disabled:opacity-50"><Archive size={18} className="text-slate-400" /> นำเข้ารุ่นงดรับซื้อ</button>
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

      {/* --- Main List: table on desktop, full-width cards on mobile --- */}
      <div className="hidden lg:block">
        <ModelsTable
          models={filteredModels}
          conditionSets={conditionSets}
          coupons={coupons}
          loading={loading}
          onEdit={handleOpenModal}
          onDelete={handleDeleteModel}
          onDuplicate={handleDuplicateModel}
          onToggleStatus={handleToggleStatus}
          onToggleFeatured={handleToggleFeatured}
          onBatchAdjust={(seriesName, models) => setBatchAdjust({ seriesName, models })}
        />
      </div>
      <div className="lg:hidden">
        <PriceListMobile
          models={filteredModels}
          conditionSets={conditionSets}
          coupons={coupons}
          loading={loading}
          onEdit={handleOpenModal}
          onToggleStatus={handleToggleStatus}
          onToggleFeatured={handleToggleFeatured}
        />
      </div>

      <EngineSettingsModal
        conditionSets={conditionSets}
        isOpen={isEngineModalOpen}
        onClose={() => setIsEngineModalOpen(false)}
      />

      <SubcategoryManagementModal
        subcategories={subcategories}
        availableSeries={availableSeries}
        categories={categoriesData}
        brands={brandsData}
        isOpen={isSubcategoryModalOpen}
        onClose={() => setIsSubcategoryModalOpen(false)}
      />

      <SeriesManagementModal
        availableSeries={availableSeries}
        subcategories={subcategories}
        modelsData={modelsData}
        categories={categoriesData}
        brands={brandsData}
        isOpen={isSeriesModalOpen}
        onClose={() => setIsSeriesModalOpen(false)}
      />

      <CategoryBrandManagementModal
        categories={categoriesData}
        brands={brandsData}
        modelsData={modelsData}
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
      />

      <ProductEditorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        editingItem={editingItem}
        conditionSets={conditionSets}
        availableSeries={availableSeries}
        allModels={modelsData}
        categories={categoriesData}
        brands={brandsData}
        categorySchemas={CATEGORY_SCHEMAS}
        onSave={handleSaveModel}
        onEditingItemChange={setEditingItem}
      />

      {/* Mobile full-screen price editor — shares editingItem state + handleSaveModel */}
      {isMobileEditOpen && (
        <MobilePriceEditPage
          editingItem={editingItem}
          conditionSets={conditionSets}
          coupons={coupons}
          availableSeries={availableSeries}
          categories={categoriesData}
          brands={brandsData}
          onSave={handleSaveModel}
          onEditingItemChange={setEditingItem}
          onClose={() => setIsMobileEditOpen(false)}
        />
      )}

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
