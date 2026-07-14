import { useState, useEffect, useMemo } from 'react';
import { ref, get, push, update, set, increment } from 'firebase/database';
import { db } from '../../api/firebase';
import { X, Search, FileText, ChevronLeft } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';
import {
  resolveOptionDeduction,
  type ConditionGroupLike,
  type ConditionOptionLike,
} from '../../utils/pricingResolver';

// ชุดคำถามจริงใน RTDB มี id ต่อกลุ่ม (resolver type กลางไม่ประกาศไว้)
type QuoteGroup = ConditionGroupLike & { id?: string };

// ---------------------------------------------------------------------------
// QuoteComposer — แอดมินสร้างการ์ดใบเสนอราคาส่งเข้าแชทลูกค้า (inbox widget)
// payload ต้องมีรูปเดียวกับ create_quote_card ใน functions/chat-ai.js เป๊ะ
// เพราะ ChatWidget ฝั่งลูกค้าอ่าน payload เดียวกันแล้วส่งเข้า checkout ต่อ
// ---------------------------------------------------------------------------

interface VariantLite {
  name: string;
  usedPrice: number;
  newPrice: number;
  imageUrl?: string;
  capacity: string;
}

interface ModelLite {
  id: string;
  name: string;
  brand: string;
  conditionSetId: string | null;
  liquidityFactor: unknown;
  imageUrl: string | null;
  rules: unknown;
  pickupEligible: boolean;
  maxPickupDistanceKm: number;
  variants: VariantLite[];
}

// เงื่อนไขคงที่ของเครื่องมือ 1 — mirror handleNewDeviceCheckout (SellPageClient)
// และ create_quote_card ฝั่ง cloud function
const NEW_DEVICE_CONDS = (hasReceipt: boolean) => [
  { id: 'sealed_box', title: 'สภาพกล่อง', value: 'ซีลไม่ฉีก / ยังไม่แกะกล่อง', deduct: 0 },
  { id: 'never_activated', title: 'การเปิดใช้งาน', value: 'ไม่เคยเปิดเครื่องหรือ Activate', deduct: 0 },
  { id: 'full_accessories', title: 'อุปกรณ์ในกล่อง', value: 'อุปกรณ์ครบกล่อง ไม่มีชิ้นส่วนสูญหาย', deduct: 0 },
  { id: 'no_damage', title: 'สภาพภายนอก', value: 'ไม่มีรอยบุบ รอยขีดข่วน หรือตำหนิใดๆ', deduct: 0 },
  {
    id: 'purchase_proof',
    title: 'หลักฐานการซื้อ',
    value: hasReceipt
      ? 'มีใบเสร็จหรือหลักฐานการซื้อจากร้านค้าที่ได้รับอนุญาต'
      : 'ไม่มีหลักฐานการซื้อ',
    deduct: hasReceipt ? 0 : 500,
  },
];

interface Props {
  convoId: string;
  staffId: string;
  staffName: string;
  onClose: () => void;
  onSent?: () => void | Promise<void>;
}

export default function QuoteComposer({ convoId, staffId, staffName, onClose, onSent }: Props) {
  const toast = useToast();
  const [models, setModels] = useState<ModelLite[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [query, setQuery] = useState('');
  const [model, setModel] = useState<ModelLite | null>(null);
  const [variant, setVariant] = useState<VariantLite | null>(null);
  const [conditionType, setConditionType] = useState<'used' | 'new'>('used');
  const [hasReceipt, setHasReceipt] = useState(true);
  const [groups, setGroups] = useState<QuoteGroup[]>([]);
  const [loadingSet, setLoadingSet] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  // โหลดแคตตาล็อกครั้งเดียว
  useEffect(() => {
    (async () => {
      try {
        const snap = await get(ref(db, 'models'));
        const list: ModelLite[] = [];
        if (snap.exists()) {
          const all = snap.val() as Record<string, Record<string, unknown>>;
          for (const [id, m] of Object.entries(all)) {
            if (!m || !m.name) continue;
            const rawVariants = Array.isArray(m.variants)
              ? m.variants
              : Object.values((m.variants as object) || {});
            const variants: VariantLite[] = (rawVariants as Record<string, unknown>[])
              .filter((v) => v && v.name)
              .map((v) => {
                const attrs = (v.attributes || {}) as Record<string, string>;
                return {
                  name: String(v.name),
                  usedPrice: Number(v.usedPrice || v.price || 0),
                  newPrice: Number(v.newPrice || 0),
                  imageUrl: (v.imageUrl as string) || undefined,
                  capacity: String(attrs.storage || attrs.capacity || v.name),
                };
              });
            list.push({
              id,
              name: String(m.name),
              brand: String(m.brand || ''),
              conditionSetId: (m.conditionSetId as string) || (m.engineId as string) || null,
              liquidityFactor: m.liquidityFactor,
              imageUrl: (m.imageUrl as string) || null,
              rules: m.rules != null ? m.rules : null,
              pickupEligible: m.pickup !== false,
              maxPickupDistanceKm: Number(m.maxPickupDistanceKm) || 0,
              variants,
            });
          }
        }
        list.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        setModels(list);
      } catch {
        toast.error('โหลดรายการรุ่นไม่สำเร็จ');
      } finally {
        setLoadingModels(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // โหลดชุดคำถามสภาพเมื่อเลือกโหมดมือสอง — default ทุกกลุ่ม = ตัวเลือกหักน้อยสุด
  useEffect(() => {
    if (!model || conditionType !== 'used') return;
    if (!model.conditionSetId) {
      setGroups([]);
      return;
    }
    setLoadingSet(true);
    (async () => {
      try {
        const snap = await get(ref(db, `settings/condition_sets/${model.conditionSetId}`));
        const s = snap.exists() ? snap.val() : null;
        const gs: QuoteGroup[] = (
          Array.isArray(s?.groups) ? s.groups : Object.values(s?.groups || {})
        ).filter((g: QuoteGroup) => g && g.id);
        setGroups(gs);
        const base = variant?.usedPrice || 0;
        const defaults: Record<string, string> = {};
        for (const g of gs) {
          const opts = (g.options || []).filter((o: ConditionOptionLike) => o && o.id != null);
          if (!opts.length) continue;
          const best = opts.reduce((a: ConditionOptionLike, b: ConditionOptionLike) =>
            resolveOptionDeduction(b, base, model.liquidityFactor) <
            resolveOptionDeduction(a, base, model.liquidityFactor)
              ? b
              : a
          );
          defaults[String(g.id)] = String(best.id);
        }
        setAnswers(defaults);
      } catch {
        toast.error('โหลดชุดคำถามสภาพไม่สำเร็จ');
      } finally {
        setLoadingSet(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id, conditionType, variant?.name]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models.slice(0, 30);
    return models
      .filter((m) => `${m.brand} ${m.name}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [models, query]);

  // คำนวณราคาสด — สูตรเดียวกับ cloud function
  const computed = useMemo(() => {
    if (!model || !variant) return null;
    if (conditionType === 'new') {
      const base = variant.newPrice;
      if (!base) return null;
      const conds = NEW_DEVICE_CONDS(hasReceipt);
      const lines = conds.map((c) => ({ title: c.title, label: c.value, amount: c.deduct }));
      const total = conds.reduce((s, c) => s + c.deduct, 0);
      return { base, lines, estimated: Math.max(0, base - total) };
    }
    const base = variant.usedPrice;
    if (!base) return null;
    const lines: { title: string; label: string; amount: number }[] = [];
    let total = 0;
    for (const g of groups) {
      const opts = (g.options || []).filter((o: ConditionOptionLike) => o && o.id != null);
      const opt = opts.find((o: ConditionOptionLike) => String(o.id) === answers[String(g.id)]);
      if (!opt) continue;
      const amount = resolveOptionDeduction(opt, base, model.liquidityFactor);
      total += amount;
      lines.push({ title: g.title || '', label: opt.label || opt.name || '', amount });
    }
    return { base, lines, estimated: Math.max(0, base - total) };
  }, [model, variant, conditionType, hasReceipt, groups, answers]);

  const handleSend = async () => {
    if (!model || !variant || !computed || sending) return;
    setSending(true);
    try {
      const isNew = conditionType === 'new';
      const now = Date.now();
      const quoteRef = push(ref(db, 'chat_quotes'));

      const rawConditions: Record<string, string> = {};
      const customerConditions: {
        id: string; title: string; value: string; deductAmount: number; isNegative: boolean;
      }[] = [];
      if (isNew) {
        for (const c of NEW_DEVICE_CONDS(hasReceipt)) {
          customerConditions.push({
            id: c.id, title: c.title, value: c.value, deductAmount: c.deduct, isNegative: c.deduct > 0,
          });
        }
      } else {
        for (const g of groups) {
          const optId = answers[String(g.id)];
          const opt = (g.options || []).find((o: ConditionOptionLike) => String(o.id) === optId);
          if (!opt) continue;
          rawConditions[String(g.id)] = String(opt.id);
          const amount = resolveOptionDeduction(opt, computed.base, model.liquidityFactor);
          customerConditions.push({
            id: String(g.id),
            title: g.title || '',
            value: opt.label || opt.name || '',
            deductAmount: amount,
            isNegative: amount > 0,
          });
        }
      }

      const payload = {
        quote_id: quoteRef.key,
        model_id: model.id,
        model_name: model.name,
        variant_name: variant.name,
        capacity: variant.capacity,
        base_price: computed.base,
        estimated_price: computed.estimated,
        lines: computed.lines,
        raw_conditions: rawConditions,
        customer_conditions: customerConditions,
        image_url: variant.imageUrl || model.imageUrl || null,
        rules: model.rules,
        pickup_eligible: model.pickupEligible,
        max_pickup_distance_km: model.maxPickupDistanceKm,
        is_new_device: isNew,
        has_receipt: isNew ? hasReceipt : null,
        created_at: now,
        expires_at: now + 48 * 60 * 60 * 1000,
      };

      await set(quoteRef, {
        uid: convoId,
        status: 'offered',
        source: 'admin',
        by_staff_id: staffId,
        by_staff_name: staffName,
        ...payload,
      });

      const summary = `ใบเสนอราคา ${model.name} ${variant.name}${isNew ? ' (มือ 1 ยังไม่แกะซีล)' : ''}: ${computed.estimated.toLocaleString('th-TH')} บาท (ราคาประเมินเบื้องต้น)`;
      await push(ref(db, `inbox/${convoId}/messages`), {
        sender: staffId,
        senderName: staffName,
        senderRole: 'admin',
        kind: 'card_quote',
        text: summary,
        payload,
        timestamp: now,
        read: false,
      });
      await update(ref(db, `inbox/${convoId}`), {
        lastMessage: summary.slice(0, 200),
        lastMessageAt: now,
        customer_unread: increment(1),
      });
      await onSent?.();
      toast.success('ส่งใบเสนอราคาแล้ว');
      onClose();
    } catch {
      toast.error('ส่งใบเสนอราคาไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:w-[480px] sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          {model && (
            <button
              onClick={() => { setModel(null); setVariant(null); }}
              className="p-1 -ml-1 text-slate-400 hover:text-slate-600"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <FileText size={18} className="text-blue-600" />
          <h3 className="font-black text-sm text-slate-800 flex-1">
            {model ? `${model.name}` : 'สร้างใบเสนอราคา'}
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!model ? (
            <>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ค้นหารุ่น เช่น iPhone 17"
                  className="w-full bg-slate-100 rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {loadingModels ? (
                <p className="text-center text-sm text-slate-400 py-8">กำลังโหลดรายการรุ่น...</p>
              ) : (
                <div className="space-y-1">
                  {filtered.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setModel(m); setVariant(m.variants[0] || null); }}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-blue-50 text-left"
                    >
                      <span className="text-sm font-bold text-slate-700">{m.name}</span>
                      <span className="text-[11px] text-slate-400">{m.variants.length} ความจุ</span>
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="text-center text-sm text-slate-400 py-8">ไม่พบรุ่นที่ค้นหา</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Variant */}
              <div>
                <p className="text-[11px] font-black text-slate-400 uppercase mb-1.5">ความจุ</p>
                <div className="flex flex-wrap gap-1.5">
                  {model.variants.map((v) => (
                    <button
                      key={v.name}
                      onClick={() => setVariant(v)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                        variant?.name === v.name
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-slate-200 text-slate-600 hover:border-blue-300'
                      }`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Condition type */}
              <div>
                <p className="text-[11px] font-black text-slate-400 uppercase mb-1.5">ประเภทเครื่อง</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setConditionType('used')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border ${
                      conditionType === 'used'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    มือสอง
                  </button>
                  <button
                    onClick={() => setConditionType('new')}
                    disabled={!variant?.newPrice}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border disabled:opacity-40 ${
                      conditionType === 'new'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    มือ 1 ยังไม่แกะซีล{!variant?.newPrice ? ' (ไม่มีราคา)' : ''}
                  </button>
                </div>
              </div>

              {/* Conditions */}
              {conditionType === 'new' ? (
                <div>
                  <p className="text-[11px] font-black text-slate-400 uppercase mb-1.5">หลักฐานการซื้อ</p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setHasReceipt(true)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border ${
                        hasReceipt ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      มีใบเสร็จ
                    </button>
                    <button
                      onClick={() => setHasReceipt(false)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border ${
                        !hasReceipt ? 'bg-orange-500 text-white border-orange-500' : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      ไม่มีใบเสร็จ (-500)
                    </button>
                  </div>
                </div>
              ) : loadingSet ? (
                <p className="text-center text-sm text-slate-400 py-4">กำลังโหลดชุดคำถามสภาพ...</p>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-[11px] font-black text-slate-400 uppercase">
                    สภาพเครื่อง (ค่าเริ่มต้น = ปกติ ปรับเฉพาะข้อที่ลูกค้าแจ้ง)
                  </p>
                  {groups.map((g) => {
                    const base = variant?.usedPrice || 0;
                    const opts = (g.options || []).filter((o: ConditionOptionLike) => o && o.id != null);
                    return (
                      <div key={String(g.id)}>
                        <p className="text-xs font-bold text-slate-600 mb-1">{g.title}</p>
                        <select
                          value={answers[String(g.id)] || ''}
                          onChange={(e) =>
                            setAnswers((prev) => ({ ...prev, [String(g.id)]: e.target.value }))
                          }
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-500"
                        >
                          {opts.map((o: ConditionOptionLike) => {
                            const d = resolveOptionDeduction(o, base, model.liquidityFactor);
                            return (
                              <option key={String(o.id)} value={String(o.id)}>
                                {o.label || o.name}{d > 0 ? ` (-${d.toLocaleString('th-TH')})` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — live price + send */}
        {model && (
          <div className="border-t border-slate-100 p-4 space-y-2.5">
            {computed ? (
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-slate-500">
                  ราคาประเมิน{conditionType === 'new' ? ' (มือ 1)' : ''} · ราคากลาง {computed.base.toLocaleString('th-TH')}
                </span>
                <span className="text-xl font-black text-blue-600">
                  {computed.estimated.toLocaleString('th-TH')} บาท
                </span>
              </div>
            ) : (
              <p className="text-xs text-orange-500">
                {conditionType === 'new' ? 'รุ่น/ความจุนี้ไม่มีราคามือ 1 ในระบบ' : 'รุ่น/ความจุนี้ไม่มีราคาในระบบ'}
              </p>
            )}
            <button
              onClick={handleSend}
              disabled={!computed || sending}
              className="w-full py-2.5 rounded-full bg-blue-600 text-white text-sm font-bold disabled:bg-slate-200 disabled:text-slate-400 hover:bg-blue-700 transition-colors"
            >
              {sending ? 'กำลังส่ง...' : 'ส่งใบเสนอราคาเข้าแชท'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
