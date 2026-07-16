'use client';

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import {
  X, Plus, PlusCircle, Trash2, ClipboardList, Save, LayoutGrid, Table2,
  Copy, ChevronUp, ChevronDown
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
      if (found) setEditingSet(JSON.parse(JSON.stringify(found)));
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

  // One-click standard functional-check groups per subcategory. Mirrors the old
  // hardcoded screening questions (now data-driven). Each group carries its OWN
  // two options — a "ปกติ" pass and a topic-specific reject (e.g. battery reads
  // ปกติ / แบตเตอรี่เสื่อม, not a generic "มีปัญหา") so the labels read naturally
  // to the customer per topic. Admin can still tweak per model and assign the
  // set via PriceEditor. Each seeded group carries an `icon` key (see
  // constants/conditionIcons) so the customer frontend renders the matching
  // topic glyph. `description` = คำอธิบายใต้หัวข้อที่ลูกค้าเห็นตอนประเมิน — แอดมิน
  // แก้ทับได้ทุกช่อง.
  const OK = (description = 'ใช้งานได้ตามปกติ ไม่มีปัญหา') =>
    ({ label: 'ปกติ', description, failBehavior: 'pass' as const });
  const BAD = (label: string, description: string) =>
    ({ label, description, failBehavior: 'reject' as const });
  const FUNCTIONAL_TEMPLATES: Record<string, { label: string; items: { title: string; icon: string; description: string; options: { label: string; description: string; failBehavior: 'pass' | 'reject' }[] }[] }> = {
    iphone: { label: 'iPhone', items: [
      { title: 'เปิดเครื่อง / ใช้งานทั่วไป', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง', options: [OK('เปิดเครื่องได้ ใช้งานได้ตามปกติ'), BAD('เปิดไม่ติด / ค้าง / ดับเอง', 'เปิดไม่ติด หรือค้าง ดับเอง รีสตาร์ทเอง')] },
      { title: 'หน้าจอ + ทัชสกรีน', icon: 'screen', description: 'ทัชสกรีนตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว', options: [OK('จอชัด ทัชลื่น ไม่มีตำหนิ'), BAD('จอเสีย / ทัชมีปัญหา', 'มีจุดดำ เส้น แสงรั่ว หรือทัชสกรีนไม่ตอบสนอง')] },
      { title: 'กล้องหน้า / กล้องหลัง', icon: 'camera', description: 'ถ่ายรูป/วิดีโอได้ ไม่มีฝ้า ไม่มีรอยร้าวที่เลนส์', options: [OK('ถ่ายได้คมชัด เลนส์ปกติ'), BAD('กล้องมีปัญหา', 'ถ่ายไม่ได้ ภาพเบลอ มีฝ้า หรือเลนส์ร้าว')] },
      { title: 'การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)', icon: 'connectivity', description: 'โทรได้ รับสายได้ เชื่อมต่อ Wi-Fi ได้ สัญญาณปกติ', options: [OK('โทร/เน็ต/Wi-Fi ใช้ได้ปกติ'), BAD('สัญญาณ / การเชื่อมต่อมีปัญหา', 'โทร/รับสายไม่ได้ ต่อ Wi-Fi ไม่ได้ หรือสัญญาณผิดปกติ')] },
      { title: 'ลำโพง / ไมโครโฟน', icon: 'audio', description: 'เสียงดังชัด ไม่มีเสียงแตก ไมค์รับเสียงได้', options: [OK('เสียงดังชัด ไมค์ปกติ'), BAD('เสียง / ไมค์มีปัญหา', 'เสียงแตก ไม่ดัง หรือไมค์รับเสียงไม่ได้')] },
      { title: 'แบตเตอรี่', icon: 'battery', description: 'แบตเตอรี่ชาร์จเข้า ใช้งานได้นานพอสมควร ไม่บวม สุขภาพแบตเตอรี่ (Battery Health) อยู่ในเกณฑ์ดี', options: [OK('แบตชาร์จเข้า อยู่ได้นาน ไม่บวม'), BAD('แบตเตอรี่เสื่อม', 'สุขภาพแบตต่ำ ไฟหมดเร็ว ชาร์จไม่เข้า หรือแบตบวม')] },
    ] },
    ipad: { label: 'iPad', items: [
      { title: 'เปิดเครื่อง / ใช้งานทั่วไป', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง', options: [OK('เปิดเครื่องได้ ใช้งานได้ตามปกติ'), BAD('เปิดไม่ติด / ค้าง / ดับเอง', 'เปิดไม่ติด หรือค้าง ดับเอง รีสตาร์ทเอง')] },
      { title: 'หน้าจอ + ทัชสกรีน', icon: 'screen', description: 'ทัชสกรีนตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว', options: [OK('จอชัด ทัชลื่น ไม่มีตำหนิ'), BAD('จอเสีย / ทัชมีปัญหา', 'มีจุดดำ เส้น แสงรั่ว หรือทัชสกรีนไม่ตอบสนอง')] },
      { title: 'กล้องหน้า / กล้องหลัง', icon: 'camera', description: 'ถ่ายรูป/วิดีโอได้ ไม่มีฝ้า ไม่มีรอยร้าวที่เลนส์', options: [OK('ถ่ายได้คมชัด เลนส์ปกติ'), BAD('กล้องมีปัญหา', 'ถ่ายไม่ได้ ภาพเบลอ มีฝ้า หรือเลนส์ร้าว')] },
      { title: 'Wi-Fi / Bluetooth / สัญญาณ', icon: 'connectivity', description: 'เชื่อมต่อ Wi-Fi / Bluetooth ได้ สัญญาณปกติ', options: [OK('ต่อ Wi-Fi/Bluetooth ได้ปกติ'), BAD('การเชื่อมต่อมีปัญหา', 'ต่อ Wi-Fi หรือ Bluetooth ไม่ได้ หรือสัญญาณผิดปกติ')] },
      { title: 'ลำโพง / ไมโครโฟน', icon: 'audio', description: 'เสียงดังชัด ไม่มีเสียงแตก ไมค์รับเสียงได้', options: [OK('เสียงดังชัด ไมค์ปกติ'), BAD('เสียง / ไมค์มีปัญหา', 'เสียงแตก ไม่ดัง หรือไมค์รับเสียงไม่ได้')] },
      { title: 'แบตเตอรี่', icon: 'battery', description: 'แบตเตอรี่ชาร์จเข้า ใช้งานได้นานพอสมควร ไม่บวม สุขภาพแบตเตอรี่อยู่ในเกณฑ์ดี', options: [OK('แบตชาร์จเข้า อยู่ได้นาน ไม่บวม'), BAD('แบตเตอรี่เสื่อม', 'สุขภาพแบตต่ำ ไฟหมดเร็ว ชาร์จไม่เข้า หรือแบตบวม')] },
    ] },
    mac: { label: 'Mac', items: [
      { title: 'เปิดเครื่อง / ชาร์จไฟ', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง ชาร์จแบตได้ปกติ', options: [OK('เปิดติด ชาร์จเข้า ใช้งานได้ปกติ'), BAD('เปิดไม่ติด / ชาร์จไม่เข้า', 'เปิดไม่ติด ค้าง ดับเอง หรือชาร์จไฟไม่เข้า')] },
      { title: 'หน้าจอแสดงผล', icon: 'screen', description: 'ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว สีสม่ำเสมอ ไม่มีจอเบิร์น', options: [OK('จอชัด สีปกติ ไม่มีตำหนิ'), BAD('จอเสีย / จอเบิร์น', 'มีจุดดำ เส้น แสงรั่ว หรือจอเบิร์น')] },
      { title: 'คีย์บอร์ด + แทร็คแพด', icon: 'keyboard', description: 'ปุ่มกดได้ทุกปุ่ม ไม่มีปุ่มค้าง แทร็คแพดคลิกและเลื่อนได้ปกติ', options: [OK('ปุ่ม + แทร็คแพดใช้ได้ครบ'), BAD('คีย์บอร์ด / แทร็คแพดมีปัญหา', 'มีปุ่มค้าง กดไม่ติด หรือแทร็คแพดผิดปกติ')] },
      { title: 'พอร์ต + Wi-Fi / Bluetooth', icon: 'ports', description: 'พอร์ต USB-C/Thunderbolt ใช้งานได้ เชื่อมต่อ Wi-Fi และ Bluetooth ได้ปกติ', options: [OK('พอร์ต + การเชื่อมต่อใช้ได้ปกติ'), BAD('พอร์ต / การเชื่อมต่อมีปัญหา', 'พอร์ตใช้ไม่ได้ ต่อ Wi-Fi หรือ Bluetooth ไม่ได้')] },
      { title: 'แบตเตอรี่', icon: 'battery', description: 'แบตเตอรี่ชาร์จเข้า อยู่ได้นานพอสมควร ไม่บวม ไม่ร้อนผิดปกติ', options: [OK('แบตชาร์จเข้า อยู่ได้นาน ไม่บวม'), BAD('แบตเตอรี่เสื่อม', 'แบตหมดเร็ว ชาร์จไม่เข้า บวม หรือร้อนผิดปกติ')] },
    ] },
    watch: { label: 'Apple Watch', items: [
      { title: 'เปิดเครื่อง / ชาร์จไฟ', icon: 'power', description: 'เปิดเครื่องได้ ไม่ดับเอง ไม่ค้าง ไม่รีสตาร์ทเอง ชาร์จแบตได้ปกติ', options: [OK('เปิดติด ชาร์จเข้า ใช้งานได้ปกติ'), BAD('เปิดไม่ติด / ชาร์จไม่เข้า', 'เปิดไม่ติด ค้าง ดับเอง หรือชาร์จไฟไม่เข้า')] },
      { title: 'หน้าจอ + ทัชสกรีน', icon: 'screen', description: 'หน้าจอสัมผัสตอบสนอง ไม่มีจุดดำ ไม่มีเส้น ไม่มีจอเบิร์น', options: [OK('จอชัด ทัชลื่น ไม่มีตำหนิ'), BAD('จอเสีย / ทัชมีปัญหา', 'มีจุดดำ เส้น จอเบิร์น หรือทัชไม่ตอบสนอง')] },
      { title: 'Digital Crown + ปุ่มข้าง', icon: 'crown', description: 'หมุน Digital Crown ได้ลื่น กดปุ่มด้านข้างได้ปกติ ไม่ค้าง', options: [OK('Crown + ปุ่มใช้ได้ปกติ'), BAD('Crown / ปุ่มมีปัญหา', 'หมุน Crown ไม่ลื่น หรือกดปุ่มไม่ติด/ค้าง')] },
      { title: 'เซ็นเซอร์ (วัดชีพจร ฯลฯ)', icon: 'sensors', description: 'เซ็นเซอร์วัดชีพจร ตรวจจับการสวมใส่ และเซ็นเซอร์อื่นๆ ทำงานได้ปกติ', options: [OK('เซ็นเซอร์ทำงานได้ครบปกติ'), BAD('เซ็นเซอร์มีปัญหา', 'เซ็นเซอร์วัดชีพจร/ตรวจจับการสวมใส่ไม่ทำงาน')] },
      { title: 'Wi-Fi / Bluetooth', icon: 'connectivity', description: 'เชื่อมต่อ Bluetooth กับ iPhone ได้ เชื่อมต่อ Wi-Fi ได้ปกติ', options: [OK('ต่อ Bluetooth/Wi-Fi ได้ปกติ'), BAD('การเชื่อมต่อมีปัญหา', 'ต่อ Bluetooth กับ iPhone หรือ Wi-Fi ไม่ได้')] },
      { title: 'แบตเตอรี่', icon: 'battery', description: 'แบตเตอรี่ชาร์จเข้า อยู่ได้นานพอสมควร ไม่บวม สุขภาพแบตเตอรี่อยู่ในเกณฑ์ดี', options: [OK('แบตชาร์จเข้า อยู่ได้นาน ไม่บวม'), BAD('แบตเตอรี่เสื่อม', 'สุขภาพแบตต่ำ ไฟหมดเร็ว ชาร์จไม่เข้า หรือแบตบวม')] },
    ] },
  };

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
    setEditingSet({ ...editingSet, groups: [...seeded, ...(editingSet.groups || [])] });
    toast.success(`เพิ่มชุดคัดกรองการทำงาน ${tpl.label} (${tpl.items.length} ข้อ) — อย่าลืมกด Save Set`);
  };

  // Standard COSMETIC + QUALIFYING screening (a second seed template beside the
  // functional one). Splits into:
  //   • สภาพภายนอก (kind 'cosmetic') — body + screen. The customer picks the
  //     actual condition; we do NOT ask "which grade" — the A/B/C/D grade is
  //     summarised at checkout from the WORDING of the chosen options
  //     (bkk-frontend-next app/utils/conditionGrade.ts). So the labels here are
  //     worded to hit that grader: ขนแมว→B, ขีดข่วน/บุบ/บิ่น→C, แตก/ร้าว/งอ→D.
  //     Damage options carry a % default so the grade classifies out of the box
  //     (grade only looks at options that deduct > 0) — admin tunes the numbers.
  //   • คุณสมบัติเครื่อง — ประกัน / ประเทศที่ซื้อ / ประวัติการซ่อม. ALL kind
  //     'cosmetic': the customer answers every group, and the no-buy decision
  //     (ซ่อมนอกศูนย์/อะไหล่เทียบ, ล็อกเครือข่าย) is surfaced on the end-of-flow
  //     summary card (Rejected), NOT as a mid-flow dead-end. Those options still
  //     carry failBehavior:'reject' in the data so the summary can read it; we
  //     do NOT make the group 'functional' — that would (a) mislabel provenance
  //     as a working check and (b) let this template alone replace the hardcoded
  //     working-check screening (any functional group does). ประกัน + ประเทศ are
  //     excluded from the A/B/C/D grade (see GRADE_EXCLUDE_RE) — grade = สภาพ only.
  type CondOpt = { label: string; description: string; pct?: number; deduct?: number; failBehavior?: 'pass' | 'reject' | 'deduct' };
  type CondGroup = { title: string; icon: string; description: string; kind: 'cosmetic' | 'functional'; options: CondOpt[] };
  const CONDITION_TEMPLATES: Record<string, { label: string; items: CondGroup[] }> = {
    standard: { label: 'สภาพ + ประกัน + ประเทศ + ประวัติซ่อม', items: [
      { title: 'ประวัติการซ่อม', icon: 'help', kind: 'cosmetic', description: 'เครื่องเคยเปิดซ่อมหรือเปลี่ยนอะไหล่มาหรือไม่', options: [
        { label: 'ไม่เคยซ่อม', description: 'เครื่องเดิมจากโรงงาน ไม่เคยเปิดซ่อม', failBehavior: 'pass', deduct: 0 },
        { label: 'เคยซ่อมศูนย์ / อะไหล่แท้', description: 'เคยเข้าศูนย์ Apple เปลี่ยนอะไหล่แท้', failBehavior: 'deduct', deduct: 0 },
        { label: 'ซ่อมนอกศูนย์ / อะไหล่เทียบ (ไม่แท้)', description: 'เคยซ่อมร้านนอก หรือเปลี่ยนอะไหล่เทียบ/ไม่แท้', failBehavior: 'reject' },
      ] },
      { title: 'ประเทศที่ซื้อ', icon: 'help', kind: 'cosmetic', description: 'เครื่องศูนย์ไทยหรือเครื่องนอก (ดูจากรหัสรุ่นท้าย)', options: [
        { label: 'ศูนย์ไทย (TH)', description: 'เครื่องศูนย์ไทย รหัสรุ่นลงท้าย TH/A', failBehavior: 'pass', deduct: 0 },
        { label: 'เครื่องนอก (ZP / LL / อื่นๆ)', description: 'เครื่องหิ้ว/นอก ใช้งานได้ปกติในไทย', failBehavior: 'deduct', deduct: 0 },
        { label: 'ล็อกเครือข่าย / ใช้ในไทยไม่ได้', description: 'เครื่องติดล็อกเครือข่ายผู้ให้บริการ ใช้ซิมไทยไม่ได้', failBehavior: 'reject' },
      ] },
      { title: 'สภาพตัวเครื่อง (บอดี้ / ฝาหลัง)', icon: 'shield', kind: 'cosmetic', description: 'รอย ตำหนิ หรือความเสียหายของตัวเครื่องและฝาหลัง', options: [
        { label: 'สวยมาก ไม่มีรอย', description: 'ตัวเครื่องสวย ไม่มีรอย ไม่มีตำหนิ', deduct: 0 },
        { label: 'มีรอยขนแมวบางๆ', description: 'รอยขนแมวเล็กน้อย มองเห็นเมื่อสะท้อนแสง', pct: 3 },
        { label: 'มีรอยขีดข่วน / ถลอกเห็นชัด', description: 'มีรอยขีดข่วนหรือถลอกที่มองเห็นได้ชัดเจน', pct: 10 },
        { label: 'บุบ / บิ่น / ตกกระแทก', description: 'ตัวเครื่องบุบ บิ่น หรือมีร่องรอยตกกระแทก', pct: 12 },
        { label: 'เครื่องงอ / ผิดรูป', description: 'ตัวเครื่องงอ ผิดรูป หรือบิดเบี้ยว', pct: 25 },
      ] },
      { title: 'สภาพหน้าจอ', icon: 'screen', kind: 'cosmetic', description: 'รอยหรือความเสียหายของกระจกหน้าจอ', options: [
        { label: 'สวยมาก ไม่มีรอย', description: 'หน้าจอใส ไม่มีรอย ไม่มีตำหนิ', deduct: 0 },
        { label: 'มีรอยขนแมวบางๆ', description: 'รอยขนแมวเล็กน้อยบนหน้าจอ', pct: 3 },
        { label: 'มีรอยขีดข่วนเห็นชัด', description: 'มีรอยขีดข่วนบนหน้าจอที่มองเห็นได้ชัด', pct: 12 },
        { label: 'จอแตก / ร้าว', description: 'กระจกหน้าจอแตกหรือร้าว', pct: 30 },
      ] },
      { title: 'ประกัน', icon: 'shield', kind: 'cosmetic', description: 'สถานะประกันของเครื่อง (ไม่มีผลต่อเกรดสภาพ)', options: [
        { label: 'เหลือประกันศูนย์ / AppleCare+', description: 'ยังอยู่ในประกันศูนย์ หรือมี AppleCare+', deduct: 0 },
        { label: 'หมดประกัน', description: 'พ้นระยะประกันศูนย์แล้ว', deduct: 0 },
      ] },
    ] },
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
    setEditingSet({ ...editingSet, groups: [...(editingSet.groups || []), ...seeded] });
    toast.success(`เพิ่มชุดคัดกรองสภาพ / คุณสมบัติ (${tpl.items.length} กลุ่ม) — อย่าลืมกด Save Set`);
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
                      {/* Group description — shown to customers under the topic heading */}
                      <input
                        type="text"
                        placeholder="คำอธิบายใต้หัวข้อ (ลูกค้าเห็นตอนประเมิน เช่น ไม่มีจุดดำ ไม่มีเส้น ไม่มีแสงรั่ว) — ไม่บังคับ"
                        value={g.description || ''}
                        onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v) n[gi].description = v; else delete n[gi].description; setEditingSet({ ...editingSet, groups: n }); }}
                        className="w-full text-sm font-bold text-slate-500 bg-transparent border-none outline-none mb-3 focus:text-slate-700 placeholder:text-slate-300 placeholder:font-medium"
                      />
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
                              <input
                                type="text"
                                placeholder="คำอธิบายตัวเลือก (ลูกค้าเห็นใต้ชื่อตัวเลือก) — ไม่บังคับ"
                                value={o.description || ''}
                                onChange={(e) => { const n = [...editingSet.groups]; const v = e.target.value; if (v) n[gi].options[oi].description = v; else delete n[gi].options[oi].description; setEditingSet({ ...editingSet, groups: n }); }}
                                className="w-full px-4 py-1.5 mt-1.5 rounded-lg border-none bg-white/70 shadow-sm text-xs font-medium text-slate-500 focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-300"
                              />
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
