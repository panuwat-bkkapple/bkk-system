import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ref, get, set } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link } from 'react-router-dom';
import {
  Brain, Plus, Save, X, Trash2, ExternalLink, Tag, Coins, MapPin,
  MessageSquareText, Power, GripVertical, LayoutGrid, Sparkles,
} from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';
import { TRAINING_PACK } from '../../data/martinTrainingPack';

// =============================================================================
// คลังคำตอบ AI แบบใยแมงมุม — settings/chat_kb
//
// n8n-style canvas (React Flow) ที่เจ้าของร้านลาก-วาง-ต่อเส้น จัด "หมวดคำตอบ"
// ให้ AI แชทเอง. โหนด 2 ชนิด:
//   custom — หมวดที่แอดมินเขียน Q&A เอง → cloud function (chat-ai.js
//            buildKbGraphBlock) อ่านไปฉีดเข้า system prompt ทุกข้อความ
//   live   — กระจกของข้อมูลที่ AI อ่านสดผ่าน tool อยู่แล้ว (คูปอง/ราคา/สาขา)
//            มีไว้ให้เห็นภาพรวมครบ ไม่มี Q&A ให้แก้ — ลิงก์ไปหน้าจัดการจริง
// เส้น (edge) = ลำดับหมวดแม่→ลูก มีผลกับป้ายหมวดใน prompt ("แม่ › ลูก")
// การบันทึก = เขียนทั้งกราฟลง settings/chat_kb (อะตอมมิก) — rules: admin เท่านั้น
// =============================================================================

interface KbItem { q: string; a: string; order: number }
interface KbNodeRec {
  label: string; emoji?: string; type: 'root' | 'custom' | 'live' | 'behavior' | 'behavior_rule';
  live_key?: string; x: number; y: number; enabled?: boolean;
  items?: Record<string, KbItem>;
  // behavior nodes only — enforced rules of that sales-flow stage, synced
  // from the deployed cloud function (settings/chat_ai_meta.behaviors)
  rules?: string[];
}

// สมองพฤติกรรมของมาติน = 6 ขั้นของ flow การขายที่บังคับใช้ในโค้ด cloud function
// แสดงเป็นโหนดบนผังเพื่อให้เจ้าของลากเส้น/วางแผนเทรนถูกจุด. ค่านี้เป็น fallback
// ก่อน stamp แรก — ตัวจริง sync จาก settings/chat_ai_meta.behaviors ซึ่ง
// function ที่ deploy อยู่เขียนเอง (mirror ของ LOGIC_BEHAVIORS ใน chat-ai.js)
const BEHAVIOR_FALLBACK: { key: string; label: string; emoji: string; rules: string[] }[] = [
  { key: 'opening', label: 'เปิดการขาย', emoji: '🎯', rules: ['ทักทายสั้น พุ่งเข้าเรื่องขายทันที', 'ลูกค้าเอ่ยชื่อรุ่นเมื่อไหร่ ค้นฐานข้อมูลทันที ห้ามตอบรับ/ปฏิเสธจากความจำ', 'ห้ามใช้ศัพท์เทคนิคภายในระบบกับลูกค้า'] },
  { key: 'model', label: 'ตรวจรุ่นจากฐานข้อมูล', emoji: '🔍', rules: ['ราคา สเปก และตัวเลือกรุ่น มาจากฐานข้อมูลเท่านั้น — ความจำ AI และข้อความเก่าของตัวเองใช้ไม่ได้', 'เข้าใจชื่อเรียกรุ่น เช่น iPad Air 6 = Air ชิป M2 (2024)', 'กันจับผิดตระกูล: Air / mini / SE แยกขาดจากกัน', 'รุ่นงดรับซื้อ = ปฏิเสธสุภาพทันที ไม่โยนเจ้าหน้าที่'] },
  { key: 'contact', label: 'เก็บ Contact ก่อนเผยราคา', emoji: '📇', rules: ["ขอชื่อ+เบอร์แบบธรรมชาติ ห้ามพูดว่า 'ข้ามได้/ไม่บังคับ' — ลูกค้าเงียบก็คุยต่อ และขอซ้ำได้อีกครั้งเดียวตอนกำลังจะออกใบเสนอราคา", 'ห้ามพูดตัวเลขราคา/ช่วงราคาก่อนการ์ด — ระบบขูดตัวเลขที่หลุดออกอัตโนมัติ', 'ได้เบอร์แล้วบันทึกเข้าระบบลูกค้าทันที'] },
  { key: 'condition', label: 'ถามสภาพทีละเรื่อง', emoji: '🧾', rules: ['ถามทีละคำถาม พร้อมปุ่มตัวเลือกจากชุดประเมินจริงของรุ่นนั้น', 'ปุ่ม = คำตอบสำเร็จรูปเท่านั้น (ไม่มีปุ่มกับคำถามปลายเปิด เช่น ขอชื่อ/เบอร์)', 'เรื่องที่ลูกค้าตอบแล้วห้ามถามซ้ำ', 'ข้อมูลพอเมื่อไหร่ออกการ์ดทันที ห้ามจบห้วนกลางทาง'] },
  { key: 'quote', label: 'ใบเสนอราคา', emoji: '💳', rules: ['ตัวเลขบนการ์ดคำนวณด้วยสูตรเดียวกับหน้าเว็บ /sell', 'คูปองที่รุ่นเข้าเกณฑ์แนบให้อัตโนมัติ ไม่ต้องให้ลูกค้าร้องขอ', 'ลูกค้าต่อรองขอเพิ่มราคา = ราคาไม่ขึ้น (ขึ้นได้เฉพาะแจ้งสภาพดีขึ้นจริง)'] },
  { key: 'escalate', label: 'ส่งต่อเจ้าหน้าที่', emoji: '🤝', rules: ['ลูกค้าขอคุยกับคน = ส่งต่อจริงทุกครั้ง (ระบบบังคับ ไม่ใช่แค่รับปาก)', 'ระหว่างรอเจ้าหน้าที่ AI ยังดูแลต่อ + อัปเดตสรุปงานสดให้ทีม', 'รุ่นไม่ตั้งราคา (โหมด Offer เช่น MacBook) เก็บชื่อ เบอร์ รายละเอียดก่อนส่ง — ห้ามส่งมือเปล่า', 'ยังไม่มีเบอร์ลูกค้า = ชวนฝากเบอร์ไว้ให้ติดต่อกลับ'] },
];

// รวมโหนดพฤติกรรมเข้ากราฟ (id คงที่ bh_*) — ตำแหน่ง/เส้นที่ลากไว้คงเดิม แต่
// ป้ายและกติกา sync จากระบบทุกครั้ง (แก้ไม่ได้จากหน้านี้ — แก้ผ่านการเทรน)
function mergeBehaviorNodes(g: KbGraphRec, behaviors: typeof BEHAVIOR_FALLBACK) {
  g.nodes = g.nodes || {};
  g.edges = g.edges || {};
  const validIds = new Set<string>();
  behaviors.forEach((b, i) => {
    const id = `bh_${b.key}`;
    validIds.add(id);
    const prev = g.nodes![id];
    const bx = prev ? prev.x : -560 + i * 260;
    const by = prev ? prev.y : 430;
    g.nodes![id] = {
      label: b.label, emoji: b.emoji, type: 'behavior', rules: b.rules,
      x: bx, y: by,
    };
    if (!Object.values(g.edges!).some((e) => e.to === id)) {
      g.edges![`eb_${b.key}`] = { from: 'root', to: id };
    }
    // ขยายกติกาออกมาเป็นใบย่อยบนผัง (คำขอเจ้าของ: เห็นกติกาโดยไม่ต้องคลิก) —
    // ใบย่อยห้อยใต้ขั้นของมัน ตำแหน่งที่ลากจัดแล้วคงเดิม ข้อความ sync จากระบบ
    b.rules.forEach((rule, ri) => {
      const rid = `bh_${b.key}_r${ri}`;
      validIds.add(rid);
      const prevRule = g.nodes![rid];
      g.nodes![rid] = {
        label: rule, type: 'behavior_rule',
        x: prevRule ? prevRule.x : bx + (ri % 2 === 0 ? -30 : 150),
        y: prevRule ? prevRule.y : by + 130 + Math.floor(ri / 2) * 150,
      };
      if (!Object.values(g.edges!).some((e) => e.to === rid)) {
        g.edges![`ebr_${b.key}_${ri}`] = { from: id, to: rid };
      }
    });
  });
  // กติกาที่ถูกถอดออกจากระบบแล้ว (จำนวนข้อเปลี่ยนหลัง deploy) ต้องหายจากผังด้วย
  for (const nid of Object.keys(g.nodes)) {
    if (/^bh_/.test(nid) && !validIds.has(nid)) {
      delete g.nodes[nid];
      for (const eid of Object.keys(g.edges)) {
        const e = g.edges[eid];
        if (e.from === nid || e.to === nid) delete g.edges[eid];
      }
    }
  }
}
interface KbGraphRec {
  nodes?: Record<string, KbNodeRec>;
  edges?: Record<string, { from: string; to: string }>;
  updated_at?: number;
}

const LIVE_META: Record<string, { desc: string; to: string; icon: typeof Tag }> = {
  coupons: { desc: 'AI ดึงคูปองที่เปิดอยู่จริงมาตอบเอง และหยิบใบที่คุ้มสุดของรุ่นโชว์บนใบเสนอราคาอัตโนมัติ', to: '/coupons', icon: Tag },
  prices: { desc: 'ราคาทุกตัวมาจากฐานข้อมูลราคาจริง (search_models) — AI ห้ามพิมพ์ตัวเลขเอง', to: '/trade-in', icon: Coins },
  branches: { desc: 'ชื่อสาขา ที่อยู่ เวลาเปิด-ปิด ลิงก์แผนที่ — AI ตอบจากข้อมูลสาขาจริงทุกครั้ง', to: '/settings', icon: MapPin },
};

const uid = () => `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// กราฟตั้งต้นเมื่อยังไม่เคยบันทึก — root + กระจก live 3 ตัว + หมวดเขียนเอง 2 ตัว
function seedGraph(): KbGraphRec {
  return {
    nodes: {
      root: { label: 'มาติน (AI)', type: 'root', x: 0, y: 0 },
      live_coupons: { label: 'โปรโมชั่น / คูปอง', type: 'live', live_key: 'coupons', x: -320, y: -150 },
      live_prices: { label: 'ราคารับซื้อ', type: 'live', live_key: 'prices', x: -320, y: 60 },
      live_branches: { label: 'สาขา / เวลาเปิด', type: 'live', live_key: 'branches', x: -180, y: 220 },
      cat_fee: { label: 'ค่าบริการรับเครื่อง', emoji: '🛵', type: 'custom', enabled: true, x: 320, y: -150, items: {} },
      cat_process: { label: 'ขั้นตอนการขาย', emoji: '📋', type: 'custom', enabled: true, x: 320, y: 60, items: {} },
    },
    edges: {
      e_c: { from: 'root', to: 'live_coupons' },
      e_p: { from: 'root', to: 'live_prices' },
      e_b: { from: 'root', to: 'live_branches' },
      e_f: { from: 'root', to: 'cat_fee' },
      e_s: { from: 'root', to: 'cat_process' },
    },
  };
}

// ---------- Custom node renderers ----------

function RootNode() {
  return (
    <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex flex-col items-center justify-center shadow-xl ring-4 ring-blue-200/60 select-none">
      <Handle type="source" position={Position.Right} className="!bg-blue-300 !w-3 !h-3" />
      <Handle type="source" position={Position.Left} id="l" className="!bg-blue-300 !w-3 !h-3" />
      <Brain size={30} />
      <span className="font-black text-sm mt-1">มาติน</span>
      <span className="text-[10px] opacity-80">คลังคำตอบ AI</span>
    </div>
  );
}

function CategoryNode({ data, selected }: NodeProps) {
  const d = data as { label: string; emoji?: string; enabled?: boolean; count: number };
  const off = d.enabled === false;
  return (
    <div className={`min-w-[168px] max-w-[210px] bg-white rounded-2xl border-2 px-4 py-3 shadow-md transition-colors ${
      selected ? 'border-blue-500' : off ? 'border-slate-200 opacity-60' : 'border-emerald-300'
    }`}>
      <Handle type="target" position={Position.Left} className="!bg-emerald-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-emerald-400 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">{d.emoji || '💬'}</span>
        <span className="font-black text-[13px] text-slate-800 leading-tight">{d.label}</span>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600">เขียนเอง</span>
        <span className="text-[10px] font-bold text-slate-400">{d.count} คำตอบ{off ? ' · ปิดอยู่' : ''}</span>
      </div>
    </div>
  );
}

function LiveNode({ data, selected }: NodeProps) {
  const d = data as { label: string; live_key?: string };
  const Icon = LIVE_META[d.live_key || '']?.icon || Tag;
  return (
    <div className={`min-w-[168px] max-w-[210px] bg-white rounded-2xl border-2 px-4 py-3 shadow-md ${selected ? 'border-blue-500' : 'border-amber-300'}`}>
      <Handle type="target" position={Position.Right} className="!bg-amber-400 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-amber-500 shrink-0" />
        <span className="font-black text-[13px] text-slate-800 leading-tight">{d.label}</span>
      </div>
      <div className="mt-2">
        <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-50 text-amber-600">ดึงสดจากระบบ</span>
      </div>
    </div>
  );
}

function BehaviorNode({ data, selected }: NodeProps) {
  const d = data as { label: string; emoji?: string; ruleCount: number };
  return (
    <div className={`min-w-[168px] max-w-[210px] bg-white rounded-2xl border-2 px-4 py-3 shadow-md ${selected ? 'border-blue-500' : 'border-indigo-300'}`}>
      <Handle type="target" position={Position.Top} className="!bg-indigo-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-400 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">{d.emoji || '⚙️'}</span>
        <span className="font-black text-[13px] text-slate-800 leading-tight">{d.label}</span>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600">กติการะบบ</span>
        <span className="text-[10px] font-bold text-slate-400">{d.ruleCount} กติกา</span>
      </div>
    </div>
  );
}

function RuleNode({ data, selected }: NodeProps) {
  const d = data as { label: string };
  return (
    <div className={`max-w-[240px] bg-indigo-50/90 rounded-xl border px-3 py-2 shadow-sm ${selected ? 'border-blue-500' : 'border-indigo-200 border-dashed'}`}>
      <Handle type="target" position={Position.Top} className="!bg-indigo-300 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-300 !w-2 !h-2" />
      <p className="text-[10.5px] leading-snug text-indigo-900">{d.label}</p>
    </div>
  );
}

const nodeTypes = { root: RootNode, kbcat: CategoryNode, kblive: LiveNode, kbbehavior: BehaviorNode, kbrule: RuleNode };

// ---------- Page ----------

export default function ChatKnowledgeGraph() {
  const toast = useToast();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  // Q&A + meta ต่อโหนด เก็บแยกจาก React Flow state (แก้ในแผงข้าง ไม่ re-render กราฟ)
  const [recs, setRecs] = useState<Record<string, KbNodeRec>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // สมองส่วน "พฤติกรรม" ของมาติน (กฎ/การ์ดในโค้ด cloud function) — stamp ลง
  // settings/chat_ai_meta ทุกครั้งที่ deploy แล้วมีแชทแรกเข้ามา เพื่อให้เจ้าของ
  // เห็นในหน้านี้ว่าตอนนี้ AI รันกติกาเวอร์ชันไหน เปลี่ยนอะไรไปบ้าง
  const [logicMeta, setLogicMeta] = useState<{
    version?: string; stamped_at?: number;
    changelog?: { at: string; text: string }[];
  } | null>(null);
  const [logicOpen, setLogicOpen] = useState(false);
  const dirtyRef = useRef(false);
  const markDirty = () => { dirtyRef.current = true; setDirty(true); };

  // ---- load / seed ----
  useEffect(() => {
    Promise.all([
      get(ref(db, 'settings/chat_kb')).catch(() => null),
      get(ref(db, 'settings/chat_ai_meta')).catch(() => null),
    ])
      .then(([kbSnap, metaSnap]) => {
        const g: KbGraphRec = kbSnap && kbSnap.exists() ? (kbSnap.val() as KbGraphRec) : seedGraph();
        if (!g.nodes || !g.nodes.root) g.nodes = { ...seedGraph().nodes, ...(g.nodes || {}) };
        const meta = metaSnap && metaSnap.exists() ? metaSnap.val() : null;
        if (meta) setLogicMeta(meta);
        mergeBehaviorNodes(g, Array.isArray(meta?.behaviors) && meta.behaviors.length ? meta.behaviors : BEHAVIOR_FALLBACK);
        hydrate(g);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrate = (g: KbGraphRec) => {
    const nrecs = g.nodes || {};
    setRecs(nrecs);
    setNodes(Object.entries(nrecs).map(([id, n]) => ({
      id,
      type: n.type === 'root' ? 'root' : n.type === 'live' ? 'kblive' : n.type === 'behavior' ? 'kbbehavior' : n.type === 'behavior_rule' ? 'kbrule' : 'kbcat',
      position: { x: Number(n.x) || 0, y: Number(n.y) || 0 },
      deletable: n.type === 'custom',
      data: {
        label: n.label, emoji: n.emoji, enabled: n.enabled !== false,
        live_key: n.live_key, count: Object.keys(n.items || {}).length,
        ruleCount: (n.rules || []).length,
      },
    })));
    setEdges(Object.entries(g.edges || {}).map(([id, e]) => ({
      id, source: e.from, target: e.to, animated: false,
      style: { strokeWidth: 2 },
    })));
  };

  // React Flow node.data ต้อง sync กับ recs (ป้าย/จำนวนคำตอบ/สถานะเปิดปิด)
  const refreshNodeData = (id: string, rec: KbNodeRec) => {
    setNodes((ns) => ns.map((n) => n.id === id
      ? { ...n, data: { ...n.data, label: rec.label, emoji: rec.emoji, enabled: rec.enabled !== false, count: Object.keys(rec.items || {}).length } }
      : n));
  };

  // ---- canvas events ----
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some((c) => c.type === 'position' || c.type === 'remove')) markDirty();
    const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
    if (removed.length) {
      setRecs((r) => { const next = { ...r }; removed.forEach((id) => delete next[id]); return next; });
      setSelectedId((s) => (s && removed.includes(s) ? null : s));
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some((c) => c.type === 'remove')) markDirty();
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    setEdges((es) => addEdge({ ...conn, id: uid(), style: { strokeWidth: 2 } }, es));
    markDirty();
  }, []);

  // ---- actions ----
  const addCategory = () => {
    const id = uid();
    const rec: KbNodeRec = {
      label: 'หมวดใหม่', emoji: '💬', type: 'custom', enabled: true,
      x: 140 + Math.random() * 220, y: -60 + Math.random() * 260, items: {},
    };
    setRecs((r) => ({ ...r, [id]: rec }));
    setNodes((ns) => [...ns, {
      id, type: 'kbcat', position: { x: rec.x, y: rec.y }, deletable: true,
      data: { label: rec.label, emoji: rec.emoji, enabled: true, count: 0 },
    }]);
    setEdges((es) => [...es, { id: uid(), source: 'root', target: id, style: { strokeWidth: 2 } }]);
    setSelectedId(id);
    markDirty();
  };

  // นำเข้าชุดเทรนเริ่มต้น (TRAINING_PACK): เพิ่มเฉพาะหมวด/คำตอบที่ยังไม่มี —
  // จับคู่หมวดด้วยชื่อ (ตัดช่องว่าง) และกันคำตอบซ้ำด้วยตัวคำถาม จึงกดซ้ำได้
  // ปลอดภัย ไม่ทับของที่แอดมินแก้เองแล้ว. ยังต้องกด "บันทึก" เพื่อคงถาวร
  const importTrainingPack = () => {
    if (!confirm('นำเข้าชุดเทรนเริ่มต้น (8 หมวด 41 คำตอบ)? เพิ่มเฉพาะหมวด/คำตอบที่ยังไม่มี ไม่ทับของเดิม')) return;
    const norm = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase();
    let addedCats = 0;
    let addedItems = 0;
    const nextRecs = { ...recs };
    const newFlowNodes: typeof nodes = [];
    const newFlowEdges: typeof edges = [];
    let customCount = Object.values(nextRecs).filter((r) => r.type === 'custom').length;
    for (const cat of TRAINING_PACK) {
      let id = Object.keys(nextRecs).find(
        (k) => nextRecs[k].type === 'custom' && norm(nextRecs[k].label) === norm(cat.label)
      );
      if (!id) {
        id = uid();
        nextRecs[id] = {
          label: cat.label, emoji: cat.emoji, type: 'custom', enabled: true,
          x: 560, y: -190 + customCount * 190, items: {},
        };
        customCount += 1;
        addedCats += 1;
        newFlowNodes.push({
          id, type: 'kbcat', position: { x: nextRecs[id].x, y: nextRecs[id].y }, deletable: true,
          data: { label: cat.label, emoji: cat.emoji, enabled: true, count: 0 },
        });
        newFlowEdges.push({ id: uid(), source: 'root', target: id, style: { strokeWidth: 2 } });
      }
      const rec = nextRecs[id];
      const items = { ...(rec.items || {}) };
      const existingQs = new Set(Object.values(items).map((it) => norm(it.q)));
      let order = Object.values(items).reduce((m, it) => Math.max(m, Number(it.order) || 0), 0);
      for (const it of cat.items) {
        if (existingQs.has(norm(it.q))) continue;
        order += 1;
        items[uid()] = { q: it.q, a: it.a, order };
        addedItems += 1;
      }
      nextRecs[id] = { ...rec, items };
    }
    if (addedCats === 0 && addedItems === 0) {
      toast.info('มีครบทุกข้อแล้ว — ไม่มีอะไรให้เพิ่ม');
      return;
    }
    setRecs(nextRecs);
    if (newFlowNodes.length) setNodes((ns) => [...ns, ...newFlowNodes]);
    if (newFlowEdges.length) setEdges((es) => [...es, ...newFlowEdges]);
    // refresh answer counts on categories that already existed
    setNodes((ns) => ns.map((n) =>
      nextRecs[n.id] && nextRecs[n.id].type === 'custom'
        ? { ...n, data: { ...n.data, count: Object.keys(nextRecs[n.id].items || {}).length } }
        : n
    ));
    markDirty();
    toast.success(`นำเข้าแล้ว: หมวดใหม่ ${addedCats} · คำตอบใหม่ ${addedItems} — กด "บันทึก" เพื่อให้มาตินใช้งานจริง`);
  };

  // จัดเรียงอัตโนมัติ (ปุ่ม "จัดเรียงใหม่"): มาตินกลาง · ข้อมูลสดซ้าย · หมวดคำตอบ
  // ขวา · สายพฤติกรรมไหลลงตามลำดับการขายจริง พร้อมใบกติกาห้อยขวาของขั้นตัวเอง —
  // เลย์เอาต์ที่เจ้าของจัดเองยังอยู่จนกว่าจะกดปุ่มนี้ (แล้วต้องกดบันทึกถึงคงถาวร)
  const STAGE_ORDER = ['opening', 'model', 'contact', 'condition', 'quote', 'escalate'];
  const rearrange = () => {
    const ids = Object.keys(recs);
    const map: Record<string, { x: number; y: number }> = { root: { x: 0, y: 0 } };
    ids.filter((id) => recs[id].type === 'live').sort()
      .forEach((id, i) => { map[id] = { x: -660, y: -170 + i * 190 }; });
    ids.filter((id) => recs[id].type === 'custom').sort()
      .forEach((id, i) => { map[id] = { x: 560, y: -190 + i * 190 }; });
    STAGE_ORDER.filter((k) => recs[`bh_${k}`]).forEach((k, i) => {
      const sx = -60;
      const sy = 280 + i * 340;
      map[`bh_${k}`] = { x: sx, y: sy };
      ids.filter((id) => id.startsWith(`bh_${k}_r`)).sort()
        .forEach((rid, ri) => { map[rid] = { x: sx + 310, y: sy - 70 + ri * 85 }; });
    });
    setNodes((ns) => ns.map((n) => (map[n.id] ? { ...n, position: map[n.id] } : n)));
    markDirty();
    toast.success('จัดเรียงผังใหม่แล้ว — กดบันทึกเพื่อเก็บเลย์เอาต์นี้');
  };

  const saveAll = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const outNodes: Record<string, KbNodeRec> = {};
      nodes.forEach((n) => {
        const rec = recs[n.id];
        if (!rec) return;
        outNodes[n.id] = { ...rec, x: Math.round(n.position.x), y: Math.round(n.position.y) };
      });
      const outEdges: Record<string, { from: string; to: string }> = {};
      edges.forEach((e) => {
        if (outNodes[e.source] && outNodes[e.target]) outEdges[e.id] = { from: e.source, to: e.target };
      });
      await set(ref(db, 'settings/chat_kb'), { nodes: outNodes, edges: outEdges, updated_at: Date.now() });
      dirtyRef.current = false; setDirty(false);
      toast.success('บันทึกคลังคำตอบแล้ว — AI ใช้ทันทีข้อความถัดไป');
    } catch {
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  // ---- panel edit helpers ----
  const sel = selectedId ? recs[selectedId] : null;
  const updateSel = (patch: Partial<KbNodeRec>) => {
    if (!selectedId) return;
    setRecs((r) => {
      const next = { ...r, [selectedId]: { ...r[selectedId], ...patch } };
      refreshNodeData(selectedId, next[selectedId]);
      return next;
    });
    markDirty();
  };
  const updateItem = (itemId: string, patch: Partial<KbItem>) => {
    if (!selectedId || !sel) return;
    updateSel({ items: { ...(sel.items || {}), [itemId]: { ...(sel.items || {})[itemId], ...patch } } });
  };
  const addItem = () => {
    if (!sel) return;
    const items = sel.items || {};
    const order = Object.values(items).reduce((m, it) => Math.max(m, Number(it.order) || 0), 0) + 1;
    updateSel({ items: { ...items, [uid()]: { q: '', a: '', order } } });
  };
  const removeItem = (itemId: string) => {
    if (!sel) return;
    const items = { ...(sel.items || {}) };
    delete items[itemId];
    updateSel({ items });
  };
  const deleteSelectedNode = () => {
    if (!selectedId || !sel || sel.type !== 'custom') return;
    if (!confirm(`ลบหมวด "${sel.label}" ทั้งหมวด (รวมคำตอบข้างใน)?`)) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setRecs((r) => { const next = { ...r }; delete next[selectedId]; return next; });
    setSelectedId(null);
    markDirty();
  };

  const sortedItems = useMemo(() => {
    if (!sel?.items) return [] as [string, KbItem][];
    return Object.entries(sel.items).sort((a, b) => (Number(a[1].order) || 0) - (Number(b[1].order) || 0));
  }, [sel]);

  if (loading) return <div className="p-10 text-center text-gray-400 font-bold animate-pulse">กำลังโหลดคลังคำตอบ...</div>;

  return (
    <div className="h-[calc(100vh-0px)] flex flex-col bg-[#F5F7FA]">
      {/* Header */}
      <div className="px-5 py-3 bg-white border-b border-slate-200 flex items-center gap-3 flex-wrap">
        <div className="p-2 bg-blue-100 rounded-xl"><Brain size={20} className="text-blue-600" /></div>
        <div className="min-w-0">
          <h1 className="text-base font-black text-slate-800 leading-tight">คลังคำตอบ AI (ใยความรู้)</h1>
          <p className="text-[11px] text-slate-400 font-bold">ลากจัดผัง · ต่อเส้นหมวดแม่-ลูก · คลิกหมวดเพื่อตั้งคำตอบ — AI ใช้ตอบลูกค้าทันทีหลังบันทึก</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={importTrainingPack} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 text-xs font-black transition-colors">
            <Sparkles size={14} /> นำเข้าชุดเทรน
          </button>
          <button onClick={rearrange} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 text-xs font-black transition-colors">
            <LayoutGrid size={14} /> จัดเรียงใหม่
          </button>
          <button onClick={addCategory} className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-black transition-colors">
            <Plus size={14} /> เพิ่มหมวด
          </button>
          <button onClick={saveAll} disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 disabled:bg-slate-300 transition-colors shadow">
            <Save size={14} /> {saving ? 'กำลังบันทึก...' : dirty ? 'บันทึกการเปลี่ยนแปลง' : 'บันทึกแล้ว'}
          </button>
        </div>
      </div>

      {/* Canvas + Panel */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 relative">
          {/* สมองส่วนพฤติกรรม (โค้ด) — โชว์ว่า AI รันกติกาเวอร์ชันไหนอยู่ ให้เห็น
              ว่าการเทรน/แก้บั๊กแต่ละรอบไปลงตรงไหน (คนละส่วนกับคลังคำตอบในผังนี้
              ที่แก้ได้เอง) */}
          <div className="absolute bottom-4 left-4 z-10 w-[340px] max-w-[85vw]">
            <div className="bg-white/95 backdrop-blur rounded-2xl border border-indigo-200 shadow-lg overflow-hidden">
              <button onClick={() => setLogicOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
                <span className="p-1.5 bg-indigo-100 rounded-lg"><Brain size={14} className="text-indigo-600" /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-black text-slate-800">สมองส่วนพฤติกรรม (กติกาในระบบ)</span>
                  <span className="block text-[10px] font-bold text-slate-400 truncate">
                    {logicMeta?.version
                      ? `เวอร์ชัน ${logicMeta.version} · อัปเดต ${logicMeta.stamped_at ? new Date(logicMeta.stamped_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}`
                      : 'รอแชทข้อความแรกหลัง deploy เพื่อรายงานเวอร์ชัน'}
                  </span>
                </span>
                <span className="text-[10px] font-black text-indigo-500">{logicOpen ? 'ซ่อน' : 'ดูรายการ'}</span>
              </button>
              {logicOpen && (
                <div className="px-4 pb-3 border-t border-slate-100 max-h-[300px] overflow-y-auto">
                  <p className="text-[10px] text-slate-500 leading-relaxed py-2">
                    มาตินมี 2 สมอง: <b>คลังคำตอบ</b> (ผังนี้ + ค่ากลางร้าน + คูปอง/ราคา — คุณแก้เองได้ มีผลทันที)
                    กับ <b>กติกาพฤติกรรม</b> (กฎการขาย/ระบบกันพลาดในโค้ด — อัปเดตผ่านการ deploy โดยทีมพัฒนา)
                    รายการล่าสุดของฝั่งกติกา:
                  </p>
                  <ul className="space-y-1.5 pb-1">
                    {(logicMeta?.changelog || []).map((c, i) => (
                      <li key={i} className="flex gap-2 text-[11px] leading-snug text-slate-700">
                        <span className="shrink-0 text-[9px] font-black text-indigo-400 mt-0.5">{c.at.slice(5)}</span>
                        <span>{c.text}</span>
                      </li>
                    ))}
                    {!logicMeta?.changelog?.length && (
                      <li className="text-[11px] text-slate-400">ยังไม่มีรายงานจากระบบ — จะขึ้นอัตโนมัติเมื่อมีแชทแรกหลัง deploy ล่าสุด</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id === 'root' ? null : n.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={24} size={1.5} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-slate-100" />
          </ReactFlow>
        </div>

        {/* Side panel */}
        {sel && selectedId && (
          <div className="w-[380px] max-w-[92vw] bg-white border-l border-slate-200 flex flex-col shadow-xl">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <span className="text-xl">{sel.type === 'live' ? '🔗' : sel.emoji || '💬'}</span>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm text-slate-800 truncate">{sel.label}</p>
                <p className="text-[10px] font-bold text-slate-400">{sel.type === 'live' ? 'ดึงสดจากระบบ — แก้ที่หน้าจัดการจริง' : sel.type === 'behavior' || sel.type === 'behavior_rule' ? 'กติกาพฤติกรรมจากระบบ — แก้ผ่านการเทรน' : 'หมวดคำตอบที่คุณเขียนเอง'}</p>
              </div>
              <button onClick={() => setSelectedId(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"><X size={16} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {sel.type === 'live' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <p className="text-xs text-amber-800 leading-relaxed">{LIVE_META[sel.live_key || '']?.desc || 'ข้อมูลส่วนนี้ AI อ่านสดจากระบบ'}</p>
                  <Link to={LIVE_META[sel.live_key || '']?.to || '/'}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-black text-amber-700 hover:text-amber-900">
                    ไปหน้าจัดการจริง <ExternalLink size={12} />
                  </Link>
                </div>
              ) : sel.type === 'behavior' || sel.type === 'behavior_rule' ? (
                <div className="space-y-3">
                  <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
                    <p className="text-[11px] font-black text-indigo-700 uppercase tracking-wide mb-2">กติกาที่ระบบบังคับใช้จริง{sel.type === 'behavior' ? 'ในขั้นนี้' : ''}</p>
                    <ul className="space-y-2">
                      {(sel.rules || [sel.label]).map((r, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-700 leading-relaxed">
                          <span className="shrink-0 w-4 h-4 rounded-full bg-indigo-100 text-indigo-600 text-[9px] font-black flex items-center justify-center mt-0.5">{i + 1}</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      โหนดนี้คือ <b>สมองพฤติกรรม</b> — แก้ไม่ได้จากหน้านี้ เพราะเป็นกติกาในโค้ดระบบ
                      (อัปเดตผ่านการเทรน: ส่งเคสแชทที่หลุด + คำตอบที่ควรเป็น ให้ทีมพัฒนาแปลงเป็นกติกา+เทสต์กันถอยหลัง).
                      ใช้โหนดนี้วางแผนเทรนได้เลย: <b>ลากเส้น</b>จากขั้นที่มีปัญหาไปยังหมวดความรู้ที่ต้องเติม
                      หรือเพิ่มหมวดใหม่เชื่อมกับขั้นนั้นเพื่อกำหนดคำตอบที่ AI ควรใช้ในจังหวะนั้น
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* meta */}
                  <div className="grid grid-cols-[64px_1fr] gap-2">
                    <input value={sel.emoji || ''} maxLength={4} onChange={(e) => updateSel({ emoji: e.target.value })}
                      placeholder="💬" aria-label="ไอคอนหมวด"
                      className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-center text-lg outline-none focus:border-blue-400" />
                    <input value={sel.label} onChange={(e) => updateSel({ label: e.target.value })}
                      placeholder="ชื่อหมวด" aria-label="ชื่อหมวด"
                      className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-400" />
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                    <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5"><Power size={13} /> เปิดใช้หมวดนี้ (AI นำไปตอบ)</span>
                    <button onClick={() => updateSel({ enabled: sel.enabled === false })}
                      className={`w-11 h-6 rounded-full relative transition-colors ${sel.enabled !== false ? 'bg-emerald-500' : 'bg-slate-300'}`}
                      aria-label="เปิด/ปิดหมวด">
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${sel.enabled !== false ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {/* Q&A list */}
                  <div className="space-y-3">
                    {sortedItems.map(([itemId, it]) => (
                      <div key={itemId} className="border border-slate-200 rounded-2xl p-3 bg-slate-50/60">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <GripVertical size={13} className="text-slate-300" />
                          <span className="text-[10px] font-black text-blue-600 uppercase">คำถามของลูกค้า</span>
                          <button onClick={() => removeItem(itemId)} className="ml-auto p-1 text-slate-300 hover:text-red-500" aria-label="ลบคำตอบนี้"><Trash2 size={13} /></button>
                        </div>
                        <input value={it.q} onChange={(e) => updateItem(itemId, { q: e.target.value })}
                          placeholder="เช่น มีค่าบริการรับถึงบ้านไหม"
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-[13px] font-bold outline-none focus:border-blue-400" />
                        <p className="text-[10px] font-black text-emerald-600 uppercase mt-2 mb-1 flex items-center gap-1"><MessageSquareText size={11} /> คำตอบที่ให้ AI ใช้</p>
                        <textarea value={it.a} onChange={(e) => updateItem(itemId, { a: e.target.value })}
                          rows={3} placeholder="พิมพ์คำตอบทางการของร้าน..."
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-[13px] outline-none focus:border-blue-400 resize-y leading-relaxed" />
                      </div>
                    ))}
                    <button onClick={addItem}
                      className="w-full py-2.5 rounded-2xl border-2 border-dashed border-emerald-300 text-emerald-600 text-xs font-black hover:bg-emerald-50 transition-colors">
                      + เพิ่มคำถาม-คำตอบ
                    </button>
                  </div>

                  <button onClick={deleteSelectedNode}
                    className="w-full py-2 rounded-xl text-xs font-black text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5">
                    <Trash2 size={13} /> ลบหมวดนี้
                  </button>
                </>
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-slate-100 text-[10px] text-slate-400 font-bold">
              การแก้ไขมีผลเมื่อกด "บันทึกการเปลี่ยนแปลง" ด้านบน
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
