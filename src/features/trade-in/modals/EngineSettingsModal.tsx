'use client';

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import {
  X, Plus, PlusCircle, Trash2, ClipboardList, Save, LayoutGrid, Table2
} from 'lucide-react';
import { ref, push, remove } from 'firebase/database';
import { db } from '../../../api/firebase';
import toast from 'react-hot-toast';
import { writeConditionSet } from '../utils/conditionSets';
import { CONDITION_ICONS, CONDITION_ICON_LABELS, CONDITION_ICON_KEYS, getConditionIcon } from '../constants/conditionIcons';

// AG Grid (~1MB) is only pulled in when the user opens Table view.
const DeductionTableView = lazy(() => import('../components/pricing/DeductionTableView'));

const VIEW_MODE_KEY = 'bkk.deduction.viewMode';
type ViewMode = 'card' | 'table';

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

  // One-click standard functional-check groups per subcategory. Mirrors the old
  // hardcoded screening questions (now data-driven). Each = one functional group
  // with ปกติ (pass) / มีปัญหา (reject). Admin can then tweak per model (e.g.
  // delete "แบตเตอรี่" for a Mac mini) and assign the set via PriceEditor.
  // Each seeded group carries an `icon` key (see constants/conditionIcons) so the
  // customer frontend renders the matching topic glyph instead of a generic "?".
  const FUNCTIONAL_TEMPLATES: Record<string, { label: string; items: { title: string; icon: string }[] }> = {
    iphone: { label: 'iPhone', items: [{ title: 'เปิดเครื่อง / ใช้งานทั่วไป', icon: 'power' }, { title: 'หน้าจอ + ทัชสกรีน', icon: 'screen' }, { title: 'กล้องหน้า / กล้องหลัง', icon: 'camera' }, { title: 'การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)', icon: 'connectivity' }, { title: 'ลำโพง / ไมโครโฟน', icon: 'audio' }] },
    ipad: { label: 'iPad', items: [{ title: 'เปิดเครื่อง / ใช้งานทั่วไป', icon: 'power' }, { title: 'หน้าจอ + ทัชสกรีน', icon: 'screen' }, { title: 'กล้องหน้า / กล้องหลัง', icon: 'camera' }, { title: 'Wi-Fi / Bluetooth / สัญญาณ', icon: 'connectivity' }, { title: 'ลำโพง / ไมโครโฟน', icon: 'audio' }] },
    mac: { label: 'Mac', items: [{ title: 'เปิดเครื่อง / ชาร์จไฟ', icon: 'power' }, { title: 'หน้าจอแสดงผล', icon: 'screen' }, { title: 'คีย์บอร์ด + แทร็คแพด', icon: 'keyboard' }, { title: 'พอร์ต + Wi-Fi / Bluetooth', icon: 'ports' }, { title: 'แบตเตอรี่', icon: 'battery' }] },
    watch: { label: 'Apple Watch', items: [{ title: 'เปิดเครื่อง / ชาร์จไฟ', icon: 'power' }, { title: 'หน้าจอ + ทัชสกรีน', icon: 'screen' }, { title: 'Digital Crown + ปุ่มข้าง', icon: 'crown' }, { title: 'เซ็นเซอร์ (วัดชีพจร ฯลฯ)', icon: 'sensors' }, { title: 'Wi-Fi / Bluetooth', icon: 'connectivity' }] },
  };

  const handleSeedFunctional = (cat: string) => {
    const tpl = FUNCTIONAL_TEMPLATES[cat];
    if (!tpl) return;
    const base = Date.now();
    const seeded = tpl.items.map(({ title, icon }, i) => ({
      id: `g_${base}_${i}`,
      title,
      icon,
      kind: 'functional',
      options: [
        { id: `o_${base}_${i}_0`, label: 'ปกติ / ใช้งานได้', t1: 0, t2: 0, t3: 0, failBehavior: 'pass' },
        { id: `o_${base}_${i}_1`, label: 'มีปัญหา / ใช้งานไม่ได้', t1: 0, t2: 0, t3: 0, failBehavior: 'reject' },
      ],
    }));
    // Prepend so the functional screening comes before the cosmetic groups.
    setEditingSet({ ...editingSet, groups: [...seeded, ...(editingSet.groups || [])] });
    toast.success(`เพิ่มชุดคัดกรองการทำงาน ${tpl.label} (${tpl.items.length} ข้อ) — อย่าลืมกด Save Set`);
  };

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
                        <button onClick={() => handleRemoveGroup(gi)} className="text-slate-300 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition opacity-0 group-hover/group:opacity-100">
                          <Trash2 size={20} />
                        </button>
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
