// src/components/staff/StaffPerformanceWidget.tsx
import React, { useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { Trophy, Medal, Award, TrendingUp, Receipt } from 'lucide-react';

export const StaffPerformanceWidget = () => {
  const { data: sales, loading } = useDatabase('sales');

  const staffRanking = useMemo(() => {
    const allSales = Array.isArray(sales) ? sales : [];
    const staffMap: Record<string, any> = {};

    // 1. วนลูปบิลทั้งหมดเพื่อรวมยอดให้พนักงานแต่ละคน
    allSales.forEach(sale => {
      if (sale.status === 'VOIDED') return; // ไม่นับบิลที่ยกเลิก

      const cashierName = sale.cashier || 'ไม่ระบุชื่อ (Unknown)';
      const revenue = Number(sale.grand_total) || 0;
      const profit = Number(sale.net_profit) || 0;

      if (!staffMap[cashierName]) {
        staffMap[cashierName] = { name: cashierName, revenue: 0, profit: 0, bills: 0 };
      }

      staffMap[cashierName].revenue += revenue;
      staffMap[cashierName].profit += profit;
      staffMap[cashierName].bills += 1;
    });

    // 2. แปลงเป็น Array และเรียงลำดับจากยอดขายมากไปน้อย
    const sortedStaff = Object.values(staffMap).sort((a: any, b: any) => b.revenue - a.revenue);
    
    // หาค่าสูงสุดเพื่อทำหลอด Progress Bar
    const maxRevenue = sortedStaff.length > 0 ? sortedStaff[0].revenue : 1;

    return { list: sortedStaff, maxRevenue };
  }, [sales]);

  if (loading) return <div className="p-5 text-center text-slate-400 font-bold">กำลังโหลดข้อมูลพนักงาน...</div>;

  return (
    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200">
      <div className="flex justify-between items-center mb-6">
         <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <Trophy size={18} className="text-yellow-500"/> Staff Leaderboard
         </h3>
         <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">All Time</span>
      </div>

      <div className="space-y-4">
        {staffRanking.list.length === 0 ? (
           <div className="text-center text-slate-400 italic font-bold py-4">ยังไม่มีข้อมูลการขาย</div>
        ) : (
           staffRanking.list.map((staff: any, index: number) => {
              // กำหนดไอคอนเหรียญรางวัลสำหรับ Top 3
              let medalIcon = <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-black text-slate-400 text-xs">{index + 1}</div>;
              if (index === 0) medalIcon = <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600"><Trophy size={16}/></div>;
              else if (index === 1) medalIcon = <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500"><Medal size={16}/></div>;
              else if (index === 2) medalIcon = <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600"><Award size={16}/></div>;

              const percent = (staff.revenue / staffRanking.maxRevenue) * 100;

              return (
                 <div key={staff.name} className="flex items-center gap-4 group">
                    {/* อันดับ */}
                    {medalIcon}
                    
                    {/* รายละเอียด */}
                    <div className="flex-1">
                       <div className="flex justify-between items-end mb-1">
                          <span className="font-black text-slate-700 text-sm">{staff.name}</span>
                          <span className="font-black text-blue-600">฿{staff.revenue.toLocaleString()}</span>
                       </div>
                       
                       {/* หลอด Progress Bar */}
                       <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-1.5">
                          <div 
                             className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-1000 ease-out"
                             style={{ width: `${percent}%` }}
                          ></div>
                       </div>

                       <div className="flex justify-between text-[10px] font-bold text-slate-400">
                          <span className="flex items-center gap-1"><Receipt size={10}/> {staff.bills} บิล</span>
                          <span className="flex items-center gap-1 text-emerald-500"><TrendingUp size={10}/> กำไร: ฿{staff.profit.toLocaleString()}</span>
                       </div>
                    </div>
                 </div>
              );
           })
        )}
      </div>
    </div>
  );
};