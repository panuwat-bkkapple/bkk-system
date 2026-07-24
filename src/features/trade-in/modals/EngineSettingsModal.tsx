'use client';

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import {
  X, Plus, PlusCircle, Trash2, ClipboardList, Save, LayoutGrid, Table2,
  Copy, ChevronUp, ChevronDown, Languages
} from 'lucide-react';
import { ref, push, remove } from 'firebase/database';
import { db } from '../../../api/firebase';
import toast from 'react-hot-toast';
import { writeConditionSet } from '../utils/conditionSets';
import { fillEnFields } from '../utils/assessmentEnSeed';
import { FUNCTIONAL_TEMPLATES, CONDITION_TEMPLATES } from '../utils/assessmentSeedTemplates';
import { ASSESSMENT_PRESETS } from '../utils/assessmentPresets';
import { CONDITION_ICONS, CONDITION_ICON_LABELS, CONDITION_ICON_KEYS, getConditionIcon } from '../constants/conditionIcons';

// AG Grid (~1MB) is only pulled in when the user opens Table view.
const DeductionTableView = lazy(() => import('../components/pricing/DeductionTableView'));

const VIEW_MODE_KEY = 'bkk.deduction.viewMode';
type ViewMode = 'card' | 'table';

// Monotonic id generator for duplicated groups/options. Date.now() alone
// collides when cloning a whole group (many options minted in the same tick),
// which would produce duplicate React keys and duplicate `groupId::optionId`
// rowKeys in the table view. The counter guarantees uniqueness within a session.
let _uidSeq = 0;
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(_uidSeq++).toString(36)}`;

interface EngineSettingsModalProps {
  conditionSets: any[];
  isOpen: boolean;
  onClose: () => void;
}

export const EngineSettingsModal: React.FC<EngineSettingsModalProps> = ({ conditionSets, isOpen, onClose }) => {
  const [activeSetId, setActiveSetId] = useState<string | null>(conditionSets.length > 0 ? conditionSets[0].id : null);
  const [editingSet, setEditingSet] = useState<any>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'card';
    return (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) === 'table' ? 'table' : 'card';
  });

  // Which group's icon-picker popover is open (by group id), or null.
  const [iconMenuFor, setIconMenuFor] = useState<string | null>(null);

  // Keep latest editingSet for rollback inside async callbacks without stale closures.
  const editingSetRef = useRef<any>(null);
  useEffect(() => { editingSetRef.current = editingSet; }, [editingSet]);

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (activeSetId) {
      const found = conditionSets.find(c => c.id === activeSetId);
      if (found) {
        // เติมคำแปลอังกฤษเป็นค่า default ตั้งแต่เปิดชุด (เฉพาะช่องที่ยังว่าง —
        // ของที่กรอกไว้ไม่ถูกทับ) ยังเป็นแค่ state ในหน้าจอจนกว่าจะกด Save
        const copy = JSON.parse(JSON.stringify(found));
        const { groups } = fillEnFields(copy.groups || []);
        setEditingSet({ ...copy, groups });
      }
    } else {
      setEditingSet(null);
    }
  }, [activeSetId, conditionSets]);

  const handleCreateNewSet = async () => {
    const newRef = await push(ref(db, 'settings/condition_sets'), {
      name: 'ชุดประเมินใหม่',
      groups: [{ id: 'g_' + Date.now(), title: 'หัวข้อประเมินใหม่', options: [{ id: 'o_' + Date.now(), label: 'ตัวเลือก 1', deduct: 0 }] }]
    });
    setActiveSetId(newRef.key);
  };

  // Pre-fill empty *_en fields from the bundled Thai->EN seed table. Local
  // editing state only — the admin reviews then saves through Save Set as usual.
  const handleFillEnTranslations = () => {
    if (!editingSet) return;
    const { groups, filled } = fillEnFields(editingSet.groups || []);
    if (filled === 0) {
      toast('ไม่พบคำที่แปลได้เพิ่ม');
      return;
    }
    setEditingSet({ ...editingSet, groups });
    toast.success(`เติมคำแปลแล้ว ${filled} ช่อง — ตรวจสอบแล้วกดบันทึก`);
  };

  const handleSaveSet = async () => {
    if (!editingSet) return;
    await writeConditionSet(editingSet);
    toast.success('บันทึกชุดประเมินสำเร็จ!');
  };

  // Shared optimistic-commit path for the inline table view. Updates local
  // state first, persists through the SAME writeConditionSet() helper the card
  // view uses, and rolls back + rejects on failure so the grid can revert.
  const commitSet = useCallback(async (newSet: any) => {
    const prev = editingSetRef.current;
    setEditingSet(newSet);
    try {
      await writeConditionSet(newSet);
    } catch (e) {
      setEditingSet(prev);
      toast.error('บันทึกไม่สำเร็จ คืนค่าเดิมแล้ว');
      throw e;
    }
  }, []);

  const handleDeleteSet = async (id: string) => {
    if (confirm('ยืนยันการลบชุดประเมินนี้? หากมีสินค้ารุ่นไหนใช้อยู่จะทำให้การประเมินราคาพังได้')) {
      await remove(ref(db, `settings/condition_sets/${id}`));
      setActiveSetId(conditionSets.length > 0 ? conditionSets[0].id : null);
    }
  }

  const handleAddGroup = () => {
    const newGroups = [...(editingSet.groups || [])];
    newGroups.push({ id: 'g_' + Date.now(), title: 'หัวข้อประเมินใหม่', options: [{ id: 'o_' + Date.now(), label: 'ตัวเลือกใหม่', deduct: 0 }] });
    setEditingSet({ ...editingSet, groups: newGroups });
  }

  const handleRemoveGroup = (groupIndex: number) => {
    const newGroups = [...editingSet.groups];
    newGroups.splice(groupIndex, 1);
    setEditingSet({ ...editingSet, groups: newGroups });
  }

  const handleAddOption = (groupIndex: number) => {
    const newGroups = [...editingSet.groups];
    newGroups[groupIndex].options.push({ id: 'o_' + Date.now(), label: '', deduct: 0 });
    setEditingSet({ ...editingSet, groups: newGroups });
  }

  const handleRemoveOption = (groupIndex: number, optionIndex: number) => {
    const newGroups = [...editingSet.groups];
    newGroups[groupIndex].options.splice(optionIndex, 1);
    setEditingSet({ ...editingSet, groups: newGroups });
  }

  // Duplicate a whole assessment group (card) — deep-clone so the copy never
  // shares references with the source, and re-mint every id (group + all its
  // options) so keys/rowKeys stay unique. Inserted right after the original.
  const handleDuplicateGroup = (groupIndex: number) => {
    const src = editingSet.groups[groupIndex];
    const clone = {
      ...JSON.parse(JSON.stringify(src)),
      id: uid('g'),
      title: `${src.title || 'หัวข้อประเมิน'} (สำเนา)`,
      options: (src.options || []).map((o: any) => ({ ...JSON.parse(JSON.stringify(o)), id: uid('o') })),
    };
    const newGroups = [...editingSet.groups];
    newGroups.splice(groupIndex + 1, 0, clone);
    setEditingSet({ ...editingSet, groups: newGroups });
  }

  // Duplicate a single condition option (rule) within a group, inserted right
  // after the original. Deep-clone + new id so it is fully independent.
  const handleDuplicateOption = (groupIndex: number, optionIndex: number) => {
    const newGroups = [...editingSet.groups];
    const options = [...newGroups[groupIndex].options];
    const clone = { ...JSON.parse(JSON.stringify(options[optionIndex])), id: uid('o') };
    options.splice(optionIndex + 1, 0, clone);
    newGroups[groupIndex] = { ...newGroups[groupIndex], options };
    setEditingSet({ ...editingSet, groups: newGroups });
  }

  // Swap a group card with its neighbour (dir -1 = up, +1 = down). Order is
  // meaningful: it drives the sequence customers see on the assessment flow.
  const handleMoveGroup = (groupIndex: number, dir: -1 | 1) => {
    const target = groupIndex + dir;
    if (target < 0 || target >= editingSet.groups.length) return;
    const newGroups = [...editingSet.groups];
    [newGroups[groupIndex], newGroups[target]] = [newGroups[target], newGroups[groupIndex]];
    setEditingSet({ ...editingSet, groups: newGroups });
  }

  // Seed template DATA lives in utils/assessmentSeedTemplates.ts (imported
  // above) so the EN-coverage test can assert every Thai string translates.

  const handleSeedFunctional = (cat: string) => {
    const tpl = FUNCTIONAL_TEMPLATES[cat];
    if (!tpl) return;
    const base = Date.now();
    const seeded = tpl.items.map(({ title, icon, description, options }, i) => ({
      id: `g_${base}_${i}`,
      title,
      icon,
      description,
      kind: 'functional',
      options: options.map((o, j) => ({ id: `o_${base}_${i}_${j}`, label: o.label, description: o.description, deduct: 0, failBehavior: o.failBehavior })),
    }));
    // Prepend so the functional screening comes before the cosmetic groups.
    // fillEnFields: seeded groups arrive with their English pair pre-filled
    // (existing non-empty *_en on the old groups is never overwritten).
    const { groups } = fillEnFields([...seeded, ...(editingSet.groups || [])]);
    setEditingSet({ ...editingSet, groups });
    toast.success(`เพิ่มชุดคัดกรองการทำงาน ${tpl.label} (${tpl.items.length} ข้อ) — อย่าลืมกด Save Set`);
  };

  const handleSeedCondition = (key: string) => {
    const tpl = CONDITION_TEMPLATES[key];
    if (!tpl) return;
    const base = Date.now();
    const seeded = tpl.items.map((g, i) => ({
      id: `g_${base}_${i}`,
      title: g.title,
      icon: g.icon,
      description: g.description,
      kind: g.kind,
      options: g.options.map((o, j) => {
        const opt: any = { id: `o_${base}_${i}_${j}`, label: o.label, description: o.description };
        // pct wins over deduct; a reject option needs no amount.
        if (o.pct != null) opt.pct = o.pct;
        else if (o.deduct != null) opt.deduct = o.deduct;
        // Keep failBehavior when the template sets it (reject / deduct) even on
        // cosmetic groups — the customer summary reads it to flag Rejected.
        if (o.failBehavior) opt.failBehavior = o.failBehavior;
        return opt;
      }),
    }));
    // Append at the end — admin reorders with the group move up/down controls.
    // fillEnFields: seeded groups arrive with their English pair pre-filled.
    const { groups } = fillEnFields([...(editingSet.groups || []), ...seeded]);
    setEditingSet({ ...editingSet, groups });
    toast.success(`เพิ่มชุดคัดกรองสภาพ / คุณสมบัติ (${tpl.items.length} กลุ่ม) — อย่าลืมกด Save Set`);
  };

  // ---- Bilingual preset picker (ชุดมาตรฐาน) -------------------------------
  // Applies a curated TH+EN pair to the FOUR TEXT FIELDS ONLY (title/label +
  // descriptions). Pricing fields (deduct / pct / failBehavior / tiers) are
  // never touched — the admin keeps full control and can still edit freely.
  const applyGroupPreset = (gi: number, key: string) => {
    const [cat, idx] = key.split('::');
    const entry = ASSESSMENT_PRESETS[cat]?.topics[Number(idx)];
    if (!entry) return;
    const n = [...editingSet.groups];
    const g = { ...n[gi], title: entry.th, title_en: entry.en };
    if (entry.desc_th) g.description = entry.desc_th;
    if (entry.desc_en) g.description_en = entry.desc_en;
    n[gi] = g;
    setEditingSet({ ...editingSet, groups: n });
  };

  const applyOptionPreset = (gi: number, oi: number, key: string) => {
    const [cat, idx] = key.split('::');
    const entry = ASSESSMENT_PRESETS[cat]?.options[Number(idx)];
    if (!entry) return;
    const n = [...editingSet.groups];
    const options = [...n[gi].options];
    const o = { ...options[oi], label: entry.th, label_en: entry.en };
    if (entry.desc_th) o.description = entry.desc_th;
    if (entry.desc_en) o.description_en = entry.desc_en;
    options[oi] = o;
    n[gi] = { ...n[gi], options };
    setEditingSet({ ...editingSet, groups: n });
  };

  // Reusable grouped <select> over the preset catalog. `source` picks whether
  // the choices come from each category's topics (group titles) or options.
  // Plain render helper (not a nested component) so the <select> DOM node is
  // not remounted on every parent re-render.
  const renderPresetPicker = (source: 'topics' | 'options', onPick: (key: string) => void, title: string) => (
    <select
      value=""
      onChange={(e) => { if (e.target.value) { onPick(e.target.value); e.currentTarget.value = ''; } }}
      title={title}
      className="shrink-0 max-w-[190px] text-[10px] font-bold text-sky-600 bg-sky-50 border border-sky-100 rounded-lg px-2 py-1 cursor-pointer hover:bg-sky-100 transition outline-none"
    >
      <option value="">เลือกจากชุดมาตรฐาน…</option>
      {Object.entries(ASSESSMENT_PRESETS).map(([k, cat]) => (
        cat[source].length > 0 && (
          <optgroup key={k} label={cat.label}>
            {cat[source].map((entry, i) => (
              <option key={i} value={`${k}::${i}`}>{entry.th}</option>
            ))}
          </optgroup>
        )
      ))}
    </select>
  );

  if (!isOpen) return null;

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
          <button onClick={onClose} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full transition"><X size={24} /></button>
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
                  <div className="flex items-center gap-3">
                    {/* View toggle — persisted in localStorage, default = card */}
                    <div className="flex items-center bg-slate-100 rounded-xl p-1">
                      <button
                        onClick={() => changeViewMode('card')}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition ${viewMode === 'card' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="มุมมองการ์ด (จัดกลุ่ม)"
                      >
                        <LayoutGrid size={16} /> Card
                      </button>
                      <button
                        onClick={() => changeViewMode('table')}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition ${viewMode === 'table' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="มุมมองตาราง (แก้ในตาราง + วาง + fill-down)"
                      >
                        <Table2 size={16} /> Table
                      </button>
                    </div>
                    {/* Seed standard functional-check groups for a subcategory */}
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) { handleSeedFunctional(e.target.value); e.currentTarget.value = ''; } }}
                      title="เพิ่มชุดคัดกรองการทำงานมาตรฐานตามประเภทเครื่อง"
                      className="px-3 py-3 bg-blue-50 text-blue-700 font-black rounded-xl text-sm border border-blue-200 hover:bg-blue-100 transition cursor-pointer"
                    >
                      <option value="">+ ชุดคัดกรองการทำงาน…</option>
                      {Object.entries(FUNCTIONAL_TEMPLATES).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    {/* Seed cosmetic (body/screen) + qualifying (warranty/country/repair) groups */}
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) { handleSeedCondition(e.target.value); e.currentTarget.value = ''; } }}
                      title="เพิ่มชุดคัดกรองสภาพภายนอก + คุณสมบัติ (เกรดสรุปที่ checkout / ประกัน / ประเทศ / ประวัติซ่อม)"
                      className="px-3 py-3 bg-emerald-50 text-emerald-700 font-black rounded-xl text-sm border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer"
                    >
                      <option value="">+ ชุดคัดกรองสภาพ / คุณสมบัติ…</option>
                      {Object.entries(CONDITION_TEMPLATES).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    {/* Pre-fill empty *_en labels from the central seed table (review, then Save Set) */}
                    <button
                      onClick={handleFillEnTranslations}
                      title="เติมป้ายภาษาอังกฤษจากตารางคำแปลกลาง เฉพาะช่องที่ยังว่าง"
                      className="px-3 py-3 bg-sky-50 text-sky-700 font-black rounded-xl text-sm border border-sky-200 hover:bg-sky-100 transition flex items-center gap-1.5"
                    >
                      <Languages size={16} /> เติมคำแปลอัตโนมัติ
                    </button>
                    <button onClick={handleSaveSet} className="px-8 py-3 bg-indigo-600 text-white font-black rounded-xl hover:bg-indigo-700 transition flex items-center gap-2 shadow-lg hover:shadow-indigo-500/30">
                      <Save size={18} /> Save Set
                    </button>
                  </div>
                </div>

                {viewMode === 'table' ? (
                  <div className="flex-1 overflow-hidden p-6 bg-slate-50/50">
                    <Suspense fallback={<div className="h-full flex items-center justify-center text-slate-400 font-bold">กำลังโหลดตาราง...</div>}>
                      <DeductionTableView set={editingSet} onCommit={commitSet} />
                    </Suspense>
                  </div>
                ) : (
                <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 space-y-8">
                  {editingSet.groups?.map((g: any, gi: number) => (
                    <div key={g.id} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative group/group">

                      {/* Group Header */}
                      <div className="flex justify-between items-center mb-2">
                        {/* Icon picker — the chosen key is stored on the group and
                            drives the topic glyph shown to customers on the
                            assessment flow. No key = auto-guess from the title. */}
                        {(() => {
                          const PreviewIcon = getConditionIcon(g.icon, g.title);
                          const open = iconMenuFor === g.id;
                          return (
                            <div className="relative mr-3 shrink-0">
                              <button
                                type="button"
                                onClick={() => setIconMenuFor(open ? null : g.id)}
                                title="เลือกไอคอนหัวข้อ (ที่ลูกค้าเห็นตอนประเมิน)"
                                className={`w-11 h-11 rounded-2xl flex items-center justify-center transition border ${open ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'}`}
                              >
                                <PreviewIcon size={22} />
                              </button>
                              {open && (
                                <>
                                  <div className="fixed inset-0 z-20" onClick={() => setIconMenuFor(null)} />
                                  <div className="absolute left-0 top-full mt-2 z-30 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 w-64">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1">เลือกไอคอน</div>
                                    <div className="grid grid-cols-6 gap-1.5">
                                      {CONDITION_ICON_KEYS.map((key) => {
                                        const Ico = CONDITION_ICONS[key];
                                        const active = (g.icon || '') === key;
                                        return (
                                          <button
                                            key={key}
                                            type="button"
                                            title={CONDITION_ICON_LABELS[key] || key}
                                            onClick={() => { const n = [...editingSet.groups]; n[gi].icon = key; setEditingSet({ ...editingSet, groups: n }); setIconMenuFor(null); }}
                                            className={`aspect-square rounded-lg flex items-center justify-center transition ${active ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}
                                          >
                                            <Ico size={18} />
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => { const n = [...editingSet.groups]; delete n[gi].icon; setEditingSet({ ...editingSet, groups: n }); setIconMenuFor(null); }}
                                      className="mt-2 w-full text-[11px] font-bold text-slate-400 hover:text-indigo-600 py-1.5 rounded-lg hover:bg-slate-50 transition"
                                    >
                                      อัตโนมัติ (เดาจากชื่อหัวข้อ)
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })()}
                        <input type="text" placeholder="ชื่อหัวข้อ (เช่น สภาพตัวเครื่อง)" value={g.title} onChange={(e) => { const n = [...editingSet.groups]; n[gi].title = e.target.value; setEditingSet({ ...editingSet, groups: n }); }} className="font-black text-xl bg-transparent border-none outline-none w-full flex-1 mr-4 focus:text-indigo-600 transition-colors" />
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/group:opacity-100 transition-opacity">
                          <button onClick={() => handleMoveGroup(gi, -1)} disabled={gi === 0} title="เลื่อนขึ้น" className="text-slate-300 hover:text-indigo-600 p-2 rounded-lg hover:bg-indigo-50 transition disabled:opacity-30 disabled:hover:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                            <ChevronUp size={20} />
                          </button>
                          <button onClick={() => handleMoveGroup(gi, 1)} disabled={gi === (editingSet.groups?.length || 0) - 1} title="เลื่อนลง" className="text-slate-300 hover:text-indigo-600 p-2 rounded-lg hover:bg-indigo-50 transition disabled:opacity-30 disabled:hover:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                            <ChevronDown size={20} />
                          </button>
                          <button onClick={() => handleDuplicateGroup(gi)} title="ทำสำเนาหัวข้อนี้" className="text-slate-300 hover:text-indigo-600 p-2 rounded-lg hover:bg-indigo-50 transition">
                            <Copy size={18} />
                          </button>
                          <button onClick={() => handleRemoveGroup(gi)} title="ลบหัวข้อนี้" className="text-slate-300 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition">
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </div>
                      {/* ป้ายภาษาอังกฤษของหัวข้อ (ไม่บังคับ) — เว็บลูกค้าใช้แสดงบน /en, ค่าไทยยังเป็นค่าหลัก */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] font-black text-sky-600 bg-sky-50 border border-sky-100 rounded px-1.5 py-0.5 shrink-0" title="ป้ายภาษาอังกฤษ (ไม่บังคับ)">EN</span>
                        <input
                          type="text"
                          placeholder="English title (optional)"
                          value={g.title_en || ''}
                          onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v) n[gi].title_en = v; else delete n[gi].title_en; setEditingSet({ ...editingSet, groups: n }); }}
                          className="w-full text-sm font-bold text-slate-500 bg-transparent border-none outline-none focus:text-slate-700 placeholder:text-slate-300 placeholder:font-medium"
                        />
                        {/* เลือกหัวข้อจากชุดมาตรฐาน — เติมไทย+อังกฤษ (และคำอธิบายถ้ามี) ไม่แตะราคา */}
                        {renderPresetPicker('topics', (key) => applyGroupPreset(gi, key), 'เลือกหัวข้อจากชุดมาตรฐาน — เติมชื่อไทย + อังกฤษให้อัตโนมัติ (ไม่แตะค่าหักเงิน) แก้ไขต่อได้')}
                      </div>
                      {/* Group description — shown to customers under the topic heading */}
                      <input
                        type="text"
                        placeholder="คำอธิบายใต้หัวข้อ (ลูกค้าเห็นตอนประเมิน เช่น ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว) — ไม่บังคับ"
                        value={g.description || ''}
                        onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v) n[gi].description = v; else delete n[gi].description; setEditingSet({ ...editingSet, groups: n }); }}
                        className="w-full text-sm font-bold text-slate-500 bg-transparent border-none outline-none mb-1 focus:text-slate-700 placeholder:text-slate-300 placeholder:font-medium"
                      />
                      {/* คำอธิบายหัวข้อภาษาอังกฤษ (ไม่บังคับ) */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[9px] font-black text-sky-600 bg-sky-50 border border-sky-100 rounded px-1.5 py-0.5 shrink-0" title="ป้ายภาษาอังกฤษ (ไม่บังคับ)">EN</span>
                        <input
                          type="text"
                          placeholder="English description (optional)"
                          value={g.description_en || ''}
                          onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v) n[gi].description_en = v; else delete n[gi].description_en; setEditingSet({ ...editingSet, groups: n }); }}
                          className="w-full text-xs font-medium text-slate-400 bg-transparent border-none outline-none focus:text-slate-600 placeholder:text-slate-300"
                        />
                      </div>
                      {/* Group kind: cosmetic (deduct only) vs functional (can reject) */}
                      <div className="flex items-center gap-1.5 mb-5">
                        {(['cosmetic', 'functional'] as const).map((k) => {
                          const active = (g.kind || 'cosmetic') === k;
                          return (
                            <button key={k} onClick={() => { const n = [...editingSet.groups]; n[gi].kind = k; setEditingSet({ ...editingSet, groups: n }); }}
                              className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide transition ${active ? (k === 'functional' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-white') : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                              {k === 'functional' ? 'การทำงาน' : 'สภาพภายนอก'}
                            </button>
                          );
                        })}
                        {g.kind === 'functional' && <span className="text-[10px] text-blue-500 font-bold ml-1">ลูกค้าตอบก่อนประเมินสภาพ · เลือกพฤติกรรมต่อข้อด้านล่าง</span>}
                      </div>

                      {/* Options Table Header */}
                      <div className="grid grid-cols-12 gap-3 mb-2 px-2">
                        <div className="col-span-5"><span className="text-[10px] font-black uppercase text-slate-400">Condition Option (ตัวเลือก)</span></div>
                        <div className="col-span-3 text-center"><span className="text-[10px] font-black uppercase text-red-500">หักเงิน (฿)</span></div>
                        <div className="col-span-3 text-center"><span className="text-[10px] font-black uppercase text-indigo-500">หัก % ของราคา (override ฿)</span></div>
                        <div className="col-span-1"></div>
                      </div>

                      {/* Options List */}
                      <div className="space-y-2">
                        {g.options.map((o: any, oi: number) => (
                          <div key={o.id} className="grid grid-cols-12 gap-3 items-center bg-slate-50 p-2 rounded-xl border border-slate-100 group/option hover:border-indigo-200 transition-colors">
                            <div className="col-span-5">
                              <input type="text" placeholder="เช่น สวยสมบูรณ์" value={o.label} onChange={(e) => { const n = [...editingSet.groups]; n[gi].options[oi].label = e.target.value; setEditingSet({ ...editingSet, groups: n }); }} className="w-full px-4 py-2.5 rounded-lg border-none bg-white shadow-sm text-sm font-bold focus:ring-2 focus:ring-indigo-500" />
                              {/* ป้ายภาษาอังกฤษของตัวเลือก (ไม่บังคับ) — แสดงบนเว็บลูกค้า /en */}
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <span className="text-[9px] font-black text-sky-600 bg-sky-50 border border-sky-100 rounded px-1.5 py-0.5 shrink-0" title="ป้ายภาษาอังกฤษ (ไม่บังคับ)">EN</span>
                                <input
                                  type="text"
                                  placeholder="English label (optional)"
                                  value={o.label_en || ''}
                                  onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v) n[gi].options[oi].label_en = v; else delete n[gi].options[oi].label_en; setEditingSet({ ...editingSet, groups: n }); }}
                                  className="w-full px-3 py-1.5 rounded-lg border-none bg-white/70 shadow-sm text-xs font-medium text-slate-600 focus:ring-2 focus:ring-sky-300 placeholder:text-slate-300"
                                />
                                {/* เลือกตัวเลือกจากชุดมาตรฐาน — เติมไทย+อังกฤษ (และคำอธิบายถ้ามี) ไม่แตะค่าหักเงิน */}
                                {renderPresetPicker('options', (key) => applyOptionPreset(gi, oi, key), 'เลือกตัวเลือกจากชุดมาตรฐาน — เติมป้ายไทย + อังกฤษให้อัตโนมัติ (ไม่แตะค่าหักเงิน) แก้ไขต่อได้')}
                              </div>
                              <input
                                type="text"
                                placeholder="คำอธิบายตัวเลือก (ลูกค้าเห็นใต้ชื่อตัวเลือก) — ไม่บังคับ"
                                value={o.description || ''}
                                onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v) n[gi].options[oi].description = v; else delete n[gi].options[oi].description; setEditingSet({ ...editingSet, groups: n }); }}
                                className="w-full px-4 py-1.5 mt-1.5 rounded-lg border-none bg-white/70 shadow-sm text-xs font-medium text-slate-500 focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-300"
                              />
                              {/* คำอธิบายตัวเลือกภาษาอังกฤษ (ไม่บังคับ) */}
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <span className="text-[9px] font-black text-sky-600 bg-sky-50 border border-sky-100 rounded px-1.5 py-0.5 shrink-0" title="ป้ายภาษาอังกฤษ (ไม่บังคับ)">EN</span>
                                <input
                                  type="text"
                                  placeholder="English description (optional)"
                                  value={o.description_en || ''}
                                  onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v) n[gi].options[oi].description_en = v; else delete n[gi].options[oi].description_en; setEditingSet({ ...editingSet, groups: n }); }}
                                  className="w-full px-3 py-1.5 rounded-lg border-none bg-white/70 shadow-sm text-xs font-medium text-slate-500 focus:ring-2 focus:ring-sky-300 placeholder:text-slate-300"
                                />
                              </div>
                              {g.kind === 'functional' && (
                                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                  <span className="text-[9px] font-black uppercase text-slate-400 mr-0.5">ถ้าลูกค้าเลือกข้อนี้:</span>
                                  {([['pass', 'ปกติ'], ['reject', 'ปฏิเสธรับซื้อ'], ['deduct', 'หักเงิน (ตาม Tier)']] as const).map(([fb, lbl]) => {
                                    const active = (o.failBehavior || 'pass') === fb;
                                    const color = fb === 'reject' ? 'bg-red-500' : fb === 'deduct' ? 'bg-amber-500' : 'bg-emerald-500';
                                    return (
                                      <button key={fb} onClick={() => { const n = [...editingSet.groups]; n[gi].options[oi].failBehavior = fb; setEditingSet({ ...editingSet, groups: n }); }}
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${active ? `${color} text-white` : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'}`}>
                                        {lbl}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <div className="col-span-3">
                              <input
                                type="number"
                                min={0}
                                placeholder={o.pct != null ? 'ใช้ % แทน' : '0'}
                                value={o.deduct ?? ''}
                                onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v === '') delete n[gi].options[oi].deduct; else n[gi].options[oi].deduct = Number(v); setEditingSet({ ...editingSet, groups: n }); }}
                                className="w-full px-2 py-2.5 rounded-lg border-none bg-white shadow-sm text-center font-black text-red-600 focus:ring-2 focus:ring-red-500 disabled:opacity-40"
                                disabled={o.pct != null}
                              />
                              {/* LEGACY tiers — คลิกเพื่อใช้เป็นค่าเดียว (หายไปเองหลัง save) */}
                              {o.deduct == null && o.pct == null && (o.t1 != null || o.t2 != null || o.t3 != null) && (
                                <div className="flex items-center justify-center gap-1 mt-1 flex-wrap">
                                  <span className="text-[9px] font-bold text-slate-400">Tier เดิม:</span>
                                  {(['t1', 't2', 't3'] as const).map((k) => (
                                    <button
                                      key={k}
                                      type="button"
                                      title={`ใช้ค่า ${k.toUpperCase()} เป็นค่าหักเดียว`}
                                      onClick={() => { const n = [...editingSet.groups]; n[gi].options[oi].deduct = Number(o[k] || 0); setEditingSet({ ...editingSet, groups: n }); }}
                                      className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold hover:bg-amber-100 transition"
                                    >
                                      {Number(o[k] || 0).toLocaleString('th-TH')}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="col-span-3">
                              <div className="relative">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  placeholder="—"
                                  value={o.pct ?? ''}
                                  onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v === '') delete n[gi].options[oi].pct; else n[gi].options[oi].pct = Math.min(100, Math.max(0, Number(v))); setEditingSet({ ...editingSet, groups: n }); }}
                                  className="w-full pl-2 pr-7 py-2.5 rounded-lg border-none bg-white shadow-sm text-center font-black text-indigo-600 focus:ring-2 focus:ring-indigo-500"
                                />
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-indigo-300 pointer-events-none">%</span>
                              </div>
                            </div>
                            <div className="col-span-1 flex flex-col items-center justify-center gap-0.5 opacity-0 group-hover/option:opacity-100 transition">
                              <button onClick={() => handleDuplicateOption(gi, oi)} title="ทำสำเนาตัวเลือกนี้" className="text-slate-300 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50 transition">
                                <Copy size={15} />
                              </button>
                              <button onClick={() => handleRemoveOption(gi, oi)} title="ลบตัวเลือกนี้" className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition">
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
                )}
              </>
            ) : <div className="flex-1 flex items-center justify-center text-slate-400 font-bold bg-slate-50/50">👈 เลือกหรือสร้างชุดประเมินจากเมนูด้านซ้าย</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EngineSettingsModal;
