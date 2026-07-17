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
  MessageSquareText, Power, GripVertical,
} from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';

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
  label: string; emoji?: string; type: 'root' | 'custom' | 'live';
  live_key?: string; x: number; y: number; enabled?: boolean;
  items?: Record<string, KbItem>;
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

const nodeTypes = { root: RootNode, kbcat: CategoryNode, kblive: LiveNode };

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
  const dirtyRef = useRef(false);
  const markDirty = () => { dirtyRef.current = true; setDirty(true); };

  // ---- load / seed ----
  useEffect(() => {
    get(ref(db, 'settings/chat_kb'))
      .then((snap) => {
        const g: KbGraphRec = snap.exists() ? (snap.val() as KbGraphRec) : seedGraph();
        if (!g.nodes || !g.nodes.root) g.nodes = { ...seedGraph().nodes, ...(g.nodes || {}) };
        hydrate(g);
      })
      .catch(() => { toast.error('โหลดคลังคำตอบไม่สำเร็จ'); hydrate(seedGraph()); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrate = (g: KbGraphRec) => {
    const nrecs = g.nodes || {};
    setRecs(nrecs);
    setNodes(Object.entries(nrecs).map(([id, n]) => ({
      id,
      type: n.type === 'root' ? 'root' : n.type === 'live' ? 'kblive' : 'kbcat',
      position: { x: Number(n.x) || 0, y: Number(n.y) || 0 },
      deletable: n.type === 'custom',
      data: {
        label: n.label, emoji: n.emoji, enabled: n.enabled !== false,
        live_key: n.live_key, count: Object.keys(n.items || {}).length,
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
        <div className="flex-1 min-w-0">
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
                <p className="text-[10px] font-bold text-slate-400">{sel.type === 'live' ? 'ดึงสดจากระบบ — แก้ที่หน้าจัดการจริง' : 'หมวดคำตอบที่คุณเขียนเอง'}</p>
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
