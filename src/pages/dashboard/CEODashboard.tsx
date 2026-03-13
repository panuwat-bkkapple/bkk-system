// src/pages/dashboard/CEODashboard.tsx
import React, { useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useAuth } from '../../hooks/useAuth';
import { 
  TrendingUp, TrendingDown, ShoppingCart, Smartphone, 
  ShieldAlert, AlertTriangle, ArrowRight, Wallet, Activity,
  Clock, Package
} from 'lucide-react';

export const CEODashboard = ({ onNavigate }: { onNavigate: (page: string) => void }) => {
  const { currentUser } = useAuth();
  const { data: sales, loading: salesLoading } = useDatabase('sales');
  const { data: jobs, loading: jobsLoading } = useDatabase('jobs');
  const { data: claims } = useDatabase('claims');

  const dashboardStats = useMemo(() => {
    const allSales = Array.isArray(sales) ? sales : [];
    const allJobs = Array.isArray(jobs) ? jobs : [];
    const allClaims = Array.isArray(claims) ? claims : Object.keys(claims || {}).map(k => ({ id: k, ...(claims as any)[k] }));

    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0)).getTime();
    const endOfDay = new Date(now.setHours(23, 59, 59, 999)).getTime();

    // 1. สถิติการขายวันนี้
    const todaysSales = allSales.filter(s => s.status !== 'VOIDED' && s.sold_at >= startOfDay && s.sold_at <= endOfDay);
    const todayRevenue = todaysSales.reduce((sum, s) => sum + (Number(s.grand_total) || 0), 0);
    const todayProfit = todaysSales.reduce((sum, s) => sum + (Number(s.net_profit) || 0), 0);
    const todayDevicesSold = todaysSales.reduce((count, s) => count + (s.items?.filter((i:any) => i.type === 'DEVICE').length || 0), 0);

    // 2. สถิติการรับซื้อวันนี้ (อัปเกรดแบบ Accounting-Grade)
    const todaysJobs = allJobs.filter(j => {
       if (j.type === 'Withdrawal' || j.type === 'B2B-Unpacked') return false;

       // 🌟 หาเวลาที่ "ปิดจ๊อบ/จ่ายเงิน" จริงๆ จากประวัติ Logs
       const closedLog = j.qc_logs?.find((l: any) => 
         ['Payment Completed', 'In Stock', 'Paid', 'Deal Closed (Negotiated)', 'Payout Processing'].includes(l.action)
       );

       // ถ้าระบบเจอว่ามีการปิดจ๊อบสำเร็จ ให้เช็คว่าปิด "วันนี้" ใช่หรือไม่?
       if (closedLog) {
         return closedLog.timestamp >= startOfDay && closedLog.timestamp <= endOfDay;
       }
       
       // ถ้ายังไม่ปิดจ๊อบ (เช่น กำลังประเมินราคา, รอ PO) ถือว่าบัญชียังไม่ได้จ่ายเงิน (Spend = ไม่นับ)
       return false;
    });

    const todaySpend = todaysJobs.reduce((sum, j) => sum + (Number(j.final_price) || Number(j.price) || 0), 0);

    const todayDevicesBought = todaysJobs.reduce((count, j) => {
       if (j.type === 'B2B Trade-in') {
          const validItems = j.graded_items?.filter((i: any) => i.grade !== 'Reject') || [];
          return count + (validItems.length > 0 ? validItems.length : 0);
       }
       return count + 1;
    }, 0);

    // 3. แจ้งเตือน (Alerts)
    const openClaims = allClaims.filter(c => c.status === 'OPEN').length;
    
    const msPerDay = 86400000;
    const deadStockCount = allJobs.filter(j => 
       ['In Stock', 'Ready to Sell'].includes(j.status) && 
       j.type !== 'B2B Trade-in' && // 🛑 ไม่นับตัวแม่ (Parent) เพราะมันขายไม่ได้ เราจะนับอายุเฉพาะเครื่องลูกที่ระเบิดกล่องแล้ว
       (Date.now() - j.created_at) > (14 * msPerDay)
    ).length;

    // 4. กิจกรรมล่าสุด (Recent Activities)
    const recentActivities = [
       ...allSales.filter(s => s.status !== 'VOIDED').map(s => ({ type: 'SALE', time: s.sold_at, text: `ขายสินค้า บิล: ${s.receipt_no}`, amount: s.grand_total, user: s.cashier })),
       
       // 🌟 กรองให้โชว์เฉพาะงานที่ "จ่ายเงินแล้ว/เข้าคลังแล้ว" เท่านั้น จะได้ไม่สับสนกับงานที่เพิ่งประเมินราคา
       ...allJobs.filter(j => {
           if (j.type === 'Withdrawal' || j.type === 'B2B-Unpacked') return false;
           return j.qc_logs?.some((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'Deal Closed (Negotiated)', 'Payout Processing'].includes(l.action));
       }).map(j => {
           // ดึงเวลาตอนที่ "ปิดจ๊อบ" มาโชว์ (ไม่ใช่เวลาที่เปิดบิลครั้งแรก)
           const closedLog = j.qc_logs?.find((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'Deal Closed (Negotiated)', 'Payout Processing'].includes(l.action));
           
           return { 
               type: 'BUY', 
               time: closedLog ? closedLog.timestamp : j.updated_at, 
               text: j.type === 'B2B Trade-in' ? `รับซื้อเหมาล็อต (B2B): ${j.cust_name?.split('(')[0]}` : `รับซื้อเครื่อง: ${j.model}`, 
               amount: j.final_price || j.price, 
               user: j.agent_name || 'Admin' 
           };
       }),
       
       ...allClaims.map(c => ({ type: 'CLAIM', time: c.created_at, text: `เปิดบิลเคลม: ${c.claim_no}`, amount: 0, user: c.handled_by }))
    ].sort((a, b) => b.time - a.time).slice(0, 5); // เอา 5 รายการล่าสุด

    return {
       todayRevenue, todayProfit, todayDevicesSold,
       todaySpend, todayDevicesBought,
       openClaims, deadStockCount,
       recentActivities
    };
  }, [sales, jobs, claims]);

  if (salesLoading || jobsLoading) return <div className="p-10 text-center font-bold text-slate-400">Loading Executive Dashboard...</div>;

  return (
    <div className="p-8 space-y-8 bg-[#F5F7FA] min-h-screen font-sans text-slate-800">
      
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-slate-900">
            Welcome back, <span className="text-blue-600">{currentUser?.name?.split(' ')[0] || 'Executive'}</span> 👋
          </h2>
          <p className="text-sm text-slate-500 font-bold mt-2 uppercase tracking-widest">
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-3">
           <button onClick={() => onNavigate('pos_register')} className="bg-white border border-slate-200 text-slate-700 px-6 py-3 rounded-2xl font-black uppercase text-xs hover:bg-slate-50 transition-all flex items-center gap-2 shadow-sm">
             <ShoppingCart size={16}/> ไปหน้า POS
           </button>
           <button onClick={() => onNavigate('tradein_analytics')} className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black uppercase text-xs hover:bg-slate-800 transition-all flex items-center gap-2 shadow-lg">
             <Wallet size={16}/> ดู Cash Flow
           </button>
        </div>
      </div>

      {/* KPI Cards (Today) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
         {/* Revenue Card */}
         <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-[2rem] text-white shadow-xl shadow-blue-900/20 relative overflow-hidden">
            <TrendingUp className="absolute -right-4 -bottom-4 opacity-20" size={100}/>
            <div className="relative z-10">
               <div className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-2 flex items-center gap-2"><ShoppingCart size={14}/> ยอดขายวันนี้ (Revenue)</div>
               <div className="text-3xl font-black tracking-tighter">฿{dashboardStats.todayRevenue.toLocaleString()}</div>
               <div className="text-xs font-bold text-blue-200 mt-2">{dashboardStats.todayDevicesSold} เครื่องที่ขายออก</div>
            </div>
         </div>

         {/* Profit Card */}
         <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-6 rounded-[2rem] text-white shadow-xl shadow-emerald-900/20 relative overflow-hidden">
            <Activity className="absolute -right-4 -bottom-4 opacity-20" size={100}/>
            <div className="relative z-10">
               <div className="text-[10px] font-black uppercase tracking-widest text-emerald-200 mb-2 flex items-center gap-2"><Wallet size={14}/> กำไรขั้นต้นวันนี้ (Gross Profit)</div>
               <div className="text-3xl font-black tracking-tighter">฿{dashboardStats.todayProfit.toLocaleString()}</div>
               <div className="text-xs font-bold text-emerald-200 mt-2">หักลบต้นทุนเครื่องเรียบร้อย</div>
            </div>
         </div>

         {/* Spend Card */}
         <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden">
            <TrendingDown className="absolute -right-4 -bottom-4 opacity-5 text-slate-900" size={100}/>
            <div className="relative z-10">
               <div className="text-[10px] font-black uppercase tracking-widest text-orange-500 mb-2 flex items-center gap-2"><Smartphone size={14}/> ยอดรับซื้อวันนี้ (Spend)</div>
               <div className="text-3xl font-black tracking-tighter text-slate-800">฿{dashboardStats.todaySpend.toLocaleString()}</div>
               <div className="text-xs font-bold text-slate-400 mt-2">{dashboardStats.todayDevicesBought} เครื่องที่รับเข้าคลัง</div>
            </div>
         </div>

         {/* Alert Card */}
         <div className="bg-red-50 p-6 rounded-[2rem] border border-red-100 shadow-sm relative overflow-hidden flex flex-col justify-center">
            <div className="flex justify-between items-center mb-3">
               <div className="text-[10px] font-black uppercase tracking-widest text-red-500 flex items-center gap-1"><ShieldAlert size={14}/> งานด่วน (Action Required)</div>
            </div>
            <div className="space-y-2">
               <div onClick={() => onNavigate('warranty_claims')} className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-red-100 cursor-pointer hover:border-red-300">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-2"><AlertTriangle size={14} className="text-red-500"/> เคสเคลมรอจัดการ</span>
                  <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-md">{dashboardStats.openClaims}</span>
               </div>
               <div onClick={() => onNavigate('tradein_analytics')} className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-orange-100 cursor-pointer hover:border-orange-300">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-2"><Package size={14} className="text-orange-500"/> สินค้าดองสต็อก {'(>14 วัน)'}</span>
                  <span className="bg-orange-500 text-white text-[10px] font-black px-2 py-0.5 rounded-md">{dashboardStats.deadStockCount}</span>
               </div>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         {/* Live Activity Feed */}
         <div className="lg:col-span-2 bg-white rounded-[2.5rem] p-8 shadow-sm border border-slate-200">
            <div className="flex justify-between items-center mb-6">
               <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                  <Clock size={18} className="text-blue-500"/> Live Activity (ความเคลื่อนไหวล่าสุด)
               </h3>
            </div>
            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-slate-200 before:to-transparent">
               {dashboardStats.recentActivities.length === 0 ? (
                  <div className="text-center text-slate-400 font-bold italic py-4">ยังไม่มีความเคลื่อนไหวในวันนี้</div>
               ) : (
                  dashboardStats.recentActivities.map((act, idx) => (
                     <div key={idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 ${act.type === 'SALE' ? 'bg-blue-500 text-white' : act.type === 'BUY' ? 'bg-orange-500 text-white' : 'bg-red-500 text-white'}`}>
                           {act.type === 'SALE' ? <ShoppingCart size={16}/> : act.type === 'BUY' ? <Smartphone size={16}/> : <ShieldAlert size={16}/>}
                        </div>
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-2xl border border-slate-100 bg-slate-50 shadow-sm transition-all hover:shadow-md">
                           <div className="flex justify-between items-start mb-1">
                              <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${act.type === 'SALE' ? 'bg-blue-100 text-blue-600' : act.type === 'BUY' ? 'bg-orange-100 text-orange-600' : 'bg-red-100 text-red-600'}`}>
                                 {act.type === 'SALE' ? 'ขายออก' : act.type === 'BUY' ? 'รับซื้อเข้า' : 'แจ้งเคลม'}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">{new Date(act.time).toLocaleTimeString('th-TH')}</span>
                           </div>
                           <h4 className="font-black text-sm text-slate-800 mb-1">{act.text}</h4>
                           <div className="flex justify-between items-end mt-2 pt-2 border-t border-slate-200/60">
                              <div className="text-[10px] font-bold text-slate-500">โดย: {act.user}</div>
                              {act.amount > 0 && <div className={`font-black text-sm ${act.type === 'SALE' ? 'text-emerald-500' : 'text-orange-500'}`}>฿{act.amount.toLocaleString()}</div>}
                           </div>
                        </div>
                     </div>
                  ))
               )}
            </div>
         </div>

         {/* Quick Shortcuts */}
         <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-4 px-2">Quick Shortcuts</h3>
            
            <button onClick={() => onNavigate('pos_register')} className="w-full bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all flex items-center justify-between group">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors"><ShoppingCart size={20}/></div>
                  <div className="text-left"><div className="font-black text-slate-800">POS หน้าร้าน</div><div className="text-[10px] font-bold text-slate-400 uppercase">เปิดบิลขายสินค้า</div></div>
               </div>
               <ArrowRight size={16} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all"/>
            </button>

            <button onClick={() => onNavigate('tradein_dash')} className="w-full bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md hover:border-orange-300 transition-all flex items-center justify-between group">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center group-hover:bg-orange-500 group-hover:text-white transition-colors"><Smartphone size={20}/></div>
                  <div className="text-left"><div className="font-black text-slate-800">รับซื้อ (Trade-in)</div><div className="text-[10px] font-bold text-slate-400 uppercase">ประเมินราคาและรับเครื่อง</div></div>
               </div>
               <ArrowRight size={16} className="text-slate-300 group-hover:text-orange-500 group-hover:translate-x-1 transition-all"/>
            </button>

            <button onClick={() => onNavigate('product_trace')} className="w-full bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md hover:border-emerald-300 transition-all flex items-center justify-between group">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-white transition-colors"><ShieldAlert size={20}/></div>
                  <div className="text-left"><div className="font-black text-slate-800">สืบประวัติ (Trace)</div><div className="text-[10px] font-bold text-slate-400 uppercase">เช็คเส้นทางสินค้าของโจร</div></div>
               </div>
               <ArrowRight size={16} className="text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all"/>
            </button>
         </div>
      </div>

    </div>
  );
};