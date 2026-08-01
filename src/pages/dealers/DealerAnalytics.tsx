// /dealer-analytics (CEO/MANAGER) — วิเคราะห์ฝั่งขายส่ง: margin ต่อ lot,
// ยอดต่อดีลเลอร์, ราคาเฉลี่ยต่อรุ่นจากออเดอร์รายตัว
// หมายเหตุ: ข้อมูลราคาในซองที่ "ไม่ชนะ" ยังปิดผนึก (อ่านได้ผ่านการเปิดซอง
// รายใบเท่านั้น) — analytics ชุดนี้จึงอิงจากผลที่อนุมัติแล้ว + คำสั่งซื้อ
import { useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { TrendingUp } from 'lucide-react';
import { fmtBaht, type DealerOrder, type Lot } from '../../types/dealer';

export const DealerAnalytics = () => {
  const { data: lotsRaw, loading } = useDatabase('lots');
  const { data: privRaw } = useDatabase('lot_private');
  const { data: ordersRaw } = useDatabase('dealer_orders');
  const { data: dealersRaw } = useDatabase('dealers');

  const lots: Lot[] = useMemo(() => (Array.isArray(lotsRaw) ? lotsRaw : []), [lotsRaw]);
  const orders: DealerOrder[] = useMemo(() => (Array.isArray(ordersRaw) ? ordersRaw : []), [ordersRaw]);
  const privMap = useMemo(() => {
    const m: Record<string, any> = {};
    (Array.isArray(privRaw) ? privRaw : []).forEach((p: any) => { m[p.id] = p; });
    return m;
  }, [privRaw]);
  const dealerName = useMemo(() => {
    const m: Record<string, string> = {};
    (Array.isArray(dealersRaw) ? dealersRaw : []).forEach((d: any) => { m[d.id] = d.company_name || d.id; });
    return m;
  }, [dealersRaw]);

  const awardedLots = useMemo(
    () => lots.filter((l) => ['awarded', 'completed'].includes(l.status) && l.award),
    [lots]
  );

  const summary = useMemo(() => {
    const totalAwarded = awardedLots.reduce((s, l) => s + (l.award?.total_amount || 0), 0);
    const totalCost = awardedLots.reduce((s, l) => s + (privMap[l.id]?.total_cost || 0), 0);
    const margin = totalAwarded - totalCost;
    const avgParticipation = awardedLots.length
      ? awardedLots.reduce((s, l) => s + (privMap[l.id]?.bid_count || 0), 0) / awardedLots.length
      : 0;
    return { count: awardedLots.length, totalAwarded, margin, avgParticipation };
  }, [awardedLots, privMap]);

  const perDealer = useMemo(() => {
    const m = new Map<string, { name: string; orders: number; amount: number }>();
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const cur = m.get(o.dealer_uid) || {
        name: o.dealer_snapshot?.company_name || dealerName[o.dealer_uid] || o.dealer_uid,
        orders: 0,
        amount: 0,
      };
      cur.orders += 1;
      cur.amount += Number(o.amount) || 0;
      m.set(o.dealer_uid, cur);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [orders, dealerName]);

  const perModel = useMemo(() => {
    // เฉพาะออเดอร์รายตัว (ยกล็อตไม่มีราคาต่อเครื่อง)
    const m = new Map<string, { count: number; sum: number }>();
    for (const o of orders) {
      if (o.type !== 'per_item' || o.status === 'cancelled') continue;
      for (const it of Object.values(o.items || {})) {
        if (!it.amount) continue;
        const cur = m.get(it.model) || { count: 0, sum: 0 };
        cur.count += 1;
        cur.sum += it.amount;
        m.set(it.model, cur);
      }
    }
    return [...m.entries()]
      .map(([model, v]) => ({ model, count: v.count, avg: Math.round(v.sum / v.count) }))
      .sort((a, b) => b.count - a.count);
  }, [orders]);

  if (loading) return <div className="p-10 text-center text-slate-400">Loading...</div>;

  return (
    <div className="p-6 bg-slate-100 min-h-screen font-sans text-slate-800">
      <div className="mb-6">
        <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
          <TrendingUp className="text-blue-600" /> Dealer Analytics
        </h1>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
          ผลการขายส่ง — data asset ที่ระบบ LINE ไม่มีวันให้
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card label="Lot ที่ขายแล้ว" value={`${summary.count}`} />
        <Card label="ยอดขายส่งรวม" value={fmtBaht(summary.totalAwarded)} />
        <Card label="Margin รวม" value={fmtBaht(summary.margin)} accent={summary.margin >= 0 ? 'text-emerald-600' : 'text-red-500'} />
        <Card label="ผู้เสนอเฉลี่ย/lot" value={summary.avgParticipation.toFixed(1)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Panel title="Margin ต่อ Lot">
          <tbody className="divide-y divide-slate-50">
            {awardedLots.map((l) => {
              const cost = privMap[l.id]?.total_cost || 0;
              const margin = (l.award?.total_amount || 0) - cost;
              return (
                <tr key={l.id}>
                  <td className="p-3">
                    <div className="font-bold text-sm font-mono">{l.lot_no}</div>
                    <div className="text-[10px] text-slate-400 font-bold">{l.item_count} เครื่อง · เสนอ {privMap[l.id]?.bid_count || 0} ราย</div>
                  </td>
                  <td className="p-3 text-right font-bold text-slate-600">{fmtBaht(l.award?.total_amount)}</td>
                  <td className={`p-3 text-right font-black ${margin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtBaht(margin)}</td>
                </tr>
              );
            })}
            {awardedLots.length === 0 && <Empty cols={3} />}
          </tbody>
        </Panel>

        <Panel title="ยอดซื้อต่อดีลเลอร์">
          <tbody className="divide-y divide-slate-50">
            {perDealer.map((d) => (
              <tr key={d.name}>
                <td className="p-3 font-bold text-sm">{d.name}</td>
                <td className="p-3 text-center font-bold text-slate-500">{d.orders}</td>
                <td className="p-3 text-right font-black text-blue-600">{fmtBaht(d.amount)}</td>
              </tr>
            ))}
            {perDealer.length === 0 && <Empty cols={3} />}
          </tbody>
        </Panel>

        <Panel title="ราคาเฉลี่ยต่อรุ่น (จากออเดอร์รายตัว)">
          <tbody className="divide-y divide-slate-50">
            {perModel.map((m) => (
              <tr key={m.model}>
                <td className="p-3 font-bold text-sm">{m.model}</td>
                <td className="p-3 text-center font-bold text-slate-500">{m.count}</td>
                <td className="p-3 text-right font-black text-slate-700">{fmtBaht(m.avg)}</td>
              </tr>
            ))}
            {perModel.length === 0 && <Empty cols={3} />}
          </tbody>
        </Panel>
      </div>
    </div>
  );
};

const Card = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
    <div className={`text-xl font-black ${accent || 'text-slate-800'}`}>{value}</div>
  </div>
);

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
    <div className="p-4 border-b border-slate-100 font-black text-xs uppercase tracking-widest text-slate-500">{title}</div>
    <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
      <table className="w-full text-left">{children}</table>
    </div>
  </div>
);

const Empty = ({ cols }: { cols: number }) => (
  <tr><td colSpan={cols} className="p-6 text-center text-slate-400 italic font-bold text-sm">ยังไม่มีข้อมูล</td></tr>
);
