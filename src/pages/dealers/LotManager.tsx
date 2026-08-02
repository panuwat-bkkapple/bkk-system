// /lots — บอร์ดล็อตขายส่ง + สร้าง lot ใหม่ (เลือกเครื่องจากสต๊อก)
// draft สร้างได้ทุก role — publish/close/award ทำในหน้า LotDetail (CEO/MANAGER)
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { stockCost } from '../../utils/accessoryItems';
import { useAuth } from '../../hooks/useAuth';
import { Boxes, Plus, Search, X, Lock } from 'lucide-react';
import {
  LOT_STATUS_META, DEALER_TIERS, TIER_META, fmtBaht, fmtDateTime,
  type Lot, type LotStatus, type DealerTier,
} from '../../types/dealer';

const call = async (name: string, data: Record<string, unknown>) => {
  const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), name);
  return (await fn(data)).data as any;
};

const STATUS_ORDER: LotStatus[] = ['open', 'closed', 'awarding', 'awarded', 'draft', 'completed', 'cancelled'];

export const LotManager = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const { hasAccess } = useAuth();
  const { data: lotsRaw, loading } = useDatabase('lots');
  const { data: jobs } = useDatabase('jobs');
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<'active' | 'all'>('active');

  const lots: Lot[] = useMemo(() => {
    const list = Array.isArray(lotsRaw) ? lotsRaw : [];
    const filtered = filter === 'active'
      ? list.filter((l: Lot) => !['completed', 'cancelled'].includes(l.status))
      : list;
    return filtered.sort((a: Lot, b: Lot) => {
      const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      return s !== 0 ? s : (b.created_at || 0) - (a.created_at || 0);
    });
  }, [lotsRaw, filter]);

  if (loading) return <div className="p-10 text-center text-slate-400">Loading Lots...</div>;

  return (
    <div className="p-6 bg-slate-100 min-h-screen font-sans text-slate-800">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
            <Boxes className="text-blue-600" /> Lot Manager
          </h1>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
            ล็อตขายส่ง · ประมูลปิดซอง · Dealer Portal
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <div className="flex gap-1 bg-white p-1 rounded-xl border border-slate-200">
            <button onClick={() => setFilter('active')} className={`px-3 py-2 text-[10px] font-black uppercase rounded-lg ${filter === 'active' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Active</button>
            <button onClick={() => setFilter('all')} className={`px-3 py-2 text-[10px] font-black uppercase rounded-lg ${filter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>ทั้งหมด</button>
          </div>
          <button onClick={() => setShowCreate(true)} className="bg-blue-600 text-white px-5 py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-blue-700 flex items-center gap-2">
            <Plus size={16} /> สร้าง Lot
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {lots.map((lot) => {
          const meta = LOT_STATUS_META[lot.status] || LOT_STATUS_META.draft;
          const closingSoon = lot.status === 'open' && lot.close_at - Date.now() < 3600_000;
          return (
            <button
              key={lot.id}
              onClick={() => navigate(`/lots/${lot.id}`)}
              className="text-left bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-blue-300 transition-all p-5"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="font-mono font-black text-xs text-slate-400">{lot.lot_no || '(draft)'}</div>
                <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg border ${meta.cls}`}>{meta.label}</span>
              </div>
              <div className="font-black text-slate-800 mb-1">{lot.title}</div>
              <div className="text-xs font-bold text-slate-500 mb-3">
                {lot.item_count} เครื่อง{lot.asking_total ? ` · ราคาตั้ง ${fmtBaht(lot.asking_total)}` : ''}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {DEALER_TIERS.filter((t) => lot.visible_tiers?.[t]).map((t) => (
                    <span key={t} className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${TIER_META[t].cls}`}>{t}</span>
                  ))}
                </div>
                {lot.status === 'open' && (
                  <div className={`text-[10px] font-black ${closingSoon ? 'text-red-600' : 'text-slate-500'}`}>
                    ปิดรับ {fmtDateTime(lot.close_at)}
                  </div>
                )}
                {['open', 'closed', 'awarding'].includes(lot.status) && (
                  <div className="flex items-center gap-1 text-[10px] font-black text-purple-600">
                    <Lock size={10} /> <BidCount lotId={lot.id} eligible={lot.eligible_count || 0} />
                  </div>
                )}
                {lot.award && <div className="text-[10px] font-black text-blue-600">{fmtBaht(lot.award.total_amount)}</div>}
              </div>
            </button>
          );
        })}
        {lots.length === 0 && (
          <div className="col-span-full p-10 text-center text-slate-400 italic font-bold bg-white rounded-2xl border border-slate-200">
            ยังไม่มี lot — กด "สร้าง Lot" เพื่อรวมเครื่องจากสต๊อกเสนอขายดีลเลอร์
          </div>
        )}
      </div>

      {showCreate && (
        <CreateLotModal
          jobs={Array.isArray(jobs) ? jobs : []}
          canSeeCost={hasAccess(['CEO', 'MANAGER'])}
          onClose={() => setShowCreate(false)}
          onCreated={(lotId) => {
            setShowCreate(false);
            toast.success('สร้าง lot (draft) แล้ว — ตรวจสอบและกด Publish เพื่อเปิดรับราคา');
            navigate(`/lots/${lotId}`);
          }}
        />
      )}
    </div>
  );
};

// ตัวนับซอง — canonical อยู่ lot_private (admin อ่านได้ตาม rules)
const BidCount = ({ lotId, eligible }: { lotId: string; eligible: number }) => {
  const { data: priv } = useDatabase('lot_private');
  const count = useMemo(() => {
    const list = Array.isArray(priv) ? priv : [];
    const row = list.find((p: any) => p.id === lotId);
    return row?.bid_count || 0;
  }, [priv, lotId]);
  return <span>{count}/{eligible} เสนอราคา</span>;
};

const CreateLotModal = ({
  jobs, canSeeCost, onClose, onCreated,
}: {
  jobs: any[];
  canSeeCost: boolean;
  onClose: () => void;
  onCreated: (lotId: string) => void;
}) => {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bidMode, setBidMode] = useState<'both' | 'whole_lot' | 'per_item'>('both');
  const [tiers, setTiers] = useState<Record<DealerTier, boolean>>({ A: true, B: true, C: true });
  const [closeAt, setCloseAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setMinutes(0, 0, 0);
    // datetime-local ต้องเป็นเวลาท้องถิ่นแบบไม่มี timezone
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [reservePrice, setReservePrice] = useState('');
  const [showBidStats, setShowBidStats] = useState(false); // default: ดีลเลอร์ไม่เห็น 5/30
  const [busy, setBusy] = useState(false);

  // เครื่องที่เข้า lot ได้: อยู่ในคลัง + ไม่ติด lot อื่น
  const candidates = useMemo(() => {
    return jobs
      .filter((j) =>
        ['In Stock', 'Ready to Sell'].includes(j.status) &&
        j.type !== 'B2B Trade-in' && j.type !== 'Withdrawal' && !j.lot_id &&
        (
          !search ||
          j.model?.toLowerCase().includes(search.toLowerCase()) ||
          j.ref_no?.toLowerCase().includes(search.toLowerCase()) ||
          j.serial?.toLowerCase().includes(search.toLowerCase())
        )
      )
      .sort((a, b) => (b.qc_date || 0) - (a.qc_date || 0));
  }, [jobs, search]);

  const selectedJobs = useMemo(() => jobs.filter((j) => selected.has(j.id)), [jobs, selected]);
  const totalCost = useMemo(() => selectedJobs.reduce((s, j) => s + stockCost(j), 0), [selectedJobs]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const handleCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (selected.size === 0) throw new Error('เลือกเครื่องอย่างน้อย 1 เครื่อง');
      if (!title.trim()) throw new Error('ตั้งชื่อ lot ก่อน');
      const closeMs = new Date(closeAt).getTime();
      if (!closeMs || closeMs <= Date.now()) throw new Error('เวลาปิดรับราคาต้องอยู่ในอนาคต');
      const visibleTiers: Record<string, boolean> = {};
      (Object.keys(tiers) as DealerTier[]).forEach((t) => { if (tiers[t]) visibleTiers[t] = true; });
      const res = await call('adminDealerLotCreate', {
        title: title.trim(),
        description: description.trim(),
        item_ids: [...selected],
        bid_mode: bidMode,
        close_at: closeMs,
        visible_tiers: visibleTiers,
        show_bid_stats: showBidStats,
        reserve_price: Number(reservePrice) || 0,
      });
      onCreated(res.lotId);
    } catch (err: any) {
      toast.error(err?.message || 'สร้าง lot ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
          <h3 className="font-black text-lg text-slate-800 uppercase tracking-tight flex items-center gap-2">
            <Boxes size={20} className="text-blue-500" /> สร้าง Lot ขายส่ง
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ซ้าย: เลือกเครื่อง */}
          <div>
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 mb-3">
              <Search size={16} className="text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหารุ่น / Ref / SN..." className="bg-transparent outline-none text-sm font-bold w-full" />
            </div>
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[45vh] overflow-y-auto">
              {candidates.map((j) => (
                <label key={j.id} className="flex items-center gap-3 p-3 hover:bg-blue-50/40 cursor-pointer">
                  <input type="checkbox" checked={selected.has(j.id)} onChange={() => toggle(j.id)} className="w-4 h-4" />
                  <div className="flex-1">
                    <div className="font-bold text-sm text-slate-800">{j.model} <span className="text-[10px] text-slate-400">เกรด {j.grade || '-'}</span></div>
                    <div className="text-[10px] font-mono text-slate-400">{j.ref_no} · {j.status}</div>
                  </div>
                  {canSeeCost && <div className="text-xs font-bold text-slate-500">ทุน {fmtBaht(stockCost(j))}</div>}
                </label>
              ))}
              {candidates.length === 0 && <div className="p-6 text-center text-slate-400 text-sm font-bold italic">ไม่พบเครื่องในคลังที่ว่างสำหรับ lot</div>}
            </div>
            <div className="mt-2 text-xs font-black text-slate-600">
              เลือกแล้ว {selected.size} เครื่อง{canSeeCost ? ` · ต้นทุนรวม ${fmtBaht(totalCost)}` : ''}
            </div>
          </div>

          {/* ขวา: รายละเอียด lot */}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ชื่อ Lot *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น iPhone 14/15 คละเกรด 22 เครื่อง" className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">รายละเอียด</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">รูปแบบการเสนอราคา</label>
                <select value={bidMode} onChange={(e) => setBidMode(e.target.value as any)} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none">
                  <option value="both">ยกล็อต + รายตัว</option>
                  <option value="whole_lot">ยกล็อตเท่านั้น</option>
                  <option value="per_item">รายตัวเท่านั้น</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ปิดรับราคา</label>
                <input type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tier ที่มองเห็น lot นี้</label>
              <div className="flex gap-2 mt-1">
                {(Object.keys(tiers) as DealerTier[]).map((t) => (
                  <button key={t} onClick={() => setTiers({ ...tiers, [t]: !tiers[t] })}
                    className={`flex-1 py-2 rounded-xl border text-xs font-black uppercase ${tiers[t] ? TIER_META[t].cls : 'bg-slate-50 text-slate-300 border-slate-200'}`}>
                    {TIER_META[t].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-amber-500 uppercase tracking-widest">ราคาขั้นต่ำ (Reserve — ดีลเลอร์ไม่เห็น)</label>
              <input type="number" value={reservePrice} onChange={(e) => setReservePrice(e.target.value)} placeholder="ไม่บังคับ" className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none focus:border-amber-500" />
            </div>
            <label className="flex items-start gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200 cursor-pointer">
              <input type="checkbox" checked={showBidStats} onChange={(e) => setShowBidStats(e.target.checked)} className="w-4 h-4 mt-0.5" />
              <div>
                <div className="text-xs font-black text-slate-700">โชว์จำนวนผู้เสนอราคา (เช่น 5/30) ให้ดีลเลอร์เห็น</div>
                <div className="text-[10px] font-bold text-slate-400">ค่าเริ่มต้น = ปิด (เห็นเฉพาะแอดมิน) — เปิดเมื่ออยากกระตุ้นการแข่งขัน</div>
              </div>
            </label>
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 text-slate-500 font-bold text-xs uppercase hover:bg-white rounded-xl">ยกเลิก</button>
          <button onClick={handleCreate} disabled={busy} className="flex-[2] bg-blue-600 text-white py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'กำลังสร้าง...' : `สร้าง Draft (${selected.size} เครื่อง)`}
          </button>
        </div>
      </div>
    </div>
  );
};
