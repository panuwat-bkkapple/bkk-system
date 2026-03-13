// src/pages/analytics/Analytics.tsx
import React, { useMemo, useState, useEffect } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { ref, update, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { StaffPerformanceWidget } from '../../components/staff/StaffPerformanceWidget';
import { 
  BarChart3, TrendingUp, DollarSign, Package, 
  Smartphone, Activity, Wallet, PieChart as PieChartIcon, 
  Calendar, Clock, Headphones, TrendingDown, ArrowUpRight, 
  ArrowDownRight, Layers, Sparkles, AlertTriangle, Lightbulb,
  AlertOctagon, ShieldAlert, Banknote, Save, Edit3, Flame, Calculator,
  Radar
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Legend, Cell, PieChart, Pie, ReferenceLine
} from 'recharts';

interface AnalyticsProps { mode: 'buying' | 'sales'; }

export const Analytics = ({ mode }: AnalyticsProps) => {
  const { data: jobs, loading: jobsLoading } = useDatabase('jobs');
  const { data: sales, loading: salesLoading } = useDatabase('sales');
  
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'this_week' | 'this_month'>('today');

  // 💰 State สำหรับกระแสเงินสด (Cash Flow & Fixed Costs)
  const [workingCapital, setWorkingCapital] = useState<number>(0);
  const [isEditingCapital, setIsEditingCapital] = useState(false);
  const [tempCapital, setTempCapital] = useState<string>('');

  const [fixedCosts, setFixedCosts] = useState<number>(0);
  const [isEditingFixed, setIsEditingFixed] = useState(false);
  const [tempFixed, setTempFixed] = useState<string>('');

  useEffect(() => {
     const settingsRef = ref(db, 'settings');
     const unsub = onValue(settingsRef, (snap) => {
         if(snap.exists()) {
             const data = snap.val();
             if (data.working_capital !== undefined) {
                 setWorkingCapital(data.working_capital);
                 setTempCapital(data.working_capital.toString());
             }
             if (data.fixed_costs !== undefined) {
                 setFixedCosts(data.fixed_costs);
                 setTempFixed(data.fixed_costs.toString());
             }
         }
     });
     return () => unsub();
  }, []);

  const handleSaveSettings = (type: 'capital' | 'fixed') => {
      if (type === 'capital') {
          update(ref(db, 'settings'), { working_capital: Number(tempCapital) || 0 });
          setIsEditingCapital(false);
      } else {
          update(ref(db, 'settings'), { fixed_costs: Number(tempFixed) || 0 });
          setIsEditingFixed(false);
      }
  };

  // ==========================================
  // 🧠 1. THE GA COMPARISON ENGINE (SALES LOGIC)
  // ==========================================
  const salesInsights = useMemo(() => {
    const allSales = Array.isArray(sales) ? sales : [];
    const validSales = allSales.filter(s => s.status !== 'VOIDED');
    const now = new Date();
    const getStartOfDay = (d: Date) => new Date(d.setHours(0,0,0,0)).getTime();
    const getEndOfDay = (d: Date) => new Date(d.setHours(23,59,59,999)).getTime();

    let currStart = 0, currEnd = 0, prevStart = 0, prevEnd = 0;
    let chartType: 'hourly' | 'daily' = 'hourly';

    if (dateFilter === 'today') { currStart = getStartOfDay(now); currEnd = getEndOfDay(now); const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1); prevStart = getStartOfDay(yesterday); prevEnd = getEndOfDay(yesterday); chartType = 'hourly'; } 
    else if (dateFilter === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); currStart = getStartOfDay(y); currEnd = getEndOfDay(y); const dayBefore = new Date(y); dayBefore.setDate(dayBefore.getDate() - 1); prevStart = getStartOfDay(dayBefore); prevEnd = getEndOfDay(dayBefore); chartType = 'hourly'; } 
    else if (dateFilter === 'this_week') { const w = new Date(now); w.setDate(w.getDate() - w.getDay() + (w.getDay() === 0 ? -6 : 1)); currStart = getStartOfDay(w); currEnd = getEndOfDay(now); const lastW = new Date(w); lastW.setDate(lastW.getDate() - 7); const lastWEnd = new Date(lastW); lastWEnd.setDate(lastWEnd.getDate() + 6); prevStart = getStartOfDay(lastW); prevEnd = getEndOfDay(lastWEnd); chartType = 'daily'; } 
    else if (dateFilter === 'this_month') { currStart = getStartOfDay(new Date(now.getFullYear(), now.getMonth(), 1)); currEnd = getEndOfDay(now); const lastMStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); const lastMEnd = new Date(now.getFullYear(), now.getMonth(), 0); prevStart = getStartOfDay(lastMStart); prevEnd = getEndOfDay(lastMEnd); chartType = 'daily'; }

    const currData = validSales.filter(s => s.sold_at >= currStart && s.sold_at <= currEnd);
    const prevData = validSales.filter(s => s.sold_at >= prevStart && s.sold_at <= prevEnd);

    const calcStats = (data: any[]) => {
       let rev = 0, prof = 0, devices = 0, skus = 0, deviceRev = 0, deviceProf = 0, skuRev = 0, skuProf = 0;
       data.forEach(s => { rev += Number(s.grand_total) || 0; prof += Number(s.net_profit) || 0; s.items?.forEach((i:any) => { const itemRev = Number(i.price) * i.qty; const itemProf = itemRev - (Number(i.cost) * i.qty); if (i.type === 'DEVICE') { devices += i.qty; deviceRev += itemRev; deviceProf += itemProf; } if (i.type === 'SKU') { skus += i.qty; skuRev += itemRev; skuProf += itemProf; } }); });
       return { rev, prof, margin: rev > 0 ? (prof / rev) * 100 : 0, devices, skus, deviceRev, deviceProf, deviceMargin: deviceRev > 0 ? (deviceProf / deviceRev) * 100 : 0, skuRev, skuProf, skuMargin: skuRev > 0 ? (skuProf / skuRev) * 100 : 0 };
    };

    const current = calcStats(currData); const previous = calcStats(prevData);
    const getGrowth = (curr: number, prev: number) => { if (prev === 0 && curr > 0) return 100; if (prev === 0 && curr === 0) return 0; return ((curr - prev) / prev) * 100; };
    const growth = { rev: getGrowth(current.rev, previous.rev), prof: getGrowth(current.prof, previous.prof), margin: current.margin - previous.margin, qty: getGrowth(current.devices + current.skus, previous.devices + previous.skus) };

    let chartData: any[] = []; const peakHours = Array.from({length: 24}, (_, i) => ({ hour: `${i}:00`, sales: 0, count: 0 }));
    if (chartType === 'hourly') { chartData = Array.from({length: 24}, (_, i) => ({ label: `${i}:00`, current: 0, previous: 0 })); currData.forEach(s => { const h = new Date(s.sold_at).getHours(); chartData[h].current += Number(s.grand_total) || 0; }); prevData.forEach(s => { const h = new Date(s.sold_at).getHours(); chartData[h].previous += Number(s.grand_total) || 0; }); } 
    else { const days = dateFilter === 'this_week' ? ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'] : Array.from({length: 31}, (_, i) => `${i+1}`); chartData = days.map(d => ({ label: d, current: 0, previous: 0 })); currData.forEach(s => { const d = new Date(s.sold_at); const idx = dateFilter === 'this_week' ? d.getDay() : d.getDate() - 1; if (chartData[idx]) chartData[idx].current += Number(s.grand_total) || 0; }); prevData.forEach(s => { const d = new Date(s.sold_at); const idx = dateFilter === 'this_week' ? d.getDay() : d.getDate() - 1; if (chartData[idx]) chartData[idx].previous += Number(s.grand_total) || 0; }); }

    currData.forEach(s => { const h = new Date(s.sold_at).getHours(); peakHours[h].sales += Number(s.grand_total) || 0; peakHours[h].count += 1; });

    const generateInsights = () => {
       const tips = [];
       if (current.skuMargin > current.deviceMargin + 15 && current.devices > 0) tips.push({ type: 'opportunity', icon: <Lightbulb size={18} className="text-amber-500" />, text: `อุปกรณ์เสริมมี Margin สูงถึง ${current.skuMargin.toFixed(1)}% (เทียบกับเครื่อง ${current.deviceMargin.toFixed(1)}%) แนะนำให้พนักงานเสนอโปร "แพ็คคู่" เสมอ` });
       if (growth.rev > 0 && growth.prof < 0) tips.push({ type: 'warning', icon: <AlertTriangle size={18} className="text-red-500" />, text: `ยอดขายโต +${growth.rev.toFixed(1)}% แต่กำไรหดตัว ${growth.prof.toFixed(1)}% ระวังการอัดโปรโมชั่นตัดราคามากเกินไป` });
       const bestHour = peakHours.reduce((max, h) => h.sales > max.sales ? h : max, peakHours[0]);
       if (bestHour.sales > 0) tips.push({ type: 'action', icon: <Clock size={18} className="text-blue-500" />, text: `ช่วง ${bestHour.hour} ทำยอดได้ดีที่สุด ควรให้พนักงานเตรียมพร้อมรับลูกค้าให้เต็มที่` });
       return tips;
    };

    return { current, previous, growth, chartData, peakHours, insights: generateInsights() };
  }, [sales, dateFilter]);

  // ==========================================
  // 🔮 2. CASH FLOW ORACLE LOGIC (TRUE P&L & FORECAST)
  // ==========================================
  const oracleStats = useMemo(() => {
      const jobsList = Array.isArray(jobs) ? jobs : [];
      const salesList = Array.isArray(sales) ? sales : [];

      const now = Date.now();
      const msPerDay = 86400000;
      const thirtyDaysAgo = now - (30 * msPerDay);

      // --- A. LIQUIDITY AGING (อายุสต็อก) ---
      const currentStock = jobsList.filter(j => ['In Stock', 'Ready to Sell'].includes(j.status));
      let fastMoving = { count: 0, value: 0, items: [] as any[] };
      let normalMoving = { count: 0, value: 0, items: [] as any[] };
      let slowMoving = { count: 0, value: 0, items: [] as any[] };

      currentStock.forEach(j => {
          const cost = Number(j.final_price) || Number(j.price) || 0;
          const daysOld = Math.floor((now - j.created_at) / msPerDay);
          const itemData = { ...j, cost, daysOld };

          if (daysOld <= 7) { fastMoving.count++; fastMoving.value += cost; fastMoving.items.push(itemData); }
          else if (daysOld <= 14) { normalMoving.count++; normalMoving.value += cost; normalMoving.items.push(itemData); }
          else { slowMoving.count++; slowMoving.value += cost; slowMoving.items.push(itemData); }
      });

      const totalStockValue = fastMoving.value + normalMoving.value + slowMoving.value;
      slowMoving.items.sort((a, b) => b.daysOld - a.daysOld);

      // --- B. VELOCITY & TRUE P&L (เฉลี่ย 30 วัน) ---
      const dailyFixedCost = fixedCosts / 30; // 💸 แปลงค่าใช้จ่ายรายเดือนเป็นรายวัน

      const recentJobs = jobsList.filter(j => j.created_at >= thirtyDaysAgo && j.type !== 'Withdrawal');
      const totalSpent30d = recentJobs.reduce((sum, j) => sum + (Number(j.final_price) || Number(j.price) || 0), 0);
      const avgDailySpend = totalSpent30d / 30; // 📉 เงินออก/วัน (รับซื้อเครื่อง)

      const recentSales = salesList.filter(s => s.status !== 'VOIDED' && s.sold_at >= thirtyDaysAgo);
      const totalRev30d = recentSales.reduce((sum, s) => sum + (Number(s.grand_total) || 0), 0);
      const totalProfit30d = recentSales.reduce((sum, s) => sum + (Number(s.net_profit) || 0), 0);
      const avgDailyRev = totalRev30d / 30; // 📈 เงินเข้า/วัน (ยอดขาย)
      const avgDailyGrossProfit = totalProfit30d / 30; // กำไรขั้นต้นต่อวัน

      // 💥 สมการกระแสเงินสดที่แท้จริง (Net Daily Cash Flow)
      const netDailyCashFlow = avgDailyRev - avgDailySpend - dailyFixedCost;

      // 💥 กำไรสุทธิที่แท้จริง (True Net Profit/Day)
      const trueDailyNetProfit = avgDailyGrossProfit - dailyFixedCost;

      // --- C. RUNWAY & AI ALERTS ---
      let runwayDays = Infinity;
      if (netDailyCashFlow < 0 && workingCapital > 0) {
          runwayDays = Math.floor(workingCapital / Math.abs(netDailyCashFlow));
      } else if (netDailyCashFlow < 0 && workingCapital <= 0) {
          runwayDays = 0; // ล้มละลายแล้ว
      }

      // --- D. 🚀 30-DAY FUTURE SIMULATION (กราฟจำลองอนาคต) ---
      const futureChartData = [];
      let projectedCash = workingCapital;
      
      for (let i = 0; i <= 30; i++) {
          const d = new Date(now + (i * msPerDay));
          futureChartData.push({
              label: `${d.getDate()}/${d.getMonth()+1}`,
              actualProjected: projectedCash
          });
          // พยากรณ์เงินวันพรุ่งนี้
          projectedCash += netDailyCashFlow;
      }

      const warnings = [];
      if (trueDailyNetProfit < 0 && avgDailyGrossProfit > 0) {
          warnings.push(`🔥 วิกฤตกำไรแฝง: กำไรขายเครื่องต่อวัน (฿${avgDailyGrossProfit.toFixed(0)}) ไม่พอจ่ายค่าใช้จ่ายคงที่ (฿${dailyFixedCost.toFixed(0)}) ร้านกำลังติดลบวันละ ฿${Math.abs(trueDailyNetProfit).toFixed(0)}`);
      }
      if (runwayDays !== Infinity && runwayDays <= 14) {
          warnings.push(`🚨 สายป่านสั้น: กระแสเงินสดรวมจะหมดใน ${runwayDays} วัน แนะนำให้ "ชะลอรับซื้อเครื่อง" และระบายสต็อกเก่าด่วน!`);
      }
      if (totalStockValue > 0 && (slowMoving.value / totalStockValue) > 0.3) {
          warnings.push(`⚠️ ทุนจม: เงินทุนจมอยู่ในเครื่องเก่า (>14 วัน) สูงถึง ${((slowMoving.value / totalStockValue) * 100).toFixed(0)}% ของโกดัง`);
      }

      return {
          currentStockCount: currentStock.length, totalStockValue,
          fastMoving, normalMoving, slowMoving,
          avgDailySpend, avgDailyRev, dailyFixedCost, netDailyCashFlow, trueDailyNetProfit, avgDailyGrossProfit,
          runwayDays, futureChartData, warnings
      };
  }, [jobs, sales, workingCapital, fixedCosts]);

  if (jobsLoading || salesLoading) return <div className="p-10 text-center font-bold text-slate-400 animate-pulse">Loading Analytics Data...</div>;

  // ==========================================
  // 📊 VIEW: SALES & PROFIT ANALYTICS
  // ==========================================
  if (mode === 'sales') {
     return (
        <div className="p-6 md:p-8 bg-[#F5F7FA] min-h-screen font-sans text-slate-800 space-y-6 overflow-y-auto pb-20">
           {/* [โค้ดส่วน Sales Analytics คงเดิม ไม่เปลี่ยนแปลง] */}
           <div className="flex justify-between items-end mb-4">
              <div><h1 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2"><TrendingUp className="text-blue-600"/> Insight & Analytics</h1><p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">วิเคราะห์การเติบโตยอดขายและกำไรเชิงลึก</p></div>
              <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm"><Calendar size={18} className="text-slate-400 ml-2"/><select value={dateFilter} onChange={e=>setDateFilter(e.target.value as any)} className="bg-transparent font-black text-sm outline-none py-1.5 pr-4 cursor-pointer text-blue-600"><option value="today">วันนี้ (vs เมื่อวาน)</option><option value="this_week">สัปดาห์นี้ (vs สัปดาห์ก่อน)</option><option value="this_month">เดือนนี้ (vs เดือนที่แล้ว)</option></select></div>
           </div>

           {salesInsights.current.rev > 0 && (
              <div className="bg-gradient-to-r from-slate-900 to-indigo-900 rounded-[2rem] p-6 text-white shadow-lg relative overflow-hidden">
                 <Sparkles className="absolute top-0 right-0 m-6 text-indigo-400 opacity-20" size={100} />
                 <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 mb-4 text-indigo-200"><Sparkles size={18} className="text-yellow-400"/> AI Executive Summary</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
                    {salesInsights.insights.map((insight, idx) => (<div key={idx} className="bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-2xl flex gap-3 items-start"><div className="mt-0.5 bg-white/20 p-2 rounded-lg shadow-sm">{insight.icon}</div><p className="text-sm font-bold leading-relaxed opacity-90">{insight.text}</p></div>))}
                 </div>
              </div>
           )}

           <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <KpiCard title="Total Revenue" value={salesInsights.current.rev} prevValue={salesInsights.previous.rev} growth={salesInsights.growth.rev} prefix="฿" color="blue" />
              <KpiCard title="Net Profit" value={salesInsights.current.prof} prevValue={salesInsights.previous.prof} growth={salesInsights.growth.prof} prefix="฿" color="emerald" />
              <KpiCard title="Avg. Margin" value={salesInsights.current.margin} prevValue={salesInsights.previous.margin} growth={salesInsights.growth.margin} suffix="%" color="purple" isMargin={true} />
              <KpiCard title="Items Sold" value={salesInsights.current.devices + salesInsights.current.skus} prevValue={salesInsights.previous.devices + salesInsights.previous.skus} growth={salesInsights.growth.qty} suffix=" ชิ้น" color="orange" />
           </div>

           <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200">
               <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2"><Activity size={18} className="text-blue-500"/> Revenue Trend</h3>
               <div className="h-80 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={salesInsights.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}><defs><linearGradient id="colorCurr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0071E3" stopOpacity={0.4}/><stop offset="95%" stopColor="#0071E3" stopOpacity={0}/></linearGradient><linearGradient id="colorPrev" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#94A3B8" stopOpacity={0.2}/><stop offset="95%" stopColor="#94A3B8" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B', fontWeight: 'bold' }} dy={10} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B', fontWeight: 'bold' }} tickFormatter={(value) => `฿${(value/1000).toFixed(0)}k`} /><Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontWeight: 'bold', fontSize: '12px' }} formatter={(value: any) => `฿${value.toLocaleString()}`} /><Area type="monotone" name="Previous" dataKey="previous" stroke="#CBD5E1" strokeWidth={3} strokeDasharray="5 5" fillOpacity={1} fill="url(#colorPrev)" /><Area type="monotone" name="Current" dataKey="current" stroke="#0071E3" strokeWidth={4} fillOpacity={1} fill="url(#colorCurr)" /></AreaChart></ResponsiveContainer></div>
           </div>

           <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                 <StaffPerformanceWidget />
              </div>
              {/* เผื่ออนาคตเราสร้าง Widget อื่น จะได้เอามาเสียบข้างๆ กันได้ */}
           </div>
        </div>
     );
  }

  // ==========================================
  // 🔮 VIEW: CASH FLOW ORACLE (TRUE P&L MODE)
  // ==========================================
  return (
      <div className="p-6 md:p-8 bg-[#0F172A] min-h-screen font-sans text-slate-200 space-y-6 overflow-y-auto pb-20">
         
         <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-slate-800 pb-6">
            <div className="mb-4 md:mb-0">
               <h1 className="text-3xl font-black uppercase tracking-tight flex items-center gap-3 text-white">
                  <Flame className="text-orange-500" size={32}/> Cash Flow Oracle
               </h1>
               <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-1">ระบบพยากรณ์กระแสเงินสดอัจฉริยะ 30 วันล่วงหน้า</p>
            </div>
            
            {/* 💰 INPUTS: Capital & Fixed Costs */}
            <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
               <div className="bg-slate-800 p-4 rounded-2xl border border-emerald-500/20 flex flex-col gap-2 flex-1 md:w-64">
                  <div className="text-[10px] font-black uppercase tracking-widest text-emerald-400 flex justify-between">
                     <span>Working Capital (เงินสดในร้าน)</span>
                     <button onClick={() => setIsEditingCapital(!isEditingCapital)} className="text-emerald-400 hover:text-emerald-300"><Edit3 size={14}/></button>
                  </div>
                  {isEditingCapital ? (
                     <div className="flex gap-2">
                        <input type="number" value={tempCapital} onChange={e=>setTempCapital(e.target.value)} placeholder="ระบุเงินทุน..." className="flex-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white font-black outline-none focus:border-emerald-500"/>
                        <button onClick={() => handleSaveSettings('capital')} className="bg-emerald-600 p-1.5 rounded-lg hover:bg-emerald-500"><Save size={16}/></button>
                     </div>
                  ) : (
                     <div className="text-2xl font-black text-white flex items-center gap-2">
                        <Wallet size={20} className="text-emerald-500 opacity-80"/> ฿{workingCapital.toLocaleString()}
                     </div>
                  )}
               </div>

               <div className="bg-slate-800 p-4 rounded-2xl border border-red-500/20 flex flex-col gap-2 flex-1 md:w-64">
                  <div className="text-[10px] font-black uppercase tracking-widest text-red-400 flex justify-between">
                     <span>Monthly Fixed Costs (ค่าใช้จ่ายแฝง/เดือน)</span>
                     <button onClick={() => setIsEditingFixed(!isEditingFixed)} className="text-red-400 hover:text-red-300"><Edit3 size={14}/></button>
                  </div>
                  {isEditingFixed ? (
                     <div className="flex gap-2">
                        <input type="number" value={tempFixed} onChange={e=>setTempFixed(e.target.value)} placeholder="เช่น ค่าเช่า+ลูกน้อง..." className="flex-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white font-black outline-none focus:border-red-500"/>
                        <button onClick={() => handleSaveSettings('fixed')} className="bg-red-600 p-1.5 rounded-lg hover:bg-red-500"><Save size={16}/></button>
                     </div>
                  ) : (
                     <div className="text-2xl font-black text-white flex items-center gap-2">
                        <Calculator size={20} className="text-red-500 opacity-80"/> ฿{fixedCosts.toLocaleString()}
                     </div>
                  )}
               </div>
            </div>
         </div>

         {/* 🚨 AI DANGER ALERTS */}
         {oracleStats.warnings.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 p-5 rounded-2xl space-y-3">
               {oracleStats.warnings.map((warn, i) => (
                  <div key={i} className="flex items-center gap-3 text-red-400 font-bold text-sm">
                     <AlertOctagon size={18} className="shrink-0"/> {warn}
                  </div>
               ))}
            </div>
         )}

         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* 🛫 RUNWAY & BURN RATE */}
            <div className="bg-slate-800/50 p-6 rounded-[2rem] border border-slate-700/50 flex flex-col justify-between relative overflow-hidden">
               <div className="relative z-10">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2"><TrendingDown size={16}/> Cash Runway & Burn Rate</h3>
                  
                  <div className="mb-6">
                     <div className="text-[10px] font-black text-slate-500 uppercase mb-1">สถานะสายป่านธุรกิจ (Runway)</div>
                     {oracleStats.runwayDays === Infinity ? (
                        <div className="text-2xl font-black text-emerald-400">✅ กระแสเงินสดสุทธิเป็นบวก</div>
                     ) : (
                        <div className="flex items-end gap-2">
                           <span className={`text-6xl font-black tracking-tighter ${oracleStats.runwayDays <= 14 ? 'text-red-500' : 'text-orange-400'}`}>{oracleStats.runwayDays}</span>
                           <span className="text-xl font-bold text-slate-400 mb-2">วัน (Days Left)</span>
                        </div>
                     )}
                     <div className="text-[10px] font-bold text-slate-500 mt-2 leading-relaxed">
                        คำนวณจาก: เงินเข้า - เงินออก - <span className="text-red-400 underline decoration-dotted">ค่าใช้จ่ายแฝงต่อวัน</span>
                     </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 border-t border-slate-700 pt-5">
                     <div>
                        <div className="text-[9px] font-black text-emerald-400 uppercase mb-1 flex items-center gap-1"><ArrowUpRight size={10}/> ขาย/วัน</div>
                        <div className="text-sm font-black text-white">฿{oracleStats.avgDailyRev.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                     </div>
                     <div className="border-l border-slate-700 pl-3">
                        <div className="text-[9px] font-black text-orange-400 uppercase mb-1 flex items-center gap-1"><ArrowDownRight size={10}/> ซื้อเข้า/วัน</div>
                        <div className="text-sm font-black text-white">฿{oracleStats.avgDailySpend.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                     </div>
                     <div className="border-l border-slate-700 pl-3">
                        <div className="text-[9px] font-black text-red-400 uppercase mb-1 flex items-center gap-1"><Calculator size={10}/> ใช้จ่าย/วัน</div>
                        <div className="text-sm font-black text-white">฿{oracleStats.dailyFixedCost.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                     </div>
                  </div>
                  
                  <div className={`mt-5 p-3 rounded-xl border flex justify-between items-center ${oracleStats.trueDailyNetProfit >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                     <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">True Net Profit / Day</span>
                     <span className={`text-lg font-black ${oracleStats.trueDailyNetProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {oracleStats.trueDailyNetProfit >= 0 ? '+' : '-'}฿{Math.abs(oracleStats.trueDailyNetProfit).toLocaleString(undefined, {maximumFractionDigits:0})}
                     </span>
                  </div>
               </div>
               <TrendingDown size={150} className="absolute -right-10 -bottom-10 text-slate-800 opacity-50 z-0"/>
            </div>

            {/* 💧 LIQUIDITY HEATMAP */}
            <div className="bg-slate-800/50 p-6 rounded-[2rem] border border-slate-700/50 lg:col-span-2">
               <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2"><Layers size={16}/> Inventory Liquidity Heatmap</h3>
               <div className="flex flex-col md:flex-row items-center gap-8">
                  <div className="w-48 h-48 shrink-0">
                     <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                           <Pie data={[{ name: 'เร็ว (<7 วัน)', value: oracleStats.fastMoving.value, fill: '#10B981' }, { name: 'ปกติ (7-14 วัน)', value: oracleStats.normalMoving.value, fill: '#F59E0B' }, { name: 'จม (>14 วัน)', value: oracleStats.slowMoving.value, fill: '#EF4444' }]} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none"></Pie>
                           <Tooltip contentStyle={{ backgroundColor: '#1E293B', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px', fontWeight: 'bold' }} formatter={(val: any)=>`฿${val.toLocaleString()}`}/>
                        </PieChart>
                     </ResponsiveContainer>
                  </div>
                  <div className="flex-1 w-full space-y-4">
                     <div className="bg-slate-800 p-4 rounded-xl border border-emerald-500/20 flex justify-between items-center">
                        <div><div className="text-emerald-400 font-black text-sm flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> หมุนเร็ว (0-7 วัน)</div></div>
                        <div className="text-right"><div className="text-xl font-black text-white">฿{oracleStats.fastMoving.value.toLocaleString()}</div><div className="text-[10px] font-bold text-slate-500">{oracleStats.fastMoving.count} เครื่อง</div></div>
                     </div>
                     <div className="bg-slate-800 p-4 rounded-xl border border-orange-500/20 flex justify-between items-center">
                        <div><div className="text-orange-400 font-black text-sm flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-orange-500"></div> ปกติ (8-14 วัน)</div></div>
                        <div className="text-right"><div className="text-xl font-black text-white">฿{oracleStats.normalMoving.value.toLocaleString()}</div></div>
                     </div>
                     <div className="bg-red-500/10 p-4 rounded-xl border border-red-500/30 flex justify-between items-center relative overflow-hidden">
                        <div className="relative z-10"><div className="text-red-400 font-black text-sm flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div> สต็อกจม (เกิน 14 วัน)</div><div className="text-xs text-red-300/70 font-bold mt-1">อันตราย! ต้องลดราคาระบายออกด่วน</div></div>
                        <div className="text-right relative z-10"><div className="text-xl font-black text-white">฿{oracleStats.slowMoving.value.toLocaleString()}</div><div className="text-[10px] font-bold text-slate-500">{oracleStats.slowMoving.count} เครื่อง</div></div>
                     </div>
                  </div>
               </div>
            </div>

            {/* 🚀 30-DAY FUTURE SIMULATION (กราฟพยากรณ์เงินสด) */}
            <div className="bg-slate-800/50 p-6 rounded-[2rem] border border-slate-700/50 lg:col-span-3">
               <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                     <Radar size={16} className="text-blue-500"/> 30-Day Future Cash Flow Simulation
                  </h3>
                  <div className="text-[10px] font-bold text-slate-500 border border-slate-700 px-3 py-1 rounded-full flex gap-2 items-center">
                     <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div> เส้นสีแดงประ = จุดที่เงินสดหมด (Bankruptcy Line)
                  </div>
               </div>
               
               <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                     <AreaChart data={oracleStats.futureChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                        <defs>
                           <linearGradient id="colorCash" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={oracleStats.netDailyCashFlow >= 0 ? "#10B981" : "#F43F5E"} stopOpacity={0.4}/>
                              <stop offset="95%" stopColor={oracleStats.netDailyCashFlow >= 0 ? "#10B981" : "#F43F5E"} stopOpacity={0}/>
                           </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94A3B8', fontWeight: 'bold' }} dy={10} minTickGap={20} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94A3B8', fontWeight: 'bold' }} tickFormatter={(val) => `฿${(val/1000).toFixed(0)}k`} />
                        <Tooltip contentStyle={{ backgroundColor: '#1E293B', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '12px', fontWeight: 'bold' }} formatter={(val: any)=>`฿${val.toLocaleString(undefined, {maximumFractionDigits:0})}`}/>
                        
                        {/* 🚨 เส้นเตือนจุดช็อตเงิน (Zero Line) */}
                        <ReferenceLine y={0} stroke="#EF4444" strokeDasharray="4 4" strokeWidth={2} label={{ position: 'insideTopLeft', value: 'DANGER ZONE', fill: '#EF4444', fontSize: 10, fontWeight: 'bold' }} />
                        
                        <Area 
                           type="monotone" 
                           dataKey="actualProjected" 
                           name="Projected Cash (พยากรณ์เงินสด)" 
                           stroke={oracleStats.netDailyCashFlow >= 0 ? "#10B981" : "#F43F5E"} 
                           strokeWidth={4} 
                           fillOpacity={1} 
                           fill="url(#colorCash)" 
                        />
                     </AreaChart>
                  </ResponsiveContainer>
               </div>
               
               <div className="mt-6 p-4 rounded-xl bg-slate-900 border border-slate-700 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <div className="flex flex-col">
                     <span className="text-slate-500 mb-1">เงินสดร้านวันนี้</span>
                     <span className="text-sm text-white">฿{workingCapital.toLocaleString()}</span>
                  </div>
                  
                  <div className="flex items-center gap-4">
                     {oracleStats.runwayDays <= 30 && oracleStats.runwayDays > 0 && (
                        <span className="text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-2 rounded-xl text-xs flex items-center gap-2">
                           <AlertOctagon size={14}/> พยากรณ์: เงินสดจะหมดในอีก {oracleStats.runwayDays} วัน
                        </span>
                     )}
                     {oracleStats.runwayDays > 30 && oracleStats.netDailyCashFlow < 0 && (
                        <span className="text-orange-400 bg-orange-500/10 border border-orange-500/20 px-4 py-2 rounded-xl text-xs flex items-center gap-2">
                           <AlertOctagon size={14}/> เงินหมุนเวียนลดลงเรื่อยๆ แต่ยังปลอดภัยใน 30 วันนี้
                        </span>
                     )}
                     {oracleStats.netDailyCashFlow >= 0 && (
                        <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-xl text-xs flex items-center gap-2">
                           <Activity size={14}/> แนวโน้มเงินหมุนเวียนร้าน "เติบโตต่อเนื่อง"
                        </span>
                     )}
                  </div>

                  <div className="flex flex-col text-right">
                     <span className="text-slate-500 mb-1">ยอดเงินสดคาดการณ์สิ้นเดือน</span>
                     <span className={`text-sm ${oracleStats.futureChartData[30]?.actualProjected >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        ฿{oracleStats.futureChartData[30]?.actualProjected?.toLocaleString(undefined, {maximumFractionDigits:0})}
                     </span>
                  </div>
               </div>
            </div>

         </div>

         {/* ☠️ DEAD STOCK WATCHLIST */}
         {oracleStats.slowMoving.count > 0 && (
            <div className="bg-slate-800/50 rounded-[2rem] border border-red-500/20 overflow-hidden shadow-2xl">
               <div className="bg-red-500/10 p-6 border-b border-red-500/20 flex justify-between items-center">
                  <h3 className="text-sm font-black text-red-400 uppercase tracking-widest flex items-center gap-2"><ShieldAlert size={18}/> Dead Stock Watchlist (รายการของดอง)</h3>
                  <span className="bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded-lg uppercase shadow-lg shadow-red-500/20">Action Required</span>
               </div>
               <table className="w-full text-left text-sm">
                  <thead className="bg-slate-800 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                     <tr><th className="p-4 pl-6">Model (รุ่น)</th><th className="p-4">IMEI / SN</th><th className="p-4 text-center">Days in Stock</th><th className="p-4 text-right">Cost (ทุนรับมา)</th><th className="p-4 pr-6 text-right">คำแนะนำ (ลดราคาเหลือ)</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                     {oracleStats.slowMoving.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-700/30 transition-colors">
                           <td className="p-4 pl-6 font-bold text-slate-200">{item.model}</td><td className="p-4 font-mono text-xs text-slate-400">{item.imei || item.serial}</td>
                           <td className="p-4 text-center"><span className="bg-slate-900 text-red-400 font-black px-3 py-1 rounded-lg border border-red-500/20">{item.daysOld} วัน</span></td>
                           <td className="p-4 text-right font-black text-slate-300">฿{item.cost.toLocaleString()}</td>
                           <td className="p-4 pr-6 text-right"><span className="text-emerald-400 font-black bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">฿{(item.cost * 1.05).toLocaleString(undefined, {maximumFractionDigits:0})} (คืนทุน)</span></td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         )}
      </div>
  );
};

// COMPONENT: KPI CARD (For Sales Mode)
const KpiCard = ({ title, value, prevValue, growth, prefix = '', suffix = '', color, isMargin = false }: any) => {
   const isPositive = growth > 0; const isNegative = growth < 0;
   const formatVal = (v: number) => { if (isMargin) return v.toFixed(1); if (Number.isInteger(v)) return v.toLocaleString(); return v.toFixed(1); };
   let bgColors = 'bg-white border-slate-200'; let textColors = 'text-slate-800'; let iconColor = 'text-slate-400';
   if (color === 'blue') { bgColors = 'bg-white border-blue-100'; iconColor = 'text-blue-500'; }
   if (color === 'emerald') { bgColors = 'bg-emerald-50 border-emerald-100'; textColors = 'text-emerald-900'; iconColor = 'text-emerald-500'; }
   if (color === 'purple') { bgColors = 'bg-purple-50 border-purple-100'; textColors = 'text-purple-900'; iconColor = 'text-purple-500'; }
   return (
      <div className={`p-5 rounded-[2rem] shadow-sm border ${bgColors} flex flex-col justify-between relative overflow-hidden`}>
         <div className="flex justify-between items-start mb-4 relative z-10"><span className={`text-[10px] font-black uppercase tracking-widest ${iconColor}`}>{title}</span><div className={`flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-md ${isPositive ? 'bg-green-100 text-green-700' : isNegative ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{isPositive ? <ArrowUpRight size={12}/> : isNegative ? <ArrowDownRight size={12}/> : <TrendingUp size={12}/>}{isMargin ? `${growth > 0 ? '+' : ''}${growth.toFixed(1)} ppt` : `${Math.abs(growth).toFixed(1)}%`}</div></div>
         <div className="relative z-10"><div className={`text-3xl font-black tracking-tight ${textColors}`}>{prefix}{formatVal(value)}{suffix}</div><div className="text-[10px] font-bold text-slate-400 mt-1">vs {prefix}{formatVal(prevValue)}{suffix} (ก่อนหน้า)</div></div>
      </div>
   );
};