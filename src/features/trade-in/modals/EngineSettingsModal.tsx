'use client';

import React, { useState, useEffect } from 'react';
import {
  X, Plus, PlusCircle, Trash2, ClipboardList, Save
} from 'lucide-react';
import { ref, push, update, remove } from 'firebase/database';
import { db } from '../../../api/firebase';
import toast from 'react-hot-toast';

interface EngineSettingsModalProps {
  conditionSets: any[];
  isOpen: boolean;
  onClose: () => void;
}

export const EngineSettingsModal: React.FC<EngineSettingsModalProps> = ({ conditionSets, isOpen, onClose }) => {
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

export default EngineSettingsModal;
